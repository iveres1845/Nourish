'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function BottomNav() {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] z-50">
      <div className="absolute inset-0 bg-white/95 backdrop-blur-md border-t border-gray-100/80" />

      <div className="relative flex items-end justify-around px-1 pb-safe h-[68px]">

        {/* Nest */}
        <NavItem href="/dashboard" label="Nest" active={pathname === '/dashboard'}>
          <NestIcon active={pathname === '/dashboard'} />
        </NavItem>

        {/* Notice */}
        <NavItem href="/notice" label="Notice" active={pathname === '/notice'}>
          <NoticeIcon active={pathname === '/notice'} />
        </NavItem>

        {/* Nourish FAB */}
        <div className="flex flex-col items-center -mt-5 pb-1">
          <Link href="/log" className="group flex flex-col items-center">
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg shadow-sage-300/40 transition-all duration-200 active:scale-95 ${
              pathname === '/log' ? 'bg-sage-700' : 'bg-sage-600 group-hover:bg-sage-700'
            }`}>
              <CameraIcon />
            </div>
            <span className={`text-[10px] font-medium mt-1 ${pathname === '/log' ? 'text-sage-700' : 'text-gray-400'}`}>
              Nourish
            </span>
          </Link>
        </div>

        {/* Nudge */}
        <NavItem href="/insights" label="Nudge" active={pathname === '/insights'}>
          <NudgeIcon active={pathname === '/insights'} />
        </NavItem>

        {/* Profile */}
        <NavItem href="/profile" label="Profile" active={pathname === '/profile'}>
          <PersonIcon active={pathname === '/profile'} />
        </NavItem>

      </div>
    </nav>
  )
}

function NavItem({ href, label, active, children }: { href: string; label: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className="flex flex-col items-center gap-0.5 px-3 py-2 transition-all active:scale-95">
      <span className={`transition-colors duration-150 ${active ? 'text-sage-700' : 'text-gray-400'}`}>
        {children}
      </span>
      <span className={`text-[10px] font-medium transition-colors duration-150 ${active ? 'text-sage-700' : 'text-gray-400'}`}>
        {label}
      </span>
      {active && <span className="w-1 h-1 rounded-full bg-sage-500 -mt-0.5" />}
    </Link>
  )
}

function NestIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z" />
      <path d="M9 21V12h6v9" />
    </svg>
  )
}

function NoticeIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22c1.1 0 2-.9 2-2H10c0 1.1.9 2 2 2z"/>
      <path d="M18.7 16.3A7.9 7.9 0 0020 12a8 8 0 10-16 0c0 1.6.5 3.1 1.3 4.3"/>
      <path d="M12 6v6"/>
      <path d="M12 15h.01"/>
    </svg>
  )
}

function CameraIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  )
}

function NudgeIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8h1a4 4 0 010 8h-1"/>
      <path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"/>
      <line x1="6" y1="1" x2="6" y2="4"/>
      <line x1="10" y1="1" x2="10" y2="4"/>
      <line x1="14" y1="1" x2="14" y2="4"/>
    </svg>
  )
}

function PersonIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}
