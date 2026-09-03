import { execSync } from 'child_process'
import { build } from 'esbuild'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.dirname(fileURLToPath(import.meta.url)) + '/..'

execSync('node scripts/version.mjs check', { cwd: root, stdio: 'inherit' })

console.log('building main + preload...')
execSync('node scripts/build-main.mjs', { cwd: root, stdio: 'inherit' })

console.log('building renderer...')
execSync('npx vite build', { cwd: root, stdio: 'inherit' })
fs.copyFileSync(
  path.join(root, 'src/renderer/assets/icon/app_icon.png'),
  path.join(root, 'dist/renderer/app_icon.png')
)

console.log('done. run with: npm start')
