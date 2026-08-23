import { build } from 'esbuild'

const external = ['electron', 'electron-mpv-video/main', 'electron-mpv-video/preload', 'ffmpeg-static', 'ffprobe-static', 'basic-ftp', 'webdav', 'smb2', 'ssh2-sftp-client', 'node:sqlite', 'node:sqlite/experimental', 'fs', 'path', 'os', 'crypto', 'stream', 'zlib', 'child_process', 'http', 'net', 'url', 'util']

const main = await build({
  entryPoints: ['src/main/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external,
  outfile: 'dist-main/index.js',
  sourcemap: false,
  define: { 'process.env.AURORA_NODE_ENV': '"production"' }
})

const preload = await build({
  entryPoints: ['src/preload/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external,
  outfile: 'dist-main/preload.js',
  sourcemap: false
})

console.log('main:', main.errors.length ? 'ERROR' : 'ok', 'preload:', preload.errors.length ? 'ERROR' : 'ok')
if (main.errors.length || preload.errors.length) {
  console.error([...main.errors, ...preload.errors])
  process.exit(1)
}
