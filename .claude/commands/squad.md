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

## Passo 1 — Triagem (decida sem perguntar)

Classifique a entrada em um perfil. Em dúvida entre dois, prefira o menor.

### Perfil A — Feature cross-layer (renderer + main + persistência) → 5 teammates
- `pm` (subagent_type: `product-manager`) — PRD em `docs/specs/<slug>.md`
- `electron` (subagent_type: `electron-pro`) — main process / IPC / preload
- `react` (subagent_type: `react-component-architect`) — UI / componentes
- `qa` (subagent_type: `qa-expert` ou `test-automator`) — testes
- `security` (subagent_type: `security-auditor`) — review paralelo

### Perfil B — Feature de UI apenas → 3-4 teammates
- `pm` (subagent_type: `product-manager` ou `ux-researcher`)
- `designer` (subagent_type: `ui-designer`)
- `react` (subagent_type: `react-component-architect`)
- `a11y` (subagent_type: `accessibility-tester`) — opcional, se houver mudança visual significativa

### Perfil C — Bug fix → 3 teammates
- `tester` (subagent_type: `test-automator`) — teste de regressão **antes** do fix
- `dev` (subagent_type: `electron-pro` ou `react-component-architect` conforme camada)
- `reviewer` (subagent_type: `code-reviewer`)

### Perfil D — Refactor / dívida técnica → 3 teammates
- `architect` (subagent_type: `tech-lead-orchestrator`) — análise + plano
- `dev` (subagent_type da camada afetada)
- `reviewer` (subagent_type: `code-reviewer`)

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
  name: "pm",
  prompt: "Você é o PM deste time. Sua primeira task é escrever o PRD em docs/specs/<slug>.md cobrindo: user story, acceptance criteria mensuráveis, edge cases. Use TaskList para ver suas tasks, TaskUpdate para marcar como completed, SendMessage para coordenar com outros teammates. Quando terminar o PRD, mande para 'electron' e 'react' uma referência ao arquivo."
})
```
Repita para `electron`, `react`, `qa`, `security` etc — conforme o perfil escolhido.

### 2.4 Atribuir owners das tasks
```
TaskUpdate({ task_id: "<id>", owner: "pm" })
TaskUpdate({ task_id: "<id>", owner: "electron" })
...
```

### 2.5 Iniciar trabalho
Mande mensagem inicial para teammates que devem começar imediatamente (os outros pegam tasks unblocked depois):
```
SendMessage({
  to: "pm",
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
   SendMessage({ to: "pm", summary: "report final", message: "Resuma o que foi entregue, arquivos tocados e ACs atendidos." })
   ```
   (repita para cada teammate)

2. Consolide os reports em texto único para o usuário humano. Inclua: arquivos tocados, AC atendidos (X/N), riscos pendentes.

3. Shutdown teammates (em paralelo):
   ```
   SendMessage({ to: "<teammate>", message: { type: "shutdown_request", reason: "missão completa" } })
   ```
   Cada teammate responde com `shutdown_response approve:true` e seu processo termina.

4. Após todos saírem:
   ```
   TeamDelete()
   ```

5. **Não faça merge nem push.** Siga `.claude/rules/git-workflow.md`: branch a partir de `develop`, PR contra `develop`, usuário humano aprova merge.

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
