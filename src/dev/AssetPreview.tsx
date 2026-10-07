import { ArtworkFrame } from '../components/ArtworkFrame'
import { fallbackAssets } from '../assets/fallbacks'

// Development fixture, tree-shaken from production. No sample business records.
export function AssetPreview() {
  return <main style={{ padding: 30, background: '#f6f4ee' }}>
    <h1>本地素材验收 · 开发样例</h1>
    {(['large', 'compact', 'gallery'] as const).map(variant => <section key={variant} style={{ marginBlock: 32 }}>
      <h2>{variant}</h2><ArtworkFrame variant={variant} src={fallbackAssets.lemon} alt="本地柠檬预置图，非本次生成" />
    </section>)}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
      {Object.entries(fallbackAssets).map(([name, src]) => <figure key={name}><img src={src} alt={name} /><figcaption>{name} · 本地预置</figcaption></figure>)}
    </div>
  </main>
}
