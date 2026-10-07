import type { CSSProperties } from 'react'

const sizes = {
  large: { size: 342, inset: 23, window: 292, exportSize: 362, file: 'artwork-frame-result.svg' },
  compact: { size: 226, inset: 24, window: 178, exportSize: 246, file: 'artwork-frame-analysis.svg' },
  gallery: { size: 242, inset: 22.8919, window: 196.2162, exportSize: 242, file: '' },
} as const

// The three geometries are distinct; image content remains separate from its frame.
export function ArtworkFrame({ variant, src, alt }: { variant: keyof typeof sizes; src?: string; alt: string }) {
  const frame = sizes[variant]
  const style = {
    '--frame-size': `${frame.size}px`,
    '--frame-inset': `${frame.inset / frame.size * 100}%`,
    '--frame-window': `${frame.window / frame.size * 100}%`,
    '--frame-export': `${frame.exportSize / frame.size * 100}%`,
    '--frame-left': `${-10 / frame.size * 100}%`,
    '--frame-top': `${-2 / frame.size * 100}%`,
  } as CSSProperties
  return <div className={`artwork-frame artwork-frame--${variant}`} style={style}>
    <div className="artwork-window">
      {src ? <img src={src} alt={alt} /> : <span role="img" aria-label={alt} />}
    </div>
    {variant !== 'gallery' ? <img className="artwork-border" src={`/assets/frames/${frame.file}`} alt="" /> :
      <div className="gallery-frame-parts" aria-hidden="true">
        {['top', 'bottom', 'left', 'right', 'trim', 'gold'].map(part =>
          <img key={part} className={`gallery-frame-${part}`} src={`/assets/frames/gallery-frame-${part}.svg`} alt="" />)}
      </div>}
  </div>
}
