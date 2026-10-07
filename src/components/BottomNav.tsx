import { NavLink, useLocation } from 'react-router'
import { useState } from 'react'
import { motion } from 'motion/react'
import { settleSpring, useReducedMotionPreference } from './motion'

const tabs = [
  { to: '/home', label: '首页', icon: 'nav-home' },
  { to: '/trial', label: '试香', icon: 'nav-capture' },
  { to: '/gallery', label: '香廊', icon: 'nav-gallery-tree' },
  { to: '/me', label: '我的', icon: 'nav-profile' },
]

export function BottomNav() {
  const { pathname } = useLocation()
  const reducedMotion = useReducedMotionPreference()
  const [keyboard, setKeyboard] = useState(false)
  const active = Math.max(0, tabs.findIndex(tab => tab.to === pathname))
  return <nav className="bottom-nav" aria-label="主导航" onKeyDownCapture={() => setKeyboard(true)} onPointerDownCapture={() => setKeyboard(false)}>
    <motion.span className="nav-indicator" aria-hidden="true" initial={false}
      animate={{ x: `${active * 100}%` }} transition={reducedMotion || keyboard ? { duration: 0 } : settleSpring} />
    {tabs.map(({ to, label, icon }) => <NavLink key={to} to={to} className="nav-item">
      <img src={`/assets/icons/${icon}.svg`} width="22" height="22" alt="" />
      <span>{label}</span>
    </NavLink>)}
  </nav>
}
