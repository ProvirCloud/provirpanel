import { useState, useEffect, useCallback } from 'react'
import { Server, Plus, RefreshCw, Trash2, Globe, CheckCircle2, AlertCircle, Clock, Loader2, Database } from 'lucide-react'
import api from '../services/api'
import SectionContainer from './ui/SectionContainer'

const statusConfig = {
  active: { label: 'Ativo', color: 'text-emerald-400', bg: 'bg-emerald-400/10', icon: CheckCircle2 },
  pending: { label: 'Pendente', color: 'text-amber-400', bg: 'bg-amber-400/10', icon: Clock },
  error: { label: 'Erro', color: 'text-red-400', bg: 'bg-red-400/10', icon: AlertCircle },
}

const ZeusPanels = () => {
  const [panels, setPanels] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [syncing, setSyncing] = useState(null)
  const [form, setForm] = useState({ name: '', url: '', description: '', contact: '' })

  const loadPanels = useCallback(async () => {
    try {
      const res = await api.get('/zeus/panels')
      setPanels(res.data.panels || [])
    } catch (err) {
      console.error('Failed to load panels:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadPanels() }, [loadPanels])

  const registerPanel = async (e) => {
    e.preventDefault()
    if (!form.name || !form.url) return
    try {
      await api.post('/zeus/panels/register', form)
      setForm({ name: '', url: '', description: '', contact: '' })
      setShowForm(false)
      loadPanels()
    } catch (err) {
      alert(err.response?.data?.error || err.message)
    }
  }

  const syncPanel = async (id) => {
    setSyncing(id)
    try {
      await api.post(`/zeus/panels/${id}/sync`)
      loadPanels()
    } catch (err) {
      alert(`Sync falhou: ${err.response?.data?.error || err.message}`)
    } finally {
      setSyncing(null)
    }
  }

  const deletePanel = async (id, name) => {
    if (!confirm(`Remover painel "${name}"?`)) return
    try {
      await api.delete(`/zeus/panels/${id}`)
      loadPanels()
    } catch (err) {
      alert(err.response?.data?.error || err.message)
    }
  }

  const indexPanel = async (id) => {
    setSyncing(id)
    try {
      const res = await api.post(`/zeus/panels/${id}/index`)
      alert(`Indexado: ${res.data.indexed}/${res.data.total} sites`)
      loadPanels()
    } catch (err) {
      alert(`Index falhou: ${err.response?.data?.error || err.message}`)
    } finally {
      setSyncing(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-[var(--color-text-muted)]" size={24} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <SectionContainer
        title="Painéis Conectados"
        subtitle="Gerencie os painéis de clientes integrados ao hub central de IA"
        actions={
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
          >
            <Plus size={14} />
            Registrar Painel
          </button>
        }
      >
        {/* Register Form */}
        {showForm && (
          <form onSubmit={registerPanel} className="mb-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <input
                type="text"
                placeholder="Nome do painel"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none focus:border-indigo-500"
                required
              />
              <input
                type="url"
                placeholder="URL do painel (https://...)"
                value={form.url}
                onChange={e => setForm({ ...form, url: e.target.value })}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none focus:border-indigo-500"
                required
              />
              <input
                type="text"
                placeholder="Descrição (opcional)"
                value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none focus:border-indigo-500"
              />
              <input
                type="text"
                placeholder="Contato responsável (opcional)"
                value={form.contact}
                onChange={e => setForm({ ...form, contact: e.target.value })}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none focus:border-indigo-500"
              />
            </div>
            <div className="flex gap-2">
              <button type="submit" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
                Registrar
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)]">
                Cancelar
              </button>
            </div>
          </form>
        )}

        {/* Panels List */}
        {panels.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Server size={40} className="mb-3 text-[var(--color-text-muted)] opacity-40" />
            <p className="text-sm text-[var(--color-text-muted)]">Nenhum painel conectado</p>
            <p className="mt-1 text-xs text-[var(--color-text-muted)] opacity-60">Registre um painel para começar a integração</p>
          </div>
        ) : (
          <div className="space-y-3">
            {panels.map(panel => {
              const status = statusConfig[panel.status] || statusConfig.pending
              const StatusIcon = status.icon
              return (
                <div key={panel.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-4 transition-colors hover:border-[var(--color-border-hover)]">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10">
                        <Server size={18} className="text-indigo-400" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold text-[var(--color-text)] truncate">{panel.name}</h3>
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${status.bg} ${status.color}`}>
                            <StatusIcon size={10} />
                            {status.label}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                          <Globe size={11} />
                          <span className="truncate">{panel.url}</span>
                        </div>
                        {panel.description && (
                          <p className="mt-1 text-xs text-[var(--color-text-muted)] opacity-70">{panel.description}</p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-[var(--color-text-muted)]">
                          <span>{panel.sitesCount} sites</span>
                          {panel.lastSyncAt && <span>Sync: {new Date(panel.lastSyncAt).toLocaleString('pt-BR')}</span>}
                          {panel.contact && <span>Contato: {panel.contact}</span>}
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => syncPanel(panel.id)}
                        disabled={syncing === panel.id}
                        className="rounded-lg p-2 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text)] disabled:opacity-40"
                        title="Sincronizar sites"
                      >
                        <RefreshCw size={14} className={syncing === panel.id ? 'animate-spin' : ''} />
                      </button>
                      <button
                        onClick={() => indexPanel(panel.id)}
                        disabled={syncing === panel.id}
                        className="rounded-lg p-2 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text)] disabled:opacity-40"
                        title="Indexar no Zeus AI"
                      >
                        <Database size={14} />
                      </button>
                      <button
                        onClick={() => deletePanel(panel.id, panel.name)}
                        className="rounded-lg p-2 text-[var(--color-text-muted)] transition-colors hover:bg-red-500/10 hover:text-red-400"
                        title="Remover painel"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </SectionContainer>
    </div>
  )
}

export default ZeusPanels
