import { Outlet, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import Navbar from '../components/Navbar.jsx'
import Sidebar from '../components/Sidebar.jsx'
import api from '../services/api.js'

const MainLayout = () => {
  const navigate = useNavigate()
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showMfaModal, setShowMfaModal] = useState(false)
  const [mfaEnabled, setMfaEnabled] = useState(false)
  const [mfaSetup, setMfaSetup] = useState(null)
  const [mfaCode, setMfaCode] = useState('')
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: ''
  })
  const [createForm, setCreateForm] = useState({
    username: '',
    password: '',
    role: 'dev'
  })
  const [message, setMessage] = useState('')
  const [username, setUsername] = useState('admin')

  useEffect(() => {
    api
      .get('/auth/me')
      .then((response) => {
        if (response.data?.user?.username) {
          setUsername(response.data.user.username)
        }
      })
      .catch(() => {
        setUsername('admin')
      })
  }, [])

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout')
    } catch (err) {
      // ignore
    }
    try {
      localStorage.clear()
      sessionStorage.clear()
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map((key) => caches.delete(key)))
      }
    } catch (err) {
      // ignore cache cleanup failures
    }
    window.dispatchEvent(new CustomEvent('provirpanel-auth', {
      detail: { authenticated: false }
    }))
    navigate('/login', { replace: true })
  }

  const openMfaModal = async () => {
    setMessage('')
    setShowMfaModal(true)
    setMfaSetup(null)
    setMfaCode('')
    try {
      const response = await api.get('/auth/mfa/status')
      setMfaEnabled(!!response.data?.enabled)
    } catch (err) {
      setMessage('Erro ao carregar status MFA')
    }
  }

  const submitPassword = async (event) => {
    event.preventDefault()
    setMessage('')
    try {
      await api.post('/auth/change-password', passwordForm)
      setMessage('Senha atualizada')
      setShowPasswordModal(false)
      setPasswordForm({ currentPassword: '', newPassword: '' })
    } catch (err) {
      setMessage('Erro ao atualizar senha')
    }
  }

  const submitCreateUser = async (event) => {
    event.preventDefault()
    setMessage('')
    try {
      await api.post('/auth/users', createForm)
      setMessage('Usuario criado')
      setShowCreateModal(false)
      setCreateForm({ username: '', password: '', role: 'dev' })
    } catch (err) {
      setMessage('Erro ao criar usuario')
    }
  }

  return (
    <div className="zeus-shell px-4 py-4 lg:px-5">
      <Navbar
        onLogout={handleLogout}
        onChangePassword={() => setShowPasswordModal(true)}
        onCreateUser={() => setShowCreateModal(true)}
        onManageMfa={openMfaModal}
        username={username}
      />
      <div className="mt-4 flex gap-4">
        <Sidebar />
        <main className="min-w-0 flex-1 pb-8">
          <Outlet />
        </main>
      </div>

      {(showPasswordModal || showCreateModal || showMfaModal) && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="zeus-panel w-full max-w-md rounded-[1.8rem] p-6 text-slate-800">
            {showPasswordModal && (
              <>
                <h3 className="text-lg font-semibold text-slate-900">Alterar senha</h3>
                <form className="mt-4 space-y-3" onSubmit={submitPassword}>
                  <input
                    className="w-full rounded-2xl border border-blue-100 bg-white px-4 py-3 text-sm text-slate-900"
                    type="password"
                    placeholder="Senha atual"
                    value={passwordForm.currentPassword}
                    onChange={(event) =>
                      setPasswordForm((prev) => ({
                        ...prev,
                        currentPassword: event.target.value
                      }))
                    }
                  />
                  <input
                    className="w-full rounded-2xl border border-blue-100 bg-white px-4 py-3 text-sm text-slate-900"
                    type="password"
                    placeholder="Nova senha"
                    value={passwordForm.newPassword}
                    onChange={(event) =>
                      setPasswordForm((prev) => ({
                        ...prev,
                        newPassword: event.target.value
                      }))
                    }
                  />
                  <div className="flex gap-2">
                    <button className="rounded-2xl bg-[linear-gradient(135deg,_#16366f,_#3b82f6)] px-4 py-2.5 text-xs font-semibold text-white">
                      Salvar
                    </button>
                    <button
                      type="button"
                      className="rounded-2xl border border-blue-100 bg-white px-4 py-2.5 text-xs text-slate-700"
                      onClick={() => setShowPasswordModal(false)}
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              </>
            )}

            {showCreateModal && (
              <>
                <h3 className="text-lg font-semibold text-slate-900">Criar usuario</h3>
                <form className="mt-4 space-y-3" onSubmit={submitCreateUser}>
                  <input
                    className="w-full rounded-2xl border border-blue-100 bg-white px-4 py-3 text-sm text-slate-900"
                    placeholder="Usuario"
                    value={createForm.username}
                    onChange={(event) =>
                      setCreateForm((prev) => ({ ...prev, username: event.target.value }))
                    }
                  />
                  <input
                    className="w-full rounded-2xl border border-blue-100 bg-white px-4 py-3 text-sm text-slate-900"
                    type="password"
                    placeholder="Senha"
                    value={createForm.password}
                    onChange={(event) =>
                      setCreateForm((prev) => ({ ...prev, password: event.target.value }))
                    }
                  />
                  <select
                    className="w-full rounded-2xl border border-blue-100 bg-white px-4 py-3 text-sm text-slate-900"
                    value={createForm.role}
                    onChange={(event) =>
                      setCreateForm((prev) => ({ ...prev, role: event.target.value }))
                    }
                  >
                    <option value="admin">Admin</option>
                    <option value="dev">Dev</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <div className="flex gap-2">
                    <button className="rounded-2xl bg-[linear-gradient(135deg,_#16366f,_#3b82f6)] px-4 py-2.5 text-xs font-semibold text-white">
                      Criar
                    </button>
                    <button
                      type="button"
                      className="rounded-2xl border border-blue-100 bg-white px-4 py-2.5 text-xs text-slate-700"
                      onClick={() => setShowCreateModal(false)}
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              </>
            )}

            {showMfaModal && (
              <>
                <h3 className="text-lg font-semibold text-slate-900">MFA (Authenticator)</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Conecte seu aplicativo (Google/Microsoft Authenticator) para proteger a conta.
                </p>
                {mfaEnabled ? (
                  <div className="mt-4 space-y-3">
                    <p className="text-sm text-emerald-300">MFA ativo</p>
                    <input
                      className="w-full rounded-2xl border border-blue-100 bg-white px-4 py-3 text-sm text-slate-900"
                      placeholder="Codigo MFA"
                      value={mfaCode}
                      onChange={(event) => setMfaCode(event.target.value)}
                    />
                    <div className="flex gap-2">
                      <button
                        className="rounded-2xl bg-rose-500 px-4 py-2.5 text-xs font-semibold text-white"
                        onClick={async () => {
                          setMessage('')
                          try {
                            await api.post('/auth/mfa/disable', { token: mfaCode })
                            setMfaEnabled(false)
                            setMfaCode('')
                            setMessage('MFA desativado')
                          } catch (err) {
                            setMessage('Erro ao desativar MFA')
                          }
                        }}
                      >
                        Desativar MFA
                      </button>
                      <button
                        type="button"
                        className="rounded-2xl border border-blue-100 bg-white px-4 py-2.5 text-xs text-slate-700"
                        onClick={() => setShowMfaModal(false)}
                      >
                        Fechar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 space-y-3">
                    {!mfaSetup && (
                      <button
                        className="rounded-2xl bg-[linear-gradient(135deg,_#16366f,_#3b82f6)] px-4 py-2.5 text-xs font-semibold text-white"
                        onClick={async () => {
                          setMessage('')
                          try {
                            const response = await api.post('/auth/mfa/setup')
                            setMfaSetup(response.data)
                          } catch (err) {
                            setMessage('Erro ao iniciar MFA')
                          }
                        }}
                      >
                        Gerar QR Code
                      </button>
                    )}
                    {mfaSetup && (
                      <div className="space-y-3">
                        {mfaSetup.qr && (
                          <img src={mfaSetup.qr} alt="QR Code MFA" className="mx-auto h-40 w-40 rounded-xl bg-white p-2" />
                        )}
                        <div className="rounded-2xl border border-blue-100 bg-white px-3 py-3 text-xs text-slate-700">
                          Codigo manual: <span className="font-mono text-emerald-300">{mfaSetup.secret}</span>
                        </div>
                        <input
                          className="w-full rounded-2xl border border-blue-100 bg-white px-4 py-3 text-sm text-slate-900"
                          placeholder="Codigo MFA"
                          value={mfaCode}
                          onChange={(event) => setMfaCode(event.target.value)}
                        />
                        <div className="flex gap-2">
                          <button
                            className="rounded-2xl bg-emerald-500 px-4 py-2.5 text-xs font-semibold text-slate-950"
                            onClick={async () => {
                              setMessage('')
                              try {
                                await api.post('/auth/mfa/enable', { token: mfaCode })
                                setMfaEnabled(true)
                                setMfaCode('')
                                setMfaSetup(null)
                                setMessage('MFA ativado')
                              } catch (err) {
                                setMessage('Codigo MFA invalido')
                              }
                            }}
                          >
                            Ativar MFA
                          </button>
                          <button
                            type="button"
                            className="rounded-2xl border border-blue-100 bg-white px-4 py-2.5 text-xs text-slate-700"
                            onClick={() => setShowMfaModal(false)}
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {message && <p className="mt-3 text-xs text-slate-600">{message}</p>}
              </>
            )}
          </div>
        </div>
      )}

      {message && (
        <div className="zeus-panel fixed right-6 top-24 rounded-2xl px-4 py-3 text-xs text-slate-700">
          {message}
        </div>
      )}
    </div>
  )
}

export default MainLayout
