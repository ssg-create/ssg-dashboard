#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# verify.sh — GW Command Center · Pre-deploy fingerprint check
# Roda antes de todo git push. Aborta se qualquer check falhar.
# Uso: ./verify.sh [caminho/para/index.html]
# ═══════════════════════════════════════════════════════════════

FILE="${1:-$(dirname "$0")/index.html}"

RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[1;33m'; BLD='\033[1m'; RST='\033[0m'

PASS=0; FAIL=0; WARNS=0

pass() { echo -e "  ${GRN}✓${RST} $1"; ((PASS++)); }
fail() { echo -e "  ${RED}✗ FALHOU${RST} — $1"; ((FAIL++)); }
warn() { echo -e "  ${YLW}⚠ AVISO${RST}  — $1"; ((WARNS++)); }

check_min() {
  local desc="$1" pattern="$2" min="$3"
  local count
  count=$(grep -c "$pattern" "$FILE" 2>/dev/null || echo 0)
  if [ "$count" -ge "$min" ]; then
    pass "$desc (${count}×)"
  else
    fail "$desc — esperado >=${min}, encontrado ${count}×"
  fi
}

check_exact() {
  local desc="$1" pattern="$2"
  if grep -q "$pattern" "$FILE" 2>/dev/null; then
    pass "$desc"
  else
    fail "$desc — padrão não encontrado: '$pattern'"
  fi
}

check_absent() {
  local desc="$1" pattern="$2"
  if grep -q "$pattern" "$FILE" 2>/dev/null; then
    fail "$desc — padrão PROIBIDO encontrado: '$pattern'"
  else
    pass "$desc (ausente ✓)"
  fi
}

echo ""
echo -e "${BLD}════════════════════════════════════════════════${RST}"
echo -e "${BLD} GW Command Center · Verificação pré-deploy${RST}"
echo -e "${BLD}════════════════════════════════════════════════${RST}"
echo ""

if [ ! -f "$FILE" ]; then
  echo -e "${RED}ERRO: arquivo não encontrado: $FILE${RST}"
  exit 1
fi

SIZE=$(wc -c < "$FILE")
echo -e "  Arquivo: ${BLD}$FILE${RST} ($(( SIZE / 1024 ))KB)"
echo ""

# ── 1. FUNÇÕES PERMANENTES ────────────────────────────────────
echo -e "${BLD}[1] Funções permanentes${RST}"
check_min  "fmtResp / fmtRespTxt (regra permanente)"  "fmtResp"           4
check_min  "calcSLA — função canônica de SLA"          "calcSLA"           5
check_min  "getActiveOP — escopo de filtros"           "getActiveOP"       3
check_min  "ticketInFilter — filtro de ticket"         "ticketInFilter"    3
check_min  "getFilteredEmpresa — filter por empresa"   "getFilteredEmpresa" 2
check_min  "isClosedOKForSLA — helper de estado"       "isClosedOKForSLA"  2
check_min  "isOpenState — helper de estado"            "isOpenState"       2
check_min  "pct() — percentual clamped"                "function pct"      1
echo ""

# ── 2. FIXES CRÍTICOS DE DADOS ────────────────────────────────
echo -e "${BLD}[2] Fixes críticos de dados (R1–R9, K)${RST}"
check_exact "R6/critical: op.total!=null (não vaza global)" "op\.total!=null"
check_absent "R6 proibido: op.total||OP.total"              "op\.total||OP\.total"
check_min   "R9: CSAT usa RAW_DATA.filter"                  "RAW_DATA\.filter"         2
check_exact "R7: _rebuildAllTickets centralizado"           "_rebuildAllTickets"
check_exact "K: calcSLA chamado em renderResumo/computeInsights" "calcSLA(rows"
echo ""

# ── 3. LINKS OTRS ─────────────────────────────────────────────
echo -e "${BLD}[3] Links OTRS${RST}"
check_min  "AgentTicketZoom — links diretos de ticket"   "AgentTicketZoom"   5
check_min  "AgentTicketSearch — links de busca"          "AgentTicketSearch" 3
check_exact "Modal ticket: botão ↗ OTRS (tkd-otrs-link)" "tkd-otrs-link"
check_exact "Hero alertas: link OTRS"                    "_alUrl.*AgentTicketSearch\|AgentTicketSearch.*_alUrl\|alUrl"
check_exact "Hero clientes: link OTRS"                   "_clOtrsUrl"
check_exact "Ações Prioritárias: links de tickets"       "_links.*_shown\|_shown.*map.*AgentTicketZoom\|AgentTicketZoom.*c\.num"
echo ""

# ── 4. MELHORIAS ATENDENTES ───────────────────────────────────
echo -e "${BLD}[4] Melhorias de atendentes${RST}"
check_exact "Cor sobrecarga: usa cargaReal (não ativos_total)" "cargaReal"
check_exact "Hero atendentes: filtro por fila (_filaAtend)"    "_filaAtend"
check_exact "Capacidade da Equipe: título clicável OTRS"       "Capacidade da Equipe.*_atHref\|_atHref.*Capacidade"
check_exact "Modal atendente: #num clicável (_tkUrl)"          "_tkUrl.*AgentTicketZoom\|AgentTicketZoom.*_tkUrl"
echo ""

# ── 5. INTEGRIDADE GERAL ──────────────────────────────────────
echo -e "${BLD}[5] Integridade geral${RST}"
check_min  "Chart.js presente"                "Chart\b"              3
check_min  "XLSX parser presente"             "XLSX\."               3
check_exact "autoFetchJSON — carregamento JSON" "autoFetchJSON"
check_exact "RAW_DATA declarado"               "var RAW_DATA"
check_exact "historico_completo.json referenciado" "historico_completo\.json"

# Tamanho mínimo (proteção contra arquivo truncado)
if [ "$SIZE" -lt 500000 ]; then
  fail "Tamanho suspeito: ${SIZE} bytes (< 500KB — possível truncamento)"
else
  pass "Tamanho OK: $(( SIZE / 1024 ))KB"
fi
echo ""

# ── RESULTADO FINAL ───────────────────────────────────────────
echo -e "${BLD}════════════════════════════════════════════════${RST}"
TOTAL=$(( PASS + FAIL ))
if [ "$FAIL" -eq 0 ]; then
  echo -e " ${GRN}${BLD}✓ TUDO OK — ${PASS}/${TOTAL} checks passaram${RST}"
  [ "$WARNS" -gt 0 ] && echo -e " ${YLW}  (${WARNS} avisos — revisar antes de deploy)${RST}"
  echo -e "${BLD}════════════════════════════════════════════════${RST}"
  echo ""
  exit 0
else
  echo -e " ${RED}${BLD}✗ FALHOU — ${FAIL} problema(s) encontrado(s) de ${TOTAL} checks${RST}"
  echo -e " ${RED}  Corrigir antes de fazer deploy.${RST}"
  echo -e "${BLD}════════════════════════════════════════════════${RST}"
  echo ""
  exit 1
fi
