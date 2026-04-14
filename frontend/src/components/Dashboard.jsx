import { useEffect, useMemo, useState } from 'react'
import { Cpu, HardDrive, MemoryStick, RadioTower, ServerCog, Activity } from 'lucide-react'
import { PieChart, Pie, ResponsiveContainer, Cell } from 'recharts'
import { createMetricsSocket } from '../services/socket.js'
import api from '../services/api.js'

const formatBytes = (bytes) => {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`
}

const percent = (used, total) => {
  if (!total) return 0
  return Number(((used / total) * 100).toFixed(1))
}

const ringData = (v) => [{ value: v }, { value: 100 - v }]

/* ── Ring chart ──────────────────────────────────────────────────────────────── */
const RingChart = ({ value, label, icon: Icon, accentColor }) => {
  const fill = accentColor || 'var(--accent)'
  const track = 'rgba(255,255,255,0.06)'

  return (
    <div
      className="rounded-xl p-5"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="zeus-section-label">{label}</p>
          <p className="mt-2 text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
            {value}
            <span className="text-lg font-normal" style={{ color: 'var(--text-muted)' }}>%</span>
          </p>
        </div>
        <div
          className="flex h-9 w-9 items-center justify-center rounded-lg"
          style={{ background: `${fill}18`, border: `1px solid ${fill}30` }}
        >
          <Icon size={16} style={{ color: fill }} />
        </div>
      </div>

      <div className="mt-4 h-28">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={ringData(value)}
              innerRadius={38}
              outerRadius={50}
              paddingAngle={2}
              dataKey="value"
              stroke="none"
              startAngle={90}
              endAngle={-270}
            >
              <Cell fill={fill} />
              <Cell fill={track} />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Mini bar */}
      <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: 'var(--border-subtle)' }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${value}%`, background: fill }}
        />
      </div>
    </div>
  )
}

/* ── Stat card ────────────────────────────────────────────────────────────────── */
const StatCard = ({ label, value, sub, icon: Icon, accent }) => (
  <div
    className="rounded-xl p-4"
    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}
  >
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="zeus-section-label">{label}</p>
        <p className="mt-2 text-2xl font-bold truncate" style={{ color: 'var(--text-primary)' }}>{value}</p>
        {sub && <p className="mt-1 text-xs truncate" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
      </div>
      {Icon && (
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          style={{ background: accent ? `${accent}18` : 'var(--accent-dim)', border: `1px solid ${accent || 'var(--accent)'}30` }}
        >
          <Icon size={15} style={{ color: accent || 'var(--accent)' }} />
        </div>
      )}
    </div>
  </div>
)

/* ── Dashboard ────────────────────────────────────────────────────────────────── */
const Dashboard = () => {
  const [metrics, setMetrics] = useState(null)
  const [socketStatus, setSocketStatus] = useState('disconnected')
  const socket = useMemo(() => createMetricsSocket(), [])

  useEffect(() => {
    if (!socket) return
    socket.on('metrics', setMetrics)
    socket.on('connect', () => setSocketStatus('connected'))
    socket.on('disconnect', () => setSocketStatus('disconnected'))
    socket.on('connect_error', () => setSocketStatus('error'))
    return () => {
      socket.off('metrics', setMetrics)
      socket.disconnect()
    }
  }, [socket])

  useEffect(() => {
    let active = true
    const load = async () => {
      try { const r = await api.get('/api/metrics'); if (active) setMetrics(r.data) } catch { /* ignore */ }
    }
    load()
    const t = setInterval(() => { if (socketStatus !== 'connected') load() }, 10000)
    return () => { active = false; clearInterval(t) }
  }, [socketStatus])

  const cpu         = metrics?.cpu ? Number(metrics.cpu.toFixed(1)) : 0
  const memUsed     = metrics?.memory?.used || 0
  const memTotal    = metrics?.memory?.total || 0
  const diskUsed    = metrics?.disk?.used || 0
  const diskTotal   = metrics?.disk?.total || 0
  const ramPercent  = percent(memUsed, memTotal)
  const diskPercent = percent(diskUsed, diskTotal)
  const processes   = metrics?.processes || []
  const isLive      = socketStatus === 'connected'

  return (
    <div className="space-y-5">
      <div
        className="zeus-tech-surface rounded-xl px-6 py-5 flex items-center justify-between gap-4"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}
      >
        <div>
          <p className="zeus-heading-kicker">Operations Center</p>
          <h1 className="zeus-heading-title" style={{ fontSize: '1.55rem' }}>
            Dashboard
          </h1>
          <p className="zeus-heading-subtitle">
            Monitoramento em tempo real — Docker, Nginx, storage e segurança.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className="h-2 w-2 rounded-full"
            style={{
              background: isLive ? 'var(--success)' : 'var(--text-muted)',
              boxShadow: isLive ? '0 0 8px rgba(34,197,94,0.6)' : 'none'
            }}
          />
          <span className="text-xs" style={{ color: isLive ? 'var(--success)' : 'var(--text-muted)' }}>
            {isLive ? 'Telemetria ao vivo' : 'Polling ativo'}
          </span>
        </div>
      </div>

      {/* ── Stat cards ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard
          label="Host"
          value={metrics?.system?.hostname || '—'}
          sub={metrics?.system?.uptime ? `Uptime ${Math.floor(metrics.system.uptime / 3600)}h` : 'Coletando dados...'}
          icon={ServerCog}
        />
        <StatCard
          label="Containers ativos"
          value={metrics?.containersRunning ?? '—'}
          sub="Em execução agora"
          icon={Activity}
          accent="#22c55e"
        />
        <StatCard
          label="RAM total"
          value={formatBytes(memTotal)}
          sub={`${formatBytes(memUsed)} em uso`}
          icon={MemoryStick}
          accent="#a78bfa"
        />
        <StatCard
          label="Disco total"
          value={formatBytes(diskTotal)}
          sub={`${formatBytes(diskUsed)} utilizado`}
          icon={HardDrive}
          accent="#f59e0b"
        />
      </div>

      {/* ── Ring charts ───────────────────────────────────────────────────────── */}
      <div className="grid gap-4 xl:grid-cols-3">
        <RingChart value={cpu}         label="CPU"   icon={Cpu}        accentColor="#4d7ef7" />
        <RingChart value={ramPercent}  label="RAM"   icon={MemoryStick} accentColor="#a78bfa" />
        <RingChart value={diskPercent} label="Disco" icon={HardDrive}  accentColor="#f59e0b" />
      </div>

      {/* ── Tabela de processos + cards laterais ──────────────────────────────── */}
      <div className="grid gap-4 xl:grid-cols-[1fr_280px]">

        {/* Processos */}
        <div
          className="rounded-xl overflow-hidden"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}
        >
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <div>
              <p className="zeus-section-label">Processos</p>
              <p className="mt-0.5 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                Top 5 por CPU e RAM
              </p>
            </div>
            <span
              className="rounded-md px-2 py-1 text-xs"
              style={{
                background: isLive ? 'rgba(34,197,94,0.10)' : 'var(--bg-elevated)',
                border: `1px solid ${isLive ? 'rgba(34,197,94,0.25)' : 'var(--border-default)'}`,
                color: isLive ? 'var(--success)' : 'var(--text-muted)'
              }}
            >
              {isLive ? 'Ao vivo' : 'Polling'}
            </span>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                {['Processo', 'CPU %', 'RAM %'].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold"
                    style={{ color: 'var(--text-muted)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {processes.map((proc, i) => (
                <tr
                  key={proc.pid}
                  style={{ borderBottom: i < processes.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}
                >
                  <td className="px-5 py-3 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {proc.command}
                  </td>
                  <td className="px-5 py-3 text-xs font-semibold" style={{ color: 'var(--accent)' }}>
                    {proc.cpu}
                  </td>
                  <td className="px-5 py-3 text-xs font-semibold" style={{ color: '#a78bfa' }}>
                    {proc.mem}
                  </td>
                </tr>
              ))}
              {processes.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-5 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                    Aguardando dados do servidor...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Cards lateral */}
        <div className="space-y-3">
          {/* Telemetria */}
          <div
            className="rounded-xl p-4"
            style={{
              background: 'linear-gradient(135deg, rgba(77,126,247,0.18) 0%, rgba(77,126,247,0.05) 100%)',
              border: '1px solid rgba(77,126,247,0.25)'
            }}
          >
            <div className="flex items-center gap-3 mb-3">
              <RadioTower size={16} style={{ color: 'var(--accent)' }} />
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Telemetria</p>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Supervisão contínua de recursos, containers e tráfego de infraestrutura via WebSocket.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: isLive ? 'var(--success)' : 'var(--text-muted)' }} />
              <span className="text-xs" style={{ color: isLive ? 'var(--success)' : 'var(--text-muted)' }}>
                {isLive ? 'Conexão WebSocket ativa' : 'Modo polling (10s)'}
              </span>
            </div>
          </div>

          {/* Memória detalhada */}
          <div
            className="zeus-tech-surface rounded-xl p-4"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}
          >
            <p className="zeus-section-label mb-3">Memória detalhada</p>
            {[
              { label: 'Total', value: formatBytes(memTotal) },
              { label: 'Em uso', value: formatBytes(memUsed) },
              { label: 'Livre', value: formatBytes(memTotal - memUsed) },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between py-1.5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</span>
                <span className="text-xs font-medium mono" style={{ color: 'var(--text-primary)' }}>{value}</span>
              </div>
            ))}
          </div>

          {/* Disco detalhado */}
          <div
            className="rounded-xl p-4"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}
          >
            <p className="zeus-section-label mb-3">Disco</p>
            {[
              { label: 'Total', value: formatBytes(diskTotal) },
              { label: 'Utilizado', value: formatBytes(diskUsed) },
              { label: 'Livre', value: formatBytes(diskTotal - diskUsed) },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between py-1.5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</span>
                <span className="text-xs font-medium mono" style={{ color: 'var(--text-primary)' }}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

    </div>
  )
}

export default Dashboard
