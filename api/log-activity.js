// GW Command Center — Log de atividade no Google Sheets
// Registra: quem abriu, filtrou fila/cliente, exportou PDF

import crypto from 'crypto';

const SHEET_ID    = '1-S8RlcMWPk0b_NqNU5__RQlqg7TI63Wnm2HfpmqCM_8';
const SHEET_RANGE = 'Dashboard!A:D';

async function getGoogleToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body    = Buffer.from(JSON.stringify({
    iss:   sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud:   'https://oauth2.googleapis.com/token',
    exp:   now + 3600,
    iat:   now,
  })).toString('base64url');
  const unsigned = `${header}.${body}`;

  const sign = crypto.createSign('SHA256');
  sign.update(unsigned);
  const sig = sign.sign(sa.private_key, 'base64url');
  const jwt = `${unsigned}.${sig}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token: ' + JSON.stringify(data));
  return data.access_token;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Aceita GET e POST
  let atendente, evento, detalhe;
  if (req.method === 'POST') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      ({ atendente, evento, detalhe } = body);
    } catch (_) {
      ({ atendente, evento, detalhe } = req.query);
    }
  } else {
    ({ atendente, evento, detalhe } = req.query);
  }

  // Sem credenciais → responde OK silencioso (não quebra o dashboard)
  if (!process.env.GOOGLE_SERVICE_ACCOUNT) {
    return res.status(200).json({ ok: true });
  }

  try {
    const sa    = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const token = await getGoogleToken(sa);
    const row   = [
      new Date().toISOString(),   // A: timestamp
      atendente || 'anônimo',     // B: quem usou
      evento    || '',            // C: evento (abriu / filtrou_fila / filtrou_cliente / exportou_pdf)
      detalhe   || '',            // D: detalhe (qual fila, qual cliente)
    ];

    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(SHEET_RANGE)}:append?valueInputOption=USER_ENTERED`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [row] }),
      }
    );

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[log-activity]', e.message);
    return res.status(200).json({ ok: true }); // silencioso — não bloqueia dashboard
  }
}
