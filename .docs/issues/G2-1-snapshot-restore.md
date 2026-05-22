# G2-1 — Snapshot/restore por turno do AI

> **Parte do milestone:** G2 — Trust safety net
> **PRD:** `.docs/specs/G2-trust-safety-net.md`
> **Sub-issues (children):** #56 (G2-2) e #57 (G2-3) — ambas dependem desta entregar.
> **Parent:** nenhum (esta é a base da hierarquia G2).
> **Tamanho:** M — ~3-5 dias

## User Story

Como usuário não-técnico do obsclone, quero que o app preserve automaticamente uma cópia anterior de cada arquivo antes do agente modificá-lo, e que eu possa ver e restaurar versões antigas em poucos cliques sem usar terminal, para que um erro do agente nunca cause perda permanente do meu trabalho.

---

## Cenário atual

- **`file:write` é `fs.writeFile` puro** (`electron/main.ts:319-321`) — sem snapshot, sem backup, sem versionamento. Toda escrita do renderer sobrescreve direto.
- **Zero código de versionamento** — `grep -rni 'snapshot|restore|checkpoint' src/ electron/` retorna apenas resultados de versionamento de NPM, nada de salvaguarda de arquivos.
- **Única rede de segurança é `path:trash`** (`electron/main.ts:521-523`) que só dispara em deleção manual do usuário via menu — não cobre sobrescritas do agente nem reescrita automática de links.
- **Watcher externo** (`electron/main.ts:267-291` + `src/App.tsx:333-355`) detecta mudanças no disco e substitui o buffer do editor sem snapshotar a versão anterior.

## Problema

Quando o agente reescreve um arquivo (via tool call no PTY, via IPC, ou via stream de mudanças), a versão anterior é descartada para sempre. Não há repositório de versões, não há histórico, não há undo entre saves. A vision (`.docs/audit/vision.md` linhas 53-55) afirma: "Persistent, visual snapshot+restore must be P0, not future feature" — mas o produto entregue tem o oposto.

## Consequências do problema

- **Dano permanente no primeiro erro do agente.** Sem caminho de recuperação, qualquer "melhore esse texto" que sai mal é definitivo.
- **Bloqueador para G2-2 e G2-3.** Sem snapshot, as confirmações de rename e o diff de hot-reload prometem "undo" que não existe — viraria mock.
- **Contradiz P0 da vision.** O gap mais explícito do produto contra a tese estratégica.
- **Usuário precisa fazer cópias defensivas manuais** — exatamente a fricção que o app prometia eliminar.

## O que devemos fazer para resolver (em alto nível)

**Storage**
- Estrutura: `<vault>/.marvin/snapshots/<turn-id>/<rel-path>`
- Manifesto: `<turn-id>/_manifest.json` → `{ files: [{ relPath, sizeBefore, hashBefore }], createdAt, trigger, agentId? }`
- `.marvin/` no `.gitignore` padrão

**Captura (MVP sem cooperação do CLI)**
- Hook no watcher (`electron/main.ts:267-291`): antes de emitir `file:changed`, se "turno do AI ativo" (PTY ocupado nos últimos N segundos), grava versão anterior.
- Hook no `file:write` (`electron/main.ts:319-321`): snapshot pré-escrita do conteúdo anterior se existir.
- Quando stream-json chegar (P0 #1 da vision), migra para captura cooperativa por `tool_use` events.

**UI**
- `SnapshotPanel.tsx` (modal/lateral) — lista versões por nota com diff lado a lado + botão "restaurar".
- `DiffViewer.tsx` — componente reusável (também usado por G2-2 e G2-3).
- Menu de contexto na file tree: "Ver versões…".
- Toast ao fim do turno: "Claude alterou Foo.md e Bar.md (ver / restaurar)".

**Retenção**
- Default: 50 turnos OU 7 dias (o menor), cap de 200 MB. Configurável.
- GC no boot + a cada N horas. Snapshots expirados vão para `shell.trashItem` (recuperáveis no Trash do OS).

**Implicação técnica**
- Novo módulo: `electron/snapshot.ts` (read/write/list/restore, manifest CRUD, GC).
- Novos IPC: `snapshot:listTurns`, `snapshot:listForFile`, `snapshot:read`, `snapshot:restore`.
- Novos componentes: `SnapshotPanel.tsx`, `DiffViewer.tsx`.

## Resultado esperado com a solução

- Usuário consegue restaurar arquivo sobrescrito pelo agente em **≤ 3 cliques sem terminal** (menu → versão → restaurar).
- Toda escrita do agente em arquivo existente gera snapshot prévio — verificável via teste de integração.
- Painel de versões mostra ≥ últimos 50 turnos ou 7 dias, com diff visual.
- Restauração também snapshota a versão atual antes (permite "desfazer o desfazer").
- GC mantém o cap de storage abaixo do limite configurado.

---

**Labels:** `P0`, `trust`, `non-tech-user`, `snapshot-restore`
**Referências:** `.docs/specs/G2-trust-safety-net.md`, `.docs/audit/vision.md:53-55`, `.docs/audit/05-risks.md:18-32`
