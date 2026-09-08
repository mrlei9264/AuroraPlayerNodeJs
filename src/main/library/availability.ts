import fs from 'fs'
import { net } from 'electron'
import type { MediaItem } from '../../shared/types'
import type { RemoteSourceManager } from '../remote/manager'

// Protocol clients (notably FTP) do not accept overlapping commands.
const sourceChecks = new Map<number, Promise<unknown>>()

async function remoteFileAvailable(item: MediaItem, remote: RemoteSourceManager): Promise<boolean> {
  const sourceId = item.sourceId!
  const previous = sourceChecks.get(sourceId) ?? Promise.resolve()
  const task = previous.catch(() => undefined).then(async () => {
    if (!remote.sourceAvailable(sourceId) || !item.remotePath) return false
    const stats = await remote.statIsolated(sourceId, item.remotePath)
    return stats != null && stats.size > 0
  })
  sourceChecks.set(sourceId, task)
  try { return await task }
  finally { if (sourceChecks.get(sourceId) === task) sourceChecks.delete(sourceId) }
}

/** Check the file itself; a saved source record is not proof that it is readable. */
export async function mediaAvailable(item: MediaItem, remote: RemoteSourceManager): Promise<boolean> {
  try {
    if (item.protocol === 'local') {
      const stats = await fs.promises.stat(item.url)
      if (!stats.isFile() || stats.size === 0) return false
      const file = await fs.promises.open(item.url, 'r')
      try {
        const sample = Buffer.alloc(1)
        return (await file.read(sample, 0, 1, 0)).bytesRead === 1
      } finally { await file.close() }
    }
    if (item.sourceId != null) {
      return await remoteFileAvailable(item, remote)
    }
    if (!/^https?:\/\//i.test(item.url)) return false
    const signal = AbortSignal.timeout(8000)
    let response = await net.fetch(item.url, { method: 'HEAD', signal })
    if (response.status === 403 || response.status === 405 || response.status === 501) {
      await response.body?.cancel()
      response = await net.fetch(item.url, { headers: { Range: 'bytes=0-0' }, signal })
    }
    const available = response.ok && response.headers.get('content-length') !== '0'
    // A server may ignore Range. Never retain its media body for a status check.
    await response.body?.cancel()
    return available
  } catch {
    return false
  }
}
