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
    <NavLink to={to} end={end} onClick={onClick} className="group relative flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition-all duration-200">
      {({ isActive }) => (
        <>
          <span
            className={`absolute left-0 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-full transition-all ${isActive ? 'bg-blue-400 shadow-[0_0_12px_rgba(96,165,250,0.7)]' : 'bg-transparent'}`}
          />
          <span
            className={`flex h-9 w-9 items-center justify-center rounded-xl border transition-all ${isActive ? 'border-blue-400/25 bg-blue-500/12 text-blue-200' : 'border-white/5 bg-white/[0.03] text-slate-400 group-hover:border-white/10 group-hover:bg-white/[0.05] group-hover:text-white'}`}
          >
            <Icon size={16} />
          </span>
          <span className={`${isActive ? 'text-white' : 'text-slate-300 group-hover:text-white'}`}>{label}</span>
        </>
      )}
    </NavLink>
  )
}

export default SidebarItem
