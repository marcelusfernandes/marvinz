import type React from 'react'
import type { FileChangeSource } from '../types'
import { AgentsPane } from './AgentsPane'
import { InputDialog } from './InputDialog'
import { CommandPalette } from './CommandPalette'
import { SettingsModal } from './SettingsModal'
import { SnapshotPanel } from './SnapshotPanel'
import { SnapshotToast } from './SnapshotToast'
import { ImportToast, type ImportToastState } from './ImportToast'

type AgentsPaneProps = React.ComponentProps<typeof AgentsPane>
type CommandPaletteProps = React.ComponentProps<typeof CommandPalette>
type SettingsModalProps = React.ComponentProps<typeof SettingsModal>
type SnapshotPanelProps = React.ComponentProps<typeof SnapshotPanel>
type InputDialogProps = React.ComponentProps<typeof InputDialog>

type Dialog = { kind: 'rename'; target: string; isDir: boolean } | null
type SnapshotPanelState = {
  filePath: string
  relPath: string
  currentContent: string
  initialTurnId?: string
} | null
type TurnToastState = { turnId: string; files: string[] } | null
type ExternalToastState = { filePath: string; source: FileChangeSource } | null
type ImportToastMessage = { state: ImportToastState; message: string } | null

type Props = {
  vaultPath: string
  agents: AgentsPaneProps['agents']
  newAgentTabTick: AgentsPaneProps['newTabTick']
  onRewind: AgentsPaneProps['onRewind']
  onOpenFile: AgentsPaneProps['onOpenFile']
  onFocusChange: AgentsPaneProps['onFocusChange']
  setTurnToast: (value: TurnToastState) => void
  dialog: Dialog
  onCreate: InputDialogProps['onSubmit']
  setDialog: (value: Dialog) => void
  error: string | null
  setError: (value: string | null) => void
  paletteOpen: boolean
  paletteItemsBase: CommandPaletteProps['items']
  onPalettePick: CommandPaletteProps['onPick']
  setPaletteOpen: (value: boolean) => void
  settingsOpen: boolean
  layoutMode: SettingsModalProps['layoutMode']
  onLayoutChange: SettingsModalProps['onLayoutChange']
  setSettingsOpen: (value: boolean) => void
  snapshotPanel: SnapshotPanelState
  setSnapshotPanel: (value: SnapshotPanelState) => void
  onSnapshotRestored: SnapshotPanelProps['onRestored']
  turnToast: TurnToastState
  openSnapshotPanel: (absPath: string, turnId?: string) => void | Promise<void>
  externalToast: ExternalToastState
  setExternalToast: (value: ExternalToastState) => void
  importToast: ImportToastMessage
  setImportToast: (value: ImportToastMessage) => void
}

export function AppPanels({
  vaultPath,
  agents,
  newAgentTabTick,
  onRewind,
  onOpenFile,
  onFocusChange,
  setTurnToast,
  dialog,
  onCreate,
  setDialog,
  error,
  setError,
  paletteOpen,
  paletteItemsBase,
  onPalettePick,
  setPaletteOpen,
  settingsOpen,
  layoutMode,
  onLayoutChange,
  setSettingsOpen,
  snapshotPanel,
  setSnapshotPanel,
  onSnapshotRestored,
  turnToast,
  openSnapshotPanel,
  externalToast,
  setExternalToast,
  importToast,
  setImportToast,
}: Props) {
  const dialogConfig = (() => {
    if (!dialog) return null
    return {
      title: dialog.isDir ? 'Rename folder' : 'Rename file',
      placeholder: '',
      submit: 'Rename',
      initial: dialog.target.split('/').pop() ?? '',
    }
  })()

  return (
    <>
      <aside className="claude-pane">
        <AgentsPane
          agents={agents}
          newTabTick={newAgentTabTick}
          onRewind={onRewind}
          onTurnSummary={(summary) =>
            setTurnToast({ turnId: summary.turnId, files: summary.fileNames })
          }
          onOpenFile={onOpenFile}
          onFocusChange={onFocusChange}
        />
      </aside>

      {dialog && dialogConfig && (
        <InputDialog
          title={dialogConfig.title}
          placeholder={dialogConfig.placeholder}
          initialValue={dialogConfig.initial}
          submitLabel={dialogConfig.submit}
          onSubmit={onCreate}
          onCancel={() => setDialog(null)}
        />
      )}

      {error && (
        <div className="error-toast" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      {paletteOpen && (
        <CommandPalette
          items={paletteItemsBase}
          onPick={onPalettePick}
          onClose={() => setPaletteOpen(false)}
          vaultPath={vaultPath ?? ''}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          layoutMode={layoutMode}
          onLayoutChange={onLayoutChange}
        />
      )}

      {snapshotPanel && (
        <SnapshotPanel
          filePath={snapshotPanel.filePath}
          relPath={snapshotPanel.relPath}
          currentContent={snapshotPanel.currentContent}
          initialTurnId={snapshotPanel.initialTurnId}
          onClose={() => setSnapshotPanel(null)}
          onRestored={onSnapshotRestored}
          onError={setError}
        />
      )}

      {turnToast && vaultPath && (
        <SnapshotToast
          files={turnToast.files}
          onOpenVersions={() => {
            const firstRel = turnToast.files[0]
            if (!firstRel) return
            const absPath = `${vaultPath}/${firstRel}`
            void openSnapshotPanel(absPath, turnToast.turnId)
            setTurnToast(null)
          }}
          onDismiss={() => setTurnToast(null)}
        />
      )}

      {externalToast && vaultPath && (
        <SnapshotToast
          files={[
            externalToast.filePath.startsWith(vaultPath + '/')
              ? externalToast.filePath.slice(vaultPath.length + 1)
              : externalToast.filePath,
          ]}
          agentLabel="External change"
          verb="updated"
          onOpenVersions={() => {
            void openSnapshotPanel(externalToast.filePath)
            setExternalToast(null)
          }}
          onDismiss={() => setExternalToast(null)}
        />
      )}

      {importToast && (
        <ImportToast
          state={importToast.state}
          message={importToast.message}
          onDismiss={() => setImportToast(null)}
        />
      )}
    </>
  )
}
