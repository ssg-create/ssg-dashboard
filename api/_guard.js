// ════════════════════════════════════════════════════════════
// Guardião compartilhado dos endpoints /api/* — 12/06/2026
//
// Problema que resolve (auditoria 10/06, achado nº 1): os endpoints
// respondiam com CORS * e sem nenhuma checagem de quem chama — dado de
// contrato BH de cliente saía pra qualquer pessoa com a URL.
//
// Regra de decisão (zero impacto pra quem usa o painel):
//   1. Origin/Referer presentes e de host NÃO permitido  → 403 (bloqueia
//      outros sites chamando via navegador)
//   2. Origin/Referer presentes e permitidos             → libera
//      (permitidos: o próprio host do deploy — cobre produção E previews —
//       e o domínio canônico gw-command.vercel.app)
//   3. Nenhum dos dois presente (curl, scripts, bots)    → só libera se o
//      navegador declarar same-origin via Sec-Fetch-Site; senão 403.
//      (Navegadores antigos sem Sec-Fetch-* mandam Referer em chamada
//       same-origin, então caem na regra 2 — ninguém real fica de fora.)
//
// Limite honesto: isso fecha o acesso casual/externo (o risco real
// apontado). Quem TEM acesso legítimo ao painel consegue chamar a API —
// segurança de identidade continua sendo o login do Vercel na frente.
// ════════════════════════════════════════════════════════════

const CANONICAL_HOST = 'gw-command.vercel.app';

function hostOf(url) {
  try { return new URL(url).host; } catch (e) { return null; }
}

export function guard(req, res, methods) {
  const deployHost = req.headers.host || '';
  const allowed = new Set([deployHost, CANONICAL_HOST]);

  const origin = req.headers.origin || null;
  const referer = req.headers.referer || null;
  const okOrigin = origin ? allowed.has(hostOf(origin)) : null;
  const okReferer = referer ? allowed.has(hostOf(referer)) : null;

  let ok;
  if (okOrigin === false || okReferer === false) {
    ok = false;                      // veio de outro site → bloqueia
  } else if (okOrigin || okReferer) {
    ok = true;                       // painel (produção ou preview)
  } else {
    // Sem Origin e sem Referer: só navegador same-origin declarado
    ok = req.headers['sec-fetch-site'] === 'same-origin';
  }

  // CORS: só ecoa origem PERMITIDA (nunca mais '*')
  if (ok && origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', methods || 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(ok ? 204 : 403).end();
    return false; // preflight nunca segue pro handler
  }
  if (!ok) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}
