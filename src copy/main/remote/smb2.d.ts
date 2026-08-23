declare module 'smb2' {
  interface SMB2Options {
    share: string
    domain?: string
    username?: string
    password?: string
  }
  interface SMB2Entry {
    filename?: string
    name?: string
    attributes?: number
    size?: number
    mtimeMs?: number
  }
  class SMB2 {
    constructor(options: SMB2Options)
    list(dir: string, cb: (err: Error | null, files: SMB2Entry[]) => void): void
    readFile(file: string, opts: { start?: number; end?: number }, cb: (err: Error | null, data: Buffer) => void): void
    readFile(file: string, cb: (err: Error | null, data: Buffer) => void): void
    close(): void
  }
  export = SMB2
  
}

