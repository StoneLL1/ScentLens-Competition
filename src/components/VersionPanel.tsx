import { useEffect, useRef, useState } from 'react'
import { repository } from '../app/runtime'
import { useArtwork } from '../app/readingHooks'
import { useLibrary } from '../app/libraryHooks'
import type { Generation } from '../domain/artwork'
import type { Reading } from '../domain/reading'
import { LibraryDialog } from './LibraryDialogs'

function VersionRow({ generation, reading, coverId, busy, action }: { generation: Generation; reading: Reading; coverId?: string; busy: boolean; action: (kind: 'main' | 'cover' | 'delete', generation: Generation) => void }) {
  const art = useArtwork(reading, generation.id)
  return <li className="version-row"><div className="version-summary">{art.url && <img src={art.url} alt={generation.textSnapshot.title} />}<div><h3>版本 {generation.version} · {generation.textSnapshot.title}</h3><p>{generation.id === reading.selectedGenerationId ? '本次主图' : '可选作品'}{generation.id === coverId ? ' · 档案封面' : ''}</p></div></div>
    <div className="version-actions"><button disabled={busy || !art.url || reading.selectedGenerationId === generation.id} onClick={() => action('main', generation)}>设为本次主图</button>{reading.perfumeId && <button disabled={busy || !art.url || coverId === generation.id} onClick={() => action('cover', generation)}>设为档案封面</button>}<button className="danger-action" disabled={busy} onClick={() => action('delete', generation)}>删除版本</button></div>
  </li>
}
export function VersionPanel({ reading, close, selected }: { reading: Reading; close: () => void; selected: () => void }) {
  const { data } = useLibrary(), [versions, setVersions] = useState<Generation[]>(), [error, setError] = useState(''), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0)
  const lock = useRef(false)
  const perfume = data?.perfumes.find(p => p.id === reading.perfumeId)
  useEffect(() => {
    let disposed = false
    void repository.availableVersions(reading.id).then(items => { if (!disposed) setVersions(items) }).catch(() => { if (!disposed) setError('版本暂时无法读取，请重试。') })
    return () => { disposed = true }
  }, [reading.id, data, revision])
  async function act(kind: 'main' | 'cover' | 'delete', generation: Generation) {
    if (lock.current) return
    if (kind === 'delete') {
      const impacts = [generation.id === reading.selectedGenerationId && '本次主图', generation.id === perfume?.coverGenerationId && '档案封面'].filter(Boolean).join('和')
      if (!window.confirm(`删除版本 ${generation.version}「${generation.textSnapshot.title}」？${impacts ? `${impacts}将变为空白，其他版本需手动选择。` : '其他作品与八维将保留。'}此操作无法撤销。`)) return
    }
    lock.current = true; setBusy(true); setError('')
    try {
      if (kind === 'main') { await repository.selectMain(reading.id, generation.id); selected() }
      if (kind === 'cover' && reading.perfumeId) await repository.selectCover(reading.perfumeId, generation.id)
      if (kind === 'delete') await repository.deleteGeneration(generation.id)
      setRevision(n => n + 1)
    } catch (e) { setError(e instanceof Error ? e.message : '操作未完成，请重试。') }
    finally { lock.current = false; setBusy(false) }
  }
  return <LibraryDialog title="图像版本" close={close} busy={busy}>
    <p className="library-hint">本次主图用于识别结果；档案封面独立保留在香廊。切换作品时，文字也会一起切换。</p>
    {error && <p role="alert" className="library-error">{error}<button className="text-action" onClick={() => { setError(''); setRevision(n => n + 1) }}>重试读取</button></p>}
    {!versions ? <p role="status">正在读取本地作品…</p> : versions.length ? <ul className="version-list">{versions.map(g => <VersionRow key={g.id} generation={g} reading={reading} coverId={perfume?.coverGenerationId} busy={busy} action={(kind, generation) => void act(kind, generation)} />)}</ul> : <p className="library-empty-copy">还没有可用的云端作品版本。预置展示与固定测试作品不计入版本。</p>}
  </LibraryDialog>
}
