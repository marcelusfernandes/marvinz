// Generates scripts/icons.html from src/icons/*.svg. Run after
// refreshing src/icons/ from upstream microsoft/vscode-codicons.
const fs = require('node:fs')
const path = require('node:path')

const SRC = path.join(__dirname, '..', 'src', 'icons')
const OUT = path.join(__dirname, 'icons.html')

const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.svg')).sort()
const inUse = new Set([
  'add',
  'close',
  'chevron-left',
  'chevron-right',
  'chevron-down',
  'refresh',
  'folder',
  'folder-opened',
])

const cards = files
  .map((file) => {
    const name = file.replace(/\.svg$/, '')
    const raw = fs.readFileSync(path.join(SRC, file), 'utf8').replace(/\s+/g, ' ').trim()
    const used = inUse.has(name) ? ' used' : ''
    return `<div class="card${used}" data-name="${name}">
        <div class="icon-wrap">${raw}</div>
        <span class="name">${name}</span>
      </div>`
  })
  .join('\n      ')

const html = `<!doctype html>
<html lang="pt-br">
  <head>
    <meta charset="utf-8" />
    <title>Marvin — Codicon catalog (${files.length})</title>
    <style>
      :root {
        --bg: #1e1e1e;
        --bg-2: #252525;
        --bg-3: #2f2f2f;
        --border: #383838;
        --fg: #e6e6e6;
        --fg-2: #b8b8b8;
        --fg-3: #888;
        --accent: #c4691f;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 24px;
        font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
        background: var(--bg);
        color: var(--fg);
      }
      header {
        position: sticky;
        top: 0;
        background: var(--bg);
        padding: 8px 0 16px;
        margin-bottom: 16px;
        border-bottom: 1px solid var(--border);
        z-index: 10;
      }
      .row { display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap; }
      h1 { margin: 0; font-size: 18px; font-weight: 600; }
      p { margin: 0; color: var(--fg-3); font-size: 13px; }
      p a { color: var(--accent); text-decoration: none; }
      p a:hover { text-decoration: underline; }
      .filter {
        margin-top: 12px;
        width: 100%;
        background: var(--bg-2);
        border: 1px solid var(--border);
        color: var(--fg);
        font: inherit;
        font-size: 13px;
        padding: 8px 12px;
        border-radius: 4px;
        outline: none;
      }
      .filter:focus { border-color: var(--accent); }
      .count { color: var(--fg-3); font-size: 12px; margin-top: 6px; }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
        gap: 8px;
      }
      .card {
        background: var(--bg-2);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 12px 8px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        transition: background 0.1s, border-color 0.1s;
      }
      .card:hover {
        background: var(--bg-3);
        border-color: var(--accent);
      }
      .card.used { border-color: rgba(196, 105, 31, 0.4); }
      .card.used::after {
        content: '';
        position: absolute;
        top: 4px;
        right: 4px;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--accent);
      }
      .card.used {
        position: relative;
      }
      .card.hidden { display: none; }
      .icon-wrap {
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--fg-2);
      }
      .card:hover .icon-wrap { color: var(--fg); }
      .icon-wrap svg { width: 32px; height: 32px; }
      .name {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px;
        color: var(--fg-3);
        text-align: center;
        word-break: break-all;
        line-height: 1.3;
      }
      .card:hover .name { color: var(--fg-2); }
      .toast {
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%) translateY(40px);
        background: var(--accent);
        color: white;
        padding: 8px 16px;
        border-radius: 4px;
        font-size: 13px;
        opacity: 0;
        transition: opacity 0.2s, transform 0.2s;
        pointer-events: none;
        z-index: 20;
      }
      .toast.show {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
    </style>
  </head>
  <body>
    <header>
      <div class="row">
        <h1>Codicon catalog</h1>
        <p>
          ${files.length} icons from
          <a href="https://github.com/microsoft/vscode-codicons" target="_blank" rel="noreferrer">microsoft/vscode-codicons</a>.
          Click a card to copy the name. Orange dot = already vendored in <code>src/icons/</code>.
        </p>
      </div>
      <input id="filter" class="filter" placeholder="Filter (e.g. arrow, folder, chevron)…" autocomplete="off" />
      <div class="count" id="count"></div>
    </header>
    <div class="grid" id="grid">
      ${cards}
    </div>
    <div class="toast" id="toast"></div>
    <script>
      const grid = document.getElementById('grid')
      const cards = Array.from(grid.querySelectorAll('.card'))
      const count = document.getElementById('count')
      const filter = document.getElementById('filter')
      const toast = document.getElementById('toast')

      function updateCount() {
        const shown = cards.filter((c) => !c.classList.contains('hidden')).length
        count.textContent = shown + ' / ' + cards.length + ' shown'
      }
      updateCount()

      filter.addEventListener('input', () => {
        const q = filter.value.trim().toLowerCase()
        for (const card of cards) {
          const name = card.dataset.name
          card.classList.toggle('hidden', q !== '' && !name.includes(q))
        }
        updateCount()
      })

      let toastTimer = null
      function flash(msg) {
        toast.textContent = msg
        toast.classList.add('show')
        clearTimeout(toastTimer)
        toastTimer = setTimeout(() => toast.classList.remove('show'), 1400)
      }

      grid.addEventListener('click', async (e) => {
        const card = e.target.closest('.card')
        if (!card) return
        const name = card.dataset.name
        try {
          await navigator.clipboard.writeText(name)
          flash('Copied: ' + name)
        } catch {
          flash('Copy failed')
        }
      })

      filter.focus()
    </script>
  </body>
</html>
`

fs.writeFileSync(OUT, html)
console.log('Wrote', OUT, '(' + files.length + ' icons)')
