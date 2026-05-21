import { useState } from 'react'
import { ArrowRight, Check, ChevronLeft, ChevronRight, Lock, Plus, Trash2, X } from 'lucide-react'
import api from '../../services/api.js'
import type { BuildForm, DockerContainer, NginxSite, NginxTarget } from '../../types/nginx'
import { buildNginxConfig } from '../../types/nginx'
import Button from '../ui/Button'

type SiteModalProps = {
  site: NginxSite | null
  dockerContainers: DockerContainer[]
  onClose: () => void
  onSave: () => void
}

type FormLocation = {
  path: string
  proxyHost: string
  proxyPort: string
  root: string
  tryFiles: string
}

type StaticLocation = {
  path: string
  tryFiles: string
}

type ModalForm = {
  // Step 1
  filename: string
  serverNames: string
  listenPort: string
  // Step 2
  type: NginxSite['type']
  locations: FormLocation[]
  upstreamName: string
  upstreamMethod: NginxSite['upstreamMethod']
  targets: NginxTarget[]
  rootPath: string
  indexFiles: string
  staticLocations: StaticLocation[]
  // Step 3
  websocket: boolean
  forwardHeaders: boolean
  cacheBypass: boolean
  clientBodySize: string
  connectTimeout: string
  readTimeout: string
  sendTimeout: string
  // Step 4
  sslEnabled: boolean
  sslCertPath: string
  sslKeyPath: string
}

const STEPS = ['Identificação', 'Roteamento', 'Proxy', 'SSL']

const Label = ({ children, hint }: { children: React.ReactNode; hint?: string }) => (
  <div className="mb-1.5">
    <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
      {children}
    </span>
    {hint && (
      <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
        {hint}
      </p>
    )}
  </div>
)

const ToggleRow = ({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
}) => (
  <label
    className="flex items-start gap-3 cursor-pointer rounded-xl p-3 transition-all"
    style={{
      background: checked ? 'var(--color-brand-soft)' : 'var(--color-canvas-subtle)',
      border: `1px solid ${checked ? 'color-mix(in srgb, var(--color-brand) 28%, transparent)' : 'var(--color-border-subtle)'}`,
    }}
  >
    <input
      type="checkbox"
      className="mt-0.5 h-4 w-4 flex-shrink-0"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
    <div>
      <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
        {label}
      </p>
      {hint && (
        <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
          {hint}
        </p>
      )}
    </div>
  </label>
)

const TimeoutField = ({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) => (
  <div>
    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>
      {label}
    </label>
    <input
      className="zeus-input"
      placeholder="60s"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  </div>
)

const initForm = (site: NginxSite | null): ModalForm => ({
  filename: site?.name || '',
  serverNames: site?.serverNames.join(' ') || '',
  listenPort: site?.listenPort || '80',
  type: site?.type || 'proxy',
  locations: (() => {
    // For proxy type, only keep locations that actually proxy — mixed configs may have
    // alias/static locations alongside proxy ones; those belong to a different domain.
    const raw = site?.locations || []
    const locs = site?.type === 'proxy' ? raw.filter((l) => l.proxyHost) : raw
    return locs.length
      ? locs.map((l) => ({ path: l.path, proxyHost: l.proxyHost, proxyPort: l.proxyPort, root: l.root, tryFiles: l.tryFiles }))
      : [{ path: '/', proxyHost: 'localhost', proxyPort: '3000', root: '', tryFiles: '' }]
  })(),
  upstreamName: site?.upstreamName || 'app_backend',
  upstreamMethod: site?.upstreamMethod || '',
  targets: site?.targets?.length
    ? site.targets
    : [{ host: '127.0.0.1', port: '3000', weight: '1', backup: false }],
  rootPath: site?.rootPath || '/var/www/html',
  indexFiles: site?.indexFiles || 'index.html',
  staticLocations:
    site?.type === 'static' && site?.locations?.length
      ? site.locations.map((l) => ({ path: l.path, tryFiles: l.tryFiles }))
      : [{ path: '/', tryFiles: '$uri $uri/ =404' }],
  websocket: site?.proxySettings?.websocket ?? true,
  forwardHeaders: site?.proxySettings?.forwardHeaders ?? true,
  cacheBypass: site?.proxySettings?.cacheBypass ?? false,
  clientBodySize: site?.proxySettings?.clientBodySize || '',
  connectTimeout: site?.proxySettings?.connectTimeout || '',
  readTimeout: site?.proxySettings?.readTimeout || '',
  sendTimeout: site?.proxySettings?.sendTimeout || '',
  sslEnabled: site?.sslEnabled || false,
  sslCertPath: site?.sslCertPath || '',
  sslKeyPath: site?.sslKeyPath || '',
})

const SiteModal = ({ site, dockerContainers, onClose, onSave }: SiteModalProps) => {
  const isEdit = site !== null
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState<ModalForm>(() => initForm(site))

  const set = <K extends keyof ModalForm>(field: K, value: ModalForm[K]) =>
    setForm((prev) => ({ ...prev, [field]: value }))

  // ── Location helpers ──────────────────────────────────────────────────────
  const addLocation = () =>
    setForm((prev) => ({
      ...prev,
      locations: [...prev.locations, { path: '/nova-rota', proxyHost: 'localhost', proxyPort: '3000', root: '', tryFiles: '' }],
    }))

  const updateLocation = (i: number, field: keyof FormLocation, value: string) =>
    setForm((prev) => ({
      ...prev,
      locations: prev.locations.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)),
    }))

  const removeLocation = (i: number) =>
    setForm((prev) => ({ ...prev, locations: prev.locations.filter((_, idx) => idx !== i) }))

  // ── Target helpers ────────────────────────────────────────────────────────
  const addTarget = () =>
    setForm((prev) => ({
      ...prev,
      targets: [...prev.targets, { host: '127.0.0.1', port: '3000', weight: '1', backup: false }],
    }))

  const updateTarget = (i: number, field: keyof NginxTarget, value: string | boolean) =>
    setForm((prev) => ({
      ...prev,
      targets: prev.targets.map((t, idx) => (idx === i ? { ...t, [field]: value } : t)),
    }))

  const removeTarget = (i: number) =>
    setForm((prev) => ({ ...prev, targets: prev.targets.filter((_, idx) => idx !== i) }))

  // ── Static location helpers ───────────────────────────────────────────────
  const addStaticLocation = () =>
    setForm((prev) => ({
      ...prev,
      staticLocations: [...prev.staticLocations, { path: '/nova-rota', tryFiles: '$uri $uri/ =404' }],
    }))

  const updateStaticLocation = (i: number, field: keyof StaticLocation, value: string) =>
    setForm((prev) => ({
      ...prev,
      staticLocations: prev.staticLocations.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)),
    }))

  const removeStaticLocation = (i: number) =>
    setForm((prev) => ({ ...prev, staticLocations: prev.staticLocations.filter((_, idx) => idx !== i) }))

  // ── Docker container helpers ──────────────────────────────────────────────
  const useContainer = (c: DockerContainer) => {
    const host = !c.ip || c.ip === '0.0.0.0' || c.ip === '::' ? 'localhost' : c.ip
    const port = String(c.port)
    if (form.type === 'load-balancer') {
      setForm((prev) => ({
        ...prev,
        targets: [...prev.targets, { host, port, weight: '1', backup: false }],
      }))
    } else {
      setForm((prev) => ({
        ...prev,
        locations: prev.locations.map((l, i) =>
          i === 0 ? { ...l, proxyHost: host, proxyPort: port } : l,
        ),
      }))
    }
  }

  const buildFormPayload = (): BuildForm => ({
    serverNames: form.serverNames,
    listenPort: form.listenPort,
    type: form.type,
    locations: form.locations,
    upstreamName: form.upstreamName,
    upstreamMethod: form.upstreamMethod,
    targets: form.targets,
    rootPath: form.rootPath,
    indexFiles: form.indexFiles,
    staticLocations: form.staticLocations,
    proxySettings: {
      websocket: form.websocket,
      forwardHeaders: form.forwardHeaders,
      cacheBypass: form.cacheBypass,
      clientBodySize: form.clientBodySize,
      connectTimeout: form.connectTimeout,
      readTimeout: form.readTimeout,
      sendTimeout: form.sendTimeout,
    },
    sslEnabled: form.sslEnabled,
    sslCertPath: form.sslCertPath,
    sslKeyPath: form.sslKeyPath,
  })

  const handleSave = async () => {
    setError('')
    if (!form.filename.trim()) { setError('Informe o nome do arquivo.'); return }
    if (!form.serverNames.trim()) { setError('Informe ao menos um domínio.'); return }
    setSaving(true)
    try {
      const content = buildNginxConfig(buildFormPayload())
      if (isEdit) {
        await api.put(`/nginx/configs/${site!.name}`, { content })
        await api.post('/nginx/reload')
      } else {
        await api.post('/nginx/configs', { filename: form.filename.trim(), content })
      }
      onSave()
    } catch (err: any) {
      setError(err.response?.data?.error || err.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Step 3 only for proxy/lb ──────────────────────────────────────────────
  const steps = form.type === 'static' ? ['Identificação', 'Roteamento', 'SSL'] : STEPS
  const maxStep = steps.length - 1

  // ── Render ────────────────────────────────────────────────────────────────
  const renderStep = () => {
    const proxyStep = form.type !== 'static' ? 2 : -1
    const sslStep = form.type !== 'static' ? 3 : 2

    // Step 0: Identificação
    if (step === 0) return (
      <div className="space-y-4">
        <div>
          <Label hint="Será salvo em /etc/nginx/sites-available/">Nome do arquivo</Label>
          <input
            className="zeus-input"
            placeholder="meu-site.conf"
            value={form.filename}
            onChange={(e) => set('filename', e.target.value)}
            disabled={isEdit}
          />
        </div>
        <div>
          <Label hint="Separe múltiplos domínios com espaço">Domínio(s)</Label>
          <input
            className="zeus-input"
            placeholder="example.com www.example.com"
            value={form.serverNames}
            onChange={(e) => set('serverNames', e.target.value)}
          />
        </div>
        <div>
          <Label>Porta de escuta</Label>
          <input
            className="zeus-input"
            placeholder="80"
            value={form.listenPort}
            onChange={(e) => set('listenPort', e.target.value)}
          />
        </div>
      </div>
    )

    // Step 1: Roteamento
    if (step === 1) return (
      <div className="space-y-4">
        {/* Type selector */}
        <div>
          <Label>Tipo de roteamento</Label>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { value: 'proxy', label: 'Proxy reverso', desc: 'Encaminha para servidor(es)' },
                { value: 'load-balancer', label: 'Load balancer', desc: 'Distribui entre backends' },
                { value: 'static', label: 'Site estático', desc: 'Serve arquivos do disco' },
              ] as const
            ).map((o) => (
              <button
                key={o.value}
                onClick={() => set('type', o.value)}
                className="flex flex-col items-start gap-1 rounded-xl p-3 text-left transition-all"
                style={{
                  border: form.type === o.value ? '2px solid var(--color-brand)' : '1px solid var(--color-border)',
                  background: form.type === o.value ? 'var(--color-brand-soft)' : 'var(--color-canvas-subtle)',
                }}
              >
                <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  {o.label}
                </span>
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {o.desc}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Proxy locations */}
        {form.type === 'proxy' && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Regras de roteamento (locations)</Label>
              <Button variant="secondary" size="sm" leadingIcon={<Plus size={13} />} onClick={addLocation}>
                Adicionar
              </Button>
            </div>
            <div className="space-y-2">
              {form.locations.map((loc, i) => (
                <div
                  key={i}
                  className="rounded-xl p-3 space-y-2"
                  style={{ background: 'var(--color-canvas-subtle)', border: '1px solid var(--color-border-subtle)' }}
                >
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>
                        Path
                      </label>
                      <input
                        className="zeus-input"
                        placeholder="/"
                        value={loc.path}
                        onChange={(e) => updateLocation(i, 'path', e.target.value)}
                      />
                    </div>
                    <ArrowRight size={14} className="flex-shrink-0 mt-5" style={{ color: 'var(--color-text-muted)' }} />
                    <div className="flex-1">
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>
                        Host de destino
                      </label>
                      <input
                        className="zeus-input"
                        placeholder="localhost"
                        value={loc.proxyHost}
                        onChange={(e) => updateLocation(i, 'proxyHost', e.target.value)}
                      />
                    </div>
                    <div style={{ width: '5.5rem', flexShrink: 0 }}>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>
                        Porta
                      </label>
                      <input
                        className="zeus-input"
                        placeholder="3000"
                        value={loc.proxyPort}
                        onChange={(e) => updateLocation(i, 'proxyPort', e.target.value)}
                      />
                    </div>
                    {form.locations.length > 1 && (
                      <button
                        onClick={() => removeLocation(i)}
                        className="zeus-btn zeus-btn-danger mt-5 flex-shrink-0"
                        style={{ padding: '8px', minHeight: 'auto' }}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Load balancer */}
        {form.type === 'load-balancer' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Nome do upstream</Label>
                <input
                  className="zeus-input"
                  value={form.upstreamName}
                  onChange={(e) => set('upstreamName', e.target.value)}
                />
              </div>
              <div>
                <Label hint="Algoritmo de distribuição">Método</Label>
                <select
                  className="zeus-select"
                  value={form.upstreamMethod}
                  onChange={(e) => set('upstreamMethod', e.target.value as NginxSite['upstreamMethod'])}
                >
                  <option value="">Round-robin (padrão)</option>
                  <option value="least_conn">Least connections</option>
                  <option value="ip_hash">IP hash</option>
                  <option value="random">Random</option>
                </select>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Servidores de destino</Label>
                <Button variant="secondary" size="sm" leadingIcon={<Plus size={13} />} onClick={addTarget}>
                  Adicionar
                </Button>
              </div>
              <div className="space-y-2">
                {form.targets.map((t, i) => (
                  <div
                    key={i}
                    className="rounded-xl p-3"
                    style={{ background: 'var(--color-canvas-subtle)', border: '1px solid var(--color-border-subtle)' }}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        className="zeus-input flex-1"
                        placeholder="127.0.0.1"
                        value={t.host}
                        onChange={(e) => updateTarget(i, 'host', e.target.value)}
                      />
                      <input
                        className="zeus-input"
                        style={{ width: '5rem' }}
                        placeholder="3000"
                        value={t.port}
                        onChange={(e) => updateTarget(i, 'port', e.target.value)}
                      />
                      <input
                        className="zeus-input"
                        style={{ width: '4.5rem' }}
                        placeholder="1"
                        title="Peso (weight)"
                        value={t.weight}
                        onChange={(e) => updateTarget(i, 'weight', e.target.value)}
                      />
                      {form.targets.length > 1 && (
                        <button
                          onClick={() => removeTarget(i)}
                          className="zeus-btn zeus-btn-danger flex-shrink-0"
                          style={{ padding: '8px', minHeight: 'auto' }}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                    <label className="mt-2 flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-text-muted)' }}>
                      <input
                        type="checkbox"
                        checked={t.backup}
                        onChange={(e) => updateTarget(i, 'backup', e.target.checked)}
                      />
                      Servidor backup (usado apenas quando os outros falham)
                    </label>
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                Host · Porta · Peso
              </p>
            </div>
          </div>
        )}

        {/* Static */}
        {form.type === 'static' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Pasta dos arquivos (root)</Label>
                <input
                  className="zeus-input"
                  placeholder="/var/www/html"
                  value={form.rootPath}
                  onChange={(e) => set('rootPath', e.target.value)}
                />
              </div>
              <div>
                <Label hint="Ex: index.html index.htm">Arquivos de índice</Label>
                <input
                  className="zeus-input"
                  placeholder="index.html"
                  value={form.indexFiles}
                  onChange={(e) => set('indexFiles', e.target.value)}
                />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label hint="Cada location serve arquivos com try_files">Locations</Label>
                <Button variant="secondary" size="sm" leadingIcon={<Plus size={13} />} onClick={addStaticLocation}>
                  Adicionar
                </Button>
              </div>
              <div className="space-y-2">
                {form.staticLocations.map((loc, i) => (
                  <div
                    key={i}
                    className="rounded-xl p-3"
                    style={{ background: 'var(--color-canvas-subtle)', border: '1px solid var(--color-border-subtle)' }}
                  >
                    <div className="flex items-center gap-2">
                      <div style={{ width: '7rem', flexShrink: 0 }}>
                        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>
                          Path
                        </label>
                        <input
                          className="zeus-input"
                          placeholder="/"
                          value={loc.path}
                          onChange={(e) => updateStaticLocation(i, 'path', e.target.value)}
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>
                          try_files
                        </label>
                        <input
                          className="zeus-input font-mono"
                          placeholder="$uri $uri/ =404"
                          value={loc.tryFiles}
                          onChange={(e) => updateStaticLocation(i, 'tryFiles', e.target.value)}
                        />
                      </div>
                      {form.staticLocations.length > 1 && (
                        <button
                          onClick={() => removeStaticLocation(i)}
                          className="zeus-btn zeus-btn-danger mt-5 flex-shrink-0"
                          style={{ padding: '8px', minHeight: 'auto' }}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Docker containers */}
        {dockerContainers.filter((c) => c.port).length > 0 && form.type !== 'static' && (
          <div>
            <p className="text-xs font-semibold mb-2 uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>
              Containers disponíveis
            </p>
            <div className="flex flex-wrap gap-2">
              {dockerContainers.filter((c) => c.port).map((c) => (
                <button
                  key={c.id}
                  onClick={() => useContainer(c)}
                  className="rounded-full px-3 py-1.5 text-xs font-medium transition-all"
                  style={{
                    background: 'var(--color-canvas-subtle)',
                    color: 'var(--color-text-muted)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  {c.name} :{c.port}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    )

    // Step 2: Proxy settings (only for proxy/lb)
    if (step === proxyStep) return (
      <div className="space-y-3">
        <ToggleRow
          checked={form.websocket}
          onChange={(v) => set('websocket', v)}
          label="WebSocket / Upgrade"
          hint="Adiciona proxy_set_header Upgrade e Connection 'upgrade'"
        />
        <ToggleRow
          checked={form.forwardHeaders}
          onChange={(v) => set('forwardHeaders', v)}
          label="Repasse de headers do cliente"
          hint="X-Real-IP, X-Forwarded-For, X-Forwarded-Proto, Host"
        />
        <ToggleRow
          checked={form.cacheBypass}
          onChange={(v) => set('cacheBypass', v)}
          label="Cache bypass"
          hint="proxy_cache_bypass $http_upgrade"
        />
        <div
          className="rounded-xl p-3"
          style={{ background: 'var(--color-canvas-subtle)', border: '1px solid var(--color-border-subtle)' }}
        >
          <p className="text-xs font-semibold mb-3 uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>
            Limites e timeouts
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>
                Tamanho máximo do upload (client_max_body_size)
              </label>
              <input
                className="zeus-input"
                placeholder="50m"
                value={form.clientBodySize}
                onChange={(e) => set('clientBodySize', e.target.value)}
              />
            </div>
            <TimeoutField
              label="Timeout de conexão (proxy_connect_timeout)"
              value={form.connectTimeout}
              onChange={(v) => set('connectTimeout', v)}
            />
            <TimeoutField
              label="Timeout de leitura (proxy_read_timeout)"
              value={form.readTimeout}
              onChange={(v) => set('readTimeout', v)}
            />
            <TimeoutField
              label="Timeout de envio (proxy_send_timeout)"
              value={form.sendTimeout}
              onChange={(v) => set('sendTimeout', v)}
            />
          </div>
        </div>
      </div>
    )

    // Last step: SSL
    if (step === sslStep) {
      const domain = form.serverNames.trim().split(/\s+/)[0] || 'example.com'
      const destLabel =
        form.type === 'static'
          ? form.rootPath
          : form.type === 'load-balancer'
          ? `${form.targets.length} servidor${form.targets.length !== 1 ? 'es' : ''}`
          : form.locations.length === 1
          ? `${form.locations[0].proxyHost}:${form.locations[0].proxyPort}`
          : `${form.locations.length} locations`

      return (
        <div className="space-y-4">
          <ToggleRow
            checked={form.sslEnabled}
            onChange={(v) => set('sslEnabled', v)}
            label="Ativar HTTPS (SSL)"
            hint="Redireciona :80 → :443 automaticamente. Requer certificado já instalado."
          />
          {form.sslEnabled && (
            <div className="space-y-2">
              <input
                className="zeus-input"
                placeholder="/etc/letsencrypt/live/example.com/fullchain.pem"
                value={form.sslCertPath}
                onChange={(e) => set('sslCertPath', e.target.value)}
              />
              <input
                className="zeus-input"
                placeholder="/etc/letsencrypt/live/example.com/privkey.pem"
                value={form.sslKeyPath}
                onChange={(e) => set('sslKeyPath', e.target.value)}
              />
            </div>
          )}

          <div>
            <p className="text-xs font-semibold mb-2 uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>
              Resumo
            </p>
            <div
              className="rounded-xl p-4 space-y-3"
              style={{ background: 'var(--color-canvas-subtle)', border: '1px solid var(--color-border-subtle)' }}
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-lg px-2 py-1 font-mono font-semibold" style={{ background: 'var(--color-brand-soft)', color: 'var(--color-brand)' }}>
                  {domain}
                </span>
                <ArrowRight size={11} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                <span className="rounded-lg px-2 py-1" style={{ background: 'var(--color-canvas)', color: 'var(--color-text-muted)' }}>
                  Nginx :{form.sslEnabled ? '443' : form.listenPort}
                </span>
                <ArrowRight size={11} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                <span className="rounded-lg px-2 py-1 font-mono" style={{ background: 'var(--color-canvas)', color: 'var(--color-text-muted)' }}>
                  {destLabel}
                </span>
                {form.sslEnabled && (
                  <span className="rounded-lg px-2 py-1 flex items-center gap-1" style={{ background: 'var(--color-success-soft)', color: 'var(--color-success)' }}>
                    <Lock size={10} /> SSL
                  </span>
                )}
              </div>
              <div className="text-xs space-y-0.5" style={{ color: 'var(--color-text-muted)' }}>
                <p>
                  Arquivo: <span className="font-mono" style={{ color: 'var(--color-text)' }}>{form.filename || '(sem nome)'}</span>
                </p>
                {form.type !== 'static' && (
                  <p>
                    {form.websocket && 'WebSocket · '}
                    {form.forwardHeaders && 'Headers · '}
                    {form.clientBodySize && `Upload ${form.clientBodySize} · `}
                    {form.readTimeout && `Read ${form.readTimeout}`}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )
    }

    return null
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.52)', backdropFilter: 'blur(4px)' }}
    >
      <div
        className="w-full max-w-2xl rounded-[24px] p-6 flex flex-col"
        style={{
          background: 'var(--color-surface-elevated)',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-xl, 0 32px 64px rgba(0,0,0,0.4))',
          maxHeight: '90vh',
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-5 flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
              {isEdit ? `Editar ${site!.displayName}` : 'Novo site'}
            </h2>
            <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
              Passo {step + 1} de {steps.length} · {steps[step]}
            </p>
          </div>
          <button
            onClick={onClose}
            className="zeus-btn zeus-btn-ghost flex-shrink-0"
            style={{ padding: '6px', minHeight: 'auto' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-6 flex-shrink-0">
          {steps.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className="h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-all"
                style={{
                  background: i < step ? 'var(--color-success)' : i === step ? 'var(--color-brand)' : 'var(--color-canvas-subtle)',
                  color: i <= step ? 'white' : 'var(--color-text-muted)',
                }}
              >
                {i < step ? <Check size={12} /> : i + 1}
              </div>
              <span
                className="text-xs hidden sm:block"
                style={{ color: i === step ? 'var(--color-text)' : 'var(--color-text-muted)' }}
              >
                {s}
              </span>
              {i < steps.length - 1 && (
                <div className="w-5 h-px" style={{ background: i < step ? 'var(--color-success)' : 'var(--color-border)' }} />
              )}
            </div>
          ))}
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1 pr-1">
          {renderStep()}
        </div>

        {/* Error */}
        {error && (
          <div
            className="mt-4 rounded-xl px-4 py-3 text-sm flex-shrink-0"
            style={{
              background: 'var(--color-danger-soft)',
              color: 'var(--color-danger)',
              border: '1px solid color-mix(in srgb, var(--color-danger) 28%, transparent)',
            }}
          >
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="mt-6 flex items-center justify-between flex-shrink-0">
          <Button
            variant="ghost"
            leadingIcon={step > 0 ? <ChevronLeft size={15} /> : undefined}
            onClick={step === 0 ? onClose : () => setStep((prev) => prev - 1)}
          >
            {step === 0 ? 'Cancelar' : 'Voltar'}
          </Button>
          {step < maxStep ? (
            <Button
              variant="primary"
              trailingIcon={<ChevronRight size={15} />}
              onClick={() => setStep((prev) => prev + 1)}
            >
              Próximo
            </Button>
          ) : (
            <Button
              variant="primary"
              leadingIcon={saving ? undefined : <Check size={15} />}
              loading={saving}
              onClick={handleSave}
            >
              {isEdit ? 'Salvar e aplicar' : 'Criar site'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export default SiteModal
