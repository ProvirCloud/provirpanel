import { Menu } from 'lucide-react'
import ThemeToggle from './ThemeToggle'
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
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-white/8 bg-[#0b0f1a]/85 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onOpenSidebar}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-300 lg:hidden"
        >
          <Menu size={18} />
        </button>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{title}</p>
          {context ? <p className="truncate text-xs text-slate-500">{context}</p> : null}
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
