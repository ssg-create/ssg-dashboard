# Auditoria do Command Center — 10/06/2026

Auditoria completa do `index.html` (Code Review + Tech Debt + Scalability + Security).
Análise estática, **sem alterar código**. Dono: Fabio Tavares.

## Resumo em 30 segundos

O painel **funciona e está sólido na lógica** — o JS valida 100% limpo (0 erros nos 12 blocos),
as chaves de API estão protegidas no servidor (Vercel env), e as regras de negócio estão centralizadas.

Os problemas **não são de funcionalidade, são de fundação**: o arquivo cresceu pra ~30 mil linhas
em um único `.html` de 2 MB, a autenticação do painel é só "cosmética", e os dados de cliente
trafegam por canais abertos. Nada disso quebra hoje — mas cada um vira um problema sério conforme
você escala atendentes, clientes e gente mexendo no código.

**Os 3 que eu trataria primeiro:** (1) endpoint `/api/banco-horas` aberto pra qualquer um,
(2) dados de cliente no GitHub, (3) o arquivo monolítico que trava a evolução.

---

## Matriz de priorização (severidade × esforço)

| # | Achado | Área | Severidade | Esforço | Ação |
|---|--------|------|:----------:|:-------:|------|
| 1 | `/api/banco-horas` (e os outros 3) com CORS `*` e **sem autenticação** | Security | 🔴 Alta | Baixo | Restringir origem + exigir token/sessão |
| 2 | Dados de cliente/ticket servidos via repo `ssg-dashboard-data` no GitHub | Security | 🔴 Alta | Baixo | Confirmar se o repo é privado; se público, fechar |
| 3 | Login do painel (`_USERS` + hash) é client-side e burlável | Security | 🟠 Média | Médio | Tratar como cosmético; segurança real fica no Vercel |
| 4 | Senha padrão "123456" (hash público conhecido) em vários usuários | Security | 🟠 Média | Baixo | Forçar troca; senhas únicas por usuário |
| 5 | Arquivo único de 30k linhas / 2 MB trava manutenção e deploy | Tech Debt | 🟠 Média | Alto | Separar dados e módulos (faseado) |
| 6 | ~834 KB de dados embutidos no HTML (metade do arquivo) | Scalability | 🟠 Média | Médio | Mover histórico pra fetch externo (já tem o padrão) |
| 7 | Variáveis globais redeclaradas (`LABELS`, `MESES`, `ICONS`, `STATUS_LABEL`…) | Code Review | 🟡 Baixa | Baixo | Renomear/namespacing pra evitar colisão |
| 8 | `innerHTML` com dados concatenados (assunto, cliente) sem escape | Security | 🟡 Baixa | Médio | Escapar texto que vem do OTRS |
| 9 | 5.103 `var`, 0 `let/const`; 706 funções globais; 279 `onclick` inline | Tech Debt | 🟡 Baixa | Alto | Modernizar aos poucos, junto com #5 |
| 10 | 132 TODO/FIXME/HACK espalhados | Tech Debt | 🟡 Baixa | Médio | Varrer e fechar os relevantes |

---

## Detalhamento por frente

### 🔒 Security (a frente mais urgente)

**1. APIs abertas (CORS `*` sem auth) — o achado mais concreto.**
Os 4 endpoints (`banco-horas`, `totvs-search`, `log-activity`, `article-body`) respondem
`Access-Control-Allow-Origin: *` e não checam quem está chamando. O token do apontamento está
escondido no servidor (✅ certo), **mas o resultado — os contratos de Banco de Horas dos seus
clientes — é entregue pra qualquer pessoa** que descubra a URL `gw-command.vercel.app/api/banco-horas`.
Esconder a chave não adianta se o dado sai aberto.
*Por quê importa:* qualquer concorrente ou ex-funcionário com o link puxa saldo/consumo de contrato.
*Ação:* travar a origem pro domínio do painel e exigir um header/sessão simples no proxy.

**2. Dados de cliente no GitHub.**
O `vercel.json` faz rewrite de 8 JSONs (tickets, histórico, silenciosos…) apontando pra
`raw.githubusercontent.com/ssg-create/ssg-dashboard-data`. Se esse repo for **público**,
todo o dado operacional de cliente está exposto na internet, indexável.
*Ação imediata (1 min):* confirmar que `ssg-dashboard-data` é **privado**. Se for público, é vazamento.

**3 e 4. Login do painel é cosmético.**
`_USERS` e os hashes ficam no próprio HTML, e a comparação é no navegador (`crypto.subtle`).
Qualquer um que abre o "ver código-fonte" lê todos os usuários e perfis. Pior: o hash
`8d969eef…` é o SHA-256 público de **"123456"** — confirmei. Ou seja, todo usuário com senha
padrão tem a senha "descoberta" por qualquer tabela de internet.
*Realidade:* isso só é aceitável porque a segurança **de verdade** é o login do Vercel na frente.
*Ação:* (a) tratar o login interno como UX/perfil, não como segurança; (b) trocar as senhas "123456"
por senhas únicas; (c) garantir que o Vercel Deployment Protection está ligado.

**O que está certo:** chaves (`APONTAMENTO_TOKEN`, `TOTVS_*`, `GOOGLE_SERVICE_ACCOUNT`) todas em
env var, nenhuma hardcoded. O proxy server-side foi bem desenhado nesse ponto.

### 🧱 Tech Debt

O arquivo é a maior fragilidade estrutural: **29.812 linhas, 1,98 MB, num único `.html`**.
Tudo é escopo global — **5.103 `var`, zero `let/const`, 706 funções globais, 279 `onclick` inline**.
Isso significa: (a) duas funções/variáveis com o mesmo nome se sobrescrevem em silêncio
(já há `LABELS`, `MESES`, `ICONS`, `STATUS_LABEL` declaradas mais de uma vez no escopo de topo —
bomba-relógio de colisão); (b) toda edição é num arquivo gigante, difícil de revisar e fácil de
quebrar o que já estava de pé; (c) o padrão `typeof fn === 'function'` aparece muito, sinal de que
o código já convive com fragilidade de ordem de carregamento.
*Caminho seguro (faseado, sem big-bang):* primeiro extrair os blocos de **dados** (#6), depois os
**estilos** (já existe `styles.css` + 6 `<style>` embutidos — consolidar), e só então separar JS por
aba. Nada disso muda regra de negócio.

### ⚡ Scalability / Performance

O gargalo real **não é o JS de runtime** — é o **peso de entrada**. Metade do arquivo (~834 KB) é
um bloco de dados embutido (histórico) que o navegador baixa e parseia **em toda abertura**, antes
de desenhar qualquer coisa. Você já tem a infra pra resolver: os outros JSONs já vêm por fetch
externo via rewrite. Mover o histórico pro mesmo padrão corta ~40% do tamanho do HTML e acelera o
primeiro carregamento direto.
Secundário: as tabelas são reconstruídas inteiras via `innerHTML` + `.map().join()` a cada render.
Funciona bem pra centenas de linhas; se um dia listar milhares de tickets numa tela só, aí vira
lento e vale paginar/virtualizar. Hoje **não é prioridade**.

### ✅ Code Review

Boa notícia: **0 erros de sintaxe** em todos os 12 blocos `<script>` (validei com `new Function`).
As regras sensíveis (`SLA_OTRS_RULES`, `ticketInFilter`, `_isProjetoMelhoria`, `BH_BASELINE`)
estão centralizadas e identificáveis — não toquei em nenhuma. Os pontos de atenção do review já
estão na matriz: redeclaração de globais (#7) e `innerHTML` sem escape de dado externo (#8).

---

## Recomendação de sequência

1. **Hoje (minutos):** confirmar repo de dados privado (#2) + Vercel Protection ligado.
2. **Esta semana (baixo esforço, alto impacto):** fechar CORS/auth dos endpoints (#1) e trocar
   as senhas "123456" (#4).
3. **Quando der fôlego:** mover histórico embutido pra fetch externo (#6) — ganho de performance
   imediato e baixo risco.
4. **Projeto de fundo, faseado:** começar a quebrar o monólito (#5/#9), sempre com PR + `verify.sh`
   + validação no preview, sem mexer em regra de negócio.

> Nenhuma dessas ações precisa alterar lógica de negócio. As de segurança (1, 2, 4) são as de
> melhor relação impacto/esforço e eu atacaria primeiro.
