import { useNavigate } from 'react-router'
import { useArtwork } from '../app/readingHooks'
import { libraryReturnState } from '../app/libraryNavigation'
import type { Perfume } from '../domain/artwork'
import { readingTime, type Reading } from '../domain/reading'
import { fallbackAssets } from '../assets/fallbacks'
import { InterfaceIcon } from './InterfaceIcon'

function ReadingRow({ reading, perfume, leaving }: { reading: Reading; perfume?: Perfume; leaving?: () => void }) {
  const art = useArtwork(reading), navigate = useNavigate()
  const src = art.url ?? (!reading.selectedGenerationId && reading.fallbackPresentation ? fallbackAssets[reading.fallbackPresentation.resourceKey] : undefined)
  const text = art.generation?.textSnapshot ?? reading.interpretation ?? reading.developmentText
  return <li><button className="reading-list-row" onClick={() => { leaving?.(); navigate(`/result/${reading.id}`, { state: libraryReturnState() }) }}>
    <span className="reading-thumbnail">{src ? <img src={src} alt="" loading="lazy" /> : <span>八维<br />已保存</span>}</span>
    <span className="reading-list-copy"><strong>{perfume?.name ?? '未命名气味'}</strong><span>{text?.title ?? '作品待生成'}</span><small>{readingTime(reading)} · {perfume ? '已收藏' : '未收藏'}{reading.source !== 'device' ? reading.source === 'mock' ? ' · 开发模拟' : ' · Demo' : ''}</small></span><InterfaceIcon className="row-chevron" name="next" width="16" height="16" />
  </button></li>
}
export function ReadingList({ readings, perfumes, leaving }: { readings: Reading[]; perfumes: Perfume[]; leaving?: () => void }) {
  return <ul className="reading-list">{readings.map(reading => <ReadingRow key={reading.id} reading={reading} perfume={perfumes.find(p => p.id === reading.perfumeId)} leaving={leaving} />)}</ul>
}
