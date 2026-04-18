import { useState, useEffect } from 'react'
import { UserPlus, Edit, Trash2, Shield, User } from 'lucide-react'
import api from '../services/api.js'

const UsersPanel = ({ showPageIntro = true }) => {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editUser, setEditUser] = useState(null)
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    role: 'viewer',
    mfaRequired: false
  })

  const loadUsers = async () => {
    try {
      const response = await api.get('/auth/users')
      setUsers(response.data.users || [])
    } catch (error) {
      console.error('Erro ao carregar usuários:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadUsers()
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      if (editUser) {
        await api.put(`/auth/users/${editUser.id}`, formData)
      } else {
        await api.post('/auth/users', formData)
      }
      loadUsers()
      setShowModal(false)
      setEditUser(null)
      setFormData({ username: '', password: '', role: 'viewer', mfaRequired: false })
    } catch (error) {
      console.error('Erro ao salvar usuário:', error)
    }
  }

  const handleDelete = async (userId) => {
    if (!confirm('Tem certeza que deseja excluir este usuário?')) return
    try {
      await api.delete(`/auth/users/${userId}`)
      loadUsers()
    } catch (error) {
      console.error('Erro ao excluir usuário:', error)
    }
  }

  const openModal = (user = null) => {
    setEditUser(user)
    setFormData(user ? { 
      username: user.username, 
      password: '', 
      role: user.role,
      mfaRequired: !!user.mfa_required
    } : { username: '', password: '', role: 'viewer', mfaRequired: false })
    setShowModal(true)
  }

  const getRoleIcon = (role) => {
    switch (role) {
      case 'admin': return <Shield className="h-4 w-4 text-red-400" />
      case 'dev': return <User className="h-4 w-4 text-blue-400" />
      default: return <User className="h-4 w-4 text-slate-400" />
    }
  }

  const getRoleLabel = (role) => {
    switch (role) {
      case 'admin': return 'Administrador'
      case 'dev': return 'Desenvolvedor'
      default: return 'Visualizador'
    }
  }

  return (
    <div className="space-y-6">
      <div className={`flex flex-wrap gap-3 ${showPageIntro ? 'items-center justify-between' : 'items-center justify-end'}`}>
        {showPageIntro ? (
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Usuários</p>
            <h2 className="text-2xl font-semibold text-white">Gestão de usuários</h2>
          </div>
        ) : null}
        <button
          onClick={() => openModal()}
          className="flex items-center gap-2 rounded-xl bg-blue-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-blue-400"
        >
          <UserPlus className="h-4 w-4" />
          Novo usuário
        </button>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden">
        <table className="w-full text-left text-sm text-slate-200">
          <thead className="bg-slate-950 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-6 py-4">Usuário</th>
              <th className="px-6 py-4">Função</th>
              <th className="px-6 py-4">Criado em</th>
              <th className="px-6 py-4">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-slate-400">
                  Carregando usuários...
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-slate-400">
                  Nenhum usuário encontrado
                </td>
              </tr>
            ) : (
              users.map((user) => (
                <tr key={user.id} className="border-t border-slate-800 hover:bg-slate-900/40">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-slate-700 flex items-center justify-center">
                        <User className="h-4 w-4 text-slate-300" />
                      </div>
                      <span className="font-medium">{user.username}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      {getRoleIcon(user.role)}
                      <span>{getRoleLabel(user.role)}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-slate-400">
                    {new Date(user.created_at).toLocaleDateString('pt-BR')}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex gap-2">
                      <button
                        onClick={() => openModal(user)}
                        className="rounded-lg border border-slate-800 bg-slate-950 p-2 text-slate-200 transition hover:text-blue-300"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(user.id)}
                        className="rounded-lg border border-slate-800 bg-slate-950 p-2 text-slate-200 transition hover:text-rose-300"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-white mb-4">
              {editUser ? 'Editar usuário' : 'Novo usuário'}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-slate-300 mb-2">Nome de usuário</label>
                <input
                  type="text"
                  required
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-2">
                  {editUser ? 'Nova senha (deixe vazio para manter)' : 'Senha'}
                </label>
                <input
                  type="password"
                  required={!editUser}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-2">Função</label>
                <select
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                >
                  <option value="viewer">Visualizador</option>
                  <option value="dev">Desenvolvedor</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={formData.mfaRequired}
                  onChange={(e) => setFormData({ ...formData, mfaRequired: e.target.checked })}
                />
                Exigir MFA no primeiro login
              </label>
              <div className="flex gap-2 pt-4">
                <button
                  type="submit"
                  className="flex-1 rounded-xl bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600"
                >
                  {editUser ? 'Salvar' : 'Criar'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default UsersPanel
