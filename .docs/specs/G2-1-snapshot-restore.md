# G2-1: Snapshot/Restore por Turno do AI

## Visão Geral

Permitir que usuários visualizem e restaurem versões anteriores de arquivos modificados pelo AI em cada turno, sem necessidade de terminal ou integração com CLI. MVP implementa detecção heurística de turnos ativos do AI (sem cooperação do CLI) com retenção incremental.

---

## User Story

Como um **usuário do Marvin**, quero **visualizar versões anteriores de arquivos que Claude alterou em cada turno e restaurá-los com ≤3 cliques**, para que eu **possa reverter mudanças indesejadas rapidamente sem perder histórico**.

---

## Acceptance Criteria (Mensuráveis)

### Funcionalidade

- **AC1**: Snapshot é criado automaticamente antes de cada escrita do AI em arquivo existente
- **AC2**: Cada snapshot é armazenado em `<vault>/.marvin/snapshots/<turn-id>/<rel-path>` com manifest em JSON
- **AC3**: Interface mostra lista de turnos ≥ 50 ou ≥ 7 dias (whichever is earlier), máx 200 MB total
- **AC4**: Usuário restaura arquivo anterior em **≤ 3 cliques** (abrir painel → selecionar versão → confirmar)
- **AC5**: Toast de notificação ao fim de turno: "Claude alterou X.md e Y.md (ver / restaurar)"

### Robustez

- **AC6**: Snapshots de arquivo novo (primeira escrita) não são criados
- **AC7**: Falha de I/O em snapshot não bloqueia escrita do arquivo principal
- **AC8**: Conflito com `path:trash` é evitado: snapshots preservados mesmo após exclusão
- **AC9**: Arquivo binário é skippado; arquivo texto snapshottado sem limite de tamanho (cap 10 MB com warning)
- **AC10**: Vault não inicializado → graceful degradation (sem snapshots, sem erro)
- **AC11**: Garbage collection remove snapshots antigos/excedentes sem race condition

### Detecção de Turno

- **AC12**: "Turno do AI ativo" é definido como **PTY write nos últimos 2 segundos** (constante `AI_TURN_WINDOW_MS = 2000`). A heurística captura writes rápidas em série E pausas curtas legítimas (tool calls). O critério antigo "< 100 ms entre writes" foi substituído por ser frágil em turnos com pausas naturais.
- **AC13**: "Fim de turno" é marcado quando há pausa > 500 ms desde a última escrita

---

## Estrutura de Storage

```
<vault>/.marvin/
├── snapshots/
│   ├── <turn-id>/
│   │   ├── file1.md
│   │   ├── file2.md
│   │   └── manifest.json
│   ├── <turn-id>/
│   │   └── manifest.json
│   └── gc.lock (para coordenação de GC)
└── metadata.json (estado global)
```

### Manifest Schema

Cada `<turn-id>/manifest.json`:

```json
{
  "turnId": "20250521T120345Z-abc123def456",
  "timestamp": 1716282225000,
  "trigger": "watcher" | "file:write" | "restore",
  "files": [
    {
      "relPath": "notes/daily.md",
      "size": 1024,
      "hash": "sha256-abc123...",
      "originalPath": "<vault>/notes/daily.md"
    }
  ],
  "status": "active" | "completed"
}
```

**Campos:**
- `turnId`: Identificador único + ordenável (timestamp ISO + salt)
- `timestamp`: Milliseconds desde epoch (quando turno iniciou)
- `trigger`: Qual evento disparou este snapshot:
  - `"file:write"`: Hook em `file:write` (task #4)
  - `"watcher"`: Watcher externo com PTY check (task #5)
  - `"restore"`: Snapshot-before-restore (task #2)
- `files`: Conteúdo snapshottado antes de escrita
- `status`: `"active"` enquanto PT está recebendo escritas; `"completed"` quando pausou > 500ms

### Metadata Global

`<vault>/.marvin/metadata.json`:

```json
{
  "version": 1,
  "lastGC": 1716282225000,
  "totalSnapshots": 52,
  "totalBytes": 198765432,
  "activeRuns": [
    {
      "runId": "20250521T120345Z-ai-uuid",
      "startedAt": 1716282225000,
      "lastWrite": 1716282325000,
      "fileCount": 5
    }
  ]
}
```

---

## Contratos IPC

### `snapshot:listTurns`

**Request:**
```typescript
window.marvin.snapshot.listTurns(vaultPath: string)
```

**Response:**
```typescript
Promise<{
  turnId: string
  timestamp: number
  fileCount: number
  totalSize: number
  files: string[] // rel paths
}[]>
```

**Error Handling:**
- Vault não existe → `MARVIN_NOT_A_VAULT`
- `.marvin` não inicializado → retorna `[]` (graceful)
- I/O erro → `MARVIN_IO_ERROR`

---

### `snapshot:listForFile`

**Request:**
```typescript
window.marvin.snapshot.listForFile(vaultPath: string, relPath: string)
```

**Response:**
```typescript
Promise<{
  turnId: string
  timestamp: number
  size: number
  hash: string
}[]>
```

**Error Handling:**
- Arquivo nunca foi snapshottado → retorna `[]`
- Vault erro → throw `MARVIN_IO_ERROR`

---

### `snapshot:read`

**Request:**
```typescript
window.marvin.snapshot.read(vaultPath: string, turnId: string, relPath: string)
```

**Response:**
```typescript
Promise<string> // content
```

**Error Handling:**
- Snapshot não existe → throw `MARVIN_SNAPSHOT_NOT_FOUND`
- Arquivo binário → throw `MARVIN_BINARY` (impedir crash de UI)
- Size check → throw `MARVIN_TOO_LARGE`

---

### `snapshot:restore`

**Request:**
```typescript
window.marvin.snapshot.restore(
  vaultPath: string,
  turnId: string,
  relPath: string,
  targetPath?: string // default = original relPath
)
```

**Response:**
```typescript
Promise<{ restored: string /* target path */ }>
```

**Error Handling:**
- Path traversal attempt → throw `MARVIN_INVALID_PATH`
- Target file não writable → throw `MARVIN_PERMISSION_DENIED`
- Snapshot corrupted → throw `MARVIN_SNAPSHOT_CORRUPT`
- Restore conflicts → overwrite com confirmação visual (AC4 ≤3 cliques)

---

## Heurística "Turno do AI Ativo" (MVP)

### Detecção de Turno Ativo

**Trigger para snapshots (task #5 — watcher hook):**

1. **Critério padrão**: PTY em uso nos últimos **2 segundos** = "AI está escrevendo"
   - Verificar: `exec('ps aux')` contains pty process OR watcher eventos < 2s atrás
   - Este é o valor padrão hardcoded para MVP (não configurável)

2. **Fallback (se PTY não disponível)**: Usar padrão de escritas rápidas
   - Se duas escritas < 100 ms de distância → considerar turno ativo
   - Reseta contador de "fim de turno" a cada nova escrita

### Turn ID Format

**Formato**: `<ISO-8601-timestamp>Z-<salt>`

Exemplo: `20250521T120345Z-abc123def456`

- `ISO-8601Z`: Ordenável por timestamp (facilita GC)
- `salt`: 12 chars hex (última 6 bytes de `Math.random()` convertido em hex ou uuid v4 simplificado)
- Garantia: Único mesmo com múltiplos turnos/segundo

### Lógica de Fim de Turno

3. **Fim de turno** (AC13):
   - Quando > **500 ms** decorridos SEM escrita (principal trigger)
   - OU quando PTY fecha (se monitora PTY)
   - Emite toast + salva manifest com `status: "completed"`
   - Incrementa `metadata.json` e aciona GC se necessário

4. **Timeout de segurança**:
   - Se turno ativo > 30 min sem pausa → force-complete
   - Previne acúmulo de estado em-memory

### Restore também Snapshots (task #2)

**Snapshot-before-restore**: Quando `snapshot:restore` é chamado:
1. Ler conteúdo ATUAL do arquivo no disco
2. Snapshottá-lo no turno em que estamos (turno "restore")
3. Depois escrever o conteúdo restaurado
4. Resultado: Usuário pode reverter o restore se quiser

Manifest para restore: `{ trigger: "restore", files: [...], status: "completed" }` (sem waitlistener de fim)

### Implementação (electron/snapshot.ts)

```typescript
class SnapshotManager {
  private activeRun?: { turnId: string; files: Set<string>; timer: NodeJS.Timeout }
  private ptyWatchInterval: NodeJS.Timeout | null = null
  private lastWriteTime = 0
  private readonly PTY_ACTIVE_THRESHOLD = 2000 // 2 seconds
  
  async recordSnapshot(vaultPath: string, filePath: string, content: string) {
    // 1. Detectar se é primeira escrita (AC6)
    // 2. Se existente → capturar snapshot anterior (AC1)
    // 3. Registrar em turno ativo
    // 4. (Re)agendar timer de fim de turno (500 ms threshold)
  }
  
  async restoreSnapshot(vaultPath: string, turnId: string, relPath: string) {
    // 1. Ler conteúdo ATUAL do arquivo
    // 2. Snapshottá-lo em turno "restore"
    // 3. Escrever conteúdo restaurado
  }
  
  private ensureTurnCompleted() {
    // Salvar manifest + metadata
    // Emitir 'snapshot:turn-completed' para UI
  }
  
  private isPTYActive(): boolean {
    // Verificar se PTY tem processo ativo
    // Return: true se execução AI em andamento
  }
}
```

---

## Configuração e Defaults

Todos os valores abaixo são **hardcoded para MVP** (não configuráveis em settings.json por enquanto):

| Parâmetro | Valor | Notas |
|-----------|-------|-------|
| `PTY_ACTIVE_THRESHOLD` | 2000 ms | Tempo máximo sem escrita para considerar PTY ativo (task #5) |
| `TURN_END_THRESHOLD` | 500 ms | Pausa necessária para marcar fim de turno (AC13) |
| `TURN_TIMEOUT_SAFETY` | 30 min | Force-complete turno se > 30 min sem pausa |
| `BINARY_DETECTION_SAMPLE` | 8192 B | Bytes lidos para sniff null-byte (detectar binário) |
| `TEXT_SIZE_WARN_THRESHOLD` | 10 MB | Arquivos > 10 MB logam warning mas ainda são snapshotados |
| `GC_TOTAL_SIZE_LIMIT` | 200 MB | Máximo absoluto de snapshots em disco |
| `GC_TRIGGER_THRESHOLD` | 180 MB | Dispara GC quando totalBytes > 180 MB |
| `RETENTION_DAYS` | 7 | Manter snapshots dos últimos 7 dias (AC3) |
| `RETENTION_TURN_COUNT` | 50 | OU manter últimos 50 turnos (AC3) |

---

## Política de Retenção e GC

### Critérios

Manter snapshots que atenderem **ALL** de:

1. **Recência**: Last 7 dias OU últimos 50 turnos (whichever is **earlier/shorter**)
   - Exemplo: Se há 45 turnos em 5 dias → manter 5 dias (45 turnos)
   - Exemplo: Se há 60 turnos em 15 dias → manter últimos 50 turnos (descarta > 7 dias)
2. **Tamanho**: Total < 200 MB
3. **Atividade**: Pelo menos 1 snapshot/arquivo por turno retido

### Algoritmo GC

Executar:
- **Trigger**: A cada fim de turno, se `totalBytes > 180 MB`
- **Exclusão**: Turnos mais antigos primeiro (FIFO)
- **Atomicidade**: Lock `gc.lock` para evitar race com watcher

### Compactação

- Não manter duplicatas idênticas (comparar hash SHA256)
- Se `snapshot[i].hash == snapshot[i-1].hash` → skip snapshot antigo

---

## Edge Cases

### 1. Arquivo Novo vs Sobrescrito

**Novo arquivo** (`file:create`):
- **AC6**: Nenhum snapshot anterior → skip snapshot
- Próximas escritas (update) → snapshot normalmente

**Sobrescrito** (`file:write` em existente):
- Verificar idade do arquivo: Se < 5 min → pode ser editor salvando incrementalmente
- Primeira escrita ainda cria snapshot (não filtra por idade)

### 2. Falha de I/O em Snapshot

- **AC7**: Se `fs.mkdir` ou `fs.writeFile` falha → log erro, **NÃO** bloqueia escrita principal
- Retry assíncrono 1x depois
- UI notifica user: "Snapshots desabilitados por falha de I/O"

### 3. Conflito com `path:trash`

- **AC8**: Quando `path:trash` é invocado em arquivo snapshottado
- Snapshots preservados em `.marvin/snapshots/` (fora de vault)
- Se usuário restaura um arquivo deletado → restaura do snapshot, não da trash

### 4. Arquivos Binários vs Texto Grande

**AC9**: Arquivos **binários** (detectados via sniff null-byte nos primeiros `BINARY_DETECTION_SAMPLE = 8 KB`) são skippados sempre, independente de tamanho. Arquivos **texto** são snapshottados sem limite duro; arquivos texto > `TEXT_SIZE_WARN_THRESHOLD = 10 MB` logam warning mas ainda são preservados. O cutoff de "50 KB" mencionado em versões anteriores foi descartado por bloquear markdown grande legítimo (lembre-se: issue #55 cita "vision: persistent snapshot+restore must be P0" — perder markdown grande contradiz o P0).

### 5. Vault Não Inicializado

- **AC10**: Primeiro acesso a vault → `.marvin/` não existe
- `ipcMain.handle('vault:watch')` → cria diretório on-demand
- Se falha → graceful: UI funciona sem snapshots

### 6. Race Condition Watcher vs Write

- Watcher pode dispara `file:changed` antes de escrita ser commitada
- **Solução**: Aguardar 50 ms antes de ler snapshot (permitir fsync)
- Se não conseguir ler → log, não error

---

## In Scope: DiffViewer (task #7)

- **DiffViewer.tsx**: Componente reusável que mostra diff lado a lado entre versão snapshot e versão atual
- **Restore via UI**: Usuário pode restaurar arquivo diretamente do DiffViewer (parte da task #7)
- Componente será reutilizado em G2-2 e G2-3

---

## Out of Scope (Pós-MVP)

**Estes itens são explicitamente adiados e podem ser implementados após o MVP:**

- **Integração com `tool_use` events do CLI**: MVP usa heurística, cooperação estruturada fica para depois do stream-json
- **Sharing de snapshots**: Snapshot é local-only (não sincroniza)
- **Compressão**: Snapshots armazenados em plaintext (sem gzip)
- **Tags de turno manuais**: Usuário não pode nomear turnos
- **Integração com git**: Não faz commit automático de snapshots
- **Web UI**: Snapshot panel é Electron-only

---

## Métricas de Sucesso

1. **Adoção**: ≥ 70% dos usuários ativos usam restore ≥1x/semana
2. **Satisfação**: User feedback "consegui reverter mudança indesejada" → NPS +10 pts
3. **Confiabilidade**: < 0.5% de snapshots corrompidos
4. **Desempenho**: Snapshot capture < 50 ms (não-bloqueante)
5. **Espaço**: Retenção de 7 dias com vault típico (500 MB) → snapshots ≤ 200 MB

---

## Próximos Passos

1. **electron**: Implementar `electron/snapshot.ts` (tasks #2, #4, #5, #6)
2. **react**: Construir `SnapshotPanel.tsx` + DiffViewer stub (tasks #7, #8)
3. **qa**: Validar AC1-13 contra scenarios reais (task #10, #11)
4. **security**: Review path validation + IPC contracts (task #12)
