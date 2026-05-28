// Extract Resolução — Gemini Flash estruturando resolução de chamado OTRS
// Recebe: { num, assunto, texto_cru }
// Retorna: { problema, causa, solucao, tempo_min, tags, confianca }
//
// Custo: Gemini Flash free tier (1M tokens/dia, 15 RPM)
// Risco: zero. Se Gemini cair, função retorna erro 503 e o caller
// (Command Center) faz fallback pro texto cru.

const GEMINI_MODEL = 'gemini-2.0-flash-lite';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const SYSTEM_PROMPT = `Você é analista técnico sênior da Groundwork — empresa parceira TOTVS que atende com Protheus, Datasul, DBA, infraestrutura.

Sua tarefa: ler o texto bruto de resolução de um chamado e extrair estrutura técnica útil pra outros analistas reaproveitarem.

REGRAS DURAS:
1. IGNORE: assinatura de e-mail (nome, telefone, cargo), aviso legal LGPD, "Atenciosamente", "Prezado", saudações, referências numeradas [1] [2], blocos em inglês de boilerplate.
2. EXTRAIA o que importa tecnicamente. Se o texto não tem solução técnica concreta (ex: só "encaminhado para análise"), retorne confianca="baixa" e marque solucao="—".
3. Use linguagem direta e curta. Não invente passos que não estão no texto.
4. Tags em UPPERCASE, separadas por categorias técnicas reais Groundwork.

FORMATO de saída — SOMENTE JSON válido, sem markdown, sem comentário:

{
  "problema": "1 linha descrevendo o que estava acontecendo do ponto de vista do cliente",
  "causa": "1-2 frases com a causa raiz técnica identificada (ou 'não documentada' se texto não cita)",
  "solucao": "passos numerados ou descrição direta do que foi feito pra resolver. Se for genérico tipo 'analisado', use '—'",
  "tempo_min": número estimado em minutos (null se não der pra inferir),
  "tags": ["PROTHEUS", "SIGAFIN", "BOLETO"] (máx 5 tags técnicas relevantes),
  "confianca": "alta" | "media" | "baixa"
}

confianca:
- alta: texto tem passos técnicos claros e causa documentada
- media: tem solução mas falta contexto de causa, OU vice-versa
- baixa: texto é só boilerplate, não tem conteúdo técnico aproveitável`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'use POST' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY não configurada no Vercel' });
  }

  const { num, assunto, texto_cru } = req.body || {};
  if (!texto_cru || typeof texto_cru !== 'string') {
    return res.status(400).json({ error: 'texto_cru obrigatório (string)' });
  }
  // Trim e sanity check — Gemini rejeita corpos absurdos
  const texto = texto_cru.trim().slice(0, 8000); // 8k chars ≈ 2k tokens
  if (texto.length < 30) {
    return res.status(200).json({
      problema: assunto || '—',
      causa: 'não documentada',
      solucao: '—',
      tempo_min: null,
      tags: [],
      confianca: 'baixa',
      _skipped: 'texto muito curto'
    });
  }

  const userPrompt = `Chamado #${num || 'sem número'}
Assunto: ${assunto || '—'}

Texto bruto da resolução:
---
${texto}
---

Extraia o JSON estruturado.`;

  try {
    const upstream = await fetch(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        generationConfig: {
          temperature: 0.2,            // baixa criatividade — quero extração fiel
          maxOutputTokens: 1024,
          responseMimeType: 'application/json'
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
        ]
      })
    });

    if (!upstream.ok) {
      const errBody = await upstream.text();
      return res.status(upstream.status).json({
        error: `Gemini retornou ${upstream.status}`,
        detail: errBody.slice(0, 500)
      });
    }

    const data = await upstream.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Parse defensivo do JSON
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      // Tenta extrair JSON de markdown se o modelo embrulhou
      const m = rawText.match(/\{[\s\S]*\}/);
      if (m) {
        try { parsed = JSON.parse(m[0]); } catch {}
      }
    }
    if (!parsed) {
      return res.status(502).json({
        error: 'Resposta do Gemini não é JSON válido',
        raw: rawText.slice(0, 500)
      });
    }

    // Garante campos esperados (defensive defaults)
    return res.status(200).json({
      problema:  String(parsed.problema  || assunto || '—'),
      causa:     String(parsed.causa     || 'não documentada'),
      solucao:   String(parsed.solucao   || '—'),
      tempo_min: (typeof parsed.tempo_min === 'number' && parsed.tempo_min > 0) ? parsed.tempo_min : null,
      tags:      Array.isArray(parsed.tags) ? parsed.tags.slice(0, 5).map(String) : [],
      confianca: ['alta','media','baixa'].includes(parsed.confianca) ? parsed.confianca : 'media',
      _model: GEMINI_MODEL,
      _usage: data?.usageMetadata || null
    });

  } catch (err) {
    return res.status(500).json({ error: 'Falha ao chamar Gemini: ' + (err.message || 'desconhecido') });
  }
}
