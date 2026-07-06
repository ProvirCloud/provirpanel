import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useConfirm } from '../components/ui/ConfirmModal'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Brain,
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
  Zap,
  Sparkles
} from 'lucide-react'
import {
  serviceActivityApi,
  serviceEnvironmentApi,
  githubDeliveryApi,
  serviceLogsApi,
  serviceMetricsApi,
  servicesApi,
  zeusAiApi
} from '../services/serviceDetailsApi.js'
import { Send, RefreshCw, Bot, ClipboardCopy } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { createDockerTerminalSocket } from '../services/socket.js'
import AiFixPanel, { DeployAiDiagnosis } from '../components/AiFixPanel.jsx'

const TABS = [
  { id: 'overview', label: 'Overview', icon: Layers },
  { id: 'ai', label: 'AI', icon: Brain },
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

const normalizeDeploymentLogLine = (line) => {
  if (!line) return ''
  if (typeof line === 'string') return line
  return line.message || line.error || JSON.stringify(line)
}

const getDeploymentLogLines = (deployment = {}) => {
  const lines = (Array.isArray(deployment.deployLog) ? deployment.deployLog : [])
    .map(normalizeDeploymentLogLine)
    .filter(Boolean)
  const errorMessage = deployment.deployLogError || deployment.error
  if (errorMessage && !lines.some((line) => line.includes(errorMessage))) {
    return [...lines, `Erro: ${errorMessage}`]
  }
  return lines
}

const parseEnvFile = async (file) => {
  const content = await file.text()
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const index = line.indexOf('=')
      if (index === -1) return null
      const key = line.slice(0, index).trim()
      let value = line.slice(index + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      return key ? { key, value, secret: false } : null
    })
    .filter(Boolean)
}

const buildEnvMerge = (existing = [], incoming = []) => {
  const existingMap = new Map(existing.filter((env) => env?.key).map((env) => [env.key, env]))
  const overwrites = []

  incoming.forEach((env) => {
    const previous = existingMap.get(env.key)
    if (previous && previous.value !== env.value) {
      overwrites.push({
        key: env.key,
        previous: previous.value,
        next: env.value
      })
    }
    existingMap.set(env.key, env)
  })

  return {
    merged: Array.from(existingMap.values()),
    overwrites
  }
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
  const events = Array.isArray(normalized.events) ? normalized.events.map(formatDeployEvent).filter(Boolean).slice(-25) : []

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
        <div className="mt-3 max-h-72 overflow-auto rounded-lg border border-white/5 bg-slate-950/80 p-2 font-mono text-[11px] leading-5 text-slate-400">
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
  const [openLogId, setOpenLogId] = useState('')
  const [page, setPage] = useState(0)
  const [cleaning, setCleaning] = useState(false)
  const confirm = useConfirm()
  const perPage = 5
  const totalPages = Math.ceil(deployments.length / perPage)
  const visible = deployments.slice(page * perPage, (page + 1) * perPage)
  const failedCount = deployments.filter(d => d.status === 'failed').length
  const inactiveCount = deployments.filter(d => d.status !== 'active' && d.id !== service.activeDeploymentId).length

  const handleCleanFailed = async () => {
    const ok = await confirm({ title: 'Remover deploys falhos', message: `Remover ${failedCount} deploy(s) que falharam?`, confirmText: 'Remover', variant: 'danger' })
    if (!ok) return
    setCleaning(true)
    try {
      const failed = deployments.filter(d => d.status === 'failed')
      for (const d of failed) await onRemove(d, true)
    } finally { setCleaning(false) }
  }

  const handleCleanOld = async () => {
    const ok = await confirm({ title: 'Limpar versões antigas', message: `Remover ${inactiveCount} versão(ões) inativa(s)? A versão ativa será mantida.`, confirmText: 'Limpar', variant: 'danger' })
    if (!ok) return
    setCleaning(true)
    try {
      const inactive = deployments.filter(d => d.status !== 'active' && d.id !== service.activeDeploymentId)
      for (const d of inactive) await onRemove(d, true)
    } finally { setCleaning(false) }
  }

  if (!deployments.length) {
    return <p className="text-sm text-slate-500">Nenhuma versão publicada registrada.</p>
  }
  return (
    <div className="space-y-3">
      {/* Bulk actions */}
      {(failedCount > 0 || inactiveCount > 1) && (
        <div className="flex flex-wrap gap-2">
          {failedCount > 0 && (
            <button
              className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-[11px] font-medium text-rose-200 hover:bg-rose-500/20 disabled:opacity-50"
              onClick={handleCleanFailed}
              disabled={cleaning || !!busyVersionId}
            >
              <Trash2 className="h-3 w-3" />
              Remover falhos ({failedCount})
            </button>
          )}
          {inactiveCount > 1 && (
            <button
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-600/50 bg-slate-800/50 px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:bg-slate-700/50 disabled:opacity-50"
              onClick={handleCleanOld}
              disabled={cleaning || !!busyVersionId}
            >
              <Trash2 className="h-3 w-3" />
              Limpar antigos ({inactiveCount})
            </button>
          )}
        </div>
      )}
      {visible.map((deployment) => {
        const active = deployment.id === service.activeDeploymentId || deployment.status === 'active'
        const failed = deployment.status === 'failed'
        const busy = busyVersionId === deployment.id
        const logLines = getDeploymentLogLines(deployment)
        const logOpen = openLogId === deployment.id

        return (
          <div key={deployment.id} className={`rounded-lg border ${
            active ? 'border-emerald-500/30 bg-emerald-500/5' : failed ? 'border-rose-500/20 bg-rose-500/5' : 'border-slate-800 bg-slate-900/30'
          }`}>
            {/* Header */}
            <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate text-sm font-medium text-white">{formatDeploymentLabel(deployment)}</span>
                {active && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-100">
                    <CheckCircle2 className="h-3 w-3" /> ATIVA
                  </span>
                )}
                {failed && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold text-rose-200">
                    <AlertTriangle className="h-3 w-3" /> FALHOU
                  </span>
                )}
              </div>
              <span className="text-[11px] text-slate-500">{formatDateTime(deployment.finishedAt || deployment.createdAt)}</span>
              <div className="flex gap-1.5">
                <button className={smallButtonClass} type="button" onClick={() => setOpenLogId(logOpen ? '' : deployment.id)}>
                  <Terminal className="h-3.5 w-3.5" />
                  {logOpen ? 'Fechar' : 'Log'}
                </button>
                <button className={smallButtonClass} type="button" onClick={() => onDownload(deployment)} disabled={busy}>
                  <Download className="h-3.5 w-3.5" />
                </button>
                <button className={smallButtonClass} type="button" onClick={() => onRollback(deployment)} disabled={active || busy}>
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
                <button className="inline-flex items-center rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-200 hover:bg-rose-500/20 disabled:opacity-50" type="button" onClick={() => onRemove(deployment)} disabled={active || busy}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Expanded log + AI */}
            {logOpen && (
              <div className="border-t border-slate-800 px-3 py-3 space-y-2">
                {(deployment.deployLogError || deployment.error) && (
                  <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                    {deployment.deployLogError || deployment.error}
                  </div>
                )}
                {logLines.length > 0 && (
                  <div className="max-h-48 overflow-auto rounded-md bg-black/60 p-2.5 font-mono text-[10px] leading-4 text-slate-400">
                    {logLines.map((line, index) => (
                      <p key={`${deployment.id}-${index}`}>{line}</p>
                    ))}
                  </div>
                )}
                {failed && (
                  <DeployAiDiagnosis service={service} deployment={deployment} />
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            className={smallButtonClass}
            type="button"
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            ←
          </button>
          <span className="text-xs text-slate-400">{page + 1} / {totalPages}</span>
          <button
            className={smallButtonClass}
            type="button"
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
          >
            →
          </button>
        </div>
      )}
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
  const [versionsVisible, setVersionsVisible] = useState(false)
  const mountedRef = useRef(true)
  const confirm = useConfirm()
  const progress = deployProgress
  const deployRunning = isDeployRunning(progress)
  const deployments = Array.isArray(service.deployments) ? service.deployments : []
  const activeDeployment = getActiveDeployment(service)

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

  const handleRemove = async (deployment, silent = false) => {
    if (!silent) {
      const ok = await confirm({ title: 'Remover versão', message: `Remover a versão ${deployment.versionLabel || deployment.id}?`, confirmText: 'Remover', variant: 'danger' })
      if (!ok) return
    }
    setBusyVersionId(deployment.id)
    try {
      await servicesApi.removeVersion(service.id, deployment.id)
      if (!silent) await onReload()
    } finally {
      setBusyVersionId('')
    }
    if (silent) await onReload()
  }

  return (
    <div className="space-y-4">
      <Panel
        title="Publicar nova versão"
        icon={UploadCloud}
        actions={
          deployments.length ? (
            <button className={smallButtonClass} type="button" onClick={() => setVersionsVisible((current) => !current)}>
              <History className="h-4 w-4" />
              {versionsVisible ? 'Ocultar versões' : `Ver versões (${deployments.length})`}
            </button>
          ) : null
        }
      >
        <div className="space-y-4">
          {activeDeployment ? (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
              Versão ativa atual: <span className="font-semibold text-white">{formatDeploymentLabel(activeDeployment)}</span>
              {' '}· publicada em {formatDateTime(activeDeployment.promotedAt || activeDeployment.finishedAt || activeDeployment.createdAt)}
            </div>
          ) : null}
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
          <AiFixPanel service={service} onReload={onReload} />
        </div>
      </Panel>

      {versionsVisible ? (
        <Panel
          title="Versões publicadas"
          icon={History}
          actions={
            <button className={smallButtonClass} type="button" onClick={() => setVersionsVisible(false)}>
              <X className="h-4 w-4" />
              Fechar
            </button>
          }
        >
          <DeployHistory
            service={service}
            busyVersionId={busyVersionId}
            onRollback={handleRollback}
            onDownload={handleDownload}
            onRemove={handleRemove}
          />
        </Panel>
      ) : (
        <button
          className="flex w-full flex-col gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-left text-sm text-slate-300 transition hover:border-blue-500/30 hover:bg-slate-900/80 sm:flex-row sm:items-center sm:justify-between"
          type="button"
          onClick={() => setVersionsVisible(true)}
        >
          <span className="inline-flex min-w-0 items-center gap-2">
            <History className="h-4 w-4 shrink-0 text-blue-300" />
            <span className="truncate">
              Versões publicadas ocultas
              {activeDeployment ? ` · ativa: ${formatDeploymentLabel(activeDeployment)}` : ''}
            </span>
          </span>
          <span className="text-xs text-blue-200">{deployments.length ? `Ver ${deployments.length} versão(ões)` : 'Nenhuma versão registrada'}</span>
        </button>
      )}
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
  const [importStatus, setImportStatus] = useState('')
  const [pendingEnvImport, setPendingEnvImport] = useState(null)

  const saveEnv = async (apply) => {
    setSaving(apply ? 'apply' : 'save')
    setMessage('')
    try {
      const cleanRows = envRows
        .map((row) => ({ key: row.key.trim(), value: row.value, secret: Boolean(row.secret) }))
        .filter((row) => row.key)
      await serviceEnvironmentApi.upsert(service.id, cleanRows, { apply })
      setMessage(apply ? 'ENV aplicada ao serviço.' : 'ENV salva como configuração pendente.')
      if (apply) {
        await onReload()
      }
    } catch (err) {
      setMessage(err.response?.data?.message || err.message || 'Falha ao salvar ENV')
    } finally {
      setSaving('')
    }
  }

  const applyEnvImport = (merged) => {
    setEnvRows(cloneEnvRows(merged))
    setImportStatus('Variáveis importadas. Clique em Salvar ou Aplicar para gravar.')
    setPendingEnvImport(null)
  }

  const handleEnvFileImport = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setImportStatus('Lendo arquivo de texto...')
    setPendingEnvImport(null)
    try {
      const parsed = await parseEnvFile(file)
      if (!parsed.length) {
        setImportStatus('Nenhuma variável válida encontrada no arquivo.')
        return
      }
      const { merged, overwrites } = buildEnvMerge(envRows, parsed)
      if (overwrites.length) {
        setPendingEnvImport({ merged, overwrites })
        setImportStatus(`${overwrites.length} chave(s) já existem. Confirme para sobrescrever.`)
        return
      }
      applyEnvImport(merged)
    } catch (err) {
      setImportStatus(err.message || 'Falha ao importar arquivo de texto')
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
      <div className="mb-4 rounded-lg border border-slate-800 bg-slate-950/70 p-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-200">Carregar arquivo de texto</p>
            <p className="mt-1 text-xs text-slate-500">Importa linhas no formato CHAVE=valor para o editor abaixo sem aplicar automaticamente.</p>
          </div>
          <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs font-medium text-blue-100 transition hover:bg-blue-500/20">
            <UploadCloud className="h-4 w-4" />
            Escolher arquivo
            <input
              type="file"
              className="sr-only"
              onChange={handleEnvFileImport}
            />
          </label>
        </div>
        {importStatus ? (
          <p className="mt-3 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-300">{importStatus}</p>
        ) : null}
        {pendingEnvImport ? (
          <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <p className="text-xs font-semibold text-amber-100">As chaves abaixo serão sobrescritas:</p>
            <div className="mt-2 max-h-48 space-y-2 overflow-auto pr-1">
              {pendingEnvImport.overwrites.map((item) => (
                <div key={item.key} className="rounded-md border border-amber-500/20 bg-slate-950/70 px-3 py-2 text-xs">
                  <p className="font-semibold text-slate-100">{item.key}</p>
                  <p className="mt-1 break-all text-slate-500">Atual: {item.previous || '(vazio)'}</p>
                  <p className="mt-1 break-all text-emerald-200">Novo: {item.next || '(vazio)'}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className={primaryButtonClass} type="button" onClick={() => applyEnvImport(pendingEnvImport.merged)}>
                Sobrescrever
              </button>
              <button className={smallButtonClass} type="button" onClick={() => { setPendingEnvImport(null); setImportStatus('Importação cancelada.') }}>
                Cancelar
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <EnvVariablesEditor rows={envRows} onChange={setEnvRows} />
      {message ? <p className="mt-3 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-300">{message}</p> : null}
    </Panel>
  )
}

const formatLogTimestamp = (ts) => {
  if (!ts) return ''
  try {
    const d = new Date(ts)
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch (e) {
    return ts
  }
}

const getLogMinuteKey = (ts) => {
  if (!ts) return ''
  try {
    const d = new Date(ts)
    return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
  } catch (e) {
    return ''
  }
}

const LOG_LEVEL_STYLES = {
  error: 'text-rose-400',
  warn: 'text-amber-400',
  info: 'text-sky-400',
  debug: 'text-slate-500'
}

const LogsViewer = ({ logs, loading }) => {
  const containerRef = useRef(null)

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [logs])

  if (loading) {
    return (
      <div className="flex h-80 items-center justify-center rounded-xl bg-[#0d1117] font-mono text-sm text-slate-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Carregando logs...
      </div>
    )
  }

  const entries = logs?.entries || []
  if (!entries.length) {
    return (
      <div className="flex h-80 items-center justify-center rounded-xl bg-[#0d1117] font-mono text-sm text-slate-600">
        Sem logs para os filtros atuais.
      </div>
    )
  }

  // Group by minute
  const groups = []
  let currentGroup = null
  entries.forEach((entry) => {
    const key = getLogMinuteKey(entry.timestamp)
    if (!currentGroup || currentGroup.key !== key) {
      currentGroup = { key, entries: [] }
      groups.push(currentGroup)
    }
    currentGroup.entries.push(entry)
  })

  return (
    <div
      ref={containerRef}
      className="h-[560px] overflow-auto rounded-xl bg-[#0d1117] p-4 font-mono text-[13px] leading-[1.7] selection:bg-blue-500/30"
    >
      {groups.map((group) => (
        <div key={group.key} className="mb-1">
          {group.key ? (
            <div className="sticky top-0 z-10 mb-1 flex items-center gap-3 py-1">
              <span className="text-[11px] text-slate-600 bg-[#0d1117] pr-3">{group.key}</span>
              <span className="flex-1 border-t border-slate-800/60" />
            </div>
          ) : null}
          {group.entries.map((entry) => (
            <div key={entry.id} className="flex gap-3 py-[1px] hover:bg-white/[0.02] rounded px-1 -mx-1">
              <span className="shrink-0 text-slate-600 select-none w-[62px]">{formatLogTimestamp(entry.timestamp)}</span>
              <span className={`shrink-0 w-[42px] select-none font-semibold ${LOG_LEVEL_STYLES[entry.level] || 'text-slate-500'}`}>
                {entry.level === 'error' ? 'ERR' : entry.level === 'warn' ? 'WRN' : entry.level === 'debug' ? 'DBG' : 'INF'}
              </span>
              <span className="whitespace-pre-wrap break-words text-slate-300 min-w-0">{entry.message}</span>
            </div>
          ))}
        </div>
      ))}
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

const ServiceAiTab = ({ service }) => {
  const storageKey = `ai-chat-${service.id}`
  const [messages, setMessages] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(storageKey)) || [] } catch { return [] }
  })
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef(null)
  const inputRef = useRef(null)
  const contentRef = useRef('')
  const idxRef = useRef(-1)
  const abortRef = useRef(null)

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [messages])
  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { if (messages.length) sessionStorage.setItem(storageKey, JSON.stringify(messages)) }, [messages, storageKey])

  const copyText = (text) => {
    navigator.clipboard.writeText(text)
  }

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    setLoading(true)

    const history = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content }))
    const idx = messages.length + 1
    idxRef.current = idx
    contentRef.current = ''
    setMessages(prev => [...prev, { role: 'user', content: text }, { role: 'assistant', content: '' }])

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const token = localStorage.getItem('provirpanel-token')
      const res = await fetch(`/api/ci-cd/services/${service.id}/ai-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ message: text, history, stream: true }),
        signal: controller.signal
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(line.slice(6))
            if (ev.type === 'token') {
              contentRef.current += ev.content
              const c = contentRef.current
              setMessages(prev => { const u = [...prev]; if (u[idx]) u[idx] = { ...u[idx], content: c }; return u })
            } else if (ev.type === 'error') {
              setMessages(prev => { const u = [...prev]; if (u[idx]) u[idx] = { role: 'assistant', content: ev.error, error: true }; return u })
            }
          } catch {}
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setMessages(prev => { const u = [...prev]; if (u[idxRef.current]) u[idxRef.current] = { role: 'assistant', content: err.message, error: true }; return u })
      }
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }

  const stopGeneration = () => { abortRef.current?.abort() }

  const handleReindex = async () => {
    setLoading(true)
    try {
      const res = await githubDeliveryApi.aiChatReindex(service.id)
      setMessages(prev => [...prev, { role: 'system', content: `Re-indexado: ${res.fileCount} arquivos (${res.chunks} chunks)` }])
    } catch (err) {
      setMessages(prev => [...prev, { role: 'system', content: `Erro: ${err.message}`, error: true }])
    } finally { setLoading(false) }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-280px)] min-h-[500px] bg-zinc-950 rounded-lg border border-zinc-800">
      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="w-14 h-14 rounded-full bg-purple-500/10 flex items-center justify-center">
              <Bot className="w-7 h-7 text-purple-400" />
            </div>
            <p className="text-zinc-400 text-sm text-center max-w-sm">Pergunte sobre o código deste projeto</p>
            <div className="flex flex-wrap gap-2 justify-center max-w-lg">
              {['O que esse sistema faz?', 'Quais endpoints existem?', 'Explique a arquitetura', 'Tem problemas no código?'].map(q => (
                <button key={q} onClick={() => { setInput(q); inputRef.current?.focus() }}
                  className="px-3 py-1.5 text-xs rounded-full border border-zinc-700 hover:border-purple-500/50 hover:bg-purple-500/5 text-zinc-400 hover:text-zinc-200 transition-all">
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => {
          if (msg.role === 'user') return (
            <div key={i} className="flex justify-end">
              <div className="max-w-[75%] bg-purple-600/15 border border-purple-500/20 rounded-2xl rounded-br-sm px-4 py-2.5 text-sm text-purple-100 whitespace-pre-wrap">
                {msg.content}
              </div>
            </div>
          )
          if (msg.role === 'system') return (
            <div key={i} className="flex justify-center">
              <span className={`text-xs px-3 py-1 rounded-full ${msg.error ? 'bg-red-500/10 text-red-400' : 'bg-zinc-800 text-zinc-500'}`}>{msg.content}</span>
            </div>
          )
          return (
            <div key={i} className="flex gap-3">
              <div className="shrink-0 w-7 h-7 rounded-full bg-purple-500/10 flex items-center justify-center mt-0.5">
                <Bot className="w-4 h-4 text-purple-400" />
              </div>
              <div className="flex-1 min-w-0">
                {msg.error ? (
                  <p className="text-sm text-red-400">{msg.content}</p>
                ) : (
                  <div className="prose prose-invert prose-sm max-w-none
                    prose-p:my-2 prose-p:leading-relaxed
                    prose-headings:my-3 prose-headings:font-semibold
                    prose-li:my-0.5
                    prose-code:text-purple-300 prose-code:bg-zinc-800/80 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:font-normal
                    prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800 prose-pre:rounded-lg prose-pre:my-3
                    prose-a:text-purple-400 prose-a:no-underline hover:prose-a:underline
                    prose-strong:text-zinc-100
                    prose-blockquote:border-purple-500/30 prose-blockquote:text-zinc-400">
                    <Markdown remarkPlugins={[remarkGfm]}>{msg.content || (loading && i === idxRef.current ? '\u2588' : '')}</Markdown>
                  </div>
                )}
                {msg.content && !msg.error && !loading && (
                  <div className="flex items-center gap-1 mt-2">
                    <button onClick={() => copyText(msg.content)}
                      className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors">
                      <ClipboardCopy className="w-3 h-3" /> Copiar
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
        {loading && !contentRef.current && (
          <div className="flex gap-3">
            <div className="shrink-0 w-7 h-7 rounded-full bg-purple-500/10 flex items-center justify-center">
              <Bot className="w-4 h-4 text-purple-400" />
            </div>
            <div className="flex items-center gap-1.5 py-2">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse [animation-delay:300ms]" />
            </div>
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="px-4 py-3 border-t border-zinc-800">
        <div className="flex items-center gap-2">
          <button onClick={handleReindex} disabled={loading} title="Re-indexar"
            className="p-2.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-40">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => { setMessages([]); sessionStorage.removeItem(storageKey) }} title="Limpar conversa"
            className="p-2.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
          <input ref={inputRef} type="text" value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder="Pergunte sobre o projeto..."
            disabled={loading}
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-purple-500/40 disabled:opacity-50"
          />
          {loading ? (
            <button onClick={stopGeneration} className="p-2.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10" rx="1" /></svg>
            </button>
          ) : (
            <button onClick={sendMessage} disabled={!input.trim()}
              className="p-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
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

const DeliveryDeployHistory = ({ service, onReload }) => {
  const deployments = Array.isArray(service.deployments) ? service.deployments : []
  const [openLogId, setOpenLogId] = useState('')
  const [page, setPage] = useState(0)
  const [cleaning, setCleaning] = useState(false)
  const confirm = useConfirm()
  const perPage = 5
  const totalPages = Math.ceil(deployments.length / perPage)
  const visible = deployments.slice(page * perPage, (page + 1) * perPage)
  const failedCount = deployments.filter(d => d.status === 'failed').length
  const inactiveCount = deployments.filter(d => d.status !== 'active' && d.id !== service.activeDeploymentId).length

  const handleRemoveSingle = async (deployment) => {
    const ok = await confirm({ title: 'Remover versão', message: `Remover a versão ${deployment.versionLabel || deployment.id}?`, confirmText: 'Remover', variant: 'danger' })
    if (!ok) return
    await servicesApi.removeVersion(service.id, deployment.id)
    if (onReload) await onReload()
  }

  const handleCleanFailed = async () => {
    const ok = await confirm({ title: 'Remover deploys falhos', message: `Remover ${failedCount} deploy(s) que falharam?`, confirmText: 'Remover', variant: 'danger' })
    if (!ok) return
    setCleaning(true)
    try {
      const failed = deployments.filter(d => d.status === 'failed')
      for (const d of failed) await servicesApi.removeVersion(service.id, d.id)
      if (onReload) await onReload()
    } finally { setCleaning(false) }
  }

  const handleCleanOld = async () => {
    const ok = await confirm({ title: 'Limpar versões antigas', message: `Remover ${inactiveCount} versão(ões) inativa(s)? A versão ativa será mantida.`, confirmText: 'Limpar', variant: 'danger' })
    if (!ok) return
    setCleaning(true)
    try {
      const inactive = deployments.filter(d => d.status !== 'active' && d.id !== service.activeDeploymentId)
      for (const d of inactive) await servicesApi.removeVersion(service.id, d.id)
      if (onReload) await onReload()
    } finally { setCleaning(false) }
  }

  if (!deployments.length) return <p className="text-sm text-slate-500">Nenhuma publicação registrada.</p>

  return (
    <div className="space-y-2">
      {/* Bulk actions */}
      {(failedCount > 0 || inactiveCount > 1) && (
        <div className="flex flex-wrap gap-2 mb-2">
          {failedCount > 0 && (
            <button
              className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-[11px] font-medium text-rose-200 hover:bg-rose-500/20 disabled:opacity-50"
              onClick={handleCleanFailed}
              disabled={cleaning}
            >
              <Trash2 className="h-3 w-3" />
              Remover falhos ({failedCount})
            </button>
          )}
          {inactiveCount > 1 && (
            <button
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-600/50 bg-slate-800/50 px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:bg-slate-700/50 disabled:opacity-50"
              onClick={handleCleanOld}
              disabled={cleaning}
            >
              <Trash2 className="h-3 w-3" />
              Limpar antigos ({inactiveCount})
            </button>
          )}
        </div>
      )}
      {visible.map((deployment) => {
        const active = deployment.id === service.activeDeploymentId || deployment.status === 'active'
        const failed = deployment.status === 'failed'
        const logOpen = openLogId === deployment.id
        const logLines = getDeploymentLogLines(deployment)

        return (
          <div key={deployment.id} className={`relative rounded-lg border ${
            active ? 'border-emerald-500/30 bg-emerald-500/5' : failed ? 'border-rose-500/20 bg-rose-500/5' : 'border-slate-800 bg-slate-900/30'
          }`}>
            <button
              type="button"
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left pr-10"
              onClick={() => setOpenLogId(logOpen ? '' : deployment.id)}
            >
              <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                active ? 'bg-emerald-400' : failed ? 'bg-rose-400' : 'bg-slate-500'
              }`} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">
                {formatDeploymentLabel(deployment)}
              </span>
              {active && <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-100">ATIVA</span>}
              {failed && <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] text-rose-200">FALHOU</span>}
              <span className="text-[11px] text-slate-500">{formatDateTime(deployment.finishedAt || deployment.createdAt)}</span>
              <Terminal className={`h-3.5 w-3.5 transition ${logOpen ? 'text-blue-400' : 'text-slate-600'}`} />
            </button>
            {!active && (
              <button
                type="button"
                className="absolute top-2.5 right-2.5 rounded-md p-1 text-slate-600 hover:text-rose-400 hover:bg-rose-500/10"
                onClick={(e) => { e.stopPropagation(); handleRemoveSingle(deployment) }}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}

            {logOpen && (
              <div className="border-t border-slate-800 px-3 py-3 space-y-2">
                {(deployment.error || deployment.deployLogError) && (
                  <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                    {deployment.error || deployment.deployLogError}
                  </div>
                )}
                {logLines.length > 0 && (
                  <div className="max-h-48 overflow-auto rounded-md bg-black/60 p-2.5 font-mono text-[10px] leading-4 text-slate-400">
                    {logLines.map((line, i) => <p key={i}>{line}</p>)}
                  </div>
                )}
                {failed && <DeployAiDiagnosis service={service} deployment={deployment} />}
              </div>
            )}
          </div>
        )
      })}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-1">
          <button className={smallButtonClass} type="button" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>←</button>
          <span className="text-xs text-slate-400">{page + 1} / {totalPages}</span>
          <button className={smallButtonClass} type="button" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>→</button>
        </div>
      )}
    </div>
  )
}

const WorkflowRunPanel = ({ run, message }) => {
  if (!run) return null
  const isRunning = run.status !== 'completed'
  const isSuccess = run.conclusion === 'success'
  const isFailed = run.conclusion === 'failure'
  const isAiWorking = message?.includes('Zeus AI diagnosticando')

  if (isRunning || isAiWorking) {
    return (
      <div className="rounded-xl border border-amber-500/20 bg-gradient-to-r from-amber-500/5 to-orange-500/5 p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15">
            {isAiWorking ? <Brain className="h-4 w-4 text-amber-300 animate-pulse" /> : <Loader2 className="h-4 w-4 text-amber-300 animate-spin" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white">
              {isAiWorking ? '🤖 Zeus AI corrigindo falha...' : 'Workflow em execução'}
            </p>
            <p className="mt-1 text-xs text-amber-200/80">
              {isAiWorking
                ? 'A AI está analisando os logs de erro, diagnosticando o problema e aplicando correções automaticamente.'
                : run.status === 'queued' ? 'Aguardando runner disponível...' : 'Executando steps do workflow...'}
            </p>
            {message && !isAiWorking ? <p className="mt-2 text-xs text-slate-400 whitespace-pre-wrap">{message}</p> : null}
          </div>
          {run.htmlUrl ? <a href={run.htmlUrl} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-blue-400 underline hover:text-blue-300">GitHub</a> : null}
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800">
          <div className={`h-full rounded-full transition-all duration-1000 ${isAiWorking ? 'bg-amber-500 w-3/4' : run.status === 'queued' ? 'bg-amber-500/60 w-1/4' : 'bg-amber-500 w-1/2'} animate-pulse`} />
        </div>
      </div>
    )
  }

  if (isSuccess) {
    return (
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15">
            <CheckCircle2 className="h-4 w-4 text-emerald-300" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-white">✅ Deploy concluído com sucesso</p>
            <p className="mt-0.5 text-xs text-emerald-200/70">O workflow executou todos os steps e o deploy foi publicado.</p>
          </div>
          {run.htmlUrl ? <a href={run.htmlUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-400 underline hover:text-blue-300">Ver no GitHub</a> : null}
        </div>
      </div>
    )
  }

  if (isFailed) {
    return (
      <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-500/15">
            <AlertTriangle className="h-4 w-4 text-rose-300" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white">❌ Workflow falhou</p>
            {message ? <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-300 bg-slate-900/60 rounded-lg p-2.5 border border-slate-800">{message}</pre> : null}
          </div>
          {run.htmlUrl ? <a href={run.htmlUrl} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-blue-400 underline hover:text-blue-300">Ver no GitHub</a> : null}
        </div>
      </div>
    )
  }

  return null
}

const ServiceDeliveryTab = ({ service, onReload }) => {
  const confirm = useConfirm()
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
  const [message, setMessage] = useState(() => sessionStorage.getItem(`delivery-msg-${service.id}`) || '')
  const [loadingAction, setLoadingAction] = useState('')
  const [editingToken, setEditingToken] = useState(false)
  const [workflowRun, setWorkflowRun] = useState(null)
  const [projectAnalysis, setProjectAnalysis] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(`delivery-analysis-${service.id}`)) } catch { return null }
  })
  const pollRef = useRef(null)

  useEffect(() => { if (message) sessionStorage.setItem(`delivery-msg-${service.id}`, message); else sessionStorage.removeItem(`delivery-msg-${service.id}`) }, [message, service.id])
  useEffect(() => { if (projectAnalysis) sessionStorage.setItem(`delivery-analysis-${service.id}`, JSON.stringify(projectAnalysis)); else sessionStorage.removeItem(`delivery-analysis-${service.id}`) }, [projectAnalysis, service.id])

  const [aiIndexed, setAiIndexed] = useState(null)
  const [showGitIndex, setShowGitIndex] = useState(false)
  const [gitIndexForm, setGitIndexForm] = useState(() => {
    const [org = '', repo = ''] = (service.delivery?.repository || '').split('/')
    const branch = service.delivery?.branch || 'main'
    const collection = repo ? `project_${repo.replace(/[^a-z0-9]/gi, '_').toLowerCase()}` : ''
    return { org, repo, branch, collection }
  })
  const [gitIndexStatus, setGitIndexStatus] = useState(null) // null | 'indexing' | 'done' | 'error'
  const [gitIndexResult, setGitIndexResult] = useState(null)
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
    const ok = await confirm({ title: 'Remover conexão', message: 'Remover a conexão GitHub salva neste painel?', confirmText: 'Remover', variant: 'danger' })
    if (!ok) return
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

  const generateSmartBlueprint = async () => {
    setLoadingAction('smart-blueprint')
    setMessage('')
    try {
      const res = await githubDeliveryApi.smartBlueprint(service.id)
      let msg = res.explanation || 'Blueprint gerado com base no Docker ativo.'
      if (res.appliedUpdates?.length) msg += '\n🔧 Correções aplicadas: ' + res.appliedUpdates.join(', ')
      if (res.workflowSaved) msg += '\n✅ Workflow atualizado no GitHub.'
      else if (res.workflowError) msg += `\n⚠️ Workflow não salvo: ${res.workflowError}`
      if (res.warnings?.length) msg += '\n⚠️ ' + res.warnings.join(' | ')
      setMessage(msg)
      await onReload()
    } catch (err) {
      setMessage(err.response?.data?.message || err.message || 'Falha ao gerar blueprint')
    } finally {
      setLoadingAction('')
    }
  }

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  const pollWorkflowRun = useCallback(() => {
    stopPolling()
    pollRef.current = setInterval(async () => {
      try {
        const { run } = await githubDeliveryApi.getWorkflowRunStatus(service.id)
        setWorkflowRun(run)
        if (!run || run.status === 'completed') {
          stopPolling()
          if (run?.conclusion === 'success') {
            setMessage('✅ Workflow concluído! Deploy publicado com sucesso.')
            await onReload()
          }
          if (run?.conclusion === 'failure' && run?.id) {
            setMessage('🤖 Zeus AI diagnosticando e corrigindo...')
            setWorkflowRun(prev => ({ ...prev, status: 'ai_fixing' }))
            try {
              const { diagnosis, applied, redispatched } = await githubDeliveryApi.workflowFailed(service.id, run.id)
              const ok = (applied || []).filter(a => a.success)
              const failed = (applied || []).filter(a => !a.success)
              let msg = `🔍 Diagnóstico: ${diagnosis}`
              if (ok.length) {
                msg += `\n\n✅ ${ok.length} correção(es) aplicada(s):`
                ok.forEach(a => { msg += `\n   • ${a.description || a.key || a.type}` })
              }
              if (failed.length) {
                msg += `\n\n⚠️ ${failed.length} não aplicada(s):`
                failed.forEach(a => { msg += `\n   • ${a.description || a.key}: ${a.reason}` })
              }
              if (redispatched) {
                msg += '\n\n⚡ Workflow re-disparado automaticamente. Aguardando...'
                setWorkflowRun({ status: 'queued', conclusion: null })
                setTimeout(() => pollWorkflowRun(), 8000)
              } else if (!ok.length) {
                setWorkflowRun({ ...run, status: 'completed', conclusion: 'failure' })
              }
              setMessage(msg)
              await onReload()
            } catch (fixErr) {
              setMessage(`❌ Workflow falhou. AI não conseguiu corrigir: ${fixErr.message}`)
              setWorkflowRun({ ...run, status: 'completed', conclusion: 'failure' })
            }
          }
        }
      } catch { stopPolling() }
    }, 5000)
  }, [service.id, onReload, stopPolling])

  useEffect(() => () => stopPolling(), [stopPolling])

  const dispatchWorkflow = async () => {
    setLoadingAction('dispatch')
    setMessage('')
    setWorkflowRun(null)
    try {
      // AI pre-validation with auto-fix (non-blocking)
      try {
        setMessage('🔍 Validando configuração antes do deploy...')
        const { validation, applied } = await githubDeliveryApi.aiValidate(service.id, true)
        if (applied?.some(a => a.success)) {
          setMessage('🔧 Correções aplicadas. Disparando workflow...')
          await onReload()
        }
        if (!validation.ready) {
          const critical = (validation.issues || []).filter(i => i.severity === 'critical')
          if (critical.length) {
            setMessage(`⚠️ ${critical.map(i => i.message).join('; ')} — disparando mesmo assim...`)
          }
        }
      } catch {
        // Validation failed — proceed
      }

      await githubDeliveryApi.dispatchWorkflow(service.id, {
        connectionId,
        repository: selectedRepo || service.delivery?.repository,
        branch: selectedBranch || service.delivery?.branch,
        workflowPath: service.delivery?.workflowPath || workflow?.path
      })
      setMessage('⚡ Workflow disparado. Acompanhando execução...')
      setWorkflowRun({ status: 'queued', conclusion: null })
      setTimeout(() => pollWorkflowRun(), 3000)
      await onReload()
    } catch (err) {
      setMessage(err.response?.data?.message || err.message || 'Falha ao disparar workflow')
    } finally {
      setLoadingAction('')
    }
  }

  const validateAndFix = async () => {
    setLoadingAction('validate')
    setMessage('')
    try {
      const { validation, applied } = await githubDeliveryApi.aiValidate(service.id, true)
      let msg = validation.summary || ''
      if (applied?.length) {
        const ok = applied.filter(a => a.success)
        if (ok.length) msg += `\n🔧 ${ok.length} correção(s) aplicada(s): ${ok.map(a => a.reason || a.field).join(', ')}`
      }
      if (validation.issues?.length) {
        const critical = validation.issues.filter(i => i.severity === 'critical')
        const warnings = validation.issues.filter(i => i.severity === 'warning')
        if (critical.length) msg += `\n❌ ${critical.length} problema(s) crítico(s): ${critical.map(i => i.message).join('; ')}`
        if (warnings.length) msg += `\n⚠️ ${warnings.length} aviso(s): ${warnings.map(i => i.message).join('; ')}`
      }
      if (validation.ready) msg += '\n✅ Serviço pronto para deploy.'
      setMessage(msg)
      if (applied?.some(a => a.success)) await onReload()
    } catch (err) {
      setMessage(err.response?.data?.message || err.message || 'Falha na validação')
    } finally {
      setLoadingAction('')
    }
  }

  const runProjectAnalysis = async () => {
    setLoadingAction('project-analysis')
    setProjectAnalysis(null)
    try {
      const { analysis } = await githubDeliveryApi.aiProjectAnalysis(service.id)
      setProjectAnalysis(analysis)
    } catch (err) {
      setMessage(err.response?.data?.message || err.message || 'Falha na análise')
    } finally {
      setLoadingAction('')
    }
  }

  const updateAiContext = async () => {
    setLoadingAction('ai-context')
    try {
      const res = await githubDeliveryApi.aiChatReindex(service.id)
      setAiIndexed(res)
      setMessage(`AI indexou ${res.fileCount} arquivos (${res.chunks} chunks)`)
    } catch (err) {
      setMessage(err.response?.data?.message || err.message || 'Falha ao indexar')
    } finally {
      setLoadingAction('')
    }
  }

  const submitGitIndex = async () => {
    const { org, repo, branch, collection } = gitIndexForm
    if (!org || !repo) return setMessage('Org e Repo são obrigatórios')
    setGitIndexStatus('indexing')
    setGitIndexResult(null)
    try {
      const col = collection || `project_${repo.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`
      const data = await zeusAiApi.indexGit({
        org, repo, branch: branch || 'main', collection: col,
        metadata: { service_name: service.name }
      })
      // Listen for socket events
      const { io } = await import('socket.io-client')
      const socket = io('https://zeusai.zeusengine.com.br', { transports: ['websocket'] })
      const jobId = data.jobId
      socket.on('git:index:progress', (ev) => {
        if (ev.jobId === jobId) setGitIndexResult({ progress: ev.message || ev.progress })
      })
      socket.on('git:index:done', (ev) => {
        if (ev.jobId === jobId) {
          setGitIndexStatus('done')
          setGitIndexResult({ files: ev.files, chunks: ev.chunks })
          setAiIndexed({ fileCount: ev.files, chunks: ev.chunks })
          socket.disconnect()
        }
      })
      socket.on('git:index:error', (ev) => {
        if (ev.jobId === jobId) {
          setGitIndexStatus('error')
          setGitIndexResult({ error: ev.error || ev.message })
          socket.disconnect()
        }
      })
      // Timeout fallback
      setTimeout(() => {
        if (gitIndexStatus === 'indexing') {
          socket.disconnect()
          setGitIndexStatus('done')
          setGitIndexResult({ files: '?', chunks: '?', note: 'Indexação iniciada (timeout no acompanhamento)' })
        }
      }, 120000)
    } catch (err) {
      setGitIndexStatus('error')
      setGitIndexResult({ error: err.response?.data?.error || err.message })
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
          {message ? (
            <div className={`rounded-xl border p-3 text-sm whitespace-pre-wrap font-sans ${
              message.includes('✅') ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-100' :
              message.includes('❌') ? 'border-rose-500/20 bg-rose-500/5 text-rose-100' :
              message.includes('🤖') || message.includes('🔍') ? 'border-amber-500/20 bg-amber-500/5 text-amber-100' :
              message.includes('⚠️') ? 'border-amber-500/20 bg-amber-500/5 text-amber-100' :
              'border-slate-800 bg-slate-900 text-slate-300'
            }`}>{message}</div>
          ) : null}
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
            <button className={smallButtonClass} type="button" onClick={generateSmartBlueprint} disabled={loadingAction === 'smart-blueprint'}>
              {loadingAction === 'smart-blueprint' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
              Blueprint Inteligente
            </button>
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
            <button className={smallButtonClass} type="button" onClick={validateAndFix} disabled={loadingAction === 'validate'}>
              {loadingAction === 'validate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Validar
            </button>
            <button className={smallButtonClass} type="button" onClick={runProjectAnalysis} disabled={loadingAction === 'project-analysis'}>
              {loadingAction === 'project-analysis' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
              Diagnóstico AI
            </button>
            <button className={smallButtonClass} type="button" onClick={updateAiContext} disabled={loadingAction === 'ai-context'}>
              {loadingAction === 'ai-context' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Indexar Projeto Local
            </button>
            <button className={smallButtonClass} type="button" onClick={() => setShowGitIndex(v => !v)}>
              <GitBranch className="h-4 w-4" />
              Indexar Repositório Git
            </button>
            <button className={smallButtonClass} type="button" onClick={dispatchWorkflow} disabled={!(service.delivery?.workflowPath || workflow?.path) || loadingAction === 'dispatch'}>
              {loadingAction === 'dispatch' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Executar workflow
            </button>
          </div>

          {workflow?.content ? (
            <textarea className={`${fieldClass} h-80 w-full font-mono text-xs`} value={workflow.content} readOnly />
          ) : null}

          {workflowRun ? <WorkflowRunPanel run={workflowRun} message={message} /> : null}

          {showGitIndex && (
            <div className="space-y-3 rounded-xl border border-purple-500/20 bg-purple-500/5 p-4">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-purple-200">
                <Sparkles className="h-4 w-4" /> Indexar Repositório no Zeus AI
              </h4>
              <div className="grid gap-2 sm:grid-cols-2">
                <input className={`${fieldClass} w-full`} placeholder="Org (ex: Legacy-Empreendimentos)" value={gitIndexForm.org} onChange={e => setGitIndexForm(f => ({ ...f, org: e.target.value }))} />
                <input className={`${fieldClass} w-full`} placeholder="Repo (ex: legacy-node-queue)" value={gitIndexForm.repo} onChange={e => setGitIndexForm(f => ({ ...f, repo: e.target.value }))} />
                <input className={`${fieldClass} w-full`} placeholder="Branch (default: main)" value={gitIndexForm.branch} onChange={e => setGitIndexForm(f => ({ ...f, branch: e.target.value }))} />
                <input className={`${fieldClass} w-full`} placeholder={`Collection (default: project_${(gitIndexForm.repo || service.name).replace(/[^a-z0-9]/gi, '_').toLowerCase()})`} value={gitIndexForm.collection} onChange={e => setGitIndexForm(f => ({ ...f, collection: e.target.value }))} />
              </div>
              <div className="flex items-center gap-3">
                <button className={primaryButtonClass} type="button" onClick={submitGitIndex} disabled={gitIndexStatus === 'indexing' || !gitIndexForm.org || !gitIndexForm.repo}>
                  {gitIndexStatus === 'indexing' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {gitIndexStatus === 'indexing' ? 'Indexando...' : 'Indexar'}
                </button>
                <button className={smallButtonClass} type="button" onClick={() => setShowGitIndex(false)}>Fechar</button>
              </div>
              {gitIndexStatus === 'indexing' && gitIndexResult?.progress && (
                <p className="text-xs text-purple-300 animate-pulse">{gitIndexResult.progress}</p>
              )}
              {gitIndexStatus === 'done' && gitIndexResult && (
                <p className="text-xs text-green-300">✅ Indexado: {gitIndexResult.files} arquivos, {gitIndexResult.chunks} chunks {gitIndexResult.note ? `(${gitIndexResult.note})` : ''}</p>
              )}
              {gitIndexStatus === 'error' && gitIndexResult && (
                <p className="text-xs text-red-400">❌ {gitIndexResult.error}</p>
              )}
            </div>
          )}

          {aiIndexed && (
            <div className="flex items-center gap-2 rounded-lg border border-purple-500/20 bg-purple-500/5 px-3 py-2">
              <Sparkles className="h-4 w-4 text-purple-400" />
              <span className="text-xs text-purple-200">AI aprendeu sobre este projeto — {aiIndexed.fileCount} arquivos, {aiIndexed.chunks} chunks indexados</span>
            </div>
          )}

          {service.delivery?.workflowUpdatedAt || service.delivery?.lastWorkflowDispatchAt ? (
            <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-xs text-slate-400 space-y-1">
              {service.delivery.workflowUpdatedAt ? <p>Workflow atualizado: {new Date(service.delivery.workflowUpdatedAt).toLocaleString()}</p> : null}
              {service.delivery.lastWorkflowDispatchAt ? <p>Último dispatch: {new Date(service.delivery.lastWorkflowDispatchAt).toLocaleString()}</p> : null}
              {service.delivery.workflowHtmlUrl ? <p><a href={service.delivery.workflowHtmlUrl} target="_blank" rel="noreferrer" className="text-blue-400 underline hover:text-blue-300">Ver workflow no GitHub</a></p> : null}
            </div>
          ) : null}

          {service.delivery?.repository && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 space-y-2 w-full max-w-full overflow-hidden">
              <p className="text-xs font-medium text-amber-200">GitHub Secrets</p>
              <div className="space-y-2">
                {[{ key: 'PROVIRPANEL_URL', value: `${window.location.origin}/api/ci-cd/webhook` }, { key: 'PROVIRPANEL_TOKEN', value: service.delivery?.deployToken || localStorage.getItem('provirpanel-token') || '' }].map(s => (
                  <div key={s.key} className="space-y-0.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-slate-400 font-mono">{s.key}</span>
                      <button onClick={() => { navigator.clipboard.writeText(s.value); setMessage(`Copiado: ${s.key}`) }} className="text-[10px] text-slate-400 hover:text-white flex items-center gap-1"><Copy className="h-3 w-3" /> copiar</button>
                    </div>
                    <div className="rounded bg-slate-900 px-2 py-1 overflow-x-auto">
                      <code className="text-[11px] text-slate-300 font-mono whitespace-nowrap">{s.value}</code>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-slate-500">Repo → Settings → Secrets and variables → Actions</p>
            </div>
          )}

          {projectAnalysis ? (
            <div className="space-y-3 rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4">
              <div className="flex items-center justify-between">
                <h4 className="flex items-center gap-2 text-sm font-semibold text-indigo-200">
                  <Brain className="h-4 w-4" />
                  Diagnóstico do Projeto
                </h4>
                <button onClick={() => setProjectAnalysis(null)} className="text-slate-500 hover:text-slate-300"><X className="h-4 w-4" /></button>
              </div>
              <p className="text-xs text-slate-300">{projectAnalysis.summary}</p>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${projectAnalysis.canRun ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}>
                  {projectAnalysis.canRun ? '✅ Pronto para rodar' : '❌ Precisa de ações'}
                </span>
                <span className="text-[10px] text-slate-500">{projectAnalysis.projectType}</span>
              </div>

              {projectAnalysis.actions?.length ? (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold text-blue-300">Ações necessárias ({projectAnalysis.actions.length}):</p>
                  {projectAnalysis.actions.sort((a, b) => (a.priority || 99) - (b.priority || 99)).map((action, i) => (
                    <div key={i} className="rounded-lg border border-slate-700/50 bg-slate-800/50 p-2.5 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className={`h-5 w-5 flex items-center justify-center rounded text-[10px] font-bold ${
                          action.type === 'create_service' ? 'bg-blue-500/20 text-blue-300' :
                          action.type === 'update_env' ? 'bg-amber-500/20 text-amber-300' :
                          action.type === 'update_command' ? 'bg-purple-500/20 text-purple-300' :
                          action.type === 'fix_config' ? 'bg-cyan-500/20 text-cyan-300' :
                          'bg-slate-600/30 text-slate-400'
                        }`}>{action.priority || i + 1}</span>
                        <span className="text-xs font-medium text-slate-200">{action.title}</span>
                        <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400">{action.type.replace('_', ' ')}</span>
                        {action.autoApply && <span className="text-[10px] text-green-400">⚡ auto</span>}
                      </div>
                      <p className="text-[11px] text-slate-400 pl-7">{action.description}</p>
                      {action.config?.image && (
                        <p className="text-[10px] text-slate-500 pl-7">Imagem: <code className="text-blue-300">{action.config.image}</code>{action.config.containerPort ? ` · Porta: ${action.config.containerPort}` : ''}</p>
                      )}
                      {action.config?.key && (
                        <p className="text-[10px] text-slate-500 pl-7"><code className="text-amber-200">{action.config.key}</code> = <code className="text-green-300">{action.config.value}</code></p>
                      )}
                      {action.config?.command && (
                        <p className="text-[10px] text-slate-500 pl-7 font-mono">{action.config.command}</p>
                      )}
                    </div>
                  ))}
                  <button
                    className="w-full rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-xs font-medium text-indigo-200 transition hover:bg-indigo-500/20"
                    onClick={async () => {
                      setLoadingAction('apply-actions')
                      try {
                        const autoActions = projectAnalysis.actions.filter(a => a.autoApply)
                        for (const action of autoActions) {
                          if (action.type === 'update_env' && action.config?.key) {
                            await githubDeliveryApi.aiApplyFixes(service.id, [{ type: 'env', field: action.config.key, newValue: action.config.value, reason: action.title }])
                          } else if (action.type === 'update_command' && action.config?.command) {
                            await githubDeliveryApi.aiApplyFixes(service.id, [{ type: 'command', newValue: action.config.command, reason: action.title }])
                          } else if (action.type === 'update_healthcheck' && action.config) {
                            await githubDeliveryApi.aiApplyFixes(service.id, [{ type: 'healthcheck', newValue: JSON.stringify({ enabled: true, target: action.config.target || '/', intervalSeconds: action.config.intervalSeconds || 10, timeoutSeconds: 5, retries: 6, startPeriodSeconds: 5 }), reason: action.title }])
                          }
                        }
                        setMessage(`✅ ${autoActions.length} ação(ões) aplicada(s) automaticamente.`)
                        await onReload()
                      } catch (err) {
                        setMessage(err.message || 'Erro ao aplicar ações')
                      } finally {
                        setLoadingAction('')
                      }
                    }}
                    disabled={loadingAction === 'apply-actions' || !projectAnalysis.actions.some(a => a.autoApply)}
                  >
                    {loadingAction === 'apply-actions' ? 'Aplicando...' : `⚡ Aplicar ${projectAnalysis.actions.filter(a => a.autoApply).length} ação(ões) automática(s)`}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </Panel>

      {(service.deployments || []).length > 0 ? (
        <Panel title="Histórico de publicações" icon={History} className="xl:col-span-2">
          <DeliveryDeployHistory service={service} onReload={onReload} />
        </Panel>
      ) : null}
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
        containerPort: settingsState.containerPort ? Number(settingsState.containerPort) : null,
        networkName: settingsState.networkName,
        command: settingsState.command,
        bindLocalOnly: settingsState.bindLocalOnly,
        autoRollback: settingsState.autoRollback,
        volumes: settingsState.volumes.filter((v) => v.hostPath || v.containerPath),
        healthcheck: settingsState.healthcheck,
        nodeServiceMode: settingsState.nodeServiceMode,
        nodeSiteConfig: settingsState.nodeSiteConfig,
        apply
      })
      setMessage(apply ? 'Configuração aplicada.' : 'Configuração salva como pendente.')
      if (apply) {
        await onReload()
      }
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
            <span className="mb-2 block text-xs text-slate-500">Porta do container (expose)</span>
            <input className={fieldClass} value={settingsState.containerPort} onChange={(event) => setSettingsState((current) => ({ ...current, containerPort: event.target.value }))} placeholder="ex: 8080" />
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
          <h3 className="mb-3 text-sm font-semibold text-white">Volumes</h3>
          <div className="space-y-2">
            {(settingsState.volumes || []).map((vol, idx) => (
              <div key={idx} className="grid gap-2 rounded-lg border border-slate-800 bg-slate-950 p-2 md:grid-cols-[1fr_1fr_auto]">
                <input className={fieldClass} value={vol.hostPath} onChange={(e) => setSettingsState((prev) => ({ ...prev, volumes: prev.volumes.map((v, i) => i === idx ? { ...v, hostPath: e.target.value } : v) }))} placeholder="/host/path" />
                <input className={fieldClass} value={vol.containerPath} onChange={(e) => setSettingsState((prev) => ({ ...prev, volumes: prev.volumes.map((v, i) => i === idx ? { ...v, containerPath: e.target.value } : v) }))} placeholder="/container/path" />
                <button className="inline-flex items-center justify-center rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-rose-200 hover:bg-rose-500/20" type="button" onClick={() => setSettingsState((prev) => ({ ...prev, volumes: prev.volumes.filter((_, i) => i !== idx) }))}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button className={smallButtonClass} type="button" onClick={() => setSettingsState((prev) => ({ ...prev, volumes: [...(prev.volumes || []), { hostPath: '', containerPath: '' }] }))}>
              <Plus className="h-4 w-4" />
              Adicionar volume
            </button>
          </div>
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
  containerPort: service.containerPort || '',
  networkName: service.networkName || 'bridge',
  command: Array.isArray(service.command) ? service.command.join(' ') : service.command || '',
  bindLocalOnly: Boolean(service.bindLocalOnly),
  autoRollback: service.autoRollback !== false,
  volumes: (service.volumes || []).map((v) => ({ hostPath: v.hostPath || '', containerPath: v.containerPath || '' })),
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
    settingsInitializedRef.current = false
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
  const settingsInitializedRef = useRef(false)

  useEffect(() => {
    if (!service) return
    if (!envInitializedRef.current) {
      setEnvRows(cloneEnvRows(service.envVars || []))
      envInitializedRef.current = true
    }
    if (!settingsInitializedRef.current) {
      setSettingsState(buildSettingsState(service))
      settingsInitializedRef.current = true
    }
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
      {activeTab === 'ai' ? <ServiceAiTab service={service} /> : null}
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
          onReload={() => { settingsInitializedRef.current = false; return loadDetails() }}
        />
      ) : null}
    </div>
  )
}

export default ServiceDetailsPage
