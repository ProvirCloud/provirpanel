import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  Clock3,
  Copy,
  Cpu,
  Database,
  Download,
  Edit3,
  GitBranch,
  Globe2,
  HardDrive,
  History,
  Layers,
  Loader2,
  Lock,
  Network,
  Package,
  Play,
  Plus,
  RefreshCcw,
  RotateCcw,
  Save,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Square,
  Terminal,
  Trash2,
  UploadCloud,
  X,
  Zap
} from 'lucide-react'
import {
  serviceActivityApi,
  serviceEnvironmentApi,
  githubDeliveryApi,
  serviceLogsApi,
  serviceMetricsApi,
  servicesApi
} from '../services/serviceDetailsApi.js'
import { createDockerTerminalSocket } from '../services/socket.js'

const TABS = [
  { id: 'overview', label: 'Overview', icon: Layers },
  { id: 'deploys', label: 'Deploys', icon: UploadCloud },
  { id: 'delivery', label: 'Delivery', icon: GitBranch },
  { id: 'terminal', label: 'Terminal', icon: Terminal },
  { id: 'environment', label: 'Environment', icon: Lock },
  { id: 'logs', label: 'Logs', icon: Terminal },
  { id: 'metrics', label: 'Metrics', icon: BarChart3 },
  { id: 'activity', label: 'Activity', icon: History },
  { id: 'settings', label: 'Settings', icon: Settings }
]

const STATUS_META = {
  running: {
    label: 'Running',
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
    icon: CheckCircle2
  },
  exited: {
    label: 'Stopped',
    className: 'border-slate-600 bg-slate-900 text-slate-300',
    icon: Square
  },
  stopped: {
    label: 'Stopped',
    className: 'border-slate-600 bg-slate-900 text-slate-300',
    icon: Square
  },
  paused: {
    label: 'Paused',
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
    icon: Clock3
  },
  unhealthy: {
    label: 'Unhealthy',
    className: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
    icon: AlertTriangle
  },
  unknown: {
    label: 'Unknown',
    className: 'border-slate-700 bg-slate-950 text-slate-400',
    icon: AlertTriangle
  }
}

const HEALTH_META = {
  healthy: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  starting: 'border-sky-500/30 bg-sky-500/10 text-sky-200',
  unhealthy: 'border-rose-500/30 bg-rose-500/10 text-rose-200'
}

const CHANGE_TYPE_OPTIONS = [
  { value: 'fix', label: 'Correção' },
  { value: 'content', label: 'Conteúdo' },
  { value: 'feature', label: 'Funcionalidade' },
  { value: 'security', label: 'Segurança' },
  { value: 'maintenance', label: 'Manutenção' }
]

const formatDateTime = (value) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

const formatBytes = (value) => {
  const number = Number(value || 0)
  if (!number) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(number) / Math.log(1024)))
  return `${(number / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

const formatUptime = (seconds) => {
  const value = Number(seconds || 0)
  if (!value) return '-'
  const days = Math.floor(value / 86400)
  const hours = Math.floor((value % 86400) / 3600)
  const minutes = Math.floor((value % 3600) / 60)
  if (days) return `${days}d ${hours}h`
  if (hours) return `${hours}h ${minutes}m`
  return `${minutes || 1}m`
}

const normalizeRuntimeState = (service = {}) => {
  const raw = String(service.containerStatus || service.runtimeState || service.status || '').toLowerCase()
  if (raw.includes('unhealthy')) return 'unhealthy'
  if (raw.includes('running') || raw === 'up') return 'running'
  if (raw.includes('exited') || raw.includes('stopped')) return 'stopped'
  if (raw.includes('paused')) return 'paused'
  return raw || 'unknown'
}

const resolveEnvironmentLabel = (service = {}) => {
  const explicit = service.environment || service.env || service.zone
  if (explicit) return String(explicit).toUpperCase()
  const envVar = (service.envVars || []).find((env) => ['APP_ENV', 'NODE_ENV', 'ENV', 'STAGE'].includes(env.key))
  if (envVar?.value && envVar.value !== '******') return String(envVar.value).toUpperCase()
  return 'PROD'
}

const resolvePublicUrl = (service = {}) =>
  service.publicUrl || service.domain || service.externalUrl || service.url || ''

const getLastDeployment = (service = {}) => {
  const deployments = Array.isArray(service.deployments) ? service.deployments : []
  return deployments
    .slice()
    .sort((a, b) => new Date(b.finishedAt || b.updatedAt || b.createdAt || 0) - new Date(a.finishedAt || a.updatedAt || a.createdAt || 0))[0]
}

const getActiveDeployment = (service = {}) => {
  const deployments = Array.isArray(service.deployments) ? service.deployments : []
  const activeId = service.activeDeploymentId
  return (
    deployments.find((deployment) => activeId && deployment.id === activeId) ||
    deployments.find((deployment) => deployment.status === 'active') ||
    (activeId ? { id: activeId, versionLabel: activeId, status: 'active' } : null)
  )
}

const formatDeploymentLabel = (deployment) =>
  deployment?.versionLabel || deployment?.label || deployment?.version || deployment?.id || '-'

const formatDeploymentStatus = (deployment, active = false) => {
  if (active) return 'ativa agora'
  if (deployment?.status === 'failed') return 'falhou'
  if (deployment?.status === 'active') return 'ativa'
  if (deployment?.status === 'available') return 'disponível'
  return deployment?.status || 'disponível'
}

const cloneEnvRows = (rows = []) =>
  rows.map((env) => ({
    key: env.key || '',
    value: env.value ?? '',
    secret: Boolean(env.secret)
  }))

const fieldClass = 'rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-blue-500/60'
const smallButtonClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-blue-500/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50'
const primaryButtonClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-blue-500/40 bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50'

const DEPLOY_PHASE_META = {
  init: { label: 'Preparando' },
  upload: { label: 'Subindo arquivos' },
  process: { label: 'Processando' },
  prepare: { label: 'Preparando publicação' },
  extract: { label: 'Extraindo pacote' },
  candidate: { label: 'Criando versão candidata' },
  compile: { label: 'Compilando versão' },
  healthcheck: { label: 'Testando healthcheck' },
  cleanup: { label: 'Limpando temporários' },
  promote: { label: 'Ativando versão' },
  rollback: { label: 'Rollback automático' },
  done: { label: 'Concluído' },
  error: { label: 'Erro' }
}

const DEPLOY_RUNNING_STATUSES = new Set(['initializing', 'uploading', 'queued', 'running', 'processing'])
const DEPLOY_SUCCESS_STATUSES = new Set(['success', 'completed'])
const DEPLOY_ERROR_STATUSES = new Set(['error', 'failed'])

const clampDeployProgress = (value, fallback = 0) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(0, Math.min(100, Math.round(number)))
}

const isDeployRunning = (progress) => DEPLOY_RUNNING_STATUSES.has(progress?.status)
const isDeploySuccess = (progress) => DEPLOY_SUCCESS_STATUSES.has(progress?.status)
const isDeployError = (progress) => DEPLOY_ERROR_STATUSES.has(progress?.status)

const mergeDeployProgress = (current, incoming) => {
  const resolved = typeof incoming === 'function' ? incoming(current) : incoming
  if (!resolved) return resolved
  const reset = Boolean(resolved.reset) || (
    resolved.progressSessionId &&
    current?.progressSessionId &&
    resolved.progressSessionId !== current.progressSessionId
  )
  const base = reset ? null : current
  const currentProgress = clampDeployProgress(base?.progress)
  const incomingProgress = clampDeployProgress(resolved.progress ?? resolved.progressPercent, currentProgress)
  const finished = isDeploySuccess(resolved)
  const progress = finished
    ? 100
    : reset
      ? incomingProgress
      : Math.max(currentProgress, incomingProgress)
  const { reset: _reset, progressPercent: _progressPercent, ...payload } = resolved
  return {
    ...(base || {}),
    ...payload,
    progress,
    updatedAt: payload.updatedAt || new Date().toISOString()
  }
}

const getDeployPhaseLabel = (phase) => DEPLOY_PHASE_META[phase]?.label || phase || 'Processando'

const formatDeployEvent = (event) => {
  if (!event) return ''
  if (typeof event === 'string') return event
  return event.message || event.error || JSON.stringify(event)
}

const getDeployTone = (progress) => {
  if (isDeployError(progress)) {
    return {
      border: 'border-rose-500/30',
      bg: 'bg-rose-500/10',
      text: 'text-rose-100',
      muted: 'text-rose-200/80',
      bar: 'bg-rose-500',
      iconBg: 'bg-rose-500/15 text-rose-200',
      icon: AlertTriangle
    }
  }
  if (isDeploySuccess(progress)) {
    return {
      border: 'border-emerald-500/30',
      bg: 'bg-emerald-500/10',
      text: 'text-emerald-100',
      muted: 'text-emerald-200/80',
      bar: 'bg-emerald-500',
      iconBg: 'bg-emerald-500/15 text-emerald-200',
      icon: CheckCircle2
    }
  }
  return {
    border: 'border-blue-500/30',
    bg: 'bg-blue-500/10',
    text: 'text-blue-100',
    muted: 'text-blue-200/80',
    bar: 'bg-blue-500',
    iconBg: 'bg-blue-500/15 text-blue-200',
    icon: Loader2
  }
}

const DeployProgressPanel = ({ progress, error, compact = false, onOpenDeploys, onDismiss }) => {
  if (!progress && !error) return null
  const normalized = progress || { status: 'error', phase: 'error', progress: 0, message: error }
  const tone = getDeployTone(normalized)
  const Icon = tone.icon
  const running = isDeployRunning(normalized)
  const failed = isDeployError(normalized)
  const success = isDeploySuccess(normalized)
  const progressValue = clampDeployProgress(normalized.progress)
  const message = error || normalized.error || normalized.message || 'Publicação em andamento...'
  const title = failed ? 'Falha no deploy' : success ? 'Deploy concluído' : 'Deploy em andamento'
  const events = Array.isArray(normalized.events) ? normalized.events.map(formatDeployEvent).filter(Boolean).slice(-6) : []

  return (
    <div className={`rounded-xl border ${tone.border} ${tone.bg} p-3 ${tone.text}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone.iconBg}`}>
            <Icon className={`h-4 w-4 ${running ? 'animate-spin' : ''}`} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-white">{title}</p>
              <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[11px] uppercase">
                {getDeployPhaseLabel(normalized.phase)}
              </span>
              {normalized.jobId ? (
                <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[11px] text-slate-300">
                  Job {String(normalized.jobId).slice(0, 8)}
                </span>
              ) : null}
            </div>
            <p className={`mt-1 break-words text-sm ${tone.muted}`}>{message}</p>
            {normalized.uploadProgress !== undefined && !failed && !success ? (
              <p className="mt-1 text-xs text-slate-400">Upload do pacote: {clampDeployProgress(normalized.uploadProgress)}%</p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="min-w-12 text-right text-sm font-semibold text-white">{progressValue}%</span>
          {onOpenDeploys ? (
            <button className={smallButtonClass} type="button" onClick={onOpenDeploys}>
              Ver deploy
            </button>
          ) : null}
          {onDismiss && !running ? (
            <button className={smallButtonClass} type="button" onClick={onDismiss} aria-label="Fechar status de deploy">
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>
      <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-slate-950/80">
        <div className={`h-full rounded-full transition-all duration-500 ${tone.bar}`} style={{ width: `${progressValue}%` }} />
        {running ? <div className="absolute inset-0 animate-pulse bg-white/10" /> : null}
      </div>
      {!compact && events.length ? (
        <div className="mt-3 max-h-40 overflow-auto rounded-lg border border-white/5 bg-slate-950/80 p-2 font-mono text-[11px] leading-5 text-slate-400">
          {events.map((event, index) => (
            <p key={`${event}-${index}`}>{event}</p>
          ))}
        </div>
      ) : null}
    </div>
  )
}

const DeployNotification = ({ notification, onClose, onOpenDeploys }) => {
  if (!notification) return null
  const progress = {
    status: notification.type === 'success' ? 'success' : notification.type === 'error' ? 'error' : 'processing',
    phase: notification.phase || (notification.type === 'success' ? 'done' : notification.type === 'error' ? 'error' : 'process')
  }
  const tone = getDeployTone(progress)
  const Icon = tone.icon

  return (
    <div className={`fixed bottom-4 right-4 z-50 w-[calc(100vw-2rem)] max-w-md rounded-xl border ${tone.border} bg-slate-950 p-4 shadow-2xl shadow-black/40`} role={notification.type === 'error' ? 'alert' : 'status'}>
      <div className="flex items-start gap-3">
        <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone.iconBg}`}>
          <Icon className={`h-4 w-4 ${notification.type === 'info' ? 'animate-spin' : ''}`} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">{notification.title}</p>
          <p className="mt-1 break-words text-sm text-slate-300">{notification.message}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className={smallButtonClass} type="button" onClick={onOpenDeploys}>
              Ver deploy
            </button>
            <button className={smallButtonClass} type="button" onClick={onClose}>
              Fechar
            </button>
          </div>
        </div>
        <button className="text-slate-500 hover:text-white" type="button" onClick={onClose} aria-label="Fechar notificação">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

const ServiceStatusBadge = ({ service }) => {
  const state = normalizeRuntimeState(service)
  const meta = STATUS_META[state] || STATUS_META.unknown
  const Icon = meta.icon
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${meta.className}`}>
      <Icon className="h-3.5 w-3.5" />
      {meta.label}
    </span>
  )
}

const HealthBadge = ({ service }) => {
  const health = service?.healthStatus || (service?.healthcheck?.enabled ? 'configured' : 'not configured')
  const className = HEALTH_META[health] || 'border-slate-700 bg-slate-950 text-slate-400'
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${className}`}>
      <ShieldCheck className="h-3.5 w-3.5" />
      {health}
    </span>
  )
}

const HeaderButton = ({ children, icon: Icon, variant = 'default', ...props }) => {
  const variantClass = variant === 'primary'
    ? primaryButtonClass
    : variant === 'danger'
      ? 'inline-flex items-center justify-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50'
      : smallButtonClass
  return (
    <button className={variantClass} type="button" {...props}>
      {Icon ? <Icon className="h-4 w-4" /> : null}
      {children}
    </button>
  )
}

const ServiceHeader = ({ service, actionState, onBack, onDeploy, onEdit, onRestart, onStop, onStart }) => {
  const runtime = normalizeRuntimeState(service)
  const isRunning = runtime === 'running'
  const publicUrl = resolvePublicUrl(service)
  const lastDeployment = getLastDeployment(service)
  const activeDeployment = getActiveDeployment(service)
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow-2xl shadow-slate-950/20">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <button
            type="button"
            className="mb-3 inline-flex items-center gap-2 text-xs font-medium text-slate-400 hover:text-white"
            onClick={onBack}
          >
            <ArrowLeft className="h-4 w-4" />
            Container Service
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold text-white">{service.name}</h1>
            <ServiceStatusBadge service={service} />
            <HealthBadge service={service} />
            <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-300">
              {resolveEnvironmentLabel(service)}
            </span>
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
              activeDeployment
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
            }`}>
              {activeDeployment ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
              Versão ativa: {activeDeployment ? formatDeploymentLabel(activeDeployment) : 'não definida'}
            </span>
          </div>
          <div className="mt-3 grid gap-2 text-xs text-slate-400 sm:grid-cols-2 xl:grid-cols-4">
            <span className="inline-flex min-w-0 items-center gap-2">
              <Package className="h-4 w-4 shrink-0 text-slate-500" />
              <span className="truncate" title={service.image}>{service.image || 'custom-image'}</span>
            </span>
            <span className="inline-flex items-center gap-2">
              <Network className="h-4 w-4 text-slate-500" />
              {service.hostPort || 'auto'} -&gt; {service.containerPort || '-'}
            </span>
            <span className="inline-flex min-w-0 items-center gap-2">
              <Globe2 className="h-4 w-4 shrink-0 text-slate-500" />
              {publicUrl ? (
                <a className="truncate text-blue-200 hover:text-blue-100" href={publicUrl} target="_blank" rel="noreferrer">
                  {publicUrl}
                </a>
              ) : (
                <span>sem URL pública</span>
              )}
            </span>
            <span className="inline-flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-slate-500" />
              {lastDeployment ? formatDateTime(lastDeployment.finishedAt || lastDeployment.createdAt) : formatDateTime(service.updatedAt || service.createdAt)}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <HeaderButton icon={UploadCloud} variant="primary" onClick={onDeploy}>Deploy</HeaderButton>
          <HeaderButton icon={RefreshCcw} onClick={onRestart} disabled={!service.containerId || actionState}>
            Restart
          </HeaderButton>
          {isRunning ? (
            <HeaderButton icon={Square} variant="danger" onClick={onStop} disabled={!service.containerId || actionState}>
              Stop
            </HeaderButton>
          ) : (
            <HeaderButton icon={Play} onClick={onStart} disabled={!service.containerId || actionState}>
              Start
            </HeaderButton>
          )}
          <HeaderButton icon={Edit3} onClick={onEdit}>Edit config</HeaderButton>
        </div>
      </div>
      {actionState ? (
        <div className="mt-4 inline-flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs text-blue-100">
          <Loader2 className="h-4 w-4 animate-spin" />
          {actionState}
        </div>
      ) : null}
    </section>
  )
}

const ActiveDeploymentBanner = ({ service, onOpenDeploys }) => {
  const activeDeployment = getActiveDeployment(service)
  const deploymentLabel = formatDeploymentLabel(activeDeployment)
  const publishedAt = activeDeployment
    ? formatDateTime(activeDeployment.promotedAt || activeDeployment.finishedAt || activeDeployment.updatedAt || activeDeployment.createdAt)
    : '-'

  if (!activeDeployment) {
    return (
      <section className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-100">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-200">
              <AlertTriangle className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">Nenhuma versão ativa registrada</p>
              <p className="mt-1 text-sm text-amber-100/80">O serviço está sem uma publicação marcada como ativa no histórico.</p>
            </div>
          </div>
          <button className={smallButtonClass} type="button" onClick={onOpenDeploys}>
            Ver versões
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-100">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-200">
            <CheckCircle2 className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-white">Versão publicada e ativa</p>
              <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-semibold uppercase text-emerald-100">
                Em produção
              </span>
            </div>
            <p className="mt-1 truncate text-xl font-semibold text-white" title={deploymentLabel}>{deploymentLabel}</p>
            <p className="mt-1 truncate text-xs text-emerald-100/75">
              Publicada em {publishedAt} · {activeDeployment.archiveName || activeDeployment.projectDir || activeDeployment.id}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <span className="inline-flex items-center rounded-lg border border-emerald-400/20 bg-slate-950/40 px-3 py-2 text-xs text-emerald-100">
            ID {String(activeDeployment.id || '').slice(0, 12)}
          </span>
          <button className={smallButtonClass} type="button" onClick={onOpenDeploys}>
            Ver versões
          </button>
        </div>
      </div>
    </section>
  )
}

const SummaryCard = ({ icon, label, value, detail, tone = 'slate' }) => {
  const toneClass = {
    slate: 'border-slate-800 bg-slate-950/70 text-slate-300',
    green: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
    amber: 'border-amber-500/20 bg-amber-500/10 text-amber-200',
    rose: 'border-rose-500/20 bg-rose-500/10 text-rose-200',
    blue: 'border-blue-500/20 bg-blue-500/10 text-blue-200'
  }[tone]
  return (
    <div className={`rounded-xl border p-3 ${toneClass}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs uppercase text-slate-500">{label}</span>
        {icon ? createElement(icon, { className: 'h-4 w-4 text-slate-500' }) : null}
      </div>
      <p className="mt-2 text-xl font-semibold text-white">{value}</p>
      <p className="mt-1 truncate text-xs text-slate-500">{detail}</p>
    </div>
  )
}

const ServiceSummaryCards = ({ service, metrics }) => {
  const current = metrics?.current || {}
  const activeDeployment = getActiveDeployment(service)
  const recentErrors = (service.deployments || []).filter((deployment) => deployment.status === 'failed').length
  return (
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
      <SummaryCard icon={Cpu} label="CPU" value={`${current.cpuPercent ?? 0}%`} detail="uso atual" tone="blue" />
      <SummaryCard icon={Database} label="Memória" value={formatBytes(current.memoryUsage)} detail={`${current.memoryPercent ?? 0}% do limite`} />
      <SummaryCard icon={Activity} label="Req/min" value={current.requestsPerMinute ?? '-'} detail="aguardando métrica HTTP" />
      <SummaryCard icon={Clock3} label="Uptime" value={formatUptime(current.uptimeSeconds)} detail={`${current.restartCount ?? 0} restart(s)`} tone="green" />
      <SummaryCard icon={UploadCloud} label="Versão ativa" value={formatDeploymentLabel(activeDeployment)} detail={activeDeployment ? formatDateTime(activeDeployment.promotedAt || activeDeployment.finishedAt || activeDeployment.createdAt) : 'nenhuma versão ativa'} tone={activeDeployment ? 'green' : 'amber'} />
      <SummaryCard icon={AlertTriangle} label="Erros" value={recentErrors} detail="deploys com falha" tone={recentErrors ? 'rose' : 'slate'} />
      <SummaryCard icon={Zap} label="Custo" value={service.estimatedCost || '-'} detail="não configurado" tone="amber" />
    </section>
  )
}

const ServiceTabs = ({ activeTab, onChange }) => (
  <nav className="flex gap-1 overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/70 p-1">
    {TABS.map((tab) => {
      const Icon = tab.icon
      const active = tab.id === activeTab
      return (
        <button
          key={tab.id}
          type="button"
          className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
            active ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-white'
          }`}
          onClick={() => onChange(tab.id)}
        >
          <Icon className="h-4 w-4" />
          {tab.label}
        </button>
      )
    })}
  </nav>
)

const Panel = ({ title, icon: Icon, actions, children }) => (
  <section className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-white">
        {Icon ? <Icon className="h-4 w-4 text-blue-300" /> : null}
        {title}
      </h2>
      {actions}
    </div>
    {children}
  </section>
)

const InfoRow = ({ label, value, copyable = false }) => {
  const displayValue = value || '-'
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 border-b border-slate-900 py-2 last:border-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="flex min-w-0 items-center gap-2 text-right text-xs text-slate-200">
        <span className="truncate" title={String(displayValue)}>{displayValue}</span>
        {copyable && value ? (
          <button
            type="button"
            className="text-slate-500 hover:text-white"
            onClick={() => navigator.clipboard?.writeText(String(value))}
            title="Copiar"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </span>
    </div>
  )
}

const EnvPreview = ({ envVars = [] }) => {
  if (!envVars.length) {
    return <p className="text-sm text-slate-500">Nenhuma variável registrada.</p>
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {envVars.slice(0, 8).map((env) => (
        <div key={env.key} className="min-w-0 rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2">
          <p className="truncate text-xs font-medium text-slate-200">{env.key}</p>
          <p className="mt-1 truncate text-xs text-slate-500">{env.secret ? 'secret masked' : env.value || '-'}</p>
        </div>
      ))}
    </div>
  )
}

const ActivityTimeline = ({ events = [] }) => {
  if (!events.length) {
    return <p className="text-sm text-slate-500">Nenhum evento registrado.</p>
  }
  return (
    <div className="space-y-3">
      {events.map((event) => (
        <div key={event.id} className="flex gap-3">
          <span className={`mt-1 h-2.5 w-2.5 rounded-full ${
            event.level === 'error'
              ? 'bg-rose-400'
              : event.level === 'warn'
                ? 'bg-amber-300'
                : event.level === 'success'
                  ? 'bg-emerald-300'
                  : 'bg-blue-300'
          }`} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-white">{event.title}</p>
              <span className="text-xs text-slate-500">{formatDateTime(event.createdAt)}</span>
            </div>
            <p className="mt-1 text-sm text-slate-400">{event.message}</p>
            <p className="mt-1 text-xs text-slate-600">{event.actor}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

const ServiceOverviewTab = ({ service, detail, activity }) => {
  const inspect = detail?.inspect || {}
  return (
    <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
      <Panel title="Container" icon={Server}>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <InfoRow label="ID do serviço" value={service.id} copyable />
            <InfoRow label="ID do container" value={service.containerId} copyable />
            <InfoRow label="Imagem" value={service.image} copyable />
            <InfoRow label="Template" value={service.templateId || '-'} />
            <InfoRow label="Status Docker" value={service.containerStatus || inspect.State?.Status || '-'} />
            <InfoRow label="Healthcheck" value={service.healthStatus || (service.healthcheck?.enabled ? 'configured' : 'not configured')} />
          </div>
          <div>
            <InfoRow label="Porta host" value={service.hostPort || 'auto'} />
            <InfoRow label="Porta container" value={service.containerPort} />
            <InfoRow label="Network" value={service.networkName || 'bridge'} />
            <InfoRow label="Bind local" value={service.bindLocalOnly ? 'sim' : 'não'} />
            <InfoRow label="Criado em" value={formatDateTime(service.createdAt)} />
            <InfoRow label="Atualizado em" value={formatDateTime(service.updatedAt)} />
          </div>
        </div>
      </Panel>
      <Panel title="Eventos recentes" icon={History}>
        <ActivityTimeline events={activity.slice(0, 6)} />
      </Panel>
      <Panel title="Volumes" icon={HardDrive}>
        {service.volumes?.length ? (
          <div className="space-y-2">
            {service.volumes.map((volume, index) => (
              <div key={`${volume.hostPath}-${index}`} className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-xs">
                <p className="truncate text-slate-200">{volume.hostPath || '-'}</p>
                <p className="mt-1 truncate text-slate-500">-&gt; {volume.containerPath || '-'}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Nenhum volume configurado.</p>
        )}
      </Panel>
      <Panel title="Environment masked" icon={Lock}>
        <EnvPreview envVars={service.envVars || []} />
      </Panel>
    </div>
  )
}

const DeployHistory = ({ service, busyVersionId, onRollback, onDownload, onRemove }) => {
  const deployments = Array.isArray(service.deployments) ? service.deployments : []
  if (!deployments.length) {
    return <p className="text-sm text-slate-500">Nenhuma versão publicada registrada.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="text-xs uppercase text-slate-500">
          <tr>
            <th className="px-3 py-2">Versão</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Arquivo</th>
            <th className="px-3 py-2">Publicado</th>
            <th className="px-3 py-2 text-right">Ações</th>
          </tr>
        </thead>
        <tbody>
          {deployments.map((deployment) => {
            const active = deployment.id === service.activeDeploymentId || deployment.status === 'active'
            const busy = busyVersionId === deployment.id
            return (
              <tr key={deployment.id} className={`border-t ${active ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-slate-800'}`}>
                <td className="px-3 py-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="truncate font-medium text-white">{formatDeploymentLabel(deployment)}</span>
                    {active ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-100">
                        <CheckCircle2 className="h-3 w-3" />
                        ATIVA
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 truncate text-xs text-slate-500">{deployment.id}</p>
                </td>
                <td className="px-3 py-3">
                  <span className={`rounded-full border px-2 py-1 text-xs ${
                    deployment.status === 'failed'
                      ? 'border-rose-500/30 bg-rose-500/10 text-rose-200'
                      : active
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                        : 'border-slate-700 bg-slate-900 text-slate-300'
                  }`}>
                    {formatDeploymentStatus(deployment, active)}
                  </span>
                </td>
                <td className="max-w-xs truncate px-3 py-3 text-slate-400">{deployment.archiveName || deployment.projectDir || '-'}</td>
                <td className="px-3 py-3 text-slate-400">{formatDateTime(deployment.finishedAt || deployment.createdAt)}</td>
                <td className="px-3 py-3">
                  <div className="flex justify-end gap-2">
                    <button className={smallButtonClass} type="button" onClick={() => onDownload(deployment)} disabled={busy}>
                      <Download className="h-4 w-4" />
                      Baixar
                    </button>
                    <button className={smallButtonClass} type="button" onClick={() => onRollback(deployment)} disabled={active || busy}>
                      <RotateCcw className="h-4 w-4" />
                      Rollback
                    </button>
                    <button className="inline-flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50" type="button" onClick={() => onRemove(deployment)} disabled={active || busy}>
                      <Trash2 className="h-4 w-4" />
                      Remover
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const ServiceDeploysTab = ({
  service,
  onReload,
  deployProgress,
  onDeployProgressChange = () => {},
  onDeployNotification = () => {}
}) => {
  const [file, setFile] = useState(null)
  const [versionMode, setVersionMode] = useState('auto')
  const [versionAppVersion, setVersionAppVersion] = useState('')
  const [versionBuildNumber, setVersionBuildNumber] = useState('')
  const [versionChangeType, setVersionChangeType] = useState('fix')
  const [error, setError] = useState('')
  const [busyVersionId, setBusyVersionId] = useState('')
  const mountedRef = useRef(true)
  const progress = deployProgress
  const deployRunning = isDeployRunning(progress)

  useEffect(() => () => {
    mountedRef.current = false
  }, [])

  const setDeployError = useCallback((message) => {
    if (mountedRef.current) setError(message)
  }, [])

  const clearSelectedFile = useCallback(() => {
    if (mountedRef.current) setFile(null)
  }, [])

  const publishProgress = useCallback((nextProgress) => {
    onDeployProgressChange((current) => {
      const resolved = typeof nextProgress === 'function' ? nextProgress(current) : nextProgress
      if (!resolved) return resolved
      return {
        serviceId: service.id,
        ...resolved
      }
    })
  }, [onDeployProgressChange, service.id])

  const versionMetadata = useMemo(() => ({
    mode: versionMode,
    appVersion: versionAppVersion,
    buildNumber: versionBuildNumber,
    changeType: versionChangeType
  }), [versionMode, versionAppVersion, versionBuildNumber, versionChangeType])

  const monitorJob = useCallback(async (jobId, progressSessionId) => {
    if (!jobId) return
    let keepPolling = true
    try {
      while (keepPolling) {
        await new Promise((resolve) => setTimeout(resolve, 2200))
        const payload = await servicesApi.getDeployJob(service.id, jobId)
        const job = payload.job || payload
        publishProgress({
          progressSessionId,
          jobId,
          status: job.status,
          phase: job.phase,
          progress: job.progressPercent ?? 80,
          message: job.message || 'Publicação em andamento...',
          error: job.error || null,
          events: job.progress || [],
          updatedAt: job.updatedAt
        })
        keepPolling = ['queued', 'running', 'processing'].includes(job.status)
        if (job.status === 'success' || job.status === 'completed') {
          publishProgress({
            progressSessionId,
            jobId,
            status: 'success',
            phase: 'done',
            progress: 100,
            message: 'Versão publicada com sucesso.',
            events: job.progress || []
          })
          onDeployNotification({
            type: 'success',
            title: 'Deploy concluído',
            message: 'A nova versão foi publicada e o serviço foi atualizado.',
            serviceId: service.id
          })
          clearSelectedFile()
          await onReload()
          break
        }
        if (job.status === 'error' || job.status === 'failed') {
          const message = job.error || job.message || 'Falha na publicação'
          setDeployError(message)
          publishProgress({
            progressSessionId,
            jobId,
            status: 'error',
            phase: 'error',
            progress: job.progressPercent,
            message,
            error: message,
            events: job.progress || []
          })
          onDeployNotification({
            type: 'error',
            title: 'Falha no deploy',
            message,
            serviceId: service.id
          })
          await onReload()
          break
        }
      }
    } catch (err) {
      const message = err.response?.data?.message || err.message || 'Falha ao acompanhar o job de publicação'
      setDeployError(message)
      publishProgress({
        progressSessionId,
        jobId,
        status: 'error',
        phase: 'error',
        message,
        error: message
      })
      onDeployNotification({
        type: 'error',
        title: 'Falha ao acompanhar deploy',
        message,
        serviceId: service.id
      })
    }
  }, [clearSelectedFile, onDeployNotification, onReload, publishProgress, service.id, setDeployError])

  const handleDeploy = async () => {
    setError('')
    if (!file) {
      setError('Selecione o pacote da versão.')
      return
    }
    const progressSessionId = `${service.id}-${Date.now()}`
    publishProgress({
      reset: true,
      progressSessionId,
      status: 'uploading',
      phase: 'upload',
      progress: 1,
      uploadProgress: 0,
      message: `Preparando upload de ${file.name}...`
    })
    onDeployNotification({
      type: 'info',
      title: 'Deploy iniciado',
      message: `Publicando ${file.name}. Acompanhe o progresso nesta página.`,
      serviceId: service.id
    })
    try {
      const response = await servicesApi.deployProjectArchive(
        service.id,
        {
          file,
          progressSessionId,
          healthcheck: service.healthcheck,
          autoRollback: service.autoRollback ?? true,
          versionMetadata,
          nodeServiceMode: service.nodeServiceMode,
          nodeSiteConfig: service.nodeSiteConfig
        },
        publishProgress
      )
      const job = response.data?.job || {}
      const jobId = response.data?.jobId || job.id
      if (response.status === 202 || response.data?.accepted) {
        publishProgress((current) => ({
          ...(current || {}),
          progressSessionId,
          jobId,
          status: 'processing',
          phase: job.phase || 'process',
          progress: job.progressPercent ?? 34,
          message: response.data?.message || 'Publicação em andamento no servidor...',
          events: response.data?.progress || current?.events || []
        }))
        await monitorJob(jobId, progressSessionId)
        return
      }
      publishProgress({
        progressSessionId,
        jobId,
        status: 'success',
        phase: 'done',
        progress: 100,
        message: 'Versão publicada com sucesso.',
        events: response.data?.progress || []
      })
      onDeployNotification({
        type: 'success',
        title: 'Deploy concluído',
        message: 'A nova versão foi publicada com sucesso.',
        serviceId: service.id
      })
      clearSelectedFile()
      await onReload()
    } catch (err) {
      const message = err.response?.data?.message || err.message || 'Falha na publicação'
      setDeployError(message)
      publishProgress({
        progressSessionId,
        status: 'error',
        phase: 'error',
        message,
        error: message
      })
      onDeployNotification({
        type: 'error',
        title: 'Falha no deploy',
        message,
        serviceId: service.id
      })
    }
  }

  const handleRollback = async (deployment) => {
    setBusyVersionId(deployment.id)
    try {
      await servicesApi.rollback(service.id, deployment.id)
      await onReload()
    } finally {
      setBusyVersionId('')
    }
  }

  const handleDownload = async (deployment) => {
    setBusyVersionId(deployment.id)
    try {
      const { blob, filename } = await servicesApi.downloadVersion(service.id, deployment)
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      link.click()
      window.URL.revokeObjectURL(url)
    } finally {
      setBusyVersionId('')
    }
  }

  const handleRemove = async (deployment) => {
    if (!window.confirm(`Remover a versão ${deployment.versionLabel || deployment.id}?`)) return
    setBusyVersionId(deployment.id)
    try {
      await servicesApi.removeVersion(service.id, deployment.id)
      await onReload()
    } finally {
      setBusyVersionId('')
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
      <Panel title="Publicar nova versão" icon={UploadCloud}>
        <div className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-xs text-slate-500">Arquivo da versão</span>
            <input
              className="block w-full rounded-lg border border-dashed border-slate-700 bg-slate-950 p-3 text-sm text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-blue-600 file:px-3 file:py-2 file:text-xs file:font-medium file:text-white"
              type="file"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-xs text-slate-500">Modo de versão</span>
              <select className={fieldClass} value={versionMode} onChange={(event) => setVersionMode(event.target.value)}>
                <option value="auto">Gerar automaticamente</option>
                <option value="manual">Informar versão</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-xs text-slate-500">Tipo</span>
              <select className={fieldClass} value={versionChangeType} onChange={(event) => setVersionChangeType(event.target.value)}>
                {CHANGE_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-xs text-slate-500">Versão do app</span>
              <input className={fieldClass} value={versionAppVersion} onChange={(event) => setVersionAppVersion(event.target.value)} placeholder="ex: 1.8.0" />
            </label>
            <label className="block">
              <span className="mb-2 block text-xs text-slate-500">Build</span>
              <input className={fieldClass} value={versionBuildNumber} onChange={(event) => setVersionBuildNumber(event.target.value)} placeholder="ex: 42" />
            </label>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-xs text-slate-400">
            Healthcheck: {service.healthcheck?.enabled ? `${service.healthcheck.target} / ${service.healthcheck.retries} tentativa(s)` : 'não configurado'}.
            Rollback automático: {service.autoRollback === false ? 'desativado' : 'ativado'}.
          </div>
          <button className={primaryButtonClass} type="button" onClick={handleDeploy} disabled={deployRunning}>
            {deployRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            {deployRunning ? 'Publicando...' : 'Publicar versão'}
          </button>
          <DeployProgressPanel progress={progress} error={error || progress?.error} />
        </div>
      </Panel>
      <Panel title="Versões publicadas" icon={History}>
        <DeployHistory
          service={service}
          busyVersionId={busyVersionId}
          onRollback={handleRollback}
          onDownload={handleDownload}
          onRemove={handleRemove}
        />
      </Panel>
    </div>
  )
}

const EnvVariablesEditor = ({ rows, onChange }) => {
  const updateRow = (index, patch) => {
    onChange(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)))
  }
  const removeRow = (index) => {
    onChange(rows.filter((_, rowIndex) => rowIndex !== index))
  }
  return (
    <div className="space-y-3">
      {rows.map((row, index) => (
        <div key={`${row.key}-${index}`} className="grid gap-2 rounded-lg border border-slate-800 bg-slate-900/40 p-3 md:grid-cols-[1fr_1fr_auto_auto]">
          <input className={fieldClass} value={row.key} onChange={(event) => updateRow(index, { key: event.target.value })} placeholder="KEY" />
          <input className={fieldClass} value={row.value} type={row.secret ? 'password' : 'text'} onChange={(event) => updateRow(index, { value: event.target.value })} placeholder="value" />
          <label className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-300">
            <input type="checkbox" checked={row.secret} onChange={(event) => updateRow(index, { secret: event.target.checked })} />
            Secret
          </label>
          <button className="inline-flex items-center justify-center rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-rose-200 hover:bg-rose-500/20" type="button" onClick={() => removeRow(index)}>
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      <button className={smallButtonClass} type="button" onClick={() => onChange([...rows, { key: '', value: '', secret: false }])}>
        <Plus className="h-4 w-4" />
        Adicionar variável
      </button>
    </div>
  )
}

const ServiceEnvironmentTab = ({ service, envRows, setEnvRows, onReload }) => {
  const [saving, setSaving] = useState('')
  const [message, setMessage] = useState('')

  const saveEnv = async (apply) => {
    setSaving(apply ? 'apply' : 'save')
    setMessage('')
    try {
      const cleanRows = envRows
        .map((row) => ({ key: row.key.trim(), value: row.value, secret: Boolean(row.secret) }))
        .filter((row) => row.key)
      await serviceEnvironmentApi.upsert(service.id, cleanRows, { apply })
      setMessage(apply ? 'ENV aplicada ao serviço.' : 'ENV salva como configuração pendente.')
      await onReload()
    } catch (err) {
      setMessage(err.response?.data?.message || err.message || 'Falha ao salvar ENV')
    } finally {
      setSaving('')
    }
  }

  return (
    <Panel
      title="Variáveis de ambiente"
      icon={Lock}
      actions={
        <div className="flex flex-wrap gap-2">
          <button className={smallButtonClass} type="button" onClick={() => setEnvRows(cloneEnvRows(service.envVars || []))}>
            <X className="h-4 w-4" />
            Descartar
          </button>
          <button className={smallButtonClass} type="button" onClick={() => saveEnv(false)} disabled={Boolean(saving)}>
            <Save className="h-4 w-4" />
            Salvar
          </button>
          <button className={primaryButtonClass} type="button" onClick={() => saveEnv(true)} disabled={Boolean(saving)}>
            {saving === 'apply' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            Aplicar
          </button>
        </div>
      }
    >
      <EnvVariablesEditor rows={envRows} onChange={setEnvRows} />
      {message ? <p className="mt-3 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-300">{message}</p> : null}
    </Panel>
  )
}

const LogsViewer = ({ logs, loading }) => {
  if (loading) {
    return (
      <div className="flex h-80 items-center justify-center rounded-lg bg-slate-950 font-mono text-sm text-slate-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Carregando logs...
      </div>
    )
  }
  return (
    <div className="h-[520px] overflow-auto rounded-lg border border-slate-800 bg-black p-3 font-mono text-xs leading-5 text-slate-300">
      {logs?.entries?.length ? logs.entries.map((entry) => (
        <div key={entry.id} className="grid gap-2 border-b border-white/5 py-1 md:grid-cols-[170px_60px_1fr]">
          <span className="text-slate-600">{entry.timestamp || '-'}</span>
          <span className={
            entry.level === 'error'
              ? 'text-rose-300'
              : entry.level === 'warn'
                ? 'text-amber-300'
                : 'text-emerald-300'
          }>
            {entry.level}
          </span>
          <span className="whitespace-pre-wrap break-words">{entry.message}</span>
        </div>
      )) : <p className="text-slate-600">Sem logs para os filtros atuais.</p>}
    </div>
  )
}

const ServiceLogsTab = ({ service }) => {
  const [filters, setFilters] = useState({ tail: 300, level: 'all', search: '' })
  const [logs, setLogs] = useState({ entries: [] })
  const [loading, setLoading] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(false)

  const loadLogs = useCallback(async () => {
    setLoading(true)
    try {
      const payload = await serviceLogsApi.getLogs(service.id, filters)
      setLogs(payload)
    } finally {
      setLoading(false)
    }
  }, [filters, service.id])

  useEffect(() => {
    loadLogs()
  }, [loadLogs])

  useEffect(() => {
    if (!autoRefresh) return undefined
    const timer = window.setInterval(loadLogs, 5000)
    return () => window.clearInterval(timer)
  }, [autoRefresh, loadLogs])

  return (
    <Panel
      title="Logs"
      icon={Terminal}
      actions={
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-300">
            <input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />
            Auto-refresh
          </label>
          <button className={smallButtonClass} type="button" onClick={loadLogs}>
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      }
    >
      <div className="mb-3 grid gap-2 md:grid-cols-[140px_140px_1fr]">
        <select className={fieldClass} value={filters.tail} onChange={(event) => setFilters((current) => ({ ...current, tail: Number(event.target.value) }))}>
          <option value={100}>100 linhas</option>
          <option value={300}>300 linhas</option>
          <option value={1000}>1000 linhas</option>
        </select>
        <select className={fieldClass} value={filters.level} onChange={(event) => setFilters((current) => ({ ...current, level: event.target.value }))}>
          <option value="all">Todos níveis</option>
          <option value="info">Info</option>
          <option value="warn">Warn</option>
          <option value="error">Error</option>
          <option value="debug">Debug</option>
        </select>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-600" />
          <input className={`${fieldClass} w-full pl-9`} value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Buscar nos logs" />
        </div>
      </div>
      <LogsViewer logs={logs} loading={loading} />
    </Panel>
  )
}

const MetricsPanel = ({ metrics }) => {
  const current = metrics?.current || {}
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <SummaryCard icon={Cpu} label="CPU" value={`${current.cpuPercent ?? 0}%`} detail="Docker stats" tone="blue" />
      <SummaryCard icon={Database} label="Memória" value={formatBytes(current.memoryUsage)} detail={`${current.memoryPercent ?? 0}% usado`} />
      <SummaryCard icon={Network} label="Rede in/out" value="-" detail="preparado para coletor" />
      <SummaryCard icon={HardDrive} label="Disco r/w" value="-" detail="preparado para coletor" />
      <SummaryCard icon={RefreshCcw} label="Restarts" value={current.restartCount ?? 0} detail="desde criação do container" />
      <SummaryCard icon={Clock3} label="Uptime" value={formatUptime(current.uptimeSeconds)} detail="container atual" tone="green" />
      <SummaryCard icon={Activity} label="Requests" value={current.requestsPerMinute ?? '-'} detail="Loki/Otel futuro" />
      <SummaryCard icon={AlertTriangle} label="Errors" value={current.errorRate ?? '-'} detail="Loki/Otel futuro" />
    </div>
  )
}

const ServiceMetricsTab = ({ service }) => {
  const [range, setRange] = useState('15m')
  const [metrics, setMetrics] = useState(null)
  const [loading, setLoading] = useState(false)

  const loadMetrics = useCallback(async () => {
    setLoading(true)
    try {
      setMetrics(await serviceMetricsApi.getMetrics(service.id, range))
    } finally {
      setLoading(false)
    }
  }, [range, service.id])

  useEffect(() => {
    loadMetrics()
  }, [loadMetrics])

  return (
    <Panel
      title="Métricas"
      icon={BarChart3}
      actions={
        <div className="flex gap-2">
          <select className={fieldClass} value={range} onChange={(event) => setRange(event.target.value)}>
            <option value="15m">15 min</option>
            <option value="1h">1 hora</option>
            <option value="6h">6 horas</option>
            <option value="24h">24 horas</option>
          </select>
          <button className={smallButtonClass} type="button" onClick={loadMetrics}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            Refresh
          </button>
        </div>
      }
    >
      <MetricsPanel metrics={metrics} />
    </Panel>
  )
}

const ServiceActivityTab = ({ service }) => {
  const [events, setEvents] = useState([])
  const [level, setLevel] = useState('all')

  useEffect(() => {
    let active = true
    serviceActivityApi.list(service.id, { level }).then((items) => {
      if (active) setEvents(items)
    }).catch(() => {
      if (active) setEvents([])
    })
    return () => {
      active = false
    }
  }, [level, service.id])

  return (
    <Panel
      title="Activity timeline"
      icon={History}
      actions={
        <select className={fieldClass} value={level} onChange={(event) => setLevel(event.target.value)}>
          <option value="all">Todos</option>
          <option value="success">Sucesso</option>
          <option value="info">Info</option>
          <option value="warn">Avisos</option>
          <option value="error">Erros</option>
        </select>
      }
    >
      <ActivityTimeline events={events} />
    </Panel>
  )
}

const splitRepoFullName = (fullName = '') => {
  const [owner, repo] = String(fullName || '').split('/')
  return { owner, repo }
}

const ServiceTerminalTab = ({ service }) => {
  const termRef = useRef(null)
  const socketRef = useRef(null)
  const xtermRef = useRef(null)
  const [connected, setConnected] = useState(false)
  const containerId = service?.containerId

  useEffect(() => {
    let term = null
    let fit = null
    const initXterm = async () => {
      const { Terminal: XTerm } = await import('xterm')
      const { FitAddon } = await import('@xterm/addon-fit')
      await import('xterm/css/xterm.css')
      term = new XTerm({ cursorBlink: true, fontSize: 13, theme: { background: '#0a0a0a' } })
      fit = new FitAddon()
      term.loadAddon(fit)
      if (termRef.current) {
        term.open(termRef.current)
        fit.fit()
      }
      xtermRef.current = { term, fit }

      const socket = createDockerTerminalSocket()
      socketRef.current = socket

      socket.on('connect', () => {
        socket.emit('attach', { containerId })
      })
      socket.on('ready', () => setConnected(true))
      socket.on('output', ({ data }) => term.write(data))
      socket.on('done', () => {
        term.write('\r\n[Sessão encerrada]\r\n')
        setConnected(false)
      })
      socket.on('error', ({ message }) => term.write(`\r\n[Erro: ${message}]\r\n`))

      term.onData((data) => {
        if (socket.connected) socket.emit('input', { data })
      })
      term.onResize(({ cols, rows }) => {
        if (socket.connected) socket.emit('resize', { cols, rows })
      })
    }
    if (containerId) initXterm()

    return () => {
      socketRef.current?.disconnect()
      socketRef.current = null
      xtermRef.current?.term?.dispose()
      xtermRef.current = null
    }
  }, [containerId])

  useEffect(() => {
    const handleResize = () => xtermRef.current?.fit?.fit()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  if (!containerId) {
    return (
      <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-6">
        <p className="text-sm text-slate-400">Container não disponível. Inicie o serviço para acessar o terminal.</p>
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-white">
          <Terminal className="h-4 w-4 text-emerald-300" />
          Terminal do Container
        </h2>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${connected ? 'bg-emerald-500/10 text-emerald-200 border border-emerald-500/30' : 'bg-slate-800 text-slate-400 border border-slate-700'}`}>
          {connected ? 'Conectado' : 'Conectando...'}
        </span>
      </div>
      <div ref={termRef} className="min-h-[350px] rounded-lg overflow-hidden" />
    </section>
  )
}

const ServiceDeliveryTab = ({ service, onReload }) => {
  const [connectionState, setConnectionState] = useState({ connections: [], defaultConnectionId: null })
  const [token, setToken] = useState('')
  const [repos, setRepos] = useState([])
  const [branches, setBranches] = useState([])
  const [selectedRepo, setSelectedRepo] = useState(service.delivery?.repository || '')
  const [selectedBranch, setSelectedBranch] = useState(service.delivery?.branch || 'main')
  const [analysis, setAnalysis] = useState(null)
  const [selectedBlueprintId, setSelectedBlueprintId] = useState(service.delivery?.blueprint?.id || '')
  const [deployMode, setDeployMode] = useState(service.delivery?.deployMode || 'manual')
  const [workflow, setWorkflow] = useState(null)
  const [message, setMessage] = useState('')
  const [loadingAction, setLoadingAction] = useState('')
  const [editingToken, setEditingToken] = useState(false)

  const connectionId = connectionState.defaultConnectionId
  const activeConnection = connectionState.connections?.[0] || null
  const selectedBlueprint = useMemo(() => {
    const candidates = analysis?.blueprints || []
    return candidates.find((blueprint) => blueprint.id === selectedBlueprintId) || candidates[0] || service.delivery?.blueprint || null
  }, [analysis, selectedBlueprintId, service.delivery?.blueprint])

  const loadStatus = useCallback(async () => {
    const status = await githubDeliveryApi.status()
    setConnectionState(status)
    return status
  }, [])

  const loadRepos = useCallback(async (id = connectionId) => {
    if (!id) return []
    const items = await githubDeliveryApi.listRepositories(id)
    setRepos(items)
    if (!selectedRepo && items[0]) {
      setSelectedRepo(items[0].fullName)
      setSelectedBranch(items[0].defaultBranch || 'main')
    }
    return items
  }, [connectionId, selectedRepo])

  const loadBranches = useCallback(async () => {
    if (!selectedRepo || !connectionId) return
    const { owner, repo } = splitRepoFullName(selectedRepo)
    if (!owner || !repo) return
    const items = await githubDeliveryApi.listBranches({ connectionId, owner, repo })
    setBranches(items)
    if (!items.some((branch) => branch.name === selectedBranch)) {
      setSelectedBranch(items[0]?.name || selectedBranch || 'main')
    }
  }, [connectionId, selectedBranch, selectedRepo])

  useEffect(() => {
    let active = true
    loadStatus()
      .then((status) => {
        if (!active || !status.defaultConnectionId) return null
        return githubDeliveryApi.listRepositories(status.defaultConnectionId)
      })
      .then((items) => {
        if (!active || !Array.isArray(items)) return
        setRepos(items)
        if (!selectedRepo && items[0]) {
          setSelectedRepo(items[0].fullName)
          setSelectedBranch(items[0].defaultBranch || 'main')
        }
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [loadStatus, selectedRepo])

  useEffect(() => {
    loadBranches().catch(() => {})
  }, [loadBranches])

  const connectGithub = async () => {
    setLoadingAction('connect')
    setMessage('')
    try {
      const status = await githubDeliveryApi.connect({ token })
      setConnectionState(status)
      setToken('')
      setEditingToken(false)
      await loadRepos(status.defaultConnectionId)
      setMessage(activeConnection ? 'Token GitHub atualizado.' : 'GitHub conectado.')
    } catch (err) {
      setMessage(err.response?.data?.message || err.message || 'Falha ao conectar GitHub')
    } finally {
      setLoadingAction('')
    }
  }

  const removeGithubConnection = async () => {
    if (!connectionId) return
    if (!window.confirm('Remover a conexão GitHub salva neste painel?')) return
    setLoadingAction('remove-connection')
    setMessage('')
    try {
      const status = await githubDeliveryApi.removeConnection(connectionId)
      setConnectionState(status)
      setRepos([])
      setBranches([])
      setToken('')
      setEditingToken(false)
      setMessage('Conexão GitHub removida.')
    } catch (err) {
      setMessage(err.response?.data?.message || err.message || 'Falha ao remover conexão GitHub')
    } finally {
      setLoadingAction('')
    }
  }

  const analyzeRepo = async () => {
    setLoadingAction('analyze')
    setMessage('')
    try {
      const { owner, repo } = splitRepoFullName(selectedRepo)
      const result = await githubDeliveryApi.analyze({ connectionId, owner, repo, branch: selectedBranch })
      setAnalysis(result)
      setSelectedBlueprintId(result.blueprints?.[0]?.id || '')
      setMessage(`${result.blueprints?.length || 0} blueprint(s) detectado(s).`)
    } catch (err) {
      setMessage(err.response?.data?.message || err.message || 'Falha ao analisar repositório')
    } finally {
      setLoadingAction('')
    }
  }

  const saveDelivery = async () => {
    if (!selectedBlueprint) {
      setMessage('Analise o repositório e selecione um blueprint.')
      return
    }
    setLoadingAction('save')
    setMessage('')
    try {
      await githubDeliveryApi.saveServiceDelivery(service.id, {
        connectionId,
        repository: selectedRepo,
        branch: selectedBranch,
        blueprint: selectedBlueprint,
        deployMode,
        healthcheck: selectedBlueprint.healthcheck
      })
      setMessage('Configuração Delivery salva no serviço.')
      await onReload()
    } catch (err) {
      setMessage(err.response?.data?.message || err.message || 'Falha ao salvar Delivery')
    } finally {
      setLoadingAction('')
    }
  }

  const generateWorkflow = async (saveToGitHub = false) => {
    if (!selectedBlueprint) {
      setMessage('Selecione um blueprint para gerar workflow.')
      return
    }
    setLoadingAction(saveToGitHub ? 'save-workflow' : 'workflow')
    setMessage('')
    try {
      const result = await githubDeliveryApi.generateWorkflow(service.id, {
        connectionId,
        repository: selectedRepo,
        branch: selectedBranch,
        blueprint: selectedBlueprint,
        deployMode,
        saveToGitHub
      })
      setWorkflow(result.workflow)
      setMessage(saveToGitHub ? 'Workflow salvo no GitHub.' : 'Workflow gerado.')
      await onReload()
    } catch (err) {
      setMessage(err.response?.data?.message || err.message || 'Falha ao gerar workflow')
    } finally {
      setLoadingAction('')
    }
  }

  const dispatchWorkflow = async () => {
    setLoadingAction('dispatch')
    setMessage('')
    try {
      await githubDeliveryApi.dispatchWorkflow(service.id, {
        connectionId,
        repository: selectedRepo || service.delivery?.repository,
        branch: selectedBranch || service.delivery?.branch,
        workflowPath: service.delivery?.workflowPath || workflow?.path
      })
      setMessage('Workflow manual disparado no GitHub.')
      await onReload()
    } catch (err) {
      setMessage(err.response?.data?.message || err.message || 'Falha ao disparar workflow')
    } finally {
      setLoadingAction('')
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
      <Panel title="GitHub connection" icon={GitBranch}>
        <div className="space-y-4">
          {activeConnection ? (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-100">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>Conectado como {activeConnection.accountLogin}. Repositórios disponíveis: {repos.length}.</span>
                <div className="flex flex-wrap gap-2">
                  <button className={smallButtonClass} type="button" onClick={() => setEditingToken((value) => !value)}>
                    {editingToken ? 'Cancelar alteração' : 'Alterar token'}
                  </button>
                  <button className="inline-flex items-center justify-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50" type="button" onClick={removeGithubConnection} disabled={loadingAction === 'remove-connection'}>
                    {loadingAction === 'remove-connection' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    Remover
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {!activeConnection || editingToken ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-400">
                {activeConnection ? 'Cole o novo token para substituir a conexão atual.' : <>
                  Use um <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer" className="text-blue-400 underline hover:text-blue-300">fine-grained token</a> com acesso de leitura aos repositórios. Para salvar workflow, inclua permissão de conteúdo escrita.
                </>}
              </p>
              <input className={`${fieldClass} w-full`} type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="github_pat_..." />
              <button className={primaryButtonClass} type="button" onClick={connectGithub} disabled={!token || loadingAction === 'connect'}>
                {loadingAction === 'connect' ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitBranch className="h-4 w-4" />}
                {activeConnection ? 'Atualizar token' : 'Conectar GitHub'}
              </button>
            </div>
          ) : null}

          <div className="grid gap-3">
            <label className="block">
              <span className="mb-2 block text-xs text-slate-500">Repositório</span>
              <select className={`${fieldClass} w-full`} value={selectedRepo} onChange={(event) => setSelectedRepo(event.target.value)} disabled={!repos.length}>
                <option value="">Selecione</option>
                {repos.map((repo) => (
                  <option key={repo.id} value={repo.fullName}>{repo.fullName}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-xs text-slate-500">Branch</span>
              <select className={`${fieldClass} w-full`} value={selectedBranch} onChange={(event) => setSelectedBranch(event.target.value)}>
                {branches.length ? branches.map((branch) => (
                  <option key={branch.name} value={branch.name}>{branch.name}</option>
                )) : <option value={selectedBranch}>{selectedBranch}</option>}
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-xs text-slate-500">Deploy</span>
              <select className={`${fieldClass} w-full`} value={deployMode} onChange={(event) => setDeployMode(event.target.value)}>
                <option value="manual">Manual</option>
                <option value="push">Automático por push</option>
                <option value="tag">Automático por tag v*</option>
              </select>
            </label>
            <button className={smallButtonClass} type="button" onClick={analyzeRepo} disabled={!selectedRepo || !selectedBranch || loadingAction === 'analyze'}>
              {loadingAction === 'analyze' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Analisar projeto
            </button>
          </div>
          {message ? <p className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-300">{message}</p> : null}
        </div>
      </Panel>

      <Panel title="Project blueprint" icon={Package}>
        <div className="space-y-4">
          {service.delivery ? (
            <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-3 text-sm text-blue-100">
              Vinculado em {service.delivery.repository || '-'} / {service.delivery.branch || '-'} / {service.delivery.projectPath || '.'}
            </div>
          ) : null}

          <div className="grid gap-3 lg:grid-cols-2">
            {(analysis?.blueprints || (service.delivery?.blueprint ? [service.delivery.blueprint] : [])).map((blueprint) => (
              <button
                key={blueprint.id}
                type="button"
                className={`rounded-xl border p-3 text-left transition ${
                  selectedBlueprint?.id === blueprint.id
                    ? 'border-blue-500/50 bg-blue-500/10'
                    : 'border-slate-800 bg-slate-900/40 hover:border-slate-600'
                }`}
                onClick={() => setSelectedBlueprintId(blueprint.id)}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-white">{blueprint.label}</p>
                  <span className="rounded-full border border-slate-700 px-2 py-1 text-xs text-slate-400">{blueprint.confidence}</span>
                </div>
                <p className="mt-2 text-sm text-slate-400">{blueprint.projectPath || '.'}</p>
                <p className="mt-1 text-xs text-slate-500">{blueprint.buildType} / {blueprint.imageName}</p>
              </button>
            ))}
          </div>

          {selectedBlueprint ? (
            <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-sm text-slate-300">
              <div className="grid gap-2 sm:grid-cols-2">
                <InfoRow label="Build" value={selectedBlueprint.buildCommand || selectedBlueprint.buildType} />
                <InfoRow label="Artefato" value={selectedBlueprint.artifactPath || '.'} />
                <InfoRow label="Porta" value={selectedBlueprint.containerPort} />
                <InfoRow label="Healthcheck" value={selectedBlueprint.healthcheck?.target || '-'} />
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Conecte o GitHub e analise um repositório para escolher o blueprint.</p>
          )}

          <div className="flex flex-wrap gap-2">
            <button className={smallButtonClass} type="button" onClick={saveDelivery} disabled={!selectedBlueprint || loadingAction === 'save'}>
              <Save className="h-4 w-4" />
              Salvar vínculo
            </button>
            <button className={smallButtonClass} type="button" onClick={() => generateWorkflow(false)} disabled={!selectedBlueprint || loadingAction === 'workflow'}>
              <Copy className="h-4 w-4" />
              Gerar workflow
            </button>
            <button className={primaryButtonClass} type="button" onClick={() => generateWorkflow(true)} disabled={!selectedBlueprint || !selectedRepo || loadingAction === 'save-workflow'}>
              {loadingAction === 'save-workflow' ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
              Salvar workflow no GitHub
            </button>
            <button className={smallButtonClass} type="button" onClick={dispatchWorkflow} disabled={!(service.delivery?.workflowPath || workflow?.path) || loadingAction === 'dispatch'}>
              {loadingAction === 'dispatch' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Executar workflow
            </button>
          </div>

          {workflow?.content ? (
            <textarea className={`${fieldClass} h-80 w-full font-mono text-xs`} value={workflow.content} readOnly />
          ) : null}
        </div>
      </Panel>
    </div>
  )
}

const ServiceSettingsTab = ({ service, settingsState, setSettingsState, onReload }) => {
  const [saving, setSaving] = useState('')
  const [deleteText, setDeleteText] = useState('')
  const [message, setMessage] = useState('')
  const navigate = useNavigate()

  const saveSettings = async (apply) => {
    setSaving(apply ? 'apply' : 'save')
    setMessage('')
    try {
      await servicesApi.update(service.id, {
        hostPort: settingsState.hostPort ? Number(settingsState.hostPort) : null,
        networkName: settingsState.networkName,
        command: settingsState.command,
        bindLocalOnly: settingsState.bindLocalOnly,
        autoRollback: settingsState.autoRollback,
        healthcheck: settingsState.healthcheck,
        nodeServiceMode: settingsState.nodeServiceMode,
        nodeSiteConfig: settingsState.nodeSiteConfig,
        apply
      })
      setMessage(apply ? 'Configuração aplicada.' : 'Configuração salva como pendente.')
      await onReload()
    } catch (err) {
      setMessage(err.response?.data?.message || err.message || 'Falha ao salvar configuração')
    } finally {
      setSaving('')
    }
  }

  const removeService = async () => {
    if (deleteText !== service.name) return
    await servicesApi.remove(service.id, { removeFolder: false })
    navigate('/docker')
  }

  const setHealthcheck = (patch) => {
    setSettingsState((current) => ({
      ...current,
      healthcheck: {
        ...(current.healthcheck || {}),
        ...patch
      }
    }))
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_0.8fr]">
      <Panel
        title="Configuração"
        icon={Settings}
        actions={
          <div className="flex flex-wrap gap-2">
            <button className={smallButtonClass} type="button" onClick={() => saveSettings(false)} disabled={Boolean(saving)}>
              <Save className="h-4 w-4" />
              Salvar
            </button>
            <button className={primaryButtonClass} type="button" onClick={() => saveSettings(true)} disabled={Boolean(saving)}>
              {saving === 'apply' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              Aplicar
            </button>
          </div>
        }
      >
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-xs text-slate-500">Nome</span>
            <input className={`${fieldClass} opacity-70`} value={service.name || ''} readOnly />
          </label>
          <label className="block">
            <span className="mb-2 block text-xs text-slate-500">Imagem</span>
            <input className={`${fieldClass} opacity-70`} value={service.image || ''} readOnly />
          </label>
          <label className="block">
            <span className="mb-2 block text-xs text-slate-500">Porta host</span>
            <input className={fieldClass} value={settingsState.hostPort} onChange={(event) => setSettingsState((current) => ({ ...current, hostPort: event.target.value }))} />
          </label>
          <label className="block">
            <span className="mb-2 block text-xs text-slate-500">Network</span>
            <input className={fieldClass} value={settingsState.networkName} onChange={(event) => setSettingsState((current) => ({ ...current, networkName: event.target.value }))} />
          </label>
          <label className="block md:col-span-2">
            <span className="mb-2 block text-xs text-slate-500">Command</span>
            <input className={fieldClass} value={settingsState.command} onChange={(event) => setSettingsState((current) => ({ ...current, command: event.target.value }))} placeholder="opcional" />
          </label>
          <label className="inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm text-slate-300">
            <input type="checkbox" checked={settingsState.bindLocalOnly} onChange={(event) => setSettingsState((current) => ({ ...current, bindLocalOnly: event.target.checked }))} />
            Bind local only
          </label>
          <label className="inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm text-slate-300">
            <input type="checkbox" checked={settingsState.autoRollback} onChange={(event) => setSettingsState((current) => ({ ...current, autoRollback: event.target.checked }))} />
            Rollback automático
          </label>
        </div>
        <div className="mt-5 rounded-xl border border-slate-800 bg-slate-900/40 p-3">
          <h3 className="mb-3 text-sm font-semibold text-white">Healthcheck</h3>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-300">
              <input type="checkbox" checked={settingsState.healthcheck?.enabled || false} onChange={(event) => setHealthcheck({ enabled: event.target.checked })} />
              Validar URL/path
            </label>
            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-300">
              <input type="checkbox" checked={settingsState.healthcheck?.containerEnabled || false} onChange={(event) => setHealthcheck({ containerEnabled: event.target.checked })} />
              Health no container
            </label>
            <input className={fieldClass} value={settingsState.healthcheck?.target || '/'} onChange={(event) => setHealthcheck({ target: event.target.value })} placeholder="/health" />
            <input className={fieldClass} type="number" value={settingsState.healthcheck?.intervalSeconds || 10} onChange={(event) => setHealthcheck({ intervalSeconds: Number(event.target.value) })} placeholder="intervalo" />
            <input className={fieldClass} type="number" value={settingsState.healthcheck?.timeoutSeconds || 5} onChange={(event) => setHealthcheck({ timeoutSeconds: Number(event.target.value) })} placeholder="timeout" />
            <input className={fieldClass} type="number" value={settingsState.healthcheck?.retries || 6} onChange={(event) => setHealthcheck({ retries: Number(event.target.value) })} placeholder="tentativas" />
          </div>
        </div>
        {message ? <p className="mt-3 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-300">{message}</p> : null}
      </Panel>
      <Panel title="Danger zone" icon={AlertTriangle}>
        <div className="space-y-3">
          <p className="text-sm text-slate-400">Digite o nome do serviço para remover o registro e o container associado.</p>
          <input className={fieldClass} value={deleteText} onChange={(event) => setDeleteText(event.target.value)} placeholder={service.name} />
          <button className="inline-flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-200 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50" type="button" onClick={removeService} disabled={deleteText !== service.name}>
            <Trash2 className="h-4 w-4" />
            Remover serviço
          </button>
        </div>
      </Panel>
    </div>
  )
}

const buildSettingsState = (service = {}) => ({
  hostPort: service.hostPort || '',
  networkName: service.networkName || 'bridge',
  command: Array.isArray(service.command) ? service.command.join(' ') : service.command || '',
  bindLocalOnly: Boolean(service.bindLocalOnly),
  autoRollback: service.autoRollback !== false,
  healthcheck: {
    enabled: Boolean(service.healthcheck?.enabled),
    target: service.healthcheck?.target || '/',
    intervalSeconds: service.healthcheck?.intervalSeconds || 10,
    timeoutSeconds: service.healthcheck?.timeoutSeconds || 5,
    retries: service.healthcheck?.retries || 6,
    startPeriodSeconds: service.healthcheck?.startPeriodSeconds || 5,
    containerEnabled: Boolean(service.healthcheck?.containerEnabled)
  },
  nodeServiceMode: service.nodeServiceMode || 'service',
  nodeSiteConfig: service.nodeSiteConfig || null
})

const ServiceDetailsPage = () => {
  const { serviceId } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const activeTab = TABS.some((tab) => tab.id === requestedTab) ? requestedTab : 'overview'
  const [detail, setDetail] = useState(null)
  const [metrics, setMetrics] = useState(null)
  const [activity, setActivity] = useState([])
  const [envRows, setEnvRows] = useState([])
  const [settingsState, setSettingsState] = useState(buildSettingsState())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionState, setActionState] = useState('')
  const [deployProgress, setDeployProgress] = useState(null)
  const [deployNotification, setDeployNotification] = useState(null)

  const service = detail?.service

  const setActiveTab = useCallback((tabId) => {
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set('tab', tabId)
    setSearchParams(nextParams, { replace: true })
  }, [searchParams, setSearchParams])

  const handleDeployProgressChange = useCallback((nextProgress) => {
    setDeployProgress((current) => mergeDeployProgress(current, nextProgress))
  }, [])

  const handleDeployNotification = useCallback((notification) => {
    setDeployNotification({
      id: `${Date.now()}-${notification.type || 'info'}`,
      ...notification
    })
  }, [])

  const loadDetails = useCallback(async () => {
    setError('')
    const payload = await servicesApi.getById(serviceId)
    setDetail(payload)
    setActivity(payload.activity || [])
    if (payload.stats) {
      const memoryUsage = payload.stats.memoryUsage || 0
      const memoryLimit = payload.stats.memoryLimit || 0
      setMetrics((current) => ({
        ...(current || {}),
        current: {
          ...(current?.current || {}),
          cpuPercent: payload.stats.cpuPercent || 0,
          memoryUsage,
          memoryLimit,
          memoryPercent: memoryLimit ? Number(((memoryUsage / memoryLimit) * 100).toFixed(2)) : 0
        }
      }))
    }
  }, [serviceId])

  useEffect(() => {
    let active = true
    setLoading(true)
    envInitializedRef.current = false
    loadDetails()
      .catch((err) => {
        if (active) setError(err.response?.data?.message || err.message || 'Falha ao carregar serviço')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [loadDetails])

  const envInitializedRef = useRef(false)

  useEffect(() => {
    if (!service) return
    if (!envInitializedRef.current) {
      setEnvRows(cloneEnvRows(service.envVars || []))
      envInitializedRef.current = true
    }
    setSettingsState(buildSettingsState(service))
  }, [service])

  useEffect(() => {
    if (!serviceId) return undefined
    const timer = window.setInterval(() => {
      loadDetails().catch(() => {})
    }, 15000)
    return () => window.clearInterval(timer)
  }, [loadDetails, serviceId])

  useEffect(() => {
    if (!serviceId) return
    serviceMetricsApi.getMetrics(serviceId).then(setMetrics).catch(() => {})
    serviceActivityApi.list(serviceId).then(setActivity).catch(() => {})
  }, [serviceId])

  useEffect(() => {
    if (!deployNotification) return undefined
    const timeout = deployNotification.type === 'error' ? 14000 : deployNotification.type === 'success' ? 9000 : 6000
    const timer = window.setTimeout(() => setDeployNotification(null), timeout)
    return () => window.clearTimeout(timer)
  }, [deployNotification])

  const runServiceAction = async (label, action) => {
    setActionState(label)
    setError('')
    try {
      await action()
      await loadDetails()
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Falha na ação do serviço')
    } finally {
      setActionState('')
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-slate-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Carregando serviço...
      </div>
    )
  }

  if (error && !service) {
    return (
      <div className="space-y-4">
        <button className={smallButtonClass} type="button" onClick={() => navigate('/docker')}>
          <ArrowLeft className="h-4 w-4" />
          Container Service
        </button>
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-rose-100">{error}</div>
      </div>
    )
  }

  if (!service) return null
  const currentDeployProgress = deployProgress?.serviceId === service.id ? deployProgress : null

  return (
    <div className="space-y-4">
      <ServiceHeader
        service={service}
        actionState={actionState}
        onBack={() => navigate('/docker')}
        onDeploy={() => setActiveTab('deploys')}
        onEdit={() => setActiveTab('settings')}
        onStart={() => runServiceAction('Iniciando serviço...', () => servicesApi.start(service.id))}
        onStop={() => runServiceAction('Parando serviço...', () => servicesApi.stop(service.id))}
        onRestart={() => runServiceAction('Reiniciando serviço...', () => servicesApi.restart(service.id))}
      />
      <DeployNotification
        notification={deployNotification?.serviceId && deployNotification.serviceId !== service.id ? null : deployNotification}
        onClose={() => setDeployNotification(null)}
        onOpenDeploys={() => setActiveTab('deploys')}
      />
      {error ? <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</div> : null}
      <ActiveDeploymentBanner service={service} onOpenDeploys={() => setActiveTab('deploys')} />
      {currentDeployProgress && activeTab !== 'deploys' ? (
        <DeployProgressPanel
          progress={currentDeployProgress}
          error={currentDeployProgress.error}
          compact
          onOpenDeploys={() => setActiveTab('deploys')}
          onDismiss={!isDeployRunning(currentDeployProgress) ? () => setDeployProgress(null) : null}
        />
      ) : null}
      <ServiceSummaryCards service={service} metrics={metrics} />
      <ServiceTabs activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === 'overview' ? <ServiceOverviewTab service={service} detail={detail} activity={activity} /> : null}
      {activeTab === 'deploys' ? (
        <ServiceDeploysTab
          service={service}
          onReload={loadDetails}
          deployProgress={currentDeployProgress}
          onDeployProgressChange={handleDeployProgressChange}
          onDeployNotification={handleDeployNotification}
        />
      ) : null}
      {activeTab === 'delivery' ? <ServiceDeliveryTab service={service} onReload={loadDetails} /> : null}
      {activeTab === 'terminal' ? <ServiceTerminalTab service={service} /> : null}
      {activeTab === 'environment' ? (
        <ServiceEnvironmentTab service={service} envRows={envRows} setEnvRows={setEnvRows} onReload={() => { envInitializedRef.current = false; return loadDetails() }} />
      ) : null}
      {activeTab === 'logs' ? <ServiceLogsTab service={service} /> : null}
      {activeTab === 'metrics' ? <ServiceMetricsTab service={service} /> : null}
      {activeTab === 'activity' ? <ServiceActivityTab service={service} /> : null}
      {activeTab === 'settings' ? (
        <ServiceSettingsTab
          service={service}
          settingsState={settingsState}
          setSettingsState={setSettingsState}
          onReload={loadDetails}
        />
      ) : null}
    </div>
  )
}

export default ServiceDetailsPage
