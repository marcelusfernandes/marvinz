---
description: Cria uma issue no GitHub (corpo em inglês) seguindo o padrão User story / Context / Current scenario / Problem / Consequences / Proposed solution / Expected result
argument-hint: Descrição livre do problema/feature (texto, imagens, links, screenshots)
---

# /issues:create — Criação padronizada de issue no GitHub

Você está criando uma issue no GitHub a partir da descrição abaixo. **Siga rigorosamente** o padrão de seções definido neste comando — ele é o contrato para issues deste fluxo.

Entrada do usuário: $ARGUMENTS

---

## Passos obrigatórios

### 1. Capturar contexto

- Leia atentamente a descrição do usuário (texto + screenshots + referências a arquivos).
- Se o usuário citou arquivos, símbolos ou pastas, **abra rapidamente** com `Read` / `grep` para citar com precisão (`arquivo.py:linha`) na issue. Não invente referências.
- Não pergunte ao usuário se ele já disse "trabalhe sem parar para perguntas" — faça a chamada razoável e siga. Caso contrário, faça **no máximo 1-2 perguntas** apenas se houver ambiguidade séria sobre o objetivo da issue.

### 2. Identificar repositório e auth

- `git remote -v` para descobrir o repo (`owner/name`).
- Se o repo for de uma organização, confirme que a conta `gh` ativa tem acesso:
  - `gh auth status`
  - Se `gh issue create` falhar com `Could not resolve to a Repository`, rode `gh auth switch --user <conta-com-acesso>` e tente de novo.
- Se não houver `gh` autenticado para o repo, **pare** e peça ao usuário para autenticar.

### 3. Escolher título e label

- **Título** segue Conventional Commit: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`, `ci:`, com escopo opcional. Curto (< 80 chars), **em inglês** (todo conteúdo que vai pro GitHub é inglês — ver `.claude/rules/git-workflow.md`).
- **Labels**: use `gh label list` para ver as labels do repo e escolher 1-2 que façam sentido (`enhancement`, `bug`, `security`, `documentation`, etc.). Se a label não existir, omita — não crie label nova sem pedir.

### 4. Escrever o corpo da issue no padrão abaixo

**Header (antes de User Story)** — quote-block com metadata estrutural. Inclua:

```markdown
> **Size:** <S | M | L> — <short scope description>
> **Parent / Sub-issues:** <#refs or "none">
```

**Convenção de Tamanho** (calibrada para AI Coding Agents executando via /squad ou Agent SDK, NÃO estimativa de dev humano):

- **S** — Cabe em 1 sessão curta (<30min de janela de contexto). Tipicamente: fix cirúrgico em 1-2 arquivos, ou refactor mecânico sem nova lógica.
- **M** — Cabe em 1 sessão média (1-2h). Tipicamente: feature cross-layer simples (1-2 IPC handlers + UI + testes), ou refactor com decisões de design.
- **L** — Requer múltiplas sessões ou squad com 3+ teammates e gates humanos. Tipicamente: feature cross-layer complexa com PRD + segurança + UI nova + testes E2E + risco de iterar review.

**Importante**: NÃO use "~N dias" em estimativas. Tempo wallclock pra agente é dominado por (a) tamanho da janela de contexto, (b) número de gates humanos, (c) iterações de review. Dias-pessoa só faz sentido pra reuniões e priorização de roadmap humano.

O corpo da issue é escrito **em inglês** (regra do `git-workflow.md`). Use exatamente estes cabeçalhos de seção — eles espelham o form `.github/ISSUE_TEMPLATE/feature_request.yml`:

```markdown
## User story

**As a** <persona>,
**I want** <desired capability>,
**so that** <benefit / value>.

---

## Context

<Technical/business background needed to understand the issue. Cite files, modules, flows, prior decisions. Use concrete links/refs (`src/x/y.ts:42`).>

## Current scenario

<What the system does today, precisely. Include code snippets, sample JSON, flows or screenshots when relevant. List the files/locations involved.>

## Problem

<Describe the problem(s), numbered if more than one. Focus on the GAP between current and desired. No solution here.>

## Consequences of the problem

<Concrete impact: user experience, technical risk, cost, security, debt, compliance, etc. Bullets.>

---

## Proposed solution

<Description of the proposed solution. May be split into numbered items (1., 2., ...) with sub-sections (`### 1. ...`) if multi-part. Cite data contracts, states, modules, tests. Note trade-offs and preferences when there is more than one option.>

## Expected result

<The observable final state after delivery. Bullets describing "after this change, X happens and Y stops happening". Concrete and verifiable.>

---

## Acceptance criteria

- [ ] <criterion 1 — verifiable>
- [ ] <criterion 2>
- [ ] Tests (unit / integration / e2e as applicable)
- [ ] Documentation updated (README of the touched area, project rules if needed)

## Out of scope

- <items explicitly excluded so the issue does not inflate>

## References

- <relevant files with path:line>
- <project rules under `.claude/rules/` when applicable>
- <external links / docs / related issues>
```

### 5. Criar a issue

Use HEREDOC para preservar formatação:

```bash
gh issue create \
  --repo <owner/name> \
  --title "<title>" \
  --label <label1> --label <label2> \
  --body "$(cat <<'EOF'
<corpo da issue conforme padrão>
EOF
)"
```

### 6. Reportar ao usuário

- Retorne a URL da issue.
- Resuma em 3-5 bullets: título, labels, seções incluídas, qualquer ajuste de auth que tenha sido necessário.

### 7. Harness — emitir a predição na criação (NÃO-FATAL, §1.9)

A issue **nasce com a predição** (a criação é o gate obrigatório que garante cobertura — §503). Não há branch ainda para commitar o ledger, então a predição é **postada na issue** agora e a row é commitada depois, no work-start, por `/harness:predict` (que reusa este bloco — independência §1.6: prediz na triage, antes de implementar).

Passos (cada um não-fatal; se falhar, registre o que deu e siga — nunca trava a criação):

1. Compute o `PredictionVector` seguindo `.claude/commands/harness/predict.md` (StructuralSignals via grep nos arquivos-alvo prováveis inferidos da issue; size/risks do corpo). Honestidade §1.3: `AgentSignals` são fracos fora do `/squad` (sem deliberação multi-agente) — registre como estão, não infle; `max_node_centrality` fica `null`.
2. Poste o vetor na issue como comentário, com marcador, para o work-start reusar:

   ````bash
   gh issue comment <n> --body "$(printf '%s\n```json\n%s\n```' '<!-- harness:prediction -->' '<PredictionVector JSON>')"
   ````

3. **Não** rode `record-prediction` aqui (sem branch). A row entra no `predictions.jsonl` no work-start.

> Se o size for `L` → milestone + sub-issues (Passo 5 / regra abaixo): emita uma predição por **sub-issue** (o milestone é o acúmulo delas), não uma para o milestone.

---

## Regras de qualidade

- **Padrão de seções é fixo** (cabeçalhos em inglês, espelhando o form `.github/ISSUE_TEMPLATE/feature_request.yml`): header (Size + Parent/Sub-issues) → User story → Context → Current scenario → Problem → Consequences of the problem → Proposed solution → Expected result → Acceptance criteria → Out of scope → References. **Não pule seções**. Se uma seção genuinamente não se aplica, escreva "N/A" com 1 frase explicando.
- **Tamanho NÃO é estimativa de dias humanos**: é classificação de complexidade pra AI agent (S/M/L = sessão curta/média/múltiplas — ver definição completa no Passo 4). Não escreva "~N dias" no campo.
- **User Story em primeira pessoa do usuário do sistema**, não do dev. Persona realista (cliente, engenheiro de plantão, analista de segurança, etc.).
- **Current scenario ≠ Problem**: "Current scenario" descreve o comportamento; "Problem" é o gap. Não misturar.
- **Solução não vai dentro do Problema**, e vice-versa.
- **Citações concretas** > prosa genérica. Use `arquivo.py:linha` sempre que possível.
- **Acceptance criteria verificáveis**: cada item deve ser testável objetivamente (sem "melhorar X", sim "X passa a retornar Y quando Z").
- **Idioma**: título e corpo da issue **sempre em inglês** (regra do `git-workflow.md`: todo texto que vai pro GitHub é em inglês). A conversa com o usuário neste chat continua em PT-BR; só o conteúdo que sai pro repositório é forçado a inglês.
- **Sem markdown quebrado**: valide que blocos de código fecham, listas estão consistentes, links válidos.
- **Não crie commits, branches ou PRs** — esta skill cria **somente issue**.
- **Não rotacione secrets nem invente CVEs** — issues de segurança descrevem o problema; mitigação operacional é responsabilidade de quem implementa.
- **Issues sized `L` viram milestone com sub-issues, não issue monolítica.** Se o size do header for `L` (ou se o escopo projetado exceder ~2k LOC excluindo lockfiles/snapshots/fixtures), NÃO crie a issue como um bloco único — crie um milestone no GitHub (`gh api repos/:owner/:repo/milestones -f title="..."`) e gere sub-issues em loop até cada uma ser `S`. Cada sub-issue tem User Story + ACs próprios e vai virar uma PR separada. O caminho `L`-monolítica só é permitido com nota explícita do usuário (linha `> override-l-monolithic: <justificativa>` no body).

## Anti-patterns

- Misturar "o que é" com "como fazer" na User Story.
- Listar 20 acceptance criteria que ninguém vai validar — prefira 5-10 incisivos.
- Copiar trechos longos de código sem necessidade — bloco curto + referência ao arquivo basta.
- Criar issue sem ler o screenshot/arquivo citado pelo usuário.
- Esquecer de listar referências às rules do projeto (`.claude/rules/permanent/`) quando a issue toca uma área governada por elas.
