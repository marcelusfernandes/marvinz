---
description: Promove develop → main como release (PR + tag leve). O CI faz build cross-platform e publica o GitHub Release automaticamente.
argument-hint: '[versão X.Y.Z opcional]'
---

# /release — Promote develop to main

Entrada: $ARGUMENTS

Orquestra a promoção de `develop` → `main` como release. Você (assistente) executa tudo que é **automatizável** e **PAUSA nos gates humanos**, dizendo ao usuário exatamente o que clicar na UI do GitHub. O usuário não precisa lembrar o workflow — o comando guia e retoma sozinho.

> **CI automático:** a partir de `v0.11.0`, o push da tag `v*` dispara `.github/workflows/release.yml`, que faz build cross-platform (Linux AppImage, Windows `.exe`, macOS `.dmg`) e cria o GitHub Release com notas auto-geradas. O `/release` para no **push da tag** — não cria mais release manualmente.

## Regras invioláveis

- **AI nunca mergeia PR** exceto release PRs (bump e promote) **após confirmação mecânica explícita do usuário no chat** — per `.claude/rules/git-workflow.md`.
- **Nunca force-push** em `main` ou `develop`.
- **Tudo que vai pro GitHub em inglês** — PR title/body, tag, release notes, comments.
- **Convenção de release do repo**: tag **leve** `vX.Y.Z` apontando pro tip da `main`. O CI (`release.yml`) cria o **GitHub Release** com build cross-platform e notas auto-geradas — não criar release manualmente.
- **Merge de release PRs é SEMPRE `--merge` (merge commit)** — nunca Squash/Rebase. Squash/Rebase quebram a ancestralidade compartilhada e fazem as próximas promoções re-conflitarem. (O ruleset da `main` já bloqueia squash/rebase server-side.)
- **Tags `v*` são admin-only** — um branch ruleset restringe create/update/delete ao `Repository admin`. Só o dono do repo dispara release; collaborator não consegue empurrar a tag.

## Passo 0 — Detecção de fase (idempotente)

Sempre comece detectando em que ponto do fluxo está e **retome** — o usuário pode rodar `/release` várias vezes (antes do merge, depois do merge):

```bash
git fetch origin main develop --tags 2>&1 | tail -2
MAIN=$(git rev-parse origin/main); DEV=$(git rev-parse origin/develop)
VER=$(git show origin/develop:package.json | python3 -c 'import sys,json;print(json.load(sys.stdin)["version"])')
gh pr list --base main --head develop --state open --json number,title 2>&1
git tag -l "v$VER"
```

- **Tag `v$VER` já existe** → verifique se o workflow CI completou (`gh run list --workflow release --limit 1`) e se o GitHub Release foi publicado. Reporte status.
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
  - **Gate mecânico**: após abrir a PR, pergunte ao usuário no chat:
    > "Bump PR #N aberta. Confirma o merge para develop? (sim / não)"
  - Se confirmado (`sim` / `yes` / `proceed`): espere checks verdes (`gh pr checks <n> --watch`), então `gh pr merge <n> --merge --admin`.
  - Se recusado: pare e reporte. Retome `/release` depois.
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

### A.5 GATE MECÂNICO — confirmação no chat

Após abrir a promote PR, pergunte ao usuário no chat:

> "Promote PR #N (`develop` → `main`) aberta. Resumo dos commits:
>
> ```
> <git log --oneline origin/main..origin/develop | head -10>
> ```
>
> Confirma o merge para main? (sim / não)"

- **Se confirmado** (`sim` / `yes` / `proceed`):
  1. Espere checks verdes: `gh pr checks <n> --watch` (timeout 10 min).
  2. Merge: `gh pr merge <n> --merge --admin` (sempre merge commit, nunca squash/rebase).
  3. Prossiga direto pra **Fase B** (tag + push).
- **Se recusado**: pare e reporte. Retome `/release` depois.

## Fase B — Selar a release (após o merge)

### B.1 Confirmar estado + auto-merge pendente

```bash
git fetch origin main --tags 2>&1 | tail -2
git diff --stat origin/main origin/develop   # deve ser VAZIO (main == develop)
git show origin/main:package.json | python3 -c 'import sys,json;print(json.load(sys.stdin)["version"])'
git log -1 --oneline origin/main
```

- Se `main` == `develop` → prossiga pra B.2 (tag).
- Se `main` != `develop`:
  - Verifique se há PR aberta `develop`→`main`: `gh pr list --base main --head develop --state open --json number`.
  - **Se há PR aberta** → aplique o **gate mecânico** (A.5): pergunte confirmação no chat, espere checks, `gh pr merge --merge --admin`.
  - **Se não há PR** → avise que a promote PR sumiu; reabra via A.3-A.4 e aplique o gate.
  - **Se foi mergeada por Squash/Rebase** → avise que isso quebra ancestralidade; não tagueie. O usuário deve resolver manualmente.

### B.2 Tag leve (dispara CI)

```bash
git tag vVER <main-tip-sha> && git push origin vVER
git cat-file -t vVER   # confirma "commit" (tag leve, igual à convenção)
```

O push da tag dispara `.github/workflows/release.yml`, que faz:

1. Build cross-platform (ubuntu/Windows/macOS via electron-builder)
2. Coleta artifacts (`*.AppImage`, `*.exe`, `*.dmg`)
3. Cria GitHub Release com `--generate-notes` (notas auto-geradas dos PRs mergeados)

**NÃO crie release manualmente** — o CI é o source of truth.

### B.3 Monitorar o CI

Após o push da tag, verifique que o workflow foi enfileirado:

```bash
gh run list --workflow release --limit 3 --json status,name,url
```

Reporte ao usuário:

- Tag `vVER` pushed → `main`
- Workflow CI em andamento: link pra Actions
- Release será publicado automaticamente quando os 3 builds completarem

Se precisar editar as notas depois (ex: adicionar highlights manuais), use a UI do GitHub após o CI completar — `gh release edit vVER --notes-file ...`.

### B.4 Confirmar e reportar (após CI completar)

```bash
gh release view vVER --json tagName,name,targetCommitish,url
```

Confirme:

- Target `main`
- Artifacts anexados (Linux AppImage, Windows `.exe`, macOS `.dmg`)
- Notas auto-geradas presentes

Reporte ao usuário: versão na main, tag, link do GitHub Release.

### B.5 Back-merge `main` → `develop` (higiene de ancestralidade — obrigatório)

Depois do release selado, traga o merge commit do promote de volta pra `develop`. Mesmo com merge commit correto, a `main` fica **1 commit à frente** da `develop` (o commit do promote vive só na main) → sem o back-merge, o próximo `/release` reincide em "DIVERGED" + `-s ours`.

- Abra um PR **`main` → `develop`** (head=`main`, base=`develop`):
  ```bash
  gh pr create --base develop --head main \
    --title "chore: back-merge main into develop after vVER" \
    --body "Content-neutral back-merge so main is an ancestor of develop again (keeps future promotes clean, no -s ours)."
  ```
- É **content-neutral** — `main` e `develop` têm árvores idênticas pós-release (0 arquivos). Valide: `gh pr view <n> --json files --jq '.files|length'` deve ser `0`.
- Merge com **`--merge`** (merge commit — **NUNCA** squash; squash não registra a `main` como parent e mantém o drift): `gh pr merge <n> --merge --admin`. **Não** use `--delete-branch` (o head é a `main`).
- Confirme: `git merge-base --is-ancestor origin/main origin/develop` → verdadeiro. Próximo promote cai no caminho **CLEAN** (A.3), sem `-s ours`.

## Governança (sempre lembrar)

- **Releases saem SEMPRE do `develop`** e o promote usa **merge commit** (nunca squash/rebase — o ruleset da `main` bloqueia). **Squash no promote cria commit de parent único e quebra a ancestralidade** — foi a causa do drift que exigiu `-s ours` (v0.10.0 e de novo no v0.12.0, quando o promote do v0.11.1 / #497 entrou squashed).
- **Back-merge `main` → `develop` após cada release (B.5)** é o que mantém a `main` ancestral e evita o "DIVERGED" reincidir. Pular esse passo é a causa mais comum do drift recorrente.
- O `-s ours` (A.3) só existe pra consertar drift histórico (squash antigo ou back-merge esquecido). Se precisou dele, **valide diff-vazio vs `develop`** e documente o porquê no corpo da PR.

## Quando NÃO usar /release

- Promover uma feature branch pra `develop` (isso é o fluxo normal de PR, não release).
- Hotfix direto na `main` (fora do escopo deste comando; trataria como exceção manual).
