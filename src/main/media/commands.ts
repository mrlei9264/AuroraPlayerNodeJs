import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import ffmpegPath from 'ffmpeg-static'
import { path as ffprobePath } from 'ffprobe-static'

export class MediaToolMissingError extends Error {
  constructor(name: string) { super(`Missing ${name} executable. Install project dependencies or restore the bundled media tools.`) }
}

export function resolveMediaCommand(name: 'ffmpeg' | 'ffprobe'): string {
  const candidate = name === 'ffmpeg' ? ffmpegPath : ffprobePath
  const executable = `${name}${process.platform === 'win32' ? '.exe' : ''}`
  const candidates: string[] = []
  if (candidate) candidates.push(app.isPackaged
    ? candidate.replace(/([\\/])app\.asar([\\/])/g, '$1app.asar.unpacked$2') : candidate)
  const modules = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules') : path.join(app.getAppPath(), 'node_modules')
  candidates.push(path.join(modules,
    name === 'ffmpeg' ? 'ffmpeg-static' : `ffprobe-static/bin/${process.platform}/${process.arch}`, executable))
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    if (directory.trim()) candidates.push(path.join(directory.trim().replace(/^"|"$/g, ''), executable))
  }
  for (const file of candidates) {
    try {
      const stat = fs.statSync(file)
      if (!stat.isFile() || stat.size === 0) continue
      fs.accessSync(file, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK)
      return path.resolve(file)
    } catch { /* Try the next bundled or PATH candidate. */ }
  }
  throw new MediaToolMissingError(name)
}
