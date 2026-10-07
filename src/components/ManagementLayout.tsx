import type { ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { libraryReturnEntry, libraryReturnState } from '../app/libraryNavigation'

export function ManagementLayout({ title, fallback = '/me', children }: { title: string; fallback?: string; children: ReactNode }) {
  const location = useLocation(), navigate = useNavigate()
  return <main className="screen management-screen" id="main-content">
    <header className="management-header"><button className="icon-button" aria-label="返回" onClick={() => libraryReturnEntry(location.state) ? navigate(-1) : navigate(fallback)}><svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m11.5 4-6 6 6 6M6 10h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></button><h1 tabIndex={-1}>{title}</h1></header>
    <div className="management-content">{children}</div>
  </main>
}
export function ManagementLink({ to, title, detail }: { to: string; title: string; detail?: string }) {
  const navigate = useNavigate()
  return <Link className="management-row" to={to} onClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigate(to, { state: libraryReturnState() }) } }}><span><strong>{title}</strong>{detail && <small>{detail}</small>}</span><svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m8 5 5 5-5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg></Link>
}
