import { memo, useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Plus, Play, Square, RefreshCw, Trash2, Copy,
  Globe, Code2, Database, Zap, List, Activity,
  HardDrive, ChevronLeft, Download, ClipboardCheck,
  Layers, Eye, AlertCircle, CheckCircle2, Clock,
  X, Settings, GitBranch, Cpu, Server, Upload,
  Maximize2, Minimize2, LogOut
} from 'lucide-react'
import api, { uploadApi } from '../services/api.js'
import { useTheme } from '../app/providers/theme-provider'
import { useConfirm } from "./ui/ConfirmModal"
import SERVICE_CATALOG from '../data/serviceCatalog.js'

// ─── Constantes ───────────────────────────────────────────────────────────────

const ENVIRONMENTS = [
  { value: 'production', label: 'Produção', color: 'rose' },
  { value: 'staging', label: 'Staging', color: 'amber' },
  { value: 'development', label: 'Desenvolvimento', color: 'emerald' },
  { value: 'custom', label: 'Customizado', color: 'violet' }
]

const SERVICE_ROLES = {
  'entry-point': { label: 'Entry Point', icon: Globe, color: '#10b981', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.35)', description: 'Nginx, Traefik, HAProxy' },
  'webapp':      { label: 'WebApp',      icon: Globe,   color: '#06b6d4', bg: 'rgba(6,182,212,0.12)', border: 'rgba(6,182,212,0.35)', description: 'React, Next.js, Vue, Angular' },
  'runtime':     { label: 'WebService',  icon: Code2,   color: '#3b82f6', bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.35)', description: 'Node.js, Python, Java, PHP' },
  'database':    { label: 'Database',    icon: Database, color: '#a855f7', bg: 'rgba(168,85,247,0.12)', border: 'rgba(168,85,247,0.35)', description: 'PostgreSQL, MySQL, MongoDB' },
  'cache':       { label: 'Cache',       icon: Zap,      color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.35)', description: 'Redis, Memcached' },
  'queue':       { label: 'Queue',       icon: List,     color: '#f97316', bg: 'rgba(249,115,22,0.12)', border: 'rgba(249,115,22,0.35)', description: 'RabbitMQ, Kafka, Celery' },
  'monitor':     { label: 'Monitor',     icon: Activity, color: '#ec4899', bg: 'rgba(236,72,153,0.12)', border: 'rgba(236,72,153,0.35)', description: 'Prometheus, Grafana' },
  'storage':     { label: 'Storage',     icon: HardDrive,color: '#06b6d4', bg: 'rgba(6,182,212,0.12)', border: 'rgba(6,182,212,0.35)', description: 'MinIO, S3-compatible' }
}

const SERVICE_STATUS = {
  running: { color: '#4ade80', label: 'Rodando', glow: 'rgba(74,222,128,0.6)' },
  stopped: { color: '#94a3b8', label: 'Parado', glow: 'transparent' },
  error:   { color: '#f87171', label: 'Erro', glow: 'rgba(248,113,113,0.6)' },
  pending: { color: '#fbbf24', label: 'Aguardando', glow: 'rgba(251,191,36,0.4)' }
}

const PRESET_SERVICES = [
  { name: 'nginx',    role: 'entry-point', image: 'nginx',    tag: 'latest',       ports: [{ host: 80, container: 80 }] },
  { name: 'node-app', role: 'runtime',     image: 'node',     tag: '20-alpine',    ports: [{ host: 3000, container: 3000 }] },
  { name: 'python',   role: 'runtime',     image: 'python',   tag: '3.12-slim',    ports: [{ host: 8000, container: 8000 }] },
  { name: 'php',      role: 'runtime',     image: 'php',      tag: '8.3-fpm-alpine', ports: [{ host: 9000, container: 9000 }] },
  { name: 'postgres', role: 'database',    image: 'postgres', tag: '16-alpine',    ports: [{ host: 5432, container: 5432 }] },
  { name: 'mysql',    role: 'database',    image: 'mysql',    tag: '8.0',          ports: [{ host: 3306, container: 3306 }] },
  { name: 'mongo',    role: 'database',    image: 'mongo',    tag: '7',            ports: [{ host: 27017, container: 27017 }] },
  { name: 'redis',    role: 'cache',       image: 'redis',    tag: '7-alpine',     ports: [{ host: 6379, container: 6379 }] },
  { name: 'rabbitmq', role: 'queue',       image: 'rabbitmq', tag: '3-management', ports: [{ host: 5672, container: 5672 }] }
]

const CATEGORY_ICONS = { web: Globe, cms: Server, architecture: GitBranch }

const CANVAS_LANES = [
  { key: 'entry-point', label: 'Load Balancer', hint: 'Ingress, gateway, reverse proxy' },
  { key: 'webapp', label: 'WebApp / Front-End', hint: 'React, Next.js, Vue, Angular, sites' },
  { key: 'runtime', label: 'WebService / Back-End', hint: 'Java, Node.js, Python, PHP, APIs' },
  { key: 'cache', label: 'Cache', hint: 'Redis, Memcached, Valkey' },
  { key: 'queue', label: 'Queue', hint: 'RabbitMQ, Kafka, brokers' },
  { key: 'database', label: 'Banco de Dados', hint: 'PostgreSQL, MySQL, MongoDB' },
  { key: 'storage', label: 'Storage', hint: 'Object/block/file storage' },
  { key: 'monitor', label: 'Monitoramento', hint: 'Observability, métricas e logs' }
]

const CANVAS_ROLE_HINTS = {
  'entry-point': ['nginx', 'traefik', 'haproxy', 'envoy', 'caddy', 'gateway', 'ingress', 'loadbalancer', 'load-balancer', 'proxy'],
  'webapp': ['react', 'vue', 'angular', 'svelte', 'nextjs', 'nuxt', 'vite', 'webpack', 'frontend', 'front-end', 'webapp', 'website', 'static-site'],
  'runtime': ['node', 'next', 'nestjs', 'express', 'java', 'spring', 'quarkus', 'tomcat', 'python', 'django', 'flask', 'fastapi', 'php', 'laravel', 'dotnet', 'aspnet', 'go', 'api', 'webservice', 'backend', 'back-end', 'app'],
  'cache': ['redis', 'memcached', 'valkey', 'cache'],
  'queue': ['rabbitmq', 'kafka', 'nats', 'activemq', 'queue', 'broker', 'worker', 'bullmq'],
  'database': ['postgres', 'postgresql', 'mysql', 'mariadb', 'mongo', 'mongodb', 'sqlserver', 'mssql', 'oracle', 'db', 'database'],
  'storage': ['minio', 's3', 'ceph', 'storage', 'bucket', 'blob', 'nfs'],
  'monitor': ['prometheus', 'grafana', 'loki', 'tempo', 'jaeger', 'zabbix', 'datadog', 'newrelic', 'monitor', 'observability', 'otel']
}

const LAYMAN_ROLE_GUIDE = {
  'entry-point': {
    title: 'Load Balancer / Entrada',
    purpose: 'Recebe as requisicoes da internet e distribui para os apps.',
    startup: 'Ligue primeiro para abrir a porta de entrada do sistema.'
  },
  'webapp': {
    title: 'WebApp / Front-End',
    purpose: 'Exibe a interface visual para o usuario (HTML, CSS, JS).',
    startup: 'Ligue apos o backend estar pronto para o front consumir a API.'
  },
  'runtime': {
    title: 'Aplicacao / WebService',
    purpose: 'Executa a regra de negocio e responde as telas e APIs.',
    startup: 'Ligue em seguida para o sistema começar a trabalhar.'
  },
  'cache': {
    title: 'Cache',
    purpose: 'Guarda dados rapidos para reduzir lentidao e carga.',
    startup: 'Ligue junto da aplicacao para acelerar as respostas.'
  },
  'queue': {
    title: 'Fila / Mensageria',
    purpose: 'Organiza tarefas assíncronas sem travar o sistema principal.',
    startup: 'Ligue antes dos workers para evitar perda de tarefas.'
  },
  'database': {
    title: 'Banco de Dados',
    purpose: 'Armazena dados principais do sistema com persistencia.',
    startup: 'Ligue antes da aplicacao gravar e consultar dados.'
  },
  'storage': {
    title: 'Storage',
    purpose: 'Guarda arquivos, imagens, anexos e backups.',
    startup: 'Ligue quando o sistema usa uploads e arquivos.'
  },
  'monitor': {
    title: 'Monitoramento',
    purpose: 'Mostra saude, erros e metricas para operacao.',
    startup: 'Pode ligar por ultimo, mas mantenha ativo em producao.'
  }
}

const STARTUP_SEQUENCE = ['entry-point', 'database', 'storage', 'queue', 'cache', 'runtime', 'webapp', 'monitor']

const ASSEMBLY_FLOW_STAGES = [
  { key: 'loadbalance', label: 'Loadbalance', description: 'Entrada de trafego e roteamento' },
  { key: 'frontend', label: 'Front-End Principal', description: 'Camada principal de aplicacao/web' },
  { key: 'data', label: 'Cache • Banco de dados • NoSQL', description: 'Persistencia e aceleracao de dados' },
  { key: 'storage', label: 'Storage', description: 'Arquivos, objetos e anexos' },
  { key: 'vps', label: 'VPS', description: 'Servicos de host/infra dedicados' },
  { key: 'build', label: 'Build', description: 'Pipeline de build/deploy' },
  { key: 'other', label: '+ Outros Serviços', description: 'Complementos e integracoes' }
]

const STAGE_SERVICE_HINTS = {
  loadbalance: {
    label: 'Loadbalance',
    defaultRole: 'entry-point',
    allowedRoles: ['entry-point'],
    presetNames: ['nginx', 'website']
  },
  frontend: {
    label: 'Front-End Principal',
    defaultRole: 'webapp',
    allowedRoles: ['webapp', 'runtime'],
    presetNames: ['website', 'node', 'python', 'php']
  },
  data: {
    label: 'Cache • Banco de dados • NoSQL',
    defaultRole: 'database',
    allowedRoles: ['cache', 'database'],
    presetNames: ['redis', 'postgres', 'mysql', 'mongo']
  },
  storage: {
    label: 'Storage',
    defaultRole: 'storage',
    allowedRoles: ['storage'],
    presetNames: []
  },
  vps: {
    label: 'VPS',
    defaultRole: 'runtime',
    allowedRoles: ['runtime', 'monitor'],
    presetNames: []
  },
  build: {
    label: 'Build',
    defaultRole: 'runtime',
    allowedRoles: ['runtime', 'queue', 'monitor'],
    presetNames: []
  },
  other: {
    label: 'Outros Serviços',
    defaultRole: 'runtime',
    allowedRoles: Object.keys(SERVICE_ROLES),
    presetNames: []
  }
}

const inferAssemblyStage = (service) => {
  const role = inferServiceCanvasRole(service)
  const fingerprint = [service.name, service.image, service.tag, service.templateId, service.role]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  const hasAny = (tokens) => tokens.some((token) => fingerprint.includes(token))

  if (role === 'entry-point' || hasAny(['loadbalancer', 'load-balancer', 'ingress', 'gateway', 'proxy'])) {
    return 'loadbalance'
  }

  if (role === "webapp" ||
    (role === 'runtime' && hasAny(['front', 'frontend', 'next', 'react', 'vue', 'angular', 'web'])) ||
    hasAny(['frontend', 'webapp', 'nextjs'])
  ) {
    return 'frontend'
  }

  if (role === 'cache' || role === 'database' || hasAny(['nosql', 'mongodb', 'mongo', 'redis', 'postgres', 'mysql', 'mariadb'])) {
    return 'data'
  }

  if (role === 'storage' || hasAny(['storage', 's3', 'minio', 'bucket', 'blob', 'volume'])) {
    return 'storage'
  }

  if (hasAny(['vps', 'vm', 'virtual-machine', 'droplet', 'instance', 'compute'])) {
    return 'vps'
  }

  if (hasAny(['build', 'builder', 'jenkins', 'runner', 'gitlab-ci', 'github-actions', 'ci', 'cd'])) {
    return 'build'
  }

  if (role === 'runtime') return 'frontend'
  return 'other'
}

const inferServiceCanvasRole = (service) => {
  const explicitRole = service.role
  if (explicitRole && SERVICE_ROLES[explicitRole]) return explicitRole

  const fingerprint = [service.name, service.image, service.tag, service.templateId, service.role]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  for (const lane of CANVAS_LANES) {
    const hints = CANVAS_ROLE_HINTS[lane.key] || []
    if (hints.some((hint) => fingerprint.includes(hint))) {
      return lane.key
    }
  }

  return 'runtime'
}

const TIER_LABEL_W = 172
const NODE_W      = 200
const NODE_H      = 100
const NODE_GAP    = 14
const TIER_PAD_V  = 22
const TIER_H      = NODE_H + TIER_PAD_V * 2   // 144
const PORT_R      = 6

// ─── Utilitários ──────────────────────────────────────────────────────────────

const envBadge = (env) => {
  const map = { production: 'bg-rose-500/20 text-rose-300 border-rose-500/30', staging: 'bg-amber-500/20 text-amber-300 border-amber-500/30', development: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', custom: 'bg-violet-500/20 text-violet-300 border-violet-500/30' }
  return map[env] || map.custom
}

const statusBadge = (status) => {
  const map = { running: 'text-emerald-400', partial: 'text-amber-400', stopped: 'text-slate-400', draft: 'text-slate-500', error: 'text-rose-400' }
  return map[status] || map.draft
}

const Toast = ({ message, type, onClose }) => (
  <div className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg ${type === 'error' ? 'border-rose-500/40 bg-rose-500/10 text-rose-200' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'}`}>
    <span>{message}</span>
    <button className="text-xs text-slate-300 hover:text-white" onClick={onClose}>fechar</button>
  </div>
)

// ─── Topology Diagram ──────────────────────────────────────────────────────────
//  Structured tier-based network topology diagram.
//  Tiers flow top → bottom. Nodes are arranged left → right within each tier.
//  Bezier wire connections between tiers. Port handles for interactive linking.

const TopologyDiagram = ({
  stack, selectedServiceId,
  onServiceClick, onAddService,
  onConnectServices, onDisconnectEdge,
  tierConfigs, onTierConfigClick
}) => {
  const { theme } = useTheme()
  const isLight = theme === 'light'
  const services = stack.services || []
  const wrapRef  = useRef(null)
  const nodeEls  = useRef({})   // { serviceId: DOM element }

  const [connecting,    setConnecting]    = useState(null)   // { fromId, mx, my }
  const [connectTarget, setConnectTarget] = useState(null)
  const [hoveredNode,   setHoveredNode]   = useState(null)
  const [hoveredEdge,   setHoveredEdge]   = useState(null)
  const [edgePaths,     setEdgePaths]     = useState([])
  const edgePathsKey    = useRef('')       // serialized key to break setState infinite loop
  const [wireStart,     setWireStart]     = useState(null)   // { x, y } relative to wrap
  const [wireMouse,     setWireMouse]     = useState(null)

  // Group services into tiers
  const tierMap = useMemo(() => {
    const m = {}
    CANVAS_LANES.forEach((l) => { m[l.key] = [] })
    services.forEach((svc) => {
      const role = inferServiceCanvasRole(svc)
      if (!m[role]) m[role] = []
      m[role].push(svc)
    })
    return m
  }, [services])

  const activeTiers = CANVAS_LANES.filter((l) => tierMap[l.key]?.length > 0)

  // Re-calculate SVG edge paths from DOM rects after every render.
  // Uses a serialized key (ref) to avoid calling setEdgePaths when nothing changed,
  // which would otherwise cause an infinite setState → re-render → setState loop.
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const wR = wrap.getBoundingClientRect()

    const paths = []
    for (const svc of services) {
      const fromEl = nodeEls.current[svc.id]
      if (!fromEl) continue
      const fR = fromEl.getBoundingClientRect()
      const fx = fR.left + fR.width / 2 - wR.left
      const fy = fR.bottom - wR.top

      for (const depId of svc.dependencies || []) {
        const toEl = nodeEls.current[depId]
        if (!toEl) continue
        const tR = toEl.getBoundingClientRect()
        const tx = tR.left + tR.width / 2 - wR.left
        const ty = tR.top - wR.top
        const cy = fy + (ty - fy) * 0.5
        paths.push({
          id:       `${svc.id}->${depId}`,
          fromId:   svc.id,
          toId:     depId,
          fromRole: inferServiceCanvasRole(svc),
          path:     `M ${fx} ${fy} C ${fx} ${cy}, ${tx} ${cy}, ${tx} ${ty}`,
          midX: (fx + tx) / 2,
          midY: cy
        })
      }
    }
    // Only update state if paths actually changed — prevents infinite render loop
    const key = paths.map((p) => `${p.id}:${p.path}`).join('|')
    if (key !== edgePathsKey.current) {
      edgePathsKey.current = key
      setEdgePaths(paths)
    }
  })  // no dep array — runs every render so paths stay in sync with DOM positions

  // Global mouse move / up during wire draw
  useEffect(() => {
    if (!connecting) return
    const onMove = (e) => {
      const wR = wrapRef.current?.getBoundingClientRect()
      if (wR) setWireMouse({ x: e.clientX - wR.left, y: e.clientY - wR.top })
    }
    const onUp = () => {
      if (connectTarget) onConnectServices?.(connecting.fromId, connectTarget)
      setConnecting(null)
      setConnectTarget(null)
      setWireStart(null)
      setWireMouse(null)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup',   onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup',   onUp)
    }
  }, [connecting, connectTarget, onConnectServices])

  const startWire = (e, svcId) => {
    e.stopPropagation()
    const el  = nodeEls.current[svcId]
    const wR  = wrapRef.current?.getBoundingClientRect()
    if (!el || !wR) return
    const eR  = el.getBoundingClientRect()
    const sx  = eR.left + eR.width / 2 - wR.left
    const sy  = eR.bottom - wR.top
    setWireStart({ x: sx, y: sy })
    setConnecting({ fromId: svcId, mx: sx, my: sy })
  }

  // Wire SVG path
  const wirePath = wireMouse && wireStart
    ? (() => {
        const { x: x1, y: y1 } = wireStart
        const { x: x2, y: y2 } = wireMouse
        const cy = y1 + (y2 - y1) * 0.5
        return `M ${x1} ${y1} C ${x1} ${cy}, ${x2} ${cy}, ${x2} ${y2}`
      })()
    : null

  const hasServices = services.length > 0

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'relative',
        borderRadius: 20,
        border: isLight ? '1px solid var(--color-canvas-border)' : '1px solid rgba(255,255,255,0.08)',
        background: isLight ? 'var(--color-canvas)' : '#04080f',
        overflow: 'hidden',
        minHeight: 320,
        boxShadow: isLight ? 'var(--shadow-sm)' : 'none'
      }}
    >
      {/* ── SVG overlay: edges + wire — rendered BEHIND the node cards ── */}
      <svg
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          pointerEvents: 'none', zIndex: 1,
          overflow: 'visible'
        }}
      >
        <defs>
          {Object.entries(SERVICE_ROLES).map(([role, cfg]) => (
            <marker
              key={role}
              id={`td-${role}`}
              viewBox="0 0 10 10" refX="8" refY="5"
              markerWidth="5" markerHeight="5" orient="auto"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill={cfg.color} />
            </marker>
          ))}
        </defs>

        {/* Dependency edges */}
        {edgePaths.map((edge) => {
          const cfg  = SERVICE_ROLES[edge.fromRole] || SERVICE_ROLES.runtime
          const isHov = hoveredEdge === edge.id
          return (
            <g
              key={edge.id}
              style={{ pointerEvents: 'auto', cursor: 'pointer' }}
              onMouseEnter={() => setHoveredEdge(edge.id)}
              onMouseLeave={() => setHoveredEdge(null)}
              onClick={() => onDisconnectEdge?.(edge.fromId, edge.toId)}
            >
              {/* Wide transparent hit area */}
              <path d={edge.path} stroke="transparent" strokeWidth="14" fill="none" />
              <path
                d={edge.path}
                stroke={isHov ? '#f87171' : cfg.color}
                strokeWidth={isHov ? 2 : 1.5}
                fill="none"
                opacity={isHov ? 0.95 : 0.55}
                markerEnd={`url(#td-${edge.fromRole})`}
                style={{ transition: 'stroke 0.12s, opacity 0.12s' }}
              />
              {isHov && (
                <text
                  x={edge.midX} y={edge.midY - 6}
                  fontSize="9" fill="#f87171" textAnchor="middle"
                  style={{ pointerEvents: 'none', fontFamily: 'sans-serif' }}
                >
                  × remover
                </text>
              )}
            </g>
          )
        })}

        {/* Wire being drawn */}
        {wirePath && (
          <>
            <path d={wirePath} stroke="#3b82f6" strokeWidth="1.5" fill="none" strokeDasharray="7 4" opacity="0.9" />
            {wireMouse && (
              <circle cx={wireMouse.x} cy={wireMouse.y} r="4" fill="#3b82f6" opacity="0.75" />
            )}
          </>
        )}
      </svg>

      {/* ── Empty state ── */}
      {!hasServices && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, minHeight: 320 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Server size={24} style={{ color: '#1e3a5f' }} />
          </div>
          <div style={{ textAlign: 'center' }}>
            <p style={{ color: '#334155', fontSize: 13, margin: 0 }}>Topologia vazia</p>
            <p style={{ color: '#1e293b', fontSize: 11, margin: '4px 0 0' }}>Adicione o primeiro serviço para montar a arquitetura</p>
          </div>
          <button
            onClick={() => onAddService(null)}
            style={{ fontSize: 11, color: '#60a5fa', background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: 10, padding: '7px 18px', cursor: 'pointer' }}
          >
            + Adicionar Serviço
          </button>
        </div>
      )}

      {/* ── Tier rows — above SVG edges ── */}
      {hasServices && (
        <div style={{ display: 'flex', flexDirection: 'column', position: 'relative', zIndex: 2 }}>

          {/* Internet / External node — always shown at top when LB tier exists */}
          {tierMap['entry-point']?.length > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center',
              borderBottom: isLight ? '1px solid var(--color-divider)' : '1px solid rgba(255,255,255,0.05)',
              background: isLight ? 'rgba(16,185,129,0.08)' : 'rgba(16,185,129,0.04)'
            }}>
              {/* Label */}
              <div style={{
                width: TIER_LABEL_W, minWidth: TIER_LABEL_W,
                padding: '10px 18px',
                borderRight: '1px solid rgba(16,185,129,0.12)',
                display: 'flex', alignItems: 'center', gap: 8
              }}>
                <Globe size={12} style={{ color: '#10b981', flexShrink: 0 }} />
                <span style={{ color: '#10b98188', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Internet</span>
              </div>
              {/* Internet node visual */}
              <div style={{ padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  borderRadius: 10, border: '1px solid rgba(16,185,129,0.2)',
                  background: 'rgba(16,185,129,0.07)', padding: '6px 14px'
                }}>
                  <Globe size={13} style={{ color: '#10b981' }} />
                  <span style={{ color: '#6ee7b7', fontSize: 11, fontWeight: 600 }}>Tráfego externo</span>
                  <span style={{ color: '#10b98155', fontSize: 10 }}>HTTP/S · DNS</span>
                </div>
                {/* Arrow pointing down */}
                <span style={{ color: '#10b98140', fontSize: 18 }}>↓</span>
              </div>
            </div>
          )}

          {activeTiers.map((tier, tierIdx) => {
            const cfg      = SERVICE_ROLES[tier.key] || SERVICE_ROLES.runtime
            const laneCfg  = CANVAS_LANES.find((l) => l.key === tier.key)
            const TierIcon = cfg.icon
            const svcs     = tierMap[tier.key] || []
            const isLast   = tierIdx === activeTiers.length - 1

            return (
              <div
                key={tier.key}
                style={{
                  display: 'flex',
                  borderBottom: isLast ? 'none' : (isLight ? '1px solid var(--color-divider)' : '1px solid rgba(255,255,255,0.05)'),
                  minHeight: TIER_H,
                  background: isLight ? 'rgba(255,255,255,0.68)' : 'transparent'
                }}
              >
                {/* ── Left label strip ── */}
                <div style={{
                  width: TIER_LABEL_W, minWidth: TIER_LABEL_W,
                  background: `linear-gradient(90deg, ${cfg.color}0c, transparent)`,
                  borderRight: `1px solid ${cfg.color}20`,
                  display: 'flex', flexDirection: 'column',
                  justifyContent: 'center', padding: '0 16px', gap: 6
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {/* Colored pipe accent */}
                    <div style={{ width: 3, height: 28, borderRadius: 2, background: cfg.color, flexShrink: 0 }} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <TierIcon size={11} style={{ color: cfg.color }} />
                        <span style={{ color: '#cbd5e1', fontSize: 11, fontWeight: 700 }}>{laneCfg?.label || cfg.label}</span>
                      </div>
                      <span style={{ color: '#334155', fontSize: 9, paddingLeft: 0 }}>{laneCfg?.hint || cfg.description}</span>
                    </div>
                  </div>
                  <div style={{ marginLeft: 11, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: 9, color: cfg.color, background: `${cfg.color}15`,
                      border: `1px solid ${cfg.color}30`, borderRadius: 4, padding: '1px 6px'
                    }}>{svcs.length} nó{svcs.length !== 1 ? 's' : ''}</span>
                    {tierConfigs?.[tier.key]?.domain && (
                      <span style={{ fontSize: 8, color: isLight ? '#0f4c81' : '#7dd3fc', background: isLight ? 'rgba(56,189,248,0.14)' : 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.18)', borderRadius: 4, padding: '1px 5px', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={tierConfigs[tier.key].domain}>
                        🌐 {tierConfigs[tier.key].domain}
                      </span>
                    )}
                    {tierConfigs?.[tier.key]?.env?.length > 0 && (
                      <span style={{ fontSize: 8, color: isLight ? '#0f6b57' : '#6ee7b7', background: isLight ? 'rgba(52,211,153,0.14)' : 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.18)', borderRadius: 4, padding: '1px 5px' }}>
                        {tierConfigs[tier.key].env.length} env
                      </span>
                    )}
                    {onTierConfigClick && (
                      <button
                        onClick={() => onTierConfigClick(tier.key, laneCfg?.label || cfg.label)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px 3px', display: 'flex', alignItems: 'center', color: cfg.color, opacity: 0.65 }}
                        title="Configurar camada"
                      >
                        <Settings size={10} />
                      </button>
                    )}
                  </div>
                </div>

                {/* ── Nodes area ── */}
                <div style={{
                  flex: 1, display: 'flex', alignItems: 'center',
                  gap: NODE_GAP, padding: `${TIER_PAD_V}px 20px`,
                  overflowX: 'auto', position: 'relative', zIndex: 10
                }}>
                  {svcs.map((svc) => {
                    const stCfg      = SERVICE_STATUS[svc.status] || SERVICE_STATUS.pending
                    const isSelected = svc.id === selectedServiceId
                    const isHov      = svc.id === hoveredNode
                    const isTarget   = svc.id === connectTarget

                    return (
                      <div
                        key={svc.id}
                        style={{ position: 'relative', width: NODE_W, flexShrink: 0 }}
                        onMouseEnter={() => {
                          setHoveredNode(svc.id)
                          if (connecting && connecting.fromId !== svc.id) setConnectTarget(svc.id)
                        }}
                        onMouseLeave={() => {
                          setHoveredNode(null)
                          setConnectTarget(null)
                        }}
                      >
                        {/* Input port (top-center) */}
                        <div
                          style={{
                            position: 'absolute', top: -PORT_R, left: '50%',
                            transform: 'translateX(-50%)',
                            width: PORT_R * 2, height: PORT_R * 2, borderRadius: '50%',
                            background: isTarget ? cfg.color : '#060d1a',
                            border: `2px solid ${isTarget ? cfg.color : 'rgba(255,255,255,0.15)'}`,
                            opacity: (isHov || !!connecting) ? 1 : 0,
                            cursor: 'crosshair', zIndex: 25,
                            transition: 'all 0.12s',
                            boxShadow: isTarget ? `0 0 12px ${cfg.color}` : 'none'
                          }}
                          onMouseEnter={() => connecting && connecting.fromId !== svc.id && setConnectTarget(svc.id)}
                          onMouseLeave={() => setConnectTarget(null)}
                          onMouseUp={() => {
                            if (connecting && connecting.fromId !== svc.id) {
                              onConnectServices?.(connecting.fromId, svc.id)
                              setConnecting(null); setConnectTarget(null)
                              setWireStart(null); setWireMouse(null)
                            }
                          }}
                          title="Porta de entrada"
                        />

                        {/* ── Node card ── */}
                        <div
                          ref={(el) => { nodeEls.current[svc.id] = el }}
                          onClick={() => onServiceClick(svc)}
                          style={{
                            height: NODE_H, borderRadius: 14, cursor: 'pointer',
                            background: isLight
                              ? (isSelected
                                  ? `linear-gradient(135deg, ${cfg.color}14 0%, rgba(255,255,255,0.98) 100%)`
                                  : 'linear-gradient(135deg, rgba(255,255,255,0.98) 0%, rgba(241,246,255,0.98) 100%)')
                              : (isSelected
                                  ? `linear-gradient(135deg, ${cfg.color}16 0%, rgba(6,12,26,0.98) 100%)`
                                  : 'linear-gradient(135deg, rgba(10,20,42,0.98) 0%, rgba(5,10,22,0.99) 100%)'),
                            border: `1px solid ${isSelected ? cfg.color : isTarget ? cfg.color : (isLight ? 'rgba(148,163,184,0.35)' : 'rgba(255,255,255,0.09)')}`,
                            borderLeft: `3px solid ${cfg.color}`,
                            boxShadow: isLight
                              ? (isSelected
                                  ? `0 0 0 1px ${cfg.color}22, 0 12px 26px rgba(15, 23, 42, 0.08)`
                                  : isHov
                                    ? '0 10px 24px rgba(15, 23, 42, 0.1)'
                                    : '0 4px 12px rgba(15, 23, 42, 0.06)')
                              : (isSelected
                                  ? `0 0 0 1px ${cfg.color}50, 0 8px 32px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)`
                                  : isHov
                                    ? `0 4px 20px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.03)`
                                    : `0 2px 8px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.02)`),
                            transition: 'box-shadow 0.15s, border-color 0.15s, background 0.15s',
                            display: 'flex', flexDirection: 'column', overflow: 'hidden'
                          }}
                        >
                          {/* Card header */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px 7px', flex: 1 }}>
                            {/* Role icon badge */}
                            <div style={{
                              width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                              background: `${cfg.color}18`,
                              border: `1px solid ${cfg.color}35`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center'
                            }}>
                              <TierIcon size={16} style={{ color: cfg.color }} />
                            </div>

                            <div style={{ minWidth: 0, flex: 1 }}>
                              <p style={{
                                color: isLight ? 'var(--color-text)' : '#f1f5f9', fontSize: 12, fontWeight: 700, margin: 0,
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                              }}>
                                {svc.name}
                              </p>
                              <p style={{
                                color: isLight ? 'var(--color-text-soft)' : '#475569', fontSize: 10, margin: '2px 0 0',
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                fontFamily: 'ui-monospace, monospace'
                              }}>
                                {svc.image}:{svc.tag || 'latest'}
                              </p>
                            </div>

                            {/* Status LED */}
                            <div style={{ position: 'relative', width: 10, height: 10, flexShrink: 0 }}>
                              {svc.status === 'running' && (
                                <span className="animate-ping" style={{
                                  position: 'absolute', inset: 0, borderRadius: '50%',
                                  background: stCfg.color, opacity: 0.4
                                }} />
                              )}
                              <span style={{
                                position: 'relative', display: 'block',
                                width: 10, height: 10, borderRadius: '50%',
                                background: stCfg.color, boxShadow: `0 0 5px ${stCfg.glow}`
                              }} />
                            </div>
                          </div>

                          {/* Card footer: badges */}
                          <div style={{
                            display: 'flex', gap: 4, padding: '0 12px 9px',
                            flexWrap: 'wrap', alignItems: 'center'
                          }}>
                            {svc.ports?.[0] && (
                              <span style={{
                                fontSize: 9, color: isLight ? 'var(--color-text-soft)' : '#64748b',
                                background: isLight ? 'rgba(226,232,240,0.72)' : 'rgba(255,255,255,0.04)',
                                border: isLight ? '1px solid rgba(148,163,184,0.28)' : '1px solid rgba(255,255,255,0.08)',
                                borderRadius: 4, padding: '1px 5px',
                                fontFamily: 'ui-monospace, monospace'
                              }}>:{svc.ports[0].host}</span>
                            )}
                            {Number(svc.resources?.cpuLimit) > 0 && (
                              <span style={{ fontSize: 9, color: isLight ? '#0f4c81' : '#7dd3fc', background: isLight ? 'rgba(56,189,248,0.14)' : 'rgba(56,189,248,0.07)', border: '1px solid rgba(56,189,248,0.14)', borderRadius: 4, padding: '1px 5px' }}>
                                {svc.resources.cpuLimit} CPU
                              </span>
                            )}
                            {Number(svc.resources?.memoryMb) > 0 && (
                              <span style={{ fontSize: 9, color: isLight ? '#5b3db8' : '#c4b5fd', background: isLight ? 'rgba(167,139,250,0.14)' : 'rgba(167,139,250,0.07)', border: '1px solid rgba(167,139,250,0.14)', borderRadius: 4, padding: '1px 5px' }}>
                                {svc.resources.memoryMb}MB
                              </span>
                            )}
                            {Number(svc.scaling?.replicas) > 1 && (
                              <span style={{ fontSize: 9, color: isLight ? '#0f6b57' : '#6ee7b7', background: isLight ? 'rgba(52,211,153,0.14)' : 'rgba(52,211,153,0.07)', border: '1px solid rgba(52,211,153,0.14)', borderRadius: 4, padding: '1px 5px' }}>
                                ×{svc.scaling.replicas}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Output port (bottom-center) */}
                        <div
                          style={{
                            position: 'absolute', bottom: -PORT_R, left: '50%',
                            transform: 'translateX(-50%)',
                            width: PORT_R * 2, height: PORT_R * 2, borderRadius: '50%',
                            background: cfg.color, border: `2px solid ${cfg.color}`,
                            opacity: isHov ? 1 : 0,
                            cursor: 'crosshair', zIndex: 25,
                            transition: 'opacity 0.12s',
                            boxShadow: `0 0 8px ${cfg.color}90`
                          }}
                          onMouseDown={(e) => startWire(e, svc.id)}
                          title="Arraste para criar dependência"
                        />
                      </div>
                    )
                  })}

                  {/* Add-to-tier button */}
                  <button
                    onClick={() => onAddService(tier.key)}
                    style={{
                      width: 44, height: NODE_H, flexShrink: 0, borderRadius: 14,
                      border: `1.5px dashed ${cfg.color}45`,
                      background: `${cfg.color}06`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', color: `${cfg.color}70`, fontSize: 20,
                      transition: 'all 0.15s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = cfg.color
                      e.currentTarget.style.color = cfg.color
                      e.currentTarget.style.background = `${cfg.color}14`
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = `${cfg.color}45`
                      e.currentTarget.style.color = `${cfg.color}70`
                      e.currentTarget.style.background = `${cfg.color}06`
                    }}
                    title={`Adicionar ${laneCfg?.label || cfg.label}`}
                  >
                    +
                  </button>
                </div>
              </div>
            )
          })}

          {/* Footer bar */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderTop: isLight ? '1px solid var(--color-divider)' : '1px solid rgba(255,255,255,0.05)',
            padding: '8px 20px', background: isLight ? 'rgba(241,245,255,0.92)' : 'rgba(0,0,0,0.25)'
          }}>
            <p style={{ color: '#1e3a5f', fontSize: 9, margin: 0 }}>
              Hover num nó → arraste a porta inferior (●) para conectar · hover numa aresta para remover
            </p>
            <button
              onClick={() => onAddService(null)}
              style={{
                fontSize: 10, color: '#60a5fa',
                background: 'rgba(59,130,246,0.08)',
                border: '1px solid rgba(59,130,246,0.2)',
                borderRadius: 8, padding: '4px 14px', cursor: 'pointer'
              }}
            >
              + Adicionar Serviço
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Diagram Canvas — free-form cloud architecture diagram ────────────────────
//  Nodes are square icon cards, freely draggable anywhere.
//  Connections auto-route from the nearest port (top/right/bottom/left).
//  Positions persisted in localStorage per stack.

const DIAG_NODE = 124   // square node side
const DIAG_PR   = 6     // port radius

const GROUP_COLORS = ['#f97316', '#3b82f6', '#10b981', '#a855f7', '#f43f5e', '#06b6d4', '#eab308', '#ec4899']

const findLaneForGroup = (g) => {
  const byLabel = CANVAS_LANES.find((l) => l.label === g.label)
  if (byLabel) return byLabel
  const idMatch = g.id?.match?.(/^grp-auto-(.+)$/)
  if (idMatch) return CANVAS_LANES.find((l) => l.key === idMatch[1]) || null
  return null
}

const DiagramCanvas = ({
  stack, selectedServiceId,
  onServiceClick, onAddService,
  onConnectServices, onDisconnectEdge,
  onDeleteService, onBulkDeleteServices,
  tierConfigs, onGroupConfigClick
}) => {
  const { theme } = useTheme()
  const isLight = theme === 'light'
  const services = stack.services || []
  const wrapRef  = useRef(null)
  const posKey   = `diag-pos-${stack.id}`
  const grpKey   = `diag-grp-${stack.id}`

  // ── State ──────────────────────────────────────────────────────────────────
  const [pos,          setPos]          = useState(() => { try { return JSON.parse(localStorage.getItem(posKey) || '{}') } catch { return {} } })
  const [groups,       setGroups]       = useState(() => { try { return JSON.parse(localStorage.getItem(grpKey) || '[]') } catch { return [] } })
  const [scale,        setScale]        = useState(1)
  const [pan,          setPan]          = useState({ x: 140, y: 80 })
  const [dragging,     setDragging]     = useState(null)   // node drag: {id,ox,oy}
  const [panDrag,      setPanDrag]      = useState(null)   // canvas pan: {sx,sy,px,py}
  const [connecting,   setConnecting]   = useState(null)   // wire: {fromId,mx,my}
  const [connTarget,   setConnTarget]   = useState(null)
  const [hovNode,      setHovNode]      = useState(null)
  const [hovEdge,      setHovEdge]      = useState(null)
  const [groupDrag,    setGroupDrag]    = useState(null)   // {id,sx,sy,ox,oy}
  const [groupResize,  setGroupResize]  = useState(null)   // {id,sx,sy,ow,oh}
  const [drawingGroup, setDrawingGroup] = useState(null)   // {sx,sy,ex,ey} — shift+drag preview
  const [editingGrp,   setEditingGrp]   = useState(null)   // id being label-edited
  const [fullscreen,   setFullscreen]   = useState(false)
  const [ctxMenu,      setCtxMenu]      = useState(null)   // {x,y,type:'service'|'group'|'canvas',svcId?,grp?}
  const [freeIds,      setFreeIds]      = useState(() => { try { return new Set(JSON.parse(localStorage.getItem(`free-${stack.id}`) || '[]')) } catch { return new Set() } })

  // ── Persist ─────────────────────────────────────────────────────────────────
  useEffect(() => { localStorage.setItem(posKey, JSON.stringify(pos))    }, [pos,    posKey])
  useEffect(() => { localStorage.setItem(grpKey, JSON.stringify(groups)) }, [groups, grpKey])
  useEffect(() => { localStorage.setItem(`free-${stack.id}`, JSON.stringify([...freeIds])) }, [freeIds]) // eslint-disable-line

  // ── Close context menu on Escape or outside click ────────────────────────────
  useEffect(() => {
    if (!ctxMenu) return
    const close = (e) => { if (e.key === 'Escape' || e.type === 'mousedown') setCtxMenu(null) }
    document.addEventListener('keydown',   close)
    document.addEventListener('mousedown', close)
    return () => { document.removeEventListener('keydown', close); document.removeEventListener('mousedown', close) }
  }, [ctxMenu])

  // ── Auto-place missing services ───────────────────────────────────────────────
  // Uses setGroups functional updater so we always read the CURRENT groups state,
  // never a stale closure — this prevents duplicate groups from being created.
  useEffect(() => {
    const missing = services.filter((s) => !pos[s.id])
    if (!missing.length) return

    setGroups((currentGroups) => {
      const PAD = 36, SVC_SLOT = DIAG_NODE + 28
      const newPos = { ...pos }
      const addedGroups = []

      missing.forEach((svc) => {
        const role = inferServiceCanvasRole(svc)
        // Look in currently-known groups (currentGroups = fresh state, not closure)
        const allGroups = [...currentGroups, ...addedGroups]
        let matchGrp = allGroups.find((g) => findLaneForGroup(g)?.key === role)

        // Create the group for this role if none exists yet
        if (!matchGrp) {
          const lane  = CANVAS_LANES.find((l) => l.key === role)
          const laneI = Math.max(0, CANVAS_LANES.findIndex((l) => l.key === role))
          const label = lane?.label || role
          const color = GROUP_COLORS[laneI % GROUP_COLORS.length]
          const grpW  = Math.max(380, SVC_SLOT + PAD * 2)
          const grpH  = DIAG_NODE + PAD * 2 + 28
          matchGrp = {
            id: `grp-auto-${role}`,   // stable id — no Date.now() to prevent duplicates
            label, color, collapsed: false,
            x: 40, y: 40 + laneI * (grpH + 40), w: grpW, h: grpH
          }
          addedGroups.push(matchGrp)
        }

        // Count services already placed in this group's area
        const placed = Object.values(newPos).filter((p) =>
          p.x >= matchGrp.x && p.x < matchGrp.x + matchGrp.w &&
          p.y >= matchGrp.y && p.y < matchGrp.y + matchGrp.h
        ).length
        newPos[svc.id] = { x: matchGrp.x + PAD + placed * SVC_SLOT, y: matchGrp.y + 28 + PAD }

        // Expand group width if needed
        const needed = PAD + (placed + 1) * SVC_SLOT + PAD
        if (needed > matchGrp.w) matchGrp.w = needed
      })

      // Commit pos changes separately
      setPos(newPos)

      // Merge new groups (use stable id so duplicates are deduplicated by id)
      if (!addedGroups.length) return currentGroups
      const existingIds = new Set(currentGroups.map((g) => g.id))
      return [...currentGroups, ...addedGroups.filter((g) => !existingIds.has(g.id))]
    })
  }, [services]) // eslint-disable-line

  // ── Auto-create groups by role when canvas has services but no groups ────────
  const autoGroupedRef = useRef(null) // tracks stack.id for which we auto-grouped
  useEffect(() => {
    if (autoGroupedRef.current === stack.id) return
    if (!services.length || groups.length) return
    autoGroupedRef.current = stack.id
    generateAutoGroups()
  }, [services]) // eslint-disable-line

  // ── Auto-fit groups when services are added/removed (NOT on every pos change) ─
  // Keeping pos out of deps prevents this from firing on every drag mousemove,
  // which was causing ghost group renders during group drag.
  useEffect(() => {
    if (!services.length) return
    setGroups((prev) => {
      const currentPos = pos  // captured from closure at effect-run time (stable enough for sizing)
      const PAD = 24
      return prev.map((grp) => {
        const grpRole = findLaneForGroup(grp)?.key
        if (!grpRole) return grp
        const grpSvcs = services.filter((svc) => inferServiceCanvasRole(svc) === grpRole)
        if (!grpSvcs.length) return grp
        let needW = grp.w, needH = grp.h
        grpSvcs.forEach((svc) => {
          const p = currentPos[svc.id]
          if (!p) return
          const rx = (p.x - grp.x) + DIAG_NODE + PAD
          const ry = (p.y - grp.y) + DIAG_NODE + PAD
          if (rx > needW) needW = rx
          if (ry > needH) needH = ry
        })
        return (needW !== grp.w || needH !== grp.h) ? { ...grp, w: needW, h: needH } : grp
      })
    })
  }, [services]) // eslint-disable-line — intentionally omit pos to avoid drag-time re-renders

  // ── Wheel zoom (smooth, cursor-centred) ──────────────────────────────────────
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      const r      = el.getBoundingClientRect()
      const mx     = e.clientX - r.left
      const my     = e.clientY - r.top
      const factor = Math.exp(-e.deltaY / 500)
      setScale((s) => {
        const n = Math.min(3, Math.max(0.2, s * factor))
        setPan((p) => ({ x: mx - (mx - p.x) * (n / s), y: my - (my - p.y) * (n / s) }))
        return n
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ── Global mouse move / up ────────────────────────────────────────────────────
  useEffect(() => {
    if (!dragging && !connecting && !panDrag && !groupDrag && !groupResize && !drawingGroup) return
    const onMove = (e) => {
      if (panDrag) setPan({ x: panDrag.px + e.clientX - panDrag.sx, y: panDrag.py + e.clientY - panDrag.sy })
      if (dragging) {
        const r = wrapRef.current?.getBoundingClientRect()
        if (!r) return
        const cx = (e.clientX - r.left - pan.x) / scale
        const cy = (e.clientY - r.top  - pan.y) / scale
        let nx = cx - dragging.ox
        let ny = cy - dragging.oy
        // Clamp inside owning group so service cannot escape its borders
        if (dragging.grpId) {
          const grp = groups.find((g) => g.id === dragging.grpId)
          if (grp) {
            const PAD = 6, HEADER_H = 28
            nx = Math.max(grp.x + PAD, Math.min(grp.x + grp.w - DIAG_NODE - PAD, nx))
            ny = Math.max(grp.y + HEADER_H + PAD, Math.min(grp.y + grp.h - DIAG_NODE - PAD, ny))
          }
        }
        setPos((prev) => ({ ...prev, [dragging.id]: { x: nx, y: ny } }))
      }
      if (connecting) {
        const r = wrapRef.current?.getBoundingClientRect()
        if (r) setConnecting((c) => ({ ...c, mx: e.clientX - r.left, my: e.clientY - r.top }))
      }
      if (groupDrag) {
        const dx = (e.clientX - groupDrag.sx) / scale
        const dy = (e.clientY - groupDrag.sy) / scale
        setGroups((prev) => prev.map((g) => g.id === groupDrag.id ? { ...g, x: groupDrag.ox + dx, y: groupDrag.oy + dy } : g))
        // Move grouped services with the group
        if (groupDrag.svcSnap && Object.keys(groupDrag.svcSnap).length) {
          setPos((prev) => {
            const next = { ...prev }
            Object.entries(groupDrag.svcSnap).forEach(([id, snap]) => { next[id] = { x: snap.x + dx, y: snap.y + dy } })
            return next
          })
        }
      }
      if (groupResize) {
        const dx = (e.clientX - groupResize.sx) / scale
        const dy = (e.clientY - groupResize.sy) / scale
        setGroups((prev) => prev.map((g) => {
          if (g.id !== groupResize.id) return g
          // Compute minimum size so no child service is clipped
          const PAD = 6, HEADER_H = 28
          const grpRole = findLaneForGroup(g)?.key
          const children = grpRole
            ? services.filter((s) => inferServiceCanvasRole(s) === grpRole && !freeIds.has(s.id))
            : []
          let minW = 120, minH = HEADER_H + DIAG_NODE + PAD * 2
          children.forEach((svc) => {
            const p = pos[svc.id]
            if (!p) return
            // Right edge of this node relative to group origin + padding
            const neededW = (p.x - g.x) + DIAG_NODE + PAD
            const neededH = (p.y - g.y) + DIAG_NODE + PAD
            if (neededW > minW) minW = neededW
            if (neededH > minH) minH = neededH
          })
          return { ...g, w: Math.max(minW, groupResize.ow + dx), h: Math.max(minH, groupResize.oh + dy) }
        }))
      }
      if (drawingGroup) {
        const r = wrapRef.current?.getBoundingClientRect()
        if (!r) return
        const ex = (e.clientX - r.left - pan.x) / scale
        const ey = (e.clientY - r.top  - pan.y) / scale
        setDrawingGroup((dg) => ({ ...dg, ex, ey }))
      }
    }
    const onUp = (e) => {
      if (connecting && connTarget) {
        const fromIsGroup   = groups.some((g) => g.id === connecting.fromId)
        const targetIsGroup = groups.some((g) => g.id === connTarget)

        if (fromIsGroup) {
          // group → group  OR  group → service: store locally in source group.dependencies
          setGroups((prev) => prev.map((g) =>
            g.id === connecting.fromId && !(g.dependencies || []).includes(connTarget)
              ? { ...g, dependencies: [...(g.dependencies || []), connTarget] }
              : g
          ))
        } else if (targetIsGroup) {
          // service → group: ignored (semantically ambiguous — user should connect group→group)
        } else {
          // service → service
          onConnectServices?.(connecting.fromId, connTarget)
        }
      }
      if (drawingGroup) {
        const { sx, sy, ex, ey } = drawingGroup
        const x = Math.min(sx, ex), y = Math.min(sy, ey)
        const w = Math.abs(ex - sx),  h = Math.abs(ey - sy)
        if (w > 40 && h > 40) addGroup(x, y, w, h)
      }
      setDragging(null); setPanDrag(null); setConnecting(null); setConnTarget(null)
      setGroupDrag(null); setGroupResize(null); setDrawingGroup(null)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup',   onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, [dragging, connecting, panDrag, connTarget, groupDrag, groupResize, drawingGroup, pan, scale, onConnectServices]) // eslint-disable-line

  // ── Helpers ───────────────────────────────────────────────────────────────────
  const toCanvas = (cx, cy) => {
    const r = wrapRef.current?.getBoundingClientRect()
    if (!r) return { x: 0, y: 0 }
    return { x: (cx - r.left - pan.x) / scale, y: (cy - r.top - pan.y) / scale }
  }

  const addGroup = (x, y, w, h) => {
    const color = GROUP_COLORS[groups.length % GROUP_COLORS.length]
    setGroups((prev) => [...prev, { id: `grp-${Date.now()}`, label: 'Grupo', x, y, w: w || 280, h: h || 200, color }])
  }

  const addGroupCenter = () => {
    const el = wrapRef.current
    const cx = el ? (el.clientWidth  / 2 - pan.x) / scale : 200
    const cy = el ? (el.clientHeight / 2 - pan.y) / scale : 120
    addGroup(cx - 140, cy - 100, 280, 200)
  }

  const updateGroup = (id, patch) => setGroups((prev) => prev.map((g) => g.id === id ? { ...g, ...patch } : g))
  const deleteGroup = (grp) => {
    const grpRole = findLaneForGroup(grp)?.key
    const grpSvcs = grpRole ? services.filter((svc) => inferServiceCanvasRole(svc) === grpRole) : []
    const msg = grpSvcs.length
      ? `Remover grupo "${grp.label}" e seus ${grpSvcs.length} serviço(s)?`
      : `Remover grupo "${grp.label}"?`
    if (!confirm(msg)) return
    if (grpSvcs.length) {
      onBulkDeleteServices?.(grpSvcs.map((s) => s.id))
    }
    setGroups((prev) => prev.filter((g) => g.id !== grp.id))
  }

  const generateAutoGroups = () => {
    if (!services.length) return
    const PAD = 36, SVC_SLOT = DIAG_NODE + 28   // 36px padding, 152px per slot
    const roleMap = {}
    services.forEach((svc) => { const r = inferServiceCanvasRole(svc); if (!roleMap[r]) roleMap[r] = []; roleMap[r].push(svc) })
    const roleOrder = CANVAS_LANES.map((l) => l.key).filter((k) => roleMap[k])
    const newGroups = roleOrder.map((role, i) => {
      const svcs  = roleMap[role]
      const label = CANVAS_LANES.find((l) => l.key === role)?.label || role
      const color = GROUP_COLORS[i % GROUP_COLORS.length]
      const x = 40
      const grpH = DIAG_NODE + PAD * 2 + 28   // header offset + node + padding
      const y = 40 + i * (grpH + 40)
      const w = Math.max(380, svcs.length * SVC_SLOT + PAD * 2)
      const h = grpH
      return { id: `grp-auto-${role}`, label, x, y, w, h, color, collapsed: false }
    })
    setGroups(newGroups)
    const newPos = {}
    roleOrder.forEach((role, gi) => {
      const grp = newGroups[gi]
      roleMap[role].forEach((svc, si) => { newPos[svc.id] = { x: grp.x + PAD + si * SVC_SLOT, y: grp.y + 28 + PAD } })
    })
    setPos(newPos)
  }

  const autoLayout = () => {
    const byLane = {}
    services.forEach((s) => { const r = inferServiceCanvasRole(s); if (!byLane[r]) byLane[r] = []; byLane[r].push(s) })
    const active = CANVAS_LANES.filter((l) => byLane[l.key]?.length)
    const next   = {}
    active.forEach((lane, li) => { ;(byLane[lane.key] || []).forEach((s, ri) => { next[s.id] = { x: 60 + li * 200, y: 60 + ri * 180 } }) })
    setPos(next)
  }

  const fitView = () => {
    if (!services.length) return
    const xs = services.map((s) => pos[s.id]?.x || 0)
    const ys = services.map((s) => pos[s.id]?.y || 0)
    const r  = wrapRef.current?.getBoundingClientRect()
    if (!r) return
    const s = Math.min(2, Math.max(0.2, Math.min((r.width - 80) / (Math.max(...xs) + DIAG_NODE - Math.min(...xs) || 1), (r.height - 80) / (Math.max(...ys) + DIAG_NODE - Math.min(...ys) || 1))))
    setScale(s)
    setPan({ x: 40 - Math.min(...xs) * s, y: 40 - Math.min(...ys) * s })
  }

  // ── Edge calculation ──────────────────────────────────────────────────────────
  const edges = useMemo(() => {
    const result = []
    for (const svc of services) {
      const from = pos[svc.id]
      if (!from) continue
      for (const depId of svc.dependencies || []) {
        const to = pos[depId]
        if (!to) continue
        const fcx = from.x + DIAG_NODE / 2, fcy = from.y + DIAG_NODE / 2
        const tcx = to.x   + DIAG_NODE / 2, tcy = to.y   + DIAG_NODE / 2
        const dx = tcx - fcx, dy = tcy - fcy
        let sx, sy, tx, ty, cpx1, cpy1, cpx2, cpy2
        if (Math.abs(dx) >= Math.abs(dy)) {
          if (dx >= 0) { sx = from.x + DIAG_NODE; sy = fcy; tx = to.x; ty = tcy }
          else          { sx = from.x;             sy = fcy; tx = to.x + DIAG_NODE; ty = tcy }
          const m = (sx + tx) / 2; cpx1 = m; cpy1 = sy; cpx2 = m; cpy2 = ty
        } else {
          if (dy >= 0) { sx = fcx; sy = from.y + DIAG_NODE; tx = tcx; ty = to.y }
          else          { sx = fcx; sy = from.y;             tx = tcx; ty = to.y + DIAG_NODE }
          const m = (sy + ty) / 2; cpx1 = sx; cpy1 = m; cpx2 = tx; cpy2 = m
        }
        result.push({ id: `${svc.id}->${depId}`, fromId: svc.id, toId: depId, fromRole: inferServiceCanvasRole(svc), path: `M ${sx} ${sy} C ${cpx1} ${cpy1}, ${cpx2} ${cpy2}, ${tx} ${ty}`, midX: (sx + tx) / 2, midY: (sy + ty) / 2 })
      }
    }
    // Group-to-group or group-to-node edges (stored in group.dependencies)
    for (const grp of groups) {
      for (const depId of grp.dependencies || []) {
        // depId can be a group id or service id
        const toGrp = groups.find((g) => g.id === depId)
        const toSvc = services.find((s) => s.id === depId)
        const toPos = toGrp
          ? { cx: toGrp.x + toGrp.w / 2, cy: toGrp.y }
          : toSvc && pos[toSvc.id] ? { cx: pos[toSvc.id].x + DIAG_NODE / 2, cy: pos[toSvc.id].y } : null
        if (!toPos) continue
        const sx = grp.x + grp.w / 2, sy = grp.y + grp.h
        const tx = toPos.cx, ty = toPos.cy
        const m  = (sy + ty) / 2
        result.push({ id: `grp-${grp.id}->${depId}`, fromId: grp.id, toId: depId, fromRole: 'runtime', path: `M ${sx} ${sy} C ${sx} ${m}, ${tx} ${m}, ${tx} ${ty}`, midX: (sx + tx) / 2, midY: m, isGroupEdge: true })
      }
    }
    return result
  }, [services, pos, groups])

  // ── Wire path (screen-space) ──────────────────────────────────────────────────
  const wirePath = useMemo(() => {
    if (!connecting) return null
    // group origin: wire starts from bottom-center of the group
    const grpFrom = groups.find((g) => g.id === connecting.fromId)
    const x1 = grpFrom
      ? (grpFrom.x + grpFrom.w / 2) * scale + pan.x
      : ((pos[connecting.fromId]?.x || 0) + DIAG_NODE / 2) * scale + pan.x
    const y1 = grpFrom
      ? (grpFrom.y + grpFrom.h) * scale + pan.y
      : ((pos[connecting.fromId]?.y || 0) + DIAG_NODE) * scale + pan.y
    const x2 = connecting.mx, y2 = connecting.my
    const m  = (y1 + y2) / 2
    return `M ${x1} ${y1} C ${x1} ${m}, ${x2} ${m}, ${x2} ${y2}`
  }, [connecting, pos, groups, scale, pan])

  // ── Role → group map (for DOM containment rendering) ─────────────────────────
  const roleToGrp = useMemo(() => {
    const map = {}
    groups.forEach((g) => {
      const lane = findLaneForGroup(g)
      if (lane && !map[lane.key]) { map[lane.key] = g; return }
      // Fallback: match by group id pattern (grp-auto-ROLE)
      const idMatch = g.id?.match?.(/^grp-auto-(.+)$/)
      if (idMatch && !map[idMatch[1]]) map[idMatch[1]] = g
    })
    return map
  }, [groups])

  const cW = Math.max(2400, ...services.map((s) => (pos[s.id]?.x || 0) + DIAG_NODE + 240), ...groups.map((g) => g.x + g.w + 80))
  const cH = Math.max(1400, ...services.map((s) => (pos[s.id]?.y || 0) + DIAG_NODE + 240), ...groups.map((g) => g.y + g.h + 80))

  // ── Context menu helpers ──────────────────────────────────────────────────────
  const openCtx = (e, type, extra = {}) => {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ x: e.clientX, y: e.clientY, type, ...extra })
  }

  const ctxLeaveGroup = (svcId) => {
    setFreeIds((prev) => { const n = new Set(prev); n.add(svcId); return n })
    setCtxMenu(null)
  }
  const ctxJoinGroup = (svcId) => {
    setFreeIds((prev) => { const n = new Set(prev); n.delete(svcId); return n })
    setCtxMenu(null)
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  const wrapStyle = fullscreen
    ? { position: 'fixed', inset: 0, zIndex: 50, borderRadius: 0, border: 'none', background: isLight ? 'var(--color-canvas)' : '#04080f', overflow: 'hidden', cursor: panDrag ? 'grabbing' : drawingGroup ? 'crosshair' : 'default', userSelect: 'none' }
    : { position: 'relative', borderRadius: 20, border: isLight ? '1px solid var(--color-canvas-border)' : '1px solid rgba(255,255,255,0.08)', background: isLight ? 'var(--color-canvas)' : '#04080f', overflow: 'hidden', height: 'calc(100vh - 220px)', minHeight: 500, cursor: panDrag ? 'grabbing' : drawingGroup ? 'crosshair' : 'default', userSelect: 'none', boxShadow: isLight ? 'var(--shadow-sm)' : 'none' }

  return (
    <div
      ref={wrapRef}
      style={wrapStyle}
      onMouseDown={(e) => {
        if (e.button !== 0) return
        setCtxMenu(null)
        if (e.shiftKey) {
          const cp = toCanvas(e.clientX, e.clientY)
          setDrawingGroup({ sx: cp.x, sy: cp.y, ex: cp.x, ey: cp.y })
        } else {
          setPanDrag({ sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y })
        }
      }}
      onContextMenu={(e) => {
        if (e.target === e.currentTarget || e.target.dataset.bg) openCtx(e, 'canvas')
      }}
      onDoubleClick={(e) => { if (e.target === e.currentTarget || e.target.dataset.bg) onAddService(null) }}
    >
      {/* ── Toolbar ── */}
      <div style={{ position: 'absolute', left: 12, top: 12, zIndex: 30, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={autoLayout} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: isLight ? 'var(--color-text)' : '#cbd5e1', background: isLight ? 'rgba(255,255,255,0.92)' : 'rgba(10,18,36,0.92)', border: isLight ? '1px solid var(--color-border)' : '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '5px 10px', cursor: 'pointer', backdropFilter: 'blur(8px)', boxShadow: isLight ? 'var(--shadow-xs)' : 'none' }}>
          <Zap size={10} style={{ color: '#fbbf24' }} /> Auto-layout
        </button>
        <button onClick={fitView} style={{ fontSize: 10, color: isLight ? 'var(--color-text-soft)' : '#94a3b8', background: isLight ? 'rgba(255,255,255,0.92)' : 'rgba(10,18,36,0.92)', border: isLight ? '1px solid var(--color-border)' : '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '5px 10px', cursor: 'pointer', backdropFilter: 'blur(8px)', boxShadow: isLight ? 'var(--shadow-xs)' : 'none' }}>Fit</button>
        <button onClick={addGroupCenter} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#c4b5fd', background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.4)', borderRadius: 10, padding: '5px 10px', cursor: 'pointer', backdropFilter: 'blur(8px)', fontWeight: 600 }}>
          <Layers size={10} /> + Grupo
        </button>
        <button onClick={generateAutoGroups} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: isLight ? '#0f766e' : '#6ee7b7', background: isLight ? 'rgba(16,185,129,0.12)' : 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 10, padding: '5px 10px', cursor: 'pointer', backdropFilter: 'blur(8px)' }}>
          <RefreshCw size={9} /> Camadas
        </button>
        <div style={{ display: 'flex', background: isLight ? 'rgba(255,255,255,0.92)' : 'rgba(10,18,36,0.92)', border: isLight ? '1px solid var(--color-border)' : '1px solid rgba(255,255,255,0.1)', borderRadius: 10, overflow: 'hidden', backdropFilter: 'blur(8px)', boxShadow: isLight ? 'var(--shadow-xs)' : 'none' }}>
          <button onClick={() => setScale((s) => Math.min(3, +(s + 0.1).toFixed(1)))} style={{ padding: '3px 9px', color: isLight ? 'var(--color-text-soft)' : '#94a3b8', cursor: 'pointer', fontSize: 15, border: 'none', background: 'none' }}>+</button>
          <span style={{ padding: '3px 2px', color: isLight ? 'var(--color-text-soft)' : '#475569', fontSize: 10, minWidth: 36, textAlign: 'center', lineHeight: '22px' }}>{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale((s) => Math.max(0.2, +(s - 0.1).toFixed(1)))} style={{ padding: '3px 9px', color: isLight ? 'var(--color-text-soft)' : '#94a3b8', cursor: 'pointer', fontSize: 15, border: 'none', background: 'none' }}>−</button>
        </div>
      </div>
      <div style={{ position: 'absolute', right: 12, top: 12, zIndex: 30, display: 'flex', gap: 6, alignItems: 'center' }}>
        <button onClick={() => onAddService(null)} style={{ fontSize: 10, color: '#93c5fd', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: 10, padding: '5px 14px', cursor: 'pointer', backdropFilter: 'blur(8px)' }}>+ Adicionar Serviço</button>
        <button onClick={() => setFullscreen((f) => !f)} title={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 10, background: isLight ? 'rgba(255,255,255,0.92)' : 'rgba(10,18,36,0.92)', border: isLight ? '1px solid var(--color-border)' : '1px solid rgba(255,255,255,0.12)', cursor: 'pointer', color: isLight ? 'var(--color-text-soft)' : '#94a3b8', backdropFilter: 'blur(8px)', boxShadow: isLight ? 'var(--shadow-xs)' : 'none' }}>
          {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
      </div>

      {/* ── Wire overlay (screen-space) ── */}
      {wirePath && (
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 25, overflow: 'visible' }}>
          <path d={wirePath} stroke="#3b82f6" strokeWidth="1.5" fill="none" strokeDasharray="7 4" opacity="0.9" />
          {connecting && <circle cx={connecting.mx} cy={connecting.my} r="4" fill="#3b82f6" opacity="0.75" />}
        </svg>
      )}

      {/* ── Canvas transform root ── */}
      <div
        data-bg="1"
        style={{ position: 'absolute', transform: `translate(${pan.x}px,${pan.y}px) scale(${scale})`, transformOrigin: '0 0', width: cW, height: cH, backgroundImage: isLight ? 'radial-gradient(circle, rgba(148,163,184,0.18) 1px, transparent 1px)' : 'radial-gradient(circle, rgba(148,163,184,0.11) 1px, transparent 1px)', backgroundSize: '32px 32px' }}
      >
        {/* ── Groups + their services (groups have no z-index so children use canvas stacking context) ── */}
        {groups.map((grp) => {
          const grpRole    = findLaneForGroup(grp)?.key
          const grpServices = grpRole ? services.filter((svc) => inferServiceCanvasRole(svc) === grpRole && !freeIds.has(svc.id)) : []
          const isCollapsed = !!grp.collapsed
          // When collapsed, show only the header pill (28px tall)
          const dispH = isCollapsed ? 0 : grp.h
          return (
            <div key={grp.id} style={{ position: 'absolute', left: grp.x, top: grp.y, width: grp.w, height: dispH, overflow: 'visible' }}>
              {/* Body */}
              {!isCollapsed && <div style={{ position: 'absolute', inset: 0, border: `1.5px solid ${grp.color}40`, borderRadius: 13, background: isLight ? 'rgba(255,255,255,0.94)' : `${grp.color}09` }} />}

              {/* Header */}
              <div
                onMouseDown={(e) => {
                  e.stopPropagation()
                  const svcSnap = {}
                  grpServices.forEach((svc) => { if (pos[svc.id]) svcSnap[svc.id] = { ...pos[svc.id] } })
                  setGroupDrag({ id: grp.id, sx: e.clientX, sy: e.clientY, ox: grp.x, oy: grp.y, svcSnap })
                }}
                onContextMenu={(e) => openCtx(e, 'group', { grp })}
                style={{ position: 'absolute', top: -1, left: 0, right: 0, display: 'flex', alignItems: 'center', gap: 6, background: grp.color, borderRadius: isCollapsed ? 8 : '12px 12px 0 0', padding: '6px 10px 6px 12px', cursor: 'move', boxShadow: `0 2px 10px ${grp.color}55`, zIndex: 3, userSelect: 'none' }}
              >
                {/* Collapse toggle */}
                <button
                  onClick={(e) => { e.stopPropagation(); updateGroup(grp.id, { collapsed: !isCollapsed }) }}
                  style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.85)', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', lineHeight: 1 }}
                  title={isCollapsed ? 'Expandir grupo' : 'Recolher grupo'}
                >
                  <ChevronLeft size={12} style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(90deg)', transition: 'transform 0.15s' }} />
                </button>
                {editingGrp === grp.id ? (
                  <input autoFocus value={grp.label} onChange={(e) => updateGroup(grp.id, { label: e.target.value })} onBlur={() => setEditingGrp(null)} onKeyDown={(e) => e.key === 'Enter' && setEditingGrp(null)} onClick={(e) => e.stopPropagation()} style={{ background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontSize: 11, fontWeight: 700, flex: 1, minWidth: 0 }} />
                ) : (
                  <span onDoubleClick={(e) => { e.stopPropagation(); setEditingGrp(grp.id) }} style={{ color: '#fff', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', flex: 1 }}>{grp.label}</span>
                )}
                {grpServices.length > 0 && <span style={{ color: isLight ? 'var(--color-text)' : 'rgba(255,255,255,0.6)', fontSize: 9, background: isLight ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.2)', borderRadius: 4, padding: '1px 5px' }}>{grpServices.length}</span>}
                <div onClick={(e) => { e.stopPropagation(); const i = GROUP_COLORS.indexOf(grp.color); updateGroup(grp.id, { color: GROUP_COLORS[(i + 1) % GROUP_COLORS.length] }) }} style={{ width: 9, height: 9, borderRadius: '50%', background: 'rgba(255,255,255,0.45)', cursor: 'pointer', flexShrink: 0 }} title="Trocar cor" />
                {grpRole && onGroupConfigClick && (
                  <button onClick={(e) => { e.stopPropagation(); onGroupConfigClick(grpRole, grp.label) }} style={{ color: 'rgba(255,255,255,0.65)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1, display: 'flex', alignItems: 'center' }} title="Configurações do grupo">
                    <Settings size={10} />
                  </button>
                )}
                {tierConfigs?.[grpRole]?.domain && (
                  <span style={{ fontSize: 8, color: isLight ? 'var(--color-text)' : 'rgba(255,255,255,0.75)', background: isLight ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.25)', borderRadius: 3, padding: '1px 4px', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tierConfigs[grpRole].domain}</span>
                )}
                <button onClick={(e) => { e.stopPropagation(); deleteGroup(grp) }} style={{ color: 'rgba(255,255,255,0.65)', fontSize: 14, background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1, display: 'flex', alignItems: 'center' }} title="Remover grupo"><X size={11} /></button>
              </div>

              {/* Resize handle — only when expanded */}
              {!isCollapsed && <div onMouseDown={(e) => { e.stopPropagation(); setGroupResize({ id: grp.id, sx: e.clientX, sy: e.clientY, ow: grp.w, oh: grp.h }) }} style={{ position: 'absolute', right: -4, bottom: -4, width: 14, height: 14, borderRadius: 4, background: grp.color, cursor: 'nwse-resize', opacity: 0.75, zIndex: 3 }} title="Redimensionar" />}

              {/* Group output port — bottom center */}
              {!isCollapsed && <div onMouseDown={(e) => { e.stopPropagation(); const r = wrapRef.current?.getBoundingClientRect(); if (r) setConnecting({ fromId: grp.id, mx: e.clientX - r.left, my: e.clientY - r.top }) }} style={{ position: 'absolute', bottom: -DIAG_PR, left: '50%', transform: 'translateX(-50%)', width: DIAG_PR * 2, height: DIAG_PR * 2, borderRadius: '50%', background: grp.color, border: `2px solid ${grp.color}`, cursor: 'crosshair', opacity: 0.7, boxShadow: `0 0 8px ${grp.color}`, zIndex: 3 }} title="Arraste para conectar grupos" />}

              {/* Group input port — top center, visible when a wire is being drawn */}
              {connecting && connecting.fromId !== grp.id && (
                <div
                  onMouseEnter={() => setConnTarget(grp.id)}
                  onMouseLeave={() => setConnTarget(null)}
                  onMouseUp={(e) => {
                    e.stopPropagation()
                    if (connecting && connecting.fromId !== grp.id) {
                      const fromIsGroup = groups.some((g) => g.id === connecting.fromId)
                      if (fromIsGroup) {
                        setGroups((prev) => prev.map((g) =>
                          g.id === connecting.fromId && !(g.dependencies || []).includes(grp.id)
                            ? { ...g, dependencies: [...(g.dependencies || []), grp.id] }
                            : g
                        ))
                      }
                      setConnecting(null)
                      setConnTarget(null)
                    }
                  }}
                  style={{
                    position: 'absolute', top: -DIAG_PR, left: '50%', transform: 'translateX(-50%)',
                    width: DIAG_PR * 2, height: DIAG_PR * 2, borderRadius: '50%',
                    background: connTarget === grp.id ? grp.color : '#060f1e',
                    border: `2px solid ${grp.color}`,
                    cursor: 'crosshair', zIndex: 5,
                    boxShadow: connTarget === grp.id ? `0 0 14px ${grp.color}` : 'none',
                    transition: 'all 0.15s'
                  }}
                  title="Soltar aqui para conectar ao grupo"
                />
              )}

              {/* ── Services that belong to this group (hidden when collapsed) ── */}
              {!isCollapsed && grpServices.map((svc) => {
                const p = pos[svc.id]
                if (!p) return null
                const role  = inferServiceCanvasRole(svc)
                const cfg   = SERVICE_ROLES[role] || SERVICE_ROLES.runtime
                const stCfg = SERVICE_STATUS[svc.status] || SERVICE_STATUS.pending
                const Icon  = cfg.icon
                const isSel = svc.id === selectedServiceId
                const isHov = svc.id === hovNode
                const isTgt = svc.id === connTarget
                // Position relative to group origin, so service moves with group
                const lx = p.x - grp.x, ly = p.y - grp.y
                const inputPortStyle = { position: 'absolute', width: DIAG_PR * 2, height: DIAG_PR * 2, borderRadius: '50%', background: isTgt ? cfg.color : '#060f1e', border: `2px solid ${isTgt ? cfg.color : 'rgba(255,255,255,0.18)'}`, opacity: (isHov || !!connecting) ? 1 : 0, cursor: 'crosshair', boxShadow: isTgt ? `0 0 12px ${cfg.color}` : 'none', transition: 'all 0.12s', zIndex: 4 }
                const inputHandlers = {
                  onMouseEnter: () => connecting && connecting.fromId !== svc.id && setConnTarget(svc.id),
                  onMouseLeave: () => setConnTarget(null),
                  onMouseUp: () => { if (connecting && connecting.fromId !== svc.id) { const fromIsGroup = groups.some((g) => g.id === connecting.fromId); if (fromIsGroup) { setGroups((prev) => prev.map((g) => g.id === connecting.fromId && !(g.dependencies||[]).includes(svc.id) ? { ...g, dependencies: [...(g.dependencies||[]), svc.id] } : g)) } else { onConnectServices?.(connecting.fromId, svc.id) } setConnecting(null); setConnTarget(null) } }
                }
                const outputPortStyle = { position: 'absolute', width: DIAG_PR * 2, height: DIAG_PR * 2, borderRadius: '50%', background: cfg.color, border: `2px solid ${cfg.color}`, opacity: isHov ? 1 : 0, cursor: 'crosshair', boxShadow: `0 0 8px ${cfg.color}90`, transition: 'opacity 0.12s', zIndex: 4 }
                const startWire = (e) => { e.stopPropagation(); const r = wrapRef.current?.getBoundingClientRect(); if (r) setConnecting({ fromId: svc.id, mx: e.clientX - r.left, my: e.clientY - r.top }) }
                return (
                  <div key={svc.id} style={{ position: 'absolute', left: lx, top: ly, width: DIAG_NODE, overflow: 'visible', zIndex: isSel ? 5 : 2 }}
                    onMouseEnter={() => { setHovNode(svc.id); if (connecting && connecting.fromId !== svc.id) setConnTarget(svc.id) }}
                    onMouseLeave={() => { setHovNode(null); setConnTarget(null) }}
                    onContextMenu={(e) => openCtx(e, 'service', { svcId: svc.id, inGroup: true, grpRole })}
                  >
                    <div style={{ ...inputPortStyle, top: -DIAG_PR, left: '50%', transform: 'translateX(-50%)' }} {...inputHandlers} />
                    <div style={{ ...inputPortStyle, left: -DIAG_PR, top: '50%', transform: 'translateY(-50%)' }} {...inputHandlers} />
                    <div onMouseDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); const cp = toCanvas(e.clientX, e.clientY); setDragging({ id: svc.id, ox: cp.x - p.x, oy: cp.y - p.y, grpId: grp.id }); onServiceClick(svc) }}
                      style={{ width: DIAG_NODE, height: DIAG_NODE, borderRadius: 18, overflow: 'hidden', background: isLight ? (isSel ? `linear-gradient(145deg, ${cfg.color}14, rgba(255,255,255,0.98))` : 'linear-gradient(145deg, rgba(255,255,255,0.98), rgba(241,246,255,0.98))') : (isSel ? `linear-gradient(145deg, ${cfg.color}18, rgba(6,12,28,0.98))` : 'linear-gradient(145deg, rgba(9,18,40,0.98), rgba(4,8,20,0.99))'), border: `1px solid ${isSel || isTgt ? cfg.color : (isLight ? 'rgba(148,163,184,0.35)' : 'rgba(255,255,255,0.09)')}`, boxShadow: isLight ? (isSel ? `0 0 0 1.5px ${cfg.color}22, 0 14px 28px rgba(15, 23, 42, 0.08)` : isHov ? '0 10px 22px rgba(15, 23, 42, 0.1)' : '0 4px 12px rgba(15, 23, 42, 0.06)') : (isSel ? `0 0 0 1.5px ${cfg.color}55, 0 12px 36px rgba(0,0,0,0.65)` : isHov ? '0 8px 28px rgba(0,0,0,0.55)' : '0 4px 14px rgba(0,0,0,0.45)'), cursor: dragging?.id === svc.id ? 'grabbing' : 'grab', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '10px 8px', transition: dragging?.id === svc.id ? 'none' : 'box-shadow 0.15s, border-color 0.15s' }}>
                      <div style={{ width: 46, height: 46, borderRadius: 13, background: `${cfg.color}1c`, border: `1px solid ${cfg.color}38`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon size={22} style={{ color: cfg.color }} /></div>
                      <div style={{ textAlign: 'center', width: '100%', padding: '0 4px' }}>
                        <p style={{ color: isLight ? 'var(--color-text)' : '#f1f5f9', fontSize: 11, fontWeight: 700, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{svc.name}</p>
                        <p style={{ color: '#334155', fontSize: 9, margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'ui-monospace,monospace' }}>{svc.image}</p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ position: 'relative', display: 'flex', width: 7, height: 7 }}>
                          {svc.status === 'running' && <span className="animate-ping" style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: stCfg.color, opacity: 0.4 }} />}
                          <span style={{ position: 'relative', display: 'block', width: 7, height: 7, borderRadius: '50%', background: stCfg.color, boxShadow: `0 0 5px ${stCfg.glow}` }} />
                        </span>
                        <span style={{ color: '#334155', fontSize: 9 }}>{stCfg.label}</span>
                      </div>
                    </div>
                    {isHov && <button onClick={(e) => { e.stopPropagation(); onDeleteService?.(svc.id) }} style={{ position: 'absolute', top: 4, right: 4, width: 18, height: 18, borderRadius: 5, background: 'rgba(239,68,68,0.85)', border: 'none', color: '#fff', fontSize: 11, lineHeight: '18px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }} title="Remover serviço"><X size={10} /></button>}
                    <div style={{ ...outputPortStyle, right: -DIAG_PR, top: '50%', transform: 'translateY(-50%)' }} onMouseDown={startWire} />
                    <div style={{ ...outputPortStyle, bottom: -DIAG_PR, left: '50%', transform: 'translateX(-50%)' }} onMouseDown={startWire} />
                  </div>
                )
              })}
            </div>
          )
        })}

        {/* Group being drawn (shift+drag preview) */}
        {drawingGroup && (() => {
          const x = Math.min(drawingGroup.sx, drawingGroup.ex)
          const y = Math.min(drawingGroup.sy, drawingGroup.ey)
          const w = Math.abs(drawingGroup.ex - drawingGroup.sx)
          const h = Math.abs(drawingGroup.ey - drawingGroup.sy)
          return <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, border: '1.5px dashed rgba(255,255,255,0.35)', borderRadius: 12, background: 'rgba(255,255,255,0.03)', pointerEvents: 'none' }} />
        })()}

        {/* ── Edges SVG (z-index:1 — above group bodies, below service nodes z-index:2) ── */}
        <svg style={{ position: 'absolute', inset: 0, width: cW, height: cH, overflow: 'visible', zIndex: 1 }}>
          <defs>
            {Object.entries(SERVICE_ROLES).map(([role, cfg]) => (
              <marker key={role} id={`dc-${role}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                <path d="M 0 1 L 9 5 L 0 9 z" fill={cfg.color} />
              </marker>
            ))}
            {groups.map((g) => (
              <marker key={`dc-grp-${g.id}`} id={`dc-grp-${g.id}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M 0 1 L 9 5 L 0 9 z" fill={g.color} />
              </marker>
            ))}
          </defs>
          {edges.map((edge) => {
            const cfg      = edge.isGroupEdge ? null : (SERVICE_ROLES[edge.fromRole] || SERVICE_ROLES.runtime)
            const srcGrp   = edge.isGroupEdge ? groups.find((g) => g.id === edge.fromId) : null
            const grpColor = srcGrp?.color || '#a78bfa'
            const color    = edge.isGroupEdge ? grpColor : cfg.color
            const isHov    = hovEdge === edge.id
            // count how many services are in the source group for the label
            const grpSvcCount = srcGrp
              ? services.filter((s) => inferServiceCanvasRole(s) === CANVAS_LANES.find((l) => l.label === srcGrp.label)?.key).length
              : 0
            return (
              <g key={edge.id} style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                onMouseEnter={() => setHovEdge(edge.id)}
                onMouseLeave={() => setHovEdge(null)}
                onClick={() => {
                  if (edge.isGroupEdge) { updateGroup(edge.fromId, { dependencies: (groups.find(g => g.id === edge.fromId)?.dependencies || []).filter(d => d !== edge.toId) }) }
                  else { onDisconnectEdge?.(edge.fromId, edge.toId) }
                }}
              >
                <path d={edge.path} stroke="transparent" strokeWidth="14" fill="none" />
                <path d={edge.path} stroke={isHov ? '#f87171' : color} strokeWidth={isHov ? 2.5 : (edge.isGroupEdge ? 2 : 1.5)} fill="none" strokeDasharray={edge.isGroupEdge ? '8 4' : undefined} opacity={isHov ? 1 : (edge.isGroupEdge ? 0.75 : 0.55)} markerEnd={edge.isGroupEdge ? `url(#dc-grp-${edge.fromId})` : `url(#dc-${edge.fromRole})`} style={{ transition: 'stroke 0.12s' }} />
                {edge.isGroupEdge && !isHov && grpSvcCount > 0 && (
                  <text x={edge.midX} y={edge.midY - 6} fontSize="9" fill={grpColor} textAnchor="middle" style={{ pointerEvents: 'none', fontFamily: 'sans-serif', fontWeight: 700, opacity: 0.9 }}>{grpSvcCount} serv.</text>
                )}
                {isHov && <text x={edge.midX} y={edge.midY - 8} fontSize="9" fill="#f87171" textAnchor="middle" style={{ pointerEvents: 'none', fontFamily: 'sans-serif' }}>× remover</text>}
              </g>
            )
          })}
        </svg>

        {/* ── Free service nodes (no matching group, or explicitly freed) ── */}
        {services.filter((svc) => !roleToGrp[inferServiceCanvasRole(svc)] || freeIds.has(svc.id)).map((svc) => {
          const p     = pos[svc.id]
          if (!p) return null
          const role  = inferServiceCanvasRole(svc)
          const cfg   = SERVICE_ROLES[role] || SERVICE_ROLES.runtime
          const stCfg = SERVICE_STATUS[svc.status] || SERVICE_STATUS.pending
          const Icon  = cfg.icon
          const isSel = svc.id === selectedServiceId
          const isHov = svc.id === hovNode
          const isTgt = svc.id === connTarget
          const inputPortStyle = { position: 'absolute', width: DIAG_PR * 2, height: DIAG_PR * 2, borderRadius: '50%', background: isTgt ? cfg.color : '#060f1e', border: `2px solid ${isTgt ? cfg.color : 'rgba(255,255,255,0.18)'}`, opacity: (isHov || !!connecting) ? 1 : 0, cursor: 'crosshair', boxShadow: isTgt ? `0 0 12px ${cfg.color}` : 'none', transition: 'all 0.12s', zIndex: 4 }
          const inputHandlers = {
            onMouseEnter: () => connecting && connecting.fromId !== svc.id && setConnTarget(svc.id),
            onMouseLeave: () => setConnTarget(null),
            onMouseUp: () => { if (connecting && connecting.fromId !== svc.id) { onConnectServices?.(connecting.fromId, svc.id); setConnecting(null); setConnTarget(null) } }
          }
          const outputPortStyle = { position: 'absolute', width: DIAG_PR * 2, height: DIAG_PR * 2, borderRadius: '50%', background: cfg.color, border: `2px solid ${cfg.color}`, opacity: isHov ? 1 : 0, cursor: 'crosshair', boxShadow: `0 0 8px ${cfg.color}90`, transition: 'opacity 0.12s', zIndex: 4 }
          const startWire = (e) => { e.stopPropagation(); const r = wrapRef.current?.getBoundingClientRect(); if (r) setConnecting({ fromId: svc.id, mx: e.clientX - r.left, my: e.clientY - r.top }) }
          const isFree = freeIds.has(svc.id)
          return (
            <div key={svc.id} style={{ position: 'absolute', left: p.x, top: p.y, width: DIAG_NODE, overflow: 'visible', zIndex: isSel ? 5 : 2 }}
              onMouseEnter={() => { setHovNode(svc.id); if (connecting && connecting.fromId !== svc.id) setConnTarget(svc.id) }}
              onMouseLeave={() => { setHovNode(null); setConnTarget(null) }}
              onContextMenu={(e) => openCtx(e, 'service', { svcId: svc.id, inGroup: false, isFree })}
            >
              <div style={{ ...inputPortStyle, top: -DIAG_PR, left: '50%', transform: 'translateX(-50%)' }} {...inputHandlers} />
              <div style={{ ...inputPortStyle, left: -DIAG_PR, top: '50%', transform: 'translateY(-50%)' }} {...inputHandlers} />
              <div onMouseDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); const cp = toCanvas(e.clientX, e.clientY); setDragging({ id: svc.id, ox: cp.x - p.x, oy: cp.y - p.y }); onServiceClick(svc) }}
                style={{ width: DIAG_NODE, height: DIAG_NODE, borderRadius: 18, overflow: 'hidden', background: isLight ? (isSel ? `linear-gradient(145deg, ${cfg.color}14, rgba(255,255,255,0.98))` : 'linear-gradient(145deg, rgba(255,255,255,0.98), rgba(241,246,255,0.98))') : (isSel ? `linear-gradient(145deg, ${cfg.color}18, rgba(6,12,28,0.98))` : 'linear-gradient(145deg, rgba(9,18,40,0.98), rgba(4,8,20,0.99))'), border: `1px solid ${isSel || isTgt ? cfg.color : (isLight ? 'rgba(148,163,184,0.35)' : 'rgba(255,255,255,0.09)')}`, boxShadow: isLight ? (isSel ? `0 0 0 1.5px ${cfg.color}22, 0 14px 28px rgba(15, 23, 42, 0.08)` : isHov ? '0 10px 22px rgba(15, 23, 42, 0.1)' : '0 4px 12px rgba(15, 23, 42, 0.06)') : (isSel ? `0 0 0 1.5px ${cfg.color}55, 0 12px 36px rgba(0,0,0,0.65)` : isHov ? '0 8px 28px rgba(0,0,0,0.55)' : '0 4px 14px rgba(0,0,0,0.45)'), cursor: dragging?.id === svc.id ? 'grabbing' : 'grab', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '10px 8px', transition: dragging?.id === svc.id ? 'none' : 'box-shadow 0.15s, border-color 0.15s' }}>
                <div style={{ width: 46, height: 46, borderRadius: 13, background: `${cfg.color}1c`, border: `1px solid ${cfg.color}38`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon size={22} style={{ color: cfg.color }} /></div>
                <div style={{ textAlign: 'center', width: '100%', padding: '0 4px' }}>
                  <p style={{ color: isLight ? 'var(--color-text)' : '#f1f5f9', fontSize: 11, fontWeight: 700, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{svc.name}</p>
                  <p style={{ color: '#334155', fontSize: 9, margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'ui-monospace,monospace' }}>{svc.image}</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ position: 'relative', display: 'flex', width: 7, height: 7 }}>
                    {svc.status === 'running' && <span className="animate-ping" style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: stCfg.color, opacity: 0.4 }} />}
                    <span style={{ position: 'relative', display: 'block', width: 7, height: 7, borderRadius: '50%', background: stCfg.color, boxShadow: `0 0 5px ${stCfg.glow}` }} />
                  </span>
                  <span style={{ color: '#334155', fontSize: 9 }}>{stCfg.label}</span>
                </div>
              </div>
              <div style={{ ...outputPortStyle, right: -DIAG_PR, top: '50%', transform: 'translateY(-50%)' }} onMouseDown={startWire} />
              <div style={{ ...outputPortStyle, bottom: -DIAG_PR, left: '50%', transform: 'translateX(-50%)' }} onMouseDown={startWire} />
            </div>
          )
        })}

        {/* Empty state */}
        {!services.length && !groups.length && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, pointerEvents: 'none' }}>
            <Server size={28} style={{ color: '#0f2744' }} />
            <p style={{ color: '#0f2744', fontSize: 13, margin: 0 }}>Canvas vazio — duplo-clique para adicionar · shift+arrastar para criar grupo</p>
          </div>
        )}
      </div>

      {/* Bottom hint */}
      <div style={{ position: 'absolute', bottom: 10, left: 14, zIndex: 30, pointerEvents: 'none' }}>
        <p style={{ color: '#0d2240', fontSize: 9, margin: 0 }}>Shift+arrastar → novo grupo · duplo-clique label → renomear · botão direito → menu · porta (●) → conectar</p>
      </div>

      {/* ── Context Menu ── */}
      {ctxMenu && (() => {
        const menuStyle = {
          position: 'fixed', left: ctxMenu.x, top: ctxMenu.y,
          background: isLight ? 'rgba(255,255,255,0.98)' : 'rgba(10,15,30,0.97)', border: isLight ? '1px solid var(--color-border)' : '1px solid rgba(255,255,255,0.12)',
          borderRadius: 12, boxShadow: isLight ? '0 18px 38px rgba(15, 23, 42, 0.12)' : '0 8px 32px rgba(0,0,0,0.7)',
          zIndex: 9999, minWidth: 186, padding: '4px 0',
          backdropFilter: 'blur(16px)', userSelect: 'none'
        }
        const itemStyle = (danger) => ({
          display: 'flex', alignItems: 'center', gap: 9,
          padding: '7px 14px', fontSize: 12, cursor: 'pointer',
          color: danger ? '#f87171' : (isLight ? 'var(--color-text)' : '#cbd5e1'),
          transition: 'background 0.1s'
        })
        const hover = (e) => { e.currentTarget.style.background = isLight ? 'var(--color-hover)' : 'rgba(255,255,255,0.06)' }
        const unhov = (e) => { e.currentTarget.style.background = 'transparent' }
        const sep = <div style={{ height: 1, background: isLight ? 'var(--color-divider)' : 'rgba(255,255,255,0.06)', margin: '4px 0' }} />

        const svc = ctxMenu.svcId ? (stack.services || []).find((s) => s.id === ctxMenu.svcId) : null
        const hasGroup = ctxMenu.grpRole !== undefined

        const item = (icon, label, onClick, danger = false) => (
          <div style={itemStyle(danger)}
            onMouseEnter={hover} onMouseLeave={unhov}
            onMouseDown={(e) => { e.stopPropagation(); onClick() }}>
            {icon} <span>{label}</span>
          </div>
        )

        return (
          <div style={menuStyle} onMouseDown={(e) => e.stopPropagation()}>
            {ctxMenu.type === 'service' && svc && (<>
              <div style={{ padding: '5px 14px 4px', fontSize: 10, color: '#475569', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{svc.name}</div>
              {sep}
              {item(<Settings size={12} />, 'Configurar serviço', () => { onServiceClick?.(svc); setCtxMenu(null) })}
              {ctxMenu.inGroup && item(<LogOut size={12} />, 'Sair do grupo', () => ctxLeaveGroup(ctxMenu.svcId))}
              {ctxMenu.isFree && roleToGrp[inferServiceCanvasRole(svc)] && item(<Layers size={12} />, 'Entrar no grupo', () => ctxJoinGroup(ctxMenu.svcId))}
              {sep}
              {item(<Trash2 size={12} />, 'Remover serviço', () => { onDeleteService?.(ctxMenu.svcId); setCtxMenu(null) }, true)}
            </>)}

            {ctxMenu.type === 'group' && ctxMenu.grp && (<>
              <div style={{ padding: '5px 14px 4px', fontSize: 10, color: '#475569', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{ctxMenu.grp.label}</div>
              {sep}
              {item(<Settings size={12} />, 'Configurar camada', () => {
                const grpRole = findLaneForGroup(ctxMenu.grp)?.key
                if (grpRole && onGroupConfigClick) onGroupConfigClick(grpRole, ctxMenu.grp.label)
                setCtxMenu(null)
              })}
              {item(<ChevronLeft size={12} style={{ transform: ctxMenu.grp.collapsed ? 'rotate(-90deg)' : 'rotate(90deg)' }} />,
                ctxMenu.grp.collapsed ? 'Expandir grupo' : 'Recolher grupo',
                () => { updateGroup(ctxMenu.grp.id, { collapsed: !ctxMenu.grp.collapsed }); setCtxMenu(null) }
              )}
              {item(<RefreshCw size={12} />, 'Renomear', () => { setEditingGrp(ctxMenu.grp.id); setCtxMenu(null) })}
              {sep}
              {item(<Trash2 size={12} />, 'Remover grupo', () => { deleteGroup(ctxMenu.grp); setCtxMenu(null) }, true)}
            </>)}

            {ctxMenu.type === 'canvas' && (<>
              <div style={{ padding: '5px 14px 4px', fontSize: 10, color: '#475569', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Canvas</div>
              {sep}
              {item(<Plus size={12} />, 'Adicionar serviço', () => { onAddService?.(null); setCtxMenu(null) })}
              {item(<Layers size={12} />, 'Adicionar grupo', () => { addGroupCenter(); setCtxMenu(null) })}
              {sep}
              {item(<Zap size={12} />, 'Auto-layout', () => { autoLayout(); setCtxMenu(null) })}
              {item(<RefreshCw size={12} />, 'Regenerar camadas', () => { generateAutoGroups(); setCtxMenu(null) })}
              {item(<Eye size={12} />, 'Fit view', () => { fitView(); setCtxMenu(null) })}
              {sep}
              {item(fullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />,
                fullscreen ? 'Sair da tela cheia' : 'Tela cheia',
                () => { setFullscreen((f) => !f); setCtxMenu(null) }
              )}
            </>)}
          </div>
        )
      })()}
    </div>
  )
}


// ─── Utilitários de configuração ─────────────────────────────────────────────

const RESTART_POLICIES = ['no', 'always', 'on-failure', 'unless-stopped']

const parseEnvFile = (text) =>
  text.split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const eq = l.indexOf('=')
      if (eq < 0) return null
      const k = l.slice(0, eq).trim()
      const v = l.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
      if (!k) return null
      const isSecret = /secret|password|passwd|token|key|auth|private/i.test(k)
      return { key: k, value: v, secret: isSecret }
    })
    .filter(Boolean)

// ─── Configuração de Camada/Grupo ─────────────────────────────────────────────

const GRP_TABS = [
  { id: 'domain',    label: 'Domínio',   icon: Globe },
  { id: 'env',       label: 'Variáveis', icon: Code2 },
  { id: 'network',   label: 'Rede',      icon: GitBranch },
  { id: 'resources', label: 'Recursos',  icon: Cpu },
  { id: 'files',     label: 'Arquivos',  icon: HardDrive },
  { id: 'labels',    label: 'Labels',    icon: ClipboardCheck },
]

// ── Help modal definitions ────────────────────────────────────────────────────
const TAB_HELP = {
  domain: {
    title: 'Domínio & Acesso', icon: Globe, gradient: ['#10b981','#059669'],
    cards: [
      { emoji: '🌍', title: 'Domínio / Host', color: '#10b981',
        body: 'O endereço público pelo qual seu serviço será acessado na internet ou na rede interna.',
        tip: 'Use um domínio real (app.suaempresa.com) para produção, ou um nome local (app.local) para desenvolvimento.',
        example: 'app.suaempresa.com  ·  api.exemplo.com.br' },
      { emoji: '📂', title: 'Path Prefix', color: '#06b6d4',
        body: 'Sub-caminho da URL onde o serviço responde. Útil quando vários serviços compartilham o mesmo domínio.',
        tip: 'Se não precisa de sub-caminho, deixe como "/". Exemplo: /api faz o serviço responder em app.com/api.',
        example: '/   →   app.com/  ·  /api   →   app.com/api' },
      { emoji: '🔒', title: 'SSL / HTTPS', color: '#a855f7',
        body: 'Certificado de segurança que criptografa a comunicação. Sem SSL, dados trafegam em texto puro.',
        tip: 'Sempre ative em produção. O Let\'s Encrypt gera certificados gratuitos automaticamente.',
        example: 'http:// → sem proteção  ·  https:// → criptografado' },
      { emoji: '🔌', title: 'Porta Exposta', color: '#f59e0b',
        body: 'A porta do servidor que receberá as requisições vindas de fora.',
        tip: 'Portas padrão: 80 (HTTP) e 443 (HTTPS). Para outros serviços (APIs internas), qualquer porta acima de 1024.',
        example: '80 = web  ·  443 = web seguro  ·  3000 = api interna' },
    ],
  },
  env: {
    title: 'Variáveis de Ambiente', icon: Code2, gradient: ['#3b82f6','#6366f1'],
    cards: [
      { emoji: '📦', title: 'O que são variáveis de ambiente?', color: '#3b82f6',
        body: 'São configurações passadas para o seu app em tempo de execução, sem precisar alterar o código. Funciona como um painel de controle do serviço.',
        tip: 'Nunca coloque senhas ou tokens diretamente no código. Variáveis de ambiente são o lugar certo para isso.',
        example: 'DATABASE_URL=postgres://...  ·  PORT=3000' },
      { emoji: '🔑', title: 'Variáveis Secretas', color: '#f59e0b',
        body: 'Marcando uma variável como secreta, o valor fica oculto na interface e é tratado com mais cuidado.',
        tip: 'Use para senhas, tokens de API, chaves privadas — qualquer coisa que não deva ser vista por terceiros.',
        example: 'DATABASE_PASSWORD  ·  JWT_SECRET  ·  API_KEY' },
      { emoji: '📄', title: 'Importar arquivo .env', color: '#10b981',
        body: 'Você pode importar um arquivo .env diretamente. Ele será lido e cada linha vira uma variável.',
        tip: 'Linhas que começam com # são comentários e são ignoradas. Formato: CHAVE=valor',
        example: '# comentário\nPORT=3000\nDB_HOST=localhost' },
    ],
  },
  network: {
    title: 'Rede Docker', icon: GitBranch, gradient: ['#06b6d4','#0891b2'],
    cards: [
      { emoji: '🕸️', title: 'O que é uma rede Docker?', color: '#06b6d4',
        body: 'Uma rede Docker é como um roteador virtual que conecta seus containers. Containers na mesma rede se comunicam pelo nome, sem expor portas.',
        tip: 'Coloque todos os serviços de uma stack na mesma rede para que eles se falem internamente.',
        example: 'app → fala com → postgres  (sem precisar de IP)' },
      { emoji: '🔗', title: 'Nome da Rede', color: '#38bdf8',
        body: 'Identificador único da rede no Docker. Você pode criar uma nova ou usar uma rede já existente.',
        tip: 'Use a mesma rede em serviços que precisam se comunicar. Redes diferentes = isolamento total.',
        example: 'minha-app-net  ·  producao-network  ·  bridge' },
      { emoji: '🏷️', title: 'Aliases de Rede', color: '#a78bfa',
        body: 'Apelidos do container dentro da rede. Outros serviços podem usar o alias para se conectar, mesmo que o nome do container mude.',
        tip: 'Útil quando você tem réplicas ou múltiplos containers que devem ser acessados pelo mesmo nome.',
        example: 'api, backend  →  outros containers chamam "api" ou "backend"' },
      { emoji: '🏝️', title: 'Rede Isolada', color: '#f97316',
        body: 'Cria uma rede exclusiva para esta camada, separando completamente do restante do ambiente.',
        tip: 'Use para serviços que por segurança não devem conversar com outros (ex: banco de dados sem acesso externo).',
        example: 'Banco de dados isolado → só o app interno acessa' },
    ],
  },
  resources: {
    title: 'Recursos do Servidor', icon: Cpu, gradient: ['#6366f1','#8b5cf6'],
    cards: [
      { emoji: '⚡', title: 'CPU Limit', color: '#f97316',
        body: 'Máximo de processamento que o serviço pode usar. Evita que um serviço consuma todo o servidor.',
        tip: 'Para apps web simples: 0.5. Para APIs médias: 1. Para processamento pesado: 2+. Deixe 0 para sem limite.',
        example: '0.5 = metade de um núcleo  ·  1 = um núcleo  ·  2 = dois núcleos' },
      { emoji: '🧠', title: 'CPU Reservado', color: '#fb923c',
        body: 'Garante uma fatia mínima de CPU sempre disponível, mesmo sob alta carga no servidor.',
        tip: 'Deve ser menor ou igual ao Limit. Ex: Limit=1, Reservado=0.25 garante ¼ de núcleo sempre.',
        example: 'Reservado ≤ Limit  (sempre)' },
      { emoji: '💾', title: 'Memória RAM', color: '#ec4899',
        body: 'RAM é onde o app "pensa". Se o serviço ultrapassar o limite, o Docker reinicia o container.',
        tip: 'Node.js/Python simples: 256 MB. APIs médias: 512 MB. Bancos de dados: 1024–4096 MB.',
        example: '256 = 256 MB  ·  512 = ½ GB  ·  1024 = 1 GB  ·  2048 = 2 GB' },
      { emoji: '🔁', title: 'Réplicas', color: '#818cf8',
        body: 'Quantas cópias paralelas rodam. Com 2+, se uma cair a outra continua atendendo (alta disponibilidade).',
        tip: 'Para a maioria dos casos, 1 basta. Use 2+ quando o serviço não pode ter downtime.',
        example: '1 = normal  ·  2 = redundante  ·  3+ = alta disponibilidade' },
      { emoji: '🔄', title: 'Política de Restart', color: '#10b981',
        body: 'O que acontece quando o container para ou dá erro.',
        tip: 'Recomendado para produção: unless-stopped.',
        rows: [
          { key: 'no', desc: 'Não reinicia automaticamente.' },
          { key: 'always', desc: 'Reinicia sempre, inclusive após reboot do servidor.' },
          { key: 'on-failure', desc: 'Reinicia só se travar com erro.' },
          { key: 'unless-stopped', desc: 'Reinicia sempre, exceto se você parar manualmente. ✅ Recomendado.' },
        ] },
      { emoji: '🩺', title: 'Healthcheck', color: '#06b6d4',
        body: 'Comando que o Docker executa periodicamente para checar se o serviço está saudável.',
        tip: 'Se o healthcheck falhar várias vezes, o container é marcado como "unhealthy". Deixe em branco se não souber.',
        example: 'CMD curl -f http://localhost/ || exit 1' },
    ],
  },
  files: {
    title: 'Arquivos de Configuração', icon: HardDrive, gradient: ['#a855f7','#7c3aed'],
    cards: [
      { emoji: '📁', title: 'Para que servem os arquivos?', color: '#a855f7',
        body: 'Alguns serviços precisam de arquivos de configuração montados dentro do container (nginx.conf, .env, certificados, etc.).',
        tip: 'Envie o arquivo aqui e ele será montado no container automaticamente.',
        example: 'nginx.conf  ·  .env  ·  config.yaml  ·  certs.zip' },
      { emoji: '📦', title: 'Arquivo .zip', color: '#f59e0b',
        body: 'Você pode enviar um .zip com vários arquivos de configuração de uma vez.',
        tip: 'O conteúdo do .zip é extraído no diretório de configuração do container.',
        example: 'configs.zip → /etc/myapp/conf.d/' },
      { emoji: '⚙️', title: 'Formatos suportados', color: '#10b981',
        body: 'Qualquer formato de configuração que seu serviço aceite pode ser enviado.',
        tip: 'Arquivos sensíveis (com senhas) são mais seguros via Variáveis de Ambiente.',
        example: '.env  ·  .conf  ·  .json  ·  .yaml  ·  .toml  ·  .ini  ·  .txt  ·  .zip' },
    ],
  },
  labels: {
    title: 'Docker Labels', icon: ClipboardCheck, gradient: ['#f59e0b','#d97706'],
    cards: [
      { emoji: '🏷️', title: 'O que são Labels Docker?', color: '#f59e0b',
        body: 'Metadados anexados ao container. Ferramentas como Traefik, Portainer e Watchtower usam labels para se configurar automaticamente.',
        tip: 'Se você usa Traefik como proxy, toda a configuração de roteamento é feita por labels.',
        example: 'traefik.enable=true  ·  com.example.version=1.0' },
      { emoji: '🚦', title: 'Labels do Traefik', color: '#06b6d4',
        body: 'O Traefik (proxy reverso popular) usa labels para saber como rotear o tráfego para cada container.',
        tip: 'Com labels do Traefik, não precisa de nginx.conf — tudo é automático.',
        rows: [
          { key: 'traefik.enable', desc: 'true = ativa o Traefik para este container.' },
          { key: 'traefik.http.routers.app.rule', desc: 'Host(`app.com`) define qual domínio roteia aqui.' },
          { key: 'traefik.http.services.app.loadbalancer.server.port', desc: 'Porta interna do container.' },
        ] },
      { emoji: '🔍', title: 'Labels do Portainer / Watchtower', color: '#a855f7',
        body: 'Portainer usa labels para organização. Watchtower usa para controlar atualizações automáticas.',
        tip: 'com.centurylinklabs.watchtower.enable=false desabilita atualização automática de um container específico.',
        example: 'com.centurylinklabs.watchtower.enable=true' },
    ],
  },
}

// ── Premium Help Button ───────────────────────────────────────────────────────
const HelpButton = ({ onClick }) => (
  <button onClick={onClick} title="Precisa de ajuda? Clique para entender cada campo"
    style={{
      width: 26, height: 26, borderRadius: '50%', border: 'none', cursor: 'pointer',
      background: 'linear-gradient(135deg,#6366f1 0%,#a855f7 100%)',
      boxShadow: '0 0 0 3px rgba(99,102,241,0.2), 0 4px 14px rgba(99,102,241,0.5)',
      color: '#fff', fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center',
      justifyContent: 'center', flexShrink: 0, transition: 'transform 0.15s, box-shadow 0.15s',
      fontFamily: 'ui-sans-serif,system-ui,sans-serif',
    }}
    onMouseEnter={e => { e.currentTarget.style.transform='scale(1.12)'; e.currentTarget.style.boxShadow='0 0 0 4px rgba(99,102,241,0.3), 0 6px 20px rgba(99,102,241,0.65)' }}
    onMouseLeave={e => { e.currentTarget.style.transform='scale(1)';    e.currentTarget.style.boxShadow='0 0 0 3px rgba(99,102,241,0.2), 0 4px 14px rgba(99,102,241,0.5)' }}
  >?</button>
)

// ── Help modal ────────────────────────────────────────────────────────────────
const HelpModal = ({ tabId, onClose, helpData }) => {
  const source = helpData || TAB_HELP
  const h = source[tabId]
  if (!h) return null
  const HIcon = h.icon
  return (
    <div style={{ position:'fixed',inset:0,zIndex:80,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.78)',backdropFilter:'blur(10px)' }}
      onMouseDown={e => { if(e.target===e.currentTarget) onClose() }}>
      <div style={{ width:'100%',maxWidth:500,maxHeight:'86vh',overflowY:'auto',margin:'0 16px',borderRadius:22,border:'1px solid rgba(255,255,255,0.1)',background:'linear-gradient(160deg,#0a1020,#070d1a)',boxShadow:'0 40px 100px rgba(0,0,0,0.8)' }}>
        {/* Header */}
        <div style={{ padding:'18px 20px 14px',borderBottom:'1px solid rgba(255,255,255,0.07)',display:'flex',alignItems:'center',justifyContent:'space-between' }}>
          <div style={{ display:'flex',alignItems:'center',gap:12 }}>
            <div style={{ width:40,height:40,borderRadius:13,background:`linear-gradient(135deg,${h.gradient[0]},${h.gradient[1]})`,display:'flex',alignItems:'center',justifyContent:'center',boxShadow:`0 4px 18px ${h.gradient[0]}55`,flexShrink:0 }}>
              <HIcon size={20} style={{ color:'#fff' }} />
            </div>
            <div>
              <div style={{ fontSize:15,fontWeight:700,color:'#f1f5f9' }}>{h.title}</div>
              <div style={{ fontSize:11,color:'#475569',marginTop:2 }}>Guia para entender e configurar sem dificuldade</div>
            </div>
          </div>
          <button onClick={onClose} style={{ width:30,height:30,borderRadius:9,background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.09)',color:'#64748b',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0 }}>
            <X size={13}/>
          </button>
        </div>
        {/* Cards */}
        <div style={{ padding:'16px 20px',display:'flex',flexDirection:'column',gap:12 }}>
          {h.cards.map((c,i)=>(
            <div key={i} style={{ borderRadius:14,border:`1px solid ${c.color}22`,background:`${c.color}07`,overflow:'hidden' }}>
              <div style={{ padding:'12px 14px 8px',borderBottom:`1px solid ${c.color}12` }}>
                <div style={{ display:'flex',alignItems:'center',gap:8,marginBottom:5 }}>
                  <span style={{ fontSize:18 }}>{c.emoji}</span>
                  <span style={{ fontSize:13,fontWeight:700,color:'#f1f5f9' }}>{c.title}</span>
                </div>
                <p style={{ fontSize:12,color:'#94a3b8',lineHeight:1.65,margin:0 }}>{c.body}</p>
              </div>
              <div style={{ padding:'9px 14px',display:'flex',flexDirection:'column',gap:6 }}>
                {c.rows?.map((r,ri)=>(
                  <div key={ri} style={{ display:'flex',gap:10,alignItems:'flex-start' }}>
                    <code style={{ fontSize:10,padding:'2px 7px',borderRadius:5,background:`${c.color}18`,border:`1px solid ${c.color}30`,color:c.color,whiteSpace:'nowrap',flexShrink:0 }}>{r.key}</code>
                    <span style={{ fontSize:11,color:'#64748b',lineHeight:1.55 }}>{r.desc}</span>
                  </div>
                ))}
                {c.tip && (
                  <div style={{ display:'flex',gap:8,alignItems:'flex-start',background:'rgba(255,255,255,0.03)',borderRadius:9,padding:'7px 10px' }}>
                    <span style={{ fontSize:14,flexShrink:0 }}>💡</span>
                    <span style={{ fontSize:11,color:'#64748b',lineHeight:1.55 }}>{c.tip}</span>
                  </div>
                )}
                {c.example && (
                  <code style={{ fontSize:10,color:'#475569',fontFamily:'ui-monospace,monospace',background:'rgba(255,255,255,0.03)',borderRadius:8,padding:'6px 10px',display:'block',whiteSpace:'pre-wrap',wordBreak:'break-all' }}>{c.example}</code>
                )}
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding:'4px 20px 18px',textAlign:'center' }}>
          <button onClick={onClose}
            style={{ fontSize:12,fontWeight:600,color:'#fff',background:`linear-gradient(135deg,${h.gradient[0]},${h.gradient[1]})`,border:'none',borderRadius:11,padding:'9px 30px',cursor:'pointer',boxShadow:`0 4px 18px ${h.gradient[0]}45` }}>
            Entendido!
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Configuração da Camada ────────────────────────────────────────────────────

const GroupConfigPanel = ({ role, label, config = {}, onSave, onClose }) => {
  const roleCfg = SERVICE_ROLES[role] || SERVICE_ROLES.runtime
  const color   = roleCfg.color
  const Icon    = roleCfg.icon
  const [tab,  setTab]  = useState('domain')
  const [saved, setSaved] = useState(false)
  const [helpTab, setHelpTab] = useState(null)   // which tab's help is open
  const [dockerNetworks, setDockerNetworks]   = useState([])
  const [networksLoading, setNetworksLoading] = useState(true)
  const [newNetName, setNewNetName]           = useState('')

  useEffect(() => {
    setNetworksLoading(true)
    api.get('/docker/networks').then(r => {
      const nets = r.data?.networks || []
      setDockerNetworks(nets.map(n => typeof n === 'string' ? n : (n.Name || n.name || '')).filter(Boolean))
    }).catch(() => {}).finally(() => setNetworksLoading(false))
  }, [])
  const [form, setForm] = useState(() => ({
    domain:         config.domain         || '',
    pathPrefix:     config.pathPrefix     || '/',
    ssl:            config.ssl            ?? true,
    sslEmail:       config.sslEmail       || '',
    exposedPort:    config.exposedPort    || '',
    env:            config.env            || [],
    networkName:    config.networkName    || '',
    networkAliases: config.networkAliases || '',
    isolated:       config.isolated       ?? false,
    cpuLimit:       config.cpuLimit       || '',
    memoryMb:       config.memoryMb       || '',
    cpuReserved:    config.cpuReserved    || '',
    replicas:       config.replicas       || 1,
    restartPolicy:  config.restartPolicy  || 'unless-stopped',
    healthcheck:    config.healthcheck    || '',
    files:          config.files          || [],
    labels:         config.labels         || [],
  }))

  const upd = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const addEnv    = () => upd('env', [...form.env, { key: '', value: '', secret: false }])
  const removeEnv = (i) => upd('env', form.env.filter((_, j) => j !== i))
  const setEnv    = (i, k, v) => { const a = [...form.env]; a[i] = { ...a[i], [k]: v }; upd('env', a) }
  const loadEnvFile = (e) => {
    const file = e.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const parsed = parseEnvFile(ev.target.result || '')
      upd('env', [...form.env, ...parsed.filter((p) => !form.env.some((x) => x.key === p.key))])
    }
    reader.readAsText(file)
  }

  const addLabel    = () => upd('labels', [...form.labels, { key: '', value: '' }])
  const removeLabel = (i) => upd('labels', form.labels.filter((_, j) => j !== i))
  const setLabel    = (i, k, v) => { const a = [...form.labels]; a[i] = { ...a[i], [k]: v }; upd('labels', a) }

  const addFile = (e) => {
    const file = e.target.files?.[0]; if (!file) return
    upd("files", [...form.files, { name: file.name, size: file.size, type: file.type, file }])
  }
  const removeFile = (i) => upd('files', form.files.filter((_, j) => j !== i))

  const handleSave = () => {
    onSave(form)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  // Summary badges for header
  const badges = [
    form.domain       && { text: form.domain,                  color: '#10b981' },
    form.env.length   && { text: `${form.env.length} env`,     color: '#3b82f6' },
    form.files.length && { text: `${form.files.length} file${form.files.length > 1 ? 's' : ''}`, color: '#a855f7' },
    form.labels.length && { text: `${form.labels.length} label${form.labels.length > 1 ? 's' : ''}`, color: '#f59e0b' },
    form.cpuLimit     && { text: `${form.cpuLimit} CPU`,       color: '#f97316' },
    form.memoryMb     && { text: `${form.memoryMb} MB RAM`,    color: '#ec4899' },
  ].filter(Boolean)

  // reusable primitives
  const Field = ({ label: fl, children, hint }) => (
    <div>
      <label style={{ display: 'block', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b', marginBottom: 6 }}>{fl}</label>
      {children}
      {hint && <p style={{ fontSize: 10, color: '#334155', marginTop: 4 }}>{hint}</p>}
    </div>
  )
  const inp = { width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.04)', padding: '8px 12px', fontSize: 12, color: '#f1f5f9', outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.15s' }
  const monoInp = { ...inp, fontFamily: 'ui-monospace,monospace', fontSize: 11 }

  const Toggle = ({ on, onChange, label: tl, hint: th }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '10px 14px' }}>
      <div>
        <div style={{ fontSize: 12, color: '#cbd5e1', fontWeight: 500 }}>{tl}</div>
        {th && <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>{th}</div>}
      </div>
      <button onClick={() => onChange(!on)}
        style={{ position: 'relative', width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer', transition: 'background 0.2s', background: on ? color : '#1e293b', flexShrink: 0 }}>
        <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.4)' }} />
      </button>
    </div>
  )

  const EmptyHint = ({ icon: EI, text, sub }) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '28px 0', color: '#334155' }}>
      <EI size={28} />
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 12, color: '#475569', fontWeight: 500 }}>{text}</div>
        {sub && <div style={{ fontSize: 10, color: '#334155', marginTop: 4, maxWidth: 220 }}>{sub}</div>}
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', borderRadius: 18, border: '1px solid rgba(255,255,255,0.08)', background: 'linear-gradient(160deg,#080f1e,#060c18)', overflow: 'hidden' }}>

      {/* ── Header ── */}
      <div style={{ padding: '14px 16px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: `${color}18`, border: `1px solid ${color}35`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Icon size={16} style={{ color }} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9', lineHeight: 1.2 }}>{label}</div>
              <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>{roleCfg.description}</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 8, color: '#64748b', cursor: 'pointer', padding: '4px 6px', lineHeight: 1, display: 'flex' }}>
            <X size={13} />
          </button>
        </div>

        {/* Active config badges */}
        {badges.length > 0 && (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
            {badges.map((b, i) => (
              <span key={i} style={{ fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 6, background: `${b.color}18`, border: `1px solid ${b.color}35`, color: b.color, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.text}</span>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
          {GRP_TABS.map((t) => {
            const TI = t.icon
            const isActive = tab === t.id
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', fontSize: 10, fontWeight: isActive ? 600 : 400, color: isActive ? '#fff' : '#475569', background: isActive ? `${color}22` : 'transparent', border: isActive ? `1px solid ${color}45` : '1px solid transparent', borderRadius: 8, cursor: 'pointer', transition: 'all 0.15s', marginBottom: 4 }}>
                <TI size={11} style={{ color: isActive ? color : '#475569' }} />
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Help Modal (shared across all tabs) ── */}
      {helpTab && <HelpModal tabId={helpTab} onClose={() => setHelpTab(null)} />}

      {/* ── Body ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* DOMAIN */}
        {tab === 'domain' && (<>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: -4 }}>
            <div style={{ fontSize: 11, color: '#475569', fontWeight: 500 }}>Roteamento, domínio e SSL do ambiente</div>
            <HelpButton onClick={() => setHelpTab('domain')} />
          </div>
          <Field label="Domínio / Host" hint="Hostname público ou interno para roteamento">
            <div style={{ position: 'relative' }}>
              <Globe size={12} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#475569' }} />
              <input value={form.domain} onChange={(e) => upd('domain', e.target.value)}
                placeholder="app.exemplo.com"
                style={{ ...inp, paddingLeft: 28 }} />
            </div>
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Path Prefix">
              <input value={form.pathPrefix} onChange={(e) => upd('pathPrefix', e.target.value)} placeholder="/" style={inp} />
            </Field>
            <Field label="Porta Exposta">
              <input type="number" value={form.exposedPort} onChange={(e) => upd('exposedPort', e.target.value)} placeholder="80" style={inp} />
            </Field>
          </div>
          <Toggle on={form.ssl} onChange={(v) => upd('ssl', v)} label="SSL / HTTPS via Let's Encrypt" hint="Certificado automático com Certbot" />
          {form.ssl && (
            <Field label="E-mail Let's Encrypt" hint="Usado para alertas de renovação">
              <input value={form.sslEmail} onChange={(e) => upd('sslEmail', e.target.value)} placeholder="admin@exemplo.com" style={inp} />
            </Field>
          )}
          {form.domain && (
            <div style={{ borderRadius: 10, border: '1px solid rgba(16,185,129,0.2)', background: 'rgba(16,185,129,0.06)', padding: '10px 12px' }}>
              <div style={{ fontSize: 10, color: '#10b981', fontWeight: 600, marginBottom: 4 }}>Preview da URL</div>
              <div style={{ fontSize: 12, color: '#6ee7b7', fontFamily: 'ui-monospace,monospace' }}>
                {form.ssl ? 'https' : 'http'}://{form.domain}{form.pathPrefix !== '/' ? form.pathPrefix : ''}
                {form.exposedPort && form.exposedPort !== '80' && form.exposedPort !== '443' ? `:${form.exposedPort}` : ''}
              </div>
            </div>
          )}
        </>)}

        {/* ENV */}
        {tab === 'env' && (<>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 500 }}>
              {form.env.length} variável{form.env.length !== 1 ? 'is' : ''}
              {form.env.filter(e => e.secret).length > 0 && (
                <span style={{ marginLeft: 8, fontSize: 10, color: '#f59e0b' }}>· {form.env.filter(e => e.secret).length} secretas</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <HelpButton onClick={() => setHelpTab('env')} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 10, color: '#7dd3fc', background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 8, padding: '4px 9px' }}>
                <Upload size={10} /> .env
                <input type="file" accept=".env,text/plain" style={{ display: 'none' }} onChange={loadEnvFile} />
              </label>
              <button onClick={addEnv} style={{ fontSize: 10, color: '#fff', background: `${color}25`, border: `1px solid ${color}40`, borderRadius: 8, padding: '4px 10px', cursor: 'pointer' }}>+ Adicionar</button>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {form.env.map((e, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 3fr auto auto', gap: 6, alignItems: 'center', background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '6px 10px' }}>
                <input value={e.key} onChange={(ev) => setEnv(i, 'key', ev.target.value)} placeholder="CHAVE"
                  style={{ ...monoInp, background: 'transparent', border: 'none', padding: '2px 0', fontSize: 11, color: '#fbbf24' }} />
                <input value={e.value} onChange={(ev) => setEnv(i, 'value', ev.target.value)} placeholder="valor"
                  type={e.secret ? 'password' : 'text'}
                  style={{ ...inp, background: 'transparent', border: 'none', padding: '2px 0', fontSize: 11 }} />
                <button onClick={() => setEnv(i, 'secret', !e.secret)} title={e.secret ? 'Tornar visível' : 'Marcar como segredo'}
                  style={{ background: e.secret ? 'rgba(245,158,11,0.12)' : 'rgba(255,255,255,0.04)', border: `1px solid ${e.secret ? 'rgba(245,158,11,0.35)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 7, padding: '3px 6px', cursor: 'pointer', fontSize: 11, lineHeight: 1 }}>
                  {e.secret ? '🔒' : '👁'}
                </button>
                <button onClick={() => removeEnv(i)} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', padding: 4, lineHeight: 1, display: 'flex' }}>
                  <X size={11} />
                </button>
              </div>
            ))}
            {!form.env.length && <EmptyHint icon={Code2} text="Sem variáveis" sub="Adicione vars de ambiente ou importe um arquivo .env" />}
          </div>
        </>)}

        {/* NETWORK */}
        {tab === 'network' && (<>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: -4 }}>
            <div style={{ fontSize: 11, color: '#475569', fontWeight: 500 }}>Rede Docker para comunicação entre serviços</div>
            <HelpButton onClick={() => setHelpTab('network')} />
          </div>

          {/* Existing networks picker — always visible */}
          <div>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b', marginBottom: 8 }}>Redes existentes no Docker</label>
            {networksLoading ? (
              <div style={{ fontSize: 11, color: '#334155', padding: '10px 0' }}>Carregando redes...</div>
            ) : dockerNetworks.length === 0 ? (
              <div style={{ fontSize: 11, color: '#334155', padding: '10px 0' }}>Nenhuma rede encontrada no Docker</div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {dockerNetworks.map((net) => {
                  const isSelected = form.networkName === net
                  return (
                    <button key={net} onClick={() => upd('networkName', isSelected ? '' : net)}
                      style={{ fontSize: 11, fontFamily: 'ui-monospace,monospace', padding: '5px 12px', borderRadius: 8, cursor: 'pointer', transition: 'all 0.15s',
                        border: isSelected ? '1px solid rgba(59,130,246,0.6)' : '1px solid rgba(255,255,255,0.09)',
                        background: isSelected ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.04)',
                        color: isSelected ? '#7dd3fc' : '#64748b',
                        fontWeight: isSelected ? 600 : 400,
                        boxShadow: isSelected ? '0 0 0 1px rgba(59,130,246,0.3)' : 'none',
                      }}>
                      {isSelected && <span style={{ marginRight: 5 }}>✓</span>}{net}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Create / type a new network name */}
          <div>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b', marginBottom: 6 }}>
              Ou crie uma nova rede
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <GitBranch size={12} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#475569' }} />
                <input value={newNetName}
                  onChange={(e) => setNewNetName(e.target.value)}
                  placeholder="minha-rede"
                  style={{ ...inp, paddingLeft: 28 }} />
              </div>
              <button onClick={() => { if (newNetName.trim()) { upd('networkName', newNetName.trim()); setNewNetName('') } }}
                style={{ fontSize: 10, fontWeight: 600, color: '#fff', background: 'linear-gradient(135deg,#3b82f6,#6366f1)', border: 'none', borderRadius: 10, padding: '0 14px', cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: '0 2px 10px rgba(59,130,246,0.35)', flexShrink: 0, opacity: newNetName.trim() ? 1 : 0.4 }}>
                Usar esta
              </button>
            </div>
          </div>

          {form.networkName && (
            <div style={{ borderRadius: 10, border: '1px solid rgba(59,130,246,0.2)', background: 'rgba(59,130,246,0.06)', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <GitBranch size={13} style={{ color: '#3b82f6', flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 10, color: '#3b82f6', fontWeight: 600 }}>Rede selecionada</div>
                <div style={{ fontSize: 12, color: '#93c5fd', fontFamily: 'ui-monospace,monospace', marginTop: 2 }}>{form.networkName}</div>
              </div>
            </div>
          )}

          <Field label="Aliases de Rede" hint="Nomes alternativos para resolução DNS interna (separados por vírgula)">
            <input value={form.networkAliases} onChange={(e) => upd('networkAliases', e.target.value)} placeholder="api, backend, service" style={inp} />
          </Field>
          {form.networkAliases && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {form.networkAliases.split(',').map(a => a.trim()).filter(Boolean).map((alias, i) => (
                <span key={i} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.25)', color: '#93c5fd', fontFamily: 'ui-monospace,monospace' }}>{alias}</span>
              ))}
            </div>
          )}
          <Toggle on={form.isolated} onChange={(v) => upd('isolated', v)} label="Rede Isolada" hint="Cria uma rede Docker dedicada somente para esta camada" />
        </>)}

        {/* RESOURCES */}
        {tab === 'resources' && (<>
          {/* Section header with premium ? button */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 11, color: '#475569', fontWeight: 500 }}>Limites de CPU, memória e disponibilidade</div>
            <HelpButton onClick={() => setHelpTab('resources')} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="CPU Limit" hint="cores (0 = sem limite)">
              <div style={{ position: 'relative' }}>
                <Cpu size={11} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#475569' }} />
                <input type="number" step="0.1" min="0" value={form.cpuLimit} onChange={(e) => upd('cpuLimit', e.target.value)} placeholder="0" style={{ ...inp, paddingLeft: 28 }} />
              </div>
            </Field>
            <Field label="Memória Limit" hint="MB (0 = sem limite)">
              <div style={{ position: 'relative' }}>
                <Server size={11} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#475569' }} />
                <input type="number" min="0" value={form.memoryMb} onChange={(e) => upd('memoryMb', e.target.value)} placeholder="0" style={{ ...inp, paddingLeft: 28 }} />
              </div>
            </Field>
            <Field label="CPU Reservado">
              <input type="number" step="0.1" min="0" value={form.cpuReserved} onChange={(e) => upd('cpuReserved', e.target.value)} placeholder="0" style={inp} />
            </Field>
            <Field label="Réplicas">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button onClick={() => upd('replicas', Math.max(1, form.replicas - 1))}
                  style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', cursor: 'pointer', fontSize: 16, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>−</button>
                <input type="number" min="1" value={form.replicas} onChange={(e) => upd('replicas', Number(e.target.value))} style={{ ...inp, textAlign: 'center' }} />
                <button onClick={() => upd('replicas', form.replicas + 1)}
                  style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', cursor: 'pointer', fontSize: 16, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>+</button>
              </div>
            </Field>
          </div>
          <Field label="Política de Restart">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 6 }}>
              {RESTART_POLICIES.map((p) => (
                <button key={p} onClick={() => upd('restartPolicy', p)}
                  style={{ padding: '7px 10px', borderRadius: 9, fontSize: 11, fontFamily: 'ui-monospace,monospace', cursor: 'pointer', transition: 'all 0.15s', border: form.restartPolicy === p ? `1px solid ${color}60` : '1px solid rgba(255,255,255,0.07)', background: form.restartPolicy === p ? `${color}18` : 'rgba(255,255,255,0.03)', color: form.restartPolicy === p ? color : '#64748b', fontWeight: form.restartPolicy === p ? 600 : 400 }}>
                  {p}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Healthcheck Command">
            <input value={form.healthcheck} onChange={(e) => upd('healthcheck', e.target.value)}
              placeholder="CMD curl -f http://localhost/ || exit 1" style={{ ...monoInp, fontSize: 10 }} />
          </Field>
          {(form.cpuLimit || form.memoryMb) && (
            <div style={{ display: 'flex', gap: 8 }}>
              {form.cpuLimit && <div style={{ flex: 1, background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.2)', borderRadius: 10, padding: '8px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#fb923c' }}>{form.cpuLimit}</div>
                <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 2 }}>CPU cores</div>
              </div>}
              {form.memoryMb && <div style={{ flex: 1, background: 'rgba(236,72,153,0.08)', border: '1px solid rgba(236,72,153,0.2)', borderRadius: 10, padding: '8px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#f472b6' }}>{form.memoryMb}</div>
                <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 2 }}>MB RAM</div>
              </div>}
              <div style={{ flex: 1, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 10, padding: '8px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#818cf8' }}>{form.replicas}×</div>
                <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 2 }}>réplicas</div>
              </div>
            </div>
          )}
        </>)}

        {/* FILES */}
        {tab === 'files' && (<>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 500 }}>{form.files.length} arquivo{form.files.length !== 1 ? 's' : ''}</div>
              <HelpButton onClick={() => setHelpTab('files')} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 10, color: '#c4b5fd', background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.25)', borderRadius: 8, padding: '5px 12px' }}>
              <Upload size={10} /> Fazer upload
              <input type="file" accept=".zip,.env,.conf,.json,.yaml,.yml,.toml,.ini,.txt" style={{ display: 'none' }} onChange={addFile} />
            </label>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {form.files.map((f, i) => {
              const ext = f.name.split('.').pop()?.toLowerCase()
              const extColor = { zip: '#f59e0b', env: '#10b981', json: '#3b82f6', yaml: '#06b6d4', yml: '#06b6d4' }[ext] || '#64748b'
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '8px 12px' }}>
                  <div style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 5, background: `${extColor}18`, border: `1px solid ${extColor}35`, color: extColor, fontFamily: 'ui-monospace,monospace', flexShrink: 0 }}>.{ext}</div>
                  <span style={{ flex: 1, fontSize: 12, color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                  <span style={{ fontSize: 10, color: '#475569', flexShrink: 0 }}>{(f.size / 1024).toFixed(1)} KB</span>
                  <button onClick={() => removeFile(i)} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', padding: 3, lineHeight: 1, display: 'flex' }}><X size={11} /></button>
                </div>
              )
            })}
            {!form.files.length && <EmptyHint icon={HardDrive} text="Sem arquivos" sub="Envie .env, .conf, .yaml, .json ou .zip de configuração" />}
          </div>
        </>)}

        {/* LABELS */}
        {tab === 'labels' && (<>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 500 }}>{form.labels.length} label{form.labels.length !== 1 ? 's' : ''}</div>
              <HelpButton onClick={() => setHelpTab('labels')} />
            </div>
            <button onClick={addLabel} style={{ fontSize: 10, color: '#fbbf24', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 8, padding: '4px 10px', cursor: 'pointer' }}>+ Adicionar</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {form.labels.map((lbl_, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6, alignItems: 'center', background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '6px 10px' }}>
                <input value={lbl_.key} onChange={(e) => setLabel(i, 'key', e.target.value)} placeholder="traefik.enable"
                  style={{ ...monoInp, background: 'transparent', border: 'none', padding: '2px 0', fontSize: 10, color: '#a78bfa' }} />
                <input value={lbl_.value} onChange={(e) => setLabel(i, 'value', e.target.value)} placeholder="true"
                  style={{ ...inp, background: 'transparent', border: 'none', padding: '2px 0', fontSize: 11 }} />
                <button onClick={() => removeLabel(i)} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', padding: 4, lineHeight: 1, display: 'flex' }}><X size={11} /></button>
              </div>
            ))}
            {!form.labels.length && <EmptyHint icon={ClipboardCheck} text="Sem labels" sub="Labels Docker são úteis para Traefik, Portainer e Watchtower" />}
          </div>
          {form.labels.length > 0 && (
            <div style={{ borderRadius: 10, border: '1px solid rgba(251,191,36,0.15)', background: 'rgba(251,191,36,0.05)', padding: '10px 12px' }}>
              <div style={{ fontSize: 10, color: '#f59e0b', fontWeight: 600, marginBottom: 6 }}>Preview docker-compose labels:</div>
              {form.labels.map((l, i) => l.key && (
                <div key={i} style={{ fontSize: 10, fontFamily: 'ui-monospace,monospace', color: '#64748b', lineHeight: 1.7 }}>
                  <span style={{ color: '#475569' }}>  - </span><span style={{ color: '#fbbf24' }}>{l.key}</span>{l.value && <><span style={{ color: '#475569' }}>=</span><span style={{ color: '#6ee7b7' }}>{l.value}</span></>}
                </div>
              ))}
            </div>
          )}
        </>)}
      </div>

      {/* ── Footer ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.06)', padding: '12px 16px' }}>
        <button onClick={onClose} style={{ fontSize: 11, color: '#475569', background: 'none', border: 'none', cursor: 'pointer' }}>Cancelar</button>
        <button onClick={handleSave}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#fff', background: `linear-gradient(135deg, ${color}cc, ${color}88)`, border: 'none', borderRadius: 10, padding: '8px 18px', cursor: 'pointer', boxShadow: `0 4px 16px ${color}40`, transition: 'opacity 0.2s' }}>
          {saved ? <><CheckCircle2 size={13} /> Salvo!</> : 'Salvar configuração'}
        </button>
      </div>
    </div>
  )
}

// ─── Help content — Configurações Globais da Stack ────────────────────────────

const GLOBAL_TAB_HELP = {
  network: {
    title: 'Rede da Stack', icon: GitBranch, gradient: ['#06b6d4','#0891b2'],
    cards: [
      { emoji: '🕸️', title: 'O que é a rede da stack?', color: '#06b6d4',
        body: 'A rede une todos os serviços da stack em um ambiente privado. Containers se comunicam pelo nome do serviço, sem expor portas ao mundo.',
        tip: 'Use uma rede por stack. Assim cada ambiente (produção, staging) fica completamente isolado do outro.',
        example: 'app-net  ·  producao-network  ·  staging-net' },
      { emoji: '🚗', title: 'Driver de Rede', color: '#38bdf8',
        body: 'Define como os containers se comunicam entre si.',
        tip: 'Para a maioria dos casos use bridge. Use overlay apenas com Docker Swarm em múltiplos servidores.',
        rows: [
          { key: 'bridge',  desc: 'Padrão. Conecta containers no mesmo servidor. ✅ Use este.' },
          { key: 'overlay', desc: 'Para múltiplos servidores com Docker Swarm.' },
          { key: 'host',    desc: 'Container usa a rede do servidor diretamente. Sem isolamento.' },
          { key: 'none',    desc: 'Sem rede — container completamente isolado.' },
        ] },
      { emoji: '📐', title: 'Subnet e Gateway', color: '#a78bfa',
        body: 'Definem o intervalo de IPs e o roteador da rede Docker. Na maioria dos casos não é necessário configurar.',
        tip: 'Só preencha se houver conflito de IPs com sua rede local ou se precisar de IPs fixos.',
        example: 'Subnet: 172.20.0.0/16  ·  Gateway: 172.20.0.1' },
    ],
  },
  domain: {
    title: 'Domínio & TLS', icon: Globe, gradient: ['#10b981','#059669'],
    cards: [
      { emoji: '🌍', title: 'Domínio Raiz', color: '#10b981',
        body: 'Domínio principal da stack. Os serviços serão acessados como subdomínios ou sub-caminhos dele.',
        tip: 'Use seu domínio real em produção. Em desenvolvimento, pode usar um .local ou deixar em branco.',
        example: 'empresa.com  ·  cliente.com.br  ·  app.exemplo.io' },
      { emoji: '🔒', title: 'TLS / HTTPS', color: '#a855f7',
        body: 'Certificado automático via Let\'s Encrypt. Criptografa toda comunicação entre usuários e seus serviços.',
        tip: 'Sempre ative em produção. Requer que o domínio aponte para o servidor e as portas 80/443 estejam abertas.',
        example: 'https://app.empresa.com  (com TLS ativo)' },
      { emoji: '📧', title: 'E-mail ACME', color: '#f59e0b',
        body: 'E-mail usado pelo Let\'s Encrypt para enviar alertas de renovação do certificado.',
        tip: 'Use um e-mail real que você monitora. O certificado expira em 90 dias e é renovado automaticamente.',
        example: 'admin@empresa.com  ·  devops@empresa.com' },
      { emoji: '🔄', title: 'Modo DNS', color: '#06b6d4',
        body: 'Como o Let\'s Encrypt valida que você é dono do domínio.',
        tip: 'Use http para a maioria dos casos. Use dns se as portas 80/443 estiverem bloqueadas.',
        rows: [
          { key: 'http', desc: 'Valida via arquivo HTTP no servidor. ✅ Mais simples.' },
          { key: 'dns',  desc: 'Valida via registro DNS. Necessário para wildcard (*.domain.com).' },
          { key: 'tls',  desc: 'Valida via TLS-ALPN. Alternativa quando HTTP está bloqueado.' },
        ] },
    ],
  },
  proxy: {
    title: 'Proxy / Load Balancer', icon: Server, gradient: ['#f97316','#ea580c'],
    cards: [
      { emoji: '🚦', title: 'O que é um Proxy Reverso?', color: '#f97316',
        body: 'Recebe o tráfego da internet e distribui para os serviços certos. É a "portaria" do ambiente.',
        tip: 'Traefik é o mais integrado ao Docker — detecta novos serviços automaticamente. Nginx é mais manual.',
        rows: [
          { key: 'traefik', desc: 'Automático, integrado ao Docker via labels. ✅ Recomendado.' },
          { key: 'nginx',   desc: 'Clássico e robusto. Requer configuração manual.' },
          { key: 'caddy',   desc: 'Simples e com HTTPS automático nativo.' },
          { key: 'none',    desc: 'Sem proxy. Serviços ficam com portas diretas.' },
        ] },
      { emoji: '🗺️', title: 'Modo de Rota', color: '#fb923c',
        body: 'Como os serviços são diferenciados pelo proxy.',
        tip: 'Subdomain é o modo mais limpo para múltiplos serviços. Path é útil quando só há um domínio disponível.',
        rows: [
          { key: 'subdomain', desc: 'api.empresa.com, app.empresa.com  →  cada serviço no próprio subdomínio.' },
          { key: 'path',      desc: 'empresa.com/api, empresa.com/app  →  mesma raiz, caminhos diferentes.' },
        ] },
      { emoji: '🔌', title: 'Portas HTTP / HTTPS', color: '#fbbf24',
        body: 'Portas em que o proxy escuta o tráfego entrante.',
        tip: 'Mantenha 80 e 443 a não ser que outra coisa já use essas portas.',
        example: '80 = HTTP  ·  443 = HTTPS  ·  8080 = alternativa de desenvolvimento' },
    ],
  },
  registry: {
    title: 'Registro de Imagens', icon: Download, gradient: ['#8b5cf6','#7c3aed'],
    cards: [
      { emoji: '📦', title: 'O que é um Registro Docker?', color: '#8b5cf6',
        body: 'Repositório de imagens Docker. Pode ser o Docker Hub (público) ou um registro privado da sua empresa.',
        tip: 'Configure um registro privado se suas imagens contiverem código proprietário.',
        example: 'registry.suaempresa.com  ·  ghcr.io  ·  registry.gitlab.com' },
      { emoji: '🔑', title: 'Credenciais', color: '#a78bfa',
        body: 'Usuário e token/senha para autenticar e fazer pull das imagens privadas.',
        tip: 'Use tokens de acesso em vez de senhas. São mais seguros e revogáveis.',
        example: 'Usuário: deploy-bot  ·  Token: ghp_xxxxxxxxxxxx' },
      { emoji: '🔐', title: 'Segurança', color: '#f59e0b',
        body: 'As credenciais são armazenadas como secret no Docker. Nunca aparecem em logs ou no docker-compose.yml.',
        tip: 'Crie um usuário/token específico para deploy com permissão somente de leitura (pull).',
        example: 'Permissão mínima: read:packages  ou  read_registry' },
    ],
  },
  policy: {
    title: 'Política & Operação', icon: Settings, gradient: ['#64748b','#475569'],
    cards: [
      { emoji: '🔄', title: 'Política de Restart', color: '#10b981',
        body: 'Define o comportamento padrão de restart para todos os serviços da stack.',
        tip: 'unless-stopped é o ideal para produção — reinicia automaticamente mas respeita paradas manuais.',
        rows: [
          { key: 'no',             desc: 'Não reinicia nunca.' },
          { key: 'always',         desc: 'Reinicia sempre, até após reboot do servidor.' },
          { key: 'on-failure',     desc: 'Reinicia só se encerrar com erro.' },
          { key: 'unless-stopped', desc: 'Reinicia sempre, exceto se parado manualmente. ✅ Recomendado.' },
        ] },
      { emoji: '📋', title: 'Log Driver', color: '#06b6d4',
        body: 'Como o Docker registra e armazena os logs dos containers.',
        tip: 'json-file é o padrão e funciona com docker logs. Use fluentd ou journald se tiver centralizador de logs.',
        rows: [
          { key: 'json-file', desc: 'Padrão. Salva em arquivo JSON no servidor. ✅' },
          { key: 'local',     desc: 'Mais eficiente que json-file, mas sem docker logs.' },
          { key: 'syslog',    desc: 'Envia para o syslog do sistema.' },
          { key: 'fluentd',   desc: 'Envia para um coletor Fluentd/Fluent Bit.' },
        ] },
      { emoji: '🌍', title: 'Timezone', color: '#a78bfa',
        body: 'Fuso horário dos containers. Afeta logs, cron jobs e datas geradas pelos serviços.',
        tip: 'Use America/Sao_Paulo para serviços brasileiros. Erros de timezone causam problemas difíceis de depurar.',
        example: 'America/Sao_Paulo  ·  UTC  ·  America/New_York' },
    ],
  },
  envs: {
    title: 'Variáveis Globais', icon: Code2, gradient: ['#3b82f6','#6366f1'],
    cards: [
      { emoji: '🌐', title: 'O que são variáveis globais?', color: '#3b82f6',
        body: 'Variáveis de ambiente injetadas em TODOS os serviços da stack automaticamente. Evitam repetição.',
        tip: 'Use para configurações compartilhadas: nome do ambiente, URL base, credenciais de monitoramento.',
        example: 'ENVIRONMENT=production  ·  LOG_LEVEL=info  ·  SENTRY_DSN=...' },
      { emoji: '🔑', title: 'Variáveis Secretas', color: '#f59e0b',
        body: 'Marcando como secreta, o valor fica oculto na interface e é tratado com mais cuidado no deploy.',
        tip: 'Use para tokens, senhas e chaves que todos os serviços precisam mas que não devem ser visíveis.',
        example: 'GLOBAL_API_KEY  ·  OBSERVABILITY_TOKEN  ·  SMTP_PASSWORD' },
      { emoji: '📄', title: 'Importar .env', color: '#10b981',
        body: 'Importe um arquivo .env com todas as variáveis globais de uma vez.',
        tip: 'Linhas com # são comentários e ignoradas. Variáveis já existentes não são sobrescritas.',
        example: '# Arquivo .env global\nENVIRONMENT=production\nLOG_LEVEL=info' },
    ],
  },
}

// ─── Configuração Global da Stack ─────────────────────────────────────────────

const StackGlobalConfigPanel = ({ stack, config = {}, onSave, onClose }) => {
  const [tab, setTab] = useState('network')
  const [saved, setSaved] = useState(false)
  const [helpTab, setHelpTab] = useState(null)
  const [dockerNetworks, setDockerNetworks]   = useState([])
  const [networksLoading, setNetworksLoading] = useState(true)
  const [newNetName, setNewNetName]           = useState('')

  const [form, setForm] = useState(() => ({
    networkName:    config.networkName    || stack.network || 'stack-net',
    networkDriver:  config.networkDriver  || 'bridge',
    subnet:         config.subnet         || '',
    gateway:        config.gateway        || '',
    rootDomain:     config.rootDomain     || '',
    tls:            config.tls            ?? true,
    acmeEmail:      config.acmeEmail      || '',
    dnsMode:        config.dnsMode        || 'http',
    proxyType:      config.proxyType      || 'traefik',
    proxyMode:      config.proxyMode      || 'subdomain',
    httpPort:       config.httpPort       || 80,
    httpsPort:      config.httpsPort      || 443,
    forceHttps:     config.forceHttps     ?? true,
    registryUrl:    config.registryUrl    || '',
    registryUser:   config.registryUser   || '',
    registryToken:  config.registryToken  || '',
    registryEmail:  config.registryEmail  || '',
    restartPolicy:  config.restartPolicy  || 'unless-stopped',
    logDriver:      config.logDriver      || 'json-file',
    maxLogSize:     config.maxLogSize     || '10m',
    timezone:       config.timezone       || 'America/Sao_Paulo',
    swarmMode:      config.swarmMode      ?? false,
    globalEnv:      config.globalEnv      || []
  }))

  useEffect(() => {
    setNetworksLoading(true)
    api.get('/docker/networks').then(r => {
      const nets = r.data?.networks || []
      setDockerNetworks(nets.map(n => typeof n === 'string' ? n : (n.Name || n.name || '')).filter(Boolean))
    }).catch(() => {}).finally(() => setNetworksLoading(false))
  }, [])

  const upd = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const addGEnv    = () => upd('globalEnv', [...form.globalEnv, { key: '', value: '', secret: false }])
  const removeGEnv = (i) => upd('globalEnv', form.globalEnv.filter((_, j) => j !== i))
  const setGEnv    = (i, k, v) => { const a = [...form.globalEnv]; a[i] = { ...a[i], [k]: v }; upd('globalEnv', a) }
  const loadGEnvFile = (e) => {
    const file = e.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const parsed = parseEnvFile(ev.target.result || '')
      upd('globalEnv', [...form.globalEnv, ...parsed.filter((p) => !form.globalEnv.some((x) => x.key === p.key))])
    }
    reader.readAsText(file)
  }

  const handleSave = () => {
    onSave(form)
    setSaved(true)
    setTimeout(() => { setSaved(false); onClose() }, 1200)
  }

  // shared style primitives
  const inp = { width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.04)', padding: '8px 12px', fontSize: 12, color: '#f1f5f9', outline: 'none', boxSizing: 'border-box' }
  const monoInp = { ...inp, fontFamily: 'ui-monospace,monospace', fontSize: 11 }
  const sel = { ...inp, background: 'rgba(255,255,255,0.06)', cursor: 'pointer' }

  const Field = ({ label: fl, children, hint }) => (
    <div>
      <label style={{ display: 'block', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b', marginBottom: 6 }}>{fl}</label>
      {children}
      {hint && <p style={{ fontSize: 10, color: '#334155', marginTop: 4 }}>{hint}</p>}
    </div>
  )

  const Toggle = ({ on, onChange, label: tl, hint: th }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '10px 14px' }}>
      <div>
        <div style={{ fontSize: 12, color: '#cbd5e1', fontWeight: 500 }}>{tl}</div>
        {th && <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>{th}</div>}
      </div>
      <button onClick={() => onChange(!on)}
        style={{ position: 'relative', width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer', transition: 'background 0.2s', background: on ? '#3b82f6' : '#1e293b', flexShrink: 0 }}>
        <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.4)' }} />
      </button>
    </div>
  )

  const SectionHeader = ({ hint, tabId }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: -4 }}>
      <div style={{ fontSize: 11, color: '#475569', fontWeight: 500 }}>{hint}</div>
      <HelpButton onClick={() => setHelpTab(tabId)} />
    </div>
  )

  const GLOBAL_TABS = [
    { id: 'network',  label: 'Rede',      icon: GitBranch },
    { id: 'domain',   label: 'Domínio',   icon: Globe },
    { id: 'proxy',    label: 'Proxy',     icon: Server },
    { id: 'registry', label: 'Registro',  icon: Download },
    { id: 'policy',   label: 'Política',  icon: Settings },
    { id: 'envs',     label: 'Variáveis', icon: Code2 },
  ]

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>

      {helpTab && <HelpModal tabId={helpTab} onClose={() => setHelpTab(null)} helpData={GLOBAL_TAB_HELP} />}

      <div style={{ width: '100%', maxWidth: 600, maxHeight: '88vh', display: 'flex', flexDirection: 'column', margin: '0 16px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.1)', background: 'linear-gradient(160deg,#080f1e,#060c18)', boxShadow: '0 40px 100px rgba(0,0,0,0.8)' }}>

        {/* ── Header ── */}
        <div style={{ padding: '18px 20px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg,#3b82f6,#6366f1)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 16px rgba(59,130,246,0.4)', flexShrink: 0 }}>
                <Settings size={18} style={{ color: '#fff' }} />
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9', lineHeight: 1.2 }}>Configurações Globais</div>
                <div style={{ fontSize: 11, color: '#475569', marginTop: 3 }}>{stack.name} — afeta todos os serviços</div>
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 8, color: '#64748b', cursor: 'pointer', padding: '5px 7px', lineHeight: 1, display: 'flex' }}>
              <X size={13} />
            </button>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            {GLOBAL_TABS.map((t) => {
              const TI = t.icon
              const isActive = tab === t.id
              return (
                <button key={t.id} onClick={() => setTab(t.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', fontSize: 10, fontWeight: isActive ? 600 : 400, color: isActive ? '#fff' : '#475569', background: isActive ? 'rgba(59,130,246,0.18)' : 'transparent', border: isActive ? '1px solid rgba(59,130,246,0.4)' : '1px solid transparent', borderRadius: 8, cursor: 'pointer', transition: 'all 0.15s', marginBottom: 4 }}>
                  <TI size={11} style={{ color: isActive ? '#60a5fa' : '#475569' }} />
                  {t.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Body ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* NETWORK */}
          {tab === 'network' && (<>
            <SectionHeader hint="Rede compartilhada entre todos os serviços da stack" tabId="network" />

            {/* Existing networks picker */}
            <Field label="Redes existentes no Docker">
              {networksLoading ? (
                <div style={{ fontSize: 11, color: '#334155', padding: '10px 0' }}>Carregando redes...</div>
              ) : dockerNetworks.length === 0 ? (
                <div style={{ fontSize: 11, color: '#334155', padding: '10px 0' }}>Nenhuma rede encontrada no Docker</div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {dockerNetworks.map((net) => {
                    const isSelected = form.networkName === net
                    return (
                      <button key={net} onClick={() => upd('networkName', isSelected ? '' : net)}
                        style={{ fontSize: 11, fontFamily: 'ui-monospace,monospace', padding: '5px 12px', borderRadius: 8, cursor: 'pointer', transition: 'all 0.15s',
                          border: isSelected ? '1px solid rgba(59,130,246,0.6)' : '1px solid rgba(255,255,255,0.09)',
                          background: isSelected ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.04)',
                          color: isSelected ? '#7dd3fc' : '#64748b',
                          fontWeight: isSelected ? 600 : 400,
                          boxShadow: isSelected ? '0 0 0 1px rgba(59,130,246,0.3)' : 'none',
                        }}>
                        {isSelected && <span style={{ marginRight: 5 }}>✓</span>}{net}
                      </button>
                    )
                  })}
                </div>
              )}
            </Field>

            <Field label="Ou crie / defina uma nova rede">
              <div style={{ display: 'flex', gap: 6 }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <GitBranch size={12} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#475569' }} />
                  <input value={newNetName} onChange={(e) => setNewNetName(e.target.value)}
                    placeholder="minha-stack-net"
                    style={{ ...inp, paddingLeft: 28 }} />
                </div>
                <button onClick={() => { if (newNetName.trim()) { upd('networkName', newNetName.trim()); setNewNetName('') } }}
                  style={{ fontSize: 10, fontWeight: 600, color: '#fff', background: 'linear-gradient(135deg,#3b82f6,#6366f1)', border: 'none', borderRadius: 10, padding: '0 14px', cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: '0 2px 10px rgba(59,130,246,0.35)', flexShrink: 0, opacity: newNetName.trim() ? 1 : 0.4 }}>
                  Usar esta
                </button>
              </div>
            </Field>

            {form.networkName && (
              <div style={{ borderRadius: 10, border: '1px solid rgba(59,130,246,0.2)', background: 'rgba(59,130,246,0.06)', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <GitBranch size={13} style={{ color: '#3b82f6', flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 10, color: '#3b82f6', fontWeight: 600 }}>Rede selecionada</div>
                  <div style={{ fontSize: 12, color: '#93c5fd', fontFamily: 'ui-monospace,monospace', marginTop: 2 }}>{form.networkName}</div>
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Driver">
                <select value={form.networkDriver} onChange={(e) => upd('networkDriver', e.target.value)} style={sel}>
                  {['bridge','overlay','host','none','macvlan'].map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </Field>
              <Field label="Subnet (CIDR)" hint="Ex: 172.20.0.0/16">
                <input value={form.subnet} onChange={(e) => upd('subnet', e.target.value)} placeholder="172.20.0.0/16" style={inp} />
              </Field>
              <Field label="Gateway" hint="Ex: 172.20.0.1">
                <input value={form.gateway} onChange={(e) => upd('gateway', e.target.value)} placeholder="172.20.0.1" style={inp} />
              </Field>
            </div>
          </>)}

          {/* DOMAIN */}
          {tab === 'domain' && (<>
            <SectionHeader hint="Domínio raiz e certificado TLS para a stack" tabId="domain" />
            <Field label="Domínio Raiz">
              <div style={{ position: 'relative' }}>
                <Globe size={12} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#475569' }} />
                <input value={form.rootDomain} onChange={(e) => upd('rootDomain', e.target.value)} placeholder="empresa.com" style={{ ...inp, paddingLeft: 28 }} />
              </div>
            </Field>
            <Toggle on={form.tls} onChange={(v) => upd('tls', v)} label="TLS / HTTPS via Let's Encrypt" hint="Certificado automático e gratuito" />
            {form.tls && (
              <Field label="E-mail ACME" hint="Usado para alertas de renovação do certificado">
                <input value={form.acmeEmail} onChange={(e) => upd('acmeEmail', e.target.value)} placeholder="admin@empresa.com" style={inp} />
              </Field>
            )}
            <Field label="Modo DNS">
              <div style={{ display: 'flex', gap: 6 }}>
                {['http','dns','tls'].map((m) => (
                  <button key={m} onClick={() => upd('dnsMode', m)}
                    style={{ flex: 1, padding: '8px 0', borderRadius: 9, fontSize: 11, fontFamily: 'ui-monospace,monospace', cursor: 'pointer', transition: 'all 0.15s',
                      border: form.dnsMode === m ? '1px solid rgba(59,130,246,0.55)' : '1px solid rgba(255,255,255,0.07)',
                      background: form.dnsMode === m ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.03)',
                      color: form.dnsMode === m ? '#7dd3fc' : '#64748b', fontWeight: form.dnsMode === m ? 600 : 400 }}>
                    {m}
                  </button>
                ))}
              </div>
            </Field>
            {form.rootDomain && (
              <div style={{ borderRadius: 10, border: '1px solid rgba(16,185,129,0.2)', background: 'rgba(16,185,129,0.06)', padding: '10px 12px' }}>
                <div style={{ fontSize: 10, color: '#10b981', fontWeight: 600, marginBottom: 4 }}>Preview</div>
                <div style={{ fontSize: 12, color: '#6ee7b7', fontFamily: 'ui-monospace,monospace' }}>
                  {form.tls ? 'https' : 'http'}://{form.rootDomain}
                </div>
              </div>
            )}
          </>)}

          {/* PROXY */}
          {tab === 'proxy' && (<>
            <SectionHeader hint="Proxy reverso e roteamento de tráfego" tabId="proxy" />
            <Field label="Tipo de Proxy">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {['traefik','nginx','caddy','haproxy','none'].map((p) => (
                  <button key={p} onClick={() => upd('proxyType', p)}
                    style={{ fontSize: 11, fontFamily: 'ui-monospace,monospace', padding: '5px 14px', borderRadius: 8, cursor: 'pointer', transition: 'all 0.15s',
                      border: form.proxyType === p ? '1px solid rgba(249,115,22,0.55)' : '1px solid rgba(255,255,255,0.09)',
                      background: form.proxyType === p ? 'rgba(249,115,22,0.15)' : 'rgba(255,255,255,0.04)',
                      color: form.proxyType === p ? '#fb923c' : '#64748b',
                      fontWeight: form.proxyType === p ? 600 : 400,
                    }}>
                    {form.proxyType === p && <span style={{ marginRight: 5 }}>✓</span>}{p}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Modo de Rota">
              <div style={{ display: 'flex', gap: 6 }}>
                {[{ v: 'subdomain', l: 'Subdomínio', ex: 'api.empresa.com' }, { v: 'path', l: 'Caminho', ex: 'empresa.com/api' }].map(({ v, l, ex }) => (
                  <button key={v} onClick={() => upd('proxyMode', v)}
                    style={{ flex: 1, padding: '10px 12px', borderRadius: 10, cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                      border: form.proxyMode === v ? '1px solid rgba(249,115,22,0.45)' : '1px solid rgba(255,255,255,0.07)',
                      background: form.proxyMode === v ? 'rgba(249,115,22,0.1)' : 'rgba(255,255,255,0.03)',
                    }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: form.proxyMode === v ? '#fb923c' : '#94a3b8' }}>{l}</div>
                    <div style={{ fontSize: 10, color: '#334155', fontFamily: 'ui-monospace,monospace', marginTop: 3 }}>{ex}</div>
                  </button>
                ))}
              </div>
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Porta HTTP">
                <input type="number" value={form.httpPort} onChange={(e) => upd('httpPort', Number(e.target.value))} style={inp} />
              </Field>
              <Field label="Porta HTTPS">
                <input type="number" value={form.httpsPort} onChange={(e) => upd('httpsPort', Number(e.target.value))} style={inp} />
              </Field>
            </div>
            <Toggle on={form.forceHttps} onChange={(v) => upd('forceHttps', v)} label="Forçar HTTPS" hint="Redireciona todo tráfego HTTP para HTTPS" />
          </>)}

          {/* REGISTRY */}
          {tab === 'registry' && (<>
            <SectionHeader hint="Registro privado de imagens Docker" tabId="registry" />
            <Field label="URL do Registro" hint="Deixe vazio para usar o Docker Hub público">
              <input value={form.registryUrl} onChange={(e) => upd('registryUrl', e.target.value)} placeholder="registry.suaempresa.com" style={inp} />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Usuário">
                <input value={form.registryUser} onChange={(e) => upd('registryUser', e.target.value)} style={monoInp} />
              </Field>
              <Field label="Token / Senha">
                <input type="password" value={form.registryToken} onChange={(e) => upd('registryToken', e.target.value)} style={monoInp} />
              </Field>
            </div>
            <Field label="E-mail">
              <input value={form.registryEmail} onChange={(e) => upd('registryEmail', e.target.value)} style={inp} />
            </Field>
            {form.registryUrl && (
              <div style={{ borderRadius: 10, border: '1px solid rgba(139,92,246,0.2)', background: 'rgba(139,92,246,0.06)', padding: '10px 12px' }}>
                <div style={{ fontSize: 10, color: '#a855f7', fontWeight: 600, marginBottom: 4 }}>Registro configurado</div>
                <div style={{ fontSize: 12, color: '#c4b5fd', fontFamily: 'ui-monospace,monospace' }}>{form.registryUrl}</div>
                {form.registryUser && <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>Usuário: {form.registryUser}</div>}
              </div>
            )}
          </>)}

          {/* POLICY */}
          {tab === 'policy' && (<>
            <SectionHeader hint="Comportamento padrão de restart, logs e fuso horário" tabId="policy" />
            <Field label="Política de Restart">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 6 }}>
                {RESTART_POLICIES.map((p) => (
                  <button key={p} onClick={() => upd('restartPolicy', p)}
                    style={{ padding: '7px 10px', borderRadius: 9, fontSize: 11, fontFamily: 'ui-monospace,monospace', cursor: 'pointer', transition: 'all 0.15s',
                      border: form.restartPolicy === p ? '1px solid rgba(16,185,129,0.5)' : '1px solid rgba(255,255,255,0.07)',
                      background: form.restartPolicy === p ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.03)',
                      color: form.restartPolicy === p ? '#4ade80' : '#64748b', fontWeight: form.restartPolicy === p ? 600 : 400 }}>
                    {p}
                  </button>
                ))}
              </div>
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Log Driver">
                <select value={form.logDriver} onChange={(e) => upd('logDriver', e.target.value)} style={sel}>
                  {['json-file','local','syslog','journald','fluentd','none'].map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </Field>
              <Field label="Tamanho Máx. Log" hint="Ex: 10m, 100m, 1g">
                <input value={form.maxLogSize} onChange={(e) => upd('maxLogSize', e.target.value)} placeholder="10m" style={monoInp} />
              </Field>
            </div>
            <Field label="Timezone">
              <input value={form.timezone} onChange={(e) => upd('timezone', e.target.value)} placeholder="America/Sao_Paulo" style={monoInp} />
            </Field>
            <Toggle on={form.swarmMode} onChange={(v) => upd('swarmMode', v)} label="Docker Swarm Mode" hint="Habilita deploy em cluster multi-servidor" />
          </>)}

          {/* ENVS */}
          {tab === 'envs' && (<>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 500 }}>
                  {form.globalEnv.length} variável{form.globalEnv.length !== 1 ? 'is' : ''} global{form.globalEnv.length !== 1 ? 'is' : ''}
                  {form.globalEnv.filter(e => e.secret).length > 0 && (
                    <span style={{ marginLeft: 8, fontSize: 10, color: '#f59e0b' }}>· {form.globalEnv.filter(e => e.secret).length} secretas</span>
                  )}
                </div>
                <HelpButton onClick={() => setHelpTab('envs')} />
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 10, color: '#7dd3fc', background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 8, padding: '4px 9px' }}>
                  <Upload size={10} /> .env
                  <input type="file" accept=".env,text/plain" style={{ display: 'none' }} onChange={loadGEnvFile} />
                </label>
                <button onClick={addGEnv} style={{ fontSize: 10, color: '#fff', background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.35)', borderRadius: 8, padding: '4px 10px', cursor: 'pointer' }}>+ Adicionar</button>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {form.globalEnv.map((e, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 3fr auto auto', gap: 6, alignItems: 'center', background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '6px 10px' }}>
                  <input value={e.key} onChange={(ev) => setGEnv(i, 'key', ev.target.value)} placeholder="CHAVE"
                    style={{ ...monoInp, background: 'transparent', border: 'none', padding: '2px 0', fontSize: 11, color: '#fbbf24' }} />
                  <input value={e.value} onChange={(ev) => setGEnv(i, 'value', ev.target.value)} placeholder="valor"
                    type={e.secret ? 'password' : 'text'}
                    style={{ ...inp, background: 'transparent', border: 'none', padding: '2px 0', fontSize: 11 }} />
                  <button onClick={() => setGEnv(i, 'secret', !e.secret)} title={e.secret ? 'Tornar visível' : 'Marcar como segredo'}
                    style={{ background: e.secret ? 'rgba(245,158,11,0.12)' : 'rgba(255,255,255,0.04)', border: `1px solid ${e.secret ? 'rgba(245,158,11,0.35)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 7, padding: '3px 6px', cursor: 'pointer', fontSize: 11, lineHeight: 1 }}>
                    {e.secret ? '🔒' : '👁'}
                  </button>
                  <button onClick={() => removeGEnv(i)} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', padding: 4, lineHeight: 1, display: 'flex' }}>
                    <X size={11} />
                  </button>
                </div>
              ))}
              {!form.globalEnv.length && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '28px 0', color: '#334155' }}>
                  <Code2 size={28} />
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 12, color: '#475569', fontWeight: 500 }}>Sem variáveis globais</div>
                    <div style={{ fontSize: 10, color: '#334155', marginTop: 4, maxWidth: 240 }}>Variáveis globais são injetadas automaticamente em todos os serviços da stack</div>
                  </div>
                </div>
              )}
            </div>
          </>)}
        </div>

        {/* ── Footer ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.06)', padding: '12px 20px' }}>
          <button onClick={onClose} style={{ fontSize: 11, color: '#475569', background: 'none', border: 'none', cursor: 'pointer' }}>Cancelar</button>
          <button onClick={handleSave}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#fff', background: 'linear-gradient(135deg,#3b82f6cc,#6366f1cc)', border: 'none', borderRadius: 10, padding: '8px 20px', cursor: 'pointer', boxShadow: '0 4px 16px rgba(59,130,246,0.4)', transition: 'opacity 0.2s' }}>
            {saved ? <><CheckCircle2 size={13} /> Salvo!</> : 'Salvar Configurações'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Painel de Configuração do Serviço ────────────────────────────────────────

const SVC_TABS = [
  { id: 'geral',    label: 'Geral',      icon: Settings },
  { id: 'acesso',   label: 'Acesso',     icon: Globe },
  { id: 'arquivos', label: 'Arquivos',   icon: Upload },
  { id: 'volumes',  label: 'Volumes',    icon: HardDrive },
  { id: 'env',      label: 'Variáveis',  icon: Code2 },
  { id: 'deps',     label: 'Depende de', icon: GitBranch },
  { id: 'avancado', label: 'Avançado',   icon: Cpu },
]

const ServiceConfigPanel = memo(({ service, stack, onSave, onDelete, onClose }) => {
  const roleCfg = SERVICE_ROLES[service.role] || SERVICE_ROLES.runtime
  const color   = roleCfg.color
  const RoleIcon = roleCfg.icon

  const [tab, setTab]   = useState('geral')
  const [saved, setSaved] = useState(false)
  const [advOpen, setAdvOpen] = useState({ resources: true, cluster: false, restart: false })

  const [form, setForm] = useState(() => ({
    name:          service.name,
    role:          service.role     || 'runtime',
    image:         service.image,
    tag:           service.tag      || 'latest',
    command:       service.command  || [],
    // Acesso
    domainMode:    service.domainMode   || 'none',
    subdomain:     service.subdomain    || '',
    pathPrefix:    service.pathPrefix   || '/',
    exposedPort:   service.exposedPort  || '',
    bindLocalOnly: service.bindLocalOnly !== false,
    ports:         service.ports        || [],
    // Arquivos de projeto
    projectFiles:  service.projectFiles || [],
    deployPath:    service.deployPath   || '/app',
    buildCmd:      service.buildCmd     || '',
    startCmd:      service.startCmd     || '',
    // Volumes
    volumes:       service.volumes      || [],
    // Env
    env:           service.env          || [],
    // Deps
    dependencies:  service.dependencies || [],
    // Avançado — recursos
    resources: {
      cpuLimit:         Number(service.resources?.cpuLimit         || 0),
      memoryMb:         Number(service.resources?.memoryMb         || 0),
      cpuReserved:      Number(service.resources?.cpuReserved      || 0),
      memoryReservedMb: Number(service.resources?.memoryReservedMb || 0),
    },
    // Avançado — cluster
    scaling: {
      replicas:    Number(service.scaling?.replicas    || 1),
      maxReplicas: Number(service.scaling?.maxReplicas || service.scaling?.replicas || 1),
      mode:        service.scaling?.mode === 'stateful' ? 'stateful' : 'stateless',
    },
    // Avançado — restart
    restartPolicy: service.restartPolicy || 'unless-stopped',
    healthcheck:   service.healthcheck   || '',
  }))

  const upd = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const otherServices = (stack.services || []).filter((s) => s.id !== service.id)

  const addPort    = () => upd('ports', [...form.ports, { host: '', container: '' }])
  const removePort = (i) => upd('ports', form.ports.filter((_, j) => j !== i))
  const setPort    = (i, k, v) => { const a = [...form.ports]; a[i] = { ...a[i], [k]: v === '' ? '' : Number(v) }; upd('ports', a) }

  const addVolume    = () => upd('volumes', [...form.volumes, { host: '', container: '' }])
  const removeVolume = (i) => upd('volumes', form.volumes.filter((_, j) => j !== i))
  const setVolume    = (i, k, v) => { const a = [...form.volumes]; a[i] = { ...a[i], [k]: v }; upd('volumes', a) }

  const addEnv    = () => upd('env', [...form.env, { key: '', value: '', secret: false }])
  const removeEnv = (i) => upd('env', form.env.filter((_, j) => j !== i))
  const setEnv    = (i, k, v) => { const a = [...form.env]; a[i] = { ...a[i], [k]: v }; upd('env', a) }
  const loadEnvFile = (e) => {
    const file = e.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const parsed = parseEnvFile(ev.target.result || '')
      upd('env', [...form.env, ...parsed.filter((p) => !form.env.some((x) => x.key === p.key))])
    }
    reader.readAsText(file)
  }

  const toggleDep = (id) => {
    const deps = form.dependencies.includes(id)
      ? form.dependencies.filter((d) => d !== id)
      : [...form.dependencies, id]
    upd('dependencies', deps)
  }

  const handleSave = async () => {
    await onSave(form)
    setSaved(true)
    setTimeout(() => setSaved(false), 1800)
  }

  // style primitives (consistent with other panels)
  const inp  = { width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.04)', padding: '8px 12px', fontSize: 12, color: '#f1f5f9', outline: 'none', boxSizing: 'border-box' }
  const mono = { ...inp, fontFamily: 'ui-monospace,monospace', fontSize: 11 }
  const sel  = { ...inp, background: 'rgba(255,255,255,0.06)', cursor: 'pointer' }

  const Field = ({ label: fl, children, hint }) => (
    <div>
      <label style={{ display: 'block', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b', marginBottom: 6 }}>{fl}</label>
      {children}
      {hint && <p style={{ fontSize: 10, color: '#334155', marginTop: 4 }}>{hint}</p>}
    </div>
  )

  const AdvGroup = ({ id, icon: GI, title, color: gc, children }) => (
    <div style={{ borderRadius: 12, border: `1px solid ${gc}22`, overflow: 'hidden' }}>
      <button onClick={() => setAdvOpen(p => ({ ...p, [id]: !p[id] }))}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: `${gc}0a`, border: 'none', cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <GI size={13} style={{ color: gc }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: '#cbd5e1' }}>{title}</span>
        </div>
        <span style={{ fontSize: 14, color: '#475569', transform: advOpen[id] ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>›</span>
      </button>
      {advOpen[id] && (
        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10, borderTop: `1px solid ${gc}15` }}>
          {children}
        </div>
      )}
    </div>
  )

  const addProjectFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return
    e.target.value = ""

    const CHUNK_SIZE = 5 * 1024 * 1024 // 5 MB
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
    const fileEntry = { name: file.name, size: file.size, type: file.type, uploading: true, progress: 0 }

    setForm(f => ({ ...f, projectFiles: [...(f.projectFiles || []), fileEntry] }))

    const updateFile = (patch) =>
      setForm(f => ({ ...f, projectFiles: (f.projectFiles || []).map(x => x.name === file.name ? { ...x, ...patch } : x) }))

    try {
      if (totalChunks <= 1) {
        const formData = new FormData()
        formData.append("file", file)
        await uploadApi.post(`/stacks/${stack.id}/services/${service.id}/upload`, formData, {
          headers: { "Content-Type": "multipart/form-data" },
          timeout: 300000,
          onUploadProgress: (ev) => updateFile({ progress: Math.round((ev.loaded / ev.total) * 100) })
        })
      } else {
        const initRes = await api.post(`/stacks/${stack.id}/services/${service.id}/upload/init`, {
          filename: file.name, size: file.size, totalChunks
        })
        const { uploadId } = initRes.data

        for (let i = 0; i < totalChunks; i++) {
          const chunk = file.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
          const fd = new FormData()
          fd.append('chunk', chunk, file.name)
          fd.append('uploadId', uploadId)
          fd.append('chunkIndex', String(i))
          await uploadApi.post(`/stacks/${stack.id}/services/${service.id}/upload/chunk`, fd, {
            headers: { "Content-Type": "multipart/form-data" },
            timeout: 120000
          })
          updateFile({ progress: Math.round(((i + 1) / totalChunks) * 100) })
        }

        await api.post(`/stacks/${stack.id}/services/${service.id}/upload/complete`, { uploadId })
      }

      updateFile({ uploading: false, uploaded: true, progress: 100 })
    } catch (err) {
      setForm(f => ({ ...f, projectFiles: (f.projectFiles || []).filter(x => x.name !== file.name) }))
    }
  }
  const removeProjectFile = (i) => upd("projectFiles", form.projectFiles.filter((_, j) => j !== i))

  // badge counts for tabs
  const tabBadge = {
    acesso:   (form.ports.length || form.subdomain || form.pathPrefix !== '/') ? true : false,
    arquivos: form.projectFiles.length > 0,
    volumes:  form.volumes.length > 0,
    env:      form.env.length > 0,
    deps:     form.dependencies.length > 0,
    avancado: (form.resources.cpuLimit || form.resources.memoryMb || form.scaling.replicas > 1 || form.restartPolicy !== 'unless-stopped'),
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', borderRadius: 18, border: '1px solid rgba(255,255,255,0.08)', background: 'linear-gradient(160deg,#080f1e,#060c18)', overflow: 'hidden' }}>

      {/* ── Header ── */}
      <div style={{ padding: '13px 14px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, background: `${color}18`, border: `1px solid ${color}35`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <RoleIcon size={14} style={{ color }} />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#f1f5f9', lineHeight: 1.2 }}>{form.name || service.name}</div>
              <div style={{ fontSize: 10, color: '#475569', marginTop: 2, fontFamily: 'ui-monospace,monospace' }}>{form.image}:{form.tag}</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 7, color: '#64748b', cursor: 'pointer', padding: '4px 6px', lineHeight: 1, display: 'flex' }}>
            <X size={12} />
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
          {SVC_TABS.map((t) => {
            const TI = t.icon
            const isActive = tab === t.id
            const hasBadge = tabBadge[t.id]
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', fontSize: 10, fontWeight: isActive ? 600 : 400, color: isActive ? '#fff' : '#475569', background: isActive ? `${color}22` : 'transparent', border: isActive ? `1px solid ${color}45` : '1px solid transparent', borderRadius: 7, cursor: 'pointer', transition: 'all 0.15s', marginBottom: 3 }}>
                <TI size={10} style={{ color: isActive ? color : '#475569' }} />
                {t.label}
                {hasBadge && !isActive && <span style={{ width: 5, height: 5, borderRadius: '50%', background: color, position: 'absolute', top: 4, right: 4 }} />}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: 11 }}>

        {/* GERAL */}
        {tab === 'geral' && (<>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Nome do Serviço">
              <input value={form.name} onChange={(e) => upd('name', e.target.value)} style={inp} placeholder="meu-servico" />
            </Field>
            <Field label="Papel / Função">
              <select value={form.role} onChange={(e) => upd('role', e.target.value)} style={sel}>
                {Object.entries(SERVICE_ROLES).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
            <Field label="Imagem Docker">
              <input value={form.image} onChange={(e) => upd('image', e.target.value)} style={mono} placeholder="nginx" />
            </Field>
            <Field label="Tag / Versão">
              <input value={form.tag} onChange={(e) => upd('tag', e.target.value)} style={mono} placeholder="latest" />
            </Field>
          </div>
          <Field label="Comando de inicialização" hint="Sobrescreve o CMD padrão da imagem. Deixe vazio para usar o padrão.">
            <input value={Array.isArray(form.command) ? form.command.join(' ') : form.command}
              onChange={(e) => upd('command', e.target.value ? e.target.value.split(' ') : [])}
              style={{ ...mono, fontSize: 11 }} placeholder="node server.js" />
          </Field>
          {/* Role description card */}
          <div style={{ borderRadius: 10, border: `1px solid ${color}20`, background: `${color}07`, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <RoleIcon size={16} style={{ color, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#cbd5e1' }}>{roleCfg.label}</div>
              <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>{roleCfg.description}</div>
            </div>
          </div>
        </>)}

        {/* ACESSO */}
        {tab === 'acesso' && (<>
          {/* Domain */}
          <div style={{ borderRadius: 12, border: '1px solid rgba(16,185,129,0.2)', background: 'rgba(16,185,129,0.04)', padding: '12px' }}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#10b981', marginBottom: 10 }}>Domínio do Serviço</div>
            <Field label="Modo de Roteamento">
              <div style={{ display: 'flex', gap: 6 }}>
                {[
                  { v: 'subdomain', l: 'Subdomínio', ex: 'api.empresa.com' },
                  { v: 'path',      l: 'Caminho',    ex: 'empresa.com/api' },
                  { v: 'none',      l: 'Nenhum',     ex: 'somente porta' },
                ].map(({ v, l, ex }) => (
                  <button key={v} onClick={() => upd('domainMode', v)}
                    style={{ flex: 1, padding: '8px 6px', borderRadius: 9, cursor: 'pointer', textAlign: 'center', transition: 'all 0.15s',
                      border: form.domainMode === v ? '1px solid rgba(16,185,129,0.5)' : '1px solid rgba(255,255,255,0.07)',
                      background: form.domainMode === v ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.03)',
                    }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: form.domainMode === v ? '#34d399' : '#94a3b8' }}>{l}</div>
                    <div style={{ fontSize: 9, color: '#334155', fontFamily: 'ui-monospace,monospace', marginTop: 2 }}>{ex}</div>
                  </button>
                ))}
              </div>
            </Field>
            {form.domainMode === 'subdomain' && (
              <div style={{ marginTop: 10 }}>
                <Field label="Subdomínio" hint="Prefixo antes do domínio raiz da stack">
                  <div style={{ position: 'relative' }}>
                    <Globe size={11} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#475569' }} />
                    <input value={form.subdomain} onChange={(e) => upd('subdomain', e.target.value)}
                      placeholder="api" style={{ ...mono, paddingLeft: 28 }} />
                  </div>
                </Field>
                {form.subdomain && (
                  <div style={{ marginTop: 8, borderRadius: 8, background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)', padding: '7px 10px' }}>
                    <div style={{ fontSize: 10, color: '#6ee7b7', fontFamily: 'ui-monospace,monospace' }}>
                      https://<span style={{ color: '#34d399', fontWeight: 700 }}>{form.subdomain}</span>.{'{dominio-da-stack}'}
                    </div>
                  </div>
                )}
              </div>
            )}
            {form.domainMode === 'path' && (
              <div style={{ marginTop: 10 }}>
                <Field label="Path Prefix" hint="Caminho após o domínio raiz da stack">
                  <input value={form.pathPrefix} onChange={(e) => upd('pathPrefix', e.target.value)}
                    placeholder="/api" style={mono} />
                </Field>
                {form.pathPrefix && (
                  <div style={{ marginTop: 8, borderRadius: 8, background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)', padding: '7px 10px' }}>
                    <div style={{ fontSize: 10, color: '#6ee7b7', fontFamily: 'ui-monospace,monospace' }}>
                      https://{'{ dominio-da-stack }'}<span style={{ color: '#34d399', fontWeight: 700 }}>{form.pathPrefix}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
            {form.domainMode !== 'none' && (
              <div style={{ marginTop: 10 }}>
                <Field label="Porta do container" hint="Porta interna que o proxy vai encaminhar">
                  <input type="number" value={form.exposedPort} onChange={(e) => upd('exposedPort', e.target.value)}
                    placeholder="3000" style={inp} />
                </Field>
              </div>
            )}
          </div>

          {/* Ports */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <label style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b' }}>Mapeamento de Portas</label>
              <button onClick={addPort} style={{ fontSize: 10, color: '#7dd3fc', background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 7, padding: '3px 9px', cursor: 'pointer' }}>+ Porta</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {form.ports.map((p, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr auto', gap: 6, alignItems: 'center' }}>
                  <input value={p.host} onChange={(e) => setPort(i, 'host', e.target.value)} placeholder="Host"
                    style={{ ...mono, fontSize: 11 }} />
                  <span style={{ color: '#334155', fontSize: 12, textAlign: 'center' }}>→</span>
                  <input value={p.container} onChange={(e) => setPort(i, 'container', e.target.value)} placeholder="Container"
                    style={{ ...mono, fontSize: 11 }} />
                  <button onClick={() => removePort(i)} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', padding: 3, lineHeight: 1, display: 'flex' }}><X size={11} /></button>
                </div>
              ))}
              {!form.ports.length && (
                <div style={{ textAlign: 'center', padding: '12px 0', fontSize: 11, color: '#334155' }}>Nenhuma porta exposta</div>
              )}
            </div>
          </div>

          {/* Bind localhost */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.bindLocalOnly} onChange={(e) => upd('bindLocalOnly', e.target.checked)}
              style={{ width: 16, height: 16, accentColor: '#3b82f6' }} />
            <div>
              <div style={{ fontSize: 12, color: '#cbd5e1', fontWeight: 500 }}>Expor apenas em localhost</div>
              <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>Porta acessível apenas internamente (127.0.0.1). Recomendado quando usa proxy reverso.</div>
            </div>
          </label>

          {/* Network shortcut */}
          <div style={{ borderRadius: 10, border: '1px solid rgba(59,130,246,0.2)', background: 'rgba(59,130,246,0.04)', padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <GitBranch size={14} style={{ color: '#3b82f6', flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 10, color: '#3b82f6', fontWeight: 600 }}>Rede da Stack</div>
                <div style={{ fontSize: 12, color: '#93c5fd', fontFamily: 'ui-monospace,monospace', marginTop: 1 }}>{stack?.network || 'bridge'}</div>
              </div>
            </div>
            <button onClick={() => { onClose(); setTimeout(() => document.querySelector('[data-tab="stack-config"]')?.click(), 100) }}
              style={{ fontSize: 10, color: '#7dd3fc', background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 7, padding: '4px 10px', cursor: 'pointer' }}>
              Configurar Rede
            </button>
          </div>
        </>)}

        {/* ARQUIVOS */}
        {tab === 'arquivos' && (<>
          {/* Upload zone */}
          <label style={{ display: 'block', borderRadius: 14, border: '2px dashed rgba(99,102,241,0.3)', background: 'rgba(99,102,241,0.04)', padding: '24px 16px', textAlign: 'center', cursor: 'pointer', transition: 'border-color 0.2s, background 0.2s' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor='rgba(99,102,241,0.55)'; e.currentTarget.style.background='rgba(99,102,241,0.08)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor='rgba(99,102,241,0.3)'; e.currentTarget.style.background='rgba(99,102,241,0.04)' }}>
            <input type="file" accept=".zip,.tar,.tar.gz,.tgz,.tar.bz2" style={{ display: 'none' }} onChange={addProjectFile} />
            <div style={{ width: 44, height: 44, borderRadius: 13, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', boxShadow: '0 4px 16px rgba(99,102,241,0.4)' }}>
              <Upload size={20} style={{ color: '#fff' }} />
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#c4b5fd', marginBottom: 4 }}>Arraste ou clique para enviar o projeto</div>
            <div style={{ fontSize: 11, color: '#475569' }}>.zip · .tar · .tar.gz aceitos</div>
          </label>

          {/* Uploaded files list */}
          {form.projectFiles.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {form.projectFiles.map((f, i) => {
                const ext = f.name.split('.').pop()?.toLowerCase()
                const extColors = { zip: '#f59e0b', tar: '#10b981', gz: '#06b6d4', tgz: '#06b6d4', bz2: '#a855f7' }
                const extColor = extColors[ext] || '#64748b'
                const sizeMb = (f.size / (1024 * 1024)).toFixed(2)
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 11, padding: '10px 12px' }}>
                    <div style={{ width: 36, height: 36, borderRadius: 9, background: `${extColor}18`, border: `1px solid ${extColor}35`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span style={{ fontSize: 9, fontWeight: 800, color: extColor, fontFamily: 'ui-monospace,monospace', textTransform: 'uppercase' }}>.{ext}</span>
                    </div>
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <div style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                      <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>{sizeMb} MB</div>
                      {f.uploading && (
                        <div style={{ marginTop: 5 }}>
                          <div style={{ height: 3, borderRadius: 2, background: 'rgba(99,102,241,0.15)', overflow: 'hidden' }}>
                            <div style={{ height: '100%', borderRadius: 2, background: 'linear-gradient(90deg,#6366f1,#8b5cf6)', width: `${f.progress || 0}%`, transition: 'width 0.3s' }} />
                          </div>
                          <div style={{ fontSize: 9, color: '#818cf8', marginTop: 2 }}>{f.progress || 0}%</div>
                        </div>
                      )}
                    </div>
                    <button onClick={() => removeProjectFile(i)} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', padding: 4, lineHeight: 1, display: 'flex', flexShrink: 0 }}>
                      <X size={12} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Deploy config */}
          <div style={{ borderRadius: 12, border: '1px solid rgba(99,102,241,0.18)', background: 'rgba(99,102,241,0.04)', padding: '12px' }}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#818cf8', marginBottom: 10 }}>Configuração de Deploy</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Field label="Caminho no container" hint="Onde o conteúdo do arquivo será extraído">
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: '#475569', fontFamily: 'ui-monospace,monospace' }}>/</span>
                  <input value={form.deployPath.replace(/^\//, '')} onChange={(e) => upd('deployPath', '/' + e.target.value.replace(/^\//, ''))}
                    placeholder="app" style={{ ...mono, paddingLeft: 20 }} />
                </div>
              </Field>
              <Field label="Comando de Build" hint="Executado após extrair os arquivos (opcional)">
                <input value={form.buildCmd} onChange={(e) => upd('buildCmd', e.target.value)}
                  placeholder="npm install && npm run build" style={{ ...mono, fontSize: 11 }} />
              </Field>
              <Field label="Comando de Inicialização" hint="Sobrescreve o CMD da imagem após o build (opcional)">
                <input value={form.startCmd} onChange={(e) => upd('startCmd', e.target.value)}
                  placeholder="node dist/server.js" style={{ ...mono, fontSize: 11 }} />
              </Field>
            </div>
          </div>

          {/* Preview */}
          {form.projectFiles.length > 0 && (
            <div style={{ borderRadius: 10, border: '1px solid rgba(99,102,241,0.15)', background: 'rgba(6,2,20,0.5)', padding: '10px 12px' }}>
              <div style={{ fontSize: 10, color: '#6366f1', fontWeight: 600, marginBottom: 8 }}>Preview do fluxo de deploy:</div>
              {[
                { step: '1', label: 'Upload', desc: `${form.projectFiles.map(f => f.name).join(', ')}`, color: '#8b5cf6' },
                { step: '2', label: 'Extração', desc: `→ container em ${form.deployPath}`, color: '#6366f1' },
                form.buildCmd && { step: '3', label: 'Build', desc: form.buildCmd, color: '#3b82f6' },
                form.startCmd && { step: form.buildCmd ? '4' : '3', label: 'Start', desc: form.startCmd, color: '#10b981' },
              ].filter(Boolean).map((s) => (
                <div key={s.step} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 6 }}>
                  <div style={{ width: 18, height: 18, borderRadius: '50%', background: `${s.color}20`, border: `1px solid ${s.color}45`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: s.color }}>{s.step}</span>
                  </div>
                  <div>
                    <span style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8' }}>{s.label}: </span>
                    <span style={{ fontSize: 10, color: '#475569', fontFamily: 'ui-monospace,monospace' }}>{s.desc}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!form.projectFiles.length && (
            <div style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)', padding: '12px', fontSize: 11, color: '#334155', lineHeight: 1.6 }}>
              💡 <span style={{ color: '#475569' }}>Envie um .zip com o código-fonte do projeto. O painel irá extrair os arquivos no container e executar os comandos de build e start configurados abaixo.</span>
            </div>
          )}
        </>)}

        {/* VOLUMES */}
        {tab === 'volumes' && (<>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 500 }}>{form.volumes.length} volume{form.volumes.length !== 1 ? 's' : ''}</div>
            <button onClick={addVolume} style={{ fontSize: 10, color: '#c4b5fd', background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.25)', borderRadius: 7, padding: '3px 10px', cursor: 'pointer' }}>+ Volume</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {form.volumes.map((v, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr auto', gap: 6, alignItems: 'center' }}>
                <input value={v.host} onChange={(e) => setVolume(i, 'host', e.target.value)} placeholder="Host / Volume"
                  style={{ ...mono, fontSize: 11 }} />
                <span style={{ color: '#334155', fontSize: 12, textAlign: 'center' }}>:</span>
                <input value={v.container} onChange={(e) => setVolume(i, 'container', e.target.value)} placeholder="Caminho no container"
                  style={{ ...mono, fontSize: 11 }} />
                <button onClick={() => removeVolume(i)} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', padding: 3, lineHeight: 1, display: 'flex' }}><X size={11} /></button>
              </div>
            ))}
            {!form.volumes.length && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '24px 0', color: '#334155' }}>
                <HardDrive size={26} />
                <div style={{ fontSize: 11, color: '#475569', fontWeight: 500 }}>Sem volumes</div>
                <div style={{ fontSize: 10, color: '#334155', textAlign: 'center', maxWidth: 200 }}>Volumes persistem dados mesmo quando o container reinicia</div>
              </div>
            )}
          </div>
          {form.volumes.length > 0 && (
            <div style={{ borderRadius: 10, border: '1px solid rgba(168,85,247,0.15)', background: 'rgba(168,85,247,0.05)', padding: '10px 12px' }}>
              <div style={{ fontSize: 10, color: '#a855f7', fontWeight: 600, marginBottom: 6 }}>Preview docker-compose volumes:</div>
              {form.volumes.map((v, i) => v.container && (
                <div key={i} style={{ fontSize: 10, fontFamily: 'ui-monospace,monospace', color: '#64748b', lineHeight: 1.8 }}>
                  <span style={{ color: '#475569' }}>  - </span>
                  <span style={{ color: '#c4b5fd' }}>{v.host || '.'}</span>
                  <span style={{ color: '#475569' }}>:</span>
                  <span style={{ color: '#6ee7b7' }}>{v.container}</span>
                </div>
              ))}
            </div>
          )}
        </>)}

        {/* ENV */}
        {tab === 'env' && (<>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 500 }}>
              {form.env.length} variável{form.env.length !== 1 ? 'is' : ''}
              {form.env.filter(e => e.secret).length > 0 && (
                <span style={{ marginLeft: 8, fontSize: 10, color: '#f59e0b' }}>· {form.env.filter(e => e.secret).length} secretas</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 10, color: '#7dd3fc', background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 7, padding: '3px 8px' }}>
                <Upload size={10} /> .env
                <input type="file" accept=".env,text/plain" style={{ display: 'none' }} onChange={loadEnvFile} />
              </label>
              <button onClick={addEnv} style={{ fontSize: 10, color: '#fff', background: `${color}22`, border: `1px solid ${color}40`, borderRadius: 7, padding: '3px 9px', cursor: 'pointer' }}>+ Adicionar</button>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {form.env.map((e, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 3fr auto auto', gap: 6, alignItems: 'center', background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '5px 9px' }}>
                <input value={e.key} onChange={(ev) => setEnv(i, 'key', ev.target.value)} placeholder="CHAVE"
                  style={{ ...mono, background: 'transparent', border: 'none', padding: '2px 0', fontSize: 11, color: '#fbbf24' }} />
                <input value={e.value} onChange={(ev) => setEnv(i, 'value', ev.target.value)} placeholder="valor"
                  type={e.secret ? 'password' : 'text'}
                  style={{ ...inp, background: 'transparent', border: 'none', padding: '2px 0', fontSize: 11 }} />
                <button onClick={() => setEnv(i, 'secret', !e.secret)} title={e.secret ? 'Mostrar' : 'Ocultar'}
                  style={{ background: e.secret ? 'rgba(245,158,11,0.12)' : 'rgba(255,255,255,0.04)', border: `1px solid ${e.secret ? 'rgba(245,158,11,0.35)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 7, padding: '3px 6px', cursor: 'pointer', fontSize: 11, lineHeight: 1 }}>
                  {e.secret ? '🔒' : '👁'}
                </button>
                <button onClick={() => removeEnv(i)} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', padding: 3, lineHeight: 1, display: 'flex' }}><X size={11} /></button>
              </div>
            ))}
            {!form.env.length && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '24px 0', color: '#334155' }}>
                <Code2 size={26} />
                <div style={{ fontSize: 11, color: '#475569', fontWeight: 500 }}>Sem variáveis</div>
                <div style={{ fontSize: 10, color: '#334155', textAlign: 'center', maxWidth: 200 }}>Adicione ou importe um arquivo .env</div>
              </div>
            )}
          </div>
        </>)}

        {/* DEPS */}
        {tab === 'deps' && (<>
          <div style={{ fontSize: 11, color: '#475569', marginBottom: 4 }}>
            Serviços que precisam estar rodando antes deste iniciar.
          </div>
          {otherServices.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0', fontSize: 11, color: '#334155' }}>Sem outros serviços na stack</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {otherServices.map((s) => {
                const isDep = form.dependencies.includes(s.id)
                const cfg   = SERVICE_ROLES[s.role] || SERVICE_ROLES.runtime
                const SI    = cfg.icon
                return (
                  <button key={s.id} onClick={() => toggleDep(s.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 10, cursor: 'pointer', transition: 'all 0.15s',
                      border: isDep ? `1px solid ${cfg.color}55` : '1px solid rgba(255,255,255,0.09)',
                      background: isDep ? `${cfg.color}14` : 'rgba(255,255,255,0.03)',
                    }}>
                    <SI size={11} style={{ color: isDep ? cfg.color : '#475569' }} />
                    <span style={{ fontSize: 11, color: isDep ? cfg.color : '#94a3b8', fontWeight: isDep ? 600 : 400 }}>{s.name}</span>
                    {isDep && <span style={{ fontSize: 9, color: cfg.color }}>✓</span>}
                  </button>
                )
              })}
            </div>
          )}
          {form.dependencies.length > 0 && (
            <div style={{ borderRadius: 10, border: '1px solid rgba(99,102,241,0.15)', background: 'rgba(99,102,241,0.05)', padding: '10px 12px' }}>
              <div style={{ fontSize: 10, color: '#818cf8', fontWeight: 600, marginBottom: 6 }}>Preview docker-compose depends_on:</div>
              {form.dependencies.map((depId) => {
                const dep = otherServices.find(s => s.id === depId)
                return dep ? (
                  <div key={depId} style={{ fontSize: 10, fontFamily: 'ui-monospace,monospace', color: '#64748b', lineHeight: 1.8 }}>
                    <span style={{ color: '#475569' }}>  - </span><span style={{ color: '#a5b4fc' }}>{dep.name}</span>
                  </div>
                ) : null
              })}
            </div>
          )}
        </>)}

        {/* AVANÇADO */}
        {tab === 'avancado' && (<>
          <AdvGroup id="resources" icon={Cpu} title="Recursos do Container" color="#f97316">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="CPU Limit" hint="cores (0 = sem limite)">
                <div style={{ position: 'relative' }}>
                  <Cpu size={11} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#475569' }} />
                  <input type="number" step="0.1" min="0" value={form.resources.cpuLimit}
                    onChange={(e) => upd('resources', { ...form.resources, cpuLimit: Number(e.target.value || 0) })}
                    placeholder="0" style={{ ...inp, paddingLeft: 28 }} />
                </div>
              </Field>
              <Field label="Memória Limit" hint="MB (0 = sem limite)">
                <div style={{ position: 'relative' }}>
                  <Server size={11} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#475569' }} />
                  <input type="number" step="64" min="0" value={form.resources.memoryMb}
                    onChange={(e) => upd('resources', { ...form.resources, memoryMb: Number(e.target.value || 0) })}
                    placeholder="0" style={{ ...inp, paddingLeft: 28 }} />
                </div>
              </Field>
              <Field label="CPU Reservado">
                <input type="number" step="0.1" min="0" value={form.resources.cpuReserved}
                  onChange={(e) => upd('resources', { ...form.resources, cpuReserved: Number(e.target.value || 0) })}
                  placeholder="0" style={inp} />
              </Field>
              <Field label="RAM Reservada" hint="MB">
                <input type="number" step="64" min="0" value={form.resources.memoryReservedMb}
                  onChange={(e) => upd('resources', { ...form.resources, memoryReservedMb: Number(e.target.value || 0) })}
                  placeholder="0" style={inp} />
              </Field>
            </div>
            {(form.resources.cpuLimit > 0 || form.resources.memoryMb > 0) && (
              <div style={{ display: 'flex', gap: 8 }}>
                {form.resources.cpuLimit > 0 && <div style={{ flex: 1, background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.2)', borderRadius: 9, padding: '8px 0', textAlign: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#fb923c' }}>{form.resources.cpuLimit}</div>
                  <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 2 }}>CPU</div>
                </div>}
                {form.resources.memoryMb > 0 && <div style={{ flex: 1, background: 'rgba(236,72,153,0.08)', border: '1px solid rgba(236,72,153,0.2)', borderRadius: 9, padding: '8px 0', textAlign: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#f472b6' }}>{form.resources.memoryMb}</div>
                  <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 2 }}>MB RAM</div>
                </div>}
              </div>
            )}
          </AdvGroup>

          <AdvGroup id="cluster" icon={Activity} title="Cluster & Scaling" color="#3b82f6">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Réplicas" hint="Instâncias ativas agora">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button onClick={() => upd('scaling', { ...form.scaling, replicas: Math.max(1, form.scaling.replicas - 1) })}
                    style={{ width: 28, height: 28, borderRadius: 7, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', cursor: 'pointer', fontSize: 16, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>−</button>
                  <input type="number" min="1" value={form.scaling.replicas}
                    onChange={(e) => upd('scaling', { ...form.scaling, replicas: Math.max(1, Number(e.target.value || 1)) })}
                    style={{ ...inp, textAlign: 'center' }} />
                  <button onClick={() => upd('scaling', { ...form.scaling, replicas: form.scaling.replicas + 1 })}
                    style={{ width: 28, height: 28, borderRadius: 7, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', cursor: 'pointer', fontSize: 16, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>+</button>
                </div>
              </Field>
              <Field label="Máx. Réplicas" hint="Teto de crescimento">
                <input type="number" min="1" value={form.scaling.maxReplicas}
                  onChange={(e) => upd('scaling', { ...form.scaling, maxReplicas: Math.max(1, Number(e.target.value || 1)) })}
                  style={inp} />
              </Field>
            </div>
            <Field label="Modo de Scaling">
              <div style={{ display: 'flex', gap: 6 }}>
                {[
                  { v: 'stateless', l: 'Stateless', desc: 'Réplicas intercambiáveis, sem estado próprio' },
                  { v: 'stateful',  l: 'Stateful',  desc: 'Cada réplica tem estado próprio (ex: banco)' },
                ].map(({ v, l, desc }) => (
                  <button key={v} onClick={() => upd('scaling', { ...form.scaling, mode: v })}
                    style={{ flex: 1, padding: '8px 10px', borderRadius: 9, cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                      border: form.scaling.mode === v ? '1px solid rgba(59,130,246,0.5)' : '1px solid rgba(255,255,255,0.07)',
                      background: form.scaling.mode === v ? 'rgba(59,130,246,0.12)' : 'rgba(255,255,255,0.03)',
                    }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: form.scaling.mode === v ? '#7dd3fc' : '#94a3b8' }}>{l}</div>
                    <div style={{ fontSize: 9, color: '#334155', marginTop: 3, lineHeight: 1.4 }}>{desc}</div>
                  </button>
                ))}
              </div>
            </Field>
            {form.scaling.replicas > 1 && (
              <div style={{ borderRadius: 9, border: '1px solid rgba(59,130,246,0.2)', background: 'rgba(59,130,246,0.06)', padding: '8px 11px', fontSize: 10, color: '#93c5fd', lineHeight: 1.5 }}>
                ⚠ Réplicas {'>'}1 requerem load balancer na entrada. Portas serão incrementadas automaticamente.
              </div>
            )}
          </AdvGroup>

          <AdvGroup id="restart" icon={RefreshCw} title="Restart & Healthcheck" color="#10b981">
            <Field label="Política de Restart">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 6 }}>
                {RESTART_POLICIES.map((p) => (
                  <button key={p} onClick={() => upd('restartPolicy', p)}
                    style={{ padding: '7px 10px', borderRadius: 9, fontSize: 11, fontFamily: 'ui-monospace,monospace', cursor: 'pointer', transition: 'all 0.15s',
                      border: form.restartPolicy === p ? '1px solid rgba(16,185,129,0.5)' : '1px solid rgba(255,255,255,0.07)',
                      background: form.restartPolicy === p ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.03)',
                      color: form.restartPolicy === p ? '#4ade80' : '#64748b', fontWeight: form.restartPolicy === p ? 600 : 400 }}>
                    {p}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Healthcheck Command" hint="Deixe vazio para usar o padrão da imagem">
              <input value={form.healthcheck} onChange={(e) => upd('healthcheck', e.target.value)}
                placeholder="CMD curl -f http://localhost/ || exit 1"
                style={{ ...mono, fontSize: 10 }} />
            </Field>
          </AdvGroup>
        </>)}
      </div>

      {/* ── Footer ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.06)', padding: '10px 14px' }}>
        <button onClick={() => onDelete(service.id)}
          style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#f87171', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: 9, padding: '6px 12px', cursor: 'pointer' }}>
          <Trash2 size={11} /> Remover
        </button>
        <button onClick={handleSave}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#fff', background: `linear-gradient(135deg,${color}cc,${color}88)`, border: 'none', borderRadius: 9, padding: '7px 16px', cursor: 'pointer', boxShadow: `0 4px 14px ${color}40`, transition: 'opacity 0.2s' }}>
          {saved ? <><CheckCircle2 size={12} /> Salvo!</> : <><CheckCircle2 size={12} /> Salvar</>}
        </button>
      </div>
    </div>
  )
})

// ─── Modal de Adicionar Serviço ────────────────────────────────────────────────

// helper: infer role from image name
const inferRoleFromImage = (imageName) => {
  if (!imageName) return 'runtime'
  const name = imageName.toLowerCase()
  for (const [role, hints] of Object.entries(CANVAS_ROLE_HINTS)) {
    if (hints.some((h) => name.includes(h))) return role
  }
  return 'runtime'
}

const AddServiceModal = ({ onAdd, onClose, stageKey = null, stack = null }) => {
  const stageHint = stageKey ? STAGE_SERVICE_HINTS[stageKey] : null
  const [step, setStep] = useState(1) // 1=choose, 2=configure, 3=confirm
  const [selectedCatalog, setSelectedCatalog] = useState(null)
  const [mode, setMode] = useState('catalog') // 'catalog' | 'dockerfile' | 'custom'
  const [dockerfile, setDockerfile] = useState('')
  const [buildName, setBuildName] = useState('')
  const [building, setBuilding] = useState(false)
  const [serverImages, setServerImages] = useState([])
  const [imagesLoaded, setImagesLoaded] = useState(false)
  const [buildLog, setBuildLog] = useState([])
  const [contextFile, setContextFile] = useState(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [form, setForm] = useState({
    name: '', role: stageHint?.defaultRole || 'runtime',
    image: '', tag: 'latest',
    ports: [], volumes: [], env: [], command: [], dependencies: []
  })


  useEffect(() => {
    api.get("/docker/images").then((r) => {
      const raw = Array.isArray(r.data?.images) ? r.data.images : []
      const entries = []
      raw.forEach((img) => {
        const tags = Array.isArray(img.RepoTags) ? img.RepoTags.filter((t) => t && t !== "<none>:<none>") : []
        if (!tags.length) return
        tags.forEach((tag) => {
          const [repo, ver] = tag.split(":")
          const name = repo.split("/").pop()
          if (!name || name === "none") return
          entries.push({ id: img.Id, repo, name, tag: ver || "latest", size: img.Size })
        })
      })
      setServerImages(entries)
      setImagesLoaded(true)
    }).catch(() => setImagesLoaded(true))
  }, [])

  const filteredCatalog = stageHint
    ? SERVICE_CATALOG.filter((s) => {
        if (stageHint.presetNames?.length && stageHint.presetNames.includes(s.id)) return true
        return stageHint.allowedRoles?.includes(s.role)
      })
    : SERVICE_CATALOG

  const selectFromCatalog = (item) => {
    setSelectedCatalog(item)
    setMode('catalog')
    setForm({
      name: item.name.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      role: item.role,
      image: item.image,
      tag: item.tag,
      ports: [...(item.ports || [])],
      volumes: [...(item.volumes || [])],
      env: (item.env || []).map((e) => ({ ...e })),
      command: item.command || [],
      dependencies: []
    })
    setStep(2)
  }

  const selectCustom = () => {
    setSelectedCatalog(null)
    setMode('custom')
    setForm({
      name: '', role: stageHint?.defaultRole || 'runtime',
      image: '', tag: 'latest',
      ports: [], volumes: [], env: [], command: [], dependencies: []
    })
    setStep(2)
  }

  const selectDockerfile = () => {
    setSelectedCatalog(null)
    setMode('dockerfile')
    setBuildName('')
    setDockerfile('')
    setBuildLog([])
    setStep(2)
  }

  const handleBuildImage = async () => {
    if (!buildName.trim() || !dockerfile.trim()) return
    setBuilding(true)
    setBuildLog(['\ud83d\udd28 Iniciando build...'])

    // Show progress messages while waiting
    const progressInterval = setInterval(() => {
      setBuildLog((prev) => {
        const msgs = [
          '\ud83d\udce6 Enviando contexto para o Docker...',
          '\u2699\ufe0f  Processando camadas do Dockerfile...',
          '\ud83d\udd04 Executando comandos RUN...',
          '\ud83d\udcbe Salvando camadas intermediarias...',
        ]
        const nextIdx = prev.length - 1
        if (nextIdx < msgs.length) return [...prev, msgs[nextIdx]]
        return prev
      })
    }, 3000)

    try {
      const formData = new FormData()
      formData.append('imageName', buildName.trim())
      formData.append('dockerfileContent', dockerfile)
      if (contextFile) {
        formData.append('contextArchive', contextFile)
        setBuildLog((prev) => [...prev, `\ud83d\udcc1 Enviando ${contextFile.name} (${(contextFile.size / 1024 / 1024).toFixed(1)} MB)...`])
      }
      const res = await uploadApi.post('/docker/images/build', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 600000
      })
      const progress = res.data?.progress || []
      setBuildLog((prev) => [...prev, ...progress, '\u2705 Build conclu\u00eddo!'])
      // Set form with built image
      setForm({
        name: buildName.trim().split('/').pop().split(':')[0],
        role: stageHint?.defaultRole || 'runtime',
        image: buildName.trim().split(':')[0],
        tag: buildName.trim().split(':')[1] || 'latest',
        ports: [{ host: 3000, container: 3000 }],
        volumes: [], env: [], command: [], dependencies: []
      })
      setMode('custom')
      setStep(2)
    } catch (err) {
      const msg = err.response?.data?.message || err.message
      const progress = err.response?.data?.progress || []
      setBuildLog((prev) => [...prev, ...progress, `\u274c Falha: ${msg}`])
    } finally {
      clearInterval(progressInterval); setBuilding(false)
    }
  }

  const handleConfirm = () => {
    onAdd(form)
  }

  const upd = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const addPort = () => upd('ports', [...form.ports, { host: '', container: '' }])
  const removePort = (i) => upd('ports', form.ports.filter((_, j) => j !== i))
  const setPort = (i, k, v) => { const a = [...form.ports]; a[i] = { ...a[i], [k]: v }; upd('ports', a) }
  const addEnv = () => upd('env', [...form.env, { key: '', value: '', secret: false }])
  const removeEnv = (i) => upd('env', form.env.filter((_, j) => j !== i))
  const setEnv = (i, k, v) => { const a = [...form.env]; a[i] = { ...a[i], [k]: v }; upd('env', a) }
  const addVolume = () => upd('volumes', [...form.volumes, { host: '', container: '' }])
  const removeVolume = (i) => upd('volumes', form.volumes.filter((_, j) => j !== i))
  const setVolume = (i, k, v) => { const a = [...form.volumes]; a[i] = { ...a[i], [k]: v }; upd('volumes', a) }

  const suggestPort = async () => {
    try {
      // Collect ports already used in this stack (even if not running)
      const stackPorts = new Set()
      const currentStack = stack
      if (currentStack?.services) {
        for (const svc of currentStack.services) {
          for (const p of (svc.ports || [])) {
            if (p.host) stackPorts.add(Number(p.host))
          }
        }
      }
      // Also exclude ports in current form
      for (const p of form.ports) {
        if (p.host) stackPorts.add(Number(p.host))
      }

      const res = await api.get('/docker/available-port?start=3000')
      let port = res.data?.available
      // If suggested port conflicts with stack, find next
      while (port && stackPorts.has(port)) {
        port++
      }
      if (port) {
        const existing = form.ports.length ? [...form.ports] : [{ host: '', container: '' }]
        existing[0] = { ...existing[0], host: port }
        upd('ports', existing)
      }
    } catch { /* ignore */ }
  }

  const loadEnvFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target.result || ''
      const parsed = text.split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => {
          const idx = line.indexOf('=')
          if (idx <= 0) return null
          const key = line.slice(0, idx).trim()
          let value = line.slice(idx + 1).trim()
          if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
            value = value.slice(1, -1)
          return { key, value, secret: /password|secret|token|key|auth/i.test(key) }
        })
        .filter(Boolean)
      upd('env', [...form.env.filter((e) => e.key), ...parsed.filter((p) => !form.env.some((e) => e.key === p.key))])
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const requiredEnvs = selectedCatalog?.requiredEnv || []
  const missingRequired = requiredEnvs.filter((key) => {
    const entry = form.env.find((e) => e.key === key)
    return !entry || !entry.value.trim()
  })
  const canConfirm = form.name && form.image && missingRequired.length === 0

  const inp = { width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.04)', padding: '8px 12px', fontSize: 12, color: '#f1f5f9', outline: 'none', boxSizing: 'border-box' }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) { if (building) { setConfirmCancel(true) } else { onClose() } } }}>
      <div style={{ width: '100%', maxWidth: 560, maxHeight: '90vh', display: 'flex', flexDirection: 'column', margin: '0 16px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.1)', background: 'linear-gradient(160deg,#080f1e,#060c18)', boxShadow: '0 40px 100px rgba(0,0,0,0.8)' }}>

        {/* Header */}
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>
                {step === 1 ? 'Escolher Serviço' : step === 2 && mode === 'dockerfile' ? 'Build Dockerfile' : step === 2 ? 'Configurar' : 'Confirmar'}
              </div>
              <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
                Passo {step} de 3{selectedCatalog ? ` — ${selectedCatalog.name}` : ''}
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 8, color: '#64748b', cursor: 'pointer', padding: '5px 7px', lineHeight: 1, display: 'flex' }}>
              <X size={13} />
            </button>
          </div>
          {/* Step indicator */}
          <div style={{ display: 'flex', gap: 4, marginTop: 12 }}>
            {[1, 2, 3].map((s) => (
              <div key={s} style={{ flex: 1, height: 3, borderRadius: 2, background: s <= step ? '#3b82f6' : 'rgba(255,255,255,0.08)', transition: 'background 0.2s' }} />
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>

          {/* STEP 1: Choose */}
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {filteredCatalog.map((item) => {
                  const cfg = SERVICE_ROLES[item.role] || SERVICE_ROLES.runtime
                  const Icon = cfg.icon
                  return (
                    <button key={item.id} onClick={() => selectFromCatalog(item)}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '14px 8px', borderRadius: 14, cursor: 'pointer', transition: 'all 0.15s', border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.03)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = `${cfg.color}55`; e.currentTarget.style.background = `${cfg.color}10` }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)'; e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}>
                      <div style={{ width: 36, height: 36, borderRadius: 10, background: `${cfg.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Icon size={17} style={{ color: cfg.color }} />
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#f1f5f9' }}>{item.name}</span>
                      <span style={{ fontSize: 9, color: '#475569', textAlign: 'center', lineHeight: 1.3 }}>{item.description?.slice(0, 40)}</span>
                    </button>
                  )
                })}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                <button onClick={selectCustom}
                  style={{ padding: '12px', borderRadius: 12, border: '1px dashed rgba(255,255,255,0.15)', background: 'transparent', color: '#94a3b8', fontSize: 12, cursor: 'pointer', textAlign: 'center' }}>
                  + Imagem customizada
                </button>
                <button onClick={selectDockerfile}
                  style={{ padding: '12px', borderRadius: 12, border: '1px dashed rgba(139,92,246,0.4)', background: 'rgba(139,92,246,0.06)', color: '#c4b5fd', fontSize: 12, cursor: 'pointer', textAlign: 'center' }}>
                  + Build com Dockerfile
                </button>
              </div>
              {imagesLoaded && serverImages.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#64748b", marginBottom: 8 }}>Imagens no servidor</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 160, overflowY: "auto" }}>
                    {serverImages.slice(0, 20).map((img) => {
                      const cfg = SERVICE_ROLES[inferRoleFromImage(img.name)] || SERVICE_ROLES.runtime
                      const Icon = cfg.icon
                      return (
                        <button key={`${img.repo}:${img.tag}`} onClick={() => {
                          setSelectedCatalog(null)
                          setMode("custom")
                          setForm({ name: img.name, role: inferRoleFromImage(img.name), image: img.repo, tag: img.tag, ports: [], volumes: [], env: [], command: [], dependencies: [] })
                          setStep(2)
                        }}
                          style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)", cursor: "pointer", textAlign: "left" }}>
                          <Icon size={13} style={{ color: cfg.color, flexShrink: 0 }} />
                          <span style={{ fontSize: 11, color: "#f1f5f9", fontWeight: 500 }}>{img.name}</span>
                          <span style={{ fontSize: 10, color: "#475569", fontFamily: "ui-monospace,monospace" }}>:{img.tag}</span>
                          <span style={{ fontSize: 9, color: "#334155", marginLeft: "auto" }}>{img.size ? (img.size / 1024 / 1024).toFixed(0) + " MB" : ""}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

            </div>

          )}

          {/* STEP 2: Configure */}
          {step === 2 && mode === 'dockerfile' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b', marginBottom: 6 }}>Nome da imagem</label>
                <input value={buildName} onChange={(e) => setBuildName(e.target.value)}
                  style={inp} placeholder="minha-app:latest" />
                <div style={{ fontSize: 10, color: '#475569', marginTop: 4 }}>Ex: minha-api:1.0 ou registry.com/app:latest</div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b', marginBottom: 6 }}>Dockerfile</label>
                <textarea value={dockerfile} onChange={(e) => setDockerfile(e.target.value)}
                  rows={12}
                  style={{ ...inp, fontFamily: 'ui-monospace,monospace', fontSize: 11, lineHeight: 1.6, resize: 'vertical', minHeight: 180 }}
                  placeholder={'FROM node:20-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm install\nCOPY . .\nEXPOSE 3000\nCMD ["node", "server.js"]'} />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b' }}>Contexto do build (opcional)</label>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 10, border: '1px dashed rgba(139,92,246,0.3)', background: 'rgba(139,92,246,0.04)', cursor: 'pointer' }}>
                  <Upload size={14} style={{ color: '#a78bfa', flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: contextFile ? '#c4b5fd' : '#64748b' }}>
                      {contextFile ? contextFile.name : 'Carregar arquivo .zip ou .tar.gz'}
                    </div>
                    <div style={{ fontSize: 9, color: '#475569', marginTop: 2 }}>
                      {contextFile ? `${(contextFile.size / 1024 / 1024).toFixed(1)} MB` : 'Arquivos do projeto que o Dockerfile referencia (COPY, ADD)'}
                    </div>
                  </div>
                  {contextFile && (
                    <button onClick={(e) => { e.preventDefault(); setContextFile(null) }} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: 2 }}>
                      <X size={12} />
                    </button>
                  )}
                  <input type="file" accept=".zip,.tar,.tar.gz,.tgz" style={{ display: 'none' }} onChange={(e) => { setContextFile(e.target.files?.[0] || null); e.target.value = '' }} />
                </label>
              </div>
              {/* Build log */}
              <div style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: '#050a14', padding: '10px 12px', minHeight: building ? 120 : 0, maxHeight: 250, overflowY: 'auto', display: buildLog.length > 0 || building ? 'block' : 'none' }}>
                {building && buildLog.length === 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
                    <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid rgba(139,92,246,0.3)', borderTopColor: '#8b5cf6', animation: 'spin 1s linear infinite' }} />
                    <span style={{ fontSize: 11, color: '#a78bfa' }}>Preparando build...</span>
                  </div>
                )}
                {buildLog.map((line, i) => (
                  <div key={i} style={{ fontSize: 10, fontFamily: 'ui-monospace,monospace', color: line.includes('\u2705') ? '#86efac' : line.includes('\u274c') ? '#fca5a5' : '#94a3b8', lineHeight: 1.7 }}>{line}</div>
                ))}
                {building && buildLog.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid rgba(255,255,255,0.05)', marginTop: 6 }}>
                    <div style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid rgba(139,92,246,0.3)', borderTopColor: '#8b5cf6', animation: 'spin 1s linear infinite' }} />
                    <span style={{ fontSize: 10, color: '#a78bfa' }}>Build em andamento...</span>
                  </div>
                )}
              </div>
              <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
              <button onClick={handleBuildImage} disabled={building || !buildName.trim() || !dockerfile.trim()}
                style={{ padding: '10px 16px', borderRadius: 10, border: 'none', fontSize: 12, fontWeight: 600, cursor: building ? 'wait' : 'pointer', color: '#fff', background: (building || !buildName.trim() || !dockerfile.trim()) ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg,#8b5cf6,#6d28d9)', boxShadow: (building || !buildName.trim() || !dockerfile.trim()) ? 'none' : '0 4px 14px rgba(139,92,246,0.4)', opacity: (building || !buildName.trim() || !dockerfile.trim()) ? 0.4 : 1 }}>
                {building ? 'Construindo...' : '\ud83d\udd28 Build da Imagem'}
              </button>
            </div>
          )}

          {step === 2 && mode !== 'dockerfile' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Basic info */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b', marginBottom: 6 }}>Nome</label>
                  <input value={form.name} onChange={(e) => upd('name', e.target.value)} style={inp} placeholder="meu-servico" />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b', marginBottom: 6 }}>Papel</label>
                  <select value={form.role} onChange={(e) => upd('role', e.target.value)} style={{ ...inp, cursor: 'pointer' }}>
                    {Object.entries(SERVICE_ROLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b', marginBottom: 6 }}>Imagem</label>
                  <input value={form.image} onChange={(e) => upd('image', e.target.value)} style={{ ...inp, fontFamily: 'ui-monospace,monospace' }} placeholder="nginx" />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b', marginBottom: 6 }}>Tag</label>
                  <input value={form.tag} onChange={(e) => upd('tag', e.target.value)} style={{ ...inp, fontFamily: 'ui-monospace,monospace' }} placeholder="latest" />
                </div>
              </div>

              {/* Env vars */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <label style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b' }}>Variáveis de ambiente</label>
                  <button onClick={addEnv} style={{ fontSize: 10, color: '#7dd3fc', background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 7, padding: '3px 9px', cursor: 'pointer' }}>+ Var</button>
                  <label style={{ fontSize: 10, color: "#a78bfa", background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.2)", borderRadius: 7, padding: "3px 9px", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}><Upload size={9} /> .env<input type="file" accept=".env,text/plain" style={{ display: "none" }} onChange={loadEnvFile} /></label>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {form.env.map((e, i) => {
                    const isRequired = requiredEnvs.includes(e.key)
                    const isMissing = isRequired && !e.value.trim()
                    return (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.8fr auto auto', gap: 5, alignItems: 'center', background: isMissing ? 'rgba(239,68,68,0.06)' : 'rgba(255,255,255,0.025)', border: `1px solid ${isMissing ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.06)'}`, borderRadius: 9, padding: '5px 8px' }}>
                        <input value={e.key} onChange={(ev) => setEnv(i, 'key', ev.target.value)} placeholder="CHAVE"
                          style={{ ...inp, background: 'transparent', border: 'none', padding: '2px 0', fontSize: 11, color: '#fbbf24', fontFamily: 'ui-monospace,monospace' }} />
                        <input value={e.value} onChange={(ev) => setEnv(i, 'value', ev.target.value)} placeholder={isRequired ? '⚠ obrigatório' : 'valor'}
                          type={e.secret ? 'password' : 'text'}
                          style={{ ...inp, background: 'transparent', border: 'none', padding: '2px 0', fontSize: 11 }} />
                        <button onClick={() => setEnv(i, 'secret', !e.secret)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, padding: 2 }}>
                          {e.secret ? '🔒' : '👁'}
                        </button>
                        <button onClick={() => removeEnv(i)} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', padding: 2, lineHeight: 1, display: 'flex' }}>
                          <X size={11} />
                        </button>
                      </div>
                    )
                  })}
                </div>
                {missingRequired.length > 0 && (
                  <div style={{ marginTop: 6, fontSize: 10, color: '#f87171' }}>
                    ⚠ Preencha: {missingRequired.join(', ')}
                  </div>
                )}
              </div>

              {/* Ports */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <label style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b' }}>Portas</label>
                  <button onClick={addPort} style={{ fontSize: 10, color: '#7dd3fc', background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 7, padding: '3px 9px', cursor: 'pointer' }}>+ Porta</button>
                  <button onClick={suggestPort} style={{ fontSize: 10, color: "#a78bfa", background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.2)", borderRadius: 7, padding: "3px 9px", cursor: "pointer" }}>Sugerir porta</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {form.ports.map((p, i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr auto', gap: 6, alignItems: 'center' }}>
                      <input value={p.host} onChange={(e) => setPort(i, 'host', e.target.value)} placeholder="Host" style={{ ...inp, fontSize: 11, fontFamily: 'ui-monospace,monospace' }} />
                      <span style={{ color: '#334155', fontSize: 11 }}>→</span>
                      <input value={p.container} onChange={(e) => setPort(i, 'container', e.target.value)} placeholder="Container" style={{ ...inp, fontSize: 11, fontFamily: 'ui-monospace,monospace' }} />
                      <button onClick={() => removePort(i)} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', padding: 2, lineHeight: 1, display: 'flex' }}><X size={11} /></button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Volumes */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <label style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b' }}>Volumes</label>
                  <button onClick={addVolume} style={{ fontSize: 10, color: '#7dd3fc', background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 7, padding: '3px 9px', cursor: 'pointer' }}>+ Volume</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {form.volumes.map((v, i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr auto', gap: 6, alignItems: 'center' }}>
                      <input value={v.host} onChange={(e) => setVolume(i, 'host', e.target.value)} placeholder="Host/Volume" style={{ ...inp, fontSize: 11, fontFamily: 'ui-monospace,monospace' }} />
                      <span style={{ color: '#334155', fontSize: 11 }}>→</span>
                      <input value={v.container} onChange={(e) => setVolume(i, 'container', e.target.value)} placeholder="Container" style={{ ...inp, fontSize: 11, fontFamily: 'ui-monospace,monospace' }} />
                      <button onClick={() => removeVolume(i)} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', padding: 2, lineHeight: 1, display: 'flex' }}><X size={11} /></button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Confirm */}
          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  {(() => { const cfg = SERVICE_ROLES[form.role] || SERVICE_ROLES.runtime; const Icon = cfg.icon; return (
                    <div style={{ width: 38, height: 38, borderRadius: 11, background: `${cfg.color}18`, border: `1px solid ${cfg.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon size={18} style={{ color: cfg.color }} />
                    </div>
                  )})()}
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>{form.name}</div>
                    <div style={{ fontSize: 11, color: '#475569', fontFamily: 'ui-monospace,monospace' }}>{form.image}:{form.tag}</div>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  <div style={{ borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', padding: '8px 10px', textAlign: 'center' }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9' }}>{form.ports.length}</div>
                    <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase' }}>Portas</div>
                  </div>
                  <div style={{ borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', padding: '8px 10px', textAlign: 'center' }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9' }}>{form.env.length}</div>
                    <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase' }}>Variáveis</div>
                  </div>
                  <div style={{ borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', padding: '8px 10px', textAlign: 'center' }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9' }}>{form.volumes.length}</div>
                    <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase' }}>Volumes</div>
                  </div>
                </div>
              </div>
              {form.env.length > 0 && (
                <div style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)', padding: '10px 12px' }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Variáveis</div>
                  {form.env.map((e, i) => (
                    <div key={i} style={{ fontSize: 11, fontFamily: 'ui-monospace,monospace', color: '#94a3b8', lineHeight: 1.8 }}>
                      <span style={{ color: '#fbbf24' }}>{e.key}</span>=<span style={{ color: e.secret ? '#475569' : '#6ee7b7' }}>{e.secret ? '••••••' : e.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.06)', padding: '12px 20px' }}>
          <button onClick={() => { if (step === 1) onClose(); else { setStep(step - 1); if (step === 2) setMode('catalog') } }}
            style={{ fontSize: 11, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer' }}>
            {step === 1 ? 'Cancelar' : '← Voltar'}
          </button>
          {step < 3 && !(step === 2 && mode === 'dockerfile') ? (
            <button onClick={() => setStep(step + 1)} disabled={step === 2 && !canConfirm}
              style={{ fontSize: 12, fontWeight: 600, color: '#fff', background: (step === 2 && !canConfirm) ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg,#3b82f6,#6366f1)', border: 'none', borderRadius: 10, padding: '8px 22px', cursor: (step === 2 && !canConfirm) ? 'default' : 'pointer', boxShadow: (step === 2 && !canConfirm) ? 'none' : '0 4px 14px rgba(59,130,246,0.4)', opacity: (step === 2 && !canConfirm) ? 0.4 : 1 }}>
              Próximo →
            </button>
          ) : step === 2 && mode === 'dockerfile' ? (
            <span />
          ) : (
            <button onClick={handleConfirm}
              style={{ fontSize: 12, fontWeight: 600, color: '#fff', background: 'linear-gradient(135deg,#10b981,#059669)', border: 'none', borderRadius: 10, padding: '8px 22px', cursor: 'pointer', boxShadow: '0 4px 14px rgba(16,185,129,0.4)' }}>
              ✓ Adicionar Serviço
            </button>
          )}
        </div>
      </div>
      {confirmCancel && (
        <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}>
          <div style={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 14, padding: "24px", maxWidth: 340, textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#f1f5f9", marginBottom: 8 }}>Cancelar build?</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 18, lineHeight: 1.5 }}>O processo de build esta em andamento. Deseja cancelar e fechar?</div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button onClick={() => setConfirmCancel(false)}
                style={{ fontSize: 12, padding: "8px 18px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "#cbd5e1", cursor: "pointer" }}>
                Continuar
              </button>
              <button onClick={() => { setBuilding(false); setConfirmCancel(false); onClose() }}
                style={{ fontSize: 12, padding: "8px 18px", borderRadius: 9, border: "none", background: "linear-gradient(135deg,#dc2626,#b91c1c)", color: "#fff", cursor: "pointer", fontWeight: 600 }}>
                Cancelar build
              </button>
            </div>
          </div>
        </div>
      )}

    </div>

  )
}

// ─── Modal de Importar Serviços Existentes ────────────────────────────────────

const ImportServicesModal = ({ stackId, onImported, onClose }) => {
  const [services, setServices] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    api.get('/stacks/unassigned-services')
      .then((r) => { setServices(r.data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const toggle = (id) => setSelected((s) => {
    const n = new Set(s)
    n.has(id) ? n.delete(id) : n.add(id)
    return n
  })

  const handleImport = async () => {
    if (!selected.size) return
    setImporting(true)
    try {
      const { data } = await api.post(`/stacks/${stackId}/import-services`, { serviceIds: [...selected] })
      onImported(data.stack)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold text-white">Importar Serviços Existentes</h3>
            <p className="text-[11px] text-slate-400">Serviços criados no Docker Manager ainda não organizados</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={16} /></button>
        </div>

        <div className="max-h-80 overflow-y-auto p-4">
          {loading ? (
            <div className="py-8 text-center text-sm text-slate-400">Buscando serviços...</div>
          ) : services.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-slate-400">Nenhum serviço disponível para importar</p>
              <p className="mt-1 text-xs text-slate-500">Todos os serviços já estão organizados em stacks</p>
            </div>
          ) : (
            <div className="space-y-2">
              {services.map((svc) => {
                const cfg = SERVICE_ROLES[svc.role] || SERVICE_ROLES.runtime
                const Icon = cfg.icon
                const isSelected = selected.has(svc.id)
                return (
                  <button key={svc.id} onClick={() => toggle(svc.id)}
                    className="flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-all"
                    style={{
                      borderColor: isSelected ? cfg.color : 'rgba(255,255,255,0.1)',
                      background: isSelected ? `${cfg.color}15` : 'rgba(255,255,255,0.03)'
                    }}>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                      style={{ background: cfg.bg }}>
                      <Icon size={16} style={{ color: cfg.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-white">{svc.name}</p>
                        <span className="rounded-md border px-1.5 py-0.5 text-[9px]"
                          style={{ borderColor: `${cfg.color}44`, color: cfg.color }}>
                          {cfg.label}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400">{svc.image}:{svc.tag}</p>
                      {svc.ports?.length > 0 && (
                        <p className="text-[10px] text-slate-500">porta {svc.ports[0].host}→{svc.ports[0].container}</p>
                      )}
                    </div>
                    {/* Container status */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {svc.containerId ? (
                        <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> container ativo
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-500">sem container</span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-white/8 px-5 py-4">
          <span className="text-[11px] text-slate-400">
            {selected.size} de {services.length} selecionado{selected.size !== 1 ? 's' : ''}
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-xl border border-white/10 px-4 py-2 text-xs text-slate-300 hover:text-white">Cancelar</button>
            <button onClick={handleImport} disabled={!selected.size || importing}
              className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-5 py-2 text-xs text-blue-300 hover:bg-blue-500/20 disabled:opacity-40">
              {importing ? 'Importando...' : 'Importar Selecionados'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Modal de Blueprint Library ────────────────────────────────────────────────

const BlueprintLibrary = ({ onSelect, onClose }) => {
  const [blueprints, setBlueprints] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    api.get('/stacks/blueprints').then((r) => { setBlueprints(r.data); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  const complexityColor = { simple: 'text-emerald-400', medium: 'text-amber-400', advanced: 'text-rose-400' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold text-white">Blueprint Library</h3>
            <p className="text-[11px] text-slate-400">Stacks pré-configuradas prontas para deploy</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={16} /></button>
        </div>

        <div className="max-h-[480px] overflow-y-auto p-4">
          {loading ? (
            <div className="py-12 text-center text-sm text-slate-400">Carregando blueprints...</div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {blueprints.map((bp) => {
                const CategoryIcon = CATEGORY_ICONS[bp.category] || Layers
                return (
                  <button key={bp.id} onClick={() => setSelected(bp)}
                    className="rounded-2xl border p-4 text-left transition-all"
                    style={{
                      borderColor: selected?.id === bp.id ? '#3b82f6' : 'rgba(255,255,255,0.1)',
                      background: selected?.id === bp.id ? 'rgba(59,130,246,0.1)' : 'rgba(255,255,255,0.03)'
                    }}>
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5">
                        <CategoryIcon size={16} className="text-blue-300" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white">{bp.name}</p>
                        <p className="mt-0.5 text-[11px] leading-4 text-slate-400">{bp.description}</p>
                        <div className="mt-2 flex items-center gap-2 flex-wrap">
                          <span className={`text-[10px] font-medium ${complexityColor[bp.complexity]}`}>
                            {bp.complexity}
                          </span>
                          <span className="text-slate-600">·</span>
                          <span className="text-[10px] text-slate-500">{bp.services?.length || 0} serviços</span>
                        </div>
                        {/* Role indicators */}
                        <div className="mt-2 flex gap-1">
                          {[...new Set(bp.services?.map((s) => s.role))].map((role) => {
                            const cfg = SERVICE_ROLES[role]
                            if (!cfg) return null
                            const Icon = cfg.icon
                            return (
                              <div key={role} className="flex h-5 w-5 items-center justify-center rounded-md"
                                style={{ background: cfg.bg }}>
                                <Icon size={10} style={{ color: cfg.color }} />
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-white/8 px-5 py-4">
          <button onClick={onClose} className="rounded-xl border border-white/10 px-4 py-2 text-xs text-slate-300 hover:text-white">Cancelar</button>
          <button onClick={() => selected && onSelect(selected)} disabled={!selected}
            className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-5 py-2 text-xs text-blue-300 hover:bg-blue-500/20 disabled:opacity-40">
            Usar Blueprint
          </button>
        </div>
      </div>
    </div>
  )
}


// ─── Modal de Importar Compose ─────────────────────────────────────────────────

const ROLE_COLORS = {
  'entry-point': '#10b981', webapp: '#06b6d4', runtime: '#3b82f6',
  database: '#a855f7', cache: '#f59e0b', queue: '#f97316',
  monitor: '#ec4899', storage: '#06b6d4'
}

const BuildDeployButton = ({ stack, service, onDone, addToast }) => {
  const [open, setOpen] = useState(false)
  const [log, setLog] = useState([])
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)
  const fileRef = useRef(null)
  const CHUNK_SIZE = 5 * 1024 * 1024

  const runBuild = async (file) => {
    setLog([]); setRunning(true); setDone(false)
    const push = (msg) => setLog(prev => [...prev, msg])
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE)

    try {
      push(`📦 Enviando ${file.name} (${(file.size/1024/1024).toFixed(1)} MB) em ${totalChunks} parte(s)...`)

      if (totalChunks <= 1) {
        // Upload direto + SSE
        const fd = new FormData()
        fd.append('archive', file)
        const token = localStorage.getItem('provirpanel-token')
        const res = await fetch(`/api/stacks/${stack.id}/services/${service.id}/build`, {
          method: 'POST', body: fd,
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        })
        if (!res.ok) { push(`❌ Erro ${res.status}: ${await res.text()}`); return }
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        while (true) {
          const { done: d, value } = await reader.read()
          if (d) break
          dec.decode(value).split('\n').forEach(line => {
            if (line.startsWith('data:')) {
              try {
                const ev = JSON.parse(line.slice(5))
                if (ev.message) push(ev.message)
                if (ev.done) { setDone(true); if (!ev.error) { onDone(); addToast(`Build de ${service.name} concluído!`) } }
              } catch { /* ignore */ }
            }
          })
        }
      } else {
        // Chunked upload
        const initRes = await api.post(`/stacks/${stack.id}/services/${service.id}/build/init`, {
          filename: file.name, size: file.size, totalChunks
        })
        const { uploadId } = initRes.data
        for (let i = 0; i < totalChunks; i++) {
          const chunk = file.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
          const fd = new FormData()
          fd.append('chunk', chunk, file.name)
          fd.append('uploadId', uploadId)
          fd.append('chunkIndex', String(i))
          await uploadApi.post(`/stacks/${stack.id}/services/${service.id}/build/chunk`, fd, {
            headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000
          })
          push(`↑ Parte ${i + 1}/${totalChunks} enviada`)
        }
        push('🔨 Iniciando build no servidor...')
        const token = localStorage.getItem('provirpanel-token')
        const res = await fetch(`/api/stacks/${stack.id}/services/${service.id}/build/complete`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ uploadId })
        })
        if (!res.ok) { push(`❌ Erro ${res.status}: ${await res.text()}`); return }
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        while (true) {
          const { done: d, value } = await reader.read()
          if (d) break
          dec.decode(value).split('\n').forEach(line => {
            if (line.startsWith('data:')) {
              try {
                const ev = JSON.parse(line.slice(5))
                if (ev.message) push(ev.message)
                if (ev.done) { setDone(true); if (!ev.error) { onDone(); addToast(`Build de ${service.name} concluído!`) } }
              } catch { /* ignore */ }
            }
          })
        }
      }
    } catch (err) {
      push(`❌ ${err.message}`)
    } finally {
      setRunning(false)
    }
  }

  return (<>
    <button onClick={() => setOpen(true)}
      className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-orange-500/30 bg-orange-500/10 py-2 text-xs text-orange-300 hover:bg-orange-500/20 mb-2">
      🔨 Build & Deploy
    </button>
    {open && (
      <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }}
        onMouseDown={e => { if (e.target === e.currentTarget && !running) setOpen(false) }}>
        <div style={{ width: '100%', maxWidth: 520, margin: '0 16px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.1)', background: 'linear-gradient(160deg,#080f1e,#060c18)', boxShadow: '0 40px 100px rgba(0,0,0,0.8)', display: 'flex', flexDirection: 'column', maxHeight: '85vh' }}>
          <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>🔨 Build & Deploy — {service.name}</div>
            <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>Envie o código-fonte (.zip ou .tar.gz) para buildar a imagem no servidor</div>
          </div>
          <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 12, flex: 1, overflow: 'hidden' }}>
            {!running && !done && (
              <label style={{ display: 'block', borderRadius: 14, border: '2px dashed rgba(251,146,60,0.3)', background: 'rgba(251,146,60,0.04)', padding: '28px 16px', textAlign: 'center', cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.borderColor='rgba(251,146,60,0.6)'}
                onMouseLeave={e => e.currentTarget.style.borderColor='rgba(251,146,60,0.3)'}>
                <input ref={fileRef} type="file" accept=".zip,.tar,.tar.gz,.tgz" style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) runBuild(f) }} />
                <div style={{ fontSize: 13, fontWeight: 600, color: '#fed7aa', marginBottom: 4 }}>Clique para selecionar o arquivo</div>
                <div style={{ fontSize: 11, color: '#78350f' }}>.zip ou .tar.gz com o código-fonte completo do projeto</div>
                <div style={{ fontSize: 10, color: '#475569', marginTop: 6 }}>Dockerfile esperado: <code style={{ color: '#fb923c' }}>{service.build?.dockerfile || 'Dockerfile'}</code></div>
              </label>
            )}
            {log.length > 0 && (
              <div style={{ flex: 1, overflowY: 'auto', background: 'rgba(0,0,0,0.4)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)', padding: '10px 12px', fontFamily: 'ui-monospace,monospace', fontSize: 11, color: '#94a3b8', display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 300 }}>
                {log.map((l, i) => <div key={i} style={{ color: l.startsWith('❌') ? '#f87171' : l.startsWith('✅') ? '#34d399' : '#94a3b8' }}>{l}</div>)}
              </div>
            )}
          </div>
          <div style={{ padding: '12px 24px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button onClick={() => { if (!running) setOpen(false) }} style={{ fontSize: 11, color: '#475569', background: 'none', border: 'none', cursor: running ? 'default' : 'pointer', opacity: running ? 0.4 : 1 }}>Fechar</button>
            {done && (
              <button onClick={() => { setOpen(false); setLog([]); setDone(false) }}
                style={{ fontSize: 12, fontWeight: 600, color: '#fff', background: 'linear-gradient(135deg,#10b981,#059669)', border: 'none', borderRadius: 10, padding: '8px 20px', cursor: 'pointer' }}>
                ✅ Concluído
              </button>
            )}
          </div>
        </div>
      </div>
    )}
  </>)
}

const ImportComposeModal = ({ onImported, onClose }) => {
  const [step, setStep] = useState('edit')
  const [content, setContent] = useState('')
  const [name, setName] = useState('')
  const [environment, setEnvironment] = useState('production')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(null)

  const inp = { width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.04)', padding: '8px 12px', fontSize: 12, color: '#f1f5f9', outline: 'none', boxSizing: 'border-box' }

  const handleFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!name) setName(file.name.replace(/\.(yml|yaml)$/i, ''))
    const reader = new FileReader()
    reader.onload = (ev) => setContent(ev.target.result || '')
    reader.readAsText(file)
  }

  const handlePreview = async () => {
    if (!content.trim()) { setError('Cole ou carregue um docker-compose.yml'); return }
    setLoading(true); setError('')
    try {
      const res = await api.post('/stacks/import-compose/preview', { content })
      setPreview(res.data)
      setStep('preview')
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    } finally { setLoading(false) }
  }

  const hasBuildServices = preview?.services?.some(s => s.build)

  const handleImport = async () => {
    setLoading(true); setError('')
    try {
      const res = await api.post('/stacks/import-compose', { content, name: name.trim() || undefined, environment })
      onImported(res.data)
    } catch (err) {
      setError(err.response?.data?.error || err.message)
      setStep('edit')
    } finally { setLoading(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ width: '100%', maxWidth: step === 'preview' ? 680 : 600, maxHeight: '90vh', display: 'flex', flexDirection: 'column', margin: '0 16px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.1)', background: 'linear-gradient(160deg,#080f1e,#060c18)', boxShadow: '0 40px 100px rgba(0,0,0,0.8)', transition: 'max-width 0.2s' }}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {step === 'preview' && (
              <button onClick={() => setStep('edit')} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 8, color: '#94a3b8', cursor: 'pointer', padding: '4px 8px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                ← Editar
              </button>
            )}
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>
                {step === 'edit' ? 'Importar Docker Compose' : `Preview — ${preview?.services?.length || 0} serviço(s) detectado(s)`}
              </div>
              <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
                {step === 'edit' ? 'Cole ou carregue um docker-compose.yml para criar uma stack' : 'Confirme os serviços antes de criar a stack'}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 8, color: '#64748b', cursor: 'pointer', padding: '5px 7px', lineHeight: 1, display: 'flex' }}>
            <X size={13} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* ── STEP EDIT ── */}
          {step === 'edit' && (<>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
              <div>
                <label style={{ display: 'block', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b', marginBottom: 6 }}>Nome da Stack</label>
                <input value={name} onChange={(e) => setName(e.target.value)} style={inp} placeholder="Minha Stack (opcional)" />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b', marginBottom: 6 }}>Ambiente</label>
                <select value={environment} onChange={(e) => setEnvironment(e.target.value)} style={{ ...inp, cursor: 'pointer' }}>
                  <option value="production">Produção</option>
                  <option value="staging">Staging</option>
                  <option value="development">Desenvolvimento</option>
                </select>
              </div>
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <label style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b' }}>docker-compose.yml</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 10, color: '#7dd3fc', background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 7, padding: '3px 9px' }}>
                  <Upload size={10} /> Carregar arquivo
                  <input type="file" accept=".yml,.yaml,.json" style={{ display: 'none' }} onChange={handleFile} />
                </label>
              </div>
              <textarea value={content} onChange={(e) => setContent(e.target.value)}
                rows={14}
                style={{ ...inp, fontFamily: 'ui-monospace,monospace', fontSize: 11, lineHeight: 1.6, resize: 'vertical', minHeight: 200 }}
                placeholder={"version: \"3.8\"\nservices:\n  api:\n    build:\n      dockerfile: Dockerfile.api\n    ports:\n      - \"3000:3000\"\n  frontend:\n    build:\n      dockerfile: Dockerfile.frontend\n    ports:\n      - \"80:80\""} />
            </div>
          </>)}

          {/* ── STEP PREVIEW ── */}
          {step === 'preview' && preview && (<>
            {preview.network && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderRadius: 10, border: '1px solid rgba(59,130,246,0.2)', background: 'rgba(59,130,246,0.06)', padding: '8px 12px' }}>
                <GitBranch size={13} style={{ color: '#3b82f6', flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: '#93c5fd' }}>Rede detectada: <strong>{preview.network}</strong></span>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(preview.services || []).map((svc) => {
                const color = ROLE_COLORS[svc.role] || '#3b82f6'
                return (
                  <div key={svc.id} style={{ borderRadius: 12, border: `1px solid ${color}25`, background: `${color}07`, overflow: 'hidden' }}>
                    {/* Service header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: `1px solid ${color}15` }}>
                      <div style={{ width: 32, height: 32, borderRadius: 9, background: `${color}18`, border: `1px solid ${color}35`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Server size={14} style={{ color }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>{svc.name}</div>
                        <div style={{ fontSize: 10, color: '#475569', fontFamily: 'ui-monospace,monospace', marginTop: 1 }}>
                          {svc.image}{svc.tag && svc.tag !== 'latest' ? `:${svc.tag}` : ''}
                        </div>
                      </div>
                      <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: `${color}18`, border: `1px solid ${color}35`, color, textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0 }}>
                        {svc.role}
                      </span>
                    </div>
                    {/* Service details */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 14px' }}>
                      {svc.ports?.length > 0 && svc.ports.map((p, i) => (
                        <span key={i} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.2)', color: '#7dd3fc', fontFamily: 'ui-monospace,monospace' }}>
                          {p.host}:{p.container}
                        </span>
                      ))}
                      {svc.env?.length > 0 && (
                        <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.2)', color: '#fbbf24' }}>
                          {svc.env.length} variável{svc.env.length !== 1 ? 'is' : ''}
                        </span>
                      )}
                      {svc.volumes?.length > 0 && (
                        <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.2)', color: '#c4b5fd' }}>
                          {svc.volumes.length} volume{svc.volumes.length !== 1 ? 's' : ''}
                        </span>
                      )}
                      {svc.dependencies?.length > 0 && (
                        <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', color: '#34d399' }}>
                          depends_on: {svc.dependencies.length}
                        </span>
                      )}
                      {svc.command?.length > 0 && (
                        <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#64748b', fontFamily: 'ui-monospace,monospace', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          cmd: {svc.command.join(' ')}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            {/* Aviso de build local */}
            {hasBuildServices && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, borderRadius: 10, border: '1px solid rgba(251,146,60,0.3)', background: 'rgba(251,146,60,0.06)', padding: '10px 14px' }}>
                <span style={{ fontSize: 16, flexShrink: 0 }}>🔨</span>
                <div style={{ fontSize: 11, color: '#fed7aa', lineHeight: 1.5 }}>
                  <strong>Serviços com build local detectados.</strong> A stack será criada normalmente.
                  Após importar, clique em <strong>"Build & Deploy"</strong> em cada serviço para enviar o código-fonte e buildar a imagem no servidor.
                </div>
              </div>
            )}
            {/* Stack name confirmation */}
            <div style={{ borderRadius: 10, border: '1px solid rgba(16,185,129,0.2)', background: 'rgba(16,185,129,0.05)', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <CheckCircle2 size={14} style={{ color: '#10b981', flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: '#10b981', fontWeight: 600 }}>Pronto para importar</div>
                <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>
                  Stack: <strong style={{ color: '#94a3b8' }}>{name.trim() || 'Imported Stack'}</strong> · Ambiente: <strong style={{ color: '#94a3b8' }}>{environment}</strong>
                </div>
              </div>
            </div>
          </>)}

          {error && (
            <div style={{ borderRadius: 10, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', padding: '10px 12px', fontSize: 12, color: '#fca5a5' }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.06)', padding: '12px 20px' }}>
          <button onClick={onClose} style={{ fontSize: 11, color: '#475569', background: 'none', border: 'none', cursor: 'pointer' }}>Cancelar</button>
          {step === 'edit' ? (
            <button onClick={handlePreview} disabled={loading || !content.trim()}
              style={{ fontSize: 12, fontWeight: 600, color: '#fff', background: (!content.trim() || loading) ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg,#3b82f6,#6366f1)', border: 'none', borderRadius: 10, padding: '8px 22px', cursor: (!content.trim() || loading) ? 'default' : 'pointer', opacity: (!content.trim() || loading) ? 0.4 : 1, boxShadow: (!content.trim() || loading) ? 'none' : '0 4px 14px rgba(59,130,246,0.4)' }}>
              {loading ? 'Analisando...' : 'Analisar Compose →'}
            </button>
          ) : (
            <button onClick={handleImport} disabled={loading}
              style={{ fontSize: 12, fontWeight: 600, color: '#fff', background: loading ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg,#10b981,#059669)', border: 'none', borderRadius: 10, padding: '8px 22px', cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.4 : 1, boxShadow: loading ? 'none' : '0 4px 14px rgba(16,185,129,0.4)' }}>
              {loading ? 'Importando...' : `Criar Stack com ${preview?.services?.length || 0} serviço(s)`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Modal de Exportar Compose ─────────────────────────────────────────────────

const ComposeModal = ({ stack, onClose }) => {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [tab, setTab] = useState('compose')

  useEffect(() => {
    const endpoint = tab === 'compose' ? `/stacks/${stack.id}/compose` : `/stacks/${stack.id}/compose/env`
    api.get(endpoint).then((r) => { setContent(r.data); setLoading(false) }).catch(() => setLoading(false))
    setLoading(true)
  }, [stack.id, tab])

  const copy = () => {
    navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const download = () => {
    const filename = tab === 'compose' ? `docker-compose-${stack.name.replace(/\s+/g, '-')}.yml` : `.env.${stack.environment}`
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex w-full max-w-2xl flex-col rounded-2xl border border-white/10 bg-slate-900 shadow-2xl" style={{ maxHeight: '80vh' }}>
        <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold text-white">Exportar Stack</h3>
            <p className="text-[11px] text-slate-400">{stack.name} · {stack.environment}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={16} /></button>
        </div>

        <div className="flex border-b border-white/8">
          {[['compose', 'docker-compose.yml'], ['env', '.env (exemplo)']].map(([v, l]) => (
            <button key={v} onClick={() => setTab(v)}
              className={`px-5 py-3 text-xs font-medium transition ${tab === v ? 'border-b-2 border-emerald-400 text-emerald-300' : 'text-slate-400 hover:text-white'}`}>
              {l}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="py-8 text-center text-sm text-slate-400">Gerando...</div>
          ) : (
            <pre className="rounded-xl border border-white/8 bg-slate-950 p-4 text-[11px] leading-relaxed text-slate-300 font-mono overflow-auto"
              style={{ maxHeight: 380 }}>
              {content}
            </pre>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-white/8 px-5 py-4">
          <button onClick={copy} className="flex items-center gap-1.5 rounded-xl border border-white/10 px-4 py-2 text-xs text-slate-300 hover:text-white">
            <ClipboardCheck size={12} /> {copied ? 'Copiado!' : 'Copiar'}
          </button>
          <button onClick={download} className="flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs text-emerald-300 hover:bg-emerald-500/20">
            <Download size={12} /> Download
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Progress Log (SSE) ────────────────────────────────────────────────────────

const ProgressLog = ({ messages, onClose, title }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
    <div className="w-full max-w-2xl rounded-[20px] border border-[#30363d] bg-[#0d1117] shadow-[0_32px_80px_rgba(0,0,0,0.7)]" style={{ maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
      <div className="flex items-center justify-between border-b border-[#30363d] px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <span className="h-3 w-3 rounded-full bg-[#f87171]" />
            <span className="h-3 w-3 rounded-full bg-[#fbbf24]" />
            <span className="h-3 w-3 rounded-full bg-[#34d399]" />
          </div>
          <span className="text-[13px] font-medium text-[#c9d1d9]">{title || "Terminal"}</span>
        </div>
        <button onClick={onClose} className="text-[#6e7681] hover:text-[#c9d1d9] transition"><X size={15} /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-4" style={{ maxHeight: "70vh" }}>
        <pre className="font-mono text-[12px] leading-[1.7] whitespace-pre-wrap">
          {messages.map((m, i) => (
            <div key={i} style={{ color: m.includes("\u274c") || m.includes("ERROR") || m.includes("error") ? "#fca5a5" : m.includes("\u2705") || m.includes("sucesso") || m.includes("success") ? "#86efac" : m.includes("\u26a0") || m.includes("WARN") ? "#fcd34d" : m.includes("\ud83d") ? "#93c5fd" : "#8b949e" }}>
              {m}
            </div>
          ))}
        </pre>
      </div>
      <div className="flex justify-end border-t border-[#30363d] px-5 py-3">
        <button onClick={onClose} className="rounded-lg border border-[#30363d] bg-[#161b22] px-4 py-2 text-[12px] text-[#c9d1d9] hover:border-[#58a6ff]/50 transition">Fechar</button>
      </div>
    </div>
  </div>
)

const LaymanHelpModal = ({ model, onClose }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
    <div className="flex w-full max-w-2xl flex-col rounded-2xl border border-white/10 bg-slate-900 shadow-2xl" style={{ maxHeight: '82vh' }}>
      <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
        <div>
          <h3 className="text-sm font-semibold text-white">Modelo Basico Para Leigos</h3>
          <p className="text-[11px] text-slate-400">Ordem recomendada para subir um sistema basico e entender a funcao de cada node.</p>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={16} /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {model.length === 0 ? (
          <p className="text-sm text-slate-300/80">Adicione servicos para montar o fluxo automaticamente.</p>
        ) : (
          <div className="space-y-2.5">
            {model.map((item) => {
              const Icon = item.roleCfg.icon
              return (
                <div
                  key={item.role}
                  className="rounded-xl border p-3"
                  style={{
                    borderColor: `${item.roleCfg.color}44`,
                    background: `${item.roleCfg.color}12`
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-md border border-white/20 bg-slate-900/70 text-[10px] font-bold text-white">
                      {item.step}
                    </span>
                    <div className="flex h-6 w-6 items-center justify-center rounded-lg" style={{ background: `${item.roleCfg.color}1f` }}>
                      <Icon size={12} style={{ color: item.roleCfg.color }} />
                    </div>
                    <p className="text-[11px] font-semibold text-white">{item.laymanCfg?.title || item.roleCfg.label}</p>
                  </div>

                  <p className="mt-1 text-[11px] leading-5 text-slate-200/90">
                    {item.laymanCfg?.purpose || 'Componente de infraestrutura da stack.'}
                  </p>
                  <p className="mt-1 text-[10px] leading-4 text-slate-300/80">
                    {item.laymanCfg?.startup || 'Ative este bloco conforme a necessidade da arquitetura.'}
                  </p>
                  <p className="mt-1.5 text-[10px] text-slate-300/90">
                    Nodes nesta etapa: {item.services.map((service) => service.name).join(', ')}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex justify-end border-t border-white/8 px-5 py-4">
        <button onClick={onClose} className="rounded-xl border border-white/10 px-4 py-2 text-xs text-slate-300 hover:text-white">Fechar</button>
      </div>
    </div>
  </div>
)

// ─── Componente Principal ──────────────────────────────────────────────────────

export default function StacksPanel() {
  const location = useLocation()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [stacks, setStacks] = useState([])
  const [blueprints, setBlueprints] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedStack, setSelectedStack] = useState(null)
  const [selectedService, setSelectedService] = useState(null)
  const [addServiceStage, setAddServiceStage] = useState(null)
  const [toasts, setToasts] = useState([])
  const [progressLog, setProgressLog] = useState(null)
  const [canvasMode,  setCanvasMode]  = useState('tiers') // 'tiers' | 'diagram'
  const [modal, setModal] = useState(null) // 'create' | 'blueprint' | 'add-service' | 'compose' | 'clone' | 'layman-help' | 'stack-config' | 'rename-stack'
  const [renameForm, setRenameForm] = useState({ name: '', client: '' })
  const [selectedTierConfig, setSelectedTierConfig] = useState(null) // { role, label }
  const [tierConfigs, setTierConfigs] = useState({}) // keyed by role
  const [stackGlobalConfig, setStackGlobalConfig] = useState({})
  const [createForm, setCreateForm] = useState({ name: '', description: '', client: '', environment: 'production', blueprintId: null })

  const addToast = useCallback((message, type = 'success') => {
    const id = Date.now()
    setToasts((t) => [...t, { id, message, type }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000)
  }, [])

  const load = useCallback(async () => {
    try {
      const [stacksRes, bpRes] = await Promise.all([
        api.get('/stacks'),
        api.get('/stacks/blueprints')
      ])
      setStacks(stacksRes.data)
      setBlueprints(bpRes.data)
    } catch {
      addToast('Erro ao carregar stacks', 'error')
    } finally {
      setLoading(false)
    }
  }, [addToast])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const state = location.state || {}
    if (!state.selectedStackId && !state.openModal) return

    if (state.selectedStackId && stacks.length) {
      const targetStack = stacks.find((stack) => stack.id === state.selectedStackId)
      if (targetStack) setSelectedStack(targetStack)
    }

    if (state.openModal) {
      setModal(state.openModal)
    }

    if (!state.selectedStackId || stacks.length) {
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [location.pathname, location.state, navigate, stacks])

  // Mantém selectedStack sincronizado
  useEffect(() => {
    if (selectedStack) {
      const updated = stacks.find((s) => s.id === selectedStack.id)
      if (updated) setSelectedStack(updated)
    }
  }, [stacks]) // eslint-disable-line

  // ── Carregar configs de tier e stack global quando muda a stack selecionada ──
  useEffect(() => {
    if (!selectedStack) return
    const savedTier = localStorage.getItem(`tier-configs-${selectedStack.id}`)
    if (savedTier) { try { setTierConfigs(JSON.parse(savedTier)) } catch { setTierConfigs({}) } }
    else setTierConfigs(selectedStack.tierConfigs || {})
    const savedGlobal = localStorage.getItem(`stack-global-cfg-${selectedStack.id}`)
    if (savedGlobal) { try { setStackGlobalConfig(JSON.parse(savedGlobal)) } catch { setStackGlobalConfig({}) } }
    else setStackGlobalConfig(selectedStack.globalConfig || {})
  }, [selectedStack?.id]) // eslint-disable-line

  const saveTierConfig = useCallback(async (role, cfg) => {
    const next = { ...tierConfigs, [role]: cfg }
    setTierConfigs(next)
    if (selectedStack) {
      localStorage.setItem(`tier-configs-${selectedStack.id}`, JSON.stringify(next))
      try { await api.put(`/stacks/${selectedStack.id}`, { tierConfigs: next }) } catch { /* non-critical */ }
    }
    setSelectedTierConfig(null)
  }, [tierConfigs, selectedStack])

  const saveStackGlobalConfig = useCallback(async (cfg) => {
    setStackGlobalConfig(cfg)
    if (selectedStack) {
      localStorage.setItem(`stack-global-cfg-${selectedStack.id}`, JSON.stringify(cfg))
      try { await api.put(`/stacks/${selectedStack.id}`, { globalConfig: cfg }) } catch { /* non-critical */ }
    }
  }, [selectedStack])

  const openRename = () => {
    setRenameForm({ name: selectedStack.name || '', client: selectedStack.client || '' })
    setModal('rename-stack')
  }

  const saveRename = async () => {
    const { name, client } = renameForm
    if (!name.trim()) return
    try {
      const { data } = await api.put(`/stacks/${selectedStack.id}`, { name: name.trim(), client: client.trim() })
      setStacks((s) => s.map((st) => st.id === selectedStack.id ? { ...st, ...data } : st))
      setSelectedStack((prev) => ({ ...prev, name: name.trim(), client: client.trim() }))
      setModal(null)
      addToast('Stack renomeada com sucesso')
    } catch {
      addToast('Erro ao renomear a stack')
    }
  }

  // ── Ações de Stack ──────────────────────────────────────────────────────────

  const createStack = async () => {
    try {
      const { data } = await api.post('/stacks', {
        ...createForm,
        blueprintId: createForm.blueprintId || null
      })
      setStacks((s) => [...s, data])
      setModal(null)
      setCreateForm({ name: '', description: '', client: '', environment: 'production', blueprintId: null })
      addToast('Stack criada com sucesso')
      setSelectedStack(data)
    } catch (err) {
      addToast(err.response?.data?.error || 'Erro ao criar stack', 'error')
    }
  }

  const deleteStack = async (id) => {
    const ok = await confirm({ title: 'Deletar stack', message: 'Todos os containers serão removidos. Deseja continuar?', confirmText: 'Deletar', variant: 'danger' }); if (!ok) return
    try {
      await api.delete(`/stacks/${id}`)
      setStacks((s) => s.filter((x) => x.id !== id))
      if (selectedStack?.id === id) setSelectedStack(null)
      addToast('Stack removida')
    } catch (err) {
      addToast(err.response?.data?.error || 'Erro ao deletar', 'error')
    }
  }

  const startStack = async (stack) => {
    // Validate before starting
    try {
      const { data: validation } = await api.get(`/stacks/${stack.id}/validate`)
      if (validation.errors && validation.errors.length > 0) {
        setProgressLog({
          title: `Valida\u00e7\u00e3o falhou \u2014 "${stack.name}"`,
          messages: [
            '\ud83d\udd0d Valida\u00e7\u00e3o pr\u00e9-deploy:',
            ...validation.errors.map((e) => `\u274c ${e}`),
            ...(validation.warnings || []).map((w) => `\u26a0\ufe0f  ${w}`),
            '',
            '\u274c Corrija os erros acima antes de iniciar a stack.'
          ]
        })
        return
      }
    } catch (err) {
      // If validation endpoint fails, proceed anyway
    }

    const messages = []
    setProgressLog({ title: `Iniciando stack "${stack.name}"`, messages })

    try {
      const response = await fetch(`/api/stacks/${stack.id}/start`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('provirpanel-token') || ''}` }
      })
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.message) {
              messages.push(data.message)
              setProgressLog((p) => ({ ...p, messages: [...messages] }))
            }
            if (data.done) {
              load()
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (err) {
      messages.push(`\u274c Erro de conex\u00e3o: ${err.message}`)
      setProgressLog((p) => ({ ...p, messages: [...messages] }))
    }
    load()
  }

  const stopStack = async (stack) => {
    const messages = []
    setProgressLog({ title: `Parando stack "${stack.name}"`, messages })

    try {
      const response = await fetch(`/api/stacks/${stack.id}/stop`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('provirpanel-token') || ''}` }
      })
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.message) {
              messages.push(data.message)
              setProgressLog((p) => ({ ...p, messages: [...messages] }))
            }
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      messages.push(`\u274c Erro: ${err.message}`)
      setProgressLog((p) => ({ ...p, messages: [...messages] }))
    }
    load()
  }

  const syncStack = async (stack) => {
    try {
      const { data } = await api.post(`/stacks/${stack.id}/sync`)
      setStacks((s) => s.map((x) => x.id === data.id ? data : x))
      addToast('Status sincronizado')
    } catch {
      addToast('Erro ao sincronizar', 'error')
    }
  }

  // ── Ações de Serviço ────────────────────────────────────────────────────────

  const addService = async (serviceData) => {
    try {
      const { data } = await api.post(`/stacks/${selectedStack.id}/services`, serviceData)
      setModal(null)
      setAddServiceStage(null)
      const updated = await api.get(`/stacks/${selectedStack.id}`)
      setStacks((s) => s.map((x) => x.id === updated.data.id ? updated.data : x))
      setSelectedStack(updated.data)
      setSelectedService(data)
      addToast(`Servico "${data.name}" adicionado`)
    } catch (err) {
      addToast(err.response?.data?.error || "Erro ao adicionar servico", "error")
    }
  }

  const saveService = useCallback(async (form) => {
    try {
      // Strip File objects from projectFiles before sending as JSON
      const payload = {
        ...form,
        projectFiles: (form.projectFiles || []).map(({ file, ...rest }) => rest)
      }
      await api.put(`/stacks/${selectedStack.id}/services/${selectedService.id}`, payload)
      addToast("Servico atualizado")
      // Reload stack in background without changing selectedService reference
      api.get(`/stacks/${selectedStack.id}`).then((res) => {
        setStacks((s) => s.map((x) => x.id === res.data.id ? res.data : x))
      })
    } catch (err) {
      addToast(err.response?.data?.error || "Erro ao salvar", "error")
    }
  }, [selectedStack?.id, selectedService?.id, addToast])

  const removeService = async (serviceId) => {
    const ok2 = await confirm({ title: 'Remover serviu00e7o', message: 'Este serviu00e7o seru00e1 removido da stack. Deseja continuar?', confirmText: 'Remover', variant: 'danger' }); if (!ok2) return
    try {
      await api.delete(`/stacks/${selectedStack.id}/services/${serviceId}`)
      const updated = await api.get(`/stacks/${selectedStack.id}`)
      setStacks((s) => s.map((x) => x.id === updated.data.id ? updated.data : x))
      setSelectedStack(updated.data)
      setSelectedService(null)
      addToast('Serviço removido')
    } catch (err) {
      addToast(err.response?.data?.error || 'Erro ao remover', 'error')
    }
  }

  const bulkRemoveServices = useCallback(async (serviceIds) => {
    if (!serviceIds.length) return
    try {
      for (const id of serviceIds) {
        await api.delete(`/stacks/${selectedStack.id}/services/${id}`)
      }
      const updated = await api.get(`/stacks/${selectedStack.id}`)
      setStacks((s) => s.map((x) => x.id === updated.data.id ? updated.data : x))
      setSelectedStack(updated.data)
      setSelectedService(null)
      addToast(serviceIds.length > 1 ? `${serviceIds.length} serviços removidos` : 'Serviço removido')
    } catch (err) {
      addToast(err.response?.data?.error || 'Erro ao remover', 'error')
    }
  }, [selectedStack]) // eslint-disable-line

  const startService = async (svc) => {
    const messages = []
    setProgressLog({ title: `Iniciando ${svc.name}`, messages })

    try {
      const response = await fetch(`/api/stacks/${selectedStack.id}/services/${svc.id}/start`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('provirpanel-token') || ''}` }
      })
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.message) {
              messages.push(data.message)
              setProgressLog((p) => ({ ...p, messages: [...messages] }))
            }
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      messages.push(`\u274c Erro: ${err.message}`)
      setProgressLog((p) => ({ ...p, messages: [...messages] }))
    }
    syncStack(selectedStack)
  }

  const stopService = async (svc) => {
    try {
      await api.post(`/stacks/${selectedStack.id}/services/${svc.id}/stop`)
      addToast(`${svc.name} parado`)
      syncStack(selectedStack)
    } catch { addToast('Erro ao parar serviço', 'error') }
  }

  // ── Canvas: conexões de dependência ─────────────────────────────────────────

  const connectServices = useCallback(async (fromId, toId) => {
    const fromSvc = selectedStack?.services?.find((s) => s.id === fromId)
    if (!fromSvc || fromId === toId) return
    const deps = fromSvc.dependencies || []
    if (deps.includes(toId)) return
    try {
      await api.put(`/stacks/${selectedStack.id}/services/${fromId}`, { ...fromSvc, dependencies: [...deps, toId] })
      const updated = await api.get(`/stacks/${selectedStack.id}`)
      setStacks((s) => s.map((x) => x.id === updated.data.id ? updated.data : x))
      setSelectedStack(updated.data)
      addToast('Conexão criada')
    } catch { addToast('Erro ao conectar serviços', 'error') }
  }, [selectedStack, addToast])

  const disconnectServices = useCallback(async (fromId, toId) => {
    const fromSvc = selectedStack?.services?.find((s) => s.id === fromId)
    if (!fromSvc) return
    try {
      const deps = (fromSvc.dependencies || []).filter((d) => d !== toId)
      await api.put(`/stacks/${selectedStack.id}/services/${fromId}`, { ...fromSvc, dependencies: deps })
      const updated = await api.get(`/stacks/${selectedStack.id}`)
      setStacks((s) => s.map((x) => x.id === updated.data.id ? updated.data : x))
      setSelectedStack(updated.data)
      addToast('Conexão removida')
    } catch { addToast('Erro ao remover conexão', 'error') }
  }, [selectedStack, addToast])

  // ── Blueprint ────────────────────────────────────────────────────────────────

  const applyBlueprint = (bp) => {
    setCreateForm((f) => ({ ...f, blueprintId: bp.id, name: f.name || bp.name }))
    setModal('create')
  }

  const openAddServiceModal = (stageKey = null) => {
    setAddServiceStage(stageKey)
    setModal('add-service')
  }

  // ── Views ────────────────────────────────────────────────────────────────────

  const stackStatus = (stack) => {
    const statuses = stack.services?.map((s) => s.status) || []
    if (!statuses.length) return { icon: Clock, label: 'Vazio', class: 'text-slate-500' }
    if (statuses.every((s) => s === 'running')) return { icon: CheckCircle2, label: 'Rodando', class: 'text-emerald-400' }
    if (statuses.some((s) => s === 'running')) return { icon: AlertCircle, label: 'Parcial', class: 'text-amber-400' }
    return { icon: Clock, label: 'Parado', class: 'text-slate-400' }
  }

  const laymanModel = useMemo(() => {
    if (!selectedStack?.services?.length) return []

    const classified = selectedStack.services.map((service) => ({
      ...service,
      __canvasRole: inferServiceCanvasRole(service)
    }))

    const byRole = classified.reduce((acc, service) => {
      const role = service.__canvasRole
      if (!acc[role]) acc[role] = []
      acc[role].push(service)
      return acc
    }, {})

    return STARTUP_SEQUENCE
      .filter((role) => (byRole[role] || []).length > 0)
      .map((role, index) => {
        const roleServices = byRole[role] || []
        const roleCfg = SERVICE_ROLES[role] || SERVICE_ROLES.runtime
        const laymanCfg = LAYMAN_ROLE_GUIDE[role]
        return {
          step: index + 1,
          role,
          roleCfg,
          laymanCfg,
          services: roleServices
        }
      })
  }, [selectedStack])

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="zeus-stacks-page flex h-full flex-col gap-4">
      {/* Toasts */}
      <div className="fixed right-4 top-4 z-50 flex flex-col gap-2" style={{ width: 320 }}>
        {toasts.map((t) => <Toast key={t.id} {...t} onClose={() => setToasts((x) => x.filter((y) => y.id !== t.id))} />)}
      </div>

      {/* Modals */}
      {modal === 'blueprint' && (
        <BlueprintLibrary onSelect={applyBlueprint} onClose={() => setModal(null)} />
      )}
      {modal === 'import-services' && selectedStack && (
        <ImportServicesModal
          stackId={selectedStack.id}
          onImported={(updatedStack) => {
            setStacks((s) => s.map((x) => x.id === updatedStack.id ? updatedStack : x))
            setSelectedStack(updatedStack)
            setModal(null)
            addToast('Serviços importados com sucesso')
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'add-service' && (
        <AddServiceModal
          stageKey={addServiceStage}
          onAdd={addService}
          stack={selectedStack}
          onClose={() => {
            setModal(null)
            setAddServiceStage(null)
          }}
        />
      )}
      {modal === 'compose' && selectedStack && (
        <ComposeModal stack={selectedStack} onClose={() => setModal(null)} />
      )}
      {modal === 'import-compose' && (
        <ImportComposeModal onImported={(stack) => { setModal(null); load(); setSelectedStack(stack); addToast(`Stack "${stack.name}" importada com ${stack.services?.length || 0} servi\u00e7os`) }} onClose={() => setModal(null)} />
      )}
      {modal === 'layman-help' && (
        <LaymanHelpModal model={laymanModel} onClose={() => setModal(null)} />
      )}
      {progressLog && (
        <ProgressLog {...progressLog} onClose={() => { setProgressLog(null) }} />
      )}
      {modal === 'stack-config' && selectedStack && (
        <StackGlobalConfigPanel
          stack={selectedStack}
          config={stackGlobalConfig}
          onSave={saveStackGlobalConfig}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'rename-stack' && selectedStack && (
        <div className="zeus-stacks-modal"
          style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setModal(null) }}>
          <div className="zeus-stacks-modal-card" style={{ width: '100%', maxWidth: 400, margin: '0 16px', borderRadius: 18, border: '1px solid rgba(255,255,255,0.1)', background: 'linear-gradient(160deg,#080f1e,#060c18)', boxShadow: '0 32px 80px rgba(0,0,0,0.8)' }}>
            {/* Header */}
            <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>Renomear Stack</div>
                  <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>Altere o nome e cliente da stack</div>
                </div>
              </div>
              <button onClick={() => setModal(null)} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 7, color: '#64748b', cursor: 'pointer', padding: '4px 6px', lineHeight: 1, display: 'flex' }}>
                <X size={13} />
              </button>
            </div>

            {/* Body */}
            <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b', marginBottom: 6 }}>Nome da Stack</label>
                <input
                  autoFocus
                  value={renameForm.name}
                  onChange={(e) => setRenameForm((f) => ({ ...f, name: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && saveRename()}
                  placeholder="Minha Stack"
                  style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.04)', padding: '9px 12px', fontSize: 13, color: '#f1f5f9', outline: 'none', boxSizing: 'border-box', fontWeight: 500 }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b', marginBottom: 6 }}>Cliente / Projeto</label>
                <input
                  value={renameForm.client}
                  onChange={(e) => setRenameForm((f) => ({ ...f, client: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && saveRename()}
                  placeholder="Nome do cliente ou projeto"
                  style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.04)', padding: '9px 12px', fontSize: 12, color: '#f1f5f9', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              {/* Preview */}
              {renameForm.name && (
                <div style={{ borderRadius: 10, border: '1px solid rgba(99,102,241,0.18)', background: 'rgba(99,102,241,0.05)', padding: '10px 12px' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>{renameForm.name}</div>
                  {renameForm.client && <div style={{ fontSize: 11, color: '#475569', marginTop: 3 }}>{renameForm.client}</div>}
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.06)', padding: '12px 20px' }}>
              <button onClick={() => setModal(null)} style={{ fontSize: 11, color: '#475569', background: 'none', border: 'none', cursor: 'pointer' }}>Cancelar</button>
              <button onClick={saveRename} disabled={!renameForm.name.trim()}
                style={{ fontSize: 12, fontWeight: 600, color: '#fff', background: renameForm.name.trim() ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 10, padding: '8px 20px', cursor: renameForm.name.trim() ? 'pointer' : 'default', boxShadow: renameForm.name.trim() ? '0 4px 14px rgba(99,102,241,0.4)' : 'none', transition: 'all 0.2s', opacity: renameForm.name.trim() ? 1 : 0.4 }}>
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Criar Stack */}
      {modal === 'create' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
              <h3 className="text-sm font-semibold text-white">Nova Stack</h3>
              <button onClick={() => setModal(null)} className="text-slate-400 hover:text-white"><X size={16} /></button>
            </div>
            <div className="space-y-3 p-5">
              {createForm.blueprintId && (
                <div className="flex items-center gap-2 rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs text-blue-300">
                  <Layers size={12} />
                  Blueprint: {blueprints.find((b) => b.id === createForm.blueprintId)?.name || createForm.blueprintId}
                  <button onClick={() => setCreateForm((f) => ({ ...f, blueprintId: null }))} className="ml-auto hover:text-white"><X size={10} /></button>
                </div>
              )}
              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-widest text-slate-400">Nome da Stack *</label>
                <input value={createForm.name} onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))} autoFocus
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-blue-500/50" placeholder="API do Cliente XYZ" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[10px] uppercase tracking-widest text-slate-400">Cliente</label>
                  <input value={createForm.client} onChange={(e) => setCreateForm((f) => ({ ...f, client: e.target.value }))}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-blue-500/50" placeholder="Nome do cliente" />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] uppercase tracking-widest text-slate-400">Ambiente</label>
                  <select value={createForm.environment} onChange={(e) => setCreateForm((f) => ({ ...f, environment: e.target.value }))}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white outline-none">
                    {ENVIRONMENTS.map((env) => <option key={env.value} value={env.value}>{env.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-widest text-slate-400">Descrição</label>
                <textarea value={createForm.description} onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))} rows={2}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none resize-none focus:border-blue-500/50" placeholder="Descrição opcional..." />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-white/8 px-5 py-4">
              <button onClick={() => setModal(null)} className="rounded-xl border border-white/10 px-4 py-2 text-xs text-slate-300 hover:text-white">Cancelar</button>
              <button onClick={createStack} disabled={!createForm.name}
                className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-5 py-2 text-xs text-blue-300 hover:bg-blue-500/20 disabled:opacity-40">
                Criar Stack
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Vista: Lista de Stacks ─────────────────────────────────────────────── */}
      {!selectedStack && (
        <>
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-white">Infrastructure Canvas</h2>
              <p className="text-xs text-slate-400">Ambientes agrupados de serviços Docker</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setModal('blueprint')}
                className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs text-slate-300 hover:border-blue-300/20 hover:bg-blue-400/10 hover:text-blue-300">
                <Layers size={14} /> Blueprints
              </button>
              <button onClick={() => setModal('import-compose')}
                className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs text-slate-300 hover:border-emerald-300/20 hover:bg-emerald-400/10 hover:text-emerald-300">
                <Upload size={14} /> Importar Compose
              </button>
              <button onClick={() => setModal('create')}
                className="flex items-center gap-2 rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-xs text-blue-300 hover:bg-blue-500/20">
                <Plus size={14} /> Nova Stack
              </button>
            </div>
          </div>

          {/* Stats rápidas */}
          {stacks.length > 0 && (
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: 'Total de Stacks', value: stacks.length, icon: Layers, color: 'blue' },
                { label: 'Rodando', value: stacks.filter((s) => s.status === 'running').length, icon: CheckCircle2, color: 'emerald' },
                { label: 'Parciais', value: stacks.filter((s) => s.status === 'partial').length, icon: AlertCircle, color: 'amber' },
                { label: 'Serviços Total', value: stacks.reduce((acc, s) => acc + (s.services?.length || 0), 0), icon: Cpu, color: 'violet' }
              ].map(({ label, value, icon: Icon, color }) => (
                <div key={label} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-slate-400">{label}</p>
                    <Icon size={14} className={`text-${color}-400`} />
                  </div>
                  <p className="mt-2 text-2xl font-bold text-white">{value}</p>
                </div>
              ))}
            </div>
          )}

          {/* Grid de Stacks */}
          {loading ? (
            <div className="py-16 text-center text-sm text-slate-400">Carregando stacks...</div>
          ) : stacks.length === 0 ? (
            /* Estado vazio */
            <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-white/10 py-20">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
                <Layers size={28} className="text-slate-500" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-white">Nenhuma stack criada</p>
                <p className="mt-1 text-xs text-slate-400">Crie a partir de um blueprint ou do zero</p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setModal('blueprint')}
                  className="flex items-center gap-2 rounded-xl border border-white/10 px-5 py-2.5 text-xs text-slate-300 hover:border-blue-300/20 hover:text-blue-300">
                  <Layers size={14} /> Usar Blueprint
                </button>
                <button onClick={() => setModal('create')}
                  className="flex items-center gap-2 rounded-xl border border-blue-500/30 bg-blue-500/10 px-5 py-2.5 text-xs text-blue-300 hover:bg-blue-500/20">
                  <Plus size={14} /> Criar do Zero
                </button>
                <button onClick={() => setModal('import-compose')}
                  className="flex items-center gap-2 rounded-xl border border-white/10 px-5 py-2.5 text-xs text-slate-300 hover:border-emerald-300/20 hover:text-emerald-300">
                  <Upload size={14} /> Importar Compose
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {stacks.map((stack) => {
                const { icon: StatusIcon, label: statusLabel, class: statusClass } = stackStatus(stack)
                const runningCount = stack.services?.filter((s) => s.status === 'running').length || 0
                return (
                  <div key={stack.id} className="group rounded-2xl border border-white/8 bg-white/[0.03] p-5 transition hover:border-white/15">
                    {/* Header do card */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="truncate text-sm font-bold text-white">{stack.name}</h3>
                          <span className={`inline-flex items-center rounded-lg border px-2 py-0.5 text-[10px] font-medium ${envBadge(stack.environment)}`}>
                            {ENVIRONMENTS.find((e) => e.value === stack.environment)?.label || stack.environment}
                          </span>
                        </div>
                        {stack.client && <p className="mt-0.5 text-xs text-slate-400">{stack.client}</p>}
                        {stack.description && <p className="mt-1 text-xs text-slate-500 leading-4">{stack.description}</p>}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <StatusIcon size={14} className={statusClass} />
                        <span className={`text-xs ${statusClass}`}>{statusLabel}</span>
                      </div>
                    </div>

                    {/* Miniatura da topologia (role icons) */}
                    {stack.services?.length > 0 && (
                      <div className="mt-4 flex items-center gap-2 flex-wrap">
                        {stack.services.map((svc) => {
                          const cfg = SERVICE_ROLES[svc.role] || SERVICE_ROLES.runtime
                          const st = SERVICE_STATUS[svc.status] || SERVICE_STATUS.pending
                          const Icon = cfg.icon
                          return (
                            <div key={svc.id} className="flex items-center gap-1.5 rounded-xl border px-2 py-1"
                              style={{ borderColor: `${cfg.color}33`, background: cfg.bg }}>
                              <Icon size={11} style={{ color: cfg.color }} />
                              <span className="text-[10px] text-slate-300">{svc.name}</span>
                              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: st.color }} />
                            </div>
                          )
                        })}
                        {stack.services.length === 0 && (
                          <span className="text-xs text-slate-500">Nenhum serviço</span>
                        )}
                      </div>
                    )}

                    {/* Footer do card */}
                    <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3">
                      <span className="text-[10px] text-slate-500">
                        {stack.services?.length || 0} serviços · {runningCount} rodando · rede: {stack.network}
                      </span>
                      <div className="flex gap-1.5">
                        <button onClick={() => syncStack(stack)}
                          className="rounded-lg border border-white/10 p-1.5 text-slate-400 hover:text-white" title="Sincronizar">
                          <RefreshCw size={12} />
                        </button>
                        <button onClick={() => { stack.status === 'running' ? stopStack(stack) : startStack(stack) }}
                          className={`rounded-lg border p-1.5 ${stack.status === 'running' ? 'border-rose-500/30 text-rose-300 hover:bg-rose-500/10' : 'border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10'}`}
                          title={stack.status === 'running' ? 'Parar todos' : 'Iniciar todos'}>
                          {stack.status === 'running' ? <Square size={12} /> : <Play size={12} />}
                        </button>
                        <button onClick={() => setSelectedStack(stack)}
                          className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-2.5 py-1.5 text-[10px] text-blue-300 hover:bg-blue-500/20">
                          Abrir Canvas
                        </button>
                        <button onClick={() => deleteStack(stack.id)}
                          className="rounded-lg border border-white/10 p-1.5 text-slate-400 hover:border-rose-500/30 hover:text-rose-400" title="Deletar">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* ── Vista: Stack Detail (Canvas) ──────────────────────────────────────── */}
      {selectedStack && (
        <>
          {/* Topbar */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <button onClick={() => { setSelectedStack(null); setSelectedService(null) }}
                className="flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300 hover:text-white">
                <ChevronLeft size={14} /> Stacks
              </button>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-white">{selectedStack.name}</h2>
                  <span className={`inline-flex items-center rounded-lg border px-2 py-0.5 text-[10px] font-medium ${envBadge(selectedStack.environment)}`}>
                    {ENVIRONMENTS.find((e) => e.value === selectedStack.environment)?.label}
                  </span>
                  <button onClick={openRename} title="Renomear stack"
                    className="flex items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] p-1 text-slate-500 transition hover:border-white/20 hover:text-slate-300">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                </div>
                {selectedStack.client && <p className="text-[11px] text-slate-400">{selectedStack.client}</p>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => syncStack(selectedStack)}
                className="flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300 hover:text-white">
                <RefreshCw size={12} /> Sync
              </button>
              <button onClick={() => setModal('import-services')}
                className="flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300 hover:border-blue-300/20 hover:text-blue-300">
                <Upload size={12} /> Importar Serviços
              </button>
              <button onClick={() => setModal('compose')}
                className="flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300 hover:bg-emerald-500/20">
                <Download size={12} /> Exportar Compose
              </button>
              <button onClick={() => setModal('stack-config')}
                className="flex items-center gap-1.5 rounded-xl border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs text-violet-300 hover:bg-violet-500/20">
                <Settings size={12} /> Configurações
              </button>
              <button onClick={() => setModal('layman-help')}
                className="flex items-center gap-1.5 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-200 hover:bg-cyan-500/20">
                <Eye size={12} /> Ajuda
              </button>
              <button onClick={() => { selectedStack.status === 'running' ? stopStack(selectedStack) : startStack(selectedStack) }}
                className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs ${selectedStack.status === 'running' ? 'border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'}`}>
                {selectedStack.status === 'running' ? <><Square size={12} /> Parar Tudo</> : <><Play size={12} /> Iniciar Tudo</>}
              </button>
            </div>
          </div>

          {/* Canvas mode toggle */}
          <div className="flex items-center gap-1 self-start rounded-xl border border-white/10 bg-white/[0.03] p-0.5">
            {[
              { key: 'tiers',   label: 'Camadas',        icon: Layers },
              { key: 'diagram', label: 'Diagrama Livre',  icon: GitBranch }
            ].map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setCanvasMode(key)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] font-medium transition ${canvasMode === key ? 'bg-blue-500/15 text-blue-300 border border-blue-500/30' : 'text-slate-400 hover:text-slate-200'}`}
              >
                <Icon size={11} /> {label}
              </button>
            ))}
          </div>

          {/* Canvas + Control Sidebar */}
          <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
            <div className="min-w-0">
              {canvasMode === 'tiers' ? (
                <TopologyDiagram
                  stack={selectedStack}
                  selectedServiceId={selectedService?.id}
                  onServiceClick={(svc) => setSelectedService(selectedService?.id === svc.id ? null : svc)}
                  onAddService={(stageKey) => openAddServiceModal(stageKey || null)}
                  onConnectServices={connectServices}
                  onDisconnectEdge={disconnectServices}
                  tierConfigs={tierConfigs}
                  onTierConfigClick={(role, label) => setSelectedTierConfig({ role, label })}
                />
              ) : (
                <DiagramCanvas
                  stack={selectedStack}
                  selectedServiceId={selectedService?.id}
                  onServiceClick={(svc) => setSelectedService(selectedService?.id === svc.id ? null : svc)}
                  onAddService={() => openAddServiceModal(null)}
                  onConnectServices={connectServices}
                  onDisconnectEdge={disconnectServices}
                  onDeleteService={removeService}
                  onBulkDeleteServices={bulkRemoveServices}
                  tierConfigs={tierConfigs}
                  onGroupConfigClick={(role, label) => setSelectedTierConfig({ role, label })}
                />
              )}
            </div>

            {/* GroupConfigPanel modal overlay */}
            {selectedTierConfig && (
              <div
                style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
                onMouseDown={(e) => { if (e.target === e.currentTarget) setSelectedTierConfig(null) }}
              >
                <div style={{ width: '100%', maxWidth: 540, maxHeight: '88vh', display: 'flex', flexDirection: 'column', margin: '0 16px' }}>
                  <GroupConfigPanel
                    key={selectedTierConfig.role}
                    role={selectedTierConfig.role}
                    label={selectedTierConfig.label}
                    config={tierConfigs[selectedTierConfig.role] || {}}
                    onSave={(cfg) => saveTierConfig(selectedTierConfig.role, cfg)}
                    onClose={() => setSelectedTierConfig(null)}
                  />
                </div>
              </div>
            )}

            <aside className="space-y-3">

              <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                <p className="text-[10px] uppercase tracking-[0.24em] text-slate-400">Container Resources</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-white/8 bg-white/[0.03] p-2.5">
                    <p className="text-[10px] text-slate-500">Serviços</p>
                    <p className="mt-1 text-lg font-semibold text-white">{selectedStack.services?.length || 0}</p>
                  </div>
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-2.5">
                    <p className="text-[10px] text-emerald-300/80">Online</p>
                    <p className="mt-1 text-lg font-semibold text-emerald-300">
                      {selectedStack.services?.filter((service) => service.status === 'running').length || 0}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/8 bg-white/[0.03] p-2.5">
                    <p className="text-[10px] text-slate-500">Rede</p>
                    <p className="mt-1 truncate text-xs font-medium text-slate-200">{selectedStack.network || 'stack-net'}</p>
                  </div>
                  <div className="rounded-xl border border-white/8 bg-white/[0.03] p-2.5">
                    <p className="text-[10px] text-slate-500">Ambiente</p>
                    <p className="mt-1 text-xs font-medium text-slate-200">
                      {ENVIRONMENTS.find((env) => env.value === selectedStack.environment)?.label || selectedStack.environment}
                    </p>
                  </div>
                </div>

                <div className="mt-3 h-2 rounded-full bg-white/10">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-blue-500 to-cyan-400"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round(
                          ((selectedStack.services?.filter((service) => service.status === 'running').length || 0) /
                            Math.max(1, selectedStack.services?.length || 1)) * 100
                        )
                      )}%`
                    }}
                  />
                </div>
              </div>

              {selectedService ? (
                <div>
                <ServiceConfigPanel
                  key={selectedService.id}
                  service={selectedService}
                  stack={selectedStack}
                  onSave={saveService}
                  onDelete={removeService}
                  onClose={() => setSelectedService(null)}
                />
                <div className="mt-3 flex gap-2">
                  <BuildDeployButton stack={selectedStack} service={selectedService} onDone={() => syncStack(selectedStack)} addToast={addToast} />
                </div>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => startService(selectedService)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 py-2 text-xs text-emerald-300 hover:bg-emerald-500/20">
                    <Play size={12} /> Iniciar
                  </button>
                  <button onClick={() => stopService(selectedService)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 py-2 text-xs text-rose-300 hover:bg-rose-500/20">
                    <Square size={12} /> Parar
                  </button>
                  <button onClick={async () => {
                    try {
                      await api.post(`/stacks/${selectedStack.id}/services/${selectedService.id}/restart`)
                      addToast('Serviço reiniciado')
                      syncStack(selectedStack)
                    } catch { addToast('Erro ao reiniciar', 'error') }
                  }}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/10 py-2 text-xs text-slate-300 hover:text-white">
                    <RefreshCw size={12} /> Restart
                  </button>
                </div>
                <div className="mt-3">
                  <button onClick={async () => {
                    const cid = selectedService.containerId || (selectedService.containerIds && selectedService.containerIds[0])
                    if (!cid) { addToast("Container nao iniciado", "error"); return }
                    try {
                      const res = await api.get(`/docker/containers/${cid}/logs?tail=300`)
                      const logs = res.data?.logs || res.data || "Sem logs"
                      const lines = typeof logs === "string" ? logs.split("\n") : ["Sem logs"]
                      setProgressLog({ title: `Logs: ${selectedService.name}`, messages: lines })
                    } catch {
                      try {
                        const res = await api.get(`/stacks/${selectedStack.id}/services/${selectedService.id}/logs`)
                        setProgressLog({ title: `Logs: ${selectedService.name}`, messages: (res.data?.logs || "Sem logs").split("\n") })
                      } catch (err) { addToast("Erro ao carregar logs", "error") }
                    }
                  }}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-blue-500/30 bg-blue-500/10 py-2 text-xs text-blue-300 hover:bg-blue-500/20">
                    <Eye size={12} /> Ver Logs
                  </button>
                </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-white/12 bg-white/[0.02] p-5 text-center">
                  <p className="text-sm font-medium text-slate-200">Selecione um nó</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Clique em um serviço no canvas para editar imagem, portas, variáveis e dependências.
                  </p>
                </div>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  )
}
