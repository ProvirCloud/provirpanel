import { useEffect, useMemo, useState } from 'react'
import { Activity, Cpu, HardDrive, MemoryStick, RadioTower, ServerCog, Gpu, Thermometer } from 'lucide-react'
import { Cell, Pie, PieChart, ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { createMetricsSocket } from '../services/socket.js'
import api from '../services/api.js'
import MetricsRow from './dashboard/MetricsRow'
import PageHeader from './layout/PageHeader'
import Card from './ui/Card'
import SectionContainer from './ui/SectionContainer'

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

const ringData = (value) => [{ value }, { value: 100 - value }]

const RingChart = ({ value, label, icon: Icon, accentColor }) => (
  <Card className="p-5">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-text-soft)]">{label}</p>
        <p className="mt-2 text-3xl font-bold text-[var(--color-text)]">
          {value}
          <span className="ml-1 text-lg font-normal text-[var(--color-text-soft)]">%</span>
        </p>
      </div>
      <div className="flex h-10 w-10 items-center justify-center rounded-[14px] border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-brand-soft)', color: accentColor }}>
        <Icon size={16} />
      </div>
    </div>

    <div className="mt-4 h-28">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={ringData(value)} innerRadius={38} outerRadius={50} paddingAngle={2} dataKey="value" stroke="none" startAngle={90} endAngle={-270}>
            <Cell fill={accentColor} />
            <Cell fill="rgba(148, 163, 184, 0.14)" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>

    <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--color-border-subtle)]">
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${value}%`, background: accentColor }} />
    </div>
  </Card>
)

const GpuCard = ({ device }) => {
  const util = device.utilization ?? 0
  const memPercent = device.memoryPercent ?? 0
  const accent = 'var(--zeus-electric-400)'
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-text-soft)]">
            GPU {device.index} · {device.name}
          </p>
          <p className="mt-2 text-3xl font-bold text-[var(--color-text)]">
            {util}
            <span className="ml-1 text-lg font-normal text-[var(--color-text-soft)]">%</span>
          </p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">uso do processador gráfico</p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-[14px] border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-brand-soft)', color: accent }}>
          <Gpu size={16} />
        </div>
      </div>

      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[var(--color-border-subtle)]">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${util}%`, background: accent }} />
      </div>

      <div className="mt-4 flex items-center justify-between text-xs">
        <span className="font-semibold uppercase tracking-[0.16em] text-[var(--color-text-soft)]">Memória</span>
        <span className="font-mono text-[var(--color-text-muted)]">
          {device.memoryUsedMB != null ? `${(device.memoryUsedMB / 1024).toFixed(1)} / ${(device.memoryTotalMB / 1024).toFixed(1)} GB` : '—'}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--color-border-subtle)]">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${memPercent}%`, background: 'var(--color-warning)' }} />
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-[var(--color-text-muted)]">
        <span className="inline-flex items-center gap-1">
          <Thermometer size={13} className="text-[var(--color-brand)]" />
          {device.temperature != null ? `${device.temperature} °C` : '—'}
        </span>
        <span className="font-mono">
          {device.powerDraw != null && device.powerLimit != null ? `${Math.round(device.powerDraw)} / ${Math.round(device.powerLimit)} W` : ''}
        </span>
      </div>
    </Card>
  )
}

const CoreBar = ({ index, value }) => {
  const color = value >= 85 ? '#ef4444' : value >= 50 ? 'var(--color-warning)' : 'var(--zeus-electric-400)'
  return (
    <div className="flex items-center gap-2">
      <span className="w-8 shrink-0 font-mono text-[10px] text-[var(--color-text-soft)]">c{index}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-border-subtle)]">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="w-9 shrink-0 text-right font-mono text-[10px] text-[var(--color-text-muted)]">{value.toFixed(0)}%</span>
    </div>
  )
}

const HistoryChart = ({ data, dataKey, label, color, unit = '%' }) => (
  <Card className="p-5">
    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-text-soft)]">{label}</p>
    <div className="mt-3 h-40">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--color-text-soft)' }} interval="preserveStartEnd" minTickGap={40} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: 'var(--color-text-soft)' }} width={28} />
          <Tooltip
            contentStyle={{ background: 'var(--color-surface-2, #111)', border: '1px solid var(--color-border)', borderRadius: 10, fontSize: 12 }}
            formatter={(v) => [`${Number(v).toFixed(1)}${unit}`, label]}
            labelStyle={{ color: 'var(--color-text-soft)' }}
          />
          <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} fill={`url(#grad-${dataKey})`} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  </Card>
)

const Dashboard = () => {
  const [metrics, setMetrics] = useState(null)
  const [socketStatus, setSocketStatus] = useState('disconnected')
  const socket = useMemo(() => createMetricsSocket(), [])

  useEffect(() => {
    if (!socket) return undefined
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
      try {
        const response = await api.get('/api/metrics')
        if (active) setMetrics(response.data)
      } catch {
        // ignore
      }
    }
    load()
    const timer = setInterval(() => {
      if (socketStatus !== 'connected') load()
    }, 10000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [socketStatus])

  const cpu = metrics?.cpu ? Number(metrics.cpu.toFixed(1)) : 0
  const memUsed = metrics?.memory?.used || 0
  const memTotal = metrics?.memory?.total || 0
  const diskUsed = metrics?.disk?.used || 0
  const diskTotal = metrics?.disk?.total || 0
  const ramPercent = percent(memUsed, memTotal)
  const diskPercent = percent(diskUsed, diskTotal)
  const processes = metrics?.processes || []
  const isLive = socketStatus === 'connected'

  const gpuInfo = metrics?.gpu || { available: false, devices: [] }
  const gpuDevices = gpuInfo.devices || []

  const cpuCores = metrics?.cpuCores || []
  const history = (metrics?.history || []).map((p) => ({
    ...p,
    // rótulo curto de hora (HH:MM:SS) para o eixo X
    label: p.t ? new Date(p.t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '',
  }))

  const metricCards = [
    {
      label: 'Host',
      value: metrics?.system?.hostname || '—',
      hint: metrics?.system?.uptime ? `Uptime ${Math.floor(metrics.system.uptime / 3600)}h` : 'Coletando dados...',
    },
    {
      label: 'Containers ativos',
      value: metrics?.containersRunning ?? '—',
      hint: 'Em execução agora',
    },
    {
      label: 'RAM total',
      value: formatBytes(memTotal),
      hint: `${formatBytes(memUsed)} em uso`,
    },
    {
      label: 'Disco total',
      value: formatBytes(diskTotal),
      hint: `${formatBytes(diskUsed)} utilizado`,
    },
  ]

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        subtitle="Visão operacional da plataforma Zeus Cloud com telemetria de host, runtime e capacidade."
        actions={
          <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium" style={{ borderColor: isLive ? 'color-mix(in srgb, var(--color-success) 26%, transparent)' : 'var(--color-border)', background: isLive ? 'var(--color-success-soft)' : 'var(--color-surface-2)', color: isLive ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
            <span className="h-2 w-2 rounded-full" style={{ background: isLive ? 'var(--color-success)' : 'var(--color-text-soft)' }} />
            {isLive ? 'Telemetria ao vivo' : 'Polling ativo'}
          </div>
        }
      />

      <MetricsRow metrics={metricCards} />

      <div className="grid gap-4 xl:grid-cols-3">
        <RingChart value={cpu} label="CPU" icon={Cpu} accentColor="var(--color-brand)" />
        <RingChart value={ramPercent} label="RAM" icon={MemoryStick} accentColor="var(--zeus-electric-400)" />
        <RingChart value={diskPercent} label="Disco" icon={HardDrive} accentColor="var(--color-warning)" />
      </div>

      {/* Histórico da máquina */}
      {history.length > 1 && (
        <SectionContainer title="Histórico" subtitle="Telemetria dos últimos minutos (CPU, RAM e GPU).">
          <div className="grid gap-4 xl:grid-cols-3">
            <HistoryChart data={history} dataKey="cpu" label="CPU %" color="var(--color-brand)" />
            <HistoryChart data={history} dataKey="mem" label="RAM %" color="var(--zeus-electric-400)" />
            <HistoryChart data={history} dataKey="gpu" label="GPU % (média)" color="var(--color-warning)" />
          </div>
        </SectionContainer>
      )}

      {/* Distribuição por núcleo */}
      {cpuCores.length > 0 && (
        <SectionContainer
          title="Núcleos de CPU"
          subtitle={`${cpuCores.length} núcleos${metrics?.system?.loadavg ? ` · load average ${metrics.system.loadavg.join(' / ')}` : ''}`}
        >
          <Card className="p-5">
            <div className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2 xl:grid-cols-4">
              {cpuCores.map((value, i) => (
                <CoreBar key={i} index={i} value={value} />
              ))}
            </div>
          </Card>
        </SectionContainer>
      )}

      <SectionContainer
        title="GPU"
        subtitle={gpuInfo.available ? `${gpuDevices.length} dispositivo(s) NVIDIA · uso, memória e temperatura em tempo real.` : 'Aceleração gráfica do host.'}
      >
        {gpuInfo.available && gpuDevices.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {gpuDevices.map((device) => (
              <GpuCard key={device.index} device={device} />
            ))}
          </div>
        ) : (
          <Card className="p-6">
            <div className="flex items-center gap-3 text-sm text-[var(--color-text-muted)]">
              <Gpu size={18} className="text-[var(--color-text-soft)]" />
              Nenhuma GPU NVIDIA detectada neste host (ou driver indisponível no momento).
            </div>
          </Card>
        )}
      </SectionContainer>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <SectionContainer title="Processos" subtitle="Top 5 por CPU — % do total da máquina (todos os núcleos).">
          <div className="overflow-hidden rounded-[20px] border" style={{ borderColor: 'var(--color-border)' }}>
            <table className="w-full text-sm">
              <thead style={{ background: 'var(--color-panel-muted)' }}>
                <tr>
                  {['Processo', 'CPU %', 'RAM %'].map((header) => (
                    <th key={header} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-text-soft)]">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {processes.map((process, index) => (
                  <tr key={process.pid || index} className="border-t" style={{ borderColor: 'var(--color-divider)' }}>
                    <td className="px-5 py-3 font-mono text-xs text-[var(--color-text-muted)]">{process.command}</td>
                    <td
                      className="px-5 py-3 text-xs font-semibold text-[var(--color-brand)]"
                      title={process.cpuRaw != null ? `Bruto (por núcleo): ${process.cpuRaw}%` : undefined}
                    >
                      {Number(process.cpu ?? 0).toFixed(1)}%
                    </td>
                    <td className="px-5 py-3 text-xs font-semibold text-[var(--zeus-electric-400)]">{Number(process.mem ?? 0).toFixed(1)}%</td>
                  </tr>
                ))}
                {!processes.length ? (
                  <tr>
                    <td colSpan={3} className="px-5 py-10 text-center text-sm text-[var(--color-text-muted)]">Sem processos reportados no momento.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </SectionContainer>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
          <Card className="p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-text-soft)]">Conectividade</p>
                <p className="mt-3 text-lg font-semibold text-[var(--color-text)]">Socket + API</p>
                <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">Fallback automático entre WebSocket e polling para manter a operação visível.</p>
              </div>
              <RadioTower size={20} className="text-[var(--color-brand)]" />
            </div>
          </Card>
          <Card className="p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-text-soft)]">Host</p>
                <p className="mt-3 text-lg font-semibold text-[var(--color-text)]">{metrics?.system?.platform || 'Linux'}</p>
                <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">{metrics?.system?.arch || 'x64'} · {metrics?.system?.hostname || 'hostname indisponível'}</p>
              </div>
              <ServerCog size={20} className="text-[var(--color-brand)]" />
            </div>
          </Card>
          <Card className="p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-text-soft)]">Estado operacional</p>
                <p className="mt-3 text-lg font-semibold text-[var(--color-text)]">{isLive ? 'Operação monitorada' : 'Sem stream ao vivo'}</p>
                <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">A plataforma continua coletando dados mesmo sem conexão persistente.</p>
              </div>
              <Activity size={20} className="text-[var(--color-brand)]" />
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

export default Dashboard
