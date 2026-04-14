import { Activity, Boxes, Files, FileText, Globe, Route, SearchCheck, Terminal, X } from 'lucide-react'
import logoName from '../../assets/images/logoname.webp'
import SidebarSection from './SidebarSection'

const sections = [
  {
    label: 'Operação',
    items: [{ to: '/', label: 'Dashboard', icon: Activity, end: true }],
  },
  {
    label: 'Infra Canvas',
    items: [
      { to: '/docker', label: 'Docker', icon: Boxes },
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

const SidebarContent = ({ onNavigate, showClose = false }: SidebarContentProps) => (
  <>
    <div className="mb-8 flex items-center justify-between gap-3 px-2">
      <img src={logoName} alt="Zeus AI Cloud OS" className="h-9 w-auto object-contain" />
      {showClose ? (
        <button
          type="button"
          onClick={onNavigate}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-300 lg:hidden"
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

    <div className="mt-6 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
      <p className="text-xs font-medium text-slate-300">Zeus AI Cloud OS</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">Console operacional para infraestrutura, aplicações e governança.</p>
    </div>
  </>
)

type SidebarProps = {
  mobileOpen: boolean
  onCloseMobile: () => void
}

const Sidebar = ({ mobileOpen, onCloseMobile }: SidebarProps) => {
  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-[272px] shrink-0 border-r border-white/8 bg-[#0b0f1a] px-4 py-5 lg:flex lg:flex-col">
        <SidebarContent />
      </aside>

      <div
        className={`fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm transition-opacity lg:hidden ${mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={onCloseMobile}
      />

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[272px] flex-col border-r border-white/8 bg-[#0b0f1a] px-4 py-5 shadow-[24px_0_80px_rgba(0,0,0,0.45)] transition-transform duration-300 lg:hidden ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <SidebarContent onNavigate={onCloseMobile} showClose />
      </aside>
    </>
  )
}

export default Sidebar
