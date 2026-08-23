import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { spawn } from 'child_process'
import os from 'os'

export interface CredentialRecord {
  password: string
  persistent: boolean
}

export class CredentialStore {
  private file: string
  private memory = new Map<string, string>()
  private cached: { json: string } | null = null

  constructor(credentialsFile: string) {
    this.file = credentialsFile
  }

  private obfuscate(s: string): Buffer {
    const key = crypto.createHash('sha256').update('aurora-player-' + os.hostname()).digest().subarray(0, 32)
    const iv = crypto.randomBytes(16)
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
    return Buffer.concat([iv, cipher.update(Buffer.from(s, 'utf8')), cipher.final()])
  }

  private deobfuscate(buf: Buffer): string {
    try {
      const key = crypto.createHash('sha256').update('aurora-player-' + os.hostname()).digest().subarray(0, 32)
      const iv = buf.subarray(0, 16)
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
      return Buffer.concat([decipher.update(buf.subarray(16)), decipher.final()]).toString('utf8')
    } catch {
      return ''
    }
  }

  async write(key: string, password: string, persistent: boolean): Promise<void> {
    if (persistent) {
      try {
        await this.writeSecure(key, password)
      } catch {
        this.persistFallback(key, password)
        this.memory.set(key, password)
      }
    } else {
      this.memory.set(key, password)
    }
  }

  async read(key: string, persistent: boolean): Promise<string | null> {
    if (!persistent) return this.memory.get(key) ?? null
    try {
      const v = await this.readSecure(key)
      if (v !== null) return v
    } catch {
      void 0
    }
    try {
      const fallback = this.readFallback(key)
      if (fallback !== null) return fallback
    } catch {
      void 0
    }
    return this.memory.get(key) ?? null
  }

  async remove(key: string): Promise<void> {
    this.memory.delete(key)
    try {
      await this.removeSecure(key)
    } catch {
      void 0
    }
  }

  private async writeSecure(key: string, password: string): Promise<void> {
    if (process.platform === 'win32') {
      const ps = await this.psInvoke(
        `$s = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($args[1])); ` +
          `Add-Type -AssemblyName System.Security; ` +
          `$e = [System.Security.Cryptography.ProtectedData]::Protect([System.Text.Encoding]::UTF8.GetBytes($args[0] + '|' + $s), $null, 'CurrentUser'); ` +
          `[Convert]::ToBase64String($e)`,
        [key, password]
      )
      if (ps) {
        this.persistCiphertext(key, ps)
        return
      }
      throw new Error('no ps')
    }
    this.persistFallback(key, password)
  }

  private async readSecure(key: string): Promise<string | null> {
    if (process.platform === 'win32') {
      const b64 = this.readCiphertext(key)
      if (!b64) return null
      const ps = await this.psInvoke(
        `Add-Type -AssemblyName System.Security; ` +
          `$d = [Convert]::FromBase64String($args[0]); ` +
          `$p = [System.Security.Cryptography.ProtectedData]::Unprotect($d, $null, 'CurrentUser'); ` +
          `[System.Text.Encoding]::UTF8.GetString($p)`,
        [b64]
      )
      if (ps) {
        const idx = ps.indexOf('|')
        if (idx > 0) return Buffer.from(ps.slice(idx + 1), 'base64').toString('utf8')
      }
      return null
    }
    return this.readFallback(key)
  }

  private async removeSecure(key: string): Promise<void> {
    if (process.platform === 'win32') this.removeCiphertext(key)
    else this.removeFallback(key)
  }

  private async psInvoke(script: string, args: string[]): Promise<string | null> {
    return new Promise((resolve) => {
      const ps = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script, ...args], { windowsHide: true })
      let out = ''
      ps.stdout.on('data', (d) => (out += String(d)))
      ps.on('error', () => resolve(null))
      ps.on('close', (code) => resolve(code === 0 ? out.trim() : null))
    })
  }

  private persistCiphertext(key: string, b64: string): void {
    const all = this.loadAll()
    all[key] = { b64 }
    this.saveAll(all)
  }

  private readCiphertext(key: string): string | null {
    return this.loadAll()[key]?.b64 ?? null
  }

  private removeCiphertext(key: string): void {
    const all = this.loadAll()
    delete all[key]
    this.saveAll(all)
  }

  private persistFallback(key: string, password: string): void {
    const all = this.loadAll()
    all[key] = { enc: this.obfuscate(password).toString('base64') }
    this.saveAll(all)
  }

  private readFallback(key: string): string | null {
    const rec = this.loadAll()[key]
    if (!rec?.enc) return null
    return this.deobfuscate(Buffer.from(rec.enc, 'base64'))
  }

  private removeFallback(key: string): void {
    const all = this.loadAll()
    delete all[key]
    this.saveAll(all)
  }

  private saveAll(all: Record<string, { b64?: string; enc?: string }>): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const json = JSON.stringify(all)
    fs.writeFileSync(this.file, json, 'utf8')
    this.cached = { json }
  }

  private loadAll(): Record<string, { b64?: string; enc?: string }> {
    try {
      if (this.cached) return JSON.parse(this.cached.json)
      const raw = fs.readFileSync(this.file, 'utf8')
      this.cached = { json: raw }
      return JSON.parse(raw)
    } catch {
      return {}
    }
  }
}
