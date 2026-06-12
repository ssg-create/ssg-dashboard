// ════════════════════════════════════════════════════════════
// Cloudflare Worker — RELÓGIO do GWMS Sync (12/06/2026)
//
// Por que existe: o `schedule` do GitHub Actions é best-effort e atrasa
// horas em repo público. O cron da Cloudflare é confiável. Este worker
// dispara o workflow_dispatch do GitHub a cada 2 min (ver wrangler.toml),
// usando um PAT guardado como SECRET criptografado do worker
// (`wrangler secret put GH_DISPATCH_PAT` ou pela dashboard).
//
// O PAT precisa de: Actions: write no repo ssg-create/ssg-dashboard.
// Custo: Cloudflare Workers free (cron + 100k req/dia; uso ~720/dia). Zero.
// ════════════════════════════════════════════════════════════

const REPO = 'ssg-create/ssg-dashboard';
const WORKFLOW = 'gwms-sync.yml';

async function dispatch(env) {
  return fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.GH_DISPATCH_PAT}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'gw-sync-cron',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ ref: 'main' }),
    }
  );
}

export default {
  // Disparo automático pelo cron trigger (wrangler.toml).
  async scheduled(event, env, ctx) {
    ctx.waitUntil(dispatch(env));
  },
  // GET na URL do worker = teste manual (dispara e mostra o resultado).
  async fetch(req, env) {
    if (!env.GH_DISPATCH_PAT) {
      return new Response('ERRO: secret GH_DISPATCH_PAT nao configurado.', { status: 500 });
    }
    const r = await dispatch(env);
    const ok = r.status === 204;
    const body = ok ? 'OK — sync disparado (204)' : `Falhou: HTTP ${r.status}\n${await r.text()}`;
    return new Response(body, {
      status: ok ? 200 : 502,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  },
};
