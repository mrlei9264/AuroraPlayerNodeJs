import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = { ...process.env }
const portablePython = path.join(root, '.tools', 'python-3.13', 'python.exe')

// The project-local Python is used when present so node-gyp does not fall
// through to the non-functional Windows Store launcher on clean machines.
if (process.platform === 'win32' && fs.existsSync(portablePython)) {
  env.PYTHON = portablePython
  env.NODE_GYP_FORCE_PYTHON = portablePython
}

const npmCli = env.npm_execpath
const command = npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm'
const args = npmCli
  ? [npmCli, 'rebuild', 'electron-mpv-video']
  : ['rebuild', 'electron-mpv-video']
const result = spawnSync(command, args, {
  cwd: root,
  env,
  stdio: 'inherit'
})

if (result.error) throw result.error
process.exit(result.status ?? 1)
