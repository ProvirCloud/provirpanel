import { Outlet, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import Navbar from '../components/Navbar.jsx'
import Sidebar from '../components/Sidebar.jsx'
import api from '../services/api.js'

const MainLayout = () => {
  const navigate = useNavigate()
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
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

  const handleLogout = () => {
    localStorage.removeItem('token')
    window.dispatchEvent(new Event('cloudpainel-auth'))
    navigate('/login')
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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.18),_transparent_55%)]">
      <Navbar
        onLogout={handleLogout}
        onChangePassword={() => setShowPasswordModal(true)}
        onCreateUser={() => setShowCreateModal(true)}
        username={username}
      />
      <div className="flex">
        <Sidebar />
        <main className="flex-1 px-6 py-8">
          <Outlet />
        </main>
      </div>

      {(showPasswordModal || showCreateModal) && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/90 p-6 text-slate-100">
            {showPasswordModal && (
              <>
                <h3 className="text-lg font-semibold">Alterar senha</h3>
                <form className="mt-4 space-y-3" onSubmit={submitPassword}>
                  <input
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-sm"
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
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-sm"
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
                    <button className="rounded-xl bg-blue-500 px-4 py-2 text-xs font-semibold text-slate-950">
                      Salvar
                    </button>
                    <button
                      type="button"
                      className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-xs text-slate-200"
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
                <h3 className="text-lg font-semibold">Criar usuario</h3>
                <form className="mt-4 space-y-3" onSubmit={submitCreateUser}>
                  <input
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-sm"
                    placeholder="Usuario"
                    value={createForm.username}
                    onChange={(event) =>
                      setCreateForm((prev) => ({ ...prev, username: event.target.value }))
                    }
                  />
                  <input
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-sm"
                    type="password"
                    placeholder="Senha"
                    value={createForm.password}
                    onChange={(event) =>
                      setCreateForm((prev) => ({ ...prev, password: event.target.value }))
                    }
                  />
                  <select
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-sm"
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
                    <button className="rounded-xl bg-blue-500 px-4 py-2 text-xs font-semibold text-slate-950">
                      Criar
                    </button>
                    <button
                      type="button"
                      className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-xs text-slate-200"
                      onClick={() => setShowCreateModal(false)}
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {message && (
        <div className="fixed right-6 top-24 rounded-xl border border-blue-500/40 bg-blue-500/10 px-4 py-3 text-xs text-blue-200">
          {message}
        </div>
      )}
    </div>
  )
}

export default MainLayout
