import { Capacitor, registerPlugin } from '@capacitor/core'

interface NativeExport {
  saveToAlbum(options: { base64: string; extension: string }): Promise<void>
  share(options: { base64: string; extension: string }): Promise<{ completed: boolean }>
  openSettings(): Promise<void>
}
const native = registerPlugin<NativeExport>('ScentLensExport')
export const nativeAlbum = Capacitor.getPlatform() === 'ios'
export function exportError(error: unknown): { message: string; settings: boolean } {
  const code = (error as { code?: string })?.code
  if (code === 'PHOTO_DENIED') return { message: '照片添加权限未开启。请在系统设置中允许添加照片，再返回重试。', settings: true }
  if (code === 'PHOTO_RESTRICTED') return { message: '系统限制了照片添加权限。请检查屏幕使用时间或设备管理设置。', settings: false }
  return { message: error instanceof Error ? error.message : '导出未完成，请重试。本机作品仍保留。', settings: false }
}
async function payload(blob: Blob) {
  const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as Record<string, string>)[blob.type]
  if (!extension || blob.size === 0 || blob.size > 25 * 1024 * 1024) throw new Error('不支持这张图片的格式或大小。')
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('图片读取失败，请重试。')); reader.readAsDataURL(blob)
  })
  return { base64, extension }
}
export async function saveToAlbum(blob: Blob) {
  if (!nativeAlbum) throw new Error('请在 iPhone App 中保存到系统相册。')
  await native.saveToAlbum(await payload(blob))
}
export function openPhotoSettings() { return native.openSettings() }
export function canShareCard(blob?: Blob) {
  return nativeAlbum || !!blob && !!navigator.share && !!navigator.canShare?.({ files: [new File([blob], 'ScentLens.png', { type: 'image/png' })] })
}
export async function shareCard(blob: Blob): Promise<'completed' | 'cancelled' | 'downloaded'> {
  if (nativeAlbum) return (await native.share(await payload(blob))).completed ? 'completed' : 'cancelled'
  const file = new File([blob], 'ScentLens.png', { type: 'image/png' })
  if (canShareCard(blob) && navigator.share) {
    try { await navigator.share({ files: [file] }); return 'completed' }
    catch (error) { if ((error as { name?: string }).name === 'AbortError') return 'cancelled'; throw error }
  }
  const url = URL.createObjectURL(blob), anchor = document.createElement('a')
  anchor.href = url; anchor.download = file.name; anchor.click()
  // Browser downloads are async; do not revoke while the consumer opens the URL.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return 'downloaded'
}
