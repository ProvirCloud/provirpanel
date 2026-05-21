import { FolderOpen, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type {
  HeaderName,
  LoadBalancerMethod,
  NginxVisualState,
  RouteConfig,
  SelectedNode,
} from './nginxVisualConfig'
import {
  addServer,
  findRouteById,
  findUpstreamById,
  mutateDomain,
  mutateHttp,
  mutateHttps,
  mutateRoute,
  mutateUpstream,
  removeRoute,
  removeServer,
  removeUpstream,
  updateServer,
} from './nginxVisualConfig'
import DockerHelper from './DockerHelper'
import FolderPickerModal from './FolderPickerModal'
import CertbotPanel from './CertbotPanel'

type Props = {
  state: NginxVisualState
  selected: SelectedNode
  onChange: (next: NginxVisualState) => void
  onSelectRoute: (id: string) => void
}

// ─── Primitives ───────────────────────────────────────────────────────────────

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ')

const inputCls =
  'h-8 w-full rounded-[10px] border border-white/10 bg-[rgba(8,15,30,0.9)] px-3 text-[13px] text-white placeholder-white/25 outline-none transition focus:border-[#4d85ff]/60 focus:ring-1 focus:ring-[#4d85ff]/20'

const selectCls =
  'h-8 w-full rounded-[10px] border border-white/10 bg-[rgba(8,15,30,0.9)] px-3 text-[13px] text-white outline-none transition focus:border-[#4d85ff]/60 focus:ring-1 focus:ring-[#4d85ff]/20 cursor-pointer'

const Section = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="space-y-1.5">
    <label className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-white/38">
      {label}
    </label>
    {children}
  </div>
)

const Toggle = ({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) => (
  <label className="flex cursor-pointer items-center justify-between gap-3">
    <span className="text-[13px] text-white/75">{label}</span>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative h-5 w-9 flex-shrink-0 rounded-full border transition-all duration-200',
        checked ? 'border-[#3d72ff] bg-[#2b5fdd]' : 'border-white/12 bg-white/6',
      )}
    >
      <span
        className={cx(
          'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all duration-200',
          checked ? 'left-4' : 'left-0.5',
        )}
      />
    </button>
  </label>
)

const Badge = ({ children, color = 'green' }: { children: React.ReactNode; color?: 'green' | 'yellow' | 'blue' }) => {
  const cls = {
    green: 'bg-[#1b5c38] text-[#86efac]',
    yellow: 'bg-[#5c3a0c] text-[#fcd34d]',
    blue: 'bg-[#1a3060] text-[#93c5fd]',
  }[color]
  return (
    <span className={cx('rounded-full px-2.5 py-0.5 text-[11px] font-medium', cls)}>
      {children}
    </span>
  )
}

const IconBtn = ({
  icon: Icon,
  onClick,
  danger,
  title,
}: {
  icon: React.ElementType
  onClick: () => void
  danger?: boolean
  title?: string
}) => (
  <button
    type="button"
    title={title}
    onClick={onClick}
    className={cx(
      'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[8px] border transition',
      danger
        ? 'border-[#7f1d3a]/60 bg-[#3d0e1c]/60 text-[#f87171] hover:bg-[#7f1d3a]/40'
        : 'border-white/8 bg-white/4 text-white/50 hover:bg-white/8 hover:text-white/80',
    )}
  >
    <Icon className="h-3.5 w-3.5" />
  </button>
)

// ─── Per-selection panels ─────────────────────────────────────────────────────

function DomainPanel({ state, onChange }: { state: NginxVisualState; onChange: (s: NginxVisualState) => void }) {
  return (
    <div className="space-y-4">
      <Section label="Domínio principal">
        <input
          className={inputCls}
          value={state.domain.primary}
          onChange={(e) => onChange(mutateDomain(state, { primary: e.target.value }))}
          placeholder="example.com"
        />
      </Section>
      <Section label="Domínios adicionais">
        <div className="space-y-2">
          {state.domain.additional.map((d, i) => (
            <div key={i} className="flex gap-2">
              <input
                className={inputCls}
                value={d}
                onChange={(e) => {
                  const next = [...state.domain.additional]
                  next[i] = e.target.value
                  onChange(mutateDomain(state, { additional: next }))
                }}
                placeholder="www.example.com"
              />
              <IconBtn
                icon={Trash2}
                danger
                title="Remover"
                onClick={() =>
                  onChange(
                    mutateDomain(state, {
                      additional: state.domain.additional.filter((_, idx) => idx !== i),
                    }),
                  )
                }
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              onChange(mutateDomain(state, { additional: [...state.domain.additional, ''] }))
            }
            className="flex items-center gap-1.5 text-[12px] text-[#6aa4ff] hover:text-[#93c5fd] transition"
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar domínio
          </button>
        </div>
      </Section>
    </div>
  )
}

function HttpPanel({ state, onChange }: { state: NginxVisualState; onChange: (s: NginxVisualState) => void }) {
  return (
    <div className="space-y-4">
      <Section label="Porta">
        <input
          className={inputCls}
          type="number"
          value={state.http.port}
          onChange={(e) => onChange(mutateHttp(state, { port: Number(e.target.value) || 80 }))}
        />
      </Section>
      <div className="rounded-[12px] border border-white/6 bg-white/2 p-3.5 space-y-3">
        <Toggle
          label="Redirecionar para HTTPS"
          checked={state.http.redirectToHttps}
          onChange={(v) => onChange(mutateHttp(state, { redirectToHttps: v }))}
        />
      </div>
    </div>
  )
}

function HttpsPanel({ state, onChange }: { state: NginxVisualState; onChange: (s: NginxVisualState) => void }) {
  return (
    <div className="space-y-4">
      <Section label="Porta">
        <input
          className={inputCls}
          type="number"
          value={state.https.port}
          onChange={(e) => onChange(mutateHttps(state, { port: Number(e.target.value) || 443 }))}
        />
      </Section>

      <div className="rounded-[12px] border border-white/6 bg-white/2 p-3.5 space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/38 mb-1">
          TLS / Protocolo
        </p>
        <Toggle
          label="SSL ativo"
          checked={state.https.sslEnabled}
          onChange={(v) => onChange(mutateHttps(state, { sslEnabled: v }))}
        />
        <Toggle
          label="HTTP/2"
          checked={state.https.http2Enabled}
          onChange={(v) => onChange(mutateHttps(state, { http2Enabled: v }))}
        />
      </div>

      {state.https.sslEnabled && (
        <div className="space-y-2">
          <Section label="Caminho do certificado (fullchain.pem)">
            <input
              className={inputCls}
              value={state.https.certPath}
              onChange={(e) => onChange(mutateHttps(state, { certPath: e.target.value }))}
              placeholder="/etc/letsencrypt/live/example.com/fullchain.pem"
            />
          </Section>
          <Section label="Caminho da chave privada (privkey.pem)">
            <input
              className={inputCls}
              value={state.https.keyPath}
              onChange={(e) => onChange(mutateHttps(state, { keyPath: e.target.value }))}
              placeholder="/etc/letsencrypt/live/example.com/privkey.pem"
            />
          </Section>
        </div>
      )}

      <div className="rounded-[12px] border border-white/6 bg-white/2 p-3.5 space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/38 mb-1">
          Segurança
        </p>
        <Toggle
          label="Security Headers"
          checked={state.https.securityHeadersEnabled}
          onChange={(v) => onChange(mutateHttps(state, { securityHeadersEnabled: v }))}
        />
        <Toggle
          label="HSTS"
          checked={state.https.hstsEnabled}
          onChange={(v) => onChange(mutateHttps(state, { hstsEnabled: v }))}
        />
        <Toggle
          label="server_tokens off"
          checked={state.https.serverTokensOff}
          onChange={(v) => onChange(mutateHttps(state, { serverTokensOff: v }))}
        />
      </div>

      <Section label="Tamanho máximo do corpo (client_max_body_size)">
        <input
          className={inputCls}
          value={state.https.clientMaxBodySize}
          onChange={(e) => onChange(mutateHttps(state, { clientMaxBodySize: e.target.value }))}
          placeholder="500m"
        />
      </Section>

      <CertbotPanel state={state} onChange={onChange} />
    </div>
  )
}

const ALL_PROXY_HEADERS: HeaderName[] = ['Host', 'X-Real-IP', 'X-Forwarded-For', 'X-Forwarded-Proto']
const ALL_WS_HEADERS: HeaderName[] = ['Upgrade', 'Connection', 'Host', 'X-Real-IP', 'X-Forwarded-For', 'X-Forwarded-Proto']

function RoutePanel({
  state,
  route,
  onChange,
  onDelete,
}: {
  state: NginxVisualState
  route: RouteConfig
  onChange: (s: NginxVisualState) => void
  onDelete: () => void
}) {
  const [showFolderPicker, setShowFolderPicker] = useState(false)

  const upstream = findUpstreamById(state, route.upstreamId)
  const isProxy = route.type === 'proxy' || route.type === 'websocket'
  const isRedirect = route.type === 'redirect'
  const isStatic = !isProxy && !isRedirect
  const allHeaders = route.type === 'websocket' ? ALL_WS_HEADERS : ALL_PROXY_HEADERS

  const set = <K extends keyof RouteConfig>(key: K, val: RouteConfig[K]) =>
    onChange(mutateRoute(state, route.id, (r) => ({ ...r, [key]: val })))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[1fr_auto_1fr] gap-3">
        <Section label="Path">
          <input
            className={inputCls}
            value={route.path}
            onChange={(e) =>
              onChange(
                mutateRoute(state, route.id, (r) => ({
                  ...r,
                  path: e.target.value,
                  title: e.target.value,
                })),
              )
            }
            placeholder="/rota"
          />
        </Section>
        <Section label="Match">
          <select
            className={selectCls}
            value={route.modifier || ''}
            onChange={(e) => set('modifier', e.target.value as any)}
            title="Tipo de match do location"
          >
            <option value="">prefix</option>
            <option value="=">= exato</option>
            <option value="~">~ regex</option>
            <option value="~*">~* regex (i)</option>
            <option value="^~">^~ prioridade</option>
          </select>
        </Section>
        <Section label="Tipo">
          <select
            className={selectCls}
            value={route.type}
            onChange={(e) => set('type', e.target.value as RouteConfig['type'])}
          >
            <option value="proxy">Proxy reverso</option>
            <option value="websocket">WebSocket</option>
            <option value="redirect">Redirecionamento</option>
            <option value="static-app">App estático</option>
            <option value="static-assets">Assets estáticos</option>
            <option value="static-site">Site estático</option>
          </select>
        </Section>
      </div>

      {isProxy && (
        <>
          <Section label="Upstream de destino">
            <select
              className={selectCls}
              value={route.upstreamId || ''}
              onChange={(e) => set('upstreamId', e.target.value)}
            >
              <option value="">— Selecionar upstream —</option>
              {state.upstreams.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </Section>

          {upstream && (
            <Section label="Método do load balancer">
              <select
                className={selectCls}
                value={upstream.method}
                onChange={(e) =>
                  onChange(
                    mutateUpstream(state, upstream.id, (u) => ({
                      ...u,
                      method: e.target.value as LoadBalancerMethod,
                    })),
                  )
                }
              >
                <option value="round_robin">Round Robin (padrão)</option>
                <option value="least_conn">Least Connections</option>
                <option value="ip_hash">IP Hash</option>
                <option value="random">Random</option>
              </select>
            </Section>
          )}

          <div className="rounded-[12px] border border-white/6 bg-white/2 p-3.5 space-y-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/38">
              Timeouts
            </p>
            {(['connect', 'read', 'send'] as const).map((k) => (
              <div key={k} className="grid grid-cols-[1fr_80px_24px] items-center gap-2">
                <span className="text-[12px] text-white/60 capitalize">{k}</span>
                <input
                  className={inputCls}
                  type="number"
                  value={route.timeouts?.[k] ?? 60}
                  onChange={(e) =>
                    onChange(
                      mutateRoute(state, route.id, (r) => ({
                        ...r,
                        timeouts: { ...(r.timeouts || { connect: 5, read: 60, send: 60 }), [k]: Number(e.target.value) },
                      })),
                    )
                  }
                />
                <span className="text-[11px] text-white/35">s</span>
              </div>
            ))}
          </div>

          <div className="rounded-[12px] border border-white/6 bg-white/2 p-3.5 space-y-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/38">
              Headers de proxy
            </p>
            {allHeaders.map((h) => (
              <label key={h} className="flex cursor-pointer items-center gap-2.5 text-[12px] text-white/70">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded border-white/20 bg-[#0a1626] accent-[#3f7bff]"
                  checked={route.headers.includes(h)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...route.headers, h]
                      : route.headers.filter((x) => x !== h)
                    set('headers', next)
                  }}
                />
                <code className="font-mono">{h}</code>
              </label>
            ))}
          </div>

          <Toggle
            label="Proxy Buffering"
            checked={route.proxyBuffering !== false}
            onChange={(v) => set('proxyBuffering', v)}
          />
        </>
      )}

      {isRedirect && (
        <>
          <Section label="Destino do redirecionamento">
            <input
              className={inputCls}
              value={route.redirectTo || ''}
              onChange={(e) => set('redirectTo', e.target.value)}
              placeholder={route.path + '/'}
            />
          </Section>
          <Section label="Código HTTP">
            <select
              className={selectCls}
              value={route.redirectCode || 301}
              onChange={(e) => set('redirectCode', Number(e.target.value) as 301 | 302 | 307 | 308)}
            >
              <option value={301}>301 - Permanente</option>
              <option value={302}>302 - Temporário</option>
              <option value={307}>307 - Temporário (preserva método)</option>
              <option value={308}>308 - Permanente (preserva método)</option>
            </select>
          </Section>
          <div className="rounded-[12px] border border-white/6 bg-white/2 p-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/38 mb-2">Preview</p>
            <code className="block text-[12px] font-mono text-[#7ee787]">
              location = {route.path} {'{'}<br/>
              &nbsp;&nbsp;&nbsp;&nbsp;return {route.redirectCode || 301} {route.redirectTo || route.path + '/'};<br/>
              {'}'}
            </code>
          </div>
          <div className="rounded-[12px] border border-amber-500/20 bg-amber-500/5 p-3">
            <p className="text-[12px] text-white/55 leading-relaxed">
              <span className="text-amber-400 font-medium">Dica:</span> Use para redirecionar <code className="text-[11px] bg-white/5 px-1.5 py-0.5 rounded">/admin</code> para <code className="text-[11px] bg-white/5 px-1.5 py-0.5 rounded">/admin/</code> (trailing slash) ou para outro domínio.
            </p>
          </div>
        </>
      )}

      {isStatic && (
        <>
          <Section label="Alias (pasta no servidor)">
            <div className="flex gap-2">
              <input
                className={inputCls + ' flex-1'}
                value={route.alias || ''}
                onChange={(e) => set('alias', e.target.value)}
                placeholder="/var/www/html/"
              />
              <button
                type="button"
                title="Navegar pastas"
                onClick={() => setShowFolderPicker(true)}
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] border border-white/10 bg-white/4 text-white/45 transition hover:bg-white/8 hover:text-white/80"
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </button>
            </div>
          </Section>

          {showFolderPicker && (
            <FolderPickerModal
              initialPath={route.alias || '/'}
              onSelect={(path) => {
                set('alias', path + '/')
                setShowFolderPicker(false)
              }}
              onClose={() => setShowFolderPicker(false)}
            />
          )}
          {route.type === 'static-assets' ? (
            <Section label="try_files fallback">
              <input
                className={inputCls}
                value={route.tryFiles || ''}
                onChange={(e) => set('tryFiles', e.target.value)}
                placeholder="=404"
              />
            </Section>
          ) : (
            <Section label="Fallback (SPA index)">
              <input
                className={inputCls}
                value={route.fallback || ''}
                onChange={(e) => set('fallback', e.target.value)}
                placeholder="/index.html"
              />
            </Section>
          )}
        </>
      )}

      <Toggle
        label="Rota ativa"
        checked={!route.disabled}
        onChange={(v) => set('disabled', !v)}
      />

      {isProxy && route.path && route.path !== '/' && (
        <div className="rounded-[12px] border border-amber-500/20 bg-amber-500/5 p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-400/80 mb-1.5">
            Variável de ambiente Docker
          </p>
          <p className="text-[12px] text-white/55 leading-relaxed mb-2">
            Se o destino é um container Docker, adicione esta variável de ambiente no container/stack:
          </p>
          <code className="block rounded-[8px] border border-amber-500/15 bg-[rgba(8,15,30,0.8)] px-3 py-2 text-[12px] font-mono text-amber-300">
            SCRIPT_NAME={route.path.replace(/\/$/, '')}
          </code>
          <p className="mt-2 text-[11px] text-white/35">
            Isso garante que o app dentro do container saiba que está rodando em um sub-path.
          </p>
        </div>
      )}

      <div className="border-t border-white/6 pt-4">
        <button
          type="button"
          onClick={onDelete}
          className="flex w-full items-center justify-center gap-2 rounded-[10px] border border-[#7f1d3a]/50 bg-[#3d0e1c]/50 px-4 py-2.5 text-[13px] font-medium text-[#f87171] transition hover:bg-[#7f1d3a]/40"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Remover rota
        </button>
      </div>
    </div>
  )
}

function UpstreamPanel({
  state,
  upstreamId,
  onChange,
  onDelete,
}: {
  state: NginxVisualState
  upstreamId: string
  onChange: (s: NginxVisualState) => void
  onDelete: () => void
}) {
  const upstream = findUpstreamById(state, upstreamId)
  if (!upstream) return null

  return (
    <div className="space-y-4">
      <Section label="Nome do upstream">
        <input
          className={inputCls}
          value={upstream.name}
          onChange={(e) =>
            onChange(mutateUpstream(state, upstreamId, (u) => ({ ...u, name: e.target.value })))
          }
          placeholder="meu_upstream"
        />
      </Section>

      <Section label="Método de balanceamento">
        <select
          className={selectCls}
          value={upstream.method}
          onChange={(e) =>
            onChange(
              mutateUpstream(state, upstreamId, (u) => ({
                ...u,
                method: e.target.value as LoadBalancerMethod,
              })),
            )
          }
        >
          <option value="round_robin">Round Robin (padrão)</option>
          <option value="least_conn">Least Connections</option>
          <option value="ip_hash">IP Hash</option>
          <option value="random">Random</option>
        </select>
      </Section>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/38">
            Servidores
          </label>
          <button
            type="button"
            onClick={() => onChange(addServer(state, upstreamId))}
            className="flex items-center gap-1 text-[11px] text-[#6aa4ff] hover:text-[#93c5fd] transition"
          >
            <Plus className="h-3 w-3" />
            Adicionar
          </button>
        </div>
        <div className="space-y-2">
          {upstream.servers.map((server) => (
            <div key={server.id} className="flex items-center gap-2">
              <input
                className={inputCls + ' flex-1'}
                value={server.host}
                onChange={(e) =>
                  onChange(updateServer(state, upstreamId, server.id, { host: e.target.value }))
                }
                placeholder="127.0.0.1"
              />
              <input
                className={inputCls}
                style={{ width: 72 }}
                type="number"
                value={server.port}
                onChange={(e) =>
                  onChange(
                    updateServer(state, upstreamId, server.id, { port: Number(e.target.value) || 80 }),
                  )
                }
                placeholder="3000"
              />
              {upstream.servers.length > 1 && (
                <IconBtn
                  icon={Trash2}
                  danger
                  title="Remover servidor"
                  onClick={() => onChange(removeServer(state, upstreamId, server.id))}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      <DockerHelper state={state} upstreamId={upstreamId} onChange={onChange} />

      <div className="border-t border-white/6 pt-4">
        <button
          type="button"
          onClick={onDelete}
          className="flex w-full items-center justify-center gap-2 rounded-[10px] border border-[#7f1d3a]/50 bg-[#3d0e1c]/50 px-4 py-2.5 text-[13px] font-medium text-[#f87171] transition hover:bg-[#7f1d3a]/40"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Remover upstream
        </button>
      </div>
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

const PANEL_TITLES: Record<SelectedNode['kind'], string> = {
  domain: 'Domínio',
  http: 'HTTP',
  https: 'HTTPS / SSL',
  route: 'Rota',
  upstream: 'Upstream',
  'static-target': 'Alvo estático',
}

export default function NginxConfigPanel({ state, selected, onChange, onSelectRoute }: Props) {
  const route = selected.kind === 'route' ? findRouteById(state, selected.id) : null
  const upstream = selected.kind === 'upstream' ? findUpstreamById(state, selected.id) : null

  // static-target maps back to its route
  const staticRoute =
    selected.kind === 'static-target'
      ? state.routes.find((r) => `target-${r.id}` === selected.id) || null
      : null

  const subtitle =
    route?.path ||
    upstream?.name ||
    staticRoute?.alias ||
    (selected.kind === 'domain' ? state.domain.primary : null) ||
    (selected.kind === 'http' ? `Port ${state.http.port}` : null) ||
    (selected.kind === 'https' ? `Port ${state.https.port}` : null) ||
    '—'

  const statusBadge =
    selected.kind === 'route' && route
      ? route.disabled
        ? <Badge color="yellow">Inativo</Badge>
        : <Badge color="green">Ativo</Badge>
      : selected.kind === 'upstream' && upstream
      ? <Badge color="blue">{upstream.method}</Badge>
      : null

  return (
    <section className="flex flex-col rounded-[20px] border border-white/8 bg-[linear-gradient(160deg,rgba(8,16,32,0.98),rgba(6,13,26,0.96))] shadow-[0_24px_80px_rgba(1,5,16,0.5)] overflow-hidden">
      {/* Panel header */}
      <div className="flex-shrink-0 border-b border-white/6 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/38">
              {PANEL_TITLES[selected.kind]}
            </p>
            <p className="mt-1.5 truncate text-[22px] font-semibold leading-tight text-white">
              {subtitle}
            </p>
          </div>
          {statusBadge}
        </div>
      </div>

      {/* Panel body */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {selected.kind === 'domain' && (
          <DomainPanel state={state} onChange={onChange} />
        )}
        {selected.kind === 'http' && (
          <HttpPanel state={state} onChange={onChange} />
        )}
        {selected.kind === 'https' && (
          <HttpsPanel state={state} onChange={onChange} />
        )}
        {selected.kind === 'route' && route && (
          <RoutePanel
            state={state}
            route={route}
            onChange={onChange}
            onDelete={() => {
              onChange(removeRoute(state, route.id))
              onSelectRoute(state.routes.find((r) => r.id !== route.id)?.id || '')
            }}
          />
        )}
        {selected.kind === 'upstream' && upstream && (
          <UpstreamPanel
            state={state}
            upstreamId={upstream.id}
            onChange={onChange}
            onDelete={() => {
              onChange(removeUpstream(state, upstream.id))
            }}
          />
        )}
        {selected.kind === 'static-target' && staticRoute && (
          <RoutePanel
            state={state}
            route={staticRoute}
            onChange={onChange}
            onDelete={() => {
              onChange(removeRoute(state, staticRoute.id))
              onSelectRoute(state.routes.find((r) => r.id !== staticRoute.id)?.id || '')
            }}
          />
        )}
        {!route && !upstream && !staticRoute && selected.kind !== 'domain' && selected.kind !== 'http' && selected.kind !== 'https' && (
          <p className="mt-2 text-[13px] text-white/32">
            Selecione um elemento no mapa para editar suas configurações.
          </p>
        )}
      </div>
    </section>
  )
}
