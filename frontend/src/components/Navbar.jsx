import { useEffect, useRef, useState } from 'react'
import { Bell, CircleUser, Shield, LogOut, KeyRound, UserPlus, ChevronDown } from 'lucide-react'

const Navbar = ({ onLogout, onChangePassword, onCreateUser, username = 'admin' }) => {
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
    <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900/60 px-6 py-4 backdrop-blur">
      <div className="flex items-center gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400/20 to-blue-500/20 border border-emerald-400/30">
          <img src="/src/assets/logo.png" alt="Provir" className="h-7 w-7" />
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-200/80 font-medium">Provir Cloud Panel</p>
          <p className="text-lg font-bold bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">Controle em tempo real</p>
        </div>
      </div>
      <div className="flex items-center gap-3 text-slate-200">
        <button className="rounded-full border border-slate-800 bg-slate-900 p-2 transition hover:border-emerald-400/60 hover:text-emerald-200">
          <Bell className="h-4 w-4" />
        </button>
        <div className="relative" ref={menuRef}>
          <button
            className="flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900 px-3 py-1 text-xs transition hover:border-blue-500/60"
            onClick={() => setOpen((prev) => !prev)}
          >
            <CircleUser className="h-4 w-4" />
            <span className="text-xs">{username}</span>
            <ChevronDown className="h-3 w-3 text-slate-400" />
          </button>
          {open && (
            <div className="absolute right-0 mt-2 w-48 rounded-xl border border-slate-800 bg-slate-950 p-2 text-xs shadow-lg">
              <button
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-slate-200 hover:bg-slate-800/60"
                onClick={() => {
                  setOpen(false)
                  onChangePassword()
                }}
              >
                <KeyRound className="h-4 w-4" />
                Alterar senha
              </button>
              <button
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-slate-200 hover:bg-slate-800/60"
                onClick={() => {
                  setOpen(false)
                  onCreateUser()
                }}
              >
                <UserPlus className="h-4 w-4" />
                Novo usuario
              </button>
              <div className="my-1 h-px bg-slate-800" />
              <button
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-rose-200 hover:bg-rose-500/10"
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
