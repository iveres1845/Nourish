'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const LEFT_NAV  = [
  { href: '/dashboard', label: 'Home',    icon: HomeIcon },
  { href: '/insights',  label: 'Insights', icon: SparkleIcon },
]
const RIGHT_NAV = [
  { href: '/profile',   label: 'Profile',  icon: PersonIcon },
]

export default function BottomNav() {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] z-50">
      {/* Blur background */}
      <div className="absolute inset-0 bg-white/90 backdrop-blur-md border-t border-gray-100/80" />

      <div className="relative flex items-end justify-around px-2 pb-safe h-[68px]">

        {/* Left items */}
        {LEFT_NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href
          return (
            <NavItem key={href} href={href} label={label} active={active}>
              <Icon active={active} />
            </NavItem>
          )
        })}

        {/* Centre FAB — Log */}
        <div className="flex flex-col items-center -mt-5 pb-1">
          <Link href="/log" className="group">
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg shadow-sage-300/40 transition-all duration-200 active:scale-95 ${
              pathname === '/log'
                ? 'bg-sage-700'
                : 'bg-sage-600 group-hover:bg-sage-700'
            }`}>
              <CameraIcon active={pathname === '/log'} />
            </div>
            <span className={`block text-center text-[10px] font-medium mt-1 ${pathname === '/log' ? 'text-sage-700' : 'text-gray-400'}`}>
              Log
            </span>
          </Link>
        </div>

        {/* Right items */}
        {RIGHT_NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href
          return (
            <NavItem key={href} href={href} label={label} active={active}>
              <Icon active={active} />
            </NavItem>
          )
        })}

      </div>
    </nav>
  )
}

function NavItem({ href, label, active, children }: { href: string; label: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className="flex flex-col items-center gap-1 px-5 py-2 transition-all duration-150 active:scale-95">
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

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z" />
      <path d="M9 21V12h6v9" />
    </svg>
  )
}

function CameraIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  )
}

function SparkleIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" />
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
