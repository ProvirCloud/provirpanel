import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Suspense, useCallback, useEffect, useState } from 'react'
import LoginPage from './pages/LoginPage.jsx'
import MainLayout from './pages/MainLayout.jsx'
import Dashboard from './components/Dashboard.jsx'
import Terminal from './components/Terminal.jsx'
import DockerPanel from './components/DockerPanel.jsx'
import FileManager from './components/FileManager.jsx'
import DomainsPanel from './components/DomainsPanel.jsx'
import UsersPanel from './components/UsersPanel.jsx'
import LogsPanel from './components/LogsPanel.jsx'
import EmailPanel from './components/EmailPanel.jsx'
import ProvirGateway from './components/ProvirGateway.jsx'
import SecurityAuditPanel from './components/SecurityAuditPanel.jsx'
import NginxPanel from './components/NginxPanel.jsx'
import NginxVisualManager from './components/NginxVisualManager.jsx'
import NginxCanvasPage from './pages/NginxCanvasPage'
import ConsoleModulePage from './pages/ConsoleModulePage'
import InfrastructureCanvasPage from './pages/InfrastructureCanvasPage'
import StacksPanel from './components/StacksPanel.jsx'
import api from './services/api.js'

const RouteLoader = () => (
  <div className="zeus-panel px-6 py-16 text-center text-[var(--color-text-muted)]">Carregando módulo...</div>
)

const ProtectedRoute = ({ loading, authenticated, children }) => {
  if (loading) {
    return <div className="zeus-shell flex min-h-screen items-center justify-center text-[var(--color-text-muted)]">Validando sessão...</div>
  }
  if (!authenticated) return <Navigate to="/login" replace />
  return children
}

const PublicRoute = ({ loading, authenticated, children }) => {
  if (loading) {
    return <div className="zeus-shell flex min-h-screen items-center justify-center text-[var(--color-text-muted)]">Validando sessão...</div>
  }
  if (authenticated) return <Navigate to="/" replace />
  return children
}

const ModulePage = ({ title, subtitle, children, showHeader = true }) => (
  <Suspense fallback={<RouteLoader />}>
    <ConsoleModulePage title={title} subtitle={subtitle} showHeader={showHeader}>
      {children}
    </ConsoleModulePage>
  </Suspense>
)

const App = () => {
  const [authState, setAuthState] = useState({ loading: true, authenticated: false })

  const refreshAuth = useCallback(() => {
    let active = true
    api.get('/auth/me').then(() => {
      if (active) setAuthState({ loading: false, authenticated: true })
    }).catch(() => {
      localStorage.removeItem('provirpanel-token')
      if (active) setAuthState({ loading: false, authenticated: false })
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const stop = refreshAuth()
    return () => {
      if (typeof stop === 'function') stop()
    }
  }, [refreshAuth])

  useEffect(() => {
    const handler = (event) => {
      if (event?.detail?.authenticated === true) {
        setAuthState({ loading: false, authenticated: true })
      } else if (event?.detail?.authenticated === false) {
        setAuthState({ loading: false, authenticated: false })
      } else {
        refreshAuth()
      }
    }
    window.addEventListener('provirpanel-auth', handler)
    return () => window.removeEventListener('provirpanel-auth', handler)
  }, [refreshAuth])

  return (
    <BrowserRouter basename="/admin">
      <Routes>
        <Route
          path="/login"
          element={
            <PublicRoute loading={authState.loading} authenticated={authState.authenticated}>
              <LoginPage />
            </PublicRoute>
          }
        />
        <Route
          path="/"
          element={
            <ProtectedRoute loading={authState.loading} authenticated={authState.authenticated}>
              <MainLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="stacks" element={<InfrastructureCanvasPage />} />
          <Route path="stacks/canvas" element={<ModulePage showHeader={false} title="Infrastructure Canvas" subtitle="Editor visual de stacks"><StacksPanel /></ModulePage>} />
          <Route path="terminal" element={<ModulePage title="Terminal" subtitle="Acesso operacional aos ambientes conectados"><Terminal showPageIntro={false} /></ModulePage>} />
          <Route path="docker" element={<ModulePage title="Container Service" subtitle="Serviços, containers e topologias dos ambientes"><DockerPanel showPageIntro={false} /></ModulePage>} />
          <Route path="nginx" element={<NginxCanvasPage />} />
          <Route path="nginx-advanced" element={<ModulePage title="Nginx Manager" subtitle="Rotas, proxy e publicação de aplicações"><NginxVisualManager showPageIntro={false} /></ModulePage>} />
          <Route path="nginx-legacy" element={<ModulePage showHeader={false} title="Nginx Legacy" subtitle="Gestão avançada do ambiente Nginx"><NginxPanel /></ModulePage>} />
          <Route path="domains" element={<ModulePage title="Cloudflare" subtitle="Domínios, e-mail, firewall e WAF com baseline Zeus"><DomainsPanel showPageIntro={false} /></ModulePage>} />
          <Route path="files" element={<ModulePage title="Arquivos" subtitle="Storage, uploads e gestão de artefatos"><FileManager showPageIntro={false} /></ModulePage>} />
          <Route path="users" element={<ModulePage title="Usuários" subtitle="Acessos e administração do workspace"><UsersPanel showPageIntro={false} /></ModulePage>} />
          <Route path="email" element={<ModulePage title="E-mail" subtitle="Fluxos de comunicação e entrega transacional"><EmailPanel showPageIntro={false} /></ModulePage>} />
          <Route path="gateway" element={<ModulePage title="Gateway" subtitle="Integrações, APIs e orquestração de borda"><ProvirGateway showPageIntro={false} /></ModulePage>} />
          <Route path="security" element={<ModulePage title="Auditoria" subtitle="Governança, trilhas críticas e segurança"><SecurityAuditPanel showPageIntro={false} /></ModulePage>} />
          <Route path="logs" element={<ModulePage title="Logs" subtitle="Observabilidade, eventos e troubleshooting"><LogsPanel showPageIntro={false} /></ModulePage>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
