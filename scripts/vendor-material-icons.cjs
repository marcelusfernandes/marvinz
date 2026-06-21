// Vendors material-icon-theme from npm into the repo.
//
// Pulls a pinned tarball from the npm registry (no network egress beyond
// registry.npmjs.org, no git clone). Extracts:
//   - icons/*.svg   → public/material-icons/*.svg  (served as static assets)
//   - dist/material-icons.json → src/lib/materialIconsManifest.json
//   - LICENSE       → public/material-icons/LICENSE
//
// Re-run after bumping VERSION below to refresh the vendored copy.
//
// Upstream: https://github.com/material-extensions/vscode-material-icon-theme (MIT)

const fs = require('node:fs')
const path = require('node:path')
const https = require('node:https')
const { spawnSync } = require('node:child_process')
const os = require('node:os')

const VERSION = '5.34.0'
const TARBALL_URL = `https://registry.npmjs.org/material-icon-theme/-/material-icon-theme-${VERSION}.tgz`

const ROOT = path.resolve(__dirname, '..')
const OUT_ICONS_DIR = path.join(ROOT, 'public', 'material-icons')
const OUT_MANIFEST = path.join(ROOT, 'src', 'lib', 'materialIconsManifest.json')
const OUT_LICENSE = path.join(OUT_ICONS_DIR, 'LICENSE')

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    const req = https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close()
        fs.unlinkSync(dest)
        return resolve(download(res.headers.location, dest))
      }
      if (res.statusCode !== 200) {
        file.close()
        fs.unlinkSync(dest)
        return reject(new Error(`Download failed: ${res.statusCode} ${url}`))
      }
      res.pipe(file)
      file.on('finish', () => file.close(resolve))
    })
    req.on('error', (err) => {
      file.close()
      try {
        fs.unlinkSync(dest)
      } catch {}
      reject(err)
    })
  })
}

function rmrf(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
}

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'material-icon-theme-'))
  const tarPath = path.join(tmpRoot, 'pkg.tgz')

  console.log(`[vendor-material-icons] Downloading material-icon-theme@${VERSION}...`)
  await download(TARBALL_URL, tarPath)

  console.log('[vendor-material-icons] Extracting tarball...')
  // npm tarballs use the BSD tar format; macOS/Linux tar handles both.
  const tar = spawnSync('tar', ['-xzf', tarPath, '-C', tmpRoot], { stdio: 'inherit' })
  if (tar.status !== 0) throw new Error(`tar exited with ${tar.status}`)

  const pkgDir = path.join(tmpRoot, 'package')
  const srcIconsDir = path.join(pkgDir, 'icons')
  const srcManifest = path.join(pkgDir, 'dist', 'material-icons.json')
  const srcLicense = path.join(pkgDir, 'LICENSE')

  if (!fs.existsSync(srcIconsDir)) throw new Error(`Missing ${srcIconsDir} in tarball`)
  if (!fs.existsSync(srcManifest)) throw new Error(`Missing ${srcManifest} in tarball`)
  if (!fs.existsSync(srcLicense)) throw new Error(`Missing ${srcLicense} in tarball`)

  // Fresh out dir — drop any stale SVGs from previous vendoring runs.
  rmrf(OUT_ICONS_DIR)
  fs.mkdirSync(OUT_ICONS_DIR, { recursive: true })

  const svgs = fs.readdirSync(srcIconsDir).filter((f) => f.endsWith('.svg'))
  for (const name of svgs) {
    fs.copyFileSync(path.join(srcIconsDir, name), path.join(OUT_ICONS_DIR, name))
  }
  console.log(
    `[vendor-material-icons] Copied ${svgs.length} SVGs → ${path.relative(ROOT, OUT_ICONS_DIR)}`
  )

  // Strip iconDefinitions paths down to bare ids — the renderer builds the
  // URL itself with import.meta.env.BASE_URL. Keep the same shape upstream
  // uses so matching code remains a 1:1 port.
  const raw = JSON.parse(fs.readFileSync(srcManifest, 'utf8'))
  const manifest = {
    version: VERSION,
    file: raw.file,
    folder: raw.folder,
    folderExpanded: raw.folderExpanded,
    fileNames: raw.fileNames || {},
    fileExtensions: raw.fileExtensions || {},
    folderNames: raw.folderNames || {},
    folderNamesExpanded: raw.folderNamesExpanded || {},
  }
  fs.mkdirSync(path.dirname(OUT_MANIFEST), { recursive: true })
  fs.writeFileSync(OUT_MANIFEST, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`[vendor-material-icons] Wrote manifest → ${path.relative(ROOT, OUT_MANIFEST)}`)

  fs.copyFileSync(srcLicense, OUT_LICENSE)
  console.log(`[vendor-material-icons] Copied LICENSE → ${path.relative(ROOT, OUT_LICENSE)}`)

  rmrf(tmpRoot)
  console.log('[vendor-material-icons] Done.')
}

main().catch((err) => {
  console.error('[vendor-material-icons] FAILED:', err)
  process.exit(1)
})
