import { NavLink } from 'react-router-dom'
import {
  Activity,
  Boxes,
  Files,
  Terminal,
  Globe,
  Users,
  FileText,
  Server,
  Mail,
  Route,
  Shield,
  Layers,
  ChevronRight
} from 'lucide-react'
import logoIcon from '../assets/images/logoicon.webp'
import logoName from '../assets/images/logoname.webp'

const sections = [
  {
    label: 'Operação',
    items: [
      { to: '/',        label: 'Dashboard',    icon: Activity, end: true },
      { to: '/stacks',  label: 'Infra Canvas', icon: Layers },
      { to: '/docker',  label: 'Container Service', icon: Boxes },
      { to: '/terminal',label: 'Terminal',      icon: Terminal },
      { to: '/files',   label: 'Arquivos',      icon: Files },
      { to: '/logs',    label: 'Logs',          icon: FileText },
    ]
  },
  {
    label: 'Infraestrutura',
    items: [
      { to: '/nginx',   label: 'Nginx Manager', icon: Server },
      { to: '/domains', label: 'Rotas',         icon: Globe },
      { to: '/gateway', label: 'Gateway',        icon: Route },
      { to: '/security',label: 'Auditoria',     icon: Shield },
    ]
  },
  {
    label: 'Workspace',
    items: [
      { to: '/users',   label: 'Usuários', icon: Users },
      { to: '/email',   label: 'E-mail',   icon: Mail },
    ]
  }
]

const Sidebar = () => {
  return (
    <aside className="zeus-sidebar flex h-screen w-60 shrink-0 flex-col overflow-hidden" style={{ position: 'sticky', top: 0 }}>

      {/* Brand */}
      <div className="px-4 py-5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'linear-gradient(145deg, rgba(56,162,255,0.20), rgba(56,162,255,0.08))', border: '1px solid rgba(99,185,255,0.36)', boxShadow: 'inset 0 1px 0 rgba(178,224,255,0.28), 0 0 16px rgba(56,162,255,0.24)' }}>
          <img src={logoIcon} alt="Zeus Cloud" className="h-5 w-5 object-contain" />
        </div>
        <div className="min-w-0">
          <img src={logoName} alt="Zeus Cloud" className="h-6 w-auto object-contain" />
          <p className="mt-1 truncate text-[10px]" style={{ color: 'var(--text-secondary)' }}>
            Hybrid AI Autonomous Platform
          </p>
        </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {sections.map((section) => (
          <div key={section.label}>
            <p className="zeus-section-label mb-2 px-2">{section.label}</p>
            <ul className="space-y-0.5">
              {section.items.map(({ to, label, icon: Icon, end }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    end={end}
                    className={({ isActive }) =>
                      `group flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-all ${
                        isActive
                          ? 'font-medium'
                          : 'font-normal'
                      }`
                    }
                    style={({ isActive }) => isActive
                      ? { background: 'linear-gradient(135deg, rgba(56,162,255,0.20), rgba(56,162,255,0.08))', color: 'var(--accent-soft)', border: '1px solid rgba(99,185,255,0.36)', boxShadow: 'inset 0 1px 0 rgba(179,224,255,0.22)' }
                      : { background: 'transparent', color: 'var(--text-secondary)', border: '1px solid transparent' }
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon
                          size={15}
                          style={{ color: isActive ? 'var(--accent)' : 'var(--text-muted)', flexShrink: 0 }}
                        />
                        <span className="flex-1 truncate">{label}</span>
                        {isActive && (
                          <ChevronRight size={12} style={{ color: 'var(--accent)', opacity: 0.6 }} />
                        )}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* Footer status */}
      <div className="px-4 py-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center gap-2 rounded-lg border px-2.5 py-2" style={{ borderColor: 'rgba(99,185,255,0.22)', background: 'rgba(14,33,64,0.42)' }}>
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: '#48d4ff', boxShadow: '0 0 10px rgba(72,212,255,0.8)' }}
          />
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Sistema operacional</span>
        </div>
      </div>

    </aside>
  )
}

export default Sidebar
