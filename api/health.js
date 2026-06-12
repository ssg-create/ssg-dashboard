// ════════════════════════════════════════════════════════════
// /api/health — saúde do sync (12/06/2026)
//
// Retorna 200 se o dado operacional está fresco, 503 se está velho.
// Serve pra um monitor externo (ex.: UptimeRobot) alertar por e-mail/SMS
// QUANDO NINGUÉM está com o painel aberto — foi a cegueira que deixou o
// sync 2 dias parado sem aviso.
//
// SEM guard de origem de propósito: precisa ser chamável por um monitor
// externo. Não vaza dado — expõe só a IDADE do sync (um timestamp), nada
// de conteúdo de cliente.
// ════════════════════════════════════════════════════════════

const REPO_RAW = 'https://raw.githubusercontent.com/ssg-create/ssg-dashboard-data/main/';
const MAX_AGE_MIN = 15; // limite de frescor aceitável (ajuste se quiser)

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Access-Control-Allow-Origin', '*'); // só um número de idade, ok ser público

  const token = process.env.GH_DATA_TOKEN;
  const headers = token ? { Authorization: 'Bearer ' + token } : {};

  try {
    const r = await fetch(REPO_RAW + 'tickets_ativos.json', { headers });
    if (!r.ok) {
      return res.status(503).json({ ok: false, error: 'upstream ' + r.status });
    }
    const j = await r.json();
    const ageMin = Math.round((Date.now() / 1000 - (j.generated_at || 0)) / 60);
    const ok = ageMin >= 0 && ageMin <= MAX_AGE_MIN;
    return res.status(ok ? 200 : 503).json({
      ok,
      age_min: ageMin,
      max_age_min: MAX_AGE_MIN,
      generated_at_iso: j.generated_at_iso || null,
    });
  } catch (e) {
    return res.status(503).json({ ok: false, error: String((e && e.message) || e) });
  }
}
