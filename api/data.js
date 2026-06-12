// ════════════════════════════════════════════════════════════
// Proxy de dados do painel — 12/06/2026 (rev. Contents API)
//
// Serve os 8 JSONs operacionais sem expor o repo direto. Aplica o guardião
// (só o painel chama) e busca no GitHub.
//
// COM token (env GH_DATA_TOKEN): usa a GitHub Contents API com Accept: raw —
//   caminho DOCUMENTADO que funciona pra repo PRIVADO. Limite 5000 req/h (folga).
// SEM token: cai no raw.githubusercontent (repo público, sem rate limit) —
//   fallback pra não quebrar enquanto o token não está configurado.
//
// Ordem de ativação segura (zero downtime):
//   1. merge → painel segue funcionando (repo público, fallback raw)
//   2. criar PAT fine-grained (Contents: Read no ssg-dashboard-data) e salvar
//      como GH_DATA_TOKEN no Vercel → proxy passa a usar a Contents API
//   3. tornar o repo privado → o token lê normal, painel nem nota
// ════════════════════════════════════════════════════════════

import { guard } from './_guard.js';

const OWNER_REPO = 'ssg-create/ssg-dashboard-data';
const BRANCH = 'main';
const RAW = `https://raw.githubusercontent.com/${OWNER_REPO}/${BRANCH}/`;
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

  try {
    let upstream;
    if (token) {
      // Contents API — funciona pra repo privado. Accept: raw devolve o arquivo direto.
      upstream = await fetch(
        `https://api.github.com/repos/${OWNER_REPO}/contents/${encodeURIComponent(file)}?ref=${BRANCH}`,
        {
          headers: {
            'Authorization': 'Bearer ' + token,
            'Accept': 'application/vnd.github.raw',
            'User-Agent': 'gw-command',
            'X-GitHub-Api-Version': '2022-11-28'
          }
        }
      );
    } else {
      // Fallback público (sem token): raw.githubusercontent, sem rate limit.
      upstream = await fetch(RAW + file);
    }

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: 'upstream ' + upstream.status,
        hint: upstream.status === 404 && !token
          ? 'repo privado sem GH_DATA_TOKEN configurado no Vercel?'
          : undefined
      });
    }

    const body = await upstream.text();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // Cache curto na CDN — protege o GitHub do volume de polling do painel.
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    return res.status(200).send(body);
  } catch (e) {
    return res.status(502).json({ error: 'falha ao buscar dado', detail: String((e && e.message) || e) });
  }
}
