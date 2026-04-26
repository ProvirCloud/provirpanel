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

const NodeBox = ({ children, accent = false }: { children: React.ReactNode; accent?: boolean }) => (
  <div
    className="flex-shrink-0 flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium"
    style={
      accent
        ? {
            background: 'var(--color-brand-soft)',
            color: 'var(--color-brand)',
            border: '1px solid color-mix(in srgb, var(--color-brand) 24%, transparent)',
          }
        : {
            background: 'var(--color-canvas-subtle)',
            color: 'var(--color-text-muted)',
            border: '1px solid var(--color-border-subtle)',
          }
    }
  >
    {children}
  </div>
)

const Connector = () => (
  <div className="flex flex-shrink-0 items-center gap-0.5" style={{ color: 'var(--color-text-muted)' }}>
    <div className="h-px w-5" style={{ background: 'var(--color-border)' }} />
    <ArrowRight size={11} />
  </div>
)

const SiteCard = ({ site, onEdit, onToggle, onDelete }: SiteCardProps) => {
  const meta = typeMeta[site.type]
  const domain = site.serverNames[0] || site.displayName

  const destinationLabel = () => {
    if (site.type === 'static') return site.rootPath
    if (site.type === 'load-balancer') return `${site.targets.length} servidor${site.targets.length !== 1 ? 'es' : ''}`
    return `${site.proxyHost}:${site.proxyPort}`
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
        <Badge variant={site.enabled ? 'success' : 'neutral'}>{site.enabled ? 'Ativo' : 'Inativo'}</Badge>
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
      <div className="mt-5 flex items-center gap-1 overflow-x-auto pb-1">
        <NodeBox accent>
          <Globe size={11} />
          Internet
        </NodeBox>

        <Connector />

        <NodeBox>
          <span className="text-[var(--color-text-muted)]">Nginx</span>
          <span className="ml-1 font-mono" style={{ color: 'var(--color-text)' }}>
            :{site.sslEnabled ? '443' : site.listenPort}
          </span>
        </NodeBox>

        <Connector />

        {site.type === 'load-balancer' ? (
          <div className="flex flex-col gap-1 min-w-0">
            {site.targets.slice(0, 3).map((t, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 rounded-xl px-3 py-1 text-xs font-mono"
                style={{
                  background: 'var(--color-canvas-subtle)',
                  color: 'var(--color-text-muted)',
                  border: '1px solid var(--color-border-subtle)',
                }}
              >
                <span
                  className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                  style={{ background: 'var(--color-success)' }}
                />
                {t.host}:{t.port}
                {t.weight !== '1' && (
                  <span className="ml-auto opacity-60">×{t.weight}</span>
                )}
              </div>
            ))}
            {site.targets.length > 3 && (
              <span className="px-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                +{site.targets.length - 3} mais
              </span>
            )}
          </div>
        ) : (
          <NodeBox>
            {site.type === 'static' ? (
              <span className="font-mono truncate max-w-[160px]">{site.rootPath}</span>
            ) : (
              <span className="font-mono">{destinationLabel()}</span>
            )}
          </NodeBox>
        )}
      </div>

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
          <Button
            variant="danger"
            size="sm"
            leadingIcon={<Trash2 size={14} />}
            onClick={() => onDelete(site)}
          >
            Remover
          </Button>
        )}
      </div>
    </Card>
  )
}

export default SiteCard
