import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import LoginPage from './pages/LoginPage.jsx'
import MainLayout from './pages/MainLayout.jsx'
import Dashboard from './components/Dashboard.jsx'
import Terminal from './components/Terminal.jsx'
import DockerPanel from './components/DockerPanel.jsx'
import FileManager from './components/FileManager.jsx'
import DomainsPanel from './components/DomainsPanel.jsx'
import api from './services/api.js'

const App = () => {
  const [authState, setAuthState] = useState({ loading: true, authenticated: false })

  const refreshAuth = useCallback(() => {
    const token = localStorage.getItem('token')
    if (!token) {
      setAuthState({ loading: false, authenticated: false })
      return
    }

    let active = true
    api
      .get('/auth/me')
      .then(() => {
        if (active) setAuthState({ loading: false, authenticated: true })
      })
      .catch(() => {
        localStorage.removeItem('token')
        if (active) setAuthState({ loading: false, authenticated: false })
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let cleanup = null
    const handleAuthChange = () => {
      cleanup = refreshAuth()
    }
    handleAuthChange()
    window.addEventListener('provirpanel-auth', handleAuthChange)
    return () => {
      if (cleanup) cleanup()
      window.removeEventListener('provirpanel-auth', handleAuthChange)
    }
  }, [refreshAuth])

  const ProtectedRoute = ({ children }) => {
    if (authState.loading) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-200">
          Validando sessao...
        </div>
      )
    }
    if (!authState.authenticated) {
      return <Navigate to="/login" replace />
    }
    return children
  }

  const PublicRoute = ({ children }) => {
    if (authState.loading) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-200">
          Validando sessao...
        </div>
      )
    }
    if (authState.authenticated) {
      return <Navigate to="/" replace />
    }
    return children
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={
            <PublicRoute>
              <LoginPage />
            </PublicRoute>
          }
        />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <MainLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="terminal" element={<Terminal />} />
          <Route path="docker" element={<DockerPanel />} />
          <Route path="domains" element={<DomainsPanel />} />
          <Route path="files" element={<FileManager />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
