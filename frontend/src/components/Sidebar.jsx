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
  Cpu
} from 'lucide-react'
import logoImg from '../assets/logo.png'

const sections = [
  {
    title: 'Operacao',
    items: [
      { to: '/', label: 'Dashboard', icon: Activity, end: true },
      { to: '/terminal', label: 'Terminal', icon: Terminal },
      { to: '/docker', label: 'Docker', icon: Boxes },
      { to: '/files', label: 'Arquivos', icon: Files },
      { to: '/logs', label: 'Logs', icon: FileText }
    ]
  },
  {
    title: 'Infraestrutura',
    items: [
      { to: '/nginx', label: 'Nginx Manager', icon: Server },
      { to: '/domains', label: 'Rotas', icon: Globe },
      { to: '/gateway', label: 'Gateway', icon: Route },
      { to: '/security', label: 'Auditoria', icon: Shield }
    ]
  },
  {
    title: 'Workspace',
    items: [
      { to: '/users', label: 'Usuarios', icon: Users },
      { to: '/email', label: 'Email', icon: Mail }
    ]
  }
]

const Sidebar = () => {
  return (
    <aside className="zeus-panel-dark sticky top-4 flex h-[calc(100vh-2rem)] w-72 shrink-0 flex-col gap-6 overflow-hidden rounded-[2rem] px-5 py-5">
      <div className="absolute inset-x-0 top-0 h-40 bg-[radial-gradient(circle_at_top,_rgba(125,211,252,0.3),_transparent_60%)]" />

      <div className="relative rounded-[1.6rem] border border-sky-300/15 bg-white/5 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-sky-300/20 bg-white/10 shadow-lg shadow-sky-500/10">
            <img src={logoImg} alt="Zeus Engine" className="h-9 w-9 object-contain" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[11px] font-semibold uppercase tracking-[0.34em] text-sky-100/70">
              ZeusEngine
            </p>
            <h1 className="text-lg font-bold tracking-[0.08em] text-white">Hybrid AI Panel</h1>
          </div>
        </div>

        <div className="mt-5 rounded-[1.35rem] border border-sky-300/10 bg-[linear-gradient(135deg,_rgba(125,211,252,0.18),_rgba(59,130,246,0.04))] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.34em] text-sky-100/65">Nucleo</p>
              <p className="mt-2 text-2xl font-semibold text-white">Zeus</p>
              <p className="mt-1 text-xs leading-5 text-slate-300">
                Plataforma hibrida de IA para operacao, deploy e infraestrutura.
              </p>
            </div>
            <div className="rounded-2xl border border-sky-300/15 bg-slate-950/30 p-2 text-sky-200">
              <Cpu className="h-5 w-5" />
            </div>
          </div>
        </div>
      </div>

      <div className="relative flex-1 space-y-5 overflow-y-auto pr-1">
        {sections.map((section) => (
          <div key={section.title}>
            <p className="px-2 text-[10px] font-semibold uppercase tracking-[0.34em] text-sky-100/45">
              {section.title}
            </p>
            <nav className="mt-2 space-y-1.5">
              {section.items.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    `group flex items-center gap-3 rounded-2xl px-3.5 py-3 text-sm font-medium transition ${
                      isActive
                        ? 'bg-[linear-gradient(135deg,_rgba(125,211,252,0.24),_rgba(59,130,246,0.22))] text-white shadow-lg shadow-sky-500/10'
                        : 'text-slate-300 hover:bg-white/6 hover:text-white'
                    }`
                  }
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/8 bg-white/5 transition group-hover:border-sky-300/20 group-hover:bg-sky-300/10">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span>{label}</span>
                </NavLink>
              ))}
            </nav>
          </div>
        ))}
      </div>

      <div className="relative rounded-[1.4rem] border border-sky-300/12 bg-white/5 p-4">
        <p className="text-[10px] uppercase tracking-[0.34em] text-sky-100/55">Status</p>
        <div className="mt-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-white">Peerless technology</p>
            <p className="mt-1 text-xs text-slate-300">Infraestrutura pronta para software e negocios.</p>
          </div>
          <span className="inline-flex h-3 w-3 rounded-full bg-emerald-400 shadow-[0_0_18px_rgba(74,222,128,0.8)]" />
        </div>
      </div>
    </aside>
  )
}

export default Sidebar
