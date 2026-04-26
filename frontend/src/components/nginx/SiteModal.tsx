import { useState } from 'react'
import { ArrowRight, Check, ChevronLeft, ChevronRight, Lock, Plus, Trash2, X } from 'lucide-react'
import api from '../../services/api.js'
import type { DockerContainer, NginxSite, NginxSiteType, NginxTarget } from '../../types/nginx'
import { buildNginxConfig } from '../../types/nginx'
import Button from '../ui/Button'

type SiteModalProps = {
  site: NginxSite | null
  dockerContainers: DockerContainer[]
  onClose: () => void
  onSave: () => void
}

type FormState = {
  filename: string
  serverNames: string
  listenPort: string
  type: NginxSiteType
  proxyHost: string
  proxyPort: string
  targets: NginxTarget[]
  rootPath: string
  sslEnabled: boolean
  sslCertPath: string
  sslKeyPath: string
}

const STEPS = ['Domínio', 'Roteamento', 'Segurança']

const Field = ({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) => (
  <div>
    <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text)' }}>
      {label}
    </label>
    {children}
    {hint && (
      <p className="mt-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
        {hint}
      </p>
    )}
  </div>
)

const SiteModal = ({ site, dockerContainers, onClose, onSave }: SiteModalProps) => {
  const isEdit = site !== null
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState<FormState>({
    filename: site?.name || '',
    serverNames: site?.serverNames.join(' ') || '',
    listenPort: site?.listenPort || '80',
    type: site?.type || 'proxy',
    proxyHost: site?.proxyHost || 'localhost',
    proxyPort: site?.proxyPort || '3000',
    targets: site?.targets?.length ? site.targets : [{ host: '127.0.0.1', port: '3000', weight: '1' }],
    rootPath: site?.rootPath || '/var/www/html',
    sslEnabled: site?.sslEnabled || false,
    sslCertPath: (site as any)?.sslCertPath || '',
    sslKeyPath: (site as any)?.sslKeyPath || '',
  })

  const update = <K extends keyof FormState>(field: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [field]: value }))

  const addTarget = () =>
    setForm((prev) => ({ ...prev, targets: [...prev.targets, { host: '127.0.0.1', port: '3000', weight: '1' }] }))

  const updateTarget = (i: number, field: keyof NginxTarget, value: string) =>
    setForm((prev) => ({
      ...prev,
      targets: prev.targets.map((t, idx) => (idx === i ? { ...t, [field]: value } : t)),
    }))

  const removeTarget = (i: number) =>
    setForm((prev) => ({ ...prev, targets: prev.targets.filter((_, idx) => idx !== i) }))

  const useContainer = (container: DockerContainer) => {
    const host = !container.ip || container.ip === '0.0.0.0' || container.ip === '::' ? 'localhost' : container.ip
    const port = String(container.port)
    if (form.type === 'load-balancer') {
      setForm((prev) => ({ ...prev, targets: [...prev.targets, { host, port, weight: '1' }] }))
    } else {
      setForm((prev) => ({ ...prev, proxyHost: host, proxyPort: port }))
    }
  }

  const availableContainers = dockerContainers.filter((c) => c.port)

  const handleSave = async () => {
    setError('')
    if (!form.filename.trim()) { setError('Informe o nome do arquivo.'); return }
    if (!form.serverNames.trim()) { setError('Informe ao menos um domínio.'); return }
    setSaving(true)
    try {
      const content = buildNginxConfig(form)
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

  const domainPreview = form.serverNames.trim().split(/\s+/)[0] || 'example.com'
  const destPreview =
    form.type === 'static'
      ? form.rootPath
      : form.type === 'load-balancer'
      ? `${form.targets.length} servidor${form.targets.length !== 1 ? 'es' : ''}`
      : `${form.proxyHost}:${form.proxyPort}`

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.52)', backdropFilter: 'blur(4px)' }}
    >
      <div
        className="w-full max-w-lg rounded-[24px] p-6"
        style={{
          background: 'var(--color-surface-elevated)',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-xl, 0 32px 64px rgba(0,0,0,0.4))',
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
              {isEdit ? `Editar ${site!.displayName}` : 'Novo site'}
            </h2>
            <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
              Passo {step + 1} de {STEPS.length} · {STEPS[step]}
            </p>
          </div>
          <button
            onClick={onClose}
            className="zeus-btn zeus-btn-ghost"
            style={{ padding: '6px', minHeight: 'auto' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-6">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className="h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-all"
                style={{
                  background:
                    i < step
                      ? 'var(--color-success)'
                      : i === step
                      ? 'var(--color-brand)'
                      : 'var(--color-canvas-subtle)',
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
              {i < STEPS.length - 1 && (
                <div
                  className="w-6 h-px"
                  style={{ background: i < step ? 'var(--color-success)' : 'var(--color-border)' }}
                />
              )}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="min-h-[220px] space-y-4">
          {step === 0 && (
            <>
              <Field label="Nome do arquivo" hint="Será salvo em /etc/nginx/sites-available/">
                <input
                  className="zeus-input"
                  placeholder="meu-site.conf"
                  value={form.filename}
                  onChange={(e) => update('filename', e.target.value)}
                  disabled={isEdit}
                />
              </Field>
              <Field label="Domínio(s)" hint="Separe múltiplos domínios com espaço">
                <input
                  className="zeus-input"
                  placeholder="example.com www.example.com"
                  value={form.serverNames}
                  onChange={(e) => update('serverNames', e.target.value)}
                />
              </Field>
              <Field label="Porta">
                <input
                  className="zeus-input"
                  value={form.listenPort}
                  onChange={(e) => update('listenPort', e.target.value)}
                />
              </Field>
            </>
          )}

          {step === 1 && (
            <>
              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text)' }}>
                  Tipo de roteamento
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { value: 'proxy', label: 'Proxy reverso', desc: 'Encaminha para um servidor' },
                      { value: 'load-balancer', label: 'Load balancer', desc: 'Distribui entre servidores' },
                      { value: 'static', label: 'Site estático', desc: 'Serve arquivos do disco' },
                    ] as const
                  ).map((option) => (
                    <button
                      key={option.value}
                      onClick={() => update('type', option.value)}
                      className="flex flex-col items-start gap-1 rounded-xl p-3 text-left transition-all"
                      style={{
                        border:
                          form.type === option.value
                            ? '2px solid var(--color-brand)'
                            : '1px solid var(--color-border)',
                        background:
                          form.type === option.value
                            ? 'var(--color-brand-soft)'
                            : 'var(--color-canvas-subtle)',
                      }}
                    >
                      <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                        {option.label}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        {option.desc}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {form.type === 'proxy' && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Host de destino">
                    <input
                      className="zeus-input"
                      placeholder="localhost"
                      value={form.proxyHost}
                      onChange={(e) => update('proxyHost', e.target.value)}
                    />
                  </Field>
                  <Field label="Porta de destino">
                    <input
                      className="zeus-input"
                      placeholder="3000"
                      value={form.proxyPort}
                      onChange={(e) => update('proxyPort', e.target.value)}
                    />
                  </Field>
                </div>
              )}

              {form.type === 'load-balancer' && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                      Servidores de destino
                    </label>
                    <Button variant="secondary" size="sm" leadingIcon={<Plus size={13} />} onClick={addTarget}>
                      Adicionar
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {form.targets.map((t, i) => (
                      <div key={i} className="flex items-center gap-2">
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
                          style={{ width: '4rem' }}
                          placeholder="1"
                          title="Peso (weight)"
                          value={t.weight}
                          onChange={(e) => updateTarget(i, 'weight', e.target.value)}
                        />
                        <button
                          onClick={() => removeTarget(i)}
                          className="zeus-btn zeus-btn-danger flex-shrink-0"
                          style={{ padding: '8px', minHeight: 'auto' }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="mt-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    Host · Porta · Peso
                  </p>
                </div>
              )}

              {form.type === 'static' && (
                <Field label="Pasta dos arquivos">
                  <input
                    className="zeus-input"
                    placeholder="/var/www/html"
                    value={form.rootPath}
                    onChange={(e) => update('rootPath', e.target.value)}
                  />
                </Field>
              )}

              {availableContainers.length > 0 && form.type !== 'static' && (
                <div>
                  <p
                    className="text-xs font-semibold mb-2 uppercase tracking-widest"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    Containers disponíveis
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {availableContainers.map((c) => (
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
            </>
          )}

          {step === 2 && (
            <>
              <div
                className="rounded-xl p-4"
                style={{
                  background: 'var(--color-canvas-subtle)',
                  border: '1px solid var(--color-border-subtle)',
                }}
              >
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.sslEnabled}
                    onChange={(e) => update('sslEnabled', e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded flex-shrink-0"
                  />
                  <div>
                    <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                      Ativar HTTPS (SSL)
                    </span>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                      Redireciona HTTP → HTTPS automaticamente. Requer certificado já instalado.
                    </p>
                  </div>
                </label>
                {form.sslEnabled && (
                  <div className="mt-3 space-y-2">
                    <input
                      className="zeus-input"
                      placeholder="/etc/letsencrypt/live/example.com/fullchain.pem"
                      value={form.sslCertPath}
                      onChange={(e) => update('sslCertPath', e.target.value)}
                    />
                    <input
                      className="zeus-input"
                      placeholder="/etc/letsencrypt/live/example.com/privkey.pem"
                      value={form.sslKeyPath}
                      onChange={(e) => update('sslKeyPath', e.target.value)}
                    />
                  </div>
                )}
              </div>

              <div>
                <p
                  className="text-xs font-semibold mb-2 uppercase tracking-widest"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  Resumo
                </p>
                <div
                  className="rounded-xl p-4 space-y-3"
                  style={{
                    background: 'var(--color-canvas-subtle)',
                    border: '1px solid var(--color-border-subtle)',
                  }}
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className="rounded-lg px-2 py-1 font-mono font-semibold"
                      style={{ background: 'var(--color-brand-soft)', color: 'var(--color-brand)' }}
                    >
                      {domainPreview}
                    </span>
                    <ArrowRight size={11} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                    <span
                      className="rounded-lg px-2 py-1"
                      style={{ background: 'var(--color-canvas)', color: 'var(--color-text-muted)' }}
                    >
                      Nginx :{form.sslEnabled ? '443' : form.listenPort}
                    </span>
                    <ArrowRight size={11} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                    <span
                      className="rounded-lg px-2 py-1 font-mono"
                      style={{ background: 'var(--color-canvas)', color: 'var(--color-text-muted)' }}
                    >
                      {destPreview}
                    </span>
                    {form.sslEnabled && (
                      <span
                        className="rounded-lg px-2 py-1 flex items-center gap-1"
                        style={{ background: 'var(--color-success-soft)', color: 'var(--color-success)' }}
                      >
                        <Lock size={10} />
                        SSL
                      </span>
                    )}
                  </div>
                  <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    Arquivo:{' '}
                    <span className="font-mono" style={{ color: 'var(--color-text)' }}>
                      {form.filename || '(sem nome)'}
                    </span>
                  </p>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Error */}
        {error && (
          <div
            className="mt-4 rounded-xl px-4 py-3 text-sm"
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
        <div className="mt-6 flex items-center justify-between">
          <Button
            variant="ghost"
            leadingIcon={step > 0 ? <ChevronLeft size={15} /> : undefined}
            onClick={step === 0 ? onClose : () => setStep((prev) => prev - 1)}
          >
            {step === 0 ? 'Cancelar' : 'Voltar'}
          </Button>
          {step < STEPS.length - 1 ? (
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
              {isEdit ? 'Salvar' : 'Criar site'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export default SiteModal
