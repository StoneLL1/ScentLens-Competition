import type { ImageAsset } from '../domain/artwork'
import { StorageFailure } from '../domain/artwork'
import type { FileStore } from './FileStore'

export async function digest(bytes: Uint8Array) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))].map(n => n.toString(16).padStart(2, '0')).join('')
}
export type ImageProbe = (blob: Blob) => Promise<{ width: number; height: number }>
export const decodeImage: ImageProbe = async blob => {
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return { width: image.naturalWidth, height: image.naturalHeight }
  } finally { URL.revokeObjectURL(url) }
}
function imageMime(bytes: Uint8Array): ImageAsset['mimeType'] {
  if ([137,80,78,71,13,10,26,10].every((n, i) => bytes[i] === n)) return 'image/png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (new TextDecoder().decode(bytes.slice(0,4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8,12)) === 'WEBP') return 'image/webp'
  throw new Error('作品格式无效')
}
export class ImageStore {
  constructor(readonly files: FileStore, private probe: ImageProbe = decodeImage) {}
  async save(id: string, blob: Blob, origin: ImageAsset['origin']): Promise<ImageAsset> {
    try {
      if (!blob.size || blob.size > 25 * 1024 * 1024) throw new Error('作品大小不支持')
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const mimeType = imageMime(bytes)
      const dimensions = await this.probe(new Blob([bytes], { type: mimeType }))
      if (!dimensions.width || dimensions.width !== dimensions.height || dimensions.width > 8192) throw new Error('需要可解码的方形作品')
      const asset: ImageAsset = { id, storageKind: 'data', relativePath: `${id}.${mimeType === 'image/png' ? 'png' : mimeType === 'image/jpeg' ? 'jpg' : 'webp'}`, mimeType, ...dimensions, byteSize: bytes.length, sha256: await digest(bytes), origin, createdAt: new Date().toISOString() }
      await this.files.write('originals', asset.relativePath, bytes)
      await this.read(asset)
      return asset
    } catch { throw new StorageFailure('file', '图片尚未保存。请检查可用空间后重试保存，八维和文字仍保留。') }
  }
  async read(asset: ImageAsset) {
    const bytes = await this.files.read('originals', asset.relativePath)
    if (bytes.length !== asset.byteSize || await digest(bytes) !== asset.sha256 || imageMime(bytes) !== asset.mimeType) throw new Error('作品文件校验失败')
    const blob = new Blob([new Uint8Array(bytes)], { type: asset.mimeType })
    const { width, height } = await this.probe(blob)
    if (width !== asset.width || height !== asset.height) throw new Error('作品尺寸校验失败')
    return blob
  }
  async clearCache() { for (const path of await this.files.list('cache')) await this.files.remove('cache', path) }
}
