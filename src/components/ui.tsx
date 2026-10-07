import { usePocket, pocketLabel } from '../app/pocketHooks'
import type { PropsWithChildren } from 'react'
import { Link, type LinkProps } from 'react-router'

export function ButtonLink({ className = '', ...props }: LinkProps) {
  return <Link {...props} className={`button ${className}`} />
}

export function GlassSurface({ children, className = '' }: PropsWithChildren<{ className?: string }>) {
  return <section className={`glass-surface ${className}`}>{children}</section>
}

export function BackLink({ to = '/home' }: { to?: string }) {
  return <Link className="icon-button" to={to} aria-label="返回首页">
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="m11.5 4-6 6 6 6M6 10h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </Link>
}

export function PocketStatus() {
  const state = usePocket(), label = pocketLabel(state)
  return <Link to="/device" className="pocket-status" aria-label={`Pocket ${label}，查看设备`}>
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="5" y="2.5" width="10" height="15" rx="4" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="10" cy="7.5" r="2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M9 14h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
    <span>{label}</span>
  </Link>
}
