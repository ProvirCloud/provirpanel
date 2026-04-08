import { useEffect, useMemo, useState } from 'react'
import { Cpu, HardDrive, MemoryStick, RadioTower, ServerCog } from 'lucide-react'
import { PieChart, Pie, ResponsiveContainer, Cell } from 'recharts'
import { createMetricsSocket } from '../services/socket.js'
import api from '../services/api.js'

const formatBytes = (bytes) => {
  if (!bytes) {
    return '0 B'
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / 1024 ** index).toFixed(1)} ${units[index]}`
}

const percent = (used, total) => {
  if (!total) {
    return 0
  }
  return Number(((used / total) * 100).toFixed(1))
}

const ringData = (value) => [
  { name: 'used', value },
  { name: 'free', value: 100 - value }
]

const COLORS = ['#2563eb', '#dbeafe']

const RingChart = ({ value, label, icon: Icon, tone }) => {
  return (
    <div className="zeus-panel rounded-[2rem] p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="zeus-kicker text-[10px] font-semibold uppercase">{label}</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{value}%</p>
        </div>
        <div className={`rounded-2xl p-3 ${tone}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <div className="mt-4 h-32">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={ringData(value)} innerRadius={42} outerRadius={56} paddingAngle={3} dataKey="value" stroke="none">
              {COLORS.map((color) => (
                <Cell key={color} fill={color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

const StatCard = ({ title, value, subtitle, accent }) => (
  <div className={`rounded-[1.8rem] border px-5 py-5 ${accent}`}>
    <p className="text-[10px] font-semibold uppercase tracking-[0.3em]">{title}</p>
    <p className="mt-3 text-3xl font-bold">{value}</p>
    <p className="mt-2 text-sm opacity-75">{subtitle}</p>
  </div>
)

const Dashboard = () => {
  const [metrics, setMetrics] = useState(null)
  const [socketStatus, setSocketStatus] = useState('disconnected')
  const socket = useMemo(() => createMetricsSocket(), [])

  useEffect(() => {
    if (!socket) {
      return undefined
    }

    const handleMetrics = (payload) => {
      setMetrics(payload)
    }
    const handleConnect = () => setSocketStatus('connected')
    const handleDisconnect = () => setSocketStatus('disconnected')
    const handleError = () => setSocketStatus('error')

    socket.on('metrics', handleMetrics)
    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('connect_error', handleError)
    return () => {
      socket.off('metrics', handleMetrics)
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      socket.off('connect_error', handleError)
      socket.disconnect()
    }
  }, [socket])

  useEffect(() => {
    let active = true
    const loadMetrics = async () => {
      try {
        const response = await api.get('/api/metrics')
        if (active) setMetrics(response.data)
      } catch (err) {
        // Ignore; socket may still update.
      }
    }
    loadMetrics()
    const interval = setInterval(() => {
      if (socketStatus !== 'connected') {
        loadMetrics()
      }
    }, 10000)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [socketStatus])

  const cpu = metrics?.cpu ? Number(metrics.cpu.toFixed(1)) : 0
  const memoryUsed = metrics?.memory?.used || 0
  const memoryTotal = metrics?.memory?.total || 0
  const diskUsed = metrics?.disk?.used || 0
  const diskTotal = metrics?.disk?.total || 0
  const ramPercent = percent(memoryUsed, memoryTotal)
  const diskPercent = percent(diskUsed, diskTotal)
  const processes = metrics?.processes || []

  return (
    <div className="space-y-6">
      <section className="zeus-panel overflow-hidden rounded-[2.4rem] p-8">
        <div className="grid gap-6 lg:grid-cols-[1.4fr_0.9fr]">
          <div>
            <p className="zeus-kicker text-xs font-semibold uppercase">ZeusEngine operations center</p>
            <h1 className="zeus-title mt-4 text-4xl font-black tracking-[0.06em]">
              Infraestrutura, containers e rotas em um unico cockpit.
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-8 text-slate-600">
              Monitoramento em tempo real para deploy, Docker, Nginx, storage e seguranca com
              uma interface alinhada a identidade ZeusEngine.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <StatCard
              title="Conectividade"
              value={socketStatus === 'connected' ? 'LIVE' : 'SYNC'}
              subtitle={socketStatus === 'connected' ? 'Telemetria em tempo real' : 'Fallback por polling ativo'}
              accent="border-blue-200 bg-[linear-gradient(135deg,_rgba(255,255,255,0.96),_rgba(219,234,254,0.75))] text-slate-900"
            />
            <StatCard
              title="Containers ativos"
              value={metrics?.containersRunning ?? '—'}
              subtitle="Carga operacional em execucao"
              accent="border-sky-200 bg-[linear-gradient(135deg,_rgba(219,234,254,0.82),_rgba(125,211,252,0.26))] text-slate-900"
            />
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <RingChart value={cpu} label="CPU" icon={Cpu} tone="bg-blue-50 text-blue-700" />
        <RingChart value={ramPercent} label="RAM" icon={MemoryStick} tone="bg-sky-50 text-sky-700" />
        <RingChart value={diskPercent} label="DISCO" icon={HardDrive} tone="bg-indigo-50 text-indigo-700" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_0.9fr]">
        <section className="zeus-panel rounded-[2rem] p-6">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <p className="zeus-kicker text-[10px] font-semibold uppercase">Processos prioritarios</p>
              <h2 className="mt-2 text-2xl font-bold text-slate-900">Top 5 por CPU e RAM</h2>
            </div>
            <div className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
              {socketStatus === 'connected' ? 'Atualizacao ao vivo' : 'Atualizacao parcial'}
            </div>
          </div>

          <div className="overflow-hidden rounded-[1.5rem] border border-blue-100">
            <table className="w-full text-left text-sm text-slate-700">
              <thead className="bg-[#16366f] text-[11px] uppercase tracking-[0.22em] text-blue-50">
                <tr>
                  <th className="px-4 py-3">Processo</th>
                  <th className="px-4 py-3">CPU%</th>
                  <th className="px-4 py-3">RAM%</th>
                </tr>
              </thead>
              <tbody className="bg-white/70">
                {processes.map((proc) => (
                  <tr key={proc.pid} className="border-t border-blue-50">
                    <td className="px-4 py-3">{proc.command}</td>
                    <td className="px-4 py-3 font-semibold text-blue-700">{proc.cpu}</td>
                    <td className="px-4 py-3 font-semibold text-blue-700">{proc.mem}</td>
                  </tr>
                ))}
                {processes.length === 0 && (
                  <tr>
                    <td className="px-4 py-6 text-slate-500" colSpan={3}>
                      Aguardando dados...
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-4">
          <div className="zeus-panel rounded-[1.8rem] p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="zeus-kicker text-[10px] font-semibold uppercase">Host</p>
                <p className="mt-2 text-2xl font-bold text-slate-900">
                  {metrics?.system?.hostname || 'Servidor'}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Uptime {metrics?.system?.uptime ? `${Math.floor(metrics.system.uptime / 3600)}h` : '—'}
                </p>
              </div>
              <div className="rounded-2xl bg-blue-50 p-3 text-blue-700">
                <ServerCog className="h-5 w-5" />
              </div>
            </div>
          </div>

          <div className="zeus-panel rounded-[1.8rem] p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="zeus-kicker text-[10px] font-semibold uppercase">Memoria</p>
                <p className="mt-2 text-2xl font-bold text-slate-900">{formatBytes(memoryTotal)}</p>
                <p className="mt-1 text-sm text-slate-500">{formatBytes(memoryUsed)} em uso</p>
              </div>
              <div className="rounded-2xl bg-sky-50 p-3 text-sky-700">
                <MemoryStick className="h-5 w-5" />
              </div>
            </div>
          </div>

          <div className="zeus-panel rounded-[1.8rem] p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="zeus-kicker text-[10px] font-semibold uppercase">Disco</p>
                <p className="mt-2 text-2xl font-bold text-slate-900">{formatBytes(diskTotal)}</p>
                <p className="mt-1 text-sm text-slate-500">{formatBytes(diskUsed)} utilizado</p>
              </div>
              <div className="rounded-2xl bg-indigo-50 p-3 text-indigo-700">
                <HardDrive className="h-5 w-5" />
              </div>
            </div>
          </div>

          <div className="rounded-[1.8rem] border border-blue-300/30 bg-[linear-gradient(135deg,_#16366f,_#2563eb)] p-5 text-white shadow-[0_18px_60px_rgba(37,99,235,0.24)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-blue-100/80">Fluxo</p>
                <p className="mt-2 text-2xl font-bold">Telemetria unificada</p>
                <p className="mt-2 text-sm text-blue-100/80">
                  Supervisao de recursos, containers e trafego de infraestrutura.
                </p>
              </div>
              <RadioTower className="h-8 w-8 text-cyan-200" />
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

export default Dashboard
