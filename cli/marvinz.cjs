#!/usr/bin/env node
'use strict'

// Thin launcher for Marvinz (`npx marvinz`). Fetches the latest prebuilt desktop
// app from GitHub Releases and runs it, caching it under ~/.cache/marvinz.
//
// Why this exists: files fetched via Node (not a browser) are NOT given the
// macOS `com.apple.quarantine` xattr, so the app opens with no Gatekeeper
// warning — without Apple notarization. And the prebuilt app already ships
// node-pty compiled for its Electron, so nothing native is built on the user's
// machine. See issue #517.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const https = require('node:https')
const { spawn, spawnSync } = require('node:child_process')

const REPO = 'marcelusfernandes/marvinz'
const CACHE_ROOT = path.join(os.homedir(), '.cache', 'marvinz')
const UA = 'marvinz-launcher'

function getJSON(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          return resolve(getJSON(res.headers.location))
        }
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new Error(`GitHub API ${res.statusCode} for ${url}`))
        }
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(data))
          } catch (err) {
            reject(err)
          }
        })
      })
      .on('error', reject)
  })
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': UA, Accept: 'application/octet-stream' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          return resolve(download(res.headers.location, dest))
        }
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new Error(`download ${res.statusCode} for ${url}`))
        }
        const file = fs.createWriteStream(dest)
        res.pipe(file)
        file.on('finish', () => file.close(() => resolve()))
        file.on('error', (err) => {
          fs.rmSync(dest, { force: true })
          reject(err)
        })
      })
      .on('error', reject)
  })
}

/** Pure: pick the right Release asset for the platform. Exported for tests. */
function pickAsset(assets, platform) {
  if (platform === 'darwin') {
    return (
      assets.find((a) => /\.zip$/i.test(a.name) && /mac|darwin|arm64|x64/i.test(a.name)) ||
      assets.find((a) => /\.zip$/i.test(a.name)) ||
      assets.find((a) => /\.dmg$/i.test(a.name))
    )
  }
  if (platform === 'linux') return assets.find((a) => /\.AppImage$/i.test(a.name))
  if (platform === 'win32') {
    return (
      assets.find((a) => /\.exe$/i.test(a.name) && !/setup/i.test(a.name)) ||
      assets.find((a) => /\.exe$/i.test(a.name))
    )
  }
  return undefined
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`${cmd} failed: ${(r.stderr || r.stdout || '').trim()}`)
  return r.stdout || ''
}

function extract(archive, dir) {
  if (/\.zip$/i.test(archive)) {
    run('unzip', ['-oq', archive, '-d', dir])
  } else if (/\.dmg$/i.test(archive)) {
    const out = run('hdiutil', ['attach', '-nobrowse', '-readonly', archive])
    const mount = out.trim().split('\n').pop().split('\t').pop().trim()
    try {
      const app = fs.readdirSync(mount).find((n) => n.endsWith('.app'))
      if (!app) throw new Error('no .app inside the .dmg')
      run('cp', ['-R', path.join(mount, app), dir])
    } finally {
      run('hdiutil', ['detach', '-quiet', mount])
    }
  } else if (/\.AppImage$/i.test(archive)) {
    fs.chmodSync(archive, 0o755)
  }
}

function launch(dir, archive, platform) {
  if (platform === 'darwin') {
    const app = fs.readdirSync(dir).find((n) => n.endsWith('.app'))
    spawn('open', [path.join(dir, app)], { stdio: 'ignore', detached: true }).unref()
  } else if (platform === 'linux') {
    spawn(archive, [], { stdio: 'ignore', detached: true }).unref()
  } else if (platform === 'win32') {
    spawn(archive, [], { stdio: 'ignore', detached: true, shell: true }).unref()
  }
}

async function main() {
  const platform = process.platform
  if (!['darwin', 'linux', 'win32'].includes(platform)) {
    throw new Error(`unsupported platform: ${platform}`)
  }
  const release = await getJSON(`https://api.github.com/repos/${REPO}/releases/latest`)
  const asset = pickAsset(release.assets || [], platform)
  if (!asset) throw new Error(`no prebuilt asset for ${platform} in ${release.tag_name}`)

  if (process.env.MARVINZ_DRYRUN) {
    process.stdout.write(`${release.tag_name} -> ${asset.name}\n`)
    return
  }

  const dir = path.join(CACHE_ROOT, release.tag_name)
  const archive = path.join(dir, asset.name)
  const ready = path.join(dir, '.ready')
  if (!fs.existsSync(ready)) {
    fs.mkdirSync(dir, { recursive: true })
    process.stderr.write(`Downloading Marvinz ${release.tag_name} (${asset.name})…\n`)
    await download(asset.browser_download_url, archive)
    extract(archive, dir)
    fs.writeFileSync(ready, asset.name)
  }
  launch(dir, archive, platform)
  process.stderr.write(`Launched Marvinz ${release.tag_name}.\n`)
}

module.exports = { pickAsset }

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`marvinz: ${err.message}\n`)
    process.exit(1)
  })
}
