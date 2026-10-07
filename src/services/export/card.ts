import type { ExportSnapshot } from './snapshot'

export const CARD_SIZE = 1600
const FONT = '"Noto Sans SC Variable"'

// Wrap by grapheme, including unbroken Latin and emoji; ellipsis is measured too.
export function wrapText(text: string, width: number, maxLines: number, measure: (text: string) => number): string[] {
  const chars = Array.from(new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(text.replace(/\s+/g, ' ').trim()), part => part.segment)
  const lines: string[] = []
  let line = ''
  for (let i = 0; i < chars.length; i++) {
    if (line && measure(line + chars[i]) > width) {
      if (lines.length === maxLines - 1) {
        while (line && measure(line + '…') > width) line = Array.from(line).slice(0, -1).join('')
        lines.push(line + '…'); return lines
      }
      lines.push(line); line = ''
    }
    line += chars[i]
  }
  if (line) lines.push(line)
  return lines
}

async function readyWithin<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('图片或字体准备超时，请重试。')), 15_000) })]) }
  finally { clearTimeout(timer) }
}

export async function renderShareCard(snapshot: ExportSnapshot, size = CARD_SIZE): Promise<Blob> {
  const copy = `闻见 ScentLens ${snapshot.title} ${snapshot.keywords.join(' / ')} ${snapshot.source} ${snapshot.date}`
  // Loading by actual text also loads the correct Chinese unicode-range subsets.
  const faces = await readyWithin(Promise.all([document.fonts.load(`500 28px ${FONT}`, copy), document.fonts.load(`700 56px ${FONT}`, copy)]))
  await readyWithin(document.fonts.ready)
  if (faces.some(result => !result.length)) throw new Error('分享字体尚未就绪，请稍后重试。')
  const url = URL.createObjectURL(snapshot.blob), image = new Image()
  try {
    image.src = url; await readyWithin(image.decode())
    if (!image.naturalWidth || image.naturalWidth !== image.naturalHeight) throw new Error('作品尺寸无效，无法合成。')
    const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size
    const c = canvas.getContext('2d')
    if (!c) throw new Error('无法准备分享卡，请重试。')
    c.scale(size / 1600, size / 1600)
    c.fillStyle = '#F6F4EE'; c.fillRect(0, 0, 1600, 1600)
    // Quiet gallery mat; the whole square artwork remains visible without cropping.
    c.fillStyle = '#FFFFFF'; c.fillRect(68, 68, 1200, 1200)
    c.drawImage(image, 92, 92, 1152, 1152)
    c.fillStyle = '#5738E0'
    for (const [i, height] of [35, 49, 60, 49, 35].entries()) {
      c.beginPath(); c.roundRect(1334 + i * 22, 88 + (60 - height) / 2, 12, height, 6); c.fill()
    }
    c.fillStyle = '#231C2F'; c.font = `700 46px ${FONT}`; c.fillText('闻见', 1329, 235)
    c.font = `500 28px ${FONT}`; c.fillText('ScentLens', 1329, 284)
    c.save(); c.translate(1390, 1208); c.rotate(-Math.PI / 2)
    c.fillStyle = '#615967'; c.font = `500 28px ${FONT}`; c.fillText(snapshot.date, 0, 0); c.restore()
    c.fillStyle = '#231C2F'
    let titleSize = 56
    c.font = `700 ${titleSize}px ${FONT}`
    // Short titles stay expressive; longer titles keep two legible lines.
    if (c.measureText(snapshot.title).width > 1440 * 2) { titleSize = 44; c.font = `700 ${titleSize}px ${FONT}` }
    const measured = c.measureText(snapshot.title).width
    const titleWidth = measured > 1440 ? Math.min(1440, Math.ceil(measured / 2) + titleSize) : 1440
    const titleLines = wrapText(snapshot.title, titleWidth, 2, text => c.measureText(text).width)
    titleLines.forEach((line, index) => c.fillText(line, 80, 1344 + index * 66))
    c.fillStyle = '#615967'; c.font = `500 30px ${FONT}`
    const keywords = wrapText(snapshot.keywords.join(' / '), 1440, 1, text => c.measureText(text).width)
    c.fillText(keywords[0] ?? '', 80, 1472)
    c.fillStyle = '#CBC6D0'; c.fillRect(80, 1506, 1440, 1)
    c.fillStyle = '#615967'; c.font = `500 28px ${FONT}`; c.fillText(snapshot.source, 80, 1560)
    c.textAlign = 'right'; c.fillText('让气味被看见', 1520, 1560)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('分享卡生成失败，请重试。')), 'image/png'))
  } finally { URL.revokeObjectURL(url) }
}
