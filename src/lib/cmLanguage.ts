import type { Extension } from '@codemirror/state'

export type LangId =
  | 'markdown' | 'json' | 'html' | 'javascript' | 'jsx' | 'typescript' | 'tsx'
  | 'css' | 'yaml' | 'python' | 'rust' | 'go' | 'java' | 'cpp' | 'sql'
  | 'xml' | 'php' | 'shell' | 'toml' | 'properties' | 'lua' | 'dockerfile'

const EXT_TO_ID: Record<string, LangId> = {
  md: 'markdown', markdown: 'markdown',
  json: 'json', jsonc: 'json',
  html: 'html', htm: 'html',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  css: 'css', scss: 'css',
  yml: 'yaml', yaml: 'yaml',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  c: 'cpp', h: 'cpp', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', cxx: 'cpp', hh: 'cpp',
  sql: 'sql',
  xml: 'xml', svg: 'xml',
  php: 'php',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  toml: 'toml',
  ini: 'properties', cfg: 'properties', conf: 'properties',
  lua: 'lua',
}

const SPECIAL_BASENAMES: Record<string, LangId> = {
  dockerfile: 'dockerfile',
  containerfile: 'dockerfile',
  // Makefile/GNUmakefile: @codemirror/legacy-modes has no Makefile mode; we
  // intentionally leave them without highlighting rather than misuse cmake
  // mode (whose syntax differs from Make).
}

export function languageIdFor(filePath: string): LangId | null {
  const base = (filePath.split('/').pop() ?? filePath).toLowerCase()
  // .env, .env.local, .env.production, etc.
  if (base === '.env' || base.startsWith('.env.')) return 'properties'
  // .gitignore, .gitattributes, .editorconfig — return null (no highlight, but no error)
  if (base === '.gitignore' || base === '.gitattributes' || base === '.editorconfig') return null
  // Special filenames first (case-insensitive)
  if (SPECIAL_BASENAMES[base]) return SPECIAL_BASENAMES[base]
  // Extension
  const idx = base.lastIndexOf('.')
  if (idx <= 0) return null
  const ext = base.slice(idx + 1)
  return EXT_TO_ID[ext] ?? null
}

const cache = new Map<LangId, Promise<Extension>>()

export function loadLanguage(id: LangId): Promise<Extension> {
  const cached = cache.get(id)
  if (cached) return cached
  const promise = loadFresh(id).catch((err) => {
    // Don't poison the cache with a rejected promise — the next caller
    // gets a fresh attempt.
    cache.delete(id)
    throw err
  })
  cache.set(id, promise)
  return promise
}

async function loadFresh(id: LangId): Promise<Extension> {
  switch (id) {
    case 'markdown': {
      const m = await import('@codemirror/lang-markdown')
      return m.markdown()
    }
    case 'json': {
      const m = await import('@codemirror/lang-json')
      return m.json()
    }
    case 'html': {
      const m = await import('@codemirror/lang-html')
      return m.html()
    }
    case 'javascript': {
      const m = await import('@codemirror/lang-javascript')
      return m.javascript()
    }
    case 'jsx': {
      const m = await import('@codemirror/lang-javascript')
      return m.javascript({ jsx: true })
    }
    case 'typescript': {
      const m = await import('@codemirror/lang-javascript')
      return m.javascript({ typescript: true })
    }
    case 'tsx': {
      const m = await import('@codemirror/lang-javascript')
      return m.javascript({ jsx: true, typescript: true })
    }
    case 'css': {
      const m = await import('@codemirror/lang-css')
      return m.css()
    }
    case 'yaml': {
      const m = await import('@codemirror/lang-yaml')
      return m.yaml()
    }
    case 'python': {
      const m = await import('@codemirror/lang-python')
      return m.python()
    }
    case 'rust': {
      const m = await import('@codemirror/lang-rust')
      return m.rust()
    }
    case 'go': {
      const m = await import('@codemirror/lang-go')
      return m.go()
    }
    case 'java': {
      const m = await import('@codemirror/lang-java')
      return m.java()
    }
    case 'cpp': {
      const m = await import('@codemirror/lang-cpp')
      return m.cpp()
    }
    case 'sql': {
      const m = await import('@codemirror/lang-sql')
      return m.sql()
    }
    case 'xml': {
      const m = await import('@codemirror/lang-xml')
      return m.xml()
    }
    case 'php': {
      const m = await import('@codemirror/lang-php')
      return m.php()
    }
    case 'shell': {
      const [lang, mode] = await Promise.all([
        import('@codemirror/language'),
        import('@codemirror/legacy-modes/mode/shell'),
      ])
      return lang.StreamLanguage.define(mode.shell)
    }
    case 'toml': {
      const [lang, mode] = await Promise.all([
        import('@codemirror/language'),
        import('@codemirror/legacy-modes/mode/toml'),
      ])
      return lang.StreamLanguage.define(mode.toml)
    }
    case 'properties': {
      const [lang, mode] = await Promise.all([
        import('@codemirror/language'),
        import('@codemirror/legacy-modes/mode/properties'),
      ])
      return lang.StreamLanguage.define(mode.properties)
    }
    case 'lua': {
      const [lang, mode] = await Promise.all([
        import('@codemirror/language'),
        import('@codemirror/legacy-modes/mode/lua'),
      ])
      return lang.StreamLanguage.define(mode.lua)
    }
    case 'dockerfile': {
      const [lang, mode] = await Promise.all([
        import('@codemirror/language'),
        import('@codemirror/legacy-modes/mode/dockerfile'),
      ])
      return lang.StreamLanguage.define(mode.dockerFile)
    }
    default: {
      const exhaustive: never = id
      throw new Error(`Unknown LangId: ${exhaustive}`)
    }
  }
}
