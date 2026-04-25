#!/usr/bin/env bash
# ───────────────────────────────────────────────────────────────
# Vercel Ignored Build Step — Groundwork Command Center
# ───────────────────────────────────────────────────────────────
# Objetivo: evitar deploys desnecessários do Vercel quando o
# commit modifica apenas arquivos de dados (JSON, XLSX) gerados
# pelo workflow automático gwms-sync.yml que roda a cada 10min.
#
# Exit codes (contrato do Vercel):
#   exit 0 → NÃO fazer deploy (skip)
#   exit 1 → FAZER deploy (proceed)
#
# Regra: se o diff contém SOMENTE arquivos .json / .xlsx → skip
#        caso contrário → deploy
#
# Referência: https://vercel.com/docs/projects/overview#ignored-build-step
# ───────────────────────────────────────────────────────────────

set -eo pipefail

echo "🔍 Vercel ignore-build check"
echo "  branch: ${VERCEL_GIT_COMMIT_REF:-unknown}"
echo "  commit: ${VERCEL_GIT_COMMIT_SHA:-unknown}"

# Lista de arquivos alterados desde o ÚLTIMO commit DEPLOYADO (não desde HEAD^).
# Motivo: workflow gwms-sync.yml empurra commits .json a cada 10min. Se compararmos
# só HEAD vs HEAD^, commits de código ficam "enterrados" sob sync commits e nunca
# disparam deploy. VERCEL_GIT_PREVIOUS_SHA aponta para o último commit que foi
# realmente deployado — comparar contra ele garante que toda mudança de código
# acumulada desde o último deploy seja detectada.
BASE="${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}"
echo "  comparando contra: $BASE"

if ! CHANGED=$(git diff --name-only "$BASE" HEAD 2>/dev/null); then
  echo "⚠️  Sem histórico anterior ou SHA inválido — fazendo deploy por segurança"
  exit 1
fi

if [ -z "$CHANGED" ]; then
  echo "⚠️  Nenhum arquivo detectado no diff — fazendo deploy por segurança"
  exit 1
fi

echo "📝 Arquivos alterados neste commit:"
echo "$CHANGED" | sed 's/^/    /'

# Filtra: quais arquivos NÃO são dados (.json/.xlsx)
# Qualquer coisa além disso força o deploy.
CODE_FILES=$(echo "$CHANGED" | grep -vE '\.(json|xlsx)$' || true)

if [ -z "$CODE_FILES" ]; then
  echo "🟢 Apenas arquivos de dados (.json/.xlsx) mudaram — PULANDO deploy"
  echo "   (economia de cota: Vercel Hobby tem limite de 100 deploys/dia)"
  exit 0
fi

echo "🔵 Arquivos de código alterados — FAZENDO deploy:"
echo "$CODE_FILES" | sed 's/^/    /'
exit 1
