import { useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { useLibrary } from '../app/libraryHooks'
import { historyPosition, libraryReturnEntry } from '../app/libraryNavigation'
import { historyEntries } from '../domain/library'
import { ReadingList } from '../components/ReadingList'

export function HistoryPage() {
  const { data, error, retry } = useLibrary(), [search, setSearch] = useState(historyPosition.search), [limit, setLimit] = useState(historyPosition.limit)
  const restored = useRef(false), location = useLocation(), navigate = useNavigate()
  const readings = data ? historyEntries(data, search) : []
  useLayoutEffect(() => { if (data && !restored.current) { restored.current = true; window.scrollTo(0, historyPosition.scroll) } }, [data])
  return <main className="screen library-screen" id="main-content"><header className="library-header"><button className="text-action" onClick={() => libraryReturnEntry(location.state) ? navigate(-1) : navigate('/home')}>返回</button><h1 tabIndex={-1}>识别记录</h1></header>
    <div className="library-content"><label className="library-search">搜索香水名称<input type="search" enterKeyHint="search" value={search} placeholder="香水名称或未命名气味" onChange={event => { setSearch(event.target.value); historyPosition.search = event.target.value; historyPosition.scroll = 0; historyPosition.limit = 40; setLimit(40) }} /></label>
      {error ? <button className="button" onClick={retry}>读取失败，重试</button> : !data ? <p role="status">正在读取历史…</p> : readings.length ? <><p className="library-hint">{readings.length} 次识别 · 按识别时间排列</p><ReadingList readings={readings.slice(0, limit)} perfumes={data.perfumes} leaving={() => { historyPosition.scroll = window.scrollY }} />{readings.length > limit && <button className="text-action" onClick={() => { historyPosition.limit = limit + 40; setLimit(limit + 40) }}>显示更多记录</button>}</> : <section className="library-empty"><h2>{search ? '没有找到这款香气' : '还没有识别记录'}</h2><p>{search ? '试试其他名称，或搜索“未命名气味”。' : '完整八维保存后，就会在这里留下记录。'}</p>{search ? <button className="text-action" onClick={() => { setSearch(''); historyPosition.search = '' }}>清除搜索</button> : <Link className="button" to="/trial">开始试香</Link>}</section>}
    </div></main>
}
