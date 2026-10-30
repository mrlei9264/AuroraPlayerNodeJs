import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = path.join(root, '.cache', 'aurora-tool')
const buildStatePath = path.join(cacheDir, 'build.json')
const nativeDir = path.join(root, 'node_modules/electron-mpv-video/native/mpv-addon/build/Release')
const external = ['electron', 'electron-mpv-video/main', 'electron-mpv-video/preload', 'ffmpeg-static', 'ffprobe-static', 'basic-ftp', 'webdav', 'smb2', 'ssh2-sftp-client', 'node:sqlite', 'node:sqlite/experimental']
const rel = (file) => path.relative(root, file).split(path.sep).join('/')
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const hash = (data) => crypto.createHash('sha256').update(data).digest('hex')
function sha(file) {
  const digest = crypto.createHash('sha256')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  const descriptor = fs.openSync(file, 'r')
  try {
    for (;;) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null)
      if (!count) break
      digest.update(buffer.subarray(0, count))
    }
    return digest.digest('hex')
  } finally { fs.closeSync(descriptor) }
}
const fail = (message) => { throw new Error(message) }
const exists = (file) => fs.existsSync(file)

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`)
  fs.renameSync(temporary, file)
}
function inside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}
function noLinks(file) {
  let current = path.resolve(file)
  for (;;) {
    if (exists(current) && fs.lstatSync(current).isSymbolicLink()) fail(`Symbolic links/junctions are not supported here: ${current}`)
    const parent = path.dirname(current)
    if (parent === current) return
    current = parent
  }
}
function removeGenerated(relative) {
  if (!['dist-main', 'dist/renderer', '.cache/aurora-tool'].includes(relative)) fail(`Not a disposable build directory: ${relative}`)
  const target = path.resolve(root, relative)
  if (!inside(root, target)) fail('Refusing to remove a path outside the project')
  noLinks(target)
  fs.rmSync(target, { recursive: true, force: true })
}
function filesUnder(directory) {
  if (!exists(directory)) return []
  noLinks(directory)
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en')).flatMap((entry) => {
    const file = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) fail(`Unsupported symbolic link: ${file}`)
    if (entry.isDirectory()) return filesUnder(file)
    if (!entry.isFile()) fail(`Unsupported filesystem entry: ${file}`)
    return [file]
  })
}
function tree(directory) {
  const result = Object.create(null)
  for (const file of filesUnder(directory)) result[path.relative(directory, file).split(path.sep).join('/')] = { sha256: sha(file), size: fs.statSync(file).size }
  return result
}
function fingerprint(inputs) {
  return hash(JSON.stringify(inputs.flatMap((input) => {
    const file = path.resolve(root, input)
    if (!exists(file)) return [[input, 'missing']]
    return (fs.statSync(file).isDirectory() ? filesUnder(file) : [file]).map((entry) => [rel(entry), sha(entry)])
  })))
}
function run(command, args = [], { capture = false, env = process.env } = {}) {
  console.log(`> ${[command, ...args].map((arg) => /\s/.test(arg) ? JSON.stringify(arg) : arg).join(' ')}`)
  const result = spawnSync(command, args, { cwd: root, env, shell: false, windowsHide: true, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', maxBuffer: 32 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) fail(`${path.basename(command)} failed (${result.status ?? result.signal}): ${result.stderr ?? ''}`)
  return capture ? (result.stdout ?? '').trim() : result.status
}
function npmArgs(args, options = {}) {
  const candidates = [process.env.npm_execpath, path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')]
  const cli = candidates.find((file) => file && exists(file) && /\.[cm]?js$/.test(file))
  if (!cli) fail('Cannot locate npm-cli.js. Run through npm: npm run tool -- <command>')
  return run(process.execPath, [cli, ...args], options)
}
function bin(packageName, args = [], options = {}) {
  const packageDir = path.join(root, 'node_modules', packageName)
  if (!exists(path.join(packageDir, 'package.json'))) fail(`Missing ${packageName}; install dependencies first`)
  const entry = readJson(path.join(packageDir, 'package.json')).bin
  const script = typeof entry === 'string' ? entry : entry?.[packageName.split('/').pop()] ?? Object.values(entry ?? {})[0]
  if (!script) fail(`No CLI entry for ${packageName}`)
  return run(process.execPath, [path.resolve(packageDir, script), ...args], options)
}
const git = (args) => run('git', args, { capture: true })

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/
function versionCheck() {
  const manifest = readJson(path.join(root, 'package.json'))
  const lock = readJson(path.join(root, 'package-lock.json'))
  if (!SEMVER.test(manifest.version)) fail('package.json version must be a valid semantic version')
  if (lock.version !== manifest.version || lock.packages?.['']?.version !== manifest.version) fail('package.json and package-lock.json versions differ')
  console.log(`Version: ${manifest.version}`)
  return manifest.version
}
function versionSet(requested) {
  const current = versionCheck()
  let next = requested
  if (['major', 'minor', 'patch'].includes(requested)) {
    const parts = current.split(/[+-]/)[0].split('.').map(Number)
    const index = ['major', 'minor', 'patch'].indexOf(requested)
    parts[index] += 1
    for (let i = index + 1; i < 3; i++) parts[i] = 0
    next = parts.join('.')
  }
  if (!next || !SEMVER.test(next)) fail('Specify a semantic version or major/minor/patch')
  const manifestPath = path.join(root, 'package.json')
  const lockPath = path.join(root, 'package-lock.json')
  const originalManifest = fs.readFileSync(manifestPath)
  const originalLock = fs.readFileSync(lockPath)
  const manifest = JSON.parse(originalManifest)
  const lock = JSON.parse(originalLock)
  manifest.version = next
  lock.version = next
  lock.packages[''].version = next
  try {
    writeJson(manifestPath, manifest)
    writeJson(lockPath, lock)
  } catch (error) {
    fs.writeFileSync(manifestPath, originalManifest)
    fs.writeFileSync(lockPath, originalLock)
    throw error
  }
  return versionCheck()
}
function requireCleanGit() {
  if (git(['status', '--porcelain'])) fail('Commit or stash changes before creating a release tag or publishing')
}
function revision() {
  try { return { commit: git(['rev-parse', 'HEAD']), dirty: !!git(['status', '--porcelain']) } }
  catch { return { commit: null, dirty: true } }
}

async function buildApplication(options = {}) {
  versionCheck()
  if (options.native && options['dry-run']) console.log('native: would rebuild before application components')
  if (options.native && !options['dry-run']) rebuildNative()
  const scope = options.scope ?? 'all'
  if (!['all', 'main', 'preload', 'renderer'].includes(scope)) fail('--scope must be all, main, preload, or renderer')
  const common = ['package.json', 'package-lock.json', 'scripts/tool.mjs', 'patches', 'tsconfig.main.json', 'tsconfig.renderer.json']
  const definitions = {
    main: { inputs: [...common, 'src/main', 'src/shared'], output: 'dist-main/index.js' },
    preload: { inputs: [...common, 'src/preload', 'src/shared'], output: 'dist-main/preload.js' },
    renderer: { inputs: [...common, 'src/renderer', 'src/shared', 'vite.config.ts'], output: 'dist/renderer' }
  }
  let state = {}
  try { state = readJson(buildStatePath) } catch { /* First production build. */ }
  if (!state || typeof state !== 'object' || Array.isArray(state)) state = {}
  const selected = scope === 'all' ? Object.keys(definitions) : [scope]
  if (options.full && !options['dry-run']) {
    if (scope === 'all') { removeGenerated('dist-main'); removeGenerated('dist/renderer') }
    else {
      const output = path.join(root, definitions[scope].output)
      noLinks(output)
      if (scope === 'renderer') removeGenerated('dist/renderer')
      else fs.rmSync(output, { force: true })
    }
  }
  for (const name of selected) {
    const definition = definitions[name]
    const signature = hash(JSON.stringify([process.versions.node, process.platform, process.arch, fingerprint(definition.inputs)]))
    const output = path.join(root, definition.output)
    noLinks(output)
    const outputHash = exists(output) ? fingerprint([definition.output]) : null
    if (!options.full && state[name]?.signature === signature && outputHash && state[name].outputHash === outputHash) {
      console.log(`${name}: unchanged, skipped`)
      continue
    }
    console.log(`${name}: ${options['dry-run'] ? 'would rebuild' : 'building'}`)
    if (options['dry-run']) continue
    if (name === 'renderer') {
      const { build } = await import('vite')
      await build({ configFile: path.join(root, 'vite.config.ts') })
      fs.copyFileSync(path.join(root, 'src/renderer/assets/icon/app_icon.png'), path.join(output, 'app_icon.png'))
    } else {
      const { build } = await import('esbuild')
      await build({ absWorkingDir: root, entryPoints: [`src/${name}/index.ts`], bundle: true, platform: 'node', format: 'cjs', target: 'node20', external, outfile: output, sourcemap: false,
        ...(name === 'main' ? { define: { 'process.env.AURORA_NODE_ENV': '"production"' } } : {}) })
    }
    state[name] = { signature, outputHash: fingerprint([definition.output]), builtAt: new Date().toISOString() }
    writeJson(buildStatePath, state)
  }
}

async function dev() {
  const { build } = await import('esbuild')
  const { createServer } = await import('vite')
  const { default: electronPath } = await import('electron')
  for (const name of ['main', 'preload']) {
    await build({ absWorkingDir: root, entryPoints: [`src/${name}/index.ts`], bundle: true, platform: 'node', format: 'cjs', target: 'node20', external, outfile: path.join(root, `dist-main/${name === 'main' ? 'index' : 'preload'}.js`),
      ...(name === 'main' ? { define: { 'process.env.AURORA_NODE_ENV': '"development"' } } : {}) })
  }
  const server = await createServer({ configFile: path.join(root, 'vite.config.ts') })
  await server.listen()
  const address = server.httpServer.address()
  const url = `http://localhost:${address.port}`
  console.log(`Renderer HMR: ${url}; restart this command after main/preload changes.`)
  const env = { ...process.env, AURORA_DEV_URL: url, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(electronPath, ['.'], { cwd: root, env, stdio: 'inherit', windowsHide: true })
  const stop = () => child.kill()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try {
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (value) => resolve(value ?? 1)) })
    process.exitCode = code
  } finally {
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
    await server.close()
  }
}

function patchVisualStudio() {
  const finderPath = path.join(root, 'node_modules/electron-mpv-video/node_modules/node-gyp/lib/find-visualstudio.js')
  if (!exists(finderPath)) return
  const source = fs.readFileSync(finderPath, 'utf8')
  let patched = source.replaceAll('[2019, 2022]', '[2019, 2022, 2026]')
  const block = (major, year) => [
    `    if (ret.versionMajor === ${major}) {`,
    `      ret.versionYear = ${year}`,
    '      return ret',
    '    }',
    ''
  ].join('\n')
  if (!patched.includes('ret.versionMajor === 18')) {
    const marker = block(17, 2022)
    if (!patched.includes(marker)) fail('Unable to enable VS 2026: node-gyp version layout changed')
    patched = patched.replace(marker, marker + block(18, 2026))
  } else {
    patched = patched.replace(block(18, 2022), block(18, 2026))
  }
  if (!patched.includes('versionYear === 2026')) {
    const marker = ["    } else if (versionYear === 2022) {", "      return 'v143'", '    }', ''].join('\n')
    if (!patched.includes(marker)) fail('Unable to select the Visual Studio 2026 v145 toolset')
    const addition = ["    else if (versionYear === 2026) {", "      return 'v145'", '    }', ''].join('\n')
    patched = patched.replace(marker, marker + addition)
  }
  if (patched !== source) {
    fs.writeFileSync(finderPath, patched)
    console.log('node-gyp: enabled Visual Studio 2026 detection')
  }
}
function rebuildNative() {
  patchVisualStudio()
  const env = { ...process.env }
  const python = path.join(root, '.tools/python-3.13/python.exe')
  if (process.platform === 'win32' && exists(python) && !env.PYTHON && !env.NODE_GYP_FORCE_PYTHON) {
    env.PYTHON = python
    env.NODE_GYP_FORCE_PYTHON = python
  }
  npmArgs(['rebuild', 'electron-mpv-video'], { env })
  for (const name of process.platform === 'win32' ? ['mpv_addon.node', 'libmpv-2.dll'] : ['mpv_addon.node']) {
    if (!exists(path.join(nativeDir, name))) fail(`Native build did not produce ${name}`)
  }
}
function patchCommand(action, options) {
  if (options.package && action === 'create') {
    bin('patch-package', [options.package, '--exclude', '(?:^package\\.json$|native/mpv-addon/build/.*)'])
    return
  }
  if (options.file) {
    if (action !== 'apply') fail('Use patch apply --file <source.patch>')
    const file = path.resolve(root, options.file)
    if (!fs.statSync(file).isFile()) fail('Patch must be a file')
    const args = ['apply', ...(options.reverse ? ['--reverse'] : []), '--whitespace=nowarn']
    git([...args, '--check', file])
    if (!options.check) git([...args, file])
    return
  }
  if (action === 'create') {
    if (!options.base || !options.out) fail('Use patch create --base <git-ref> --out <file.patch>, or --package <dependency>')
    const baseCommit = git(['rev-parse', '--verify', '--end-of-options', `${options.base}^{commit}`])
    const output = path.resolve(root, options.out)
    if (exists(output)) fail(`Refusing to overwrite ${output}`)
    const result = spawnSync('git', ['diff', '--binary', '--full-index', baseCommit, '--', '.'], { cwd: root, maxBuffer: 128 * 1024 * 1024, windowsHide: true })
    if (result.status !== 0 || result.error) fail(`git diff failed: ${result.error ?? result.stderr}`)
    fs.mkdirSync(path.dirname(output), { recursive: true })
    fs.writeFileSync(output, result.stdout)
    console.log(`Source patch: ${output} (tracked files only; untracked files are excluded)`)
  } else if (action === 'apply') {
    if (options.check) fail('--check applies to source patches supplied with --file')
    bin('patch-package', ['--error-on-fail', ...(options.reverse ? ['--reverse'] : [])])
    if (options.native) rebuildNative()
  } else fail('Use patch apply or patch create')
}

export async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return
  const { rcedit } = await import('rcedit')
  const executableName = `${context.packager.appInfo.productFilename}.exe`
  await rcedit(path.join(context.appOutDir, executableName), {
    icon: path.join(root, 'src/renderer/assets/icon/app_icon.ico'),
    'file-version': context.packager.appInfo.version, 'product-version': context.packager.appInfo.version,
    'version-string': { CompanyName: 'Aurora Project', FileDescription: 'Aurora Player', InternalName: 'AuroraPlayer', OriginalFilename: executableName, ProductName: 'Aurora Player' }
  })
}
export default afterPack

function outputDirectory(value, fallback) {
  const output = path.resolve(root, value ?? fallback)
  if (!inside(path.join(root, 'release'), output)) fail('Output must be a subdirectory of release/ to isolate generated artifacts')
  noLinks(output)
  if (exists(output) && fs.readdirSync(output).length) fail(`Output is not empty; choose a new --out directory: ${output}`)
  return output
}
async function packageApplication(options = {}) {
  if (process.platform !== 'win32' || process.arch !== 'x64') fail('The current packaging configuration supports Windows x64 only')
  const target = options.target ?? 'nsis'
  if (!['nsis', 'portable', 'dir'].includes(target)) fail('--target must be nsis, portable, or dir')
  const version = versionCheck()
  const output = outputDirectory(options.out, `release/${version}-${target}`)
  for (const name of ['mpv_addon.node', 'libmpv-2.dll']) {
    if (!exists(path.join(nativeDir, name)) && !options.native) fail(`Missing ${name}; run native rebuild or use --native`)
  }
  for (const [file, repair] of [
    ['node_modules/ffmpeg-static/ffmpeg.exe', 'npm rebuild ffmpeg-static'],
    ['node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe', 'npm ci']
  ]) {
    if (!exists(path.join(root, file))) fail(`Missing ${file}; restore dependencies with ${repair} before packaging`)
  }
  await buildApplication(options)
  bin('electron-builder', ['--win', ...(target === 'dir' ? ['--dir'] : [target]), '--x64', '--config', path.join(root, 'electron-builder.json'), `--config.directories.output=${output}`, '--publish', 'never'])
  return { version, output, target }
}

function artifactManifest(output, extra = {}) {
  const files = fs.readdirSync(output, { withFileTypes: true }).filter((entry) => entry.isFile() && !entry.name.startsWith('builder-') && !['release-manifest.json', 'SHA256SUMS.txt'].includes(entry.name)).map((entry) => {
    const file = path.join(output, entry.name)
    return { file: entry.name, size: fs.statSync(file).size, sha256: sha(file) }
  })
  fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), files.map((file) => `${file.sha256}  ${file.file}`).join('\n') + '\n')
  writeJson(path.join(output, 'release-manifest.json'), { format: 1, version: versionCheck(), platform: 'win32', arch: 'x64', createdAt: new Date().toISOString(), ...revision(), ...extra, files })
}
function safeEntry(directory, name) {
  if (typeof name !== 'string' || !name || /[\\:<>"|?*\x00-\x1f]/.test(name) || name.split('/').some((part) => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) fail(`Unsafe manifest path: ${name}`)
  const result = path.resolve(directory, name)
  if (!inside(directory, result)) fail(`Path escapes target: ${name}`)
  noLinks(result)
  return result
}
function requireValue(options, key) {
  return options[key] || fail(`Missing --${key}`)
}
function packagedApplication(directory) {
  if (!fs.statSync(directory).isDirectory() || !exists(path.join(directory, 'resources/app.asar'))) fail(`Use a complete Windows win-unpacked directory, not an installer or source tree: ${directory}`)
  if (exists(path.join(directory, 'data'))) fail('Application runtime data must not be included in a delta baseline/new build; use pristine packaging output')
}
function deltaCreate(options) {
  const base = path.resolve(root, requireValue(options, 'base'))
  const next = path.resolve(root, requireValue(options, 'next'))
  packagedApplication(base); packagedApplication(next)
  const output = outputDirectory(options.out, `release/delta-${Date.now()}`)
  if (inside(base, output) || inside(next, output) || inside(output, base) || inside(output, next) || base === output || next === output) fail('Delta output and application directories must not overlap')
  const before = tree(base)
  const after = tree(next)
  const changed = Object.keys(after).filter((file) => before[file]?.sha256 !== after[file].sha256)
  const removed = Object.keys(before).filter((file) => !Object.hasOwn(after, file))
  for (const name of changed) {
    const destination = safeEntry(path.join(output, 'payload'), name)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(safeEntry(next, name), destination)
  }
  writeJson(path.join(output, 'delta-manifest.json'), { format: 1, kind: 'aurora-file-delta', createdAt: new Date().toISOString(), base: before, next: after, changed, removed })
  console.log(`Delta: ${changed.length} changed/added, ${removed.length} removed: ${output}`)
  return output
}
function validateTreeManifest(entries, directory) {
  if (!entries || Array.isArray(entries) || typeof entries !== 'object' || !Object.keys(entries).length) fail('Invalid or empty tree manifest')
  const seen = new Set()
  for (const [name, info] of Object.entries(entries)) {
    safeEntry(directory, name)
    if (name.split('/')[0].toLowerCase() === 'data') fail('Delta must not modify runtime data')
    if (seen.has(name.toLowerCase()) || !info || !/^[a-f0-9]{64}$/.test(info.sha256) || !Number.isSafeInteger(info.size) || info.size < 0) fail(`Invalid/colliding manifest entry: ${name}`)
    seen.add(name.toLowerCase())
  }
}
function deltaApply(options) {
  const patch = path.resolve(root, requireValue(options, 'patch'))
  const target = path.resolve(root, requireValue(options, 'to'))
  noLinks(patch); noLinks(target)
  if (!fs.statSync(target).isDirectory()) fail('--to must be an existing, closed application directory')
  if (patch === target || inside(target, patch) || inside(patch, target) || target === root || inside(target, root)) fail('Delta and application/project paths must not overlap')
  if (!exists(path.join(target, 'resources/app.asar'))) fail('--to must be the application directory containing resources/app.asar')
  const manifest = readJson(path.join(patch, 'delta-manifest.json'))
  if (manifest.format !== 1 || manifest.kind !== 'aurora-file-delta') fail('Unsupported delta manifest')
  validateTreeManifest(manifest.base, target)
  validateTreeManifest(manifest.next, target)
  const changed = Object.keys(manifest.next).filter((name) => manifest.base[name]?.sha256 !== manifest.next[name].sha256)
  const removed = Object.keys(manifest.base).filter((name) => !Object.hasOwn(manifest.next, name))
  if (JSON.stringify(changed) !== JSON.stringify(manifest.changed) || JSON.stringify(removed) !== JSON.stringify(manifest.removed)) fail('Delta change lists do not match the manifest')
  for (const [name, info] of Object.entries(manifest.base)) {
    const file = safeEntry(target, name)
    if (!exists(file) || !fs.statSync(file).isFile() || sha(file) !== info.sha256) fail(`Baseline mismatch; use the full installer: ${name}`)
  }
  for (const name of changed) {
    const destination = safeEntry(target, name)
    if (exists(destination) && !fs.statSync(destination).isFile()) fail(`File/directory replacement requires a full installer: ${name}`)
    for (let parent = path.dirname(destination); inside(target, parent); parent = path.dirname(parent)) {
      if (exists(parent) && !fs.statSync(parent).isDirectory()) fail(`File/directory replacement requires a full installer: ${name}`)
    }
    if (!Object.hasOwn(manifest.base, name) && exists(destination)) fail(`New file would overwrite an unmanaged file: ${name}`)
    const payload = safeEntry(path.join(patch, 'payload'), name)
    if (!exists(payload) || !fs.statSync(payload).isFile() || sha(payload) !== manifest.next[name].sha256) fail(`Corrupt/missing payload: ${name}`)
  }
  console.log('Baseline and payload SHA-256 checks passed. The application must be closed.')
  if (options.check) return
  const backup = path.join(root, 'release/rollback', crypto.randomUUID())
  fs.mkdirSync(backup, { recursive: true })
  const touched = [...changed, ...removed]
  for (const name of touched) {
    if (!Object.hasOwn(manifest.base, name)) continue
    const file = safeEntry(backup, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.copyFileSync(safeEntry(target, name), file)
  }
  writeJson(path.join(backup, 'rollback.json'), { target, changed, removed, base: manifest.base, next: manifest.next })
  const applied = []
  try {
    for (const name of changed) {
      const destination = safeEntry(target, name)
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      applied.push(name)
      fs.copyFileSync(safeEntry(path.join(patch, 'payload'), name), destination)
    }
    for (const name of removed) { applied.push(name); fs.unlinkSync(safeEntry(target, name)) }
    for (const [name, info] of Object.entries(manifest.next)) if (sha(safeEntry(target, name)) !== info.sha256) fail(`Post-apply checksum mismatch: ${name}`)
  } catch (error) {
    const failures = []
    for (const name of applied.reverse()) {
      try {
        const destination = safeEntry(target, name)
        if (Object.hasOwn(manifest.base, name)) fs.copyFileSync(safeEntry(backup, name), destination)
        else fs.rmSync(destination, { force: true })
      } catch { failures.push(name) }
    }
    fail(`${error.message}\nRollback ${failures.length ? `incomplete: ${failures.join(', ')}` : 'completed'}. Backup retained: ${backup}`)
  }
  console.log(`Delta applied. Rollback backup retained at ${backup}; unmanaged application data was left intact.`)
}

async function releasePrepare(options) {
  if (options.version) versionSet(options.version)
  const result = await packageApplication(options)
  if (options.base) {
    const delta = deltaCreate({ base: options.base, next: path.join(result.output, 'win-unpacked'), out: path.join(result.output, 'delta') })
    run('tar', ['-czf', path.join(result.output, `Aurora-Player-${result.version}-delta.tar.gz`), '-C', delta, '.'])
  }
  const notes = options['notes-file'] ? fs.readFileSync(path.resolve(root, options['notes-file']), 'utf8') : `Aurora Player v${result.version}\n\nWindows x64 ${result.target}; see SHA256SUMS.txt for artifact checksums.\n`
  fs.writeFileSync(path.join(result.output, 'release-notes.md'), notes)
  artifactManifest(result.output, { target: result.target })
  console.log(`Local release prepared: ${result.output}. Nothing was committed, tagged, pushed, or uploaded.`)
}
function publishRelease(options) {
  requireCleanGit()
  const directory = path.resolve(root, requireValue(options, 'dir'))
  const manifest = readJson(path.join(directory, 'release-manifest.json'))
  const version = versionCheck()
  if (manifest.format !== 1 || manifest.version !== version || manifest.dirty || manifest.commit !== git(['rev-parse', 'HEAD']) || manifest.target === 'dir') fail('Release must be prepared from this clean commit/version with nsis or portable target')
  const tag = `v${version}`
  if (git(['rev-parse', `${tag}^{commit}`]) !== manifest.commit) fail('Release tag does not point to the prepared commit')
  if (!Array.isArray(manifest.files) || !manifest.files.length) fail('No release assets')
  const assets = manifest.files.map((entry) => {
    const file = safeEntry(directory, entry.file)
    if (sha(file) !== entry.sha256) fail(`Release asset was modified: ${entry.file}`)
    return file
  })
  const repo = requireValue(options, 'repo')
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) fail('--repo must be owner/repository')
  run('gh', ['release', 'create', tag, '--repo', repo, '--verify-tag', '--title', `Aurora Player v${version}`, '--notes-file', path.join(directory, 'release-notes.md'), ...(options.live ? [] : ['--draft']), ...(version.includes('-') ? ['--prerelease'] : []), ...assets, path.join(directory, 'SHA256SUMS.txt'), path.join(directory, 'release-manifest.json')])
}
function doctor() {
  const results = []
  const check = (name, ok) => { results.push(ok); console.log(`${ok ? 'OK' : 'MISSING'} ${name}`) }
  check('Node.js >= 20', Number(process.versions.node.split('.')[0]) >= 20)
  for (const name of ['esbuild', 'vite', 'electron', 'electron-builder', 'patch-package', 'typescript']) check(name, exists(path.join(root, 'node_modules', name, 'package.json')))
  for (const name of ['mpv_addon.node', 'libmpv-2.dll']) check(name, exists(path.join(nativeDir, name)))
  check('bundled FFmpeg', exists(path.join(root, 'node_modules/ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')))
  check('bundled FFprobe', exists(path.join(root, 'node_modules/ffprobe-static/bin', process.platform, process.arch, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')))
  for (const key of ['MPV_INCLUDE_DIR', 'MPV_LIB_DIR', 'MPV_LIB', 'MPV_RUNTIME_DIR', 'PYTHON', 'NODE_GYP_FORCE_PYTHON']) console.log(`${key}: ${process.env[key] ? 'configured' : 'not set'}`)
  versionCheck()
  if (results.some((ok) => !ok)) process.exitCode = 1
}

const booleanOptions = new Set(['help', 'dry-run', 'full', 'native', 'reverse', 'check', 'ci', 'live'])
function parse(argv) {
  const positional = []
  const options = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--') continue
    if (arg === '-h') { options.help = true; continue }
    if (!arg.startsWith('--')) { positional.push(arg); continue }
    const [key, inline] = arg.slice(2).split(/=(.*)/s)
    if (Object.hasOwn(options, key)) fail(`Duplicate option: --${key}`)
    if (booleanOptions.has(key)) {
      if (inline !== undefined) fail(`--${key} does not take a value`)
      options[key] = true
    } else {
      const value = inline ?? argv[++i]
      if (!value || value.startsWith('--')) fail(`Missing value for --${key}`)
      options[key] = value
    }
  }
  return { positional, options }
}
const allowed = {
  dev: [], start: [], doctor: [], typecheck: [], install: ['ci'], postinstall: [], native: [], clean: [],
  build: ['full', 'native', 'scope'], dist: ['full', 'native', 'target', 'out'],
  version: [], patch: ['file', 'package', 'base', 'out', 'check', 'reverse', 'native'],
  delta: ['base', 'next', 'out', 'patch', 'to', 'check'],
  release: ['full', 'native', 'target', 'out', 'version', 'base', 'notes-file', 'dir', 'repo', 'live']
}
const help = `Aurora Player — unified project tool

npm run tool -- <command> [options]
node scripts/tool.mjs <command> [options]

  dev                         Build main/preload; start renderer HMR + Electron
  start                       Start the existing production build
  doctor                      Inspect tools, native outputs, and version alignment
  install [--ci]              npm install / npm ci (includes postinstall)
  postinstall                 Apply dependency patches, VS compatibility, native rebuild
  native rebuild              Rebuild mpv with VS 2026 / portable Python support
  typecheck                   Explicit TypeScript checks (never run implicitly)
  build [--full] [--native] [--scope all|main|preload|renderer]
                              Hash-based incremental or clean full JS/assets build
  dist [--target nsis|portable|dir] [--full] [--native] [--out release/<new-dir>]
                              Build + package Windows x64; never uploads
  clean                       Remove only dist-main, dist/renderer, and build cache
  version check               Check package and lockfile versions
  version set <semver>         Update package.json + package-lock.json, no Git changes
  version bump major|minor|patch
  version tag                 Create local annotated v<version> tag on a clean commit
  patch apply [--reverse] [--native]
                              Apply/reverse patches/ via patch-package
  patch apply --file <x.patch> [--check] [--reverse]
                              Check/apply a Git source patch; preserves staging
  patch create --package <dependency>
                              Generate patch-package patch; exclude native build output
  patch create --base <git-ref> --out <file.patch>
                              Export tracked working-tree changes as a binary Git patch
  delta create --base <old-app-dir> --next <new-app-dir> [--out release/<new-dir>]
  delta apply --patch <delta-dir> --to <closed-app-dir> [--check]
                              SHA-256 verified file delta with automatic failure rollback
  release [prepare] [--version <semver|major|minor|patch>] [dist options]
          [--base <old-app-dir>] [--notes-file <markdown>]
                              Prepare local artifacts, notes, manifest and SHA256SUMS
  release publish --dir <prepared-release> --repo <owner/repo> [--live]
                              Explicit GitHub upload; defaults to draft; tag must be pushed

--dry-run prints intended steps without writing, building, tagging or uploading.
See docs/tooling.md for workflows, delta limitations and prerequisites.
`
function dryPlan(command, action, options) {
  console.log(`DRY RUN: ${command}${action ? ` ${action}` : ''}`)
  const plans = {
    dev: 'Build dev main/preload; start Vite and Electron.', start: 'Launch Electron against existing production output.',
    doctor: 'Inspect local prerequisites and version files.', typecheck: 'Run both TypeScript projects with --noEmit.',
    install: `Run npm ${options.ci ? 'ci' : 'install'}, including dependency and project lifecycle scripts.`,
    postinstall: 'Apply patches/; patch node-gyp VS detection; rebuild mpv.', native: 'Patch node-gyp VS detection; rebuild mpv.',
    clean: 'Remove only dist-main/, dist/renderer/ and .cache/aurora-tool/. Release artifacts and runtime data are retained.',
    dist: 'Build changed production components; package to an empty release subdirectory with --publish never.',
    version: action === 'tag' ? 'Check a clean working tree and create a local annotated version tag.' : 'Check/update only package.json and package-lock.json.',
    patch: 'Check/create/apply the requested dependency or Git patch; do not commit or stage files.',
    delta: action === 'apply' ? 'Validate delta paths and SHA-256 baseline/payload; back up changed files; apply with rollback on failure.' : 'Compare pristine application trees; write changed files, removal list and SHA-256 manifest.',
    release: action === 'publish' ? `Verify a clean prepared release and pushed version tag; upload a ${options.live ? 'public release' : 'draft'} through gh.` : 'Optionally update version; build/package locally; optionally create delta archive; write notes and checksums.'
  }
  console.log(plans[command])
  console.log(JSON.stringify(options, null, 2))
}
function validateArguments(command, action, value, options, count) {
  for (const key of Object.keys(options)) if (!['dry-run', ...allowed[command]].includes(key)) fail(`Unsupported option for ${command}: --${key}`)
  const maxArgs = command === 'version' ? 3 : ['native', 'patch', 'delta', 'release'].includes(command) ? 2 : 1
  if (count > maxArgs) fail(`Too many arguments for ${command}`)
  if (command === 'version' && !['check', 'set', 'bump', 'tag'].includes(action ?? 'check')) fail('Use version check/set/bump/tag')
  if (command === 'version' && ['set', 'bump'].includes(action) && !value) fail('Missing version or bump type')
  if (command === 'version' && action === 'bump' && !['major', 'minor', 'patch'].includes(value)) fail('Use version bump major/minor/patch')
  if (command === 'version' && !['set', 'bump'].includes(action) && value) fail('Unexpected version argument')
  if (command === 'native' && action && action !== 'rebuild') fail('Use native rebuild')
  if (command === 'patch' && !['apply', 'create'].includes(action ?? 'apply')) fail('Use patch apply/create')
  if (command === 'delta' && !['apply', 'create'].includes(action)) fail('Use delta create/apply')
  if (command === 'release' && !['prepare', 'publish'].includes(action ?? 'prepare')) fail('Use release prepare/publish')
  if (command === 'release') {
    const valid = action === 'publish' ? ['dir', 'repo', 'live'] : ['full', 'native', 'target', 'out', 'version', 'base', 'notes-file']
    for (const key of Object.keys(options)) if (key !== 'dry-run' && !valid.includes(key)) fail(`Unsupported option for release ${action ?? 'prepare'}: --${key}`)
  }
  if (command === 'patch') {
    const valid = (action ?? 'apply') === 'create'
      ? options.package ? ['package'] : ['base', 'out']
      : options.file ? ['file', 'check', 'reverse'] : ['reverse', 'native']
    for (const key of Object.keys(options)) if (key !== 'dry-run' && !valid.includes(key)) fail(`Unsupported option for this patch operation: --${key}`)
    if (options.package && !/^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/.test(options.package)) fail('--package must be a dependency name')
  }
  if (command === 'delta') {
    const valid = action === 'create' ? ['base', 'next', 'out'] : ['patch', 'to', 'check']
    for (const key of Object.keys(options)) if (key !== 'dry-run' && !valid.includes(key)) fail(`Unsupported option for delta ${action}: --${key}`)
  }
}
async function main() {
  const { positional, options } = parse(process.argv.slice(2))
  const [command = 'help', action, value] = positional
  if (command === 'help' || options.help) { console.log(help); return }
  if (!Object.hasOwn(allowed, command)) fail(`Unknown command: ${command}; use --help`)
  validateArguments(command, action, value, options, positional.length)
  if (options['dry-run'] && command !== 'build') { dryPlan(command, action, options); return }
  process.chdir(root)
  switch (command) {
    case 'dev': await dev(); break
    case 'start': {
      if (!exists(path.join(root, 'dist-main/index.js')) || !exists(path.join(root, 'dist/renderer/index.html'))) fail('Run build before start')
      const { default: electronPath } = await import('electron')
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
      run(electronPath, ['.'], { env }); break
    }
    case 'doctor': doctor(); break
    case 'install': npmArgs([options.ci ? 'ci' : 'install']); break
    case 'postinstall': patchCommand('apply', {}); rebuildNative(); break
    case 'native': rebuildNative(); break
    case 'typecheck': bin('typescript', ['-p', 'tsconfig.main.json', '--noEmit']); bin('typescript', ['-p', 'tsconfig.renderer.json', '--noEmit']); break
    case 'build': await buildApplication(options); break
    case 'dist': { const result = await packageApplication(options); artifactManifest(result.output, { target: result.target }); break }
    case 'clean':
      for (const directory of ['dist-main', 'dist/renderer', '.cache/aurora-tool']) removeGenerated(directory)
      break
    case 'version':
      if (!action || action === 'check') versionCheck()
      else if (action === 'set' || action === 'bump') versionSet(value)
      else { requireCleanGit(); const version = versionCheck(); git(['tag', '-a', `v${version}`, '-m', `Aurora Player v${version}`]); }
      break
    case 'patch': patchCommand(action ?? 'apply', options); break
    case 'delta': if (action === 'create') deltaCreate(options); else deltaApply(options); break
    case 'release': if (action === 'publish') publishRelease(options); else await releasePrepare(options); break
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`Aurora tool: ${error.message}`); process.exitCode = 1 })
}
