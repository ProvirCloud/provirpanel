import { ChevronDown, KeyRound, LogOut, Shield, UserPlus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

type UserMenuProps = {
  username: string
  onLogout: () => void
  onChangePassword: () => void
  onCreateUser: () => void
  onManageMfa: () => void
}

const UserMenu = ({ username, onLogout, onChangePassword, onCreateUser, onManageMfa }: UserMenuProps) => {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const items = [
    { label: 'Alterar senha', icon: KeyRound, action: onChangePassword },
    { label: 'Novo usuário', icon: UserPlus, action: onCreateUser },
    { label: 'Configurar MFA', icon: Shield, action: onManageMfa },
  ]

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-10 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-slate-200 transition-all hover:border-white/20 hover:bg-white/[0.06]"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-violet-500 text-xs font-semibold text-white">
          {username.charAt(0).toUpperCase()}
        </span>
        <span className="hidden sm:inline">{username}</span>
        <ChevronDown size={14} className="text-slate-400" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-56 rounded-2xl border border-white/10 bg-[#0f1522] p-2 shadow-[0_20px_50px_rgba(0,0,0,0.38)]">
          <div className="px-3 py-2">
            <p className="text-xs font-semibold text-white">{username}</p>
            <p className="mt-1 text-xs text-slate-500">Administrador</p>
          </div>
          <div className="my-1 h-px bg-white/8" />
          <div className="space-y-1">
            {items.map(({ label, icon: Icon, action }) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  setOpen(false)
                  action()
                }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-300 transition-all hover:bg-white/[0.05] hover:text-white"
              >
                <Icon size={15} className="text-slate-400" />
                <span>{label}</span>
              </button>
            ))}
          </div>
          <div className="my-1 h-px bg-white/8" />
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              onLogout()
            }}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-rose-300 transition-all hover:bg-rose-500/10"
          >
            <LogOut size={15} />
            <span>Sair</span>
          </button>
        </div>
      )}
    </div>
  )
}

export default UserMenu
