// ════════════════════════════════════════════════════════════
// Proxy seguro para a API do apontamento (apontamentos.groundwork.com.br)
//   - Token guardado em env var (APONTAMENTO_TOKEN) — não exposto ao client
//   - Cache CDN: 5min (s-maxage=300) com stale-while-revalidate de 10min
//   - Transforma a resposta nativa do apontamento no formato BH_CONTRATOS
//     consumido pelo painel (mesmo schema do snapshot embutido)
//
// Opções de query:
//   /api/banco-horas              → todos os contratos BH (default)
//   /api/banco-horas?raw=1        → resposta original do apontamento
//   /api/banco-horas?include=all  → inclui também expirados/inativos
//
// Fonte de dados: Report Tasks OS · Format=json
// Unidades:
//   __aptmts.minutes_efective vem em SEGUNDOS (apesar do nome).
//   Convertemos com /3600 → horas. minutes (sem _efective) é o consumo
//   bruto sem fator hora; minutes_efective é o consumo com fator aplicado
//   (= o que efetivamente conta como horas cobradas/descontadas do pool).
// ════════════════════════════════════════════════════════════
import { guard } from './_guard.js';

export default async function handler(req, res) {
  if (!guard(req, res, 'GET, OPTIONS')) return;

  const TOKEN = process.env.APONTAMENTO_TOKEN;
  if (!TOKEN) {
    return res.status(500).json({ success: false, error: 'APONTAMENTO_TOKEN não configurado no Vercel' });
  }

  const includeAll = req.query.include === 'all';
  const wantRaw = req.query.raw === '1';

  try {
    const body = new URLSearchParams({
      'X-Token': TOKEN,
      'Option': 'Report Tasks OS',
      'Format': 'json'
    });
    const upstream = await fetch('https://apontamentos.groundwork.com.br/api.php', {
      method: 'POST',
      body: body.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    if (!upstream.ok) {
      return res.status(upstream.status).json({ success: false, error: `apontamento retornou HTTP ${upstream.status}` });
    }
    const data = await upstream.json();
    if (!data || data.success !== true) {
      return res.status(502).json({ success: false, error: 'apontamento retornou sucesso=false', upstream: data });
    }
    if (wantRaw) {
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
      return res.status(200).json(data);
    }

    // Transformação: data.{cli_id} → contratos[] no formato BH_CONTRATOS
    const contratos = [];
    const nowTs = Date.now() / 1000;
    // Início do mês atual (UTC) — pra detectar "ficou inativo no mês corrente"
    const _now = new Date();
    const inicioMesAtualTs = Date.UTC(_now.getUTCFullYear(), _now.getUTCMonth(), 1) / 1000;
    const clientes = data.data || {};
    Object.keys(clientes).forEach(function (cliId) {
      const cli = clientes[cliId];
      const projs = cli.__projects;
      if (!projs || Array.isArray(projs)) return; // lista vazia
      Object.keys(projs).forEach(function (projId) {
        const proj = projs[projId];
        const nome = (proj.name || '').toUpperCase();
        const isBH = nome.indexOf('BANCO DE HORAS') !== -1 || nome.startsWith('PBH') || nome.startsWith('PHA');
        if (!isBH) return;
        const tasks = proj.__tasksOS;
        if (!tasks || typeof tasks !== 'object') return;
        Object.keys(tasks).forEach(function (tkId) {
          const tk = tasks[tkId];
          if (tk.cancelled) return;
          const poolH = Number(tk.total_hours) || 0;
          if (poolH <= 0) return;
          // minutes_efective está em SEGUNDOS (apesar do nome) — confirmado por validação
          // contra os snapshots Estouro BH (Jan→Mai 2026): bate em 8 de 8 amostras.
          const aptSec = (tk.__aptmts && tk.__aptmts.minutes_efective) || 0;
          const aptBrutoSec = (tk.__aptmts && tk.__aptmts.minutes) || 0;
          const aptH = aptSec / 3600;
          const aptBrutoH = aptBrutoSec / 3600;
          const dFrom = tk.date_from || 0;
          const dTo = tk.date_to || 0;
          const emVigencia = dFrom > 0 && dTo > 0 && dFrom < nowTs && nowTs < dTo;
          const expirado = dTo > 0 && nowTs > dTo;
          const inativoFlag = !tk.active;
          // "Inativo recente" = ficou inativo (expirou ou foi desativado) DENTRO do mês corrente
          // Critério: date_to está entre o início do mês atual e hoje
          const expirouNoMesAtual = expirado && dTo >= inicioMesAtualTs;
          // Também considera "desativado recente": active=0 mas date_to ainda no futuro,
          // assumindo que desativação aconteceu no mês corrente (sem updated_at na API).
          const desativadoNoMesAtual = inativoFlag && !expirado && dTo >= inicioMesAtualTs;
          const inativoRecente = expirouNoMesAtual || desativadoNoMesAtual;
          let status = 'ativo';
          if (expirouNoMesAtual) status = 'inativo_recente';
          else if (desativadoNoMesAtual) status = 'inativo_recente';
          else if (expirado) status = 'expirado';
          else if (inativoFlag) status = 'inativo';
          // Filtro padrão: em vigência + ativo OU inativo no mês corrente.
          // ?include=all → traz tudo (incluindo expirados antigos / inativos antigos)
          if (!includeAll && !emVigencia && !inativoRecente) return;
          const livreH = poolH - aptH;
          const pctConsumido = poolH ? Math.round((aptH / poolH) * 1000) / 10 : 0;
          // Estimativa de meses do contrato (date_to - date_from em meses)
          const mesesContrato = (dFrom && dTo) ? Math.max(1, Math.round((dTo - dFrom) / 86400 / 30)) : 12;
          contratos.push({
            cli_id: cliId,
            cli_alias: cli.alias,
            cli_name: cli.name,
            cli_code: cli.code,
            proj_id: projId,
            proj_name: proj.name,
            proj_active: proj.active === 1,
            tarefa_id: tkId,
            tarefa_name: tk.name,
            inicio: dFrom ? new Date(dFrom * 1000).toISOString().slice(0, 10) : '',
            fim: dTo ? new Date(dTo * 1000).toISOString().slice(0, 10) : '',
            meses: mesesContrato,
            pool_h: poolH,
            apto_h: Math.round(aptH * 100) / 100,
            apto_bruto_h: Math.round(aptBrutoH * 100) / 100,
            livre_h: Math.round(livreH * 100) / 100,
            pct_consumido: pctConsumido,
            sale_value: parseFloat(tk.sale_value) || null,
            sale_margin: parseFloat(tk.sale_margin) || null,
            factor_hour_active: !!tk.factor_hour_active,
            overtime_lock: !!tk.overtime_lock,
            recurrent: !!tk.recurrent,
            active: !!tk.active,
            em_vigencia: emVigencia,
            inativo_recente: inativoRecente,
            status: status
          });
        });
      });
    });

    // Ordenar por cliente alias
    contratos.sort(function (a, b) {
      return (a.cli_alias || '').localeCompare(b.cli_alias || '');
    });

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({
      success: true,
      snapshot_ts: new Date().toISOString(),
      source: 'apontamentos.groundwork.com.br',
      total: contratos.length,
      contratos: contratos
    });
  } catch (e) {
    console.error('banco-horas proxy error:', e);
    return res.status(500).json({ success: false, error: e.message });
  }
}
