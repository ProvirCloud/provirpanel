import { Activity, Boxes, Brain, Database, Files, FileText, Globe, Layers3, Route, SearchCheck, Terminal, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import logoNameDark from '../../assets/images/logoname.webp'
import logoNameLight from '../../assets/images/logoname_w.webp'
import { useTheme } from '../../app/providers/theme-provider'
import Card from '../ui/Card'
import SidebarSection from './SidebarSection'

declare const __BUILD_VERSION__: string

const roleConfig: Record<string, { label: string; color: string; bg: string }> = {
  central: { label: 'Central AI', color: 'text-purple-300', bg: 'bg-purple-500/15 border-purple-500/30' },
  workspace: { label: 'Workspace', color: 'text-blue-300', bg: 'bg-blue-500/15 border-blue-500/30' },
  project: { label: 'Projeto', color: 'text-emerald-300', bg: 'bg-emerald-500/15 border-emerald-500/30' },
}

const PanelBadge = () => {
  const [info, setInfo] = useState<{ panelName: string; role: string; scopeName: string | null } | null>(null)

  useEffect(() => {
    const fetchInfo = async () => {
      try {
        const token = localStorage.getItem('provirpanel-token')
        const res = await fetch('/api/zeus/panel-info', { headers: { Authorization: `Bearer ${token}` } })
        if (res.ok) setInfo(await res.json())
      } catch {}
    }
    fetchInfo()
  }, [])

  if (!info) return null
  const cfg = roleConfig[info.role] || roleConfig.project

  return (
    <div className={`mb-4 rounded-lg border px-3 py-2 ${cfg.bg}`}>
      <div className={`text-[10px] font-bold uppercase tracking-widest ${cfg.color}`}>{cfg.label}</div>
      <div className="mt-0.5 text-sm font-medium text-[var(--color-text)]">{info.panelName}</div>
      {info.scopeName && info.role !== 'central' && (
        <div className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">└ {info.scopeName}</div>
      )}
    </div>
  )
}

const sections = [
  {
    label: 'Operação',
    items: [
      { to: '/', label: 'Dashboard', icon: Activity, end: true },
      { to: '/stacks', label: 'Infra Canvas', icon: Layers3 },
      { to: '/sites', label: 'Sites', icon: Globe },
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
      { to: '/domains', label: 'DNS & WAF', icon: Globe },
      { to: '/gateway', label: 'Gateway', icon: Route },
      { to: '/databases', label: 'Databases', icon: Database },
      { to: '/security', label: 'Auditoria', icon: SearchCheck },
    ],
  },
  {
    label: 'Inteligência',
    items: [
      { to: '/zeus-panels', label: 'Zeus AI', icon: Brain },
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

      <PanelBadge />

      <div className="flex-1 space-y-8 overflow-y-auto pr-1">
        {sections.map((section) => (
          <SidebarSection key={section.label} label={section.label} items={section.items} onNavigate={onNavigate} />
        ))}
      </div>

      <Card variant="default" className="mt-6 px-4 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-text-soft)]">ZEUS AI CLOUD OS</p>
        <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">Console operacional para infraestrutura, aplicações, observabilidade e governança.</p>
        <p className="mt-2 text-[10px] font-mono text-[var(--color-text-muted)] opacity-50">build {__BUILD_VERSION__}</p>
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
