// shell:*/app:*/editor:clipboard-*/editor:spellcheck-context IPC handlers —
// external-link/reveal-in-Finder, native context menu + unsaved-changes
// dialog, app-menu note-context toggling, and clipboard/spellcheck glue.
// Extracted from main.ts (#613, follow-up of #573/#580). `assertInVault`
// stays main.ts-owned (also used by vault-handlers.ts's folder:create and
// fs-handlers.ts's file:writeBinary/file:move-batch) and is threaded the
// same way as #574. `menuHasNoteTab`/`buildAppMenu` and `lastSpellcheck` stay
// main.ts-owned (createWindow's context-menu/blur listeners write
// lastSpellcheck; app.whenReady()'s bootstrap calls buildAppMenu directly) —
// threaded via `setMenuNoteContext`/`getSpellcheckContext`.
import { ipcMain, BrowserWindow, dialog, shell, Menu, MenuItem, clipboard } from 'electron'
import { IPC_CHANNELS } from '../../src/shared/ipc-channels.js'

export type ShellMenuHandlersCtx = {
  assertInVault: (filePath: string) => Promise<string>
  setMenuNoteContext: (hasNoteTab: boolean) => void
  getSpellcheckContext: () => { misspelledWord: string; suggestions: string[] }
}

type MenuItemSpec =
  | { kind: 'item'; id: string; label: string; accelerator?: string; enabled?: boolean }
  | { kind: 'separator' }

function showContextMenu(
  e: Electron.IpcMainInvokeEvent,
  items: MenuItemSpec[]
): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    let chosen: string | null = null
    const menu = new Menu()
    for (const spec of items) {
      if (spec.kind === 'separator') {
        menu.append(new MenuItem({ type: 'separator' }))
      } else {
        menu.append(
          new MenuItem({
            label: spec.label,
            accelerator: spec.accelerator,
            enabled: spec.enabled ?? true,
            click: () => {
              chosen = spec.id
            },
          })
        )
      }
    }
    const win = BrowserWindow.fromWebContents(e.sender)
    menu.popup({ window: win ?? undefined, callback: () => resolve(chosen) })
  })
}

export function registerShellMenuHandlers(ctx: ShellMenuHandlersCtx): void {
  ipcMain.handle(IPC_CHANNELS.shell.openExternal, async (_e, url: string) => {
    if (!/^(https?|mailto):/i.test(url)) return
    await shell.openExternal(url)
  })

  ipcMain.handle(IPC_CHANNELS.shell.reveal, async (_e, target: string) => {
    const safe = await ctx.assertInVault(target)
    shell.showItemInFolder(safe)
  })

  ipcMain.handle(
    IPC_CHANNELS.app.showContextMenu,
    (e, items: MenuItemSpec[]): Promise<string | null> => {
      return showContextMenu(e, items)
    }
  )

  ipcMain.handle(IPC_CHANNELS.app.canPaste, (): boolean =>
    clipboard.availableFormats().some((f) => f.startsWith('text/') || f === 'text')
  )

  // Native "unsaved changes" confirmation. Window-modal sheet on macOS so it
  // reads as a system prompt rather than an in-app modal.
  ipcMain.handle(
    IPC_CHANNELS.app.confirmUnsavedChanges,
    async (e, fileName: string): Promise<'save' | 'discard' | 'cancel'> => {
      const w = BrowserWindow.fromWebContents(e.sender)
      const opts: Electron.MessageBoxOptions = {
        type: 'warning',
        message: `Do you want to save the changes you made to “${fileName}”?`,
        detail: "Your changes will be lost if you don't save them.",
        buttons: ['Save', "Don't Save", 'Cancel'],
        defaultId: 0,
        cancelId: 2,
      }
      // w is null only when the sender has no host window (effectively never
      // from the renderer); the modeless fallback is intentional, not a bug.
      const { response } = w
        ? await dialog.showMessageBox(w, opts)
        : await dialog.showMessageBox(opts)
      return response === 0 ? 'save' : response === 1 ? 'discard' : 'cancel'
    }
  )

  // Renderer reports whether a note tab is active so the app menu can disable
  // the note-only items (Export PDF, Reveal in Finder). Rebuilds the menu.
  ipcMain.on(IPC_CHANNELS.app.menuNoteContext, (_e, hasNoteTab: boolean) => {
    if (typeof hasNoteTab !== 'boolean') return
    ctx.setMenuNoteContext(hasNoteTab)
  })

  ipcMain.handle(IPC_CHANNELS.editor.clipboardRead, (): string => {
    return clipboard.readText()
  })

  ipcMain.handle(IPC_CHANNELS.editor.clipboardWrite, (_e, text: string): void => {
    clipboard.writeText(text)
  })

  ipcMain.handle(
    IPC_CHANNELS.editor.clipboardWriteRich,
    (_e, payload: { html: string; text: string }): void => {
      clipboard.write({ html: payload.html, text: payload.text })
    }
  )

  ipcMain.handle(IPC_CHANNELS.editor.clipboardReadRich, (): { html: string; text: string } => {
    return { html: clipboard.readHTML(), text: clipboard.readText() }
  })

  ipcMain.handle(IPC_CHANNELS.editor.spellcheckContext, () => ctx.getSpellcheckContext())
}
