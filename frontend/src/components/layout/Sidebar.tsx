import { Activity, Boxes, Files, FileText, Globe, Layers3, Route, SearchCheck, Terminal, X } from 'lucide-react'
import logoNameDark from '../../assets/images/logoname.webp'
import logoNameLight from '../../assets/images/logoname_w.webp'
import { useTheme } from '../../app/providers/theme-provider'
import Card from '../ui/Card'
import SidebarSection from './SidebarSection'

const sections = [
  {
    label: 'Operação',
    items: [
      { to: '/', label: 'Dashboard', icon: Activity, end: true },
      { to: '/stacks', label: 'Infra Canvas', icon: Layers3 },
    ],
  },
  {
    label: 'Infra Canvas',
    items: [
      { to: '/docker', label: 'Container Service', icon: Boxes },
      { to: '/terminal', label: 'Terminal', icon: Terminal },
      { to: '/files', label: 'Arquivos', icon: Files },
      { to: '/logs', label: 'Logs', icon: FileText },
    ],
  },
  {
    label: 'Infraestrutura',
    items: [
      { to: '/nginx', label: 'Nginx Manager', icon: Boxes },
      { to: '/domains', label: 'Rotas', icon: Globe },
      { to: '/gateway', label: 'Gateway', icon: Route },
      { to: '/security', label: 'Auditoria', icon: SearchCheck },
    ],
  },
]

type SidebarContentProps = {
  onNavigate?: () => void
  showClose?: boolean
}

const SidebarContent = ({ onNavigate, showClose = false }: SidebarContentProps) => {
  const { theme } = useTheme()
  const logo = theme === 'light' ? logoNameDark : logoNameLight

  return (
    <>
      <div className="mb-8 flex items-center justify-between gap-3 px-2">
        <img src={logo} alt="Zeus AI Cloud OS" className="zeus-logo-glow h-10 w-auto object-contain" />
        {showClose ? (
          <button
            type="button"
            onClick={onNavigate}
            className="flex h-10 w-10 items-center justify-center rounded-[14px] border bg-[var(--color-surface)] text-[var(--color-text-muted)] lg:hidden"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <X size={16} />
          </button>
        ) : null}
      </div>

      <div className="flex-1 space-y-8 overflow-y-auto pr-1">
        {sections.map((section) => (
          <SidebarSection key={section.label} label={section.label} items={section.items} onNavigate={onNavigate} />
        ))}
      </div>

      <Card variant="muted" className="mt-6 px-4 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-text-soft)]">ZEUS AI CLOUD OS</p>
        <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">Console operacional para infraestrutura, aplicações, observabilidade e governança.</p>
      </Card>
    </>
  )
}

type SidebarProps = {
  mobileOpen: boolean
  onCloseMobile: () => void
}

const Sidebar = ({ mobileOpen, onCloseMobile }: SidebarProps) => {
  return (
    <>
      <aside className="zeus-sidebar sticky top-0 hidden h-screen shrink-0 px-4 py-5 lg:flex lg:flex-col">
        <SidebarContent />
      </aside>

      <div
        className={`fixed inset-0 z-40 transition-opacity lg:hidden ${mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        style={{ background: 'var(--color-overlay)' }}
        onClick={onCloseMobile}
      />

      <aside
        className={`zeus-sidebar fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col px-4 py-5 shadow-[0_24px_80px_rgba(0,0,0,0.4)] transition-transform duration-300 lg:hidden ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <SidebarContent onNavigate={onCloseMobile} showClose />
      </aside>
    </>
  )
}

export default Sidebar
