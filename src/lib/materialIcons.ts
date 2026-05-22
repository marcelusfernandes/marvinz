import manifest from './materialIconsManifest.json'

type Manifest = {
  file: string
  folder: string
  folderExpanded: string
  fileNames: Record<string, string>
  fileExtensions: Record<string, string>
  folderNames: Record<string, string>
  folderNamesExpanded: Record<string, string>
}

const M = manifest as Manifest

// Case-insensitive lookup tables. Manifest keys are mostly lowercase already,
// but a few are mixed-case; normalize once at module load.
const fileNames = lowercaseKeys(M.fileNames)
const fileExtensions = lowercaseKeys(M.fileExtensions)
const folderNames = lowercaseKeys(M.folderNames)
const folderNamesExpanded = lowercaseKeys(M.folderNamesExpanded)

function lowercaseKeys(obj: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj)) out[k.toLowerCase()] = v
  return out
}

function iconUrl(iconName: string): string {
  return `${import.meta.env.BASE_URL}material-icons/${iconName}.svg`
}

function fileIconId(name: string): string {
  const lower = name.toLowerCase()
  // 1. exact filename match
  if (lower in fileNames) return fileNames[lower]
  // 2. compound extension first (e.g. spec.ts before ts), then walk shorter
  const dot = lower.indexOf('.')
  if (dot >= 0) {
    for (let i = dot; i < lower.length; i++) {
      if (lower[i] === '.') {
        const ext = lower.slice(i + 1)
        if (ext in fileExtensions) return fileExtensions[ext]
      }
    }
  }
  return M.file
}

function folderIconId(name: string, open: boolean): string {
  const lower = name.toLowerCase()
  const table = open ? folderNamesExpanded : folderNames
  if (lower in table) return table[lower]
  return open ? M.folderExpanded : M.folder
}

export function materialIconFor(name: string, isDir: boolean, open: boolean): string {
  const id = isDir ? folderIconId(name, open) : fileIconId(name)
  return iconUrl(id)
}
