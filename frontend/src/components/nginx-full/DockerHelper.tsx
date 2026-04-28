import { useCallback, useEffect, useState } from 'react'
import { Box, Plus, RefreshCcw, X } from 'lucide-react'
import api from '../../services/api.js'
import type { NginxVisualState } from './nginxVisualConfig'
import { mutateUpstream } from './nginxVisualConfig'

// ─── Types ─────────────────────────────────────────────────────────────────────

type DockerContainer = {
  id: string
  name: string
  ip: string
  port: number
}

type DockerTemplate = {
  id: string
  label: string
}

type CreateForm = {
  templateId: string
  name: string
  hostPort: string
  networkName: string
  bindLocalOnly: boolean
}

const makeServerId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

// ─── Create modal ──────────────────────────────────────────────────────────────

function DockerCreateModal({
  templates,
  form,
  onChange,
  onCreate,
  onCancel,
  loading,
}: {
  templates: DockerTemplate[]
  form: CreateForm
  onChange: (f: CreateForm) => void
  onCreate: () => void
  onCancel: () => void
  loading: boolean
}) {
  const inputCls =
    'h-8 w-full rounded-[10px] border border-white/10 bg-[rgba(8,15,30,0.9)] px-3 text-[13px] text-white placeholder-white/25 outline-none transition focus:border-[#4d85ff]/60 focus:ring-1 focus:ring-[#4d85ff]/20'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-[20px] border border-white/10 bg-[linear-gradient(160deg,rgba(8,16,32,0.99),rgba(6,13,26,0.97))] shadow-[0_32px_100px_rgba(0,0,0,0.7)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-white/6 px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
            Criar container
          </p>
          <p className="mt-1 text-[15px] font-semibold text-white">Novo serviço Docker</p>
        </div>

        <div className="space-y-3 px-5 py-4">
          <div className="space-y-1.5">
            <label className="text-[11px] text-white/45">Template</label>
            <select
              className={inputCls + ' cursor-pointer'}
              value={form.templateId}
              onChange={(e) => onChange({ ...form, templateId: e.target.value })}
            >
              <option value="">Selecione um template</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] text-white/45">Nome do serviço</label>
            <input
              className={inputCls}
              value={form.name}
              onChange={(e) => onChange({ ...form, name: e.target.value })}
              placeholder="meu-servico"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] text-white/45">Porta externa</label>
              <input
                type="number"
                className={inputCls}
                value={form.hostPort}
                onChange={(e) => onChange({ ...form, hostPort: e.target.value })}
                placeholder="8081"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] text-white/45">Rede Docker</label>
              <input
                className={inputCls}
                value={form.networkName}
                onChange={(e) => onChange({ ...form, networkName: e.target.value })}
              />
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-white/65">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded accent-[#3f7bff]"
              checked={form.bindLocalOnly}
              onChange={(e) => onChange({ ...form, bindLocalOnly: e.target.checked })}
            />
            Expor apenas em localhost
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-white/6 px-5 py-3.5">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-[10px] border border-white/10 bg-white/4 px-4 py-2 text-[12px] text-white/60 transition hover:bg-white/8"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onCreate}
            disabled={loading || !form.templateId || !form.name}
            className="rounded-[10px] border border-[#2d4f8f]/80 bg-[linear-gradient(135deg,#1a3a72,#142d58)] px-4 py-2 text-[13px] font-semibold text-white shadow-[0_4px_16px_rgba(30,80,200,0.22)] transition hover:brightness-110 disabled:opacity-50"
          >
            {loading ? 'Criando...' : 'Criar serviço'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main component ─────────────────────────────────────────────────────────────

type Props = {
  state: NginxVisualState
  upstreamId: string
  onChange: (next: NginxVisualState) => void
}

export default function DockerHelper({ state, upstreamId, onChange }: Props) {
  const [containers, setContainers] = useState<DockerContainer[]>([])
  const [templates, setTemplates] = useState<DockerTemplate[]>([])
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState<CreateForm>({
    templateId: '',
    name: '',
    hostPort: '',
    networkName: 'provirpanel',
    bindLocalOnly: true,
  })
  const [creating, setCreating] = useState(false)

  const upstream = state.upstreams.find((u) => u.id === upstreamId)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/nginx/docker-containers')
      setContainers(res.data?.containers || [])
    } catch {
      // Docker may not be available — fail silently
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const loadTemplates = async () => {
    if (templates.length > 0) return
    try {
      const res = await api.get('/docker/templates')
      setTemplates(res.data?.templates || [])
    } catch {
      // ignore
    }
  }

  const openCreate = async () => {
    await loadTemplates()
    setCreateForm({
      templateId: '',
      name: '',
      hostPort: '',
      networkName: 'provirpanel',
      bindLocalOnly: true,
    })
    setShowCreate(true)
  }

  const isInUpstream = (c: DockerContainer) =>
    upstream?.servers.some(
      (s) => s.host === (c.ip || '127.0.0.1') && s.port === c.port,
    ) ?? false

  const addToUpstream = (c: DockerContainer) => {
    onChange(
      mutateUpstream(state, upstreamId, (u) => ({
        ...u,
        servers: [
          ...u.servers,
          { id: `srv-${makeServerId()}`, host: c.ip || '127.0.0.1', port: c.port },
        ],
      })),
    )
  }

  const removeFromUpstream = (c: DockerContainer) => {
    onChange(
      mutateUpstream(state, upstreamId, (u) => ({
        ...u,
        servers: u.servers.filter(
          (s) => !(s.host === (c.ip || '127.0.0.1') && s.port === c.port),
        ),
      })),
    )
  }

  const handleCreate = async () => {
    if (!createForm.templateId || !createForm.name) return
    setCreating(true)
    try {
      const res = await api.post('/docker/services', {
        templateId: createForm.templateId,
        name: createForm.name,
        hostPort: createForm.hostPort || undefined,
        networkName: createForm.networkName || 'provirpanel',
        bindLocalOnly: createForm.bindLocalOnly,
      })
      const service = res.data?.service
      setShowCreate(false)
      await refresh()
      if (service?.hostPort) {
        onChange(
          mutateUpstream(state, upstreamId, (u) => ({
            ...u,
            servers: [
              ...u.servers,
              { id: `srv-${makeServerId()}`, host: '127.0.0.1', port: Number(service.hostPort) },
            ],
          })),
        )
      }
    } catch {
      // surface error via console for now
    } finally {
      setCreating(false)
    }
  }

  const configured = containers.filter(isInUpstream)
  const available = containers.filter((c) => !isInUpstream(c))

  return (
    <>
      <div className="overflow-hidden rounded-[14px] border border-white/6 bg-white/2">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/6 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Box className="h-3.5 w-3.5 text-white/40" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/38">
              Containers Docker
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              title="Atualizar lista"
              className="flex h-6 w-6 items-center justify-center rounded-[7px] border border-white/8 text-white/38 transition hover:bg-white/6 hover:text-white/70 disabled:opacity-40"
            >
              <RefreshCcw className={['h-3 w-3', loading ? 'animate-spin' : ''].join(' ')} />
            </button>
            <button
              type="button"
              onClick={openCreate}
              className="flex items-center gap-1 rounded-[7px] border border-[#2d4f8f]/60 bg-[rgba(26,58,114,0.35)] px-2 py-1 text-[11px] font-medium text-[#7ab0ff] transition hover:brightness-110"
            >
              <Plus className="h-3 w-3" />
              Criar
            </button>
          </div>
        </div>

        {loading && containers.length === 0 && (
          <p className="px-4 py-3 text-[12px] text-white/30">Carregando containers...</p>
        )}

        {!loading && containers.length === 0 && (
          <p className="px-4 py-3 text-[12px] text-white/30">Nenhum container em execução.</p>
        )}

        {/* Configured */}
        {configured.length > 0 && (
          <div>
            <p className="px-4 py-2 text-[11px] text-white/30">No upstream</p>
            {configured.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between border-t border-white/5 px-4 py-2.5"
              >
                <div>
                  <p className="text-[12px] font-medium text-[#86efac]">{c.name}</p>
                  <p className="font-mono text-[11px] text-white/38">
                    {c.ip}:{c.port}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeFromUpstream(c)}
                  className="flex items-center gap-1 rounded-[7px] border border-[#7f1d3a]/50 bg-[#3d0e1c]/50 px-2 py-1 text-[11px] text-[#f87171] transition hover:bg-[#7f1d3a]/30"
                >
                  <X className="h-3 w-3" />
                  Remover
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Available */}
        {available.length > 0 && (
          <div>
            <p
              className={[
                'px-4 py-2 text-[11px] text-white/30',
                configured.length > 0 ? 'border-t border-white/5' : '',
              ].join(' ')}
            >
              Disponíveis
            </p>
            {available.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between border-t border-white/5 px-4 py-2.5"
              >
                <div>
                  <p className="text-[12px] font-medium text-white/72">{c.name}</p>
                  <p className="font-mono text-[11px] text-white/38">
                    {c.ip}:{c.port}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => addToUpstream(c)}
                  className="flex items-center gap-1 rounded-[7px] border border-[#2d4f8f]/60 bg-[rgba(26,58,114,0.35)] px-2 py-1 text-[11px] font-medium text-[#7ab0ff] transition hover:brightness-110"
                >
                  <Plus className="h-3 w-3" />
                  Usar
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <DockerCreateModal
          templates={templates}
          form={createForm}
          onChange={setCreateForm}
          onCreate={handleCreate}
          onCancel={() => setShowCreate(false)}
          loading={creating}
        />
      )}
    </>
  )
}
