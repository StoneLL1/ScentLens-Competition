import Dexie, { type Table } from 'dexie'
import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'

export type FileArea = 'originals' | 'protection' | 'cache'
export interface FileStore {
  read(area: FileArea, path: string): Promise<Uint8Array>
  write(area: FileArea, path: string, data: Uint8Array): Promise<void>
  remove(area: FileArea, path: string): Promise<void>
  list(area: FileArea): Promise<string[]>
}
export function validFileName(path: string) { return /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,180}$/.test(path) }
function check(path: string) { if (!validFileName(path)) throw new Error('非法相对文件路径') }

// Separate from the metadata DB so browser tests can exercise metadata loss.
// Browser eviction can remove BOTH databases; only native files protect against it.
export class BrowserFileStore implements FileStore {
  readonly db: Dexie
  private files: Table<{ key: string; data: Uint8Array }, string>
  constructor(name = 'scentlens-files') {
    this.db = new Dexie(name)
    this.db.version(1).stores({ files: 'key' })
    this.files = this.db.table('files')
  }
  async read(area: FileArea, path: string) {
    check(path)
    const file = await this.files.get(`${area}/${path}`)
    if (!file) throw new Error('文件不存在')
    return file.data
  }
  async write(area: FileArea, path: string, data: Uint8Array) { check(path); await this.files.put({ key: `${area}/${path}`, data }) }
  async remove(area: FileArea, path: string) { check(path); await this.files.delete(`${area}/${path}`) }
  async list(area: FileArea) { return (await this.files.where('key').startsWith(`${area}/`).primaryKeys()).map(key => key.slice(area.length + 1)) }
}

export class NativeFileStore implements FileStore {
  private directory(area: FileArea) { return area === 'cache' ? Directory.Cache : Directory.Data }
  private path(area: FileArea, path: string) { check(path); return `scentlens/${area}/${path}` }
  async write(area: FileArea, path: string, data: Uint8Array) {
    let binary = ''
    for (let i = 0; i < data.length; i += 8192) binary += String.fromCharCode(...data.subarray(i, i + 8192))
    await Filesystem.writeFile({ directory: this.directory(area), path: this.path(area, path), data: btoa(binary), recursive: true })
  }
  async read(area: FileArea, path: string) {
    const result = await Filesystem.readFile({ directory: this.directory(area), path: this.path(area, path) })
    if (typeof result.data !== 'string') return new Uint8Array(await result.data.arrayBuffer())
    return Uint8Array.from(atob(result.data), char => char.charCodeAt(0))
  }
  async remove(area: FileArea, path: string) {
    await Filesystem.deleteFile({ directory: this.directory(area), path: this.path(area, path) })
  }
  async list(area: FileArea) {
    const directory = this.directory(area), path = `scentlens/${area}`
    // Do not treat permission/I/O errors as an empty directory.
    try { await Filesystem.mkdir({ directory, path, recursive: true }) }
    catch (error) { if ((error as { code?: string }).code !== 'OS-PLUG-FILE-0010') throw error }
    return (await Filesystem.readdir({ directory, path })).files.map(file => file.name)
  }
}
export function platformFileStore(name = 'scentlens') {
  return Capacitor.isNativePlatform() ? new NativeFileStore() : new BrowserFileStore(`${name}-files`)
}
