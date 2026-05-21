import { useEffect, useRef, useState } from 'react'
import {
  CircleUser,
  Shield,
  LogOut,
  KeyRound,
  UserPlus,
  ChevronDown,
  Bell,
  Sun,
  Moon
} from 'lucide-react'
import logoIcon from '../assets/images/logoicon.webp'

const Navbar = ({ onLogout, onChangePassword, onCreateUser, onManageMfa, username = 'admin' }) => {
  const [open, setOpen] = useState(false)
  const [theme, setTheme] = useState('dark')
  const menuRef = useRef(null)

  useEffect(() => {
    const saved = localStorage.getItem('zeus-theme')
    const nextTheme = saved === 'light' ? 'light' : 'dark'
    setTheme(nextTheme)
    document.documentElement.setAttribute('data-zeus-theme', nextTheme)
  }, [])

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark'
    setTheme(nextTheme)
    localStorage.setItem('zeus-theme', nextTheme)
    document.documentElement.setAttribute('data-zeus-theme', nextTheme)
  }

  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <header className="zeus-navbar flex h-14 shrink-0 items-center justify-between px-5">
      {/* Left: breadcrumb / context */}
      <div className="flex items-center gap-2">
        <img src={logoIcon} alt="Zeus Cloud" className="h-6 w-6 rounded-md object-contain" />
        <span className="text-sm font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--accent-soft)' }}>
          Zeus Cloud
        </span>
        <span style={{ color: 'var(--border-strong)' }}>/</span>
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Hybrid AI Autonomous Platform
        </span>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-2">
        <button
          className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors"
          style={{
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-default)',
            background: 'var(--bg-card)'
          }}
          onClick={toggleTheme}
          title="Alternar tema Zeus Official"
        >
          {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
          <span>Zeus {theme === 'dark' ? 'Light' : 'Dark'}</span>
        </button>

        {/* Notificações */}
        <button
          className="flex h-8 w-8 items-center justify-center rounded-md transition-colors"
          style={{ color: 'var(--text-muted)', border: '1px solid transparent' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(56,162,255,0.10)'; e.currentTarget.style.borderColor = 'rgba(99,185,255,0.28)'; e.currentTarget.style.color = 'var(--text-primary)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)' }}
        >
          <Bell size={15} />
        </button>

        {/* User menu */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setOpen(v => !v)}
            className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors"
            style={{
              background: open ? 'rgba(56,162,255,0.12)' : 'transparent',
              border: '1px solid',
              borderColor: open ? 'rgba(99,185,255,0.38)' : 'transparent',
              color: 'var(--text-primary)'
            }}
            onMouseEnter={e => {
              if (!open) { e.currentTarget.style.background = 'rgba(56,162,255,0.08)'; e.currentTarget.style.borderColor = 'rgba(99,185,255,0.28)' }
            }}
            onMouseLeave={e => {
              if (!open) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent' }
            }}
          >
            <span
              className="flex h-6 w-6 items-center justify-center rounded-md text-white text-xs font-bold"
              style={{ background: 'linear-gradient(135deg, #1f7bff, #62c1ff)', boxShadow: '0 6px 14px rgba(56,162,255,0.36)' }}
            >
              {username.charAt(0).toUpperCase()}
            </span>
            <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{username}</span>
            <ChevronDown size={13} style={{ color: 'var(--text-muted)' }} />
          </button>

          {open && (
            <div
              className="absolute right-0 mt-1 w-52 rounded-lg py-1 z-50"
              style={{
                background: 'linear-gradient(160deg, rgba(17,36,68,0.96), rgba(9,21,42,0.96))',
                border: '1px solid rgba(99,185,255,0.34)',
                boxShadow: '0 14px 40px rgba(0,0,0,0.56), inset 0 1px 0 rgba(186,226,255,0.22)'
              }}
            >
              {/* User info */}
              <div className="px-3 py-2.5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{username}</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Administrador</p>
              </div>

              <div className="py-1">
                {[
                  { icon: KeyRound, label: 'Alterar senha', action: onChangePassword },
                  { icon: UserPlus,  label: 'Novo usuário',  action: onCreateUser },
                  { icon: Shield,    label: 'Configurar MFA', action: onManageMfa },
                ].map(({ icon: Icon, label, action }) => (
                  <button
                    key={label}
                    onClick={() => { setOpen(false); action?.() }}
                    className="flex w-full items-center gap-3 px-3 py-2 text-sm transition-colors"
                    style={{ color: 'var(--text-secondary)' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-card)'; e.currentTarget.style.color = 'var(--text-primary)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)' }}
                  >
                    <Icon size={14} style={{ color: 'var(--text-muted)' }} />
                    {label}
                  </button>
                ))}
              </div>

              <div style={{ borderTop: '1px solid var(--border-subtle)' }} className="py-1">
                <button
                  onClick={() => { setOpen(false); onLogout() }}
                  className="flex w-full items-center gap-3 px-3 py-2 text-sm transition-colors"
                  style={{ color: 'var(--error)' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                >
                  <LogOut size={14} />
                  Sair
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

export default Navbar
