// Demo entry — installs the window.marvin mock, then renders the real App.
// Used by the web demo build (vite.demo.config.ts). The mock must be installed
// before App's module graph runs, so App is imported dynamically afterward.

import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../index.css'
import './demo-chrome.css'
import { installMarvinMock } from './marvin-mock'
import { useChatStore } from '../lib/chat/store'
import { seedDemoConversation } from './seed-conversation'

// The demo runs in an iframe below the page fold. When the seeded approval gate
// (or any app autofocus) calls element.focus(), the browser's default
// scroll-into-view drags the HOST page down on load. Force preventScroll on every
// focus() inside the demo so the landing never auto-scrolls. Demo-only patch.
const nativeFocus = HTMLElement.prototype.focus
HTMLElement.prototype.focus = function (options?: FocusOptions) {
  return nativeFocus.call(this, { ...options, preventScroll: true })
}

// The demo follows the host page's theme, passed as ?theme=light|dark on the
// iframe src (default light). Applied before the App mounts so there's no flash.
const demoTheme = new URLSearchParams(window.location.search).get('theme') === 'dark' ? 'dark' : 'light'
installMarvinMock(demoTheme)
document.documentElement.setAttribute('data-theme', demoTheme)

// Fix the Claude (agents) pane width for the demo. App reads this localStorage
// key at boot (key 'marvin:agentsWidth', clamped 320–900), so setting it before
// the App mounts pins the pane to 360px without touching App.tsx.
try {
  window.localStorage.setItem('marvin:agentsWidth', '360')
} catch {
  // localStorage unavailable in the sandboxed iframe — fall back to app default.
}

// Native window chrome (traffic lights) — OS-drawn on the real app, so the web
// frame reproduces them at the top-left over the rendered App.
const chrome = document.createElement('div')
chrome.className = 'demo-chrome'
chrome.setAttribute('aria-hidden', 'true')
chrome.innerHTML =
  '<span class="light red"></span><span class="light yellow"></span><span class="light green"></span>'
document.body.appendChild(chrome)

void (async () => {
  const { default: App } = await import('../App.tsx')
  createRoot(document.getElementById('root')!).render(<App />)
  populateInitialState()
})()

// Open the demo in a rich state on the first frame — no empty states: two file
// tabs (research-notes active + rendered) and a Claude session pre-seeded with
// a complete conversation (assistant reply + a write_file approval gate).
function populateInitialState() {
  const deadline = Date.now() + 8000

  const openTabsThenChat = () => {
    const rows = Array.from(document.querySelectorAll<HTMLButtonElement>('.file-tree-row'))
    const find = (name: string) => rows.find((r) => r.textContent?.trim().startsWith(name))
    const research = find('research-notes')
    const plan = find('project-plan')
    if (research && plan) {
      // Second tab first, then the active note, so research-notes ends up focused.
      plan.click()
      setTimeout(() => research.click(), 250)
      setTimeout(startChatSession, 700)
      return
    }
    if (Date.now() < deadline) setTimeout(openTabsThenChat, 120)
  }

  // Only Claude is "installed" (mock), so the New-agent button opens a Claude
  // chat session directly — the sidebar shows an open Claude session.
  const startChatSession = () => {
    const plus = document.querySelector<HTMLButtonElement>('.agent-new-plus')
    if (!plus) {
      if (Date.now() < deadline) setTimeout(startChatSession, 150)
      return
    }
    plus.click()
  }

  // Seed the conversation as soon as the session lands in the store, so the chat
  // opens populated instead of empty. Subscribed before the session exists, so
  // there's no mount-vs-timer race.
  const unsub = useChatStore.subscribe((state) => {
    const sid = state.activeSessionId
    if (sid && state.sessions[sid]) {
      unsub()
      seedDemoConversation(sid)
    }
  })

  setTimeout(openTabsThenChat, 300)
}
