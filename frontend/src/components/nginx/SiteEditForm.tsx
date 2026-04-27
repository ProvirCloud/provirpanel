import { ArrowRight, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import api from '../../services/api.js'
import Button from '../ui/Button'
import type { NginxSite } from '../../types/nginx'

type SiteEditFormProps = {
  site: NginxSite
  onClose: () => void
  onSave: () => void
  onOpenRawEditor?: () => void
}

type EditFormState = {
  serverNames: string
  enabled: boolean
  listenPort: string
}

const SiteEditForm = ({ site, onClose, onSave, onOpenRawEditor }: SiteEditFormProps) => {
  const [form, setForm] = useState<EditFormState>({
    serverNames: site.serverNames.join(' '),
    enabled: site.enabled,
    listenPort: site.listenPort,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    setError('')
    if (!form.serverNames.trim()) {
      setError('Informe ao menos um domínio.')
      return
    }
    setSaving(true)
    try {
      // Build minimal config with updated server_names and listen port
      const lines: string[] = []
      if (!form.enabled) {
        lines.push('# Config desativada')
      }

      lines.push(`# Updated: ${new Date().toISOString()}`)
      lines.push('')

      if (site.sslEnabled && !form.listenPort.includes('443')) {
        lines.push('server {')
        lines.push(`    listen ${form.listenPort};`)
        lines.push(`    server_name ${form.serverNames.trim()};`)
        lines.push(`    return 301 https://$server_name$request_uri;`)
        lines.push('}')
        lines.push('')
      }

      lines.push('server {')
      lines.push(`    listen ${form.listenPort}${site.sslEnabled ? ' ssl http2' : ''};`)
      lines.push(`    server_name ${form.serverNames.trim()};`)

      if (site.sslEnabled) {
        lines.push(`    ssl_certificate ${site.sslCertPath};`)
        lines.push(`    ssl_certificate_key ${site.sslKeyPath};`)
      }

      // Preserve location blocks from original config
      if (site.locations.length > 0) {
        lines.push('')
        site.locations.forEach((loc) => {
          lines.push(`    location ${loc.path} {`)
          if (loc.proxyHost) {
            lines.push(`        proxy_pass http://${loc.proxyHost}:${loc.proxyPort};`)
            if (site.proxySettings.forwardHeaders) {
              lines.push(`        proxy_set_header X-Real-IP $remote_addr;`)
              lines.push(`        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`)
              lines.push(`        proxy_set_header X-Forwarded-Proto $scheme;`)
            }
          } else if (loc.root) {
            lines.push(`        root ${loc.root};`)
            if (loc.tryFiles) {
              lines.push(`        try_files ${loc.tryFiles};`)
            }
          }
          lines.push(`    }`)
        })
      }

      lines.push('}')
      const content = lines.join('\n')

      await api.put(`/nginx/configs/${site.name}`, { content })
      await api.post('/nginx/reload')
      onSave()
    } catch (err: any) {
      setError(err.response?.data?.error || err.message)
    } finally {
      setSaving(false)
    }
  }

  const summary = useMemo(() => {
    const typeLabel =
      site.type === 'load-balancer'
        ? `${site.targets.length} backends`
        : site.type === 'static'
          ? site.rootPath
          : site.locations.length === 1
            ? `${site.locations[0].proxyHost}:${site.locations[0].proxyPort}`
            : `${site.locations.length} locations`

    return { typeLabel }
  }, [site])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.52)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-[24px] p-6"
        style={{
          background: 'var(--color-surface-elevated)',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-xl, 0 32px 64px rgba(0,0,0,0.4))',
          maxHeight: '90vh',
          overflow: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
              Editar {site.displayName}
            </h2>
            <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
              Propriedades gerais e roteamento
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

        {/* Summary info */}
        <div
          className="rounded-xl p-4 mb-6"
          style={{
            background: 'var(--color-canvas-subtle)',
            border: '1px solid var(--color-border-subtle)',
          }}
        >
          <div className="flex items-center flex-wrap gap-2 text-xs">
            <span
              className="rounded-lg px-2 py-1 font-mono font-semibold"
              style={{ background: 'var(--color-brand-soft)', color: 'var(--color-brand)' }}
            >
              {site.type === 'proxy'
                ? 'Proxy'
                : site.type === 'load-balancer'
                  ? 'Load Balancer'
                  : 'Static'}
            </span>
            <ArrowRight
              size={11}
              style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}
            />
            <span
              className="rounded-lg px-2 py-1"
              style={{ background: 'var(--color-canvas)', color: 'var(--color-text-muted)' }}
            >
              :{form.listenPort}
            </span>
            <ArrowRight
              size={11}
              style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}
            />
            <span
              className="rounded-lg px-2 py-1 font-mono"
              style={{ background: 'var(--color-canvas)', color: 'var(--color-text-muted)' }}
            >
              {summary.typeLabel}
            </span>
            {site.sslEnabled && (
              <span
                className="rounded-lg px-2 py-1"
                style={{ background: 'var(--color-success-soft)', color: 'var(--color-success)' }}
              >
                SSL
              </span>
            )}
          </div>
        </div>

        {/* Form fields */}
        <div className="space-y-4 mb-6">
          {/* Domínios */}
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text)' }}>
              Domínio(s)
            </label>
            <input
              className="zeus-input"
              placeholder="example.com www.example.com"
              value={form.serverNames}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, serverNames: e.target.value }))
              }
            />
            <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
              Separe múltiplos domínios com espaço
            </p>
          </div>

          {/* Porta */}
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text)' }}>
              Porta
            </label>
            <input
              className="zeus-input"
              placeholder="80"
              value={form.listenPort}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, listenPort: e.target.value }))
              }
            />
          </div>

          {/* Enabled toggle */}
          <label
            className="flex items-start gap-3 cursor-pointer rounded-xl p-3 transition-all"
            style={{
              background: form.enabled
                ? 'var(--color-brand-soft)'
                : 'var(--color-canvas-subtle)',
              border: `1px solid ${
                form.enabled
                  ? 'color-mix(in srgb, var(--color-brand) 28%, transparent)'
                  : 'var(--color-border-subtle)'
              }`,
            }}
          >
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 flex-shrink-0"
              checked={form.enabled}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, enabled: e.target.checked }))
              }
            />
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                Configuração ativa
              </p>
              <p
                className="text-xs mt-0.5"
                style={{ color: 'var(--color-text-muted)' }}
              >
                Desativar para desabilitar esta rota sem remover o arquivo
              </p>
            </div>
          </label>
        </div>

        {/* Info */}
        <div
          className="rounded-xl p-4 mb-6"
          style={{
            background: 'var(--color-canvas-subtle)',
            border: '1px solid var(--color-border-subtle)',
          }}
        >
          <p className="text-xs font-semibold mb-2 uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>
            Edição avançada
          </p>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
            Para editar locations, proxy settings, SSL paths ou fazer mudanças complexas, use o editor raw do arquivo
            {onOpenRawEditor && '.conf'}
          </p>
        </div>

        {/* Error */}
        {error && (
          <div
            className="rounded-xl px-4 py-3 text-sm mb-6"
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
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            onClick={onOpenRawEditor}
          >
            Ver arquivo .conf
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              loading={saving}
            >
              Salvar
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SiteEditForm
