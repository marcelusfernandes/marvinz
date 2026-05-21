# G2-2 — Confirmação visual antes de link rewrite em rename

> **Parte do milestone:** G2 — Trust safety net
> **PRD:** `.docs/specs/G2-trust-safety-net.md`
> **Parent:** #55 (G2-1 — Snapshot/restore por turno do AI). Esta sub-issue não pode entrar antes do snapshot existir, porque o "undo" do rename depende dele.
> **Sub-issues (children):** nenhuma.
> **Tamanho:** S-M — ~2-3 dias

## User Story

Como usuário não-técnico do obsclone, quero ver exatamente quantos e quais arquivos serão modificados antes de renomear uma pasta ou nota, para que eu possa autorizar conscientemente a mudança em vez de descobrir depois que dezenas de notas foram reescritas sem eu pedir.

---

## Cenário atual

- `electron/main.ts:485-505` (`rewriteLinksAfterMove`) percorre **todos** os markdown do vault após `path:rename` (`electron/main.ts:507-519`) e reescreve links sem preview, sem confirmação, sem undo.
- Erros mid-walk são engolidos (try/catch linha 500-502) — o usuário não sabe quantos arquivos foram tocados nem quais falharam.
- Em um vault de 500 notas com 50 backlinks para uma pasta, renomear essa pasta modifica 50 arquivos silenciosamente em uma única operação.

## Problema

A operação de rename produz duas mudanças que o usuário **não autorizou explicitamente**: (a) o rename em si, que ele pediu, e (b) a reescrita em cascata de links em outros arquivos, que ele não sabia que aconteceria. Não há janela para inspecionar, para cancelar, ou para escolher renomear sem mexer nos links.

## Consequências do problema

- **Quebra de confiança:** "o app mudou coisas que eu não autorizei" — quebra direta do contrato implícito de "só mexe no que eu peço".
- **Impossibilidade de auditoria pós-fato.** Sem log estruturado, sem diff, o usuário não consegue saber o que foi tocado para revisar.
- **Erros se propagam silenciosamente.** Se a heurística de rewrite errar em 1 arquivo, vira link quebrado descoberto semanas depois.
- **Bloqueia uso ousado da feature.** Usuário aprende a evitar rename de pastas com muitos backlinks → reorganização do vault fica congelada.

## O que devemos fazer para resolver (em alto nível)

**Refator do path:rename**
- Separar `rewriteLinksAfterMove` em duas funções: `planRewrite(vault, old, new) → RewritePlan` (read-only — retorna lista de arquivos + previews dos diffs) e `applyRewrite(plan) → void` (writes).
- Novos IPC: `path:renamePreview(old, new)` e `path:renameApply(plan)`.

**UX por threshold de impacto**
- **0 afetados:** rename direto, sem modal.
- **1-2 afetados:** rename + toast informativo "Atualizei links em N arquivos (desfazer)".
- **3+ afetados (threshold configurável em settings):** modal bloqueante **antes** do rename:
  - Título: "Renomear 'Foo.md' afeta **17 arquivos**"
  - Lista expandível: 5 primeiros visíveis, "ver todos" expande.
  - Botões: **Renomear e atualizar todos** / **Renomear, não tocar nos links** / **Cancelar**
  - Checkbox: "Não perguntar para menos de N arquivos"

**Integração com G2-1**
- `applyRewrite` cria turno `"user-rename"` no snapshot store e snapshota cada arquivo afetado antes da escrita.
- Botão "desfazer" no toast → restaura via snapshot.

**Implicação técnica**
- Refator de funções existentes (`rewriteOneFile`, `rewriteWikilinksOneFile`) para retornar plan em vez de aplicar direto.
- Novo componente: `RenameConfirmModal.tsx`.
- Settings novos: threshold de "quantos arquivos antes de abrir modal".

## Resultado esperado com a solução

- Rename que afeta 3+ arquivos **sempre** mostra preview antes de modificar — verificável via teste E2E.
- Usuário pode cancelar a operação no modal sem deixar lixo no FS.
- Usuário pode escolher "renomear sem mexer nos links" como opção explícita.
- Toast de undo restaura o estado anterior usando snapshots de G2-1.
- Configuração permite ao usuário power-user desabilitar o modal para casos rotineiros (threshold alto).

---

**Labels:** `P0`, `trust`, `non-tech-user`, `link-rewrite`
**Referências:** `.docs/specs/G2-trust-safety-net.md`, `.docs/audit/05-risks.md:26`, `electron/main.ts:485-519`
