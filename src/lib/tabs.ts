import type { FileChangeSource } from '../types'

export type PendingExternalChange = {
  diskContent: string
  diskChangedAt: number
  source: FileChangeSource
}

export type NoteTab = {
  type: 'note'
  id: string
  path: string
  content: string
  version: number
  back: string[]
  forward: string[]
  pendingExternalChange?: PendingExternalChange
}

export type BrowserTabState = {
  type: 'browser'
  id: string
  url: string
  /** What's typed in the URL bar (may differ from `url` while editing). */
  draftUrl: string
  title: string
  canBack: boolean
  canForward: boolean
  loading: boolean
  /** True after the WebContentsView is created in the main process. */
  ready: boolean
}

export type ImageTab = {
  type: 'image'
  id: string
  path: string
}

export type PdfTab = {
  type: 'pdf'
  id: string
  path: string
}

export type DocxTab = {
  type: 'docx'
  id: string
  path: string
}

export type XlsxTab = {
  type: 'xlsx'
  id: string
  path: string
}

export type EmptyTab = {
  type: 'empty'
  id: string
  title: string
}

export type Tab = NoteTab | BrowserTabState | ImageTab | PdfTab | DocxTab | XlsxTab | EmptyTab

export const isNoteTab = (t: Tab): t is NoteTab => t.type === 'note'
export const isBrowserTab = (t: Tab): t is BrowserTabState => t.type === 'browser'
export const isImageTab = (t: Tab): t is ImageTab => t.type === 'image'
export const isPdfTab = (t: Tab): t is PdfTab => t.type === 'pdf'
export const isDocxTab = (t: Tab): t is DocxTab => t.type === 'docx'
export const isXlsxTab = (t: Tab): t is XlsxTab => t.type === 'xlsx'
export const isEmptyTab = (t: Tab): t is EmptyTab => t.type === 'empty'
