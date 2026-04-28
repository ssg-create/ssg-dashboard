// GWoogle — Busca corpo completo de artigo Zendesk pelo ID
// Usado pelo botão "Expandir" no gw-consult.html
// Suporta duas fontes: 'cst' (totvscst.zendesk.com) e 'central' (centraldeatendimento.totvs.com)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { id, source = 'cst' } = req.query;
  if (!id || !/^\d+$/.test(id)) {
    return res.status(400).json({ error: 'id inválido' });
  }

  // Fonte determina o domínio Zendesk e se precisa de auth
  let domain, headers;
  if (source === 'central') {
    domain  = 'centraldeatendimento.totvs.com';
    headers = { 'Content-Type': 'application/json' };
  } else {
    // Default: CST com autenticação de agente
    const email = process.env.TOTVS_EMAIL;
    const pass  = process.env.TOTVS_PASS;
    if (!email || !pass) {
      return res.status(500).json({ error: 'Credenciais não configuradas' });
    }
    const auth = Buffer.from(`${email}:${pass}`).toString('base64');
    domain  = 'totvscst.zendesk.com';
    headers = { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' };
  }

  try {
    const upstream = await fetch(
      `https://${domain}/api/v2/help_center/articles/${id}.json`,
      { headers }
    );

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `Zendesk retornou ${upstream.status}` });
    }

    const { article } = await upstream.json();

    return res.status(200).json({
      id:         article.id,
      title:      article.title,
      body:       article.body || '',
      updated_at: article.updated_at,
      url:        article.html_url,
      source:     source,
    });

  } catch (err) {
    return res.status(500).json({ error: 'Erro ao buscar artigo: ' + err.message });
  }
}
