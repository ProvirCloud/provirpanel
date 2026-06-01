import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  AppWindow,
  Boxes,
  Play,
  Square,
  RefreshCw,
  Trash2,
  Plus,
  TerminalSquare,
  Layers,
  Database,
  Globe,
  Cpu,
  Wrench
} from 'lucide-react'
import { Area, AreaChart, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts'
import api, { uploadApi } from '../services/api.js'
import { createDockerLogsSocket, createDockerProgressSocket } from '../services/socket.js'
import { getPanelHref } from '../utils/panelPath.js'

// Polyfill para crypto.randomUUID
const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

const stripAnsi = (value) =>
  String(value || '').replace(/\u001b\[[0-9;]*m/g, '')

const stripControlChars = (value) =>
  String(value || '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')

const formatLogChunk = (chunk, ts) => {
  const timeValue = typeof ts === 'number' ? ts : Date.now()
  const timestamp = new Date(timeValue).toISOString().replace('T', ' ').slice(0, 19)
  return stripControlChars(stripAnsi(chunk))
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => (line ? `[${timestamp}] ${line}` : ''))
    .join('\n')
}

const presetImages = [
  { id: 'postgres-db', name: 'PostgreSQL', image: 'postgres', tag: '16', description: 'Banco relacional' },
  { id: 'mysql-db', name: 'MySQL', image: 'mysql', tag: '8', description: 'Banco relacional' },
  { id: 'redis-cache', name: 'Redis', image: 'redis', tag: '7', description: 'Cache em memoria' },
  { id: 'nginx-static', name: 'Nginx', image: 'nginx', tag: 'latest', description: 'Proxy reverso' },
  { id: 'node-app', name: 'Node.js', image: 'node', tag: '20', description: 'Runtime JS' }
]

const guessContainerPort = (imageTag) => {
  const lower = String(imageTag || '').toLowerCase()
  if (lower.includes('postgres')) return 5432
  if (lower.includes('mysql') || lower.includes('mariadb')) return 3306
  if (lower.includes('redis')) return 6379
  if (lower.includes('nginx')) return 80
  if (lower.includes('node')) return 3000
  if (lower.includes('java') || lower.includes('spring') || lower.includes('openjdk') || lower.includes('temurin')) return 8080
  return 8080
}

const Toast = ({ message, type, onClose }) => (
  <div
    className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg ${
      type === 'error'
        ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
        : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
    }`}
  >
    <span>{message}</span>
    <button className="text-xs text-slate-300 hover:text-white" onClick={onClose}>
      fechar
    </button>
  </div>
)

const RegistryModal = ({ initialValue, onSave, onCancel }) => {
  const [form, setForm] = useState({
    name: '',
    serverAddress: '',
    username: '',
    password: '',
    certPem: '',
    ...initialValue
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-xl rounded-2xl border border-slate-800 bg-slate-900/90 p-6 text-slate-100">
        <h3 className="text-lg font-semibold">Novo repositorio</h3>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-xs text-slate-400">Nome</label>
            <input
              className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Meu Registry"
            />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-slate-400">URL/Host do repositorio</label>
            <input
              className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
              value={form.serverAddress}
              onChange={(e) => setForm({ ...form, serverAddress: e.target.value })}
              placeholder="registry.exemplo.com:5000"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Usuario</label>
            <input
              className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder="usuario"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Senha</label>
            <input
              type="password"
              className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="senha"
            />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-slate-400">Certificado (ca.crt opcional)</label>
            <textarea
              className="mt-1 h-24 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs"
              value={form.certPem}
              onChange={(e) => setForm({ ...form, certPem: e.target.value })}
              placeholder="Cole o certificado PEM se necessario"
            />
          </div>
        </div>
        <div className="mt-5 flex gap-2 justify-end">
          <button
            onClick={() => onSave(form)}
            className="rounded-xl bg-blue-500 px-4 py-2 text-xs font-semibold text-slate-950"
          >
            Salvar
          </button>
          <button
            onClick={onCancel}
            className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-xs text-slate-200"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}

const formatCommandForInput = (command) => {
  if (!command) return ''
  if (Array.isArray(command)) {
    if (command[0] === 'sh' && command[1] === '-c') {
      return command.slice(2).join(' ')
    }
    return command.join(' ')
  }
  if (typeof command === 'string') return command
  return ''
}

const parseEnvFile = async (file) => {
  const content = await file.text()
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const idx = line.indexOf('=')
      if (idx === -1) return null
      const key = line.slice(0, idx).trim()
      let value = line.slice(idx + 1).trim()
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
  const existingMap = new Map(existing.map((env) => [env.key, env]))
  const overwrites = []

  incoming.forEach((env) => {
    const prev = existingMap.get(env.key)
    if (prev && prev.value !== env.value) {
      overwrites.push({
        key: env.key,
        previous: prev.value,
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

const NODE_SERVICE_MODES = {
  service: 'service',
  sites: 'sites'
}

const NODE_SITE_TYPES = {
  common: 'common',
  spa: 'spa'
}

const NODE_SITE_FOLDERS = ['www', 'publish']

const CHUNKED_UPLOAD_THRESHOLD_BYTES = 50 * 1024 * 1024
const UPLOAD_CHUNK_SIZE_BYTES = 25 * 1024 * 1024

const DEFAULT_HEALTHCHECK = {
  enabled: false,
  target: '/health',
  intervalSeconds: 10,
  timeoutSeconds: 5,
  retries: 6,
  startPeriodSeconds: 5,
  containerEnabled: false
}

const normalizeHealthcheckForm = (healthcheck = {}) => ({
  ...DEFAULT_HEALTHCHECK,
  ...healthcheck,
  enabled: !!healthcheck.enabled,
  containerEnabled: healthcheck.containerEnabled ?? DEFAULT_HEALTHCHECK.containerEnabled,
  target: healthcheck.target || healthcheck.url || healthcheck.path || DEFAULT_HEALTHCHECK.target
})

const getDefaultProjectContainerPath = (template) => {
  const volumePath = template?.volumes?.find((volume) => volume?.containerPath)?.containerPath
  if (volumePath) return volumePath
  const image = String(template?.fullImageName || template?.image || '').toLowerCase()
  if (image.includes('nginx')) return '/usr/share/nginx/html'
  if (image.includes('node')) return '/usr/src/app'
  return '/app'
}

const resolveSubmitVolumes = (template, form, baseDir) => {
  const volumes = Array.isArray(form?.volumes) ? form.volumes : []
  const hasProjectVolume = volumes.some((volume) => volume?.containerPath)
  const needsProjectVolume = Boolean(form?.projectArchive || form?.createProject)

  if (!needsProjectVolume || hasProjectVolume) return volumes

  return [
    ...volumes,
    {
      hostPath: baseDir ? `${baseDir}/${form.name}` : '',
      containerPath: getDefaultProjectContainerPath(template)
    }
  ]
}

const postUploadChunk = async (url, buildFormData, config = {}) => {
  let lastError = null
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await uploadApi.post(url, buildFormData(), config)
    } catch (err) {
      lastError = err
      if (attempt === 3) break
      await new Promise((resolve) => setTimeout(resolve, attempt * 500))
    }
  }
  throw lastError
}

const uploadFileInChunks = async ({
  file,
  initUrl,
  chunkUrl,
  completeUrl,
  metadata = {},
  onProgress
}) => {
  const totalChunks = Math.ceil(file.size / UPLOAD_CHUNK_SIZE_BYTES)
  const initResponse = await uploadApi.post(initUrl, {
    ...metadata,
    filename: file.name,
    size: file.size,
    totalChunks
  })
  const uploadId = initResponse.data?.uploadId
  if (!uploadId) {
    throw new Error('Upload em partes não foi iniciado pelo servidor')
  }

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    const start = chunkIndex * UPLOAD_CHUNK_SIZE_BYTES
    const end = Math.min(start + UPLOAD_CHUNK_SIZE_BYTES, file.size)
    const chunk = file.slice(start, end)
    const uploadedBefore = start

    await postUploadChunk(
      chunkUrl,
      () => {
        const formData = new FormData()
        formData.append('uploadId', uploadId)
        formData.append('chunkIndex', String(chunkIndex))
        formData.append('chunk', chunk, `${file.name}.part-${chunkIndex}`)
        return formData
      },
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (event) => {
          const loaded = uploadedBefore + (event.loaded || 0)
          const progress = Math.min(99, Math.round((loaded / file.size) * 100))
          onProgress?.(progress, chunkIndex + 1, totalChunks)
        }
      }
    )

    const progress = Math.min(99, Math.round((end / file.size) * 100))
    onProgress?.(progress, chunkIndex + 1, totalChunks)
  }

  return uploadApi.post(completeUrl, { uploadId }, { timeout: 900000 })
}

const APP_CATEGORY_LABELS = {
  all: 'Todos',
  web: 'Web',
  runtime: 'Runtime',
  database: 'Banco',
  cache: 'Cache',
  tools: 'Ferramentas',
  other: 'Outros'
}

const TEMPLATE_APP_META = {
  'nginx-static': {
    category: 'web',
    icon: Globe,
    accent: 'from-cyan-500/20 to-sky-500/5',
    border: 'border-cyan-500/30'
  },
  'node-app': {
    category: 'runtime',
    icon: Cpu,
    accent: 'from-blue-500/20 to-indigo-500/5',
    border: 'border-blue-500/30'
  },
  'postgres-db': {
    category: 'database',
    icon: Database,
    accent: 'from-emerald-500/20 to-teal-500/5',
    border: 'border-emerald-500/30'
  },
  pgadmin: {
    category: 'tools',
    icon: Wrench,
    accent: 'from-violet-500/20 to-fuchsia-500/5',
    border: 'border-violet-500/30'
  },
  'mysql-db': {
    category: 'database',
    icon: Database,
    accent: 'from-amber-500/20 to-yellow-500/5',
    border: 'border-amber-500/30'
  },
  'redis-cache': {
    category: 'cache',
    icon: Layers,
    accent: 'from-rose-500/20 to-red-500/5',
    border: 'border-rose-500/30'
  },
  default: {
    category: 'other',
    icon: Layers,
    accent: 'from-slate-500/20 to-slate-500/5',
    border: 'border-slate-700'
  }
}

const getTemplateMeta = (templateId) => TEMPLATE_APP_META[templateId] || TEMPLATE_APP_META.default

const METRIC_TONES = {
  brand: 'border-blue-500/30 bg-blue-500/10 text-blue-100',
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
  danger: 'border-rose-500/30 bg-rose-500/10 text-rose-100'
}

const getContainerName = (container) => container?.Names?.[0]?.replace('/', '') || container?.Id?.slice(0, 12) || 'container'

const getContainerStatusMeta = (rawState) => {
  const state = String(rawState || 'unknown').toLowerCase()

  if (state === 'running') {
    return {
      key: 'running',
      label: 'Running',
      className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
    }
  }

  if (['restarting', 'created', 'paused'].includes(state)) {
    return {
      key: 'starting',
      label: 'Starting',
      className: 'border-amber-500/30 bg-amber-500/10 text-amber-200'
    }
  }

  if (['dead', 'removing'].includes(state)) {
    return {
      key: 'error',
      label: 'Error',
      className: 'border-rose-500/30 bg-rose-500/10 text-rose-200'
    }
  }

  if (state === 'exited') {
    return {
      key: 'stopped',
      label: 'Stopped',
      className: 'border-rose-500/30 bg-rose-500/10 text-rose-200'
    }
  }

  return {
    key: 'unknown',
    label: state || 'Unknown',
    className: 'border-slate-700 bg-slate-900/80 text-slate-300'
  }
}

const DockerMetricCard = ({ icon: Icon, label, value, hint, tone = 'brand' }) => (
  <div className={`rounded-2xl border p-4 ${METRIC_TONES[tone] || METRIC_TONES.brand}`}>
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-[10px] uppercase tracking-[0.26em] opacity-80">{label}</p>
        <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
        <p className="mt-1 text-xs opacity-80">{hint}</p>
      </div>
      <span className="rounded-xl border border-white/10 bg-slate-950/40 p-2 text-white">
        <Icon className="h-4 w-4" />
      </span>
    </div>
  </div>
)

const DockerViewTab = ({ active, icon: Icon, label, onClick }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-medium transition ${
      active
        ? 'border-blue-500/60 bg-blue-500/10 text-blue-200'
        : 'border-slate-800 bg-slate-900/60 text-slate-300 hover:border-blue-500/40 hover:text-white'
    }`}
  >
    <Icon className="h-4 w-4" />
    {label}
  </button>
)

const DockerStatusBadge = ({ state }) => {
  const meta = getContainerStatusMeta(state)
  return <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${meta.className}`}>{meta.label}</span>
}

const getStackStatusMeta = (status) => {
  if (status === 'running') {
    return { label: 'Healthy', className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' }
  }
  if (status === 'partial') {
    return { label: 'Partial', className: 'border-amber-500/30 bg-amber-500/10 text-amber-200' }
  }
  if (status === 'stopped') {
    return { label: 'Stopped', className: 'border-rose-500/30 bg-rose-500/10 text-rose-200' }
  }
  return { label: 'Draft', className: 'border-slate-700 bg-slate-900/80 text-slate-300' }
}

const buildPortSummary = (service) => {
  if (service?.hostPort || service?.containerPort) {
    return `${service.hostPort || 'auto'} → ${service.containerPort || '—'}`
  }

  if (Array.isArray(service?.ports) && service.ports.length) {
    return service.ports
      .map((port) => `${port.host || 'auto'} → ${port.container || port.target || '—'}`)
      .join(' · ')
  }

  return 'internal only'
}

const buildClusterTelemetry = (stack, stats = {}) => {
  const services = Array.isArray(stack?.services) ? stack.services : []
  const running = services.filter((service) => service.status === 'running').length
  const endpoints = services.reduce((total, service) => {
    if (Array.isArray(service.ports) && service.ports.length) return total + service.ports.length
    if (service.hostPort) return total + 1
    return total
  }, 0)

  const memoryMb = services.reduce((total, service) => {
    const usage = service.containerId ? stats[service.containerId]?.memoryUsage : 0
    return total + (usage ? Math.round(usage / 1024 / 1024) : 0)
  }, 0)

  const alertItems = services
    .filter((service) => service.status && service.status !== 'running')
    .map((service) => `${service.name} está ${service.status}.`)

  if (!alertItems.length && stack.status === 'running') {
    alertItems.push('Nenhum alerta crítico detectado.')
  } else if (stack.status === 'partial') {
    alertItems.unshift('A stack possui serviços degradados e requer atenção.')
  }

  const base = Math.max(12, services.length * 9 + running * 5)
  const series = ['-30m', '-20m', '-10m', '-5m', 'agora'].map((label, index) => {
    const wave = [0, 4, -2, 6, 2][index]
    return {
      label,
      memory: Math.max(8, Math.min(95, Math.round((memoryMb ? memoryMb / 28 : base) + wave))),
      traffic: Math.max(6, Math.min(100, Math.round(base + running * 6 + index * 4 + wave))),
      accesses: Math.max(20, Math.round((running * 120) + (endpoints * 40) + index * 35 + wave * 4))
    }
  })

  return {
    memoryMb,
    endpoints,
    accesses: series[series.length - 1]?.accesses || 0,
    traffic: series[series.length - 1]?.traffic || 0,
    alertCount: alertItems.filter((item) => item !== 'Nenhum alerta crítico detectado.').length,
    alerts: alertItems.slice(0, 4),
    series
  }
}

const StackClusterCard = ({ stack, onOpen, onToggle, expanded = false, telemetry, onInspectService }) => {
  const statusMeta = getStackStatusMeta(stack.status)

  return (
    <div className="rounded-[24px] border border-slate-800 bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(2,6,23,0.92))] p-4 shadow-[0_12px_40px_rgba(2,6,23,0.35)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.26em] text-cyan-200/75">Compose cluster</p>
          <h4 className="mt-1 text-lg font-semibold text-white">{stack.name}</h4>
          <p className="mt-1 text-xs text-slate-400">{stack.client || 'Workspace'} • {stack.environment || 'default'} • {stack.network || 'bridge'}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${statusMeta.className}`}>{statusMeta.label}</span>
          <button
            className="rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-1.5 text-xs text-slate-200 hover:border-blue-500/40 hover:text-white"
            onClick={onToggle}
          >
            {expanded ? 'Ocultar' : 'Detalhes'}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2">
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Services</p>
          <p className="mt-1 text-base font-semibold text-white">{stack.totalServices}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2">
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Running</p>
          <p className="mt-1 text-base font-semibold text-emerald-200">{stack.runningServices}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2">
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Compose</p>
          <p className="mt-1 truncate text-sm font-semibold text-slate-200">{stack.network || 'cluster-network'}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {stack.services.slice(0, 6).map((service) => {
          const serviceMeta = getStackStatusMeta(service.status)
          return (
            <span key={service.id} className={`rounded-full border px-2.5 py-1 text-[11px] ${serviceMeta.className}`}>
              {service.name}
            </span>
          )
        })}
        {stack.services.length > 6 && (
          <span className="rounded-full border border-slate-700 bg-slate-950/70 px-2.5 py-1 text-[11px] text-slate-300">
            +{stack.services.length - 6} serviços
          </span>
        )}
      </div>

      {expanded ? (
        <div className="mt-4 space-y-4 border-t border-slate-800 pt-4">
          <div className="grid gap-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-3">
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Memória</p>
              <p className="mt-1 text-lg font-semibold text-white">{telemetry.memoryMb ? `${telemetry.memoryMb} MB` : '—'}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-3">
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Acessos</p>
              <p className="mt-1 text-lg font-semibold text-white">{telemetry.accesses}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-3">
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Tráfego</p>
              <p className="mt-1 text-lg font-semibold text-white">{telemetry.traffic}%</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-3">
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Alertas</p>
              <p className="mt-1 text-lg font-semibold text-white">{telemetry.alertCount}</p>
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-3">
            {[
              { key: 'memory', label: 'Memória', color: '#60a5fa' },
              { key: 'accesses', label: 'Acessos', color: '#34d399' },
              { key: 'traffic', label: 'Tráfego', color: '#f59e0b' }
            ].map((chart) => (
              <div key={`${stack.id}-${chart.key}`} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{chart.label}</p>
                <div className="mt-3 h-28">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={telemetry.series}>
                      <defs>
                        <linearGradient id={`${stack.id}-${chart.key}`} x1="0" x2="0" y1="0" y2="1">
                          <stop offset="0%" stopColor={chart.color} stopOpacity={0.45} />
                          <stop offset="100%" stopColor={chart.color} stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <RechartsTooltip
                        contentStyle={{ background: '#020617', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 12, color: '#e2e8f0' }}
                        labelStyle={{ color: '#94a3b8' }}
                      />
                      <Area type="monotone" dataKey={chart.key} stroke={chart.color} fill={`url(#${stack.id}-${chart.key})`} strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ))}
          </div>

          <div className="grid gap-3 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Serviços do cluster</p>
              <div className="mt-3 space-y-2">
                {stack.services.map((service) => {
                  const serviceMeta = getStackStatusMeta(service.status)
                  return (
                    <div key={service.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-3">
                      <div>
                        <p className="text-sm font-semibold text-white">{service.name}</p>
                        <p className="text-xs text-slate-400">{service.role || 'runtime'} • {buildPortSummary(service)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full border px-2.5 py-1 text-[11px] ${serviceMeta.className}`}>{serviceMeta.label}</span>
                        <button
                          className="rounded-lg border border-blue-800 bg-blue-950 px-3 py-1.5 text-xs text-blue-200 hover:bg-blue-900"
                          onClick={() => onInspectService(service)}
                        >
                          Logs
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Alertas e eventos</p>
              <div className="mt-3 space-y-2">
                {telemetry.alerts.map((item, index) => (
                  <div key={`${stack.id}-alert-${index}`} className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-slate-200">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-800 pt-3">
        <p className="text-xs text-slate-400">Visão agrupada do compose gerado pela stack.</p>
        <button
          className="rounded-xl border border-blue-800 bg-blue-950 px-3 py-1.5 text-xs text-blue-200 hover:bg-blue-900"
          onClick={onOpen}
        >
          Abrir stack
        </button>
      </div>
    </div>
  )
}

const DockerCatalogCard = ({ tpl, installedCount, onInstall }) => {
  const appMeta = getTemplateMeta(tpl.id)
  const Icon = appMeta.icon || Layers

  return (
    <div className={`group rounded-2xl border bg-gradient-to-br p-4 transition duration-300 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-slate-950/40 ${appMeta.border} ${appMeta.accent}`}>
      <div className="flex items-start justify-between gap-3">
        <span className="rounded-xl border border-white/10 bg-slate-950/70 p-2 text-slate-100">
          <Icon className="h-4 w-4" />
        </span>
        <span className="rounded-full border border-slate-700 bg-slate-950/70 px-2.5 py-1 text-[10px] text-slate-300">
          {installedCount} instância(s)
        </span>
      </div>

      <div className="mt-4 space-y-2">
        <div>
          <p className="text-base font-semibold text-white">{tpl.label}</p>
          <p className="mt-1 text-sm leading-5 text-slate-300">{tpl.description}</p>
        </div>

        <div className="flex flex-wrap gap-2 text-[11px] text-slate-300">
          <span className="rounded-full border border-slate-700 bg-slate-950/70 px-2.5 py-1">{tpl.image}:{tpl.tag}</span>
          <span className="rounded-full border border-slate-700 bg-slate-950/70 px-2.5 py-1">{tpl.defaultPort} → {tpl.containerPort}</span>
        </div>
      </div>

      <button
        className="mt-4 w-full rounded-xl bg-blue-500 px-3 py-2 text-xs font-semibold text-slate-950 transition hover:bg-blue-400"
        onClick={onInstall}
      >
        Install
      </button>
    </div>
  )
}

const DockerPanel = ({ showPageIntro = true }) => {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('dashboard')
  const [containers, setContainers] = useState([])
  const [images, setImages] = useState([])
  const [stats, setStats] = useState({})
  const [selectedContainer, setSelectedContainer] = useState(null)
  const [logs, setLogs] = useState('')
  const [loading, setLoading] = useState(false)
  const [wizard, setWizard] = useState(null)
  const [configText, setConfigText] = useState('{\n  "name": "app-01",\n  "HostConfig": {}\n}')
  const [templates, setTemplates] = useState([])
  const [services, setServices] = useState([])
  const [stacks, setStacks] = useState([])
  const [networks, setNetworks] = useState([])
  const [registries, setRegistries] = useState([])
  const [toasts, setToasts] = useState([])
  const [serviceForm, setServiceForm] = useState(null)
  const [serviceProgress, setServiceProgress] = useState([])
  const [serviceWorking, setServiceWorking] = useState(false)
  const [portAvailability, setPortAvailability] = useState(null)
  const [baseDir, setBaseDir] = useState('')
  const [editDialog, setEditDialog] = useState(null)
  const [envImportDialog, setEnvImportDialog] = useState(null)
  const [envImportStatus, setEnvImportStatus] = useState(null)
  const [projectUploadStatus, setProjectUploadStatus] = useState(null)
  const [serviceUpdateStatus, setServiceUpdateStatus] = useState(null)
  const [removeDialog, setRemoveDialog] = useState(null)
  const [postgresDatabases, setPostgresDatabases] = useState([])
  const [logsExpanded, setLogsExpanded] = useState(false)
  const [customImageName, setCustomImageName] = useState('')
  const [buildImageName, setBuildImageName] = useState('')
  const [buildDockerfile, setBuildDockerfile] = useState('')
  const [buildContextArchive, setBuildContextArchive] = useState(null)
  const [buildReplaceImage, setBuildReplaceImage] = useState(null)
  const [registryAdvanced, setRegistryAdvanced] = useState(false)
  const [selectedRegistry, setSelectedRegistry] = useState('')
  const [registryDialog, setRegistryDialog] = useState(null)
  const [pullWorking, setPullWorking] = useState(false)
  const [buildWorking, setBuildWorking] = useState(false)
  const [buildStatus, setBuildStatus] = useState(null)
  const [appSearch, setAppSearch] = useState('')
  const [opsSearch, setOpsSearch] = useState('')
  const [appCategory, setAppCategory] = useState('all')
  const [expandedClusterId, setExpandedClusterId] = useState(null)
  const socket = useMemo(() => createDockerLogsSocket(), [])
  const progressSocket = useMemo(() => createDockerProgressSocket(), [])
  const buildSessionRef = useRef(null)

  const templateMap = useMemo(
    () => new Map((templates || []).map((template) => [template.id, template])),
    [templates]
  )

  const appCategories = useMemo(() => {
    const categories = new Set(['all'])
    templates.forEach((template) => {
      categories.add(getTemplateMeta(template.id).category)
    })
    return Array.from(categories)
  }, [templates])

  const filteredTemplates = useMemo(() => {
    const searchTerm = appSearch.trim().toLowerCase()
    return templates.filter((template) => {
      const meta = getTemplateMeta(template.id)
      const matchesCategory = appCategory === 'all' || meta.category === appCategory
      const matchesSearch =
        !searchTerm ||
        String(template.label || '').toLowerCase().includes(searchTerm) ||
        String(template.description || '').toLowerCase().includes(searchTerm) ||
        String(template.image || '').toLowerCase().includes(searchTerm)
      return matchesCategory && matchesSearch
    })
  }, [templates, appCategory, appSearch])

  const groupedInstalledApps = useMemo(() => {
    const runningByContainerId = new Map(
      containers.map((container) => [container.Id, container.State === 'running'])
    )
    const groups = new Map()

    services.forEach((service) => {
      const templateId = service.templateId || 'custom-image'
      const template = templateMap.get(templateId)
      const meta = getTemplateMeta(templateId)
      if (!groups.has(templateId)) {
        groups.set(templateId, {
          templateId,
          template,
          meta,
          services: [],
          running: 0
        })
      }
      const group = groups.get(templateId)
      group.services.push(service)
      if (runningByContainerId.get(service.containerId)) {
        group.running += 1
      }
    })

    const searchTerm = appSearch.trim().toLowerCase()
    return Array.from(groups.values())
      .filter((group) => {
        const label = group.template?.label || group.services[0]?.templateId || group.templateId
        const description = group.template?.description || ''
        const imageName = group.template?.image || group.services[0]?.image || ''
        const matchesCategory = appCategory === 'all' || group.meta.category === appCategory
        const matchesSearch =
          !searchTerm ||
          String(label).toLowerCase().includes(searchTerm) ||
          String(description).toLowerCase().includes(searchTerm) ||
          String(imageName).toLowerCase().includes(searchTerm)
        return matchesCategory && matchesSearch
      })
      .sort((a, b) => b.services.length - a.services.length)
  }, [services, containers, templateMap, appCategory, appSearch])

  const appCategoryCounts = useMemo(() => {
    const counts = { all: templates.length }
    templates.forEach((template) => {
      const category = getTemplateMeta(template.id).category
      counts[category] = (counts[category] || 0) + 1
    })
    return counts
  }, [templates])

  const stackClusters = useMemo(() => {
    return (stacks || []).map((stack) => {
      const stackServices = Array.isArray(stack.services) ? stack.services : []
      const runningServices = stackServices.filter((service) => service.status === 'running').length
      return {
        ...stack,
        services: stackServices,
        totalServices: stackServices.length,
        runningServices
      }
    })
  }, [stacks])

  const visibleStackClusters = useMemo(() => {
    const runningFirst = stackClusters.filter((stack) => stack.status === 'running' || stack.status === 'partial')
    return runningFirst.length ? runningFirst : stackClusters
  }, [stackClusters])

  const totalInstalledInstances = services.length
  const containerLookup = useMemo(() => {
    const map = new Map()
    containers.forEach((container) => {
      map.set(container.Id, container)
      map.set(getContainerName(container), container)
    })
    return map
  }, [containers])

  const operationalInstances = useMemo(() => {
    return services
      .map((service) => {
        const container = containerLookup.get(service.containerId) || containerLookup.get(service.name)
        const runtimeState = container?.State || 'exited'
        return {
          ...service,
          containerName: getContainerName(container) || service.name,
          runtimeState,
          stateMeta: getContainerStatusMeta(runtimeState)
        }
      })
      .sort((a, b) => {
        const priority = { running: 0, starting: 1, stopped: 2, error: 3, unknown: 4 }
        return (priority[a.stateMeta.key] ?? 5) - (priority[b.stateMeta.key] ?? 5)
      })
  }, [services, containerLookup])

  const filteredOperationalInstances = useMemo(() => {
    const searchTerm = opsSearch.trim().toLowerCase()
    if (!searchTerm) return operationalInstances

    return operationalInstances.filter((service) => {
      return [service.name, service.image, service.networkName, service.hostPort]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(searchTerm))
    })
  }, [operationalInstances, opsSearch])

  const stackServiceKeys = useMemo(() => {
    const keys = new Set()
    stackClusters.forEach((stack) => {
      stack.services.forEach((service) => {
        if (service.name) keys.add(`name:${service.name}`)
        if (service.containerId) keys.add(`id:${service.containerId}`)
      })
    })
    return keys
  }, [stackClusters])

  const independentServices = useMemo(() => {
    return operationalInstances.filter((item) => {
      return !stackServiceKeys.has(`name:${item.name}`) && !stackServiceKeys.has(`id:${item.containerId}`)
    })
  }, [operationalInstances, stackServiceKeys])

  const filteredIndependentServices = useMemo(() => {
    const searchTerm = opsSearch.trim().toLowerCase()
    if (!searchTerm) return independentServices

    return independentServices.filter((service) => {
      return [service.name, service.image, service.networkName, service.hostPort]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(searchTerm))
    })
  }, [independentServices, opsSearch])

  const totalRunningInstances = operationalInstances.filter((item) => item.stateMeta.key === 'running').length
  const totalStoppedInstances = operationalInstances.filter((item) => item.stateMeta.key === 'stopped').length
  const totalErrorInstances = operationalInstances.filter((item) => item.stateMeta.key === 'error').length
  const totalStartingInstances = operationalInstances.filter((item) => item.stateMeta.key === 'starting').length
  const totalRunningStacks = stackClusters.filter((stack) => stack.status === 'running' || stack.status === 'partial').length
  const quickInstallTemplate = templates.find((template) => template.id === 'nginx-static') || templates[0] || null

  const inspectClusterService = async (service) => {
    const container = containerLookup.get(service.containerId) || containerLookup.get(service.name)
    if (!container) {
      addToast('Logs indisponíveis para este serviço', 'error')
      return
    }
    await openLogs(container)
  }

  const toggleClusterExpand = async (stack) => {
    const nextValue = expandedClusterId === stack.id ? null : stack.id
    setExpandedClusterId(nextValue)

    if (nextValue) {
      const ids = (stack.services || []).map((service) => service.containerId).filter(Boolean)
      await Promise.all(ids.map((id) => loadStats(id, { silent: true })))
    }
  }

  const validateServiceName = (name) => {
    if (!name || typeof name !== 'string') {
      return 'Nome do serviço é obrigatório';
    }
    if (name.length < 2 || name.length > 50) {
      return 'Nome deve ter entre 2 e 50 caracteres';
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      return 'Nome pode conter apenas letras, números, _ e -';
    }
    if (services.some(s => s.name === name)) {
      return 'Já existe um serviço com este nome';
    }
    return null;
  };

  const addToast = (message, type = 'success') => {
    const id = generateUUID()
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id))
    }, 4000)
  }

  const loadContainers = async () => {
    setLoading(true)
    try {
      const response = await api.get('/docker/containers')
      setContainers(response.data.containers || [])
    } catch (err) {
      addToast('Erro ao carregar containers', 'error')
    } finally {
      setLoading(false)
    }
  }

  const loadImages = async () => {
    try {
      const response = await api.get('/docker/images')
      setImages(response.data.images || [])
    } catch (err) {
      addToast('Erro ao carregar imagens', 'error')
    }
  }

  const loadTemplates = async () => {
    try {
      const response = await api.get('/docker/templates')
      setTemplates(response.data.templates || [])
      setBaseDir(response.data.baseDir || '')
    } catch (err) {
      addToast('Erro ao carregar templates', 'error')
    }
  }

  const loadNetworks = async () => {
    try {
      await api.post('/docker/networks/ensure', { name: 'provirpanel' })
      const response = await api.get('/docker/networks')
      setNetworks(response.data.networks || [])
    } catch (err) {
      addToast('Erro ao carregar redes', 'error')
    }
  }

  const loadRegistries = async () => {
    try {
      const response = await api.get('/docker/registries')
      setRegistries(response.data.registries || [])
    } catch (err) {
      addToast('Erro ao carregar repositorios', 'error')
    }
  }

  const loadServices = async () => {
    try {
      const response = await api.get('/docker/services')
      const loadedServices = Array.isArray(response.data?.services)
        ? response.data.services
        : Array.isArray(response.data)
          ? response.data
          : Array.isArray(response.data?.data)
            ? response.data.data
            : []
      setServices(loadedServices)
    } catch (err) {
      addToast('Erro ao carregar servicos', 'error')
    }
  }

  const loadPostgresDatabases = async () => {
    try {
      const response = await api.get('/docker/postgres-databases')
      setPostgresDatabases(response.data.databases || [])
    } catch (err) {
      console.error('Error loading postgres databases:', err)
    }
  }

  const loadStacks = async () => {
    try {
      const response = await api.get('/stacks')
      const nextStacks = Array.isArray(response.data) ? response.data : response.data?.stacks || []
      setStacks(nextStacks)
    } catch {
      setStacks([])
    }
  }

  const loadStats = async (containerId, options = {}) => {
    try {
      const response = await api.get(`/docker/containers/${containerId}/stats`)
      setStats((prev) => ({ ...prev, [containerId]: response.data.stats }))
    } catch (err) {
      if (!options.silent) addToast('Erro ao carregar stats', 'error')
    }
  }

  useEffect(() => {
    loadContainers()
    loadTemplates()
    loadServices()
    loadStacks()
    loadNetworks()
    loadPostgresDatabases()
    loadImages()
    loadRegistries()
  }, [])

  useEffect(() => {
    if (!wizard) {
      setServiceForm(null)
      setServiceProgress([])
      setServiceWorking(false)
      setPortAvailability(null)
      setEnvImportStatus(null)
      return
    }

    const template = templates.find((t) => t.id === wizard.id || t.id === wizard.templateId)
    const tpl = template || wizard

    setServiceForm({
      name: tpl?.label ? tpl.label.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase() : 'service-1',
      hostPort: '', // Iniciar com porta vazia
      containerPort: tpl?.containerPort || 80,
      volumes:
        tpl?.volumes?.map((v) => ({
          hostPath: v.hostPath || (baseDir ? `${baseDir}/${tpl?.label ? tpl.label.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase() : 'service'}` : ''),
          containerPath: v.containerPath
        })) || [],
      envs: tpl?.env?.map((e) => ({ key: e.key, value: e.value, secret: false })) || [],
      command: '',
      projectArchive: null,
      createProject: false,
      createManager: false,
      configureDb: null,
      networkName: 'provirpanel',
      bindLocalOnly: true,
      nodeServiceMode: NODE_SERVICE_MODES.service,
      nodeSiteConfig: {
        siteType: NODE_SITE_TYPES.common,
        siteFolder: NODE_SITE_FOLDERS[0],
        fallbackFile: 'index.html'
      }
    })
    
    // Scroll para o wizard quando aberto
    if (wizard) {
      setTimeout(() => {
        const wizardElement = document.querySelector('.wizard-container')
        if (wizardElement) {
          wizardElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      }, 100)
    }
  }, [wizard, templates, baseDir])

  useEffect(() => {
    if (!serviceForm?.hostPort || serviceForm.hostPort === '') {
      setPortAvailability(null)
      return
    }
    const port = Number(serviceForm.hostPort)
    if (!port) return
    
    // Verificar se a porta está disponível
    Promise.all([
      api.get('/docker/containers').then(res => {
        const containers = res.data.containers || []
        const usedPorts = []
        containers.forEach(container => {
          (container.Ports || []).forEach(portInfo => {
            if (portInfo.PublicPort) {
              usedPorts.push(portInfo.PublicPort)
            }
          })
        })
        return !usedPorts.includes(port)
      }),
      fetch(`http://localhost:${port}`).then(() => false).catch(() => true)
    ]).then(([dockerFree, systemFree]) => {
      setPortAvailability(dockerFree && systemFree)
    }).catch(() => setPortAvailability(null))
  }, [serviceForm?.hostPort])

  useEffect(() => {
    if (!progressSocket) {
      return undefined
    }

    const handleProgress = (payload) => {
      if (payload.type === 'image-build') {
        if (payload.sessionId && payload.sessionId !== buildSessionRef.current) return
        if (payload.message) {
          setBuildStatus((prev) => ({
            status: payload.phase === 'done' ? 'success' : 'building',
            progress: payload.phase === 'done' ? 100 : Math.max(prev?.progress || 0, 99),
            message: payload.message,
            logs: [...(prev?.logs || []), payload.message]
          }))
        }
        return
      }
      if (payload.message) {
        setServiceProgress((prev) => [...prev, payload.message])
      }
    }

    progressSocket.on('progress', handleProgress)

    return () => {
      progressSocket.off('progress', handleProgress)
    }
  }, [progressSocket])

  // Disconnect progress socket only on unmount
  useEffect(() => {
    return () => {
      if (progressSocket) progressSocket.disconnect()
    }
  }, [])

  useEffect(() => {
    if (!socket) {
      return undefined
    }

    const handleLog = (payload) => {
      const chunk = formatLogChunk(payload.data || '', payload.ts)
      setLogs((prev) => `${prev}${chunk}${chunk.endsWith('\n') ? '' : '\n'}`)
    }

    const handleError = (payload) => addToast(payload.message, 'error')
    const handleEnd = () => {}

    socket.on('log', handleLog)
    socket.on('error', handleError)
    socket.on('end', handleEnd)

    return () => {
      socket.off('log', handleLog)
      socket.off('error', handleError)
      socket.off('end', handleEnd)
    }
  }, [socket])

  // Disconnect socket only on unmount
  useEffect(() => {
    return () => {
      if (socket) socket.disconnect()
    }
  }, [])

  const handleAction = async (action, id) => {
    try {
      if (action === 'start') {
        await api.post(`/docker/containers/${id}/start`)
      }
      if (action === 'stop') {
        await api.post(`/docker/containers/${id}/stop`)
      }
      if (action === 'restart') {
        await api.post(`/docker/containers/${id}/restart`)
      }
      if (action === 'delete') {
        await api.delete(`/docker/containers/${id}`)
      }
      addToast('Operacao concluida')
      loadContainers()
      loadServices()
    } catch (err) {
      addToast('Erro na operacao', 'error')
    }
  }

  const openLogs = async (container) => {
    setSelectedContainer(container)
    setLogs('')
    if (socket) {
      socket.emit('subscribe', { containerId: container.Id, tail: 200 })
    }
    await loadStats(container.Id)
  }

  const pullImage = async (imageName) => {
    try {
      await api.post('/docker/images/pull', { imageName })
      addToast('Imagem baixada')
      loadImages()
    } catch (err) {
      addToast('Erro ao baixar imagem', 'error')
    }
  }

  const removeImage = async (imageId) => {
    try {
      await api.delete(`/docker/images/${imageId}`)
      addToast('Imagem removida')
      loadImages()
    } catch (err) {
      addToast('Erro ao remover imagem', 'error')
    }
  }

  const updateImage = async (imageId) => {
    try {
      await api.post(`/docker/images/${imageId}/pull`)
      addToast('Imagem atualizada')
      loadImages()
    } catch (err) {
      addToast('Erro ao atualizar imagem', 'error')
    }
  }

  const prepareImageRebuild = (tag, imageId) => {
    if (!tag || tag === 'none') {
      addToast('Imagem sem tag não pode ser rebuildada diretamente', 'error')
      return
    }
    setBuildImageName(tag)
    setBuildDockerfile(`FROM ${tag}\n\n# Edite as instruções abaixo e use o mesmo nome/tag para substituir esta imagem.\n`)
    setBuildContextArchive(null)
    setBuildReplaceImage({ id: imageId, tag })
    setBuildStatus({
      status: 'idle',
      progress: 0,
      message: `Preparando rebuild de ${tag}`,
      logs: []
    })
    setActiveTab('images')
  }

  const pullCustomImage = async () => {
    if (!customImageName.trim()) {
      addToast('Informe o nome da imagem', 'error')
      return
    }
    setPullWorking(true)
    try {
      await api.post('/docker/images/pull', {
        imageName: customImageName.trim(),
        registryId: selectedRegistry || undefined,
        allowAny: true
      })
      addToast('Imagem baixada')
      setCustomImageName('')
      loadImages()
    } catch (err) {
      addToast(err.response?.data?.message || 'Erro ao baixar imagem', 'error')
    } finally {
      setPullWorking(false)
    }
  }

  const buildCustomImage = async () => {
    if (!buildImageName.trim()) {
      addToast('Informe o nome da imagem para build', 'error')
      return
    }
    if (!buildDockerfile.trim()) {
      addToast('Cole o conteúdo do Dockerfile', 'error')
      return
    }

    const formData = new FormData()
    const buildSessionId = generateUUID()
    buildSessionRef.current = buildSessionId
    const replaceImageId =
      buildReplaceImage?.tag === buildImageName.trim() ? buildReplaceImage.id : ''
    formData.append('imageName', buildImageName.trim())
    formData.append('dockerfileContent', buildDockerfile)
    formData.append('buildSessionId', buildSessionId)
    if (replaceImageId) {
      formData.append('replaceImageId', replaceImageId)
    }
    if (buildContextArchive) {
      formData.append('contextArchive', buildContextArchive)
    }

    setBuildWorking(true)
    setBuildStatus({
      status: 'uploading',
      progress: buildContextArchive ? 0 : 5,
      message: buildContextArchive ? 'Enviando contexto do build...' : 'Preparando build...',
      logs: []
    })
    try {
      const response =
        buildContextArchive && buildContextArchive.size > CHUNKED_UPLOAD_THRESHOLD_BYTES
          ? await uploadFileInChunks({
              file: buildContextArchive,
              initUrl: '/docker/images/build/init',
              chunkUrl: '/docker/images/build/chunk',
              completeUrl: '/docker/images/build/complete',
              metadata: {
                imageName: buildImageName.trim(),
                dockerfileContent: buildDockerfile,
                buildSessionId,
                replaceImageId
              },
              onProgress: (progress, chunkIndex, totalChunks) => {
                setBuildStatus((prev) => ({
                  ...(prev || {}),
                  status: progress >= 99 ? 'building' : 'uploading',
                  progress,
                  message:
                    progress >= 99
                      ? 'Contexto enviado. Build em andamento...'
                      : `Enviando contexto (${chunkIndex}/${totalChunks})...`
                }))
              }
            })
          : await uploadApi.post('/docker/images/build', formData, {
              headers: { 'Content-Type': 'multipart/form-data' },
              timeout: 300000,
              onUploadProgress: (event) => {
                const total = event.total || 0
                const progress = total ? Math.min(99, Math.round((event.loaded / total) * 100)) : 10
                setBuildStatus((prev) => ({
                  ...(prev || {}),
                  status: progress >= 99 ? 'building' : 'uploading',
                  progress,
                  message: progress >= 99 ? 'Contexto enviado. Build em andamento...' : 'Enviando contexto...'
                }))
              }
            })
      addToast(`Imagem construída: ${response.data?.imageName || buildImageName}`)
      setBuildStatus((prev) => ({
        status: 'success',
        progress: 100,
        message: `Imagem construída: ${response.data?.imageName || buildImageName}`,
        logs: response.data?.progress?.length ? response.data.progress : prev?.logs || []
      }))
      setBuildContextArchive(null)
      setBuildReplaceImage(null)
      loadImages()
    } catch (err) {
      const message = err.response?.data?.message || 'Erro ao construir imagem'
      const logs = err.response?.data?.progress || []
      setBuildStatus((prev) => ({
        status: 'error',
        progress: prev?.progress || 0,
        message,
        logs: logs.length ? logs : [...(prev?.logs || []), message]
      }))
      addToast(message, 'error')
    } finally {
      setBuildWorking(false)
    }
  }

  const saveRegistry = async (payload) => {
    try {
      await api.post('/docker/registries', payload)
      addToast('Repositorio salvo')
      setRegistryDialog(null)
      loadRegistries()
    } catch (err) {
      addToast(err.response?.data?.message || 'Erro ao salvar repositorio', 'error')
    }
  }

  const removeRegistry = async (registryId) => {
    try {
      await api.delete(`/docker/registries/${registryId}`)
      addToast('Repositorio removido')
      loadRegistries()
    } catch (err) {
      addToast('Erro ao remover repositorio', 'error')
    }
  }

  const updateService = async (serviceId, config, options = {}) => {
    const apply = options.apply ?? true
    let timer = null
    setServiceUpdateStatus({
      status: apply ? 'applying' : 'saving',
      progress: apply ? 8 : 30,
      message: apply
        ? 'Preparando atualização do serviço...'
        : 'Salvando configuração pendente...'
    })
    try {
      timer = setInterval(() => {
        setServiceUpdateStatus((prev) => {
          if (!prev || !['saving', 'applying'].includes(prev.status)) return prev
          const nextProgress = Math.min(92, (prev.progress || 0) + (apply ? 6 : 14))
          return {
            ...prev,
            progress: nextProgress,
            message: apply
              ? nextProgress < 45
                ? 'Validando configuração...'
                : nextProgress < 75
                  ? 'Recriando container e atualizando ambiente...'
                  : 'Aguardando resposta do serviço...'
              : 'Persistindo configuração no painel...'
          }
        })
      }, 900)
      const response = await api.put(`/docker/services/${serviceId}`, {
        ...config,
        apply
      })
      if (timer) clearInterval(timer)
      setServiceUpdateStatus({
        status: 'success',
        progress: 100,
        message: apply ? 'Configuração aplicada com sucesso.' : 'Configuração salva. Use Aplicar para executar.'
      })
      addToast(apply ? 'Configuração aplicada' : 'Configuração salva')
      await Promise.all([loadServices(), loadContainers()])
      return response.data?.service || true
    } catch (err) {
      if (timer) clearInterval(timer)
      const message =
        err.response?.data?.message ||
        err.message ||
        (apply ? 'Erro ao aplicar serviço' : 'Erro ao salvar configuração')
      setServiceUpdateStatus({
        status: 'error',
        progress: 0,
        message
      })
      addToast(message, 'error')
      return false
    }
  }

  const uploadProjectArchive = async (serviceId, file, options = {}) => {
    if (!serviceId || !file) return false
    const formData = new FormData()
    formData.append('archive', file)
    const hasEnvVars = Object.prototype.hasOwnProperty.call(options, 'envVars')
    if (hasEnvVars) {
      formData.append('envVars', JSON.stringify(options.envVars || []))
    }
    if (options.healthcheck) {
      formData.append('healthcheck', JSON.stringify(options.healthcheck))
    }
    if (Object.prototype.hasOwnProperty.call(options, 'autoRollback')) {
      formData.append('autoRollback', String(!!options.autoRollback))
    }
    try {
      setProjectUploadStatus({ status: 'uploading', progress: 0, message: 'Enviando arquivo...' })
      let response = null
      if (file.size > CHUNKED_UPLOAD_THRESHOLD_BYTES) {
        const metadata = hasEnvVars ? { envVars: options.envVars || [] } : {}
        if (options.healthcheck) metadata.healthcheck = options.healthcheck
        if (Object.prototype.hasOwnProperty.call(options, 'autoRollback')) {
          metadata.autoRollback = !!options.autoRollback
        }
        response = await uploadFileInChunks({
          file,
          initUrl: `/docker/services/${serviceId}/project-upload/init`,
          chunkUrl: `/docker/services/${serviceId}/project-upload/chunk`,
          completeUrl: `/docker/services/${serviceId}/project-upload/complete`,
          metadata,
          onProgress: (progress, chunkIndex, totalChunks) => {
            setProjectUploadStatus((prev) => ({
              ...(prev || {}),
              status: progress >= 99 ? 'processing' : 'uploading',
              progress,
              message: `Enviando arquivo em partes (${chunkIndex}/${totalChunks})...`
            }))
          }
        })
      } else {
        response = await uploadApi.post(`/docker/services/${serviceId}/project-upload`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (event) => {
            const total = event.total || 0
            const progress = total ? Math.round((event.loaded / total) * 100) : 0
            setProjectUploadStatus((prev) => ({
              ...(prev || {}),
              status: total && event.loaded >= total ? 'processing' : 'uploading',
              progress
            }))
          }
        })
      }
      const updated = response?.data?.service
      if (updated) {
        setEditDialog((prev) => {
          if (!prev || prev.id !== serviceId) return prev
          return {
            ...prev,
            ...updated,
            newEnvVars: (updated.envVars || []).map((env) => ({
              ...env,
              value: env.secret ? '******' : env.value
            })),
            newProjectArchive: null,
            healthcheck: normalizeHealthcheckForm(updated.healthcheck || {}),
            autoRollback: updated.autoRollback ?? true
          }
        })
      }
      setProjectUploadStatus({
        status: 'success',
        progress: 100,
        message: 'Projeto publicado com sucesso. Consulte os logs se precisar.'
      })
      addToast('Projeto atualizado com sucesso')
      loadContainers()
      loadServices()
      return true
    } catch (err) {
      const message = err.response?.data?.message || err.message || 'Erro ao enviar projeto'
      setProjectUploadStatus({
        status: 'error',
        progress: 0,
        message
      })
      addToast(message, 'error')
      return false
    }
  }

  const rollbackServiceVersion = async (serviceId, versionId) => {
    if (!serviceId || !versionId) return false
    try {
      const response = await api.post(`/docker/services/${serviceId}/rollback`, { versionId })
      addToast('Rollback executado')
      await Promise.all([loadServices(), loadContainers()])
      const updated = response.data?.service
      setEditDialog((prev) => {
        if (!prev || prev.id !== serviceId) return prev
        return updated
          ? {
              ...prev,
              ...updated,
              newEnvVars: (updated.envVars || []).map((env) => ({
                ...env,
                value: env.secret ? '******' : env.value
              })),
              newProjectArchive: null,
              healthcheck: normalizeHealthcheckForm(updated.healthcheck || {}),
              autoRollback: updated.autoRollback ?? true
            }
          : prev
      })
      return true
    } catch (err) {
      const message = err.response?.data?.message || err.message || 'Erro ao executar rollback'
      addToast(message, 'error')
      return false
    }
  }

  const buildEditServicePayload = (dialog) => {
    const requestedCommand =
      dialog.templateId === 'node-app' &&
      dialog.nodeServiceMode === NODE_SERVICE_MODES.sites
        ? ''
        : dialog.commandInput || ''
    return {
      hostPort: dialog.newHostPort || dialog.hostPort,
      envVars: dialog.newEnvVars || [],
      networkName: dialog.newNetworkName || dialog.networkName,
      command: requestedCommand,
      bindLocalOnly: dialog.newBindLocalOnly ?? dialog.bindLocalOnly ?? false,
      healthcheck: dialog.healthcheck,
      autoRollback: dialog.autoRollback ?? true,
      nodeServiceMode: dialog.nodeServiceMode || NODE_SERVICE_MODES.service,
      nodeSiteConfig: dialog.nodeSiteConfig
    }
  }

  const removeService = async (serviceId, removeFolder = false) => {
    try {
      await api.delete(`/docker/services/${serviceId}`, {
        data: { removeFolder }
      })
      addToast('Serviço removido')
      loadServices()
      loadContainers()
    } catch (err) {
      addToast('Erro ao remover serviço', 'error')
    }
  }

  const openEditServiceDialog = (svc) => {
    setProjectUploadStatus(null)
    setServiceUpdateStatus(null)
    setEnvImportStatus(null)
    const pending = svc.pendingConfig || null
    const effectiveNodeSiteConfig = {
      siteType: pending?.nodeSiteConfig?.siteType || svc.nodeSiteConfig?.siteType || NODE_SITE_TYPES.common,
      siteFolder: pending?.nodeSiteConfig?.siteFolder || svc.nodeSiteConfig?.siteFolder || NODE_SITE_FOLDERS[0],
      fallbackFile: pending?.nodeSiteConfig?.fallbackFile || svc.nodeSiteConfig?.fallbackFile || 'index.html'
    }
    setEditDialog({
      ...svc,
      newEnvVars: (pending?.envVars || svc.envVars || []).map((env) => ({
        ...env,
        value: env.secret ? '******' : env.value
      })),
      newHostPort: pending?.hostPort ?? svc.hostPort,
      newNetworkName: pending?.networkName || svc.networkName || 'provirpanel',
      newBindLocalOnly: pending?.bindLocalOnly ?? svc.bindLocalOnly ?? false,
      commandInput: formatCommandForInput(pending?.command ?? svc.command),
      newProjectArchive: null,
      healthcheck: normalizeHealthcheckForm(pending?.healthcheck || svc.healthcheck || {}),
      autoRollback: pending?.autoRollback ?? svc.autoRollback ?? true,
      originalNodeServiceMode: svc.nodeServiceMode || NODE_SERVICE_MODES.service,
      originalNodeSiteConfig: {
        siteType: svc.nodeSiteConfig?.siteType || NODE_SITE_TYPES.common,
        siteFolder: svc.nodeSiteConfig?.siteFolder || NODE_SITE_FOLDERS[0],
        fallbackFile: svc.nodeSiteConfig?.fallbackFile || 'index.html'
      },
      nodeServiceMode: pending?.nodeServiceMode || svc.nodeServiceMode || NODE_SERVICE_MODES.service,
      nodeSiteConfig: effectiveNodeSiteConfig
    })
  }

  const createService = async (template, form) => {
    // Validate service name before sending to backend
    const nameError = validateServiceName(form.name);
    if (nameError) {
      addToast(nameError, 'error');
      return;
    }

    // Prevent multiple submissions
    if (serviceWorking) {
      return;
    }

    setServiceWorking(true)
    setServiceProgress([`Iniciando criação do serviço ${form.name}...`])
    
    const timeoutId = setTimeout(() => {
      setServiceProgress(prev => [...prev, '⚠️ Operação demorou mais que o esperado. Verifique os logs do Docker.']);
    }, 30000); // 30 second warning
    
    try {
      const volumeMappings = resolveSubmitVolumes(template, form, baseDir)
      const response = await api.post('/docker/services', {
        templateId: template.id,
        imageName: template.fullImageName,
        containerPort: form.containerPort,
        name: form.name,
        hostPort: form.hostPort,
        volumeMappings,
        envVars: form.envs,
        createProject: form.createProject,
        createManager: form.createManager,
        configureDb: form.configureDb,
        networkName: form.networkName,
        command: form.command,
        bindLocalOnly: form.bindLocalOnly,
        nodeServiceMode: form.nodeServiceMode,
        nodeSiteConfig: form.nodeSiteConfig
      }, {
        timeout: 120000 // 2 minute timeout
      })
      
      clearTimeout(timeoutId);
      
      const progress = response.data.progress || []
      if (progress.length) {
        setServiceProgress(progress)
      }
      setServiceProgress((prev) => [...prev, '✅ Serviço criado com sucesso.'])
      addToast(`Serviço criado: ${response.data.service?.name}`)
      loadContainers()
      loadServices()

      if (form.projectArchive && response.data.service?.id) {
        await uploadProjectArchive(response.data.service.id, form.projectArchive, {
          envVars: form.envs || []
        })
      }
      
      // Close wizard on success
      setTimeout(() => {
        setWizard(null)
      }, 2000)
    } catch (err) {
      clearTimeout(timeoutId);
      
      const isTimeout = err.code === 'ECONNABORTED' || err.message?.includes('timeout');
      const apiMessage = isTimeout 
        ? 'Timeout: Operação demorou muito. Verifique se o Docker está funcionando.'
        : err.response?.data?.message || err.message || 'Erro ao criar serviço';
      
      const apiProgress = err.response?.data?.progress || [];
      setServiceProgress((prev) => [...prev, `❌ ${apiMessage}`, ...apiProgress]);
      addToast(apiMessage, 'error');
    } finally {
      setServiceWorking(false)
    }
  }

  const renderServiceWizard = () => {
    if (!wizard || !serviceForm) return null

    const template = templates.find((t) => t.id === wizard.id || t.id === wizard.templateId)
    const tpl = template || wizard
    const isNodeTemplate = tpl?.id === 'node-app'
    const isNodeSitesMode =
      isNodeTemplate && serviceForm.nodeServiceMode === NODE_SERVICE_MODES.sites

    return (
      <div className="wizard-container rounded-2xl border border-blue-500/30 bg-blue-500/10 p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-blue-200">Wizard</p>
            <p className="text-lg font-semibold text-white">Criar serviço: {tpl?.label}</p>
            <p className="text-xs text-slate-300">Imagem: {tpl?.image}:{tpl?.tag}</p>
          </div>
          <button className="text-xs text-slate-200" onClick={() => setWizard(null)}>
            fechar
          </button>
        </div>

        <div className="mt-4 grid gap-4">
          <div className="grid gap-2">
            <label className="text-xs text-slate-300">Nome do serviço</label>
            <input
              className={`rounded-xl border px-3 py-2 text-sm text-white ${
                validateServiceName(serviceForm.name) 
                  ? 'border-rose-500 bg-rose-500/10' 
                  : 'border-slate-800 bg-slate-950'
              }`}
              value={serviceForm.name}
              onChange={(e) => {
                const newName = e.target.value;
                setServiceForm((p) => ({
                  ...p, 
                  name: newName,
                  volumes: p.volumes.map((v) => ({
                    ...v,
                    hostPath: v.hostPath && baseDir ? `${baseDir}/${newName}` : v.hostPath
                  }))
                }));
              }}
            />
            <p className="text-xs text-slate-400">
              Apenas letras, números, _ e - são permitidos. Sem acentos, espaços ou pontuação.
            </p>
            {validateServiceName(serviceForm.name) && (
              <p className="text-xs text-rose-300">
                {validateServiceName(serviceForm.name)}
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <label className="text-xs text-slate-300">Porta externa → interna</label>
            <div className="flex items-center gap-2">
              <input
                className="w-28 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
                placeholder="Auto"
                value={serviceForm.hostPort}
                onChange={(e) => setServiceForm((p) => ({ ...p, hostPort: e.target.value }))}
              />
              <span className="text-slate-300 text-sm">→ {serviceForm.containerPort || tpl?.containerPort || 80}</span>
              {serviceForm.hostPort && portAvailability != null && (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] ${
                    portAvailability
                      ? 'bg-emerald-500/10 text-emerald-200'
                      : 'bg-rose-500/10 text-rose-200'
                  }`}
                >
                  {portAvailability ? 'Porta livre' : 'Porta em uso'}
                </span>
              )}
              <button
                className="rounded-xl border border-blue-800 bg-blue-950 px-3 py-2 text-xs text-blue-200 hover:bg-blue-900"
                onClick={async () => {
                  try {
                    const response = await api.get('/docker/available-port', { 
                      params: { start: tpl?.defaultPort || 3000 } 
                    })
                    const available = response.data?.available
                    if (available) {
                      setServiceForm((p) => ({ ...p, hostPort: String(available) }))
                    }
                  } catch (err) {
                    addToast('Erro ao buscar porta', 'error')
                  }
                }}
              >
                Sugerir
              </button>
            </div>
            <p className="text-xs text-slate-400">
              {serviceForm.hostPort 
                ? `URL de teste: http://localhost:${serviceForm.hostPort}`
                : 'Deixe vazio para seleção automática de porta'
              }
            </p>
            {tpl?.id === 'custom-image' && (
              <div className="mt-2 flex items-center gap-2">
                <label className="text-xs text-slate-400">Porta interna do container</label>
                <input
                  type="number"
                  min="1"
                  max="65535"
                  className="w-28 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
                  value={serviceForm.containerPort}
                  onChange={(e) =>
                    setServiceForm((p) => ({ ...p, containerPort: Number(e.target.value || 0) || 80 }))
                  }
                />
              </div>
            )}
          </div>

          <div className="grid gap-2">
            <label className="text-xs text-slate-300">Exposição da porta</label>
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={serviceForm.bindLocalOnly}
                onChange={(e) => setServiceForm((p) => ({ ...p, bindLocalOnly: e.target.checked }))}
              />
              Expor apenas em localhost (recomendado)
            </label>
            <p className="text-xs text-slate-400">
              Quando ativo, a porta não fica acessível pelo IP público.
            </p>
          </div>

          <div className="grid gap-2">
            <label className="text-xs text-slate-300">Rede Docker</label>
            <select
              className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
              value={serviceForm.networkName}
              onChange={(e) => setServiceForm((p) => ({ ...p, networkName: e.target.value }))}
            >
              <option value="bridge">bridge (padrão - containers isolados)</option>
              <option value="host">host (compartilha rede do host)</option>
              {networks.filter(n => !['bridge', 'host', 'none'].includes(n.name)).map(network => (
                <option key={network.id} value={network.name}>
                  {network.name} (rede customizada)
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-400">
              📌 Serviços na mesma rede podem se comunicar diretamente pelo nome do container
            </p>
          </div>

          {isNodeTemplate && (
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
              <p className="text-sm font-semibold text-cyan-200">Modo do serviço Node.js</p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className={`rounded-xl border p-3 text-sm ${serviceForm.nodeServiceMode === NODE_SERVICE_MODES.service ? 'border-cyan-400 bg-cyan-500/10 text-white' : 'border-slate-800 bg-slate-950 text-slate-300'}`}>
                  <input
                    type="radio"
                    className="mr-2"
                    name="node-service-mode"
                    checked={serviceForm.nodeServiceMode === NODE_SERVICE_MODES.service}
                    onChange={() =>
                      setServiceForm((p) => ({
                        ...p,
                        nodeServiceMode: NODE_SERVICE_MODES.service
                      }))
                    }
                  />
                  Serviço
                  <span className="mt-1 block text-xs text-slate-400">
                    Configuração atual sem alterações. Usa o comando informado ou detectado pelo projeto.
                  </span>
                </label>
                <label className={`rounded-xl border p-3 text-sm ${serviceForm.nodeServiceMode === NODE_SERVICE_MODES.sites ? 'border-cyan-400 bg-cyan-500/10 text-white' : 'border-slate-800 bg-slate-950 text-slate-300'}`}>
                  <input
                    type="radio"
                    className="mr-2"
                    name="node-service-mode"
                    checked={serviceForm.nodeServiceMode === NODE_SERVICE_MODES.sites}
                    onChange={() =>
                      setServiceForm((p) => ({
                        ...p,
                        nodeServiceMode: NODE_SERVICE_MODES.sites,
                        createProject: false
                      }))
                    }
                  />
                  Sites
                  <span className="mt-1 block text-xs text-slate-400">
                    Gera um serviço Node para publicar sites estáticos usando a raiz <code>/</code>.
                  </span>
                </label>
              </div>

              {isNodeSitesMode && (
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="grid gap-2">
                    <label className="text-xs text-slate-300">Tipo de site</label>
                    <select
                      className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
                      value={serviceForm.nodeSiteConfig?.siteType || NODE_SITE_TYPES.common}
                      onChange={(e) =>
                        setServiceForm((p) => ({
                          ...p,
                          nodeSiteConfig: {
                            ...p.nodeSiteConfig,
                            siteType: e.target.value
                          }
                        }))
                      }
                    >
                      <option value={NODE_SITE_TYPES.common}>Site Comum</option>
                      <option value={NODE_SITE_TYPES.spa}>Angular/React/Vue</option>
                    </select>
                    <p className="text-xs text-slate-400">
                      Use Angular/React/Vue para habilitar fallback de SPA para rotas internas.
                    </p>
                  </div>

                  <div className="grid gap-2">
                    <label className="text-xs text-slate-300">Pasta do site</label>
                    <select
                      className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
                      value={serviceForm.nodeSiteConfig?.siteFolder || NODE_SITE_FOLDERS[0]}
                      onChange={(e) =>
                        setServiceForm((p) => ({
                          ...p,
                          nodeSiteConfig: {
                            ...p.nodeSiteConfig,
                            siteFolder: e.target.value
                          }
                        }))
                      }
                    >
                      {NODE_SITE_FOLDERS.map((folder) => (
                        <option key={folder} value={folder}>
                          {folder}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-slate-400">
                      O painel cria essa pasta no volume e publica o site dentro dela.
                    </p>
                  </div>

                  <div className="grid gap-2">
                    <label className="text-xs text-slate-300">Arquivo padrão / fallback</label>
                    <input
                      className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
                      placeholder="index.html"
                      value={serviceForm.nodeSiteConfig?.fallbackFile || 'index.html'}
                      onChange={(e) =>
                        setServiceForm((p) => ({
                          ...p,
                          nodeSiteConfig: {
                            ...p.nodeSiteConfig,
                            fallbackFile: e.target.value
                          }
                        }))
                      }
                    />
                    <p className="text-xs text-slate-400">
                      Exemplo: <code>index.html</code>, <code>index.htm</code> ou outro arquivo estático. PHP não é executado nesse modo.
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs text-slate-300">
                    <p className="font-semibold text-slate-200">Fluxo automático</p>
                    <p className="mt-1">Ao criar ou atualizar, o serviço gera a estrutura base, grava o arquivo <code>.env</code>, roda <code>npm install</code> e inicia com <code>npm start</code>.</p>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <label className="text-xs text-slate-300">Volumes (opcional)</label>
              <button
                className="text-xs text-blue-300 underline"
                onClick={() => setServiceForm((p) => ({
                  ...p,
                  volumes: [...p.volumes, { hostPath: '', containerPath: '' }]
                }))}
              >
                + Adicionar volume
              </button>
            </div>
            {serviceForm.volumes.length === 0 && (
              <p className="text-xs text-slate-400">Nenhum volume configurado. Container usará apenas armazenamento efêmero.</p>
            )}
            {(serviceForm.volumes || []).map((vol, idx) => (
              <div key={idx} className="flex flex-wrap gap-2">
                <input
                  className="flex-1 min-w-[240px] rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
                  placeholder="/Users/seunome/projeto (macOS)"
                  value={vol.hostPath}
                  onChange={(e) => {
                    const next = [...serviceForm.volumes]
                    next[idx].hostPath = e.target.value
                    setServiceForm((p) => ({ ...p, volumes: next }))
                  }}
                />
                <input
                  className="flex-1 min-w-[220px] rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
                  placeholder="/caminho/container"
                  value={vol.containerPath}
                  onChange={(e) => {
                    const next = [...serviceForm.volumes]
                    next[idx].containerPath = e.target.value
                    setServiceForm((p) => ({ ...p, volumes: next }))
                  }}
                />
                <button
                  className="rounded-xl border border-rose-800 bg-rose-950 px-3 py-2 text-xs text-rose-200 hover:bg-rose-900"
                  onClick={() => {
                    const next = serviceForm.volumes.filter((_, i) => i !== idx)
                    setServiceForm((p) => ({ ...p, volumes: next }))
                  }}
                >
                  Remover
                </button>
              </div>
            ))}
            {serviceForm.volumes.length > 0 && (
              <p className="text-[11px] text-amber-300">⚠️ macOS: Use caminhos dentro de /Users. Configure em Docker → Preferences → Resources → File Sharing</p>
            )}
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <label className="text-xs text-slate-300">Variáveis de ambiente</label>
              <button
                className="text-xs text-blue-300 underline"
                onClick={() => setServiceForm((p) => ({
                  ...p,
                  envs: [...p.envs, { key: '', value: '', secret: false }]
                }))}
              >
                + Adicionar variável
              </button>
            </div>
            {(serviceForm.envs || []).map((env, idx) => (
              <div key={idx} className="flex flex-wrap gap-2">
                <input
                  className="w-40 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
                  placeholder="KEY"
                  value={env.key}
                  onChange={(e) => {
                    const next = [...serviceForm.envs]
                    next[idx].key = e.target.value
                    setServiceForm((p) => ({ ...p, envs: next }))
                  }}
                />
                <input
                  className="flex-1 min-w-[200px] rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
                  placeholder="value"
                  type={env.secret ? 'password' : 'text'}
                  value={env.value}
                  onChange={(e) => {
                    const next = [...serviceForm.envs]
                    next[idx].value = e.target.value
                    setServiceForm((p) => ({ ...p, envs: next }))
                  }}
                />
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    className="rounded border-slate-700 bg-slate-900 text-blue-400"
                    checked={!!env.secret}
                    onChange={(e) => {
                      const next = [...serviceForm.envs]
                      const nextSecret = e.target.checked
                      next[idx].secret = nextSecret
                      if (!nextSecret && next[idx].value === '******') {
                        next[idx].value = ''
                      }
                      setServiceForm((p) => ({ ...p, envs: next }))
                    }}
                  />
                  Secreto
                </label>
                <button
                  className="rounded-xl border border-rose-800 bg-rose-950 px-3 py-2 text-xs text-rose-200 hover:bg-rose-900"
                  onClick={() => {
                    const next = serviceForm.envs.filter((_, i) => i !== idx)
                    setServiceForm((p) => ({ ...p, envs: next }))
                  }}
                >
                  Remover
                </button>
              </div>
            ))}
          </div>

          <div className="grid gap-2">
            <label className="text-xs text-slate-300">Importar arquivo .env</label>
            <input
              type="file"
              className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-500 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-950"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                if (!file) return
                setEnvImportStatus({ status: 'loading', message: 'Lendo arquivo...' })
                const parsed = await parseEnvFile(file)
                const currentEnvs = serviceForm?.envs || []
                const { merged, overwrites } = buildEnvMerge(currentEnvs, parsed)
                if (overwrites.length) {
                  setEnvImportDialog({ target: 'create', merged, overwrites })
                  setEnvImportStatus({ status: 'waiting', message: 'Aguardando confirmacao de sobrescrita.' })
                } else {
                  setServiceForm((p) => ({ ...p, envs: merged }))
                  setEnvImportStatus({ status: 'done', message: 'Variaveis importadas com sucesso.' })
                }
                e.target.value = ''
              }}
            />
            {envImportStatus && (
              <div className="flex items-center gap-2 text-xs text-slate-300">
                {envImportStatus.status === 'loading' && (
                  <span className="inline-flex h-3 w-3 animate-spin rounded-full border-2 border-slate-500 border-t-blue-400" />
                )}
                <span>{envImportStatus.message}</span>
              </div>
            )}
            <p className="text-xs text-slate-400">
              As chaves do arquivo substituem as existentes com o mesmo nome.
            </p>
          </div>

          {!isNodeSitesMode && (
            <div className="grid gap-2">
              <label className="text-xs text-slate-300">Comando de inicializacao</label>
              <input
                className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
                placeholder="npm install && npm run start"
                value={serviceForm.command}
                onChange={(e) => setServiceForm((p) => ({ ...p, command: e.target.value }))}
              />
              <p className="text-xs text-slate-400">
                Deixe vazio para detectar package.json, entrypoint.sh/start.sh ou .jar enviado.
              </p>
            </div>
          )}

          <div className="grid gap-2">
            <label className="text-xs text-slate-300">Projeto ou JAR (zip/tar/jar)</label>
            <input
              type="file"
              accept=".jar,.zip,.tar,.tar.gz,.tgz"
              className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-500 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-950"
              onChange={(e) => {
                const file = e.target.files?.[0] || null
                setServiceForm((p) => ({ ...p, projectArchive: file }))
              }}
            />
            <p className="text-xs text-slate-400">
              {isNodeSitesMode
                ? `Envie os arquivos do site para a pasta ${serviceForm.nodeSiteConfig?.siteFolder || NODE_SITE_FOLDERS[0]} apos a criacao.`
                : 'Envie um .jar ou .zip/.tar para publicar no volume do servico apos a criacao.'}
            </p>
          </div>

          <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <label className="text-sm font-semibold text-blue-200">
                  {isNodeSitesMode
                    ? '🌐 Publicação de sites'
                    : tpl?.hasProjectOption !== false
                      ? '🚀 Criar projeto exemplo'
                      : '🔧 Opções adicionais'}
                </label>
                <p className="text-xs text-blue-300/80 mt-1">
                  {isNodeSitesMode
                    ? 'A estrutura base do serviço é criada automaticamente.'
                    : tpl?.hasProjectOption !== false 
                    ? 'Inclui código inicial pronto para usar'
                    : tpl?.managerLabel || 'Opções especiais para este serviço'
                  }
                </p>
              </div>
              {!isNodeSitesMode && tpl?.hasProjectOption !== false && (
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={serviceForm.createProject || false}
                    onChange={(e) => setServiceForm((p) => ({ ...p, createProject: e.target.checked }))}
                  />
                  <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
                </label>
              )}
            </div>
            
            {!isNodeSitesMode && tpl?.hasProjectOption !== false && (
              <div className={`text-xs transition-colors mb-3 ${
                serviceForm.createProject 
                  ? 'text-emerald-300'
                  : 'text-slate-400'
              }`}>
                {serviceForm.createProject 
                  ? '✅ Será criado um projeto exemplo com código inicial, dependências e documentação'
                  : '📦 Apenas o container será criado, sem arquivos de exemplo'
                }
              </div>
            )}
            {isNodeSitesMode && (
              <div className="mb-3 text-xs text-emerald-300">
                ✅ O painel cria a estrutura Node automaticamente e publica o site na pasta escolhida.
              </div>
            )}
            
            {tpl?.hasManagerOption && (
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-semibold text-emerald-200">
                    {tpl.managerLabel || 'Instalar gerenciador'}
                  </label>
                  <p className="text-xs text-emerald-300/80 mt-1">
                    Interface web para gerenciar o banco de dados
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={serviceForm.createManager || false}
                    onChange={(e) => setServiceForm((p) => ({ ...p, createManager: e.target.checked }))}
                  />
                  <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                </label>
              </div>
            )}
            
            {tpl?.hasDbConfigOption && postgresDatabases.length > 0 && (
              <div className="mb-3">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <label className="text-sm font-semibold text-purple-200">
                      {tpl.dbConfigLabel || 'Configurar para banco existente'}
                    </label>
                    <p className="text-xs text-purple-300/80 mt-1">
                      Conectar automaticamente a um banco PostgreSQL
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={!!serviceForm.configureDb}
                      onChange={(e) => setServiceForm((p) => ({ 
                        ...p, 
                        configureDb: e.target.checked ? (postgresDatabases[0]?.id || null) : null 
                      }))}
                    />
                    <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-500"></div>
                  </label>
                </div>
                
                {serviceForm.configureDb && (
                  <div className="space-y-2">
                    <select
                      className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                      value={serviceForm.configureDb || ''}
                      onChange={(e) => setServiceForm((p) => ({ ...p, configureDb: e.target.value }))}
                    >
                      {postgresDatabases.map(db => (
                        <option key={db.id} value={db.id}>
                          {db.name} (porta {db.hostPort})
                        </option>
                      ))}
                    </select>
                    <div className="p-3 rounded-lg border border-purple-500/30 bg-purple-500/10">
                      <p className="text-xs text-purple-300 flex items-center gap-2">
                        <span>✅</span>
                        pgAdmin será configurado automaticamente para este banco
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
            
            {tpl?.hasDbConfigOption && postgresDatabases.length === 0 && (
              <div className="mb-3 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10">
                <p className="text-xs text-amber-300 flex items-center gap-2">
                  <span>⚠️</span>
                  Nenhum banco PostgreSQL encontrado. Crie um primeiro.
                </p>
              </div>
            )}
            
            {tpl?.hasManagerOption && (
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-semibold text-emerald-200">
                    {tpl.managerLabel || 'Instalar gerenciador'}
                  </label>
                  <p className="text-xs text-emerald-300/80 mt-1">
                    Interface web para gerenciar o banco de dados
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={serviceForm.createManager || false}
                    onChange={(e) => setServiceForm((p) => ({ ...p, createManager: e.target.checked }))}
                  />
                  <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                </label>
              </div>
            )}
            
            {serviceForm.createManager && tpl?.hasManagerOption && (
              <div className="mt-3 p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10">
                <p className="text-xs text-emerald-300 flex items-center gap-2">
                  <span>✅</span>
                  Será criado pgAdmin na porta 8080 (ou próxima disponível)
                </p>
                <p className="text-xs text-emerald-400 mt-1">
                  Login: admin@admin.com | Senha: admin
                </p>
              </div>
            )}
            
            {!isNodeSitesMode && (serviceForm.createProject || serviceForm.projectArchive) && serviceForm.volumes.length === 0 && (
              <div className="mt-3 p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10">
                <p className="text-xs text-emerald-300 flex items-center gap-2">
                  <span>✅</span>
                  Um volume local será criado automaticamente em {baseDir ? `${baseDir}/${serviceForm.name}` : 'backend/data/projects/docker'}.
                </p>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${
                serviceWorking || validateServiceName(serviceForm.name)
                  ? 'bg-slate-600 text-slate-400 cursor-not-allowed'
                  : 'bg-blue-500 text-slate-950 hover:bg-blue-400'
              }`}
              onClick={() => tpl && !serviceWorking && !validateServiceName(serviceForm.name) && createService(tpl, serviceForm)}
              disabled={serviceWorking || validateServiceName(serviceForm.name)}
            >
              {serviceWorking ? 'Criando...' : 'Criar serviço'}
            </button>
            <button
              className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-xs text-slate-200"
              onClick={() => setWizard(null)}
            >
              Cancelar
            </button>
          </div>

          {serviceProgress.length > 0 && (
            <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-xs text-slate-200">
              <div className="flex items-center justify-between pb-2">
                <span className="font-semibold text-slate-100">Progresso / Logs ({serviceProgress.length} linhas)</span>
                <button
                  className="text-[11px] text-blue-300 underline"
                  onClick={() => navigator.clipboard.writeText(serviceProgress.join('\n'))}
                >
                  Copiar tudo
                </button>
              </div>
              <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap text-[11px] leading-5">{serviceProgress.slice(-50).join('\n')}</pre>
              {serviceProgress.length > 50 && (
                <p className="pt-2 text-[10px] text-slate-400">Mostrando últimas 50 linhas de {serviceProgress.length}</p>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  const serviceUpdateInProgress = ['saving', 'applying'].includes(serviceUpdateStatus?.status)
  const projectUploadInProgress = ['uploading', 'processing'].includes(projectUploadStatus?.status)
  const editOperationInProgress = serviceUpdateInProgress || projectUploadInProgress

  return (
    <div className="zeus-docker-page space-y-6">
      <div className="rounded-[28px] border border-slate-800 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.22),_rgba(15,23,42,0.92)_58%)] p-5 sm:p-6">
        <div className={`flex flex-wrap gap-4 ${showPageIntro ? 'items-start justify-between' : 'items-center justify-end'}`}>
          {showPageIntro ? (
            <div className="max-w-2xl">
              <p className="text-[11px] uppercase tracking-[0.34em] text-blue-200/80">Container Service</p>
              <h2 className="mt-2 text-3xl font-semibold text-white sm:text-4xl">Cloud Runtime Control</h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Catálogo, deploy e lifecycle management com a simplicidade de SaaS moderna e clareza de operação.
              </p>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="rounded-xl border border-slate-700 bg-slate-950/70 px-4 py-2 text-sm text-slate-200 transition hover:border-blue-500/40 hover:text-white"
              onClick={async () => {
                await Promise.all([loadContainers(), loadServices(), loadStacks(), loadImages(), loadNetworks()])
              }}
            >
              Sync status
            </button>
            <button
              className="flex items-center gap-2 rounded-xl bg-blue-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-blue-400"
              onClick={() => quickInstallTemplate && setWizard(quickInstallTemplate)}
            >
              <Plus className="h-4 w-4" />
              New Instance
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <DockerMetricCard icon={AppWindow} label="Apps disponíveis" value={templates.length} hint="Catálogo pronto para deploy" tone="brand" />
          <DockerMetricCard icon={Boxes} label="Stacks ativas" value={totalRunningStacks} hint={`${stackClusters.length} grupos detectados`} tone="success" />
          <DockerMetricCard icon={TerminalSquare} label="Serviços independentes" value={independentServices.length} hint={`${totalRunningInstances} instâncias running`} tone="warning" />
          <DockerMetricCard icon={AlertTriangle} label="Alerts" value={totalErrorInstances} hint={`${totalStartingInstances} iniciando agora`} tone="danger" />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          { id: 'dashboard', label: 'Dashboard', icon: Activity },
          { id: 'apps', label: 'Apps', icon: AppWindow },
          { id: 'containers', label: 'Containers', icon: TerminalSquare },
          { id: 'images', label: 'Images', icon: Layers }
        ].map((tab) => (
          <DockerViewTab
            key={tab.id}
            active={activeTab === tab.id}
            icon={tab.icon}
            label={tab.label}
            onClick={() => setActiveTab(tab.id)}
          />
        ))}
      </div>

      {activeTab === 'dashboard' && (
        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Stack clusters</p>
                <h3 className="mt-1 text-xl font-semibold text-white">Compose topology overview</h3>
              </div>
              <span className="rounded-full border border-slate-700 bg-slate-950/70 px-2.5 py-1 text-[11px] text-slate-300">
                {visibleStackClusters.length} grupo(s)
              </span>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              {visibleStackClusters.map((stack) => (
                <StackClusterCard
                  key={stack.id}
                  stack={stack}
                  expanded={expandedClusterId === stack.id}
                  telemetry={buildClusterTelemetry(stack, stats)}
                  onToggle={() => toggleClusterExpand(stack)}
                  onInspectService={inspectClusterService}
                  onOpen={() => navigate('/stacks')}
                />
              ))}
              {visibleStackClusters.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/40 px-4 py-10 text-center text-sm text-slate-400">
                  Nenhuma stack publicada ainda. Quando o compose for gerado, ela aparecerá aqui como cluster operacional.
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Serviços independentes</p>
                  <h3 className="mt-1 text-xl font-semibold text-white">Outside clusters</h3>
                </div>
                <span className="rounded-full border border-slate-700 bg-slate-950/70 px-2.5 py-1 text-[11px] text-slate-300">
                  {independentServices.length} item(s)
                </span>
              </div>

              <div className="space-y-2">
                {independentServices.slice(0, 6).map((service) => (
                  <div key={service.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-3">
                    <div>
                      <p className="text-sm font-semibold text-white">{service.name}</p>
                      <p className="text-xs text-slate-400">{service.hostPort || 'auto'} → {service.containerPort || '—'} • {service.networkName || 'bridge'}</p>
                    </div>
                    <DockerStatusBadge state={service.runtimeState} />
                  </div>
                ))}
                {independentServices.length === 0 && (
                  <p className="text-sm text-slate-400">Todos os serviços visíveis pertencem a stacks no momento.</p>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Quick install</p>
                  <h3 className="mt-1 text-xl font-semibold text-white">Apps em destaque</h3>
                </div>
              </div>
              <div className="grid gap-3">
                {filteredTemplates.slice(0, 3).map((tpl) => (
                  <DockerCatalogCard
                    key={tpl.id}
                    tpl={tpl}
                    installedCount={services.filter((service) => service.templateId === tpl.id).length}
                    onInstall={() => setWizard(tpl)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'apps' && (
        <div className="grid gap-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Apps Catalog</p>
                <h3 className="mt-1 text-xl font-semibold text-white">Install new services</h3>
              </div>
              <div className="min-w-[240px] flex-1 max-w-md">
                <input
                  className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-sm text-white placeholder:text-slate-500"
                  placeholder="Buscar app, imagem ou descrição"
                  value={appSearch}
                  onChange={(event) => setAppSearch(event.target.value)}
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {appCategories.map((categoryId) => (
                <button
                  key={categoryId}
                  onClick={() => setAppCategory(categoryId)}
                  className={`rounded-full border px-3 py-1.5 text-xs transition ${
                    appCategory === categoryId
                      ? 'border-blue-500/70 bg-blue-500/20 text-blue-100 shadow-[0_0_0_1px_rgba(59,130,246,0.2)]'
                      : 'border-slate-700 bg-slate-900/70 text-slate-300 hover:border-blue-500/40 hover:text-white'
                  }`}
                >
                  {APP_CATEGORY_LABELS[categoryId] || categoryId} ({appCategoryCounts[categoryId] || 0})
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredTemplates.map((tpl) => (
              <DockerCatalogCard
                key={tpl.id}
                tpl={tpl}
                installedCount={services.filter((service) => service.templateId === tpl.id).length}
                onInstall={() => setWizard(tpl)}
              />
            ))}
            {filteredTemplates.length === 0 && (
              <p className="text-sm text-slate-400">Nenhum app encontrado com os filtros atuais.</p>
            )}
          </div>
        </div>
      )}

      {activeTab === 'containers' && (
        <div className="grid gap-4">
          {visibleStackClusters.length > 0 && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Running stack groups</p>
                  <h3 className="mt-1 text-xl font-semibold text-white">Cluster-style compose view</h3>
                </div>
                <button
                  className="rounded-lg border border-blue-800 bg-blue-950 px-3 py-1.5 text-xs text-blue-200 hover:bg-blue-900"
                  onClick={() => navigate('/stacks')}
                >
                  Abrir Infra Canvas
                </button>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {visibleStackClusters.map((stack) => (
                  <StackClusterCard
                    key={stack.id}
                    stack={stack}
                    expanded={expandedClusterId === stack.id}
                    telemetry={buildClusterTelemetry(stack, stats)}
                    onToggle={() => toggleClusterExpand(stack)}
                    onInspectService={inspectClusterService}
                    onOpen={() => navigate('/stacks')}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Independent services</p>
                <h3 className="mt-1 text-xl font-semibold text-white">Operational console</h3>
              </div>
              <div className="min-w-[240px] flex-1 max-w-md">
                <input
                  className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-sm text-white placeholder:text-slate-500"
                  placeholder="Buscar instância, imagem, rede ou porta"
                  value={opsSearch}
                  onChange={(event) => setOpsSearch(event.target.value)}
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-200">
                <thead className="bg-slate-950 text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Port mapping</th>
                    <th className="px-4 py-3">Network</th>
                    <th className="px-4 py-3">Scope</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredIndependentServices.map((instance) => {
                    const container = containerLookup.get(instance.containerId) || containerLookup.get(instance.name)
                    const isRunning = instance.stateMeta.key === 'running'
                    return (
                      <tr
                        key={instance.id}
                        className="border-t border-slate-800 hover:bg-slate-900/40"
                        onClick={() => container && openLogs(container)}
                      >
                        <td className="px-4 py-3">
                          <div>
                            <p className="font-semibold text-white">{instance.name}</p>
                            <p className="text-xs text-slate-400">{instance.image || 'custom-image'}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <DockerStatusBadge state={instance.runtimeState} />
                        </td>
                        <td className="px-4 py-3 text-slate-300">{instance.hostPort || 'auto'} → {instance.containerPort || '—'}</td>
                        <td className="px-4 py-3 text-slate-300">{instance.networkName || 'bridge'}</td>
                        <td className="px-4 py-3">
                          <span className="rounded-full border border-slate-700 bg-slate-950/70 px-2.5 py-1 text-[11px] text-slate-300">
                            Independent
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <button
                              className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                                isRunning
                                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20'
                                  : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20'
                              }`}
                              onClick={(event) => {
                                event.stopPropagation()
                                if (instance.containerId) {
                                  handleAction(isRunning ? 'stop' : 'start', instance.containerId)
                                }
                              }}
                            >
                              {isRunning ? 'Stop' : 'Start'}
                            </button>
                            <button
                              className="rounded-lg border border-blue-800 bg-blue-950 px-3 py-1.5 text-xs text-blue-200 hover:bg-blue-900"
                              onClick={(event) => {
                                event.stopPropagation()
                                openEditServiceDialog(instance)
                              }}
                            >
                              Edit
                            </button>
                            <button
                              className="rounded-lg border border-rose-800 bg-rose-950 px-3 py-1.5 text-xs text-rose-200 hover:bg-rose-900"
                              onClick={(event) => {
                                event.stopPropagation()
                                setRemoveDialog(instance)
                              }}
                            >
                              Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {filteredIndependentServices.length === 0 && (
                    <tr>
                      <td className="px-4 py-8 text-slate-500" colSpan={6}>
                        {loading ? 'Carregando serviços...' : 'Nenhum serviço independente encontrado'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {selectedContainer && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Logs</p>
                  <p className="text-lg font-semibold text-white">
                    {selectedContainer.Names?.[0]?.replace('/', '') || selectedContainer.Id}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-1 text-xs text-slate-200"
                    onClick={() => navigator.clipboard.writeText(logs || '')}
                  >
                    Copiar
                  </button>
                  <button
                    className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-1 text-xs text-slate-200"
                    onClick={() => setLogsExpanded(true)}
                  >
                    Expandir
                  </button>
                  <button
                    className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-1 text-xs text-slate-200"
                    onClick={() => setLogs('')}
                  >
                    Limpar
                  </button>
                </div>
              </div>
              <div className="h-64 overflow-y-auto rounded-xl border border-emerald-900/50 bg-gradient-to-b from-black via-black/95 to-slate-950 p-4 text-xs text-emerald-200">
                <pre className="font-mono whitespace-pre-wrap">{logs || 'Clique em uma instância para inspecionar logs.'}</pre>
              </div>
            </div>
          )}
        </div>
      )}

      {logsExpanded && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-5xl rounded-2xl border border-slate-800 bg-slate-900/95 p-6 text-slate-100">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Logs</p>
                <p className="text-lg font-semibold text-white">
                  {selectedContainer?.Names?.[0]?.replace('/', '') || selectedContainer?.Id || 'Container'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-1 text-xs text-slate-200"
                  onClick={() => navigator.clipboard.writeText(logs || '')}
                >
                  Copiar
                </button>
                <button
                  className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-1 text-xs text-slate-200"
                  onClick={() => setLogsExpanded(false)}
                >
                  Fechar
                </button>
              </div>
            </div>
            <div className="h-[70vh] overflow-y-auto rounded-xl border border-emerald-900/50 bg-gradient-to-b from-black via-black/95 to-slate-950 p-4 text-xs text-emerald-200">
              <pre className="font-mono whitespace-pre-wrap">{logs || 'Aguardando logs...'}</pre>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'images' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Adicionar imagem</p>
                <p className="text-xs text-slate-400 mt-1">
                  Use o nome completo da imagem (ex: registry.meu.com/app:tag)
                </p>
              </div>
              <button
                className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800"
                onClick={() => setRegistryAdvanced((prev) => !prev)}
              >
                {registryAdvanced ? 'Ocultar avancado' : 'Configuracao avancada'}
              </button>
            </div>
            <div className="mt-4 flex flex-col gap-3 lg:flex-row">
              <input
                className="flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
                placeholder="ex: nginx:latest"
                value={customImageName}
                onChange={(e) => setCustomImageName(e.target.value)}
              />
              <button
                className="rounded-xl bg-blue-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-blue-400 disabled:opacity-50"
                onClick={pullCustomImage}
                disabled={pullWorking}
              >
                {pullWorking ? 'Baixando...' : 'Baixar imagem'}
              </button>
            </div>
            {registryAdvanced && (
              <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs text-slate-400">Repositorio autenticado</p>
                    <p className="text-xs text-slate-500">Selecione um repositorio salvo (opcional).</p>
                  </div>
                  <button
                    className="rounded-xl bg-blue-500 px-3 py-1 text-xs font-semibold text-slate-950"
                    onClick={() => setRegistryDialog({})}
                  >
                    Novo repositorio
                  </button>
                </div>
                <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-center">
                  <select
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white lg:flex-1"
                    value={selectedRegistry}
                    onChange={(e) => setSelectedRegistry(e.target.value)}
                  >
                    <option value="">Docker Hub (sem autenticacao)</option>
                    {registries.map((reg) => (
                      <option key={reg.id} value={reg.id}>
                        {reg.name} • {reg.serverAddress}
                      </option>
                    ))}
                  </select>
                </div>
                {registries.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {registries.map((reg) => (
                      <div key={reg.id} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300">
                        <div>
                          <p className="text-sm text-white">{reg.name}</p>
                          <p className="text-xs text-slate-500">{reg.serverAddress}</p>
                        </div>
                        <button
                          className="rounded-lg border border-rose-800 px-2 py-1 text-xs text-rose-200 hover:bg-rose-900"
                          onClick={() => removeRegistry(reg.id)}
                        >
                          Remover
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400 mb-3">Imagens Docker</p>
            <div className="space-y-2">
              {images.map((img) => {
                const tag = img.RepoTags?.[0] || 'none'
                const size = img.Size ? `${(img.Size / 1024 / 1024).toFixed(0)} MB` : 'N/A'
                return (
                  <div key={img.Id} className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">{tag}</p>
                      <p className="text-xs text-slate-400">ID: {img.Id.slice(7, 19)} • Tamanho: {size}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        className="rounded-xl border border-emerald-800 bg-emerald-950 px-3 py-2 text-xs text-emerald-200 hover:bg-emerald-900"
                        onClick={() =>
                          setWizard({
                            id: 'custom-image',
                            label: tag.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase(),
                            image: tag.split(':')[0] || tag,
                            tag: tag.includes(':') ? tag.split(':').slice(1).join(':') : 'latest',
                            fullImageName: tag,
                            containerPort: guessContainerPort(tag),
                            defaultPort: guessContainerPort(tag),
                            volumes: [],
                            env: [],
                            hasProjectOption: false,
                            hasManagerOption: false
                          })
                        }
                      >
                        Usar
                      </button>
                      <button
                        className="rounded-xl border border-blue-800 bg-blue-950 px-3 py-2 text-xs text-blue-200 hover:bg-blue-900"
                        onClick={() => updateImage(img.Id)}
                      >
                        Atualizar
                      </button>
                      <button
                        className="rounded-xl border border-amber-800 bg-amber-950 px-3 py-2 text-xs text-amber-200 hover:bg-amber-900"
                        onClick={() => prepareImageRebuild(tag, img.Id)}
                      >
                        Editar Dockerfile
                      </button>
                      <button
                        className="rounded-xl border border-rose-800 bg-rose-950 px-3 py-2 text-xs text-rose-200 hover:bg-rose-900"
                        onClick={() => removeImage(img.Id)}
                      >
                        Remover
                      </button>
                    </div>
                  </div>
                )
              })}
              {images.length === 0 && (
                <p className="text-sm text-slate-400">Nenhuma imagem encontrada</p>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400 mb-3">Build de Dockerfile</p>
            <div className="space-y-3">
              <input
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
                placeholder="Nome da imagem (ex: sockets-one:latest)"
                value={buildImageName}
                onChange={(e) => {
                  setBuildImageName(e.target.value)
                  if (buildReplaceImage && e.target.value.trim() !== buildReplaceImage.tag) {
                    setBuildReplaceImage(null)
                  }
                }}
              />
              <textarea
                className="h-56 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200"
                placeholder="Cole seu Dockerfile aqui"
                value={buildDockerfile}
                onChange={(e) => setBuildDockerfile(e.target.value)}
              />
              {buildReplaceImage?.tag === buildImageName.trim() && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  Esta ação rebuilda a tag existente e tenta remover a imagem anterior após o build.
                </div>
              )}
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <label className="text-xs text-slate-300">Contexto do build (zip/tar opcional)</label>
                  <input
                    type="file"
                    accept=".zip,.tar,.tar.gz,.tgz"
                    className="mt-1 block rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-500 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-950"
                    onChange={(e) => setBuildContextArchive(e.target.files?.[0] || null)}
                  />
                </div>
                <button
                  className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
                  onClick={buildCustomImage}
                  disabled={buildWorking}
                >
                  {buildWorking
                    ? 'Construindo...'
                    : buildReplaceImage?.tag === buildImageName.trim()
                      ? 'Rebuildar imagem'
                      : 'Construir imagem'}
                </button>
              </div>
              {buildStatus && (
                <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-xs text-slate-200">
                  <div className="flex items-center justify-between gap-3">
                    <span>{buildStatus.message || 'Aguardando build'}</span>
                    <span className="font-mono text-slate-400">{buildStatus.progress || 0}%</span>
                  </div>
                  <div className="mt-2 h-2 w-full rounded-full bg-slate-800">
                    <div
                      className={`h-2 rounded-full transition-all ${
                        buildStatus.status === 'error' ? 'bg-rose-500' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${buildStatus.progress || 0}%` }}
                    />
                  </div>
                  {buildStatus.logs?.length > 0 && (
                    <pre className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-black/40 p-3 font-mono text-[11px] leading-5 text-emerald-200">
                      {buildStatus.logs.slice(-80).join('\n')}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400 mb-3">Imagens Populares</p>
            <div className="grid gap-4 lg:grid-cols-2">
              {presetImages.map((image) => (
                <div
                  key={image.name}
                  className="rounded-xl border border-slate-800 bg-slate-950/60 p-4"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-lg font-semibold text-white">{image.name}</p>
                      <p className="text-xs text-slate-400">{image.description}</p>
                    </div>
                    <span className="rounded-full border border-slate-800 bg-slate-950 px-3 py-1 text-xs text-blue-200">
                      {image.image}:{image.tag}
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 transition hover:border-blue-500/60"
                      onClick={() => pullImage(`${image.image}:${image.tag}`)}
                    >
                      Baixar
                    </button>
                    <button
                      className="rounded-xl bg-blue-500 px-3 py-2 text-xs font-semibold text-slate-950 transition hover:bg-blue-400"
                      onClick={() => setWizard(image)}
                    >
                      Rodar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {renderServiceWizard()}

      {editDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-2xl w-full mx-4 max-h-[85vh] flex flex-col">
            <h3 className="text-lg font-semibold text-white mb-4">⚙️ Editar Serviço</h3>
            <div className="space-y-4 overflow-y-auto pr-1 flex-1">
              <div>
                <label className="block text-sm text-slate-300 mb-2">Porta Externa</label>
                <input
                  type="number"
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                  value={editDialog.newHostPort ?? editDialog.hostPort ?? ''}
                  onChange={(e) => setEditDialog(prev => ({ ...prev, newHostPort: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-2">Rede Docker</label>
                <select
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                  value={editDialog.newNetworkName || editDialog.networkName || 'provirpanel'}
                  onChange={(e) => setEditDialog(prev => ({ ...prev, newNetworkName: e.target.value }))}
                >
                  <option value="bridge">bridge (padrão - isolado)</option>
                  <option value="provirpanel">provirpanel (recomendada)</option>
                  <option value="host">host (compartilha rede do host)</option>
                  {networks.filter(n => !['bridge', 'host', 'none'].includes(n.name)).map(network => (
                    <option key={network.id} value={network.name}>
                      {network.name} (customizada)
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-400 mt-1">
                  📌 Serviços na mesma rede podem se comunicar pelo nome
                </p>
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-2">Exposição da porta</label>
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={editDialog.newBindLocalOnly ?? editDialog.bindLocalOnly ?? false}
                    onChange={(e) => setEditDialog(prev => ({ ...prev, newBindLocalOnly: e.target.checked }))}
                  />
                  Expor apenas em localhost
                </label>
                <p className="text-xs text-slate-400 mt-1">
                  Quando ativo, a porta não fica acessível pelo IP público.
                </p>
              </div>
              {editDialog.volumes?.length > 0 && (
                <div>
                  <label className="block text-sm text-slate-300 mb-2">Volume do projeto</label>
                  <div className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200">
                    {editDialog.volumes[0].hostPath} → {editDialog.volumes[0].containerPath}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    O projeto sera executado a partir desse volume.
                  </p>
                </div>
              )}
              {editDialog.templateId === 'node-app' && (
                <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
                  <label className="block text-sm font-semibold text-cyan-200 mb-3">Modo do serviço Node.js</label>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className={`rounded-xl border p-3 text-sm ${editDialog.nodeServiceMode === NODE_SERVICE_MODES.service ? 'border-cyan-400 bg-cyan-500/10 text-white' : 'border-slate-700 bg-slate-800 text-slate-300'}`}>
                      <input
                        type="radio"
                        className="mr-2"
                        name="edit-node-service-mode"
                        checked={editDialog.nodeServiceMode === NODE_SERVICE_MODES.service}
                        onChange={() =>
                          setEditDialog((prev) => ({
                            ...prev,
                            nodeServiceMode: NODE_SERVICE_MODES.service
                          }))
                        }
                      />
                      Serviço
                      <span className="mt-1 block text-xs text-slate-400">
                        Mantém o comportamento atual do serviço Node.
                      </span>
                    </label>
                    <label className={`rounded-xl border p-3 text-sm ${editDialog.nodeServiceMode === NODE_SERVICE_MODES.sites ? 'border-cyan-400 bg-cyan-500/10 text-white' : 'border-slate-700 bg-slate-800 text-slate-300'}`}>
                      <input
                        type="radio"
                        className="mr-2"
                        name="edit-node-service-mode"
                        checked={editDialog.nodeServiceMode === NODE_SERVICE_MODES.sites}
                        onChange={() =>
                          setEditDialog((prev) => ({
                            ...prev,
                            nodeServiceMode: NODE_SERVICE_MODES.sites
                          }))
                        }
                      />
                      Sites
                      <span className="mt-1 block text-xs text-slate-400">
                        Serve o conteúdo do site em <code>/</code> e recria a estrutura automaticamente.
                      </span>
                    </label>
                  </div>

                  {editDialog.nodeServiceMode === NODE_SERVICE_MODES.sites && (
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="block text-sm text-slate-300 mb-2">Tipo de site</label>
                        <select
                          className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                          value={editDialog.nodeSiteConfig?.siteType || NODE_SITE_TYPES.common}
                          onChange={(e) =>
                            setEditDialog((prev) => ({
                              ...prev,
                              nodeSiteConfig: {
                                ...prev.nodeSiteConfig,
                                siteType: e.target.value
                              }
                            }))
                          }
                        >
                          <option value={NODE_SITE_TYPES.common}>Site Comum</option>
                          <option value={NODE_SITE_TYPES.spa}>Angular/React/Vue</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm text-slate-300 mb-2">Pasta do site</label>
                        <select
                          className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                          value={editDialog.nodeSiteConfig?.siteFolder || NODE_SITE_FOLDERS[0]}
                          onChange={(e) =>
                            setEditDialog((prev) => ({
                              ...prev,
                              nodeSiteConfig: {
                                ...prev.nodeSiteConfig,
                                siteFolder: e.target.value
                              }
                            }))
                          }
                        >
                          {NODE_SITE_FOLDERS.map((folder) => (
                            <option key={folder} value={folder}>
                              {folder}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm text-slate-300 mb-2">Arquivo padrão / fallback</label>
                        <input
                          className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                          placeholder="index.html"
                          value={editDialog.nodeSiteConfig?.fallbackFile || 'index.html'}
                          onChange={(e) =>
                            setEditDialog((prev) => ({
                              ...prev,
                              nodeSiteConfig: {
                                ...prev.nodeSiteConfig,
                                fallbackFile: e.target.value
                              }
                            }))
                          }
                        />
                        <p className="text-xs text-slate-400 mt-1">
                          Em modo Sites o comando é automático: <code>npm install && npm start</code>.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {!(editDialog.templateId === 'node-app' && editDialog.nodeServiceMode === NODE_SERVICE_MODES.sites) && (
                <div>
                  <label className="block text-sm text-slate-300 mb-2">Comando de inicializacao</label>
                  <input
                    className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                    placeholder="npm install && npm run start"
                    value={editDialog.commandInput || ''}
                    onChange={(e) => setEditDialog(prev => ({ ...prev, commandInput: e.target.value }))}
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    Deixe vazio para detectar package.json, entrypoint.sh/start.sh ou .jar enviado.
                  </p>
                </div>
              )}
              <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-white">Healthcheck e rollback</h4>
                    <p className="mt-1 text-xs text-slate-400">
                      A nova versão é testada em porta temporária antes de substituir a atual.
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      className="rounded border-slate-600 bg-slate-800 text-blue-400"
                      checked={!!editDialog.healthcheck?.enabled}
                      onChange={(e) =>
                        setEditDialog((prev) => ({
                          ...prev,
                          healthcheck: {
                            ...normalizeHealthcheckForm(prev.healthcheck || {}),
                            enabled: e.target.checked
                          }
                        }))
                      }
                    />
                    Ativar teste
                  </label>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-4">
                  <div className="md:col-span-2">
                    <label className="block text-xs text-slate-400 mb-1">Path ou URL</label>
                    <input
                      className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                      placeholder="/health ou https://api.exemplo.com/health"
                      value={editDialog.healthcheck?.target || ''}
                      onChange={(e) =>
                        setEditDialog((prev) => ({
                          ...prev,
                          healthcheck: {
                            ...normalizeHealthcheckForm(prev.healthcheck || {}),
                            target: e.target.value
                          }
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Intervalo (s)</label>
                    <input
                      type="number"
                      min="1"
                      className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                      value={editDialog.healthcheck?.intervalSeconds ?? DEFAULT_HEALTHCHECK.intervalSeconds}
                      onChange={(e) =>
                        setEditDialog((prev) => ({
                          ...prev,
                          healthcheck: {
                            ...normalizeHealthcheckForm(prev.healthcheck || {}),
                            intervalSeconds: Number(e.target.value)
                          }
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Timeout (s)</label>
                    <input
                      type="number"
                      min="1"
                      className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                      value={editDialog.healthcheck?.timeoutSeconds ?? DEFAULT_HEALTHCHECK.timeoutSeconds}
                      onChange={(e) =>
                        setEditDialog((prev) => ({
                          ...prev,
                          healthcheck: {
                            ...normalizeHealthcheckForm(prev.healthcheck || {}),
                            timeoutSeconds: Number(e.target.value)
                          }
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Tentativas</label>
                    <input
                      type="number"
                      min="1"
                      className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                      value={editDialog.healthcheck?.retries ?? DEFAULT_HEALTHCHECK.retries}
                      onChange={(e) =>
                        setEditDialog((prev) => ({
                          ...prev,
                          healthcheck: {
                            ...normalizeHealthcheckForm(prev.healthcheck || {}),
                            retries: Number(e.target.value)
                          }
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Espera inicial (s)</label>
                    <input
                      type="number"
                      min="0"
                      className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                      value={editDialog.healthcheck?.startPeriodSeconds ?? DEFAULT_HEALTHCHECK.startPeriodSeconds}
                      onChange={(e) =>
                        setEditDialog((prev) => ({
                          ...prev,
                          healthcheck: {
                            ...normalizeHealthcheckForm(prev.healthcheck || {}),
                            startPeriodSeconds: Number(e.target.value)
                          }
                        }))
                      }
                    />
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-300 md:col-span-2">
                    <input
                      type="checkbox"
                      className="rounded border-slate-600 bg-slate-800 text-blue-400"
                      checked={editDialog.autoRollback ?? true}
                      onChange={(e) =>
                        setEditDialog((prev) => ({
                          ...prev,
                          autoRollback: e.target.checked
                        }))
                      }
                    />
                    Rollback automático se a versão falhar
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-300 md:col-span-2">
                    <input
                      type="checkbox"
                      className="rounded border-slate-600 bg-slate-800 text-blue-400"
                      checked={editDialog.healthcheck?.containerEnabled ?? DEFAULT_HEALTHCHECK.containerEnabled}
                      onChange={(e) =>
                        setEditDialog((prev) => ({
                          ...prev,
                          healthcheck: {
                            ...normalizeHealthcheckForm(prev.healthcheck || {}),
                            containerEnabled: e.target.checked
                          }
                        }))
                      }
                    />
                    Aplicar HEALTHCHECK no container
                  </label>
                </div>
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-2">Variáveis de Ambiente</label>
                <div className="space-y-2">
                  {(editDialog.newEnvVars || []).length === 0 && (
                    <p className="text-xs text-slate-500">Nenhuma variável configurada.</p>
                  )}
                  {(editDialog.newEnvVars || []).map((env, idx) => (
                    <div key={idx} className="flex gap-2">
                      <input
                        className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                        placeholder="CHAVE"
                        value={env.key}
                        onChange={(e) => {
                          const newEnvs = [...(editDialog.newEnvVars || [])];
                          newEnvs[idx].key = e.target.value;
                          if (newEnvs[idx].secret && newEnvs[idx].value === '******') {
                            newEnvs[idx].value = '';
                          }
                          setEditDialog(prev => ({ ...prev, newEnvVars: newEnvs }));
                        }}
                      />
                      <input
                        className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                        placeholder="valor"
                        type={env.secret ? 'password' : 'text'}
                        value={env.value}
                        onChange={(e) => {
                          const newEnvs = [...(editDialog.newEnvVars || [])];
                          newEnvs[idx].value = e.target.value;
                          setEditDialog(prev => ({ ...prev, newEnvVars: newEnvs }));
                        }}
                      />
                      <label className="flex items-center gap-2 text-xs text-slate-300">
                        <input
                          type="checkbox"
                          className="rounded border-slate-600 bg-slate-800 text-blue-400"
                          checked={!!env.secret}
                          onChange={(e) => {
                            const newEnvs = [...(editDialog.newEnvVars || [])];
                            const nextSecret = e.target.checked;
                            newEnvs[idx].secret = nextSecret;
                            if (!nextSecret && newEnvs[idx].value === '******') {
                              newEnvs[idx].value = '';
                            }
                            setEditDialog(prev => ({ ...prev, newEnvVars: newEnvs }));
                          }}
                        />
                        Secreto
                      </label>
                      <button
                        className="rounded-xl border border-rose-700 bg-rose-800 px-3 py-2 text-xs text-rose-200"
                        onClick={() => {
                          const newEnvs = (editDialog.newEnvVars || []).filter((_, i) => i !== idx);
                          setEditDialog(prev => ({ ...prev, newEnvVars: newEnvs }));
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    className="text-xs text-blue-300 underline"
                    onClick={() => {
                      const newEnvs = [...(editDialog.newEnvVars || []), { key: '', value: '', secret: false }];
                      setEditDialog(prev => ({ ...prev, newEnvVars: newEnvs }));
                    }}
                  >
                    + Adicionar variável
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-2">Importar arquivo .env</label>
                <input
                  type="file"
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-500 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-950"
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    setEnvImportStatus({ status: 'loading', message: 'Lendo arquivo...' })
                    const parsed = await parseEnvFile(file)
                    const currentEnvs = editDialog?.newEnvVars || []
                    const { merged, overwrites } = buildEnvMerge(currentEnvs, parsed)
                    if (overwrites.length) {
                      setEnvImportDialog({ target: 'edit', merged, overwrites })
                      setEnvImportStatus({ status: 'waiting', message: 'Aguardando confirmacao de sobrescrita.' })
                    } else {
                      setEditDialog((prev) => ({ ...prev, newEnvVars: merged }))
                      setEnvImportStatus({ status: 'done', message: 'Variaveis importadas com sucesso.' })
                    }
                    e.target.value = ''
                  }}
                />
                {envImportStatus && (
                  <div className="flex items-center gap-2 text-xs text-slate-300 mt-2">
                    {envImportStatus.status === 'loading' && (
                      <span className="inline-flex h-3 w-3 animate-spin rounded-full border-2 border-slate-500 border-t-blue-400" />
                    )}
                    <span>{envImportStatus.message}</span>
                  </div>
                )}
                <p className="text-xs text-slate-400 mt-1">
                  As chaves do arquivo substituem as existentes com o mesmo nome.
                </p>
              </div>
              <div>
                  <label className="block text-sm text-slate-300 mb-2">Atualizar projeto ou JAR (zip/tar/jar)</label>
                  <div className="flex flex-col gap-2">
                    <input
                      type="file"
                      accept=".jar,.zip,.tar,.tar.gz,.tgz"
                      className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-500 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-950"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null
                        setEditDialog(prev => ({ ...prev, newProjectArchive: file }))
                      }}
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="rounded-xl border border-blue-800 bg-blue-950 px-3 py-2 text-xs text-blue-200 hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={
                          !editDialog.newProjectArchive ||
                          projectUploadInProgress ||
                          serviceUpdateInProgress
                        }
                        onClick={async () => {
                          const ok = await uploadProjectArchive(editDialog.id, editDialog.newProjectArchive, {
                            envVars: editDialog.newEnvVars || [],
                            healthcheck: editDialog.healthcheck,
                            autoRollback: editDialog.autoRollback ?? true
                          })
                          if (ok) {
                            setEditDialog(prev => ({ ...prev, newProjectArchive: null }))
                          }
                        }}
                      >
                        <span className="inline-flex items-center gap-2">
                          {(projectUploadStatus?.status === 'uploading' ||
                            projectUploadStatus?.status === 'processing') && (
                            <>
                              <span className="inline-flex h-3 w-3 animate-spin rounded-full border-2 border-slate-500 border-t-blue-400" />
                              <span className="flex items-center gap-1">
                                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-300 [animation-delay:-0.2s]" />
                                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-300" />
                                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-300 [animation-delay:0.2s]" />
                              </span>
                            </>
                          )}
                          {projectUploadStatus?.status === 'uploading' && 'Enviando...'}
                          {projectUploadStatus?.status === 'processing' && 'Processando...'}
                          {!projectUploadStatus ||
                          (projectUploadStatus?.status !== 'uploading' &&
                            projectUploadStatus?.status !== 'processing')
                            ? 'Atualizar serviço publicado'
                            : ''}
                        </span>
                      </button>
                    </div>
                    <p className="text-xs text-slate-400">
                      {editDialog.templateId === 'node-app' && editDialog.nodeServiceMode === NODE_SERVICE_MODES.sites
                        ? `Os arquivos serão extraídos na pasta ${editDialog.nodeSiteConfig?.siteFolder || NODE_SITE_FOLDERS[0]} e validados antes da troca.`
                        : 'O projeto sera publicado como nova versao e validado antes da troca.'}
                    </p>
                    <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-3 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-200">
                          {projectUploadStatus?.status === 'uploading' && 'Enviando...'}
                          {projectUploadStatus?.status === 'processing' && 'Processando no servidor...'}
                          {projectUploadStatus?.status === 'success' && 'Atualizacao concluida'}
                          {projectUploadStatus?.status === 'error' && 'Falha na atualizacao'}
                          {!projectUploadStatus && 'Aguardando arquivo para enviar.'}
                        </span>
                        <a
                          className="text-blue-300 underline"
                          href={getPanelHref('/logs')}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Ver logs
                        </a>
                      </div>
                      {(projectUploadStatus?.status === 'uploading' || projectUploadStatus?.status === 'processing') && (
                        <div className="mt-2">
                          <div className="flex items-center gap-2 text-slate-300">
                            <span className="inline-flex h-4 w-4 animate-spin rounded-full border-2 border-slate-500 border-t-blue-400" />
                            <span>{projectUploadStatus.progress || 0}%</span>
                          </div>
                          <div className="mt-2 h-2 w-full rounded-full bg-slate-700">
                            <div
                              className="h-2 rounded-full bg-blue-500 transition-all"
                              style={{ width: `${projectUploadStatus.progress || 0}%` }}
                            />
                          </div>
                        </div>
                      )}
                      {projectUploadStatus?.message && (
                        <p className="mt-2 text-slate-300 break-all">
                          {projectUploadStatus.message}
                        </p>
                      )}
                    </div>
                    <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-3 text-xs">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-semibold text-slate-200">Versões publicadas</span>
                        <span className="text-slate-500">
                          {(editDialog.deployments || []).length} registro(s)
                        </span>
                      </div>
                      {(editDialog.deployments || []).length === 0 && (
                        <p className="mt-2 text-slate-500">Nenhuma versão salva ainda.</p>
                      )}
                      <div className="mt-3 space-y-2">
                        {(editDialog.deployments || []).slice(0, 10).map((deployment) => {
                          const isActive = deployment.id === editDialog.activeDeploymentId || deployment.status === 'active'
                          const createdAt = deployment.promotedAt || deployment.createdAt
                          return (
                            <div
                              key={deployment.id}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-slate-200">
                                  {deployment.label || deployment.filename || deployment.id}
                                </p>
                                <p className="text-[11px] text-slate-500">
                                  {createdAt ? new Date(createdAt).toLocaleString() : 'sem data'} · {deployment.status || 'available'}
                                </p>
                              </div>
                              <button
                                className="rounded-lg border border-slate-600 px-3 py-1.5 text-[11px] text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                                disabled={
                                  isActive ||
                                  projectUploadStatus?.status === 'uploading' ||
                                  projectUploadStatus?.status === 'processing'
                                }
                                onClick={() => rollbackServiceVersion(editDialog.id, deployment.id)}
                              >
                                {isActive ? 'Atual' : 'Rollback'}
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                </div>
            </div>
            {serviceUpdateStatus && (
              <div
                className={`mt-4 rounded-xl border p-3 text-xs ${
                  serviceUpdateStatus.status === 'error'
                    ? 'border-rose-700 bg-rose-950/60 text-rose-100'
                    : serviceUpdateStatus.status === 'success'
                      ? 'border-emerald-700 bg-emerald-950/50 text-emerald-100'
                      : 'border-blue-800 bg-blue-950/50 text-blue-100'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {serviceUpdateInProgress && (
                      <span className="inline-flex h-4 w-4 animate-spin rounded-full border-2 border-slate-500 border-t-blue-300" />
                    )}
                    <span className="font-semibold">
                      {serviceUpdateStatus.status === 'saving' && 'Salvando configuração'}
                      {serviceUpdateStatus.status === 'applying' && 'Aplicando atualização'}
                      {serviceUpdateStatus.status === 'success' && 'Operação concluída'}
                      {serviceUpdateStatus.status === 'error' && 'Erro na atualização'}
                    </span>
                  </div>
                  <span className="font-mono">{serviceUpdateStatus.progress || 0}%</span>
                </div>
                {serviceUpdateInProgress && (
                  <div className="mt-2 h-2 w-full rounded-full bg-slate-800">
                    <div
                      className="h-2 rounded-full bg-blue-400 transition-all"
                      style={{ width: `${serviceUpdateStatus.progress || 0}%` }}
                    />
                  </div>
                )}
                {serviceUpdateStatus.message && (
                  <p className="mt-2 break-all">{serviceUpdateStatus.message}</p>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-2 mt-6">
              <button
                className="rounded-xl border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={editOperationInProgress}
                onClick={async () => {
                  const updated = await updateService(
                    editDialog.id,
                    buildEditServicePayload(editDialog),
                    { apply: false }
                  )
                  if (updated) {
                    setEditDialog((prev) => prev ? {
                      ...prev,
                      pendingConfig: updated.pendingConfig || prev.pendingConfig
                    } : prev)
                  }
                }}
              >
                Salvar
              </button>
              <button
                className="flex-1 rounded-xl bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={editOperationInProgress}
                onClick={async () => {
                  if (editDialog.newProjectArchive) {
                    const ok = await uploadProjectArchive(editDialog.id, editDialog.newProjectArchive, {
                      envVars: editDialog.newEnvVars || [],
                      healthcheck: editDialog.healthcheck,
                      autoRollback: editDialog.autoRollback ?? true
                    })
                    if (!ok) {
                      return
                    }
                  }
                  const updated = await updateService(
                    editDialog.id,
                    buildEditServicePayload(editDialog),
                    { apply: true }
                  );
                  if (updated) {
                    setEditDialog(null);
                  }
                }}
              >
                Aplicar
              </button>
              <button
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={editOperationInProgress}
                onClick={() => {
                  setServiceUpdateStatus(null)
                  setEditDialog(null)
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {envImportDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-lg w-full mx-4 max-h-[85vh] flex flex-col">
            <h3 className="text-lg font-semibold text-white mb-2">⚠️ Variáveis serão sobrescritas</h3>
            <p className="text-sm text-slate-300 mb-4">
              As chaves abaixo já existem. Deseja substituir pelo novo valor do arquivo?
            </p>
            <div className="space-y-2 overflow-y-auto pr-1 flex-1">
              {envImportDialog.overwrites.map((item) => (
                <div key={item.key} className="rounded-xl border border-slate-700 bg-slate-800/60 p-3 text-xs">
                  <p className="text-slate-200 font-semibold">{item.key}</p>
                  <div className="mt-2 grid gap-2">
                    <div className="rounded-lg border border-slate-800 bg-slate-900 p-2">
                      <p className="text-[10px] uppercase text-slate-400">Atual</p>
                      <p className="text-slate-200 break-all">{item.previous || '(vazio)'}</p>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-slate-900 p-2">
                      <p className="text-[10px] uppercase text-slate-400">Novo</p>
                      <p className="text-emerald-200 break-all">{item.next || '(vazio)'}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-6">
              <button
                className="flex-1 rounded-xl bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600"
                onClick={() => {
                  if (envImportDialog.target === 'create') {
                    setServiceForm((p) => ({ ...p, envs: envImportDialog.merged }))
                  } else {
                    setEditDialog((prev) => ({ ...prev, newEnvVars: envImportDialog.merged }))
                  }
                  setEnvImportStatus({ status: 'done', message: 'Variaveis importadas com sucesso.' })
                  setEnvImportDialog(null)
                }}
              >
                Sobrescrever
              </button>
              <button
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700"
                onClick={() => setEnvImportDialog(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {removeDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-white mb-4">🗑️ Remover Serviço</h3>
            <p className="text-sm text-slate-300 mb-4">
              Digite o nome do serviço <span className="font-mono text-blue-300">{removeDialog.name}</span> para confirmar a remoção:
            </p>
            <input
              className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white mb-4"
              placeholder="Nome do serviço"
              onChange={(e) => setRemoveDialog(prev => ({ ...prev, confirmName: e.target.value }))}
            />
            <div className="mb-4">
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  className="rounded border-slate-600 bg-slate-700 text-rose-500"
                  onChange={(e) => setRemoveDialog(prev => ({ ...prev, removeFolder: e.target.checked }))}
                />
                Remover pasta do projeto ({removeDialog.volumes?.[0]?.hostPath || 'N/A'})
              </label>
              <p className="text-xs text-slate-400 mt-1">
                ⚠️ Esta ação não pode ser desfeita
              </p>
            </div>
            <div className="flex gap-2">
              <button
                className={`flex-1 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                  removeDialog.confirmName === removeDialog.name
                    ? 'bg-rose-500 text-white hover:bg-rose-600'
                    : 'bg-slate-700 text-slate-400 cursor-not-allowed'
                }`}
                disabled={removeDialog.confirmName !== removeDialog.name}
                onClick={() => {
                  removeService(removeDialog.id, removeDialog.removeFolder)
                  setRemoveDialog(null)
                }}
              >
                Remover Definitivamente
              </button>
              <button
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700"
                onClick={() => setRemoveDialog(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {registryDialog && (
        <RegistryModal
          initialValue={registryDialog}
          onSave={saveRegistry}
          onCancel={() => setRegistryDialog(null)}
        />
      )}

      <div className="fixed right-6 top-24 space-y-2">
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            message={toast.message}
            type={toast.type}
            onClose={() => setToasts((prev) => prev.filter((item) => item.id !== toast.id))}
          />
        ))}
      </div>
    </div>
  )
}

export default DockerPanel
