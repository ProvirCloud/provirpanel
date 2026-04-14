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
  '/': { title: 'Infrastructure Canvas', context: 'Ambientes Docker agrupados de serviços e aplicações' },
  '/stacks': { title: 'Infrastructure Canvas', context: 'Ambientes Docker agrupados de serviços e aplicações' },
  '/docker': { title: 'Docker', context: 'Serviços, containers e runtimes em operação' },
  '/terminal': { title: 'Terminal', context: 'Acesso operacional aos ambientes conectados' },
  '/files': { title: 'Arquivos', context: 'Storage, uploads e gestão de artefatos' },
  '/logs': { title: 'Logs', context: 'Observabilidade, eventos e troubleshooting' },
  '/nginx': { title: 'Nginx Manager', context: 'Rotas, proxy e publicação de aplicações' },
  '/domains': { title: 'Rotas', context: 'Domínios e mapeamento de acessos' },
  '/gateway': { title: 'Gateway', context: 'Integrações, APIs e orquestração de borda' },
  '/security': { title: 'Auditoria', context: 'Governança, trilhas críticas e segurança' },
  '/users': { title: 'Usuários', context: 'Acessos e administração do workspace' },
  '/email': { title: 'E-mail', context: 'Fluxos de comunicação e entrega transacional' },
}

const AppShell = ({ username, onLogout, onChangePassword, onCreateUser, onManageMfa, children }: AppShellProps) => {
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const meta = useMemo(() => routeMeta[location.pathname] || { title: 'Zeus AI Cloud OS', context: 'Console operacional da plataforma' }, [location.pathname])

  return (
    <div className="flex min-h-screen bg-[#090d16] text-white">
      <Sidebar mobileOpen={sidebarOpen} onCloseMobile={() => setSidebarOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
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
        <main className="flex-1 overflow-y-auto bg-[#090d16] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-[1440px]">{children}</div>
        </main>
      </div>
    </div>
  )
}

export default AppShell
