// Debug endpoint — lista modelos Gemini disponíveis pra esta key
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY ausente' });
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    return res.status(200).json({
      total: data.models?.length || 0,
      models: (data.models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map(m => ({
          name: m.name,
          version: m.version,
          inputTokenLimit: m.inputTokenLimit,
          outputTokenLimit: m.outputTokenLimit
        }))
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
