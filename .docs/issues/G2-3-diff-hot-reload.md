# G2-3 — Diff visível em hot-reload externo (em vez de recarga silenciosa)

> **Parte do milestone:** G2 — Trust safety net
> **PRD:** `.docs/specs/G2-trust-safety-net.md`
> **Parent:** #55 (G2-1 — Snapshot/restore por turno do AI). Esta sub-issue não pode entrar antes do snapshot existir, porque qualquer decisão do usuário no banner (recarregar / manter meu / merge) precisa snapshotar a versão descartada.
> **Sub-issues (children):** nenhuma.
> **Tamanho:** M — ~3-4 dias

## User Story

Como usuário não-técnico do obsclone, quero ver exatamente o que foi alterado em um arquivo que estou editando quando o agente (ou outro processo) o modifica, e quero escolher se aceito, rejeito ou faço merge dessas mudanças, para que o texto que estou lendo não desapareça da tela sem aviso.

---

## Cenário atual

- `electron/main.ts:267-291` (watcher Chokidar) detecta mudanças no disco e emite evento ao renderer.
- `src/App.tsx:333-355` lê o conteúdo fresco, compara com `lastDiskContentRef` e — se diferente — **substitui o buffer do editor** e incrementa `version`. Sem notificação, sem diff, sem opção.
- O comentário do próprio código (linhas 278-279) reconhece o gap: "precisamos distinguir 'nossos saves' de 'external writes (claude editing the note)'".

## Problema

Quando o agente reescreve um arquivo aberto no editor enquanto o usuário está lendo ou editando, o conteúdo da tela é substituído em silêncio. Não há banner, não há diff, não há "aceitar / rejeitar". A reação subjetiva do usuário não-técnico é "meu texto sumiu" — indistinguível de um bug catastrófico.

## Consequências do problema

- **Percepção de bug grave.** O usuário vê texto que estava na tela ser substituído sem ação dele → conclui que o app está quebrado ou perigoso.
- **Bloqueia trabalho em paralelo com agente.** Para evitar o efeito, o usuário aprende a não abrir notas enquanto o agente está rodando — desperdiça o paralelismo que a vision promete.
- **Conflito implícito perdido.** Se o usuário fez edits no buffer e o agente também escreveu no disco, o buffer simplesmente vence ou perde, sem 3-way merge.
- **Sem percepção de o que mudou.** Mesmo quando o reload "está correto", o usuário não tem como saber o que o agente alterou para verificar a qualidade.

## O que devemos fazer para resolver (em alto nível)

**Identificação de origem**
- No watcher (`electron/main.ts:267-291`), tagueia evento com `source: "agent" | "external"`:
  - `"agent"` se PTY do agente está ativo nos últimos N segundos.
  - `"external"` caso contrário (editor externo, sync, git pull).
- Evento envia também `diskContent` e `diskChangedAt` para o renderer.

**UI — banner não-modal por aba**
- Em vez de substituir o buffer, renderer expõe `{ diskContent, diskChangedAt, diskChangeSource }` no estado da aba.
- `ExternalChangeBanner.tsx` no topo do editor: "Este arquivo foi modificado fora do editor (Claude · agora há pouco) — Ver diff / Recarregar / Manter minha versão"
- **Ver diff:** split-view com `DiffViewer.tsx` (reusado de G2-1). Botões: "aceitar disco", "manter meu", "merge manual".
- **Recarregar:** substitui buffer (comportamento atual), mas snapshota a versão antiga primeiro.
- **Manter minha versão:** marca aba como "dirty + diverged". No próximo save, sobrescreve o disco (com snapshot da versão do disco antes).

**Caso especial sem edits pendentes**
- Se o buffer não tem mudanças locais (não está dirty), recarga é segura — faz reload + toast discreto "Foo.md atualizado (Claude)" em vez de banner bloqueante.

**Integração com G2-1**
- Toda decisão do usuário (recarregar / sobrescrever / merge) snapshota a versão que será descartada.

**Implicação técnica**
- Modificar handler em `src/App.tsx:333-355`: setar `{ diskContent, diskChangedAt, diskChangeSource }` em vez de substituir buffer.
- Modificar watcher para incluir `source` no evento.
- Novo componente: `ExternalChangeBanner.tsx`.
- Reusa `DiffViewer.tsx` da G2-1.

## Resultado esperado com a solução

- Arquivo modificado externamente **com buffer dirty** sempre exibe banner — nunca substitui silenciosamente. Verificável via teste E2E.
- Usuário consegue ver diff entre buffer e disco em ≤ 2 cliques.
- "Manter minha versão" preserva edits e sobrescreve disco no próximo save, com snapshot da versão do disco.
- Origem da mudança aparece no banner ("Claude" vs "External") quando detectável.
- Buffer sem mudanças locais ainda recarrega automaticamente, mas com toast — usuário fica ciente.

---

**Labels:** `P0`, `trust`, `non-tech-user`, `hot-reload`
**Referências:** `.docs/specs/G2-trust-safety-net.md`, `.docs/audit/05-risks.md:27`, `electron/main.ts:267-291`, `src/App.tsx:333-355`
