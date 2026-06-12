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

1. **Segurança de dados:** os 4 endpoints `/api/*` já foram fechados (PR #27/#28). Resta o
   que pesa: os **dois repos ainda PÚBLICOS** (proxy+token prontos, falta privar) e as
   senhas "123456".
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
| Endpoints `/api/*` abertos (achado nº 1 da auditoria) | ✅ Fechados — guard + proxy (PR #27/#28): acesso anônimo → 403 |
| **Sync ~2 dias parado / dependia de cutucão manual** | ✅ **Reconstruído (12/06)** — Cloudflare Worker (relógio 2min) + Watchdog por frescor + `/api/health` + UptimeRobot. Não depende mais da máquina do Fabio |
| Telefones pessoais no git (`equipe-ssg.md`) | ✅ Removidos do versionamento; token de dispatch rotacionado |
| Repos `ssg-dashboard` e `ssg-dashboard-data` privados? | ⚠️ **Confirmado: ambos PÚBLICOS** (via API GitHub). Proxy+token prontos; falta privar — repo de dados = grátis, repo de código tem custo de Actions |
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

## O sistema de ponta a ponta (reconstruído em 12/06)

```
[Cloudflare Worker · cron 2min] ──(PAT)──► workflow_dispatch
        │
        ▼
GitHub Actions (gwms-sync · só executor) ──► repo ssg-dashboard-data ──► /api/data (proxy+token) ──► Painel
        ▲                                                                          │
        └─ Watchdog (schedule) · lê generated_at do JSON · re-dispara via PAT ─────┘   (rede de segurança)

UptimeRobot ── ping /api/health ── e-mail se o dado passar de 15min   (alerta externo, independe do painel)
```

**Por que reconstruiu (12/06):** o sync ficou ~2 dias parado. Diagnóstico em 3 camadas:
1. **`schedule` do GitHub é estrangulado** em repo público — rodava a cada ~2-3h, não a cada 5-15min.
2. **cron-job.org (o gatilho real) morreu** — ponto único externo, fora do controle.
3. **Auto-cura do Watchdog nunca funcionou:** disparava com `GITHUB_TOKEN`, e o GitHub
   **suprime** workflow disparado por esse token (proteção anti-loop). Corrigido pra usar PAT.

Elos e risco, agora:

- **Cloudflare Worker (free):** relógio confiável, cron a cada 2min, PAT em secret criptografado.
  Substituiu o cron-job.org. **Não depende da máquina do Fabio.** (PR `claude/sync-resiliente`)
- **GitHub Actions:** só executor (disparado por fora). O `schedule` nativo fica como 3º backup.
- **Watchdog:** rede de segurança — decide por **frescor do dado** (`generated_at`), não por
  sucesso de run (runs manuais não mascaram mais). Dispara via PAT.
- **/api/health + UptimeRobot:** observabilidade independente — alerta por e-mail mesmo sem
  ninguém com o painel aberto. Acabou a cegueira de 2 dias.
- **Token (PAT):** fine-grained, menor privilégio (Actions: write só no `ssg-dashboard`),
  expira em 1 ano, rotacionado em 12/06. É o único ponto único sistêmico — o UptimeRobot
  avisa se ele expirar.
- **Vercel:** deployment protection é a única segurança real do painel (login interno é cosmético).

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
| 5 | ✅ Relógio de sync confiável — FEITO 12/06: Cloudflare Worker (cron 2min via PAT) substitui o cron-job.org + Watchdog por frescor + UptimeRobot. Sem máquina local, sem ponto único externo | — | Sync autônomo | Concluído |
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
