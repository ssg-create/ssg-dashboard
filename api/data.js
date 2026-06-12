// ════════════════════════════════════════════════════════════
// Proxy de dados do painel — 12/06/2026
//
// Problema: os 8 JSONs operacionais (tickets, histórico, clientes…) eram
// servidos por rewrite direto pro raw.githubusercontent — acessíveis por
// qualquer pessoa com a URL, sem login (e o repo precisava ser público).
//
// Agora: o rewrite aponta pra cá. Este proxy (1) aplica o mesmo guardião
// dos outros endpoints (só o painel consegue chamar) e (2) busca no GitHub
// com token (env GH_DATA_TOKEN) — o que permite tornar o repo PRIVADO sem
// quebrar nada.
//
// Ordem de ativação segura (zero downtime):
//   1. merge deste PR → painel continua funcionando (repo ainda público,
//      proxy busca sem token)
//   2. criar token fine-grained no GitHub (só leitura de conteúdo do repo
//      ssg-dashboard-data) e salvar como GH_DATA_TOKEN no Vercel
//   3. tornar o repo privado → proxy passa a usar o token, painel nem nota
// ════════════════════════════════════════════════════════════

import { guard } from './_guard.js';

const REPO_RAW = 'https://raw.githubusercontent.com/ssg-create/ssg-dashboard-data/main/';
const FILES = new Set([
  'historico_completo.json',
  'tickets_ativos.json',
  'utilizacao.json',
  'gwms-insights.json',
  'aios-insights.json',
  'silenciosos.json',
  'triagem.json',
  'reaberturas.json'
]);

export default async function handler(req, res) {
  if (!guard(req, res, 'GET, OPTIONS')) return;

  const file = String(req.query.file || '');
  if (!FILES.has(file)) {
    return res.status(400).json({ error: 'arquivo inválido' });
  }

  const token = process.env.GH_DATA_TOKEN;
  const headers = token ? { Authorization: 'Bearer ' + token } : {};

  try {
    const upstream = await fetch(REPO_RAW + file, { headers });
    if (!upstream.ok) {
      // 404 com repo privado e sem token = falta configurar GH_DATA_TOKEN
      return res.status(upstream.status).json({
        error: 'upstream ' + upstream.status,
        hint: upstream.status === 404 && !token
          ? 'repo privado sem GH_DATA_TOKEN configurado no Vercel?'
          : undefined
      });
    }
    const body = await upstream.text();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // Cache curto na CDN — o painel já fura cache com ?v=, isso protege o GitHub
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    return res.status(200).send(body);
  } catch (e) {
    return res.status(502).json({ error: 'falha ao buscar dado', detail: String(e && e.message || e) });
  }
}
