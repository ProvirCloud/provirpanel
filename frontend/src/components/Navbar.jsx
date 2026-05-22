import { useEffect, useRef, useState } from 'react'
import { useTask } from '../app/providers/task-provider'
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
  const [showNotif, setShowNotif] = useState(false)
  const taskCtx = useTask()
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
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false); setShowNotif(false)
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

        {/* Notificações / Histórico de operações */}
        <div className="relative">
          <button
            onClick={() => setShowNotif(v => !v)}
            className="flex h-8 w-8 items-center justify-center rounded-md transition-colors relative"
            style={{ color: 'var(--text-muted)', border: '1px solid transparent' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(56,162,255,0.10)'; e.currentTarget.style.borderColor = 'rgba(99,185,255,0.28)'; e.currentTarget.style.color = 'var(--text-primary)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)' }}
          >
            <Bell size={15} />
            {taskCtx && taskCtx.tasks.length > 0 && (
              <span style={{ position: 'absolute', top: 4, right: 4, width: 6, height: 6, borderRadius: '50%', background: '#3b82f6', boxShadow: '0 0 6px rgba(59,130,246,0.8)' }} />
            )}
          </button>
          {showNotif && taskCtx && (
            <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 6, width: 340, maxHeight: '70vh', overflowY: 'auto', borderRadius: 12, border: '1px solid var(--border-default)', background: 'var(--bg-elevated)', boxShadow: '0 16px 48px rgba(0,0,0,0.5)', zIndex: 50 }}>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>Operações</span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{taskCtx.getHistory().length} registros</span>
              </div>
              {taskCtx.tasks.length > 0 && (
                <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border-subtle)' }}>
                  {taskCtx.tasks.map((t) => (
                    <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 11, color: 'var(--text-secondary)' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3b82f6', animation: 'pulse 1.5s infinite', flexShrink: 0 }} />
                      {t.label}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ padding: '6px 8px' }}>
                {taskCtx.getHistory().length === 0 && (
                  <div style={{ textAlign: 'center', padding: '16px 0', fontSize: 11, color: 'var(--text-muted)' }}>Nenhuma operação registrada</div>
                )}
                {taskCtx.getHistory().slice(0, 30).map((t, i) => (
                  <div key={`${t.id}-${i}`} style={{ display: 'flex', gap: 8, padding: '6px 8px', borderRadius: 6 }}>
                    <span style={{ marginTop: 2, flexShrink: 0, fontSize: 11 }}>{t.status === 'success' ? '\u2705' : '\u274c'}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: 'var(--text-primary)', fontWeight: 500 }}>{t.label}</div>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>{new Date(t.startedAt).toLocaleString('pt-BR')}</div>
                      {t.error && <div style={{ fontSize: 9, color: '#f87171', marginTop: 2, fontFamily: 'ui-monospace,monospace', wordBreak: 'break-all' }}>{t.error}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

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
