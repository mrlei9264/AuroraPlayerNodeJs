import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { I } from '../../shared/channels'
import type { NotificationRecord } from '../../shared/types'

const MAX_NOTIFICATION_RECORDS = 500

export class NotificationHistoryStore {
  private records: NotificationRecord[]

  constructor(private readonly filePath: string) {
    this.records = this.read()
  }

  init(): void {
    ipcMain.handle(I.notificationsList, () => [...this.records].reverse())
    ipcMain.handle(I.notificationsAppend, (_event, input: NotificationRecord) => this.append(input))
    ipcMain.handle(I.notificationsRemove, (_event, id: string) => {
      this.records = this.records.filter((record) => record.id !== String(id))
      this.write()
      return true
    })
    ipcMain.handle(I.notificationsClear, () => {
      this.records = []
      this.write()
    })
  }

  private append(input: NotificationRecord): NotificationRecord {
    const record: NotificationRecord = {
      id: String(input.id),
      kind: input.kind === 'success' || input.kind === 'error' ? input.kind : 'info',
      title: input.title ? String(input.title).slice(0, 160) : undefined,
      message: String(input.message).slice(0, 4000),
      createdAt: Number.isFinite(input.createdAt) ? input.createdAt : Date.now()
    }
    this.records = [...this.records, record].slice(-MAX_NOTIFICATION_RECORDS)
    this.write()
    return record
  }

  private read(): NotificationRecord[] {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as unknown
      if (!Array.isArray(parsed)) return []
      return parsed.filter(isNotificationRecord).slice(-MAX_NOTIFICATION_RECORDS)
    } catch {
      return []
    }
  }

  private write(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    fs.writeFileSync(this.filePath, JSON.stringify(this.records, null, 2), 'utf8')
  }
}

function isNotificationRecord(value: unknown): value is NotificationRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<NotificationRecord>
  return typeof record.id === 'string'
    && (record.kind === 'info' || record.kind === 'success' || record.kind === 'error')
    && (record.title == null || typeof record.title === 'string')
    && typeof record.message === 'string'
    && typeof record.createdAt === 'number'
}
