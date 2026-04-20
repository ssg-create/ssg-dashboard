"""
Sync GWMS data → JSONs no repo.

Puxa 4 datasets do MySQL OTRS via Grafana API:
  - silenciosos.json  : tickets sem interação há ≥ 1 dia
  - triagem.json      : tickets em triagem agora (state=open sem movimentação)
  - reaberturas.json  : tickets reabertos (já passaram por fechamento e voltaram)
  - utilizacao.json   : carga atual por atendente (tickets ativos, em atendimento)

Uso: chamado pelo workflow .github/workflows/gwms-sync.yml
"""

import base64
import json
import os
import sys
import time
from datetime import datetime, timezone

import requests

GWMS_URL = "https://gwms2.groundwork.com.br"
DATASOURCE_UID = "PIz1Yx14k"  # MySQL:otrs

# Filas ativas do dashcompleto (mesmas do index.html FILAS_LIST)
FILAS = ("DATASUL", "DBA", "GWMS", "INFRAESTUTURA", "PROTHEUS", "SSG", "SSG-MELHORIAS")
FILAS_SQL = ",".join(f"'{f}'" for f in FILAS)

# Estados fechados (closed successful, unsuccessful, removed, merged,
# fechado sem êxito auto, resolvido, cancelado)
ESTADOS_FECHADOS = (2, 3, 5, 9, 17, 18, 19)
# Estado "em atendimento" é id=14
# Estado "open" (triagem inicial) é id=4
# History type StateUpdate=27, OwnerUpdate=23, Move=16

# Os mesmos estados que o painel silenciosos exclui
SILEN_EXCLUIR = (2, 3, 5, 7, 9, 11, 16, 17, 18, 19)
SILEN_EXCLUIR_SQL = ",".join(str(s) for s in SILEN_EXCLUIR)

# Estados considerados ativos/abertos (excluímos fechados e estados que "aguardam")
ESTADOS_ATIVOS = (4, 11, 12, 13, 14, 15, 20)
ESTADOS_ATIVOS_SQL = ",".join(str(s) for s in ESTADOS_ATIVOS)


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def login(session: requests.Session, user: str, password: str) -> None:
    r = session.post(
        f"{GWMS_URL}/grafana/login",
        json={"user": user, "password": password},
        timeout=30,
    )
    if r.status_code != 200:
        raise RuntimeError(f"Login GWMS falhou: HTTP {r.status_code} — {r.text[:200]}")
    log("Login GWMS OK")


def query_mysql(session: requests.Session, sql: str) -> list[dict]:
    body = {
        "queries": [
            {
                "refId": "A",
                "datasource": {"type": "mysql", "uid": DATASOURCE_UID},
                "format": "table",
                "rawSql": sql,
                "rawQuery": True,
            }
        ],
        "from": "now-7d",
        "to": "now",
    }
    r = session.post(f"{GWMS_URL}/grafana/api/ds/query", json=body, timeout=60)
    r.raise_for_status()
    data = r.json()
    frames = data.get("results", {}).get("A", {}).get("frames", [])
    if not frames:
        return []
    frame = frames[0]
    names = [f["name"] for f in frame["schema"]["fields"]]
    values = frame["data"]["values"]
    if not values or not values[0]:
        return []
    rows = []
    for i in range(len(values[0])):
        rows.append({names[j]: values[j][i] for j in range(len(names))})
    return rows


# ─── QUERIES ────────────────────────────────────────────────────────────────

def q_silenciosos(session: requests.Session) -> list[dict]:
    sql = f"""
    SELECT
      t.tn                                                     AS ticket,
      t.customer_id                                            AS cliente,
      q.name                                                   AS fila,
      UPPER(ts.name)                                           AS estado,
      tp.name                                                  AS prioridade,
      CONCAT(u.first_name, ' ', u.last_name)                   AS atendente,
      DATE_FORMAT(t.create_time, '%Y-%m-%dT%H:%i:%s')          AS criado,
      DATE_FORMAT(t.change_time, '%Y-%m-%dT%H:%i:%s')          AS modificado,
      (UNIX_TIMESTAMP() - UNIX_TIMESTAMP(t.change_time))       AS silent_sec,
      t.title                                                  AS assunto
    FROM ticket t
    JOIN queue           q  ON t.queue_id           = q.id
    JOIN ticket_state    ts ON t.ticket_state_id    = ts.id
    JOIN ticket_priority tp ON t.ticket_priority_id = tp.id
    JOIN users           u  ON t.user_id            = u.id
    WHERE t.ticket_state_id NOT IN ({SILEN_EXCLUIR_SQL})
      AND UNIX_TIMESTAMP(t.change_time) <= (UNIX_TIMESTAMP() - 86400)
      AND q.name IN ({FILAS_SQL})
    ORDER BY silent_sec DESC
    LIMIT 500
    """
    return query_mysql(session, sql)


def q_triagem(session: requests.Session) -> list[dict]:
    """Tickets atualmente em 'open' (state=4) sem nenhuma movimentação após criação.
    Movimentação = StateUpdate (27), OwnerUpdate (23), Move (16)."""
    sql = f"""
    SELECT
      t.tn                                                     AS ticket,
      t.customer_id                                            AS cliente,
      q.name                                                   AS fila,
      UPPER(ts.name)                                           AS estado,
      tp.name                                                  AS prioridade,
      CONCAT(u.first_name, ' ', u.last_name)                   AS atendente,
      DATE_FORMAT(t.create_time, '%Y-%m-%dT%H:%i:%s')          AS criado,
      TIMESTAMPDIFF(MINUTE, t.create_time, NOW())              AS triagem_min,
      t.title                                                  AS assunto
    FROM ticket t
    JOIN queue           q  ON t.queue_id           = q.id
    JOIN ticket_state    ts ON t.ticket_state_id    = ts.id
    JOIN ticket_priority tp ON t.ticket_priority_id = tp.id
    JOIN users           u  ON t.user_id            = u.id
    WHERE t.ticket_state_id = 4
      AND q.name IN ({FILAS_SQL})
      AND NOT EXISTS(
        SELECT 1 FROM ticket_history th
        WHERE th.ticket_id = t.id
          AND th.history_type_id IN (27, 23, 16)
          AND th.create_time > DATE_ADD(t.create_time, INTERVAL 2 SECOND)
      )
    ORDER BY triagem_min DESC
    LIMIT 200
    """
    return query_mysql(session, sql)


def q_reaberturas(session: requests.Session) -> list[dict]:
    """Tickets criados nos últimos 90 dias que já passaram por algum estado
    fechado e voltaram pra um estado ativo."""
    sql = f"""
    SELECT
      t.tn                                                     AS ticket,
      t.customer_id                                            AS cliente,
      q.name                                                   AS fila,
      UPPER(ts.name)                                           AS estado_atual,
      tp.name                                                  AS prioridade,
      CONCAT(u.first_name, ' ', u.last_name)                   AS atendente,
      DATE_FORMAT(t.create_time, '%Y-%m-%dT%H:%i:%s')          AS criado,
      DATE_FORMAT(t.change_time, '%Y-%m-%dT%H:%i:%s')          AS modificado,
      COUNT(DISTINCT CASE WHEN th.state_id IN ({','.join(str(s) for s in ESTADOS_FECHADOS)}) THEN th.id END) AS vezes_fechado,
      t.title                                                  AS assunto
    FROM ticket t
    JOIN queue           q  ON t.queue_id           = q.id
    JOIN ticket_state    ts ON t.ticket_state_id    = ts.id
    JOIN ticket_priority tp ON t.ticket_priority_id = tp.id
    JOIN users           u  ON t.user_id            = u.id
    LEFT JOIN ticket_history th ON th.ticket_id = t.id AND th.history_type_id = 27
    WHERE t.ticket_state_id NOT IN ({','.join(str(s) for s in ESTADOS_FECHADOS)})
      AND q.name IN ({FILAS_SQL})
      AND t.create_time >= DATE_SUB(NOW(), INTERVAL 90 DAY)
    GROUP BY t.id
    HAVING vezes_fechado >= 1
    ORDER BY vezes_fechado DESC, t.change_time DESC
    LIMIT 300
    """
    return query_mysql(session, sql)


def q_utilizacao(session: requests.Session) -> list[dict]:
    """Carga atual por atendente: count de ativos e em_atendimento.
    Simplificação: não computa % de utilização histórica (exigiria time-series),
    apenas snapshot atual."""
    sql = f"""
    SELECT
      CONCAT(u.first_name, ' ', u.last_name)                                         AS atendente,
      COUNT(*)                                                                        AS ativos_total,
      SUM(CASE WHEN t.ticket_state_id = 14 THEN 1 ELSE 0 END)                         AS em_atendimento,
      SUM(CASE WHEN t.ticket_state_id IN (11, 12, 13, 15) THEN 1 ELSE 0 END)          AS aguardando,
      SUM(CASE WHEN t.ticket_state_id = 4 THEN 1 ELSE 0 END)                          AS abertos,
      AVG(CASE WHEN t.ticket_state_id = 14 THEN TIMESTAMPDIFF(MINUTE, t.change_time, NOW()) END) AS em_atend_tempo_med_min
    FROM ticket t
    JOIN users u ON t.user_id = u.id
    JOIN queue q ON t.queue_id = q.id
    WHERE q.name IN ({FILAS_SQL})
      AND t.ticket_state_id IN ({ESTADOS_ATIVOS_SQL})
    GROUP BY u.id
    ORDER BY ativos_total DESC
    LIMIT 50
    """
    return query_mysql(session, sql)


# ─── UPLOAD ──────────────────────────────────────────────────────────────────

def github_upload(path: str, payload_bytes: bytes, message: str) -> None:
    token = os.environ["DEPLOY_TOKEN"]
    repo = os.environ["GH_REPO"]
    api = f"https://api.github.com/repos/{repo}/contents/{path}"
    headers = {
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github+json",
    }
    sha_resp = requests.get(api, headers=headers, timeout=15)
    sha = sha_resp.json().get("sha") if sha_resp.status_code == 200 else None
    body = {
        "message": message,
        "content": base64.b64encode(payload_bytes).decode(),
    }
    if sha:
        body["sha"] = sha
    put = requests.put(api, headers=headers, json=body, timeout=60)
    if put.status_code not in (200, 201):
        raise RuntimeError(f"Upload {path} falhou: HTTP {put.status_code} — {put.text[:300]}")
    log(f"Upload {path} OK ({put.status_code})")


def make_envelope(rows: list, extra: dict | None = None) -> dict:
    now = datetime.now(timezone.utc)
    env = {
        "generated_at": int(time.time()),
        "generated_at_iso": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "count": len(rows),
        "filas": list(FILAS),
        "rows": rows,
    }
    if extra:
        env.update(extra)
    return env


def main() -> None:
    user = os.environ.get("GWMS_USER")
    password = os.environ.get("GWMS_PASS")
    if not user or not password:
        print("ERRO: GWMS_USER/GWMS_PASS ausentes", file=sys.stderr)
        sys.exit(1)

    s = requests.Session()
    login(s, user, password)

    datasets = [
        ("silenciosos.json", q_silenciosos, {"silencio_min_sec": 86400}),
        ("triagem.json",     q_triagem,     None),
        ("reaberturas.json", q_reaberturas, {"janela_dias": 90}),
        ("utilizacao.json",  q_utilizacao,  None),
    ]

    failures = []
    for fname, qfn, extra in datasets:
        try:
            rows = qfn(s)
            log(f"{fname}: {len(rows)} linhas")
            payload = json.dumps(make_envelope(rows, extra), ensure_ascii=False, indent=2).encode("utf-8")
            github_upload(fname, payload, f"chore: sync {fname} ({len(rows)} linhas)")
        except Exception as e:
            log(f"ERRO em {fname}: {e}")
            failures.append(fname)

    if failures:
        print(f"FALHAS: {failures}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
