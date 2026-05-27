---
description: Promove develop → main como release (PR + tag leve + GitHub Release) com gates humanos para o merge na UI do GitHub
argument-hint: "[versão X.Y.Z opcional]"
---

# /release — Promote develop to main

Entrada: $ARGUMENTS

Orquestra a promoção de `develop` → `main` como release. Você (assistente) executa tudo que é **automatizável** e **PAUSA nos gates humanos**, dizendo ao usuário exatamente o que clicar na UI do GitHub. O usuário não precisa lembrar o workflow — o comando guia e retoma sozinho.

## Regras invioláveis

- **AI nunca mergeia PR.** Pausa e pede o merge na UI do GitHub. (`.claude/rules/git-workflow.md`)
- **Nunca force-push** em `main` ou `develop`.
- **Tudo que vai pro GitHub em inglês** — PR title/body, tag, release notes, comments.
- **Convenção de release do repo**: tag **leve** `vX.Y.Z` apontando pro tip da `main` + um **GitHub Release** com título `vX.Y.Z` e notas curadas.
- **Merge de `develop`→`main` é SEMPRE "Create a merge commit"** — nunca Squash/Rebase. Squash/Rebase quebram a ancestralidade compartilhada e fazem as próximas promoções re-conflitarem.

## Passo 0 — Detecção de fase (idempotente)

Sempre comece detectando em que ponto do fluxo está e **retome** — o usuário pode rodar `/release` várias vezes (antes do merge, depois do merge):

```bash
git fetch origin main develop --tags 2>&1 | tail -2
MAIN=$(git rev-parse origin/main); DEV=$(git rev-parse origin/develop)
VER=$(git show origin/develop:package.json | python3 -c 'import sys,json;print(json.load(sys.stdin)["version"])')
gh pr list --base main --head develop --state open --json number,title 2>&1
git tag -l "v$VER"
```

- **Tag `v$VER` já existe E release publicado** → nada a fazer. Reporte que a `v$VER` já está lançada.
- **`main` == `develop` (diff vazio) mas falta a tag `v$VER`** → a PR já foi mergeada. Vá direto pra **Fase B**.
- **Há PR `develop`→`main` aberta (não mergeada)** → o gate humano já está pendente. Relembre o usuário pra mergear na UI (Create a merge commit) e **pare**.
- **Senão** (`main` != `develop`, sem PR aberta) → **Fase A**.

## Fase A — Preparar a promoção

### A.1 Pré-flight (bloqueante)

- `git status --short` → árvore limpa. Se houver mudança não commitada relevante, pare e avise.
- `develop` à frente da `main`: `git log --oneline origin/main..origin/develop | head` deve ter commits. Se vazio, não há o que promover — pare.
- Rode a suíte: `npm test`. Se vermelho, **pare** e reporte. Não promove com teste falhando.

### A.2 Versão

- Leia a versão do develop (`VER` acima).
- Se `$ARGUMENTS` traz um `X.Y.Z` e **difere** de `VER`: o bump ainda não foi feito. **Ofereça** bumpar antes de promover:
  - branch a partir de `develop` (`chore/bump-X.Y.Z` ou `release/bump-X.Y.Z`), editar `package.json` (+ `package-lock.json` se aplicável), commit `release: bump to X.Y.Z`, PR pra `develop`.
  - Isso é um **gate**: pause, peça o merge desse bump-PR na UI, e só então retome `/release` (a versão do develop passa a ser a alvo).
- Se `develop` já está na versão alvo (ou `$ARGUMENTS` vazio) → use `VER` e siga.
- Se a tag `vVER` **já existe** → pare e avise (release já selada ou versão não bumpada).

### A.3 Divergência (escolhe a estratégia de merge)

```bash
git merge-base --is-ancestor origin/main origin/develop && echo "CLEAN" || echo "DIVERGED"
```

- **CLEAN** (regime normal — releases sempre saem do develop): `main` é ancestral do `develop`. O merge `develop`→`main` é **limpo, sem conflito**. Abra a PR `develop`→`main` direto (head=`develop`).
- **DIVERGED** (a `main` tem commits que não estão no `develop` — drift): **avise o usuário** e mostre os commits só-main (`git log --oneline origin/develop..origin/main`). Se o usuário confirmar que o conteúdo da `main` é descartável (develop é canônico):
  - branch a partir do develop: `git checkout -b release/develop-to-main origin/develop`
  - `git merge -s ours origin/main -m "release: sync main with develop (...)"` — registra `main` como parent mantendo a árvore do develop → PR **sem conflito e sem force-push**.
  - Valide: `git diff --stat origin/develop HEAD` deve ser **vazio**; `git merge-base --is-ancestor origin/main HEAD` deve dar verdadeiro.
  - Abra a PR com head dessa branch de integração.
  - **NUNCA** resolva drift com force-push na main.

### A.4 Abrir a PR (base=main)

- Corpo **em inglês**, resumindo o range desde a última tag. Inclua um "Test plan" com o resultado do `npm test`.
- Se foi DIVERGED, documente no corpo o lembrete de governança (back-merge / cortar release do develop) pra não repetir.
- Metadata (per `.claude/rules/git-workflow.md`): `gh pr edit <n> --add-assignee @me --add-project Marvinz`. Confirme `mergeable`.

### A.5 GATE HUMANO — pare aqui

Diga ao usuário, de forma explícita e clicável:

> Abri a PR #N (`develop` → `main`). Revise e clique **"Merge pull request" → "Create a merge commit"** na UI do GitHub (não Squash, não Rebase). Quando mergear, me avise ou rode `/release` de novo que eu sigo pra tag + release.

**PARE.** Não prossiga pra Fase B até o merge estar confirmado.

## Fase B — Selar a release (após o merge)

### B.1 Confirmar estado

```bash
git fetch origin main --tags 2>&1 | tail -2
git diff --stat origin/main origin/develop   # deve ser VAZIO (main == develop)
git show origin/main:package.json | python3 -c 'import sys,json;print(json.load(sys.stdin)["version"])'
git log -1 --oneline origin/main
```

Se `main` != `develop`, a PR não foi mergeada (ou foi por Squash/Rebase — avise que deveria ser merge commit). Não tagueie até a `main` bater com o `develop`.

### B.2 Tag leve

```bash
git tag vVER <main-tip-sha> && git push origin vVER
git cat-file -t vVER   # confirma "commit" (tag leve, igual à convenção)
```

### B.3 Notas escopadas desde a última release

- Descubra a tag anterior (`git tag --sort=-v:refname | head`).
- **Se a tag anterior é ancestral da `main`** (regime normal): `gh release create vVER --title "vVER" --generate-notes --verify-tag --target main` gera o range correto.
- **Se NÃO é ancestral** (drift histórico): NÃO use ancestralidade (faz overshoot, lista PRs já lançadas). Escopa por **data** — commits no `develop` desde a data da última release:
  ```bash
  git log --pretty="%s" --since="<data-da-última-release>" origin/develop | grep -vE "^Merge "
  ```
  Cure em **highlights agrupados** (Features / Fixes / Performance), filtrando ruído (chore/test internos), com link `Full Changelog: .../compare/<prev>...vVER`. Escreva num arquivo e use `gh release create vVER --title "vVER" --notes-file <file> --verify-tag --target main`.
- **Sempre prefira highlights curados** a um dump cru de todos os commits.

### B.4 Confirmar e reportar

- `gh release view vVER --json tagName,name,targetCommitish,url` → confirme target `main`, não draft/prerelease (é Latest por ser a maior versão).
- Reporte ao usuário: versão na main, tag, link do GitHub Release.

## Governança (sempre lembrar)

- **Releases saem SEMPRE do `develop`.** Promover via merge commit mantém a `main` ancestral do `develop` → as próximas promoções são merge limpo, **sem precisar de `-s ours`**.
- O `-s ours` só existe pra consertar drift histórico. Se você precisou dele, deixe claro no corpo da PR o porquê e o lembrete de não repetir (a release v0.10.0 foi o caso que originou este comando).

## Quando NÃO usar /release

- Promover uma feature branch pra `develop` (isso é o fluxo normal de PR, não release).
- Hotfix direto na `main` (fora do escopo deste comando; trataria como exceção manual).
