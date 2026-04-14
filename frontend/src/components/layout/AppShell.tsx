import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import TopHeader from './TopHeader'

type AppShellProps = {
  username: string
  onLogout: () => void
  onChangePassword: () => void
  onCreateUser: () => void
  onManageMfa: () => void
  children: ReactNode
}

const routeMeta: Record<string, { title: string; context: string }> = {
  '/': { title: 'Dashboard', context: 'Monitoramento em tempo real de infraestrutura, aplicações e serviços' },
  '/stacks': { title: 'Infrastructure Canvas', context: 'Ambientes Docker agrupados de serviços e aplicações' },
  '/docker': { title: 'Container Service', context: 'Serviços, runtimes e topologias dos ambientes' },
  '/terminal': { title: 'Terminal', context: 'Acesso operacional aos ambientes conectados' },
  '/files': { title: 'Arquivos', context: 'Storage, uploads e gestão de artefatos' },
  '/logs': { title: 'Logs', context: 'Observabilidade, eventos e troubleshooting' },
  '/nginx': { title: 'Nginx Manager', context: 'Rotas, proxy e publicação de aplicações' },
  '/nginx-legacy': { title: 'Nginx Legacy', context: 'Gestão avançada do ambiente Nginx' },
  '/domains': { title: 'Rotas', context: 'Domínios e mapeamento de acessos' },
  '/gateway': { title: 'Gateway', context: 'Integrações, APIs e orquestração de borda' },
  '/security': { title: 'Auditoria', context: 'Governança, trilhas críticas e segurança' },
  '/users': { title: 'Usuários', context: 'Acessos e administração do workspace' },
  '/email': { title: 'E-mail', context: 'Fluxos de comunicação e entrega transacional' },
}

const AppShell = ({ username, onLogout, onChangePassword, onCreateUser, onManageMfa, children }: AppShellProps) => {
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const meta = useMemo(() => routeMeta[location.pathname] || { title: 'ZEUS AI CLOUD OS', context: 'Console operacional da plataforma' }, [location.pathname])

  return (
    <div className="zeus-app-shell text-[var(--color-text)]">
      <Sidebar mobileOpen={sidebarOpen} onCloseMobile={() => setSidebarOpen(false)} />
      <div className="min-w-0">
        <TopHeader
          title={meta.title}
          context={meta.context}
          username={username}
          onOpenSidebar={() => setSidebarOpen(true)}
          onLogout={onLogout}
          onChangePassword={onChangePassword}
          onCreateUser={onCreateUser}
          onManageMfa={onManageMfa}
        />
        <main className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-[1440px]">{children}</div>
        </main>
      </div>
    </div>
  )
}

export default AppShell
