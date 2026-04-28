// GW Consult — Proxy seguro para Zendesk API da TOTVS
// Credenciais ficam em variáveis de ambiente Vercel (nunca expostas no browser)

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { query, per_page = 10, page = 1, product = '' } = req.query;

  if (!query || query.trim().length < 2) {
    return res.status(400).json({ error: 'query obrigatório (mínimo 2 caracteres)' });
  }

  const email = process.env.TOTVS_EMAIL;
  const pass  = process.env.TOTVS_PASS;

  if (!email || !pass) {
    return res.status(500).json({ error: 'Credenciais TOTVS não configuradas' });
  }

  // Monta query enriquecida com produto se informado
  const fullQuery = product ? `${product} ${query}` : query;

  const auth = Buffer.from(`${email}:${pass}`).toString('base64');

  const url = new URL('https://totvscst.zendesk.com/api/v2/help_center/articles/search.json');
  url.searchParams.set('query',    fullQuery.trim());
  url.searchParams.set('locale',   'pt-br');
  url.searchParams.set('per_page', String(per_page));
  url.searchParams.set('page',     String(page));

  try {
    const upstream = await fetch(url.toString(), {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type':  'application/json',
      },
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `Zendesk retornou ${upstream.status}` });
    }

    const data = await upstream.json();

    // Retorna apenas os campos necessários (não expõe dados internos)
    const results = (data.results || []).map(a => ({
      id:         a.id,
      title:      a.title,
      snippet:    a.snippet || '',
      url:        a.html_url,
      updated_at: a.updated_at,
      labels:     a.label_names || [],
    }));

    return res.status(200).json({
      count:      data.count      || 0,
      page:       data.page       || 1,
      page_count: data.page_count || 1,
      results,
    });

  } catch (err) {
    return res.status(500).json({ error: 'Erro ao consultar TOTVS: ' + err.message });
  }
}
