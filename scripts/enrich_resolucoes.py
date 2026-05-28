"""
Enrich Resoluções — chama /api/extract-resolucao do Vercel pra cada chamado
fechado SEM cartão IA ainda, e atualiza historico_ai.json.

Rate limit Gemini Flash free tier: 15 req/min, 1M tokens/dia.
Esse script roda em batch de ~50 tickets por rodada, gentil com o limit.

Uso: chamado pelo workflow .github/workflows/enrich-ai.yml

Saída: historico_ai.json com formato:
{
  "generated_at_iso": "2026-05-28T...",
  "count": N,
  "cards": {
    "<num_ticket>": {
      "problema": "...",
      "causa": "...",
      "solucao": "...",
      "tempo_min": N,
      "tags": [...],
      "confianca": "alta|media|baixa",
      "processed_at": "ISO"
    },
    ...
  }
}

Não toca em historico_completo.json — arquivo separado.
"""

import json
import os
import sys
import time
import base64
from datetime import datetime, timezone

import requests

# ─── Config ─────────────────────────────────────────────────────────────────

VERCEL_BASE       = "https://gw-command.vercel.app"
EXTRACT_ENDPOINT  = f"{VERCEL_BASE}/api/extract-resolucao"
HIST_JSON_URL     = f"{VERCEL_BASE}/historico_completo.json"

GH_API            = "https://api.github.com"
HIST_AI_FILENAME  = "historico_ai.json"

BATCH_SIZE        = 50      # tickets processados por rodada
RPM_DELAY_SECONDS = 5       # pausa entre calls (12 RPM, sob o limite de 15)
TIMEOUT_SECONDS   = 60      # timeout por call
MIN_TEXT_LEN      = 100     # ignora textos muito curtos (boilerplate)


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


# ─── GitHub API helpers (mesmo padrão do gwms_sync.py) ──────────────────────

def github_get_file(repo: str, branch: str, path: str, token: str):
    """Retorna (content_dict, sha) ou (None, None) se arquivo não existe ainda."""
    api = f"{GH_API}/repos/{repo}/contents/{path}?ref={branch}"
    r = requests.get(api, headers={"Authorization": f"token {token}"}, timeout=30)
    if r.status_code == 404:
        return None, None
    r.raise_for_status()
    data = r.json()
    raw = base64.b64decode(data["content"]).decode("utf-8")
    return json.loads(raw), data["sha"]


def github_put_file(repo: str, branch: str, path: str, payload: bytes,
                    token: str, sha: str | None, message: str):
    api = f"{GH_API}/repos/{repo}/contents/{path}"
    body = {
        "message": message,
        "content": base64.b64encode(payload).decode("ascii"),
        "branch":  branch,
    }
    if sha:
        body["sha"] = sha
    r = requests.put(api, headers={"Authorization": f"token {token}"}, json=body, timeout=60)
    r.raise_for_status()
    return r.json()


# ─── Core ───────────────────────────────────────────────────────────────────

def carregar_historico():
    """Baixa historico_completo.json (público no Vercel)."""
    log(f"Baixando {HIST_JSON_URL}")
    r = requests.get(HIST_JSON_URL, timeout=60)
    r.raise_for_status()
    d = r.json()
    rows = d.get("rows", [])
    com_texto = [r for r in rows if r.get("resolucao_texto") and len(r["resolucao_texto"]) >= MIN_TEXT_LEN]
    log(f"Total no histórico: {len(rows)} · Com texto útil: {len(com_texto)}")
    return com_texto


def chamar_gemini(num: str, assunto: str, texto: str) -> dict | None:
    """Chama /api/extract-resolucao. Retorna dict ou None se falhar."""
    try:
        r = requests.post(
            EXTRACT_ENDPOINT,
            json={"num": num, "assunto": assunto, "texto_cru": texto},
            timeout=TIMEOUT_SECONDS,
        )
        if r.status_code != 200:
            log(f"  [{num}] HTTP {r.status_code}: {r.text[:150]}")
            return None
        return r.json()
    except Exception as e:
        log(f"  [{num}] erro: {e}")
        return None


def main():
    repo  = os.environ.get("GH_REPO")     # ex: ssg-create/ssg-dashboard-data
    branch = os.environ.get("GH_BRANCH", "main")
    token = os.environ.get("DEPLOY_TOKEN") or os.environ.get("GH_PAT_CROSS_REPO")
    if not repo or not token:
        print("ERRO: GH_REPO / DEPLOY_TOKEN ausentes", file=sys.stderr)
        sys.exit(1)

    # 1. Carrega histórico
    com_texto = carregar_historico()
    if not com_texto:
        log("Nenhum chamado com texto útil. Saindo.")
        return

    # 2. Carrega historico_ai.json existente (se houver)
    log(f"Buscando {HIST_AI_FILENAME} no repo de dados…")
    ai_state, sha = github_get_file(repo, branch, HIST_AI_FILENAME, token)
    if ai_state is None:
        log("historico_ai.json ainda não existe. Criando do zero.")
        ai_state = {"generated_at_iso": "", "count": 0, "cards": {}}
        sha = None

    cards = ai_state.get("cards", {})
    ja_processados = set(cards.keys())
    log(f"Já processados anteriormente: {len(ja_processados)}")

    # 3. Filtra os que faltam, ordena por mais recente primeiro
    pendentes = [r for r in com_texto if str(r["num"]) not in ja_processados]
    pendentes.sort(key=lambda r: r.get("criado", ""), reverse=True)
    log(f"Pendentes: {len(pendentes)} · Processando até {BATCH_SIZE} nesta rodada")

    # 4. Processa o batch
    processados = 0
    falhas = 0
    for i, ticket in enumerate(pendentes[:BATCH_SIZE]):
        num = str(ticket["num"])
        assunto = ticket.get("assunto", "")
        texto = ticket.get("resolucao_texto", "")
        log(f"({i+1}/{min(BATCH_SIZE, len(pendentes))}) #{num} — {assunto[:50]}")

        card = chamar_gemini(num, assunto, texto)
        if card:
            card["processed_at"] = datetime.now(timezone.utc).isoformat()
            cards[num] = card
            processados += 1
        else:
            falhas += 1

        # Rate limit gentil
        if i < min(BATCH_SIZE, len(pendentes)) - 1:
            time.sleep(RPM_DELAY_SECONDS)

    log(f"Rodada concluída · Processados: {processados} · Falhas: {falhas}")

    # 5. Sobe novo historico_ai.json se houve alteração
    if processados > 0:
        ai_state["generated_at_iso"] = datetime.now(timezone.utc).isoformat()
        ai_state["count"] = len(cards)
        ai_state["cards"] = cards
        payload = json.dumps(ai_state, ensure_ascii=False, indent=2).encode("utf-8")
        log(f"Subindo {HIST_AI_FILENAME} com {len(cards)} cartões ({len(payload)/1024:.1f} KB)")
        github_put_file(
            repo, branch, HIST_AI_FILENAME, payload, token, sha,
            f"chore: enrich {processados} novos cartões IA ({len(cards)} total)"
        )
        log("Upload OK")
    else:
        log("Nada novo pra subir.")


if __name__ == "__main__":
    main()
