---
description: Emite um PredictionVector do complexity harness para uma issue, fora do /squad (não-fatal)
argument-hint: <número da issue> (ex: 432)
---

# /harness:predict — Emitir predição da Fase 1 independente do /squad

Entrada: $ARGUMENTS (número da issue alvo)

Este comando faz o que o `/squad` Passo 1.6 faz, mas **avulso** — para qualquer
issue, sem precisar montar um time. Útil para issues criadas via `/issues:create`
ou à mão, que de outra forma não entrariam no ledger.

## Quando rodar

**No work-start, depois de criar a branch da issue** (`gh issue develop <n> --base develop --name <type>/<slug> --checkout`). A predição é gravada no ledger **na feature branch**, então ela commita junto com o trabalho e mergeia pela PR da issue — exatamente como no squad. Não rode em `develop` direto (governança: não commitar em develop).

## Princípio

**Tudo aqui é NÃO-FATAL (§1.9).** Se qualquer passo falhar (CLI erra, sinal
faltando, sem branch), registre o que conseguiu ou pule e siga. Emitir JAMAIS
trava o trabalho. Independência §1.6: quem prediz ≠ quem implementa ≠ quem mede.

## Passos

1. **Ler a issue** alvo: `gh issue view <n> --json title,body,labels`. Dela saem `predicted_size` (do header `Tamanho:`), `spec_branch_count` (cenários da Acceptance Criteria), riscos (de Consequências).

2. **Versão do harness:** `npx tsx scripts/complexity/harness-version.ts claude-opus-4-8`.

3. **StructuralSignals — `measured`, rodando tools de verdade** (comando exato em `evidence`):
   - `downstream_fanout`: importadores ATUAIS do(s) arquivo(s) tocados (`grep -rl "from '.*<módulo>'" src electron`) **+ as arestas que a mudança INTRODUZ** (se a solução faz N arquivos passarem a importar um módulo, some essas N). Medir só o grafo atual subestima o blast radius — #429 previu 3, real 5 (+2 imports adicionados pela própria mudança).
   - `upstream_fanout`: nº de imports nesses arquivos — `grep -c "^import" <arquivo>`.
   - `domains_touched`: pelos paths, dentre `chat · editor · file-tree · viewers · terminal · state-ui`.
   - `touches_shared_contract`: toca `electron/preload.ts`, `src/types.ts` ou IPC consumido por outros?
   - `touches_nondeterministic`: toca prompt/IA em produção (`electron/agent/**`, chat)?
   - `max_node_centrality`: **`null`** — não estimar (§1.3).

4. **AgentSignals — da sua leitura da issue:**
   - `rounds_to_convergence`, `risks_raised` (com `severity`), `uncovered_angles_count`, `spec_branch_count`.
   - **Limitação honesta:** fora do `/squad` há **menos deliberação multi-agente**, então `rounds_to_convergence` ≈ 1 e `disagreement_score` fica `null`. Os `StructuralSignals` (`measured`) continuam fortes; os `AgentSignals` são mais fracos. Não é defeito — registre como está, não infle.

5. **Alvos + roteamento:** `predicted_size` / `predicted_iterations` / `predicted_decision_density`, `prediction_confidence`, `assigned_oversight` (`autonomous` trivial / `light_review` padrão / `deep_review` se denso), `assigned_to: null`.

6. **Emitir:**
   ```bash
   echo '<PredictionVector JSON>' | npx tsx scripts/complexity/record-prediction.ts
   # exit 0 = registrado · 1 = inválido · 2 = vazio. exit != 0 → logue e siga.
   ```

7. **Commit na feature branch** (a row vai junto com o trabalho):
   ```bash
   git add _complexity-ledger/predictions.jsonl
   git commit -m "chore: record prediction for #<n>"
   ```

Contrato + exemplo: `scripts/complexity/README.md`, `scripts/complexity/schema.ts`.
