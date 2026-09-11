# .claude/ — obsclone product squad

Time de agentes IA configurado como **Agent Team nativo** do Claude Code para desenvolver e evoluir o obsclone (Electron + React + TypeScript).

> **Requer Claude Code v2.1.32+** (você está em 2.1.146+). A flag `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` já está habilitada em `.claude/settings.json` — todo mundo que clonar o repo herda.

## Estrutura

```
.claude/
├── settings.json    # liga a flag Agent Teams + registra os hooks
├── agents/          # 12 subagentes — viram teammates quando spawned em time
├── skills/          # 6 skills auto-invocadas (apenas para uso direto — NÃO se aplicam a teammates)
├── commands/        # /squad — monta o team conforme tipo da missão
├── hooks/           # scripts disparados pelo Claude Code (force-push, lint, type-check)
└── rules/           # git-workflow.md (preexistente)
```

## Hooks

Versionados em `.claude/hooks/` e registrados em `.claude/settings.json` — todo mundo que clonar o repo herda automaticamente. Todos parseiam o stdin com **node** (garantido pra quem roda o app), então **não exigem instalar nada** — sem dependência de `jq`.

| Script | Evento | O que faz |
|---|---|---|
| `block-force-push.sh` | `PreToolUse` (Bash) | Bloqueia `git push --force`/`-f`/`+refspec` antes do comando rodar (issue #201). |
| `eslint-fix.sh` | `PostToolUse` (Edit/Write/MultiEdit) | Roda `eslint --fix` no arquivo `.ts`/`.tsx` editado. **Auto-fix only — nunca bloqueia.** Não reporta resíduo não-autofixável porque o baseline de lint não está limpo e forçar consertos não-relacionados violaria a regra de Surgical Changes do `CLAUDE.md`. Lint completo continua manual/CI (`npm run lint`). |
| `tsc-check.sh` | `Stop` | Roda `tsc -b --noEmit` uma vez no fim do turno. Se houver erro de tipo, devolve as primeiras linhas e sai com `exit 2` — o agente continua até type-checkar limpo. Seguro porque o baseline de tsc é mantido verde (issue #312). |

**Por que `node` e não `jq`**: o `block-force-push.sh` estabeleceu a convenção — node já é pré-requisito pra rodar o Electron/Vite, então hooks não devem exigir setup extra de quem clona. Mantenha hooks novos no mesmo padrão.

## Como funciona — Agent Teams vs subagent clássico

| | Subagent clássico | Agent Team (este repo) |
|---|---|---|
| Topologia | Lead → child → return | Lead + peers, mailbox compartilhado |
| Contexto | Resume e volta | Cada teammate tem sessão própria persistente |
| Comunicação | Só via lead | Teammates conversam direto via `SendMessage` |
| Custo | Baixo | Alto (1 Claude por teammate) |
| Quando usar | Tarefa focada, single-shot | Cross-layer, debate de contratos, review paralelo |

**Importante (doc oficial):** quando um subagent vira teammate, os campos `skills` e `mcpServers` da frontmatter dele **NÃO são aplicados**. Skills só funcionam quando o subagent é invocado diretamente.

## Squad — 12 agentes

Instalados em `.claude/agents/`. Cada um é versionado no repo; o time herda automaticamente.

### Liderança & Produto (Opus)
| Agente | Papel |
|---|---|
| `tech-lead-orchestrator` | Analisa requisitos, decompõe em tasks, delega — **nunca implementa** |
| `product-manager` | PRD, user stories, acceptance criteria |
| `ux-researcher` | Pesquisa de usuário, JTBD, edge cases |

### Implementação (Sonnet)
| Agente | Papel |
|---|---|
| `react-component-architect` | Componentes React, hooks, state |
| `electron-pro` | Main process, IPC, security, packaging |
| `ui-designer` | Mockups, tokens, design system |

### Quality (paralelo) (Opus/Sonnet)
| Agente | Papel |
|---|---|
| `qa-expert` | Plano de teste, casos manuais |
| `test-automator` | Playwright E2E, unit tests |
| `code-reviewer` | Review de diff |
| `security-auditor` | Surface Electron (IPC/CSP/context isolation) |
| `accessibility-tester` | WCAG audit |

### Docs (Haiku)
| Agente | Papel |
|---|---|
| `technical-writer` | CHANGELOG, README, ADRs |

## Skills — 6 auto-invocadas

Carregam sozinhas quando a descrição bate com o pedido.

| Skill | Quando ativa | Origem |
|---|---|---|
| `frontend-design` | Construir/melhorar UI React, evita "AI slop" aesthetic | Anthropic oficial |
| `webapp-testing` | Testar UI local via Playwright Python | Anthropic oficial |
| `e2e-test-conventions` | Gerar/revisar testes E2E TypeScript | agentmantis |
| `e2e-test-suite-init` | Inicializar suite Playwright em projeto novo | agentmantis |
| `create-pom` | Criar Page Object Model | agentmantis |
| `create-regression-test` | Criar teste de regressão a partir de bug | agentmantis |

## Como usar

### Modo Agent Team (recomendado para features completas)
```
/squad <descrição da feature ou bug>
```
O lead executa o workflow programático: `TeamCreate` → `TaskCreate` × N → `Agent(team_name, name)` por teammate → `TaskUpdate` para atribuir owners → `SendMessage` para kickoff. Teammates conversam direto via mailbox e marcam tasks como completed sozinhos. Lead sintetiza no final e roda `TeamDelete`. Pausa em gates humanos quando precisa de aprovação.

### Modo subagent clássico (tarefas pontuais)
```
@agent-electron-pro: refatorar o preload script para isolar X
```
Sem time, sem mailbox. Útil quando a task cabe em uma chamada e o resultado volta pro main agent. **Lembrete:** subagent clássico tem acesso a skills (`frontend-design`, `webapp-testing` etc) — teammates em Agent Team NÃO têm.

### Skills (automático, só fora de Agent Teams)
Não precisa invocar — a skill carrega quando a descrição bate. Ex: ao pedir "escreva um teste E2E para o painel de configurações", `e2e-test-conventions` + `create-pom` carregam sozinhas. **Importante**: skills só funcionam para o main agent ou subagent clássico — não para teammates dentro de um Agent Team (limitação oficial). Se a missão precisa de uma skill, decida entre usar Agent Team OU usar subagent clássico — não dá pra ter os dois.

## Workflow & gates

Segue `.claude/rules/git-workflow.md`:
- Branch a partir de `develop`
- PR contra `develop`
- Usuário sempre revisa e aprova merge
- Nunca push direto em `main`/`develop`

Os agentes respeitam esse fluxo — o orquestrador para antes de criar PR e aguarda confirmação.

## Fontes dos agentes

| Origem | Agentes |
|---|---|
| [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents) | electron-pro, ui-designer, qa-expert, test-automator, code-reviewer, security-auditor, accessibility-tester, product-manager, ux-researcher, technical-writer |
| [vijaythecoder/awesome-claude-agents](https://github.com/vijaythecoder/awesome-claude-agents) | tech-lead-orchestrator, react-component-architect |
| [anthropics/skills](https://github.com/anthropics/skills) | frontend-design, webapp-testing |
| [agentmantis/test-skills](https://github.com/agentmantis/test-skills) | e2e-test-* skills, create-pom, create-regression-test |
