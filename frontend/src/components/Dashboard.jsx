import { useEffect, useMemo, useState } from 'react'
import { Activity, Cpu, HardDrive, MemoryStick, RadioTower, ServerCog } from 'lucide-react'
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts'
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

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <SectionContainer title="Processos" subtitle="Top 5 por CPU e consumo de memória.">
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
                    <td className="px-5 py-3 text-xs font-semibold text-[var(--color-brand)]">{process.cpu}</td>
                    <td className="px-5 py-3 text-xs font-semibold text-[var(--zeus-electric-400)]">{process.mem}</td>
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
