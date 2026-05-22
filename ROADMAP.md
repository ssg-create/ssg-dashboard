# ROADMAP — Command Center

Itens definidos mas não implementados. Cada um vira sprint quando o Fabio topar.

---

## 1. Perfil "Responsável de Fila"

**Origem:** conversa com Fabio em 22/05/2026.
**Status:** definido conceitualmente, sem código.

### Contexto

Hoje os perfis de acesso são:

| Perfil | Vê o quê | Senha |
|---|---|---|
| Gestão | Tudo (todas filas, todos clientes) | `_H_GEST` |
| Squad | Só sua squad | `_H_SQ_*` (uma por squad) |
| Triagem | Fila de triagem | `_H_TRIAGEM` |
| Atendente | Só seus próprios chamados (login OTRS) | login OTRS direto |

Falta uma camada intermediária: **dono da fila**. Ex: responsável pela GWMS precisa ver tudo da GWMS (qualquer atendente, qualquer cliente naquela fila) mas não tem porque ver o drill nominal das outras filas. Ao mesmo tempo, precisa ter algum contexto cruzado pra entender onde a fila dele depende de outras (ex: ticket GWMS esperando DBA).

### Proposta

3 níveis de visibilidade (mantendo os atuais):

| Perfil | Escopo principal | Contexto geral |
|---|---|---|
| Atendente | Seus chamados | — |
| **Responsável de Fila (novo)** | Tudo da fila X | Agregados de outras filas, sem drill nominal |
| Gestão | Tudo | Tudo |

### Decisões a tomar antes de implementar

1. **Mapeamento fila → responsável.** Quem é dono de cada uma das 7 filas ativas:
   - DATASUL
   - DBA
   - GWMS
   - INFRAESTRUTURA
   - PROTHEUS
   - SSG
   - SSG-MELHORIAS

2. **Granularidade do "contexto geral"** pro responsável de fila:
   - **A.** Só agregados (totais por fila, sem nomes) — mais conservador
   - **B.** Cruzamento nominal (ex: atendente João aparece em SSG e GWMS, dá pra ver alocação cruzada)
   - **C.** Tudo read-only (vê igual gestão mas não consegue agir fora da fila)

3. **Autenticação.** Manter senha hashada (`_H_FILA_*`) ou subir pra SSO/OAuth via Google Workspace?

### Esboço técnico (alto nível)

- Adicionar `mode='fila'` em sessionStorage (igual aos modos atuais)
- Hash `_H_FILA_GWMS`, `_H_FILA_DBA`, etc no gate de login
- Variável `userFila` setada no boot — força `activeFilaOP = userFila` em todas as views
- Esconder via CSS aba/seleção de outras filas (mesmo padrão de `body.atendente-mode`)
- Reusar `view-op` com filtros pré-aplicados (não precisa criar view nova)
- Adicionar bloco "Cross-Fila" em Operação Interna — agregados das outras filas, sem drill nominal
- Modo Gestão pode espelhar perfil de fila (igual já espelha atendente)

### Não-objetivos

- Não criar perfil "Responsável de Cliente" agora — fica pra depois
- Não implementar permissões de escrita diferenciadas (todos modos seguem read-only)
- Não migrar pra SSO nessa primeira fase

---

## Outros itens em backlog mental (sem prioridade)

- **Endpoint histórico mensal de apontamentos** — Adriano mencionou um endpoint adicional pra `BH_HISTORICO` real (hoje o heatmap usa snapshot Jan→Mai/26 embutido). Plugar elimina manutenção manual.
- **PDF Status Report de Projetos & Melhorias** — relatório executivo da aba nova, formato similar ao PDF BH.
- **SLA de solução por prioridade (regra OTRS)** — hoje o painel usa limite fixo de 16h úteis. Se OTRS tem regra de solução por prioridade/serviço, plugar igual já fizemos pra 1ª resposta.
- **Cliente também ver separação projetos/melhorias** — hoje só gestão vê. Avaliar se cliente final precisa enxergar.
