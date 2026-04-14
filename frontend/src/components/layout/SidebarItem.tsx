import type { LucideIcon } from 'lucide-react'
import { NavLink } from 'react-router-dom'

type SidebarItemProps = {
  to: string
  label: string
  icon: LucideIcon
  onClick?: () => void
  end?: boolean
}

const SidebarItem = ({ to, label, icon: Icon, onClick, end }: SidebarItemProps) => {
  return (
    <NavLink to={to} end={end} onClick={onClick} className="group relative flex items-center gap-3 rounded-[18px] px-3 py-2.5 text-sm transition-all duration-[var(--duration-fast)] ease-[var(--ease-standard)]">
      {({ isActive }) => (
        <>
          <span
            className="absolute left-0 top-1/2 h-8 w-[3px] -translate-y-1/2 rounded-full transition-all"
            style={{ background: isActive ? 'var(--sidebar-active-accent)' : 'transparent', boxShadow: isActive ? '0 0 12px color-mix(in srgb, var(--sidebar-active-accent) 42%, transparent)' : 'none' }}
          />
          <span
            className="flex h-10 w-10 items-center justify-center rounded-[14px] border transition-all"
            style={{
              borderColor: isActive ? 'color-mix(in srgb, var(--color-brand) 30%, transparent)' : 'var(--color-border-subtle)',
              background: isActive ? 'var(--sidebar-active)' : 'var(--sidebar-hover)',
              color: isActive ? 'var(--color-text)' : 'var(--sidebar-text)',
            }}
          >
            <Icon size={16} />
          </span>
          <span className="flex-1 truncate" style={{ color: isActive ? 'var(--color-text)' : 'var(--sidebar-text)', fontWeight: isActive ? 600 : 500 }}>{label}</span>
        </>
      )}
    </NavLink>
  )
}

export default SidebarItem
