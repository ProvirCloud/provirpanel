import { ChevronDown, KeyRound, LogOut, Shield, UserPlus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import Avatar from '../ui/Avatar'

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
        className="inline-flex h-11 items-center gap-3 rounded-[16px] border px-3 text-sm transition-all"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
      >
        <Avatar name={username} className="h-8 w-8 text-xs" />
        <span className="hidden sm:inline">{username}</span>
        <ChevronDown size={14} className="text-[var(--color-text-soft)]" />
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-30 mt-2 w-56 rounded-[20px] border p-2 shadow-[var(--shadow-md)]" style={{ borderColor: 'var(--color-border)', background: 'var(--card-bg-elevated)' }}>
          <div className="px-3 py-2">
            <p className="text-xs font-semibold text-[var(--color-text)]">{username}</p>
            <p className="mt-1 text-xs text-[var(--color-text-soft)]">Administrador</p>
          </div>
          <div className="my-1 h-px bg-[var(--color-divider)]" />
          <div className="space-y-1">
            {items.map(({ label, icon: Icon, action }) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  setOpen(false)
                  action()
                }}
                className="flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-sm transition-all hover:bg-[var(--color-hover)]"
                style={{ color: 'var(--color-text-muted)' }}
              >
                <Icon size={15} />
                <span>{label}</span>
              </button>
            ))}
          </div>
          <div className="my-1 h-px bg-[var(--color-divider)]" />
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              onLogout()
            }}
            className="flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-sm transition-all"
            style={{ color: 'var(--color-danger)' }}
          >
            <LogOut size={15} />
            <span>Sair</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}

export default UserMenu
