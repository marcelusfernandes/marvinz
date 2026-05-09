const fs = require('node:fs')
const path = require('node:path')

const prebuildsDir = path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds')
if (!fs.existsSync(prebuildsDir)) process.exit(0)

for (const platform of fs.readdirSync(prebuildsDir)) {
  const helper = path.join(prebuildsDir, platform, 'spawn-helper')
  if (fs.existsSync(helper)) {
    fs.chmodSync(helper, 0o755)
    console.log(`[fix-node-pty] chmod +x ${path.relative(process.cwd(), helper)}`)
  }
}
