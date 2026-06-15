# Git Workflow

## Issue-first workflow

Toda branch de feature/refactor/bug fix não-trivial deve traçar de volta a uma issue no GitHub. Sem issue, não começa.

Fluxo obrigatório antes de criar branch ou começar a implementar:

1. **Buscar** issue existente: `gh issue list --repo marcelusfernandes/marvinz --search "<keywords>"`.
2. **Sem match → criar** via `/issues:create` (a skill enforce o template de seções).
3. **Se a issue é M ou L** (ou se o diff projetado > 2k LOC excluindo lockfiles/snapshots/fixtures): **NÃO** começar. Converter em milestone do GitHub e decompor em sub-issues menores — cada uma com User Story + ACs próprios, cada uma lançando uma PR separada.
4. **Branch a partir da issue**: `gh issue develop <num> --base develop --name <type>/<slug> --checkout` — vínculo automático ao painel **Development** da issue.

A regra é não-negociável. Se o usuário pedir pra pular ("é só uma mudança pequena", "depois eu crio a issue"), o assistente sinaliza o gate ("criando issue de tracking #N primeiro") e cumpre. Selective enforcement vira nenhum enforcement.

**PR body sempre tem `Closes #N` em texto puro** — sem bold (`Closes **#N**`) ou itálico (`Closes _#N_`). O parser de auto-close do GitHub falha com formatação no `#N` (ver drift histórico em #63).

**Exceções** (não precisam de issue prévia):

- Typo fixes
- Single-file edits < 50 LOC com baixa cognitive load
- Comandos read-only/exploratórios ("explica X", "mostra Y", status reports)

## Branch model

- `main` → produção. Atualizado **somente** via PR aprovada de `develop`.
- `develop` → desenvolvimento ativo. Base de toda branch nova.
- `<type>/<slug>` → feature/fix, criadas a partir de `develop`.

## Branch naming

Slug em kebab-case. Prefixo conforme o tipo:

| Prefixo     | Quando usar                                   |
| ----------- | --------------------------------------------- |
| `feat/`     | Nova funcionalidade voltada ao usuário        |
| `fix/`      | Correção de bug                               |
| `refactor/` | Reestrutura de código sem mudar comportamento |
| `perf/`     | Otimização de performance                     |
| `chore/`    | Deps, configs, tooling, infra                 |
| `docs/`     | Documentação apenas                           |
| `test/`     | Adição/ajuste de testes                       |
| `ci/`       | CI/CD, GitHub Actions, hooks                  |

Exemplos: `feat/wikilinks`, `fix/pty-spawn-race`, `refactor/file-tree`, `chore/upgrade-electron`, `docs/readme`.

## Fluxo para uma nova mudança

1. `git checkout develop && git pull`
2. `git checkout -b <type>/<slug>`
3. Implementar e commitar na branch
4. **Aguardar usuário confirmar** que funciona
5. **Após confirmação**: `git push -u origin <type>/<slug>` e `gh pr create --base develop`
6. Parar. Usuário revisa e decide o merge.

## Regras invioláveis

- **Nunca começar trabalho sem issue rastreável** (ver "Issue-first workflow" acima; exceções na mesma seção)
- **Nunca usar bold/italic em `Closes #N`** — o parser do GitHub falha em `Closes **#N**`, deixando a issue aberta após merge
- **Nunca** committar direto em `main` ou `develop`
- **Nunca** abrir PR para `main` (apenas `develop` → `main`, e essa decisão é do usuário)
- **Nunca** fazer merge de PR — usuário sempre revisa
  - **Exceção: release PRs** (bump version → develop, e promote develop → main): podem ser auto-merged via `gh pr merge --merge` **após confirmação mecânica explícita do usuário no chat** (ex: resposta "sim" / "yes" / "proceed"). O gate humano é a decisão de prosseguir, não o clique na UI. Sempre merge commit, nunca squash/rebase.
- **Não** push da feature branch antes da confirmação do usuário
- **Não** force-push em `main` ou `develop` em hipótese nenhuma

## Idioma — sempre inglês

**Convenção do projeto**: todo texto que vai pro GitHub é em **inglês**:

- Commit messages (title + body)
- PR titles e bodies
- Comentários em PRs e issues
- Issue titles e bodies (criadas via squad ou diretamente)
- Mensagens de erro em código quando expostas ao usuário (já era padrão pós-G2-1)

**Conversa com o usuário (este chat, planejamento, gates humanos)** segue em PT-BR — o idioma só é forçado quando o conteúdo sai do contexto local pro repositório público.

Justificativa: histórico do repo + reviewers eventuais (open source ou colaboradores externos) precisam de baseline consistente em inglês. Mistura de idiomas no git log gera ruído de leitura.

## Commit message

Formato: `<type>: <short imperative description>`

- Same `<type>` as the branch (`feat`, `fix`, `refactor`, etc.)
- Description in lowercase, no trailing period, **in English**
- Attribution (Co-Authored-By) is globally disabled

Example: `feat: wikilink resolver by basename`

## PR metadata — checklist obrigatório

Toda PR aberta deve ter os campos abaixo preenchidos. Verificar e completar logo após `gh pr create` — alguns são auto-populados, outros precisam de comando explícito.

| Campo                           | Auto-populado?                                   | Como garantir                                                                                                                                                          |
| ------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Title + Body em inglês**      | Não                                              | Escrever em inglês na criação                                                                                                                                          |
| **`Closes #<num>` no body**     | Não                                              | Incluir manualmente quando a PR resolve uma issue (Step 4.4 do `/squad`). Liga ao **Development** da issue + auto-fecha no merge                                       |
| **Assignees: autor da PR**      | Sim (GitHub)                                     | Default em todas as PRs do projeto. Se cair fora, `gh pr edit <num> --add-assignee @me`                                                                                |
| **Project: Marvinz**            | Sim (automation do GitHub)                       | Verifica via `gh pr view <num> --json projectItems`. Se vazio, `gh pr edit <num> --add-project Marvinz` (precisa scope `project`)                                      |
| **Development → Issue linkada** | Sim, se branch foi criada via `gh issue develop` | Sempre criar branch dessa forma quando há issue (`gh issue develop <num> --base develop --name <type>/<slug>`). Reforço extra: `Closes #X` no body também ativa o link |
| **Labels**                      | Não                                              | Adicionar 1-2 que reflitam o tipo do trabalho (`enhancement`, `bug`, `security`, etc.) na criação ou `gh pr edit --add-label`                                          |
| **Milestone**                   | Não                                              | Se a PR fecha issue de milestone (ex: G2), associar via `gh pr edit --milestone "<name>"`                                                                              |

**Verificação rápida após `gh pr create`**:

```bash
gh pr view <num> --json title,assignees,projectItems,closingIssuesReferences,labels,milestone --jq \
  '{title, assignees: [.assignees[].login], projects: [.projectItems[].title], closes: [.closingIssuesReferences[].number], labels: [.labels[].name], milestone: .milestone.title}'
```

Se algum campo obrigatório estiver vazio, completar antes de pedir review humano.

**Se `gh` não tiver scope `project`**: pause e peça `gh auth refresh -s project,read:project`. Não tente contornar.
