# Análise Geral do Command Center — 12/06/2026

Visão de sistema completo: código + dados + processo + operação. Complementa a
`AUDITORIA_2026-06-10.md` (estática) com o que mudou desde então e com as dimensões
que ela não cobriu: pipeline ponta a ponta, processo de publicação e dependências de pessoa.
Dono: Fabio Tavares.

## Resumo em 30 segundos

O painel está **vivo e evoluindo rápido** — só hoje: latência da triagem caiu de ~10min
pra ~2–5min, a sugestão de squad virou um motor que aprende do histórico (85% de acerto
medido), a cobrança ganhou memória e escalonamento, a pilha do atendente parou de zerar
(identidade auto-curável) e nasceu a **análise automática por playbook**. A lógica de negócio é sólida.

Os 3 riscos que importam **não são de funcionalidade**:

1. **Segurança de dados (urgente, parado há 2 dias):** os 4 endpoints `/api/*` continuam
   abertos pra internet — confirmei hoje no código. Dado financeiro de contrato BH de
   cliente sai pra qualquer um com a URL.
2. **Processo depende de 1 pessoa:** só o Fabio edita, publica e cobra. Se o Fabio parar
   uma semana, o painel congela (bus factor = 1).
3. **Fundação:** monólito de 30,5 mil linhas / 2 MB, ES5 puro, 289 onclick inline.
   Não quebra hoje; encarece cada evolução.

## O que mudou desde a auditoria de 10/06

| Item | Status |
|---|---|
| Latência do dado da triagem (~10min) | ✅ Resolvido — sync 2min + ordem de publicação + textos honestos |
| Sugestão de squad por palavras soltas | ✅ Substituída por motor de evidências (conteúdo aprendido 45% + histórico cliente 35% + contrato 20%), backtest 85% vs 57% do método antigo |
| Palpite errado na janela de boot (caso TOTVS) | ✅ Corrigido — e-mails fora do aprendizado, sem opinião sem base carregada |
| Cobrança "fica por isso mesmo" | ✅ Bloco RESPONDER HOJE nominal + memória de reincidência (⛔ Nª cobrança) + escalonamento pro gestor |
| Metalnox com contrato SSG fantasma | ✅ Marcada cancelada (segue só BH) |
| Gitlinks quebrados no repo (.claude/worktrees) | ✅ Limpos |
| Pilha do atendente zerava (caso Robert) — identidade presa em nome antigo do OTRS | ✅ Resolvido — auto-cura em `_tryAutoIdentify` (PR #21); vale pra todos os atendentes |
| Atendente real aparecia como "PILOTO" (rótulo de teste) | ✅ Resolvido — badge só no modo espelho (PR #21) |
| Análise inicial do chamado dependia da cabeça do analista | ✅ Novo — análise automática por playbook no card/detalhe (PR #29); 1ª entrada: variação cambial / FINA350 |
| Similares varria o histórico (~4,5k) por card e a cada re-render | ✅ Resolvido — índice de candidatos + memoização (PR #30), sem mudar o match |
| **Endpoints `/api/*` abertos (achado nº 1 da auditoria)** | ❌ **Sem mudança — segue crítico** |
| Repo `ssg-dashboard-data` privado? | ❓ **Ainda não confirmado** (1 minuto de checagem) |
| Senhas "123456" | ❌ Sem mudança |
| Monólito 30k linhas | ❌ Sem mudança (cresceu ~700 linhas em 2 dias) |

## Análise automática por playbook (novo — 12/06)

Primeiro tijolo de uma camada que entrega ao atendente um **plano de ação pronto** no
chamado — hipótese, checklist, perguntas ao cliente, similares e link TDN/gwoogle — montado
por **regra, sem LLM** (instantâneo, custo zero, não inventa especificidade técnica como nº
de LP ou nome de tabela).

- **Onde mora:** const `PLAYBOOKS` no `index.html` (mesmo padrão de `SLA_OTRS_RULES`),
  `_matchPlaybook` (pontuação de gatilhos no assunto), `renderAnalisePlaybook` no modal
  `tkd-overlay` e tag "⚡ ANÁLISE" no card da pilha. Reusa os similares e a busca TOTVS (gwoogle).
- **Como cresce:** cada padrão novo = mais um `{}` em `PLAYBOOKS`, curado pela equipe.
  Sem playbook, o card cai no fallback (similares), sem ruído. Cobertura cresce com o uso.
- **1ª entrada:** variação cambial não contabiliza por moeda (FINA350).
- **Perf (PR #30):** os similares deixaram de varrer o histórico inteiro por card — índice
  de candidatos resolvidos (1× por sync) + contagem memoizada. Tirou o delay de entrada.

Alinhado à tese da casa: determinístico antes de LLM, custo zero, fecha o ciclo (acelera a
primeira resposta e reduz a dependência do conhecimento do sênior — ataca o bus factor pela
via do conhecimento reutilizável).

## O sistema de ponta a ponta (onde a cadeia é frágil)

```
OTRS/Znuny ──► cron-job.org (2min) ──► GitHub Actions (gwms-sync) ──► repo ssg-dashboard-data
                                                                            │
Apontamento ──► /api/banco-horas ──────────────► Vercel (gw-command) ◄─── rewrites JSON
                                                       │
                                              Painel (navegador)
```

Elos e risco de cada um:

- **cron-job.org (gratuito, conta pessoal):** é o coração do tempo real. Se a conta cair,
  o backup é o schedule do GitHub (atrasa 1–2h em pico). Watchdog cobre, mas o serviço é
  um ponto único fora do seu controle. *Mitigação barata: segundo trigger (outro serviço
  de cron gratuito) apontando pro mesmo workflow_dispatch.*
- **GitHub Actions:** runs de 2–5min. Hoje com concurrency e cache — saudável.
- **Repo de dados no GitHub:** se for público, é vazamento de dado operacional de cliente
  — indexável. **Checar visibilidade é a ação de 1 minuto mais importante desta análise.**
- **Vercel:** deployment protection é a única segurança real do painel (login interno é
  cosmético, como a auditoria já disse). Confirmar que está ligada.
- **/api/banco-horas e irmãos:** porta dos fundos aberta — entrega o dado sem passar por
  nenhuma das proteções acima.

## A dimensão que nenhuma auditoria olhou: processo e pessoas

**Bus factor = 1.** Só o Fabio: edita código (via Cowork), publica (terminal + merge manual),
mantém a régua BH (`BH_BASELINE` portal→manual), cobra o time e calibra a triagem. Riscos
práticos: férias/doença param a evolução; conhecimento das regras (SLA, régua BH, motor de
triagem) não está documentado fora do código e do CLAUDE.md.

**Atrito de publicação.** O ciclo hoje é: Cowork edita → Fabio cola comando no terminal →
abre PR no navegador → merge manual. Funciona, mas cada melhoria custa 4 passos manuais
seus. *Caminho: conectar o GitHub no Cowork (Configurações → Conectores) — o ciclo vira
"aprovar PR", um clique.*

**Dado manual embutido.** Snapshot BH (Jan→Mai/26) e baseline são mantidos na mão dentro
do HTML. O endpoint de histórico mensal do Adriano (já no roadmap) elimina essa manutenção.

**Falta feedback loop na triagem.** O motor sugere, mas o painel não mede se o triador
aceitou a sugestão. Registrar "sugerido X, enviado Y" daria a taxa de acerto real em
produção (não só backtest) e diria sozinho onde calibrar. É 1 localStorage + 1 bloco no
card — sem LLM, sem custo, alinhado ao padrão da casa.

## Prioridades (impacto × esforço)

| # | Ação | Esforço | Impacto | Quando |
|---|---|---|---|---|
| 1 | ⏸️ Repo `ssg-dashboard-data` privado — **PENDENTE (12/06):** proxy com token já está pronto em produção (`api/data.js`); falta só `GH_DATA_TOKEN` no Vercel + Make private. Travou na confusão de contas GitHub (token deve sair da conta `ssg-create`, ou reaproveitar o token do cron-job.org). Vercel Protection confirmada DESLIGADA em produção | 15 min | Evita vazamento | Retomar com calma |
| 2 | ✅ Fechar os 4 endpoints — FEITO 12/06 (`api/_guard.js`, PR #27) + JSONs atrás de proxy (PR #28): acesso anônimo → 403 | — | Porta fechada | Concluído |
| 3 | Trocar senhas "123456" por senhas únicas | 1h | Higiene básica | Esta semana |
| 4 | Medir aceite da sugestão de triagem (feedback loop) | ~2h | Calibra o motor com dado real | Próxima sprint |
| 5 | Segundo trigger de cron (redundância do cron-job.org) | 1h | Tira ponto único externo | Próxima sprint |
| 6 | Plugar endpoint histórico BH do Adriano | médio | Mata manutenção manual | Quando o endpoint existir |
| 7 | Externalizar dados embutidos restantes (~130 KB) | médio | Performance + passo 1 da quebra do monólito | Fundo |
| 8 | Quebra faseada do monólito (dados → estilos → JS por aba) | alto | Destrava evolução e revisão | Fundo, faseado |
| 9 | Documentar regras de negócio fora do código (1 página por regra: SLA, régua BH, motor triagem, cobrança) | baixo/contínuo | Reduz bus factor | Contínuo |

## O que eu NÃO faria agora

SSO/OAuth (Vercel Protection resolve o hoje), reescrita em framework (risco alto, ganho
incerto pro tamanho do time), LLM na triagem (o motor determinístico está em 85% e é
grátis/instantâneo — esgotar calibração primeiro, como manda a regra da casa) e
virtualização de tabelas (volume atual não justifica).

## Leitura estratégica

O Command Center deixou de ser "dashboard" — é o **sistema operacional da operação**:
triagem, cobrança, contratos, risco e cliente no mesmo lugar, com inteligência
determinística e custo zero de IA. O valor agora cresce menos por **mais abas** e mais por
**fechar o ciclo**: medir o que as sugestões acertam, automatizar o que hoje é manual
(publicação, baseline BH) e proteger o dado que o painel já concentra. Em uma frase:
*menos features novas, mais confiabilidade, segurança e autonomia do sistema.*
