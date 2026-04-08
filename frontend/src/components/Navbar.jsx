import { useEffect, useRef, useState } from 'react'
import {
  Bell,
  CircleUser,
  Shield,
  LogOut,
  KeyRound,
  UserPlus,
  ChevronDown,
  Zap
} from 'lucide-react'

const Navbar = ({ onLogout, onChangePassword, onCreateUser, onManageMfa, username = 'admin' }) => {
  const [open, setOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    const handleClick = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <header className="zeus-panel sticky top-4 z-20 flex items-center justify-between rounded-[1.75rem] px-6 py-4 text-slate-900">
      <div className="flex items-center gap-4">
        <div className="rounded-2xl border border-blue-200/70 bg-[linear-gradient(135deg,_rgba(255,255,255,0.96),_rgba(219,234,254,0.78))] p-3 shadow-lg shadow-blue-500/10">
          <Zap className="h-5 w-5 text-blue-700" />
        </div>
        <div>
          <p className="zeus-kicker text-[10px] font-semibold uppercase">ZeusEngine Hybrid AI Development Platform</p>
          <p className="mt-1 text-sm text-slate-600">
            Plataforma hibrida de IA para desenvolvimento, deploy e operacao.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button className="rounded-2xl border border-blue-200/70 bg-white/80 p-3 text-blue-700 transition hover:border-blue-400 hover:text-blue-900">
          <Bell className="h-4 w-4" />
        </button>

        <div className="relative" ref={menuRef}>
          <button
            className="flex items-center gap-3 rounded-2xl border border-blue-200/70 bg-white/82 px-3 py-2.5 text-sm shadow-sm transition hover:border-blue-400"
            onClick={() => setOpen((prev) => !prev)}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[linear-gradient(135deg,_#16366f,_#3b82f6)] text-white">
              <CircleUser className="h-5 w-5" />
            </span>
            <span className="text-left">
              <span className="block text-[11px] uppercase tracking-[0.28em] text-slate-500">Operador</span>
              <span className="block font-semibold text-slate-900">{username}</span>
            </span>
            <ChevronDown className="h-4 w-4 text-slate-500" />
          </button>

          {open && (
            <div className="zeus-panel absolute right-0 mt-3 w-56 rounded-2xl p-2 text-sm shadow-2xl">
              <button
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-slate-700 transition hover:bg-blue-50"
                onClick={() => {
                  setOpen(false)
                  onChangePassword()
                }}
              >
                <KeyRound className="h-4 w-4 text-blue-700" />
                Alterar senha
              </button>
              <button
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-slate-700 transition hover:bg-blue-50"
                onClick={() => {
                  setOpen(false)
                  onCreateUser()
                }}
              >
                <UserPlus className="h-4 w-4 text-blue-700" />
                Novo usuario
              </button>
              <button
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-slate-700 transition hover:bg-blue-50"
                onClick={() => {
                  setOpen(false)
                  onManageMfa?.()
                }}
              >
                <Shield className="h-4 w-4 text-blue-700" />
                MFA
              </button>
              <div className="my-2 h-px bg-blue-100" />
              <button
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-rose-600 transition hover:bg-rose-50"
                onClick={() => {
                  setOpen(false)
                  onLogout()
                }}
              >
                <LogOut className="h-4 w-4" />
                Sair
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

export default Navbar
