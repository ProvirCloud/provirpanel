import { ArrowRight, Edit2, Globe, Lock, Power, PowerOff, Trash2 } from 'lucide-react'
import type { NginxSite } from '../../types/nginx'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import Card from '../ui/Card'

type SiteCardProps = {
  site: NginxSite
  onEdit: (site: NginxSite) => void
  onToggle: (site: NginxSite) => void
  onDelete: (site: NginxSite) => void
}

const typeMeta: Record<NginxSite['type'], { label: string; variant: 'info' | 'warning' | 'neutral' }> = {
  proxy: { label: 'Proxy reverso', variant: 'info' },
  'load-balancer': { label: 'Load balancer', variant: 'warning' },
  static: { label: 'Site estático', variant: 'neutral' },
}

const NodeBox = ({
  children,
  accent = false,
  muted = false,
}: {
  children: React.ReactNode
  accent?: boolean
  muted?: boolean
}) => (
  <div
    className="flex-shrink-0 flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium"
    style={
      accent
        ? {
            background: 'var(--color-brand-soft)',
            color: 'var(--color-brand)',
            border: '1px solid color-mix(in srgb, var(--color-brand) 24%, transparent)',
          }
        : muted
        ? {
            background: 'transparent',
            color: 'var(--color-text-muted)',
            border: '1px dashed var(--color-border-subtle)',
          }
        : {
            background: 'var(--color-canvas-subtle)',
            color: 'var(--color-text)',
            border: '1px solid var(--color-border-subtle)',
          }
    }
  >
    {children}
  </div>
)

const Pipe = () => (
  <div className="flex flex-shrink-0 items-center gap-0.5" style={{ color: 'var(--color-text-muted)' }}>
    <div className="h-px w-4" style={{ background: 'var(--color-border)' }} />
    <ArrowRight size={11} />
  </div>
)

const InfoPill = ({ label }: { label: string }) => (
  <span
    className="rounded-full px-2 py-0.5 text-[11px] font-medium"
    style={{
      background: 'var(--color-canvas-subtle)',
      color: 'var(--color-text-muted)',
      border: '1px solid var(--color-border-subtle)',
    }}
  >
    {label}
  </span>
)

const SiteCard = ({ site, onEdit, onToggle, onDelete }: SiteCardProps) => {
  const meta = typeMeta[site.type]
  const domain = site.serverNames[0] || site.displayName

  // ── Destination column ────────────────────────────────────────────────────
  const renderDestinations = () => {
    if (site.type === 'load-balancer') {
      return (
        <div className="flex flex-col gap-1.5 min-w-0">
          {site.targets.slice(0, 4).map((t, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs"
              style={{
                background: 'var(--color-canvas-subtle)',
                border: '1px solid var(--color-border-subtle)',
              }}
            >
              <span
                className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                style={{ background: t.backup ? 'var(--color-warning)' : 'var(--color-success)' }}
              />
              <span className="font-mono" style={{ color: 'var(--color-text)' }}>
                {t.host}:{t.port}
              </span>
              {t.weight !== '1' && (
                <span className="ml-auto text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                  ×{t.weight}
                </span>
              )}
              {t.backup && (
                <span className="ml-auto text-[10px]" style={{ color: 'var(--color-warning)' }}>
                  backup
                </span>
              )}
            </div>
          ))}
          {site.targets.length > 4 && (
            <span className="px-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              +{site.targets.length - 4} mais
            </span>
          )}
        </div>
      )
    }

    if (site.type === 'static') {
      return (
        <div className="flex flex-col gap-1.5 min-w-0">
          {site.locations.map((loc, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs"
              style={{
                background: 'var(--color-canvas-subtle)',
                border: '1px solid var(--color-border-subtle)',
              }}
            >
              <code className="font-mono flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                {loc.path}
              </code>
              <ArrowRight size={10} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
              <span className="font-mono truncate" style={{ color: 'var(--color-text)' }}>
                {loc.tryFiles || loc.root || site.rootPath}
              </span>
            </div>
          ))}
        </div>
      )
    }

    // proxy — show all locations with their targets
    const proxyLocs = site.locations.filter((l) => l.proxyHost)
    const displayLocs = proxyLocs.length > 0 ? proxyLocs : site.locations
    return (
      <div className="flex flex-col gap-1.5 min-w-0">
        {displayLocs.slice(0, 5).map((loc, i) => (
          <div
            key={i}
            className="flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs"
            style={{
              background: 'var(--color-canvas-subtle)',
              border: '1px solid var(--color-border-subtle)',
            }}
          >
            <code className="font-mono flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
              {loc.path}
            </code>
            <ArrowRight size={10} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
            <span className="font-mono truncate" style={{ color: 'var(--color-text)' }}>
              {loc.proxyHost}:{loc.proxyPort}
            </span>
          </div>
        ))}
        {displayLocs.length > 5 && (
          <span className="px-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            +{displayLocs.length - 5} mais
          </span>
        )}
      </div>
    )
  }

  // ── Proxy settings pills ──────────────────────────────────────────────────
  const renderSettingsPills = () => {
    const pills: string[] = []
    const s = site.proxySettings
    if (s.websocket) pills.push('WebSocket')
    if (s.forwardHeaders) pills.push('Headers')
    if (s.cacheBypass) pills.push('Cache bypass')
    if (s.clientBodySize) pills.push(s.clientBodySize)
    if (s.connectTimeout) pills.push(`conn ${s.connectTimeout}`)
    if (s.readTimeout) pills.push(`read ${s.readTimeout}`)
    if (s.sendTimeout && s.sendTimeout !== s.readTimeout) pills.push(`send ${s.sendTimeout}`)
    if (site.upstreamMethod) pills.push(site.upstreamMethod)
    if (!pills.length) return null
    return (
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {pills.map((p) => (
          <InfoPill key={p} label={p} />
        ))}
      </div>
    )
  }

  return (
    <Card
      variant="elevated"
      className="p-6 transition-all duration-[var(--duration-fast)] ease-[var(--ease-standard)] hover:-translate-y-0.5 hover:border-[var(--color-brand)]/30"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h3 className="text-lg font-semibold text-[var(--color-text)] truncate">{domain}</h3>
            {site.serverNames.length > 1 && (
              <span className="text-xs text-[var(--color-text-muted)]">
                +{site.serverNames.length - 1} domínio{site.serverNames.length > 2 ? 's' : ''}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">{site.displayName}</p>
        </div>
        <Badge variant={site.enabled ? 'success' : 'neutral'} className="flex-shrink-0">
          {site.enabled ? 'Ativo' : 'Inativo'}
        </Badge>
      </div>

      {/* Type & SSL badges */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge variant={meta.variant}>{meta.label}</Badge>
        {site.sslEnabled && (
          <Badge variant="success">
            <Lock size={10} />
            SSL
          </Badge>
        )}
      </div>

      {/* Flow diagram */}
      <div className="mt-5 flex items-start gap-2 overflow-x-auto pb-1">
        {/* Internet */}
        <NodeBox accent>
          <Globe size={11} />
          Internet
        </NodeBox>

        <Pipe />

        {/* Nginx */}
        <NodeBox>
          <span style={{ color: 'var(--color-text-muted)' }}>Nginx</span>
          <span className="ml-1 font-mono">:{site.sslEnabled ? '443' : site.listenPort}</span>
        </NodeBox>

        <Pipe />

        {/* Destinations */}
        {renderDestinations()}
      </div>

      {/* Proxy settings pills */}
      {renderSettingsPills()}

      {/* Actions */}
      <div className="mt-6 flex flex-wrap gap-3">
        <Button variant="secondary" size="sm" leadingIcon={<Edit2 size={14} />} onClick={() => onEdit(site)}>
          Editar
        </Button>
        {site.toggleable && (
          <Button
            variant={site.enabled ? 'danger' : 'secondary'}
            size="sm"
            leadingIcon={site.enabled ? <PowerOff size={14} /> : <Power size={14} />}
            onClick={() => onToggle(site)}
          >
            {site.enabled ? 'Desativar' : 'Ativar'}
          </Button>
        )}
        {site.deletable && (
          <Button variant="danger" size="sm" leadingIcon={<Trash2 size={14} />} onClick={() => onDelete(site)}>
            Remover
          </Button>
        )}
      </div>
    </Card>
  )
}

export default SiteCard
