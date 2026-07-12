// Single source of truth for IPC channel names shared between
// electron/preload.ts (renderer bridge) and the electron/ipc/*.ts
// handlers (main process). Both sides import from here so a typo or
// rename on either side of the boundary is a compile error instead of
// a silently mismatched string.
//
// Renderer-safe: no Node-only or Electron imports, so this module can
// be imported for its runtime value (not just its types) from both the
// preload/main process and the renderer bundle.

export const IPC_CHANNELS = {
  settings: {
    get: 'settings:get',
    set: 'settings:set',
  },
  vault: {
    pick: 'vault:pick',
    current: 'vault:current',
    tree: 'vault:tree',
    watch: 'vault:watch',
    changed: 'vault:changed',
  },
  file: {
    pick: 'file:pick',
    read: 'file:read',
    write: 'file:write',
    exportPdf: 'file:exportPdf',
    create: 'file:create',
    writeBinary: 'file:writeBinary',
    copy: 'file:copy',
    moveBatch: 'file:move-batch',
    changed: 'file:changed',
  },
  office: {
    readDocx: 'office:readDocx',
    writeDocx: 'office:writeDocx',
    readXlsx: 'office:readXlsx',
    writeXlsx: 'office:writeXlsx',
  },
  folder: {
    create: 'folder:create',
  },
  path: {
    rename: 'path:rename',
    trash: 'path:trash',
  },
  claude: {
    detect: 'claude:detect',
  },
  agent: {
    detect: 'agent:detect',
    request: 'agent:request',
    event: (sessionId: string) => `agent:event:${sessionId}`,
  },
  browser: {
    create: 'browser:create',
    navigate: 'browser:navigate',
    back: 'browser:back',
    forward: 'browser:forward',
    reload: 'browser:reload',
    stop: 'browser:stop',
    setBounds: 'browser:setBounds',
    setGeometry: 'browser:setGeometry',
    setActive: 'browser:setActive',
    setAllHidden: 'browser:setAllHidden',
    close: 'browser:close',
    event: 'browser:event',
  },
  shell: {
    openExternal: 'shell:openExternal',
    reveal: 'shell:reveal',
  },
  editor: {
    clipboardRead: 'editor:clipboard-read',
    clipboardWrite: 'editor:clipboard-write',
    clipboardWriteRich: 'editor:clipboard-write-rich',
    clipboardReadRich: 'editor:clipboard-read-rich',
    spellcheckContext: 'editor:spellcheck-context',
  },
  app: {
    showContextMenu: 'app:show-context-menu',
    canPaste: 'app:can-paste',
    confirmUnsavedChanges: 'app:confirm-unsaved',
    menuAction: 'menu:action',
    menuNoteContext: 'app:menu-note-context',
  },
  fs: {
    importExternal: 'fs:importExternal',
  },
  snapshot: {
    listTurns: 'snapshot:listTurns',
    listForFile: 'snapshot:listForFile',
    read: 'snapshot:read',
    restore: 'snapshot:restore',
    saveBuffer: 'snapshot:saveBuffer',
    saveExternalChange: 'snapshot:saveExternalChange',
    capture: 'snapshot:capture',
    restoreOne: 'snapshot:restoreOne',
    turnCompleted: 'snapshot:turn-completed',
  },
  search: {
    content: 'search:content',
  },
  pty: {
    spawn: 'pty:spawn',
    write: 'pty:write',
    resize: 'pty:resize',
    kill: 'pty:kill',
    data: (id: string) => `pty:data:${id}`,
    exit: (id: string) => `pty:exit:${id}`,
  },
} as const
