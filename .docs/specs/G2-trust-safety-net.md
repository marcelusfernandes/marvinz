# G2 — Trust safety net (PRD)

> **Tipo:** PRD/RFC estratégico — escopo do gap, justificativa, ACs de produto.
> **Execução:** 3 issues filhas no GitHub (uma por frente), agrupadas no milestone **"G2 — Trust safety net"**. Ver `.docs/issues/G2-1-snapshot-restore.md`, `G2-2-confirmacao-rename.md`, `G2-3-diff-hot-reload.md`.

## User Story

Como usuário não-técnico do obsclone, quero que o app capture snapshots automáticos do vault antes de qualquer mudança (rename de pasta com reescrita de links, escrita do agente, reload externo) e ofereça forma visual e simples de inspecionar o que mudou e restaurar versões anteriores, para que eu possa usar o agente de forma ambiciosa sem medo de acidentes irreversíveis e para que "algo mudou sem eu pedir" não resulte em paralisia ou perda de confiança na app.

---

## Cenário atual

O obsclone v0.8.0 tem **quatro vetores ativos de mudança silenciosa** no código que quebram a confiança do usuário não-técnico:

### Vetor 1 — Rewrite global de links em rename (sem confirmação, sem preview, sem undo)

**Código:** `electron/main.ts:485-505` (`rewriteLinksAfterMove`), disparado via `electron/main.ts:507-519` (`ipcMain.handle('path:rename', …)`).

Ao renomear uma pasta, o app percorre automaticamente **todos** os markdown do vault e reescreve links sem confirmação, sem preview, sem undo. Em um vault de 500 notas com 50 backlinks, modifica 50 arquivos silenciosamente. Erros mid-walk são engolidos (try/catch linha 500-502) sem reportar ao usuário quantos arquivos foram tocados.

**Momento concreto:** Usuária renomeia pasta "Prompts de Vendas" → "Scripts de IA". Outras notas que linkam para a pasta anterior foram reescritas silenciosamente. Ela não pediu, não sabia que aconteceria. Para ela: "o app mudou coisas que eu não autorizei".

---

### Vetor 2 — Hot-reload silencioso de arquivo modificado externamente (sem avisar, sem diff, sem opção de rejeitar)

**Código:** `electron/main.ts:267-291` (watcher via Chokidar), disparado ao arquivo mudar no disco. Reação do renderer em `src/App.tsx:333-355` — lê conteúdo fresco, compara contra `lastDiskContentRef`, e se mudou, substitui o buffer do editor e incrementa `version`. **Nenhuma notificação ao usuário, nenhum diff, nenhum botão "ver o que mudou".**

O próprio autor do código reconhece a necessidade (comentário linhas 278-279): "precisamos distinguir 'nossos saves' de 'external writes (claude editing the note)'". Mas a UX implementada é "trocar o buffer sem avisar".

**Momento concreto:** Usuário está editando uma nota no app enquanto o agente trabalha em paralelo. O agente termina de reescrever aquele arquivo. O app detecta a mudança, recarrega o conteúdo e substitui o buffer do editor — o texto que o usuário via na tela é substituído pelo que o agente escreveu, sem aviso. Para o usuário não-técnico, isso é indistinguível de "o aplicativo deletou o que eu estava lendo".

---

### Vetor 3 — `file:write` direto, sem snapshot pré-escrita

**Código:** `electron/main.ts:319-321` (`ipcMain.handle('file:write', …)`) é um `fs.writeFile` puro. Sem snapshot, sem backup, sem versionamento. O `file:write` está exposto via preload (`electron/preload.ts:34-35`) — qualquer caminho de código no renderer pode invocá-lo, e qualquer agente CLI rodando no PTY usa suas próprias tools de escrita (fora do IPC). Em nenhum dos casos há snapshot prévio.

---

### Vetor 4 — `path:trash` é o único safety net (cobre apenas deleção pelo usuário, não sobrescrita do agente)

**Código:** `electron/main.ts:521-523` (`ipcMain.handle('path:trash', …)`) — `shell.trashItem(target)` vai para a Lixeira do OS. Recuperável, mas:
- Só dispara quando o usuário deleta via menu de contexto da app.
- **Não cobre** sobrescrita destrutiva via `file:write`, reescrita via `rewriteLinksAfterMove`, ou deleção via tool call do agente.
- Lixeira do OS pode ser esvaziada automaticamente (macOS: preferência "delete after 30 days").

---

### Momento 3 — O acidente sem volta

Usuário pede ao agente para "melhorar o texto" de um documento importante — um plano de negócios que ele levou três semanas construindo. O agente reescreve o arquivo inteiro. O resultado está incorreto ou perdeu partes que o usuário valorizava. Ele procura "Ctrl+Z" — não funciona para isso. Ele procura "histórico de versões" — não existe. O único recurso que o app tem é mover arquivos para a Lixeira do sistema operacional, mas apenas quando o próprio usuário deleta manualmente. Quando a AI reescreve um arquivo, nenhuma cópia anterior é preservada em lugar nenhum. Para um usuário técnico, existe o git. Para o usuário alvo do obsclone, não existe nada.

---

## Problema

A vision (linhas 53-55) estabelece como P0 de trust: **"When AI deletes something important, they will not investigate `.git/objects`. Persistent, visual snapshot+restore must be P0, not future feature."**

Hoje, **snapshot e restore não existem no código** (`grep -rni 'snapshot\|restore\|checkpoint' src/ electron/` retorna zero ocorrências de versioning).

O app tem **dois novos vetores de mudança silenciosa** que agrava a situação:
1. Rewrite global de links em rename (modifica dezenas de arquivos sem avisar).
2. Hot-reload silencioso de arquivo aberto (substitui buffer sem diff ou opção de rejeitar).

Somados ao `file:write` sem snapshot e ao `path:trash` que só cobre deleção do usuário, resulta em **zero caminhos de recuperação** quando o agente sobrescreve um arquivo importante e o usuário quer desfazer.

A ausência de snapshot não é uma limitação técnica que o usuário contorna — é uma parede que transforma qualquer erro do agente em dano permanente.

---

## Consequências do problema

### Comportamento do usuário não-técnico

1. **Quebra imediata de confiança no primeiro acidente.** O usuário não-técnico não tem modelo mental de "arquivo sobrescrito por processo externo". Quando algo some ou muda sem ação deliberada dele, a conclusão é que o app é defeituoso ou perigoso. A primeira ocorrência tende a ser a última sessão — o usuário fecha e não volta. **Churn permanente.**

2. **Medo de delegar tarefas ambiciosas ao agente.** O usuário aprende rápido que dar uma instrução ao agente pode causar mudanças inesperadas em arquivos que ele nem sabia que seriam afetados. O resultado é paralisia: em vez de usar o agente de forma ousada ("reorganize minha pasta de projetos"), ele passa a usar só para tarefas triviais onde o risco parece menor. **O principal valor do produto — o loop de agente nativo — é subutilizado por medo.**

3. **Necessidade de fazer cópias manuais defensivas.** Sem snapshot automático, o usuário aprende na marra a duplicar o arquivo antes de pedir ao agente para alterá-lo. Isso cria fricção, sujeira no vault e uma carga cognitiva que o obsclone prometia eliminar. **O usuário está fazendo o trabalho que o app deveria fazer por ele.**

4. **Impossibilidade de inspecionar o que foi alterado em batch.** Quando o agente muda vários arquivos de uma vez (como na reescrita de links após rename), o usuário não tem como saber o que foi tocado, o que foi modificado, e se as mudanças fazem sentido. Sem diff visual, sem log estruturado, ele fica no escuro. **Para comparar, precisaria abrir cada arquivo e ler — inviável para vaults com dezenas de notas.**

5. **Sem caminho de recuperação quando algo dá errado.** O cenário de erro mais importante não tem solução: conteúdo sobrescrito pelo agente está perdido. O usuário não-técnico não sabe o que é git, não vai abrir o terminal para explorar `.git/objects`, e provavelmente nem tem o repositório configurado. **A ausência de snapshot não é um nice-to-have — é um bloqueador de retenção.**

### Impacto de negócio

- **Contradição direta com P0 da vision (linhas 53-55).** A vision afirma que snapshot+restore é P0 porque "when AI deletes something important, they will not investigate `.git/objects`". Hoje, exatamente o oposto acontece: não há snapshot, há novos vetores de mudança silenciosa, e o usuário não-técnico está vulnerável.

- **Severidade alta porque v0.8.0 já é distribuível.** `.docs/audit/05-risks.md:32` aponta: "Severidade: alta agora, porque a v0.8.0 já é distribuível (electron-builder configurado, releases recentes — `c975c7d`, `48ce5f2`, `aa5600c`). Se chegar a um non-tech user hoje, o primeiro acidente é catastrófico para retenção."

---

## O que devemos fazer para resolver (em alto nível)

Três frentes **independentes mas sequenciais**, cada uma entregável em PR separada. A frente 1 é a base — frentes 2 e 3 dependem dela para o undo funcionar de verdade.

### Frente 1 — Snapshot/restore por turno do AI

**O quê e por quê:** Antes de qualquer mudança (rename com rewrite de links, hot-reload externo, write do agente), capturar o estado anterior do arquivo em versão estruturada e recuperável. Isso cria uma rede de segurança — se algo der errado, o usuário consegue restaurar em poucos cliques sem terminal.

**Onde guardar:**
- Estrutura: `<vault>/.marvin/snapshots/<turn-id>/<rel-path>`
- Manifesto por turno: `.marvin/snapshots/<turn-id>/_manifest.json` com `{ files: [{ relPath, sizeBefore, hashBefore }], createdAt, trigger: "watcher"|"stream-json", agentId? }`
- `.marvin/` entra no `.gitignore` padrão da app

**Como capturar (MVP — sem cooperação do CLI):**
- Heurística via watcher: antes de a app atualizar o buffer em `src/App.tsx:333-355`, o main process lê o conteúdo atual do disco e, se houver um "turno do AI ativo" (PTY do agent está ocupado / recebeu input nos últimos N segundos), grava a versão anterior como snapshot.
- Quando stream-json chegar (P0 #1 da vision), migra-se para captura cooperativa: observa eventos `tool_use` de tipo `Write/Edit/Bash` e abre turno no início da mensagem do AI.

**Como expor visualmente:**
- **Indicador discreto no TopBar:** "AI tocou 3 arquivos neste turno — ver". Some após N segundos ou ao clicar "ok".
- **Painel de versões (modal/lateral):** "Versões anteriores desta nota" — lista de turnos com timestamp + agent. Cada item abre diff lado a lado. Botão "restaurar esta versão" (restaura com novo snapshot da versão atual antes).
- **Menu de contexto na file tree:** "Ver versões…"
- **Notification toast ao fim do turno do AI:** "Claude alterou Foo.md e Bar.md (ver / restaurar)". Não é modal.

**Política de retenção:**
- Default: últimos **50 turnos** OU últimos **7 dias**, o que for menor. Configurável em settings.
- GC roda no boot e a cada N horas: remove turnos > 7 dias e turnos além dos 50 mais recentes.
- Cap de **200 MB** por padrão (configurável). Acima disso, expira do mais antigo para o mais novo.
- Ao deletar snapshot via GC, vai para `shell.trashItem` (recuperável por mais alguns dias via OS).

**Implicação técnica:**
- Novo módulo no main: `electron/snapshot.ts` (read/write/list/restore, manifest CRUD, GC).
- Novo IPC: `snapshot:listTurns`, `snapshot:listForFile`, `snapshot:read`, `snapshot:restore`.
- Hook no watcher: antes de `send('file:changed', …)`, capturar snapshot se "turno ativo".
- Hook no `file:write`: snapshot pré-escrita.
- Novo componente React: `SnapshotPanel.tsx` + `DiffViewer.tsx`.

**Estimativa:** ~3-5 dias.

---

### Frente 2 — Confirmação visual antes de link rewrite em rename

**O quê e por quê:** Quando o usuário renomeia uma pasta com muitos backlinks, mostrar preview exato de quantos arquivos serão afetados e dar opção de aceitar / rejeitar / cancelar. Isso transforma uma ação silenciosa (rewrite de 50 arquivos sem aviso) em uma decisão consciente do usuário.

**UX:**
- **0 afetados:** rename direto, sem modal.
- **1-2 afetados:** toast informativo discreto após o rename "Atualizei links em 2 arquivos (desfazer)".
- **3+ afetados (threshold configurável):** modal bloqueante **antes** do rename:
  - Título: "Renomear 'Foo.md' afeta **17 arquivos**"
  - Lista expandível com preview das mudanças (5 primeiros visíveis, "ver todos" expande).
  - Botões: **Renomear e atualizar todos** / **Renomear, não tocar nos links** / **Cancelar**
  - Checkbox: "Não perguntar para menos de N arquivos"

**Implicação técnica:**
- Refator de `rewriteLinksAfterMove`: separar em `planRewrite(vault, old, new) → Plan` (read-only) e `applyRewrite(plan) → void` (writes).
- Novo IPC: `path:renamePreview(old, new)` e `path:renameApply(plan)`.
- Novo componente React: `RenameConfirmModal.tsx`.
- Integra com Frente 1: `applyRewrite` cria turno "user-rename" e snapshota cada arquivo antes de modificar.

**Estimativa:** ~2-3 dias.

---

### Frente 3 — Diff visível em hot-reload externo (em vez de recarga silenciosa)

**O quê e por quê:** Quando um arquivo aberto é modificado externamente (pelo agente, por outro device, por git pull), não recarregar silenciosamente. Em vez disso, mostrar banner com diff e deixar o usuário escolher aceitar, rejeitar ou fazer merge manual. Isso transforma um "buffer foi substituído sem você saber" em "veja exatamente o que mudou e decida".

**UX:**
- **Banner não-modal** no topo do editor da tab afetada: "Este arquivo foi modificado fora do editor (Claude · agora há pouco) — Ver diff / Recarregar / Manter minha versão"
- **Ver diff:** split-view, esquerda = buffer atual, direita = disco. Botões: "aceitar disco", "manter meu", "merge manual".
- **Recarregar:** comportamento atual (substitui buffer), mas snapshota a versão que estava no buffer antes.
- **Manter minha versão:** marca como "dirty + diverged". No próximo save, sobrescreve o disco (com snapshot da versão do disco antes).
- **Caso especial:** se arquivo não tem edits pendentes, recarga automática é segura + toast discreto "Foo.md atualizado (Claude)".
- **Identificação de origem:** heurística simples no main — se PTY do agente está ativo, tagueia evento com `source: "agent"`; senão `source: "external"`. O banner adapta texto.

**Implicação técnica:**
- Modificar handler em `src/App.tsx:333-355`: setar novo campo `{ diskContent, diskChangedAt, diskChangeSource }` em vez de sobrescrever.
- Novo componente React: `ExternalChangeBanner.tsx` + reutilizar `DiffViewer.tsx` da Frente 1.
- Marcar `source` nos eventos do watcher.
- Integra com Frente 1: cada decisão do user (recarregar / sobrescrever / merge) snapshota a versão que será "perdida".

**Estimativa:** ~3-4 dias.

---

### Ordem de entrega recomendada

1. **Frente 1 (Snapshot)** — base. Sem ela, "undo" nas frentes 2 e 3 é mock. **M** (~3-5 dias).
2. **Frente 2 (Confirmação em rename)** — quick win, baixo custo, gera confiança imediata. **S-M** (~2-3 dias).
3. **Frente 3 (Diff em hot-reload)** — fecha o ciclo, maior valor percebido pelo usuário. **M** (~3-4 dias).

**Total: ~8-12 dias para fechar G2 completo.** Pode ser entregue como 3 PRs sequenciais, cada uma independentemente útil.

---

## Resultado esperado com a solução

- **Usuário consegue restaurar arquivo sobrescrito pelo agente em até 3 cliques, sem usar terminal.** Clique 1: "Ver versões" no menu do arquivo. Clique 2: seleciona versão anterior na lista. Clique 3: "Restaurar". Fim.

- **Rename que afeta 3+ arquivos exibe preview com lista exata antes de modificar, e permite cancelar.** O usuário vê exatamente quantos arquivos serão tocados, quais são, e o quê vai mudar em cada um. Pode cancelar, aceitar total, ou pedir para renomear sem mexer nos links.

- **Arquivo modificado externamente aparece como diff revisável em vez de substituir o buffer silenciosamente.** Banner discreto no topo da tab com botões "ver diff / recarregar / manter minha versão". Usuário controla a decisão — não é automático.

- **Primeiro acidente deixa de causar churn permanente — usuário vê caminho de recuperação visível e simples.** Se o agente bagunça algo importante, o usuário consegue restaurar em segundos via painel de versões. Confiança não é quebrada irreversivelmente.

- **Gap G2 fechado contra vision P0 (linhas 53-55): "Persistent, visual snapshot+restore must be P0"** A solução implementa snapshot persistente + restore visual com uma rede de segurança que cobre os três principais vetores de mudança silenciosa.

---

## Alinhamento com vision

- `.docs/audit/05-risks.md:148` propõe ~2 dias para snapshot. Estimativa maior aqui (~8-12 dias) porque inclui painel visual, retention/GC, integração com todas as frentes, e componentes de diff.
- Vision lista snapshot + restore como **P0 #1 de trust** — solução alinha diretamente.
- Solução não cobre deleção de arquivo completo (Vetor 4) — `path:trash` continua sendo a rede para unlink. Deleção via AI é Frente 4 separada, fora do escopo do G2.
- Não substitui git. Snapshots são para "antes do AI bagunçar (últimos 7 dias)"; git continua sendo a fonte de verdade para versionamento de longo prazo.

---

## Aceitação

- Issue entra como `P0` (alinhada com vision de trust como bloqueador de retenção).
- Labels: `trust`, `non-tech-user`, `snapshot-restore`.
- Assignee: Engineering squad após PM confirmar prioridade com founder.
