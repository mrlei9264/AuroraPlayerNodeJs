import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { build } from 'esbuild'
import electronPath from 'electron'

const root = path.dirname(fileURLToPath(import.meta.url)) + '/..'
const { stdout } = await import('child_process')
void stdout

console.log('building main + preload (dev)...')
await build({
  entryPoints: ['src/main/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron', 'electron-mpv-video/main', 'ffmpeg-static', 'ffprobe-static', 'basic-ftp', 'webdav', 'smb2', 'ssh2-sftp-client', 'node:sqlite'],
  outfile: 'dist-main/index.js',
  define: { 'process.env.AURORA_NODE_ENV': '"development"' }
})
await build({
  entryPoints: ['src/preload/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron', 'electron-mpv-video/preload'],
  outfile: 'dist-main/preload.js'
})

console.log('starting vite dev server...')
const server = await createServer({
  root: path.join(root, 'src/renderer'),
  base: './',
  plugins: [react()],
  server: { port: 5173, strictPort: true }
})
await server.listen()
const port = server.config.server.port ?? 5173
console.log(`vite ready on http://localhost:${port}`)

const child = spawn(electronPath, ['.'], {
  cwd: root,
  env: { ...process.env, AURORA_DEV_URL: `http://localhost:${port}`, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  stdio: 'inherit'
})
child.on('exit', (code) => {
  void server.close()
  process.exit(code ?? 0)
})
process.on('SIGINT', () => {
  child.kill()
})
