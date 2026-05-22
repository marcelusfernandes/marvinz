---
description: Monta um Agent Team nativo (lead + 3-5 teammates) para uma feature/bug usando TeamCreate, TaskCreate e SendMessage
argument-hint: <descrição da feature/bug>
---

# /squad — Agent Team nativo

Entrada: $ARGUMENTS

Você é o **lead** desta missão. A flag `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` já está ativa em `.claude/settings.json` — `TeamCreate`, `TeamDelete`, `SendMessage` e Task tools estão disponíveis.

## Princípios (doc oficial)

- **3-5 teammates, 5-6 tasks por teammate.** Não exceda.
- **Output em texto plain NÃO chega aos teammates.** Para se comunicar com qualquer um, use **`SendMessage`** (com `to`: nome do teammate, `summary` curto, `message`).
- **Mensagens chegam automaticamente** como novos turnos — não precisa checar inbox.
- **Skills e mcpServers da frontmatter NÃO se aplicam** quando subagent vira teammate. Se a task depende de skill, inclua a instrução no `message` inicial.
- **Refira-se a teammates pelo nome**, nunca por UUID.
- **Inglês em tudo que vai pro GitHub** — commit messages, PR title/body, comments em PRs e issues, issue title/body (incluindo follow-ups). Coordenação interna (mensagens entre teammates, este chat com o usuário) segue em PT-BR. Detalhes: `.claude/rules/git-workflow.md`.

## Passo 1 — Triagem (decida sem perguntar)

Classifique a entrada em um perfil. Em dúvida entre dois, prefira o menor.

### Perfil A — Feature cross-layer (renderer + main + persistência) → 5 teammates
- `gustavo-pm` (subagent_type: `product-manager`) — PRD em `docs/specs/<slug>.md`
- `electron` (subagent_type: `electron-pro`) — main process / IPC / preload
- `react` (subagent_type: `react-component-architect`) — UI / componentes
- `qa` (subagent_type: `qa-expert` ou `test-automator`) — testes
- `security` (subagent_type: `security-auditor`) — review paralelo

### Perfil B — Feature de UI apenas → 3-4 teammates
- `gustavo-pm` (subagent_type: `product-manager`) OU `bruno-ux` (subagent_type: `ux-researcher`) — escolha conforme se a feature está definida ou em descoberta
- `lipe-ui` (subagent_type: `ui-designer`)
- `react` (subagent_type: `react-component-architect`)
- `a11y` (subagent_type: `accessibility-tester`) — opcional, se houver mudança visual significativa

### Perfil C — Bug fix → 3 teammates
- `tester` (subagent_type: `test-automator`) — teste de regressão **antes** do fix
- `dev` (subagent_type: `electron-pro` ou `react-component-architect` conforme camada)
- `reviewer` (subagent_type: `code-reviewer`)

### Perfil D — Refactor / dívida técnica → 3 teammates
- `marcelus-arq` (subagent_type: `tech-lead-orchestrator`) — análise + plano
- `dev` (subagent_type da camada afetada)
- `reviewer` (subagent_type: `code-reviewer`)

## Passo 1.5 — Vincular issue (se a missão tem issue no GitHub)

Se a entrada do `/squad` cita uma issue (ex: "trabalhar na issue #60"), faça o vínculo issue↔branch↔status ANTES de spawn dos teammates. Pula esta seção apenas se for trabalho exploratório sem issue rastreável.

### 1.5.1 Criar branch a partir da issue

Use `gh issue develop` — cria branch a partir de `develop`, **vincula automaticamente à issue**, e checa o branch:
```bash
gh issue develop <issue-number> --base develop --branch <type>/<slug> --checkout
```

Onde `<type>` segue `.claude/rules/git-workflow.md` (`feat`, `fix`, `refactor`, `chore`, etc.) e `<slug>` é kebab-case curto.

### 1.5.2 Comentar na issue com link da branch

```bash
gh issue comment <issue-number> --body "Squad iniciado — branch: \`<type>/<slug>\`. Status: In Progress."
```

### 1.5.3 Mover issue para "In Progress" no project board

Se houver project board com status:
```bash
# Descobrir project ID, status field ID, "In Progress" option ID:
gh project list --owner <owner> --format json
gh project field-list <project-number> --owner <owner> --format json
# Mover:
gh project item-edit --id <item-id> --field-id <status-field-id> --project-id <project-id> --single-select-option-id <in-progress-option-id>
```

**Se `gh` retornar erro `missing required scopes [read:project]`**: pause e peça ao usuário rodar `gh auth refresh -s read:project,project`. Não tente contornar. Documente no relatório final que o status fica desatualizado até a refresh.

## Passo 2 — Spawn programático

Execute nesta ordem:

### 2.1 Criar time
```
TeamCreate({
  team_name: "<slug-da-missao>",
  description: "<1 frase sobre o objetivo>",
  agent_type: "tech-lead"
})
```

### 2.2 Criar task list inicial
Use `TaskCreate` (uma vez por task). Decomponha em **5-15min cada**, IDs em ordem de dependência (lower ID first). Exemplo:
```
TaskCreate({ content: "Escrever PRD com acceptance criteria em docs/specs/<slug>.md" })
TaskCreate({ content: "Implementar IPC handler em electron/main.ts" })
TaskCreate({ content: "Construir componente React em src/components/X.tsx" })
TaskCreate({ content: "Adicionar testes E2E Playwright cobrindo fluxo principal" })
TaskCreate({ content: "Review de segurança no diff IPC/preload" })
```

### 2.3 Spawn dos teammates
Para cada papel, **uma chamada `Agent`** com `team_name` e `name`:
```
Agent({
  description: "<curta>",
  subagent_type: "product-manager",
  team_name: "<slug-da-missao>",
  name: "gustavo-pm",
  prompt: "Você é o gustavo-pm, PM deste time. Sua primeira task é escrever o PRD em docs/specs/<slug>.md cobrindo: user story, acceptance criteria mensuráveis, edge cases. Use TaskList para ver suas tasks, TaskUpdate para marcar como completed, SendMessage para coordenar com outros teammates. Quando terminar o PRD, mande para 'electron' e 'react' uma referência ao arquivo."
})
```
Repita para `electron`, `react`, `qa`, `security` etc — conforme o perfil escolhido.

### 2.4 Atribuir owners das tasks
```
TaskUpdate({ task_id: "<id>", owner: "gustavo-pm" })
TaskUpdate({ task_id: "<id>", owner: "electron" })
...
```

### 2.5 Iniciar trabalho
Mande mensagem inicial para teammates que devem começar imediatamente (os outros pegam tasks unblocked depois):
```
SendMessage({
  to: "gustavo-pm",
  summary: "kickoff: escrever PRD",
  message: "Comece pela task #1 (PRD). Quando terminar, avisa o electron e o react com o caminho do arquivo."
})
```

## Passo 3 — Durante a missão

- **Mensagens dos teammates chegam como turnos novos** automaticamente. Responda só quando precisarem de input/decisão.
- **Idle não é erro** — teammate que mandou mensagem e ficou idle só está aguardando resposta.
- **Não escreva código você mesmo.** Seu trabalho é: coordenar, sintetizar, ajustar task list, mediar conflitos.
- **Gates humanos**: se houver decisão que precisa do usuário (ex: aprovar PRD antes de implementar), pause — pergunte ao humano antes de liberar o próximo grupo de tasks.
- Se algum teammate ficar bloqueado, mande nova task via TaskCreate ou redirecione via SendMessage.

## Passo 4 — Encerramento limpo

1. Quando todas tasks estão `completed`, peça reports finais:
   ```
   SendMessage({ to: "gustavo-pm", summary: "report final", message: "Resuma o que foi entregue, arquivos tocados e ACs atendidos." })
   ```
   (repita para cada teammate)

2. Consolide os reports em texto único para o usuário humano. Inclua: arquivos tocados, AC atendidos (X/N), riscos pendentes.

3. **Abrir issues de follow-up descobertos durante o squad** (se houver):

   Bugs/gaps levantados pelo security review, gaps fora do escopo, ou flags do `qa` que ficaram out-of-scope da issue principal viram **issues novas** via `/issues:create` ou `gh issue create`. **Todas vão direto para `Todo` no project board** — não Backlog. Justificativa: follow-ups de squad têm escopo concreto, severity conhecida e ACs no body — passam todos os critérios de Todo (≠ "ideia talvez um dia").

   Para cada follow-up:
   ```bash
   gh issue create --title "<título>" --body "..." --label <labels>
   # Mover pra Todo:
   gh project item-edit --id <item-id> --field-id <status-field-id> --project-id <project-id> --single-select-option-id <todo-option-id>
   ```

   Mencione cada follow-up criado no body da PR principal (seção "Follow-ups" / "Out of scope").

4. **Abrir PR contra `develop` referenciando a issue** (sempre `Closes #<num>` no body — auto-close on merge):
   ```bash
   gh pr create --base develop --title "<tipo>: <descrição> (#<issue-num>)" --body "...Closes #<issue-num>..."
   ```

5. **Mover issue para "In Review"** no project board:
   ```bash
   gh project item-edit --id <item-id> --field-id <status-field-id> --project-id <project-id> --single-select-option-id <in-review-option-id>
   ```
   Idem caveat: se token sem scope `read:project`, pause e peça refresh.

6. **Comentar na issue** com o link da PR (defesa caso `Closes #X` falhe em auto-link):
   ```bash
   gh issue comment <issue-number> --body "PR aberta: #<pr-num>. Status: In Review."
   ```

7. Shutdown teammates (em paralelo):
   ```
   SendMessage({ to: "<teammate>", message: { type: "shutdown_request", reason: "missão completa" } })
   ```
   Cada teammate responde com `shutdown_response approve:true` e seu processo termina.

8. Após todos saírem:
   ```
   TeamDelete()
   ```

9. **Não faça merge.** Usuário humano aprova o merge da PR. Quando a PR for mergeada (você será notificado ou pode checar `gh pr view <num> --json state`):
   - Issue auto-fecha via `Closes #X` no body
   - **Mover issue para "Done"** no project board:
     ```bash
     gh project item-edit --id <item-id> --field-id <status-field-id> --project-id <project-id> --single-select-option-id <done-option-id>
     ```

**Resumo do flow de status da issue durante o squad:**

| Momento | Status no project board | Onde no `/squad` |
|---|---|---|
| Squad pega issue | **In Progress** | Passo 1.5.3 |
| Follow-ups criados | **Todo** (direto) | Passo 4.3 |
| PR aberta (issue principal) | **In Review** | Passo 4.5 |
| PR mergeada (issue principal) | **Done** | Passo 4.9 |

Cada transição vem acompanhada de um comment na issue (Passos 1.5.2, 4.6) — garantindo trilha auditável mesmo se project board não estiver acessível.

## Limites & sanidade

- **Um time por vez** (sem nested teams).
- Lead fixo — você não pode passar liderança.
- Tools/permissões dos teammates ficam congeladas no spawn.
- Custo: cada teammate = 1 sessão Claude completa. 5 teammates ativos = ~5× tokens vs subagent clássico.
- Display lado a lado precisa tmux/iTerm2 (`claude --teammate-mode in-process`). Sem isso, comunicação rola via mailbox sem split.

## Quando NÃO usar /squad

Caia para subagent clássico (chamada `Agent` simples sem `team_name`) quando:
- Tarefa < 30min ou em um único arquivo
- Review de PR pequeno (só `code-reviewer` direto)
- Pesquisa/lookup (use `Explore` ou `general-purpose`)

Nesse caso responda ao usuário "isso não precisa de squad — vou rodar X sozinho" e siga sem TeamCreate.
