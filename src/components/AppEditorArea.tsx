import type React from 'react'
import type { FileChangeSource } from '../types'
import type { AgentKind } from '../lib/agent-drop-format'
import {
  type Tab,
  type NoteTab,
  isImageTab,
  isPdfTab,
  isDocxTab,
  isXlsxTab,
  isEmptyTab,
  isBrowserTab,
} from '../lib/tabs'
import { TabBar } from './TabBar'
import { Editor } from './Editor'
import { ExternalChangeBanner } from './ExternalChangeBanner'
import { ImageViewer } from './ImageViewer'
import { PdfViewer } from './PdfViewer'
import { DocxViewer } from './DocxViewer'
import { XlsxViewer } from './XlsxViewer'
import { EmptyTab } from './EmptyTab'
import { BrowserPane } from './BrowserPane'

type TabBarProps = React.ComponentProps<typeof TabBar>
type EditorProps = React.ComponentProps<typeof Editor>
type BrowserPaneProps = React.ComponentProps<typeof BrowserPane>

type Props = {
  vaultPath: string
  tabs: Tab[]
  activeTabId: string | null
  activeTab: Tab | null
  isDirty: boolean
  mountedNoteTabs: NoteTab[]
  onActivate: TabBarProps['onActivate']
  onCloseTab: TabBarProps['onClose']
  onNewTab: TabBarProps['onNewTab']
  bufferContentRef: React.RefObject<Map<string, string>>
  onAcceptDisk: (path: string, diskContent: string, buffer: string) => void
  onKeepMine: (path: string, source: FileChangeSource, diskContent: string) => void
  clearPendingExternalChange: (path: string) => void
  getBufferSeed: EditorProps['seedContent']
  layoutMode: string
  sidebarWidth: number
  agentsWidth: number
  paletteItemsWithMeta: EditorProps['paletteItems']
  onSave: (path: string, content: string) => Promise<void>
  onBufferChange: (path: string, content: string) => void
  onNavigate: EditorProps['onNavigate']
  onBack: EditorProps['onBack']
  onForward: EditorProps['onForward']
  openFindTick: number
  openReplaceTick: number
  onImportToast: EditorProps['onImportToast']
  saveMode: EditorProps['saveMode']
  onDirtyChange: (dirty: boolean) => void
  flushSaveRef: React.MutableRefObject<(() => Promise<void>) | null>
  onRegisterHandle: EditorProps['onRegisterHandle']
  focusedAgent: { ptyId: string; agentKind: AgentKind } | null
  onSendSelection: NonNullable<EditorProps['onSendSelection']>
  onConvertEmptyToBrowser: (id: string) => void
  onCreateNoteFromEmpty: (id: string) => void
  onChooseFileFromEmpty: (id: string) => void | Promise<void>
  onBrowserUrlBarChange: BrowserPaneProps['onUrlBarChange']
  onBrowserNavigate: BrowserPaneProps['onNavigate']
  onBrowserReady: BrowserPaneProps['onReady']
  urlBarFocusTick: number
}

export function AppEditorArea({
  vaultPath,
  tabs,
  activeTabId,
  activeTab,
  isDirty,
  mountedNoteTabs,
  onActivate,
  onCloseTab,
  onNewTab,
  bufferContentRef,
  onAcceptDisk,
  onKeepMine,
  clearPendingExternalChange,
  getBufferSeed,
  layoutMode,
  sidebarWidth,
  agentsWidth,
  paletteItemsWithMeta,
  onSave,
  onBufferChange,
  onNavigate,
  onBack,
  onForward,
  openFindTick,
  openReplaceTick,
  onImportToast,
  saveMode,
  onDirtyChange,
  flushSaveRef,
  onRegisterHandle,
  focusedAgent,
  onSendSelection,
  onConvertEmptyToBrowser,
  onCreateNoteFromEmpty,
  onChooseFileFromEmpty,
  onBrowserUrlBarChange,
  onBrowserNavigate,
  onBrowserReady,
  urlBarFocusTick,
}: Props) {
  return (
    <main className="editor-pane">
      <TabBar
        tabs={tabs}
        activeId={activeTabId}
        dirtyTabId={isDirty ? activeTabId : null}
        onActivate={onActivate}
        onClose={onCloseTab}
        onNewTab={onNewTab}
      />
      <div className="editor-stack">
        {/* Note/markdown editor tabs are rendered as a stack (all mounted,
        inactive ones hidden) keyed by stable tab.id so switching tabs
        does NOT unmount the CodeMirror instance — undo history, cursor,
        and scroll survive the switch (#440). Mirrors the browser-tab
        precedent below. The set of mounted tabs is bounded by an MRU
        cap (see mountedNoteTabs). */}
        {mountedNoteTabs.map((noteTab) => {
          const isActive = noteTab.id === activeTabId
          return (
            <div
              key={noteTab.id}
              className="note-tab-container"
              hidden={!isActive}
              data-tab-id={noteTab.id}
            >
              {isActive && noteTab.pendingExternalChange && (
                <ExternalChangeBanner
                  filePath={noteTab.path}
                  getCurrentBuffer={() =>
                    bufferContentRef.current.get(noteTab.path) ?? noteTab.content
                  }
                  diskContent={noteTab.pendingExternalChange.diskContent}
                  diskChangedAt={noteTab.pendingExternalChange.diskChangedAt}
                  source={noteTab.pendingExternalChange.source}
                  onAcceptDisk={() =>
                    onAcceptDisk(
                      noteTab.path,
                      noteTab.pendingExternalChange!.diskContent,
                      bufferContentRef.current.get(noteTab.path) ?? noteTab.content
                    )
                  }
                  onKeepMine={() =>
                    onKeepMine(
                      noteTab.path,
                      noteTab.pendingExternalChange!.source,
                      noteTab.pendingExternalChange!.diskContent
                    )
                  }
                  onDismiss={() => clearPendingExternalChange(noteTab.path)}
                />
              )}
              <Editor
                key={noteTab.id}
                isActive={isActive}
                filePath={noteTab.path}
                initialContent={noteTab.content}
                seedContent={getBufferSeed}
                version={noteTab.version}
                geometryKey={`${layoutMode}#${sidebarWidth}#${agentsWidth}`}
                paletteItems={paletteItemsWithMeta}
                onSave={(content) => onSave(noteTab.path, content)}
                onBufferChange={(content) => onBufferChange(noteTab.path, content)}
                onNavigate={onNavigate}
                canBack={noteTab.back.length > 0}
                canForward={noteTab.forward.length > 0}
                onBack={onBack}
                onForward={onForward}
                openFindTick={openFindTick}
                openReplaceTick={openReplaceTick}
                onImportToast={onImportToast}
                saveMode={saveMode}
                // Only the active editor drives the global dirty indicator and
                // owns the single flush ref (Cmd+S / menu save target). Hidden
                // editors mustn't overwrite either — the last one to mount
                // would otherwise win. Background-tab saving still works: it
                // goes through the path-keyed closeTab → saveBuffer, not this
                // ref. Editor re-emits its dirty state when it becomes active.
                onDirtyChange={isActive ? onDirtyChange : undefined}
                onFlushSave={
                  isActive
                    ? (fn) => {
                        flushSaveRef.current = fn
                      }
                    : undefined
                }
                // Passed to every mounted editor; each self-gates on isActive
                // and clears the ref on going inactive/unmount, so the Cmd+Z
                // fallback always targets the visible editor (never a hidden one).
                onRegisterHandle={onRegisterHandle}
                onSendSelection={focusedAgent ? onSendSelection : undefined}
                agentKind={focusedAgent?.agentKind}
              />
            </div>
          )
        })}
        {activeTab && isImageTab(activeTab) && (
          <ImageViewer
            key={activeTab.id}
            path={activeTab.path}
            onRevealInFinder={(p) => void window.marvin.shell.reveal(p)}
          />
        )}
        {activeTab && isPdfTab(activeTab) && (
          <PdfViewer
            key={activeTab.id}
            path={activeTab.path}
            onRevealInFinder={(p) => void window.marvin.shell.reveal(p)}
          />
        )}
        {activeTab && isDocxTab(activeTab) && (
          <DocxViewer
            key={activeTab.id}
            path={activeTab.path}
            onRevealInFinder={(p) => void window.marvin.shell.reveal(p)}
          />
        )}
        {activeTab && isXlsxTab(activeTab) && <XlsxViewer path={activeTab.path} />}
        {activeTab && isEmptyTab(activeTab) && (
          <EmptyTab
            key={activeTab.id}
            onOpenBrowser={() => onConvertEmptyToBrowser(activeTab.id)}
            onCreateNote={() => onCreateNoteFromEmpty(activeTab.id)}
            onChooseFile={() => void onChooseFileFromEmpty(activeTab.id)}
            isVaultOpen={!!vaultPath}
          />
        )}
        {!activeTab && <div className="empty-editor">Select a note or create a new one.</div>}
        {/* Browser tabs are rendered as a stack (lazy mount, hidden when
        inactive) so each WebContentsView keeps its session alive across
        switches. */}
        {tabs.filter(isBrowserTab).map((bt) => (
          <BrowserPane
            key={bt.id}
            tab={bt}
            isActive={bt.id === activeTabId}
            onUrlBarChange={onBrowserUrlBarChange}
            onNavigate={onBrowserNavigate}
            onReady={onBrowserReady}
            urlBarFocusTick={urlBarFocusTick}
            geometryKey={`${layoutMode}#${sidebarWidth}#${agentsWidth}`}
          />
        ))}
      </div>
    </main>
  )
}
