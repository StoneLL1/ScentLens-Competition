import type { RecordRepository } from '../../data/RecordRepository'
import type { Reading } from '../../domain/reading'
import { localScentLabels } from '../../domain/fallback'
import { fallbackAssets } from '../../assets/fallbacks'

export interface ExportSelection { reading: Reading; generationId?: string; preset?: keyof typeof fallbackAssets }
export interface ExportSnapshot {
  readingId: string
  generationId?: string
  blob: Blob
  title: string
  keywords: string[]
  date: string
  source: string
}

// The caller freezes the visible selection on click, including fallback text.
// Never resolve an unspecified generation to a newer selectedGenerationId.
export async function captureExport(repository: RecordRepository, selection: ExportSelection): Promise<ExportSnapshot> {
  const { reading, generationId, preset } = selection
  if (!await repository.get(reading.id)) throw new Error('这条记录已删除，请返回历史。')
  let blob: Blob, title: string, keywords: string[], imageSource: string
  if (generationId) {
    const artwork = await repository.artwork(reading.id, generationId)
    if (!artwork?.blob) throw new Error('这张作品已不可用，请重新选择可查看的版本。')
    blob = artwork.blob
    title = artwork.generation.textSnapshot.title
    keywords = [...artwork.generation.textSnapshot.keywords]
    imageSource = artwork.generation.imageOrigin === 'cloud' ? '气味视觉作品' : '固定测试作品'
  } else if (preset && reading.fallbackPresentation?.resourceKey === preset) {
    const response = await fetch(fallbackAssets[preset])
    if (!response.ok) throw new Error('预置图片读取失败，请重试。')
    blob = await response.blob()
    // The neutral source is a bundled SVG, which PhotoKit cannot import.
    // Rasterize only that vector preset; successful artwork bytes stay untouched.
    if (blob.type === 'image/svg+xml') {
      const url = URL.createObjectURL(blob), image = new Image()
      try {
        image.src = url; await image.decode()
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024
        const context = canvas.getContext('2d')
        if (!context) throw new Error('预置图片准备失败，请重试。')
        context.drawImage(image, 0, 0, 1024, 1024)
        blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('预置图片准备失败，请重试。')), 'image/png'))
      } finally { URL.revokeObjectURL(url) }
    }
    const text = reading.interpretation ?? reading.developmentText
    title = text?.title ?? '气味印象 · 图片待生成'
    keywords = text?.keywords ?? localScentLabels(reading.scores100)
    imageSource = '预置配图'
  } else throw new Error('作品尚不可用，暂时无法导出。')
  if (!blob.size || !blob.type.startsWith('image/')) throw new Error('图片读取失败，请重试。')
  const inputSource = reading.source === 'demo' ? 'Demo 样本' : reading.source === 'mock' ? '开发模拟' : 'Pocket 读取'
  return { readingId: reading.id, generationId, blob, title, keywords, date: new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(reading.capturedAt)), source: `${inputSource} · ${imageSource}` }
}
