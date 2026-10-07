import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { NativeFileStore } from '../../src/data/FileStore'

vi.mock('@capacitor/filesystem', async importOriginal => ({
  ...await importOriginal<typeof import('@capacitor/filesystem')>(),
  Filesystem: { writeFile: vi.fn(), readFile: vi.fn(), mkdir: vi.fn(), readdir: vi.fn(), deleteFile: vi.fn() },
}))
beforeEach(() => vi.resetAllMocks())

describe('native file bridge contract (not an iPhone filesystem test)', () => {
  it('round-trips all byte values across the base64 chunk boundary without text encoding', async () => {
    const files = new NativeFileStore(), bytes = Uint8Array.from({ length: 25_000 }, (_, i) => i % 256)
    await files.write('originals', 'original.png', bytes)
    const call = vi.mocked(Filesystem.writeFile).mock.calls[0][0]
    expect(call).toMatchObject({ directory: Directory.Data, path: 'scentlens/originals/original.png', recursive: true })
    expect(call.encoding).toBeUndefined()
    vi.mocked(Filesystem.readFile).mockResolvedValue({ data: call.data })
    expect(await files.read('originals', 'original.png')).toEqual(bytes)
  })
  it('keeps protection in persistent Data and only rebuildable files in Cache', async () => {
    const files = new NativeFileStore()
    await files.write('protection', 'snapshot-1.json', new TextEncoder().encode('中文保护快照'))
    await files.write('cache', 'thumbnail.png', new Uint8Array([1]))
    expect(vi.mocked(Filesystem.writeFile).mock.calls.map(([c]) => [c.directory, c.path])).toEqual([
      [Directory.Data, 'scentlens/protection/snapshot-1.json'], [Directory.Cache, 'scentlens/cache/thumbnail.png'],
    ])
  })
  it('allows an existing directory, but propagates real I/O failures instead of inventing an empty library', async () => {
    const files = new NativeFileStore()
    vi.mocked(Filesystem.mkdir).mockRejectedValueOnce({ code: 'OS-PLUG-FILE-0010' })
    vi.mocked(Filesystem.readdir).mockResolvedValue({ files: [{ name: 'snapshot-1.json' }] } as Awaited<ReturnType<typeof Filesystem.readdir>>)
    expect(await files.list('protection')).toEqual(['snapshot-1.json'])
    const failure = { code: 'OS-PLUG-FILE-0013' }
    vi.mocked(Filesystem.mkdir).mockRejectedValueOnce(failure)
    await expect(files.list('protection')).rejects.toBe(failure)
    expect(Filesystem.readdir).toHaveBeenCalledTimes(1)
  })
  it.each(['../outside.png', '/absolute.png', 'folder/nested.png'])('rejects %s before any native read/write/delete', async path => {
    const files = new NativeFileStore()
    await expect(files.read('originals', path)).rejects.toThrow('非法')
    await expect(files.write('originals', path, new Uint8Array())).rejects.toThrow('非法')
    await expect(files.remove('originals', path)).rejects.toThrow('非法')
    expect(Filesystem.readFile).not.toHaveBeenCalled(); expect(Filesystem.writeFile).not.toHaveBeenCalled(); expect(Filesystem.deleteFile).not.toHaveBeenCalled()
  })
})
