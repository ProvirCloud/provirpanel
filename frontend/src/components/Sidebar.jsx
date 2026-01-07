import { NavLink } from 'react-router-dom'
import { Activity, Boxes, Files, Terminal, Globe, Users, FileText } from 'lucide-react'

const linkBase =
  'flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition hover:bg-slate-800/70'

const Sidebar = () => {
  return (
    <aside className="flex h-full w-64 flex-col gap-6 border-r border-slate-800 bg-slate-950/70 px-4 py-6">
      <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-950 to-emerald-950/30 p-4">
        <p className="text-xs uppercase tracking-[0.3em] text-emerald-200/70">Status</p>
        <p className="mt-2 text-xl font-semibold text-white">Tudo verde</p>
        <p className="mt-1 text-xs text-slate-400">Infra segura e estável</p>
      </div>
      <nav className="flex flex-col gap-2 text-slate-200">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `${linkBase} ${isActive ? 'bg-emerald-500/15 text-emerald-200' : ''}`
          }
        >
          <Activity className="h-4 w-4" />
          Dashboard
        </NavLink>
        <NavLink
          to="/terminal"
          className={({ isActive }) =>
            `${linkBase} ${isActive ? 'bg-emerald-500/15 text-emerald-200' : ''}`
          }
        >
          <Terminal className="h-4 w-4" />
          Terminal
        </NavLink>
        <NavLink
          to="/docker"
          className={({ isActive }) =>
            `${linkBase} ${isActive ? 'bg-emerald-500/15 text-emerald-200' : ''}`
          }
        >
          <Boxes className="h-4 w-4" />
          Docker (Serviços)
        </NavLink>
        <NavLink
          to="/domains"
          className={({ isActive }) =>
            `${linkBase} ${isActive ? 'bg-emerald-500/15 text-emerald-200' : ''}`
          }
        >
          <Globe className="h-4 w-4" />
          Rotas
        </NavLink>
        <NavLink
          to="/files"
          className={({ isActive }) =>
            `${linkBase} ${isActive ? 'bg-emerald-500/15 text-emerald-200' : ''}`
          }
        >
          <Files className="h-4 w-4" />
          Arquivos
        </NavLink>
        <NavLink
          to="/users"
          className={({ isActive }) =>
            `${linkBase} ${isActive ? 'bg-emerald-500/15 text-emerald-200' : ''}`
          }
        >
          <Users className="h-4 w-4" />
          Usuários
        </NavLink>
        <NavLink
          to="/logs"
          className={({ isActive }) =>
            `${linkBase} ${isActive ? 'bg-emerald-500/15 text-emerald-200' : ''}`
          }
        >
          <FileText className="h-4 w-4" />
          Logs
        </NavLink>
      </nav>
      <div className="mt-auto rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-xs text-slate-400">
        <p>Versao 0.1.0</p>
        <p className="mt-1">Ultima sync: agora</p>
      </div>
    </aside>
  )
}

export default Sidebar
