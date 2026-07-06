import { useEffect, useState } from 'react'
import { Plus, Trash2, Database, CheckCircle, XCircle, Loader2, Sparkles, PlugZap } from 'lucide-react'
import api from '../services/api.js'

const TYPES = [
  { value: 'postgres', label: 'PostgreSQL', defaultPort: 5432 },
  { value: 'mysql', label: 'MySQL', defaultPort: 3306 },
  { value: 'mongodb', label: 'MongoDB', defaultPort: 27017 },
]

const emptyForm = { name: '', type: 'postgres', host: '', port: 5432, user: '', password: '', database: '', projects: [] }

const DatabaseConnectionsPanel = () => {
  const [connections, setConnections] = useState([])
  const [form, setForm] = useState(null)
  const [loading, setLoading] = useState('')
  const [message, setMessage] = useState(null)
  const [services, setServices] = useState([])

  const load = async () => {
    const { data } = await api.get('/database-connections')
    setConnections(data)
  }

  useEffect(() => {
    load()
    api.get('/docker/services').then(r => setServices(r.data.services || []))
  }, [])

  const addProject = (id, name) => {
    if (!id || form.projects.some(p => p.id === id)) return
    setForm(f => ({ ...f, projects: [...f.projects, { id, name, type: 'backend' }] }))
  }
  const removeProject = (id) => setForm(f => ({ ...f, projects: f.projects.filter(p => p.id !== id) }))
  const setProjectType = (id, type) => setForm(f => ({ ...f, projects: f.projects.map(p => p.id === id ? { ...p, type } : p) }))

  const flash = (text, type = 'info') => { setMessage({ text, type }); setTimeout(() => setMessage(null), 4000) }

  const handleSave = async () => {
    setLoading('save')
    try {
      await api.post('/database-connections', form)
      flash('Conexão salva', 'success')
      setForm(null)
      load()
    } catch (e) { flash(e.response?.data?.error || 'Erro ao salvar', 'error') }
    finally { setLoading('') }
  }

  const handleDelete = async (id) => {
    if (!confirm('Remover conexão?')) return
    await api.delete(`/database-connections/${id}`)
    load()
  }

  const handleTest = async (id) => {
    setLoading(`test-${id}`)
    try {
      const { data } = await api.post(`/database-connections/${id}/test`)
      flash(data.success ? 'Conexão OK ✓' : `Falha: ${data.error}`, data.success ? 'success' : 'error')
    } catch (e) { flash('Erro ao testar', 'error') }
    finally { setLoading('') }
  }

  const handleIndex = async (id) => {
    setLoading(`index-${id}`)
    try {
      const { data } = await api.post(`/database-connections/${id}/index`)
      flash(data.success ? `Schema indexado: ${data.indexed} tabelas → ${data.collection}` : `Falha: ${data.error}`, data.success ? 'success' : 'error')
    } catch (e) { flash(e.response?.data?.error || 'Erro ao indexar', 'error') }
    finally { setLoading('') }
  }

  const fieldClass = 'bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-3 py-2 text-sm text-[var(--color-text-primary)]'
  const btnClass = 'px-3 py-1.5 rounded text-xs font-medium transition-colors'

  return (
    <div className="space-y-4">
      {message && (
        <div className={`px-4 py-2 rounded text-sm ${message.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : message.type === 'error' ? 'bg-red-500/10 text-red-400 border border-red-500/30' : 'bg-blue-500/10 text-blue-400 border border-blue-500/30'}`}>
          {message.text}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-[var(--color-text-primary)]">Conexões ({connections.length})</h3>
        <button onClick={() => setForm({ ...emptyForm })} className={`${btnClass} bg-[var(--color-accent)] text-white flex items-center gap-1`}>
          <Plus className="h-3 w-3" /> Nova Conexão
        </button>
      </div>

      {form && (
        <div className="border border-[var(--color-border)] rounded-lg p-4 space-y-3 bg-[var(--color-bg-secondary)]">
          <div className="grid grid-cols-2 gap-3">
            <input className={fieldClass} placeholder="Nome" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <select className={fieldClass} value={form.type} onChange={e => { const t = TYPES.find(t => t.value === e.target.value); setForm(f => ({ ...f, type: e.target.value, port: t?.defaultPort || f.port })) }}>
              {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <input className={fieldClass} placeholder="Host" value={form.host} onChange={e => setForm(f => ({ ...f, host: e.target.value }))} />
            <input className={fieldClass} type="number" placeholder="Porta" value={form.port} onChange={e => setForm(f => ({ ...f, port: e.target.value }))} />
            <input className={fieldClass} placeholder="Usuário" value={form.user} onChange={e => setForm(f => ({ ...f, user: e.target.value }))} />
            <input className={fieldClass} type="password" placeholder="Senha" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
            <input className={fieldClass} placeholder="Database" value={form.database} onChange={e => setForm(f => ({ ...f, database: e.target.value }))} />
            <select className={fieldClass} value="" onChange={e => { const s = services.find(s => s.id === e.target.value); if (s) addProject(s.id, s.name) }}>
              <option value="">+ Vincular projeto</option>
              {services.filter(s => !form.projects.some(p => p.id === s.id)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          {form.projects.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {form.projects.map(p => (
                <div key={p.id} className="flex items-center gap-1 border border-[var(--color-border)] rounded px-2 py-1 text-xs bg-[var(--color-bg-primary)]">
                  <span className="text-[var(--color-text-primary)]">{p.name}</span>
                  <select className="bg-transparent text-[var(--color-accent)] text-xs border-none outline-none" value={p.type} onChange={e => setProjectType(p.id, e.target.value)}>
                    <option value="backend">backend</option>
                    <option value="frontend">frontend</option>
                  </select>
                  <button onClick={() => removeProject(p.id)} className="text-red-400 hover:text-red-300 ml-1">&times;</button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setForm(null)} className={`${btnClass} border border-[var(--color-border)] text-[var(--color-text-muted)]`}>Cancelar</button>
            <button onClick={handleSave} disabled={loading === 'save' || !form.name || !form.host || !form.user || !form.password || !form.database} className={`${btnClass} bg-[var(--color-accent)] text-white disabled:opacity-50`}>
              {loading === 'save' ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Salvar'}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {connections.map(conn => (
          <div key={conn.id} className="flex items-center justify-between border border-[var(--color-border)] rounded-lg px-4 py-3 bg-[var(--color-bg-secondary)]">
            <div className="flex items-center gap-3">
              <Database className="h-4 w-4 text-[var(--color-accent)]" />
              <div>
                <span className="text-sm font-medium text-[var(--color-text-primary)]">{conn.name}</span>
                <span className="ml-2 text-xs text-[var(--color-text-muted)]">{conn.type} · {conn.host}:{conn.port}/{conn.database}</span>
                {conn.projects?.length > 0 && (
                  <span className="ml-2 text-xs text-purple-400">{conn.projects.map(p => `${p.name} (${p.type})`).join(', ')}</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => handleTest(conn.id)} disabled={!!loading} className={`${btnClass} border border-[var(--color-border)] text-[var(--color-text-muted)] flex items-center gap-1`}>
                {loading === `test-${conn.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlugZap className="h-3 w-3" />} Testar
              </button>
              <button onClick={() => handleIndex(conn.id)} disabled={!!loading} className={`${btnClass} border border-purple-500/30 text-purple-400 flex items-center gap-1`}>
                {loading === `index-${conn.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} Indexar
              </button>
              <button onClick={() => handleDelete(conn.id)} className={`${btnClass} text-red-400 hover:text-red-300`}>
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>
        ))}
        {!connections.length && !form && (
          <p className="text-sm text-[var(--color-text-muted)] text-center py-8">Nenhuma conexão cadastrada</p>
        )}
      </div>
    </div>
  )
}

export default DatabaseConnectionsPanel
