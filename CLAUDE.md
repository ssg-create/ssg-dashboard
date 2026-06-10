# Groundwork Command Center — SSG Operations Center

Painel de gestão operacional da **Groundwork** (MSP B2B de suporte técnico, ~100 atendentes,
~30 clientes). Dono/editor: **Fabio Tavares** (sócio + Diretor de Operações).

🔗 Produção: https://gw-command.vercel.app

## O que é

Dashboard interno **HTML single-file** (`index.html`, ~30k linhas, CSS/JS inline) que cruza:
- **OTRS/Znuny** (tickets de suporte, via GWMS sync)
- **Apontamento** (`apontamento.groundwork.com.br`, contratos Banco de Horas, via API)

Audiência: Fabio (admin) + gestores. Dark theme, notebook 1366–1920px. Não é mobile-first.

## Fluxo de deploy (importante)

```
edita index.html → branch claude/* → PR no GitHub (ssg-create/ssg-dashboard)
→ merge na main → Vercel deploya automático → gw-command.vercel.app
```

- Repo GitHub: **`ssg-create/ssg-dashboard`** (NÃO é o nome da pasta local)
- Deploy: **Vercel**, automático da branch `main`
- Pasta local: `/Users/fabiotavares/projects/command-center`
- Dados vêm de `raw.githubusercontent.com/ssg-create/ssg-dashboard-data/main/*.json`
  (rewrites no `vercel.json`) + `/api/banco-horas` (apontamento)

## Modelo de acesso

- **Fabio**: único que **altera** o código (Cowork/repositório).
- **Rodrigo Cuani, Vinicius Eroico, Weskley, gestores**: **só visualizam** o painel publicado
  (login no Vercel). Não tocam no código.
- Login do painel: mapa `_USERS` no `index.html`. Senha padrão "123456" = hash `_H_PWD_123456`.
  Perfis: `admin`, `gestor`, `gestor_bh` + array `extras` (`bh`, `executivo`, `ssg`).

## Estrutura das abas

- **Operação Interna** (view-op): Dashboard, Alertas, Chamados, Comparativo, Atendentes,
  Clientes, Mapa de Calor, SLA & Tempos, Contratos SSG, Em Espera, Previsão, Backlog,
  Projetos & Melhorias
- **Visão Cliente** (view-cli): Painel, Linha do Tempo, Health Score, SLA Contrato, Status Fila
  + blocos de Contrato BH e SSG
- **Customer Success** (view-cs): Carteira, Conta Detalhada, Riscos, CSAT, Timeline, Matrix
- **Contratos BH** (s-bh): carteira Banco de Horas (régua manual `BH_BASELINE`, heatmap, funil de cobrança)
- **Equipes & Cobrança** (s-eq): carga por fila + mensagem de cobrança por atendente
- **Resumo Executivo**, **IA**, **Ações**

## Regras do Fabio (preservar)

- **Português direto, sem floreio.** Fabio é leigo em código — explicar o "porquê" em linguagem simples.
- **Foco em Banco de Horas e SSG.** INFRA fica de fora do escopo de contratos.
- **NÃO tocar em regras de negócio** sem pedir: SLA OTRS (`SLA_OTRS_RULES`), cobrança,
  `_bhAnaliseTrimestre`, `_isProjetoMelhoria`, `FILA_GESTOR_MAP`, `_USERS`, `ticketInFilter`.
- **Sempre checar o status do sync GWMS no início da sessão** (3 camadas: banner no painel +
  watchdog GitHub Actions `sync-watchdog.yml` + esta regra).
- **Régua BH (classificação de risco):** "Crítico" exige consenso — trimestre estourado sozinho
  vira só "Atenção". Só é Crítico se 3 meses E média do contrato concordarem que o pool zera
  antes do fim (ou fato hard: saldo<0, pct≥100%, vence≤30d).
- **Antes de propor LLM**, esgotar regras determinísticas sobre os dados.

## Padrão de trabalho

- Validar JS antes de subir: extrair `<script>` e rodar `new Function(s)` (0 erros).
- Branch `claude/<tema>` → PR → merge na main → confirmar deploy.
- Cada mudança visual: pedir o Fabio validar no preview/produção.
- Banco de Horas: baseline manual em `BH_BASELINE` (tipo `manual` = validado pelo Fabio;
  tipo `portal` = valor do apontamento a validar). Fabio vai trocando `portal`→`manual`
  conforme confirma cada contrato.
