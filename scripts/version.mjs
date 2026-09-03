import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packagePath = path.join(root, 'package.json')
const lockPath = path.join(root, 'package-lock.json')
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function checkVersion() {
  const manifest = readJson(packagePath)
  const lock = readJson(lockPath)
  const version = String(manifest.version ?? '')
  const lockVersion = String(lock.packages?.['']?.version ?? lock.version ?? '')
  if (!SEMVER.test(version)) throw new Error(`package.json contains an invalid semantic version: ${version || '(empty)'}`)
  if (lockVersion !== version) throw new Error(`Version mismatch: package.json=${version}, package-lock.json=${lockVersion || '(empty)'}`)
  console.log(`Aurora Player version: ${version}`)
  return version
}

const [command = 'check', requestedVersion] = process.argv.slice(2)

if (command === 'check') {
  checkVersion()
} else if (command === 'set') {
  if (!requestedVersion || !SEMVER.test(requestedVersion)) {
    throw new Error('Usage: npm run version:set -- <major.minor.patch>')
  }
  const npmCli = process.env.npm_execpath
  if (!npmCli) throw new Error('Run this command through npm: npm run version:set -- <version>')
  execFileSync(process.execPath, [npmCli, 'version', requestedVersion, '--no-git-tag-version', '--allow-same-version'], {
    cwd: root,
    stdio: 'inherit'
  })
  checkVersion()
  console.log(`Next: commit the version change, then create and push tag v${requestedVersion}.`)
} else {
  throw new Error(`Unknown command: ${command}`)
}
