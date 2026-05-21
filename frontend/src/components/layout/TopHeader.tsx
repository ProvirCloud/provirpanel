import { Menu } from 'lucide-react'
import ThemeToggle from '../ui/ThemeToggle'
import UserMenu from './UserMenu'

type TopHeaderProps = {
  title: string
  context?: string
  username: string
  onOpenSidebar: () => void
  onLogout: () => void
  onChangePassword: () => void
  onCreateUser: () => void
  onManageMfa: () => void
}

const TopHeader = ({ title, context, username, onOpenSidebar, onLogout, onChangePassword, onCreateUser, onManageMfa }: TopHeaderProps) => {
  return (
    <header className="zeus-topbar flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onOpenSidebar}
          className="flex h-10 w-10 items-center justify-center rounded-[14px] border lg:hidden"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-muted)' }}
        >
          <Menu size={18} />
        </button>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--color-text)]">{title}</p>
          {context ? <p className="truncate text-xs text-[var(--color-text-soft)]">{context}</p> : null}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <ThemeToggle />
        <UserMenu
          username={username}
          onLogout={onLogout}
          onChangePassword={onChangePassword}
          onCreateUser={onCreateUser}
          onManageMfa={onManageMfa}
        />
      </div>
    </header>
  )
}

export default TopHeader
