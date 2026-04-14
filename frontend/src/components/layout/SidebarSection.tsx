import type { LucideIcon } from 'lucide-react'
import SidebarItem from './SidebarItem'

type Item = {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
}

type SidebarSectionProps = {
  label: string
  items: Item[]
  onNavigate?: () => void
}

const SidebarSection = ({ label, items, onNavigate }: SidebarSectionProps) => {
  return (
    <section className="space-y-2">
      <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">{label}</p>
      <div className="space-y-1">
        {items.map((item) => (
          <SidebarItem key={item.to} {...item} onClick={onNavigate} />
        ))}
      </div>
    </section>
  )
}

export default SidebarSection
