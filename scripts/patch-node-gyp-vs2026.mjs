import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const finderPath = path.join(
  root,
  'node_modules',
  'electron-mpv-video',
  'node_modules',
  'node-gyp',
  'lib',
  'find-visualstudio.js'
)

if (!fs.existsSync(finderPath)) process.exit(0)

const source = fs.readFileSync(finderPath, 'utf8')
let patched = source.replaceAll('[2019, 2022]', '[2019, 2022, 2026]')

const versionMarker = `    if (ret.versionMajor === 17) {
      ret.versionYear = 2022
      return ret
    }
`
if (!patched.includes('ret.versionMajor === 18')) {
  if (!patched.includes(versionMarker)) {
    throw new Error('Unable to add Visual Studio 2026 support: node-gyp version layout changed')
  }
  patched = patched.replace(versionMarker, `${versionMarker}    if (ret.versionMajor === 18) {
      ret.versionYear = 2026
      return ret
    }
`)
} else {
  patched = patched.replace(
    `    if (ret.versionMajor === 18) {
      ret.versionYear = 2022
      return ret
    }
`,
    `    if (ret.versionMajor === 18) {
      ret.versionYear = 2026
      return ret
    }
`
  )
}

const toolsetMarker = `    } else if (versionYear === 2022) {
      return 'v143'
    }
`
if (!patched.includes("versionYear === 2026")) {
  if (!patched.includes(toolsetMarker)) {
    throw new Error('Unable to select the Visual Studio 2026 v145 toolset')
  }
  patched = patched.replace(toolsetMarker, `${toolsetMarker}    else if (versionYear === 2026) {
      return 'v145'
    }
`)
}

if (patched === source) process.exit(0)
if (!patched.includes('ret.versionMajor === 18')) {
  throw new Error('Unable to add Visual Studio 2026 support: node-gyp layout changed')
}

fs.writeFileSync(finderPath, patched)
console.log('node-gyp: enabled Visual Studio 2026 detection')
