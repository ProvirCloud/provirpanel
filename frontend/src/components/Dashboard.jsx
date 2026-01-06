import { useEffect, useMemo, useState } from 'react'
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

const RingChart = ({ value, label }) => {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="h-28 w-28">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={ringData(value)}
              innerRadius={38}
              outerRadius={52}
              paddingAngle={3}
              dataKey="value"
              stroke="none"
            >
              <Cell fill="#3B82F6" />
              <Cell fill="#0f172a" />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{label}</p>
        <p className="mt-2 text-2xl font-semibold text-white">{value}%</p>
      </div>
    </div>
  )
}

const Dashboard = () => {
  const [metrics, setMetrics] = useState(null)
  const [socketStatus, setSocketStatus] = useState('disconnected')
  const token = localStorage.getItem('token')
  const socket = useMemo(() => createMetricsSocket(token), [token])

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
      <div className="grid gap-6 lg:grid-cols-3">
        <RingChart value={cpu} label="CPU" />
        <RingChart value={ramPercent} label="RAM" />
        <RingChart value={diskPercent} label="Disco" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Processos</p>
              <h2 className="text-xl font-semibold text-white">Top 5 por CPU e RAM</h2>
            </div>
            <span className="rounded-full border border-blue-500/40 bg-blue-500/10 px-3 py-1 text-xs text-blue-200">
              {socketStatus === 'connected' ? 'Atualizacao ao vivo' : 'Atualizacao parcial'}
            </span>
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-800">
            <table className="w-full text-left text-sm text-slate-200">
              <thead className="bg-slate-950 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3">Processo</th>
                  <th className="px-4 py-3">CPU%</th>
                  <th className="px-4 py-3">RAM%</th>
                </tr>
              </thead>
              <tbody>
                {processes.map((proc) => (
                  <tr key={proc.pid} className="border-t border-slate-800">
                    <td className="px-4 py-3">{proc.command}</td>
                    <td className="px-4 py-3 text-blue-200">{proc.cpu}</td>
                    <td className="px-4 py-3 text-blue-200">{proc.mem}</td>
                  </tr>
                ))}
                {processes.length === 0 && (
                  <tr>
                    <td className="px-4 py-4 text-slate-500" colSpan={3}>
                      Aguardando dados...
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Uptime</p>
            <p className="mt-3 text-2xl font-semibold text-white">
              {metrics?.system?.uptime ? `${Math.floor(metrics.system.uptime / 3600)}h` : '—'}
            </p>
            <p className="mt-1 text-xs text-slate-400">{metrics?.system?.hostname || 'Servidor'}</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-950 to-blue-950/40 p-5">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Containers</p>
            <p className="mt-3 text-2xl font-semibold text-white">
              {metrics?.containersRunning ?? '—'}
            </p>
            <p className="mt-1 text-xs text-blue-200">Rodando agora</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">RAM total</p>
            <p className="mt-3 text-xl font-semibold text-white">{formatBytes(memoryTotal)}</p>
            <p className="mt-1 text-xs text-slate-400">{formatBytes(memoryUsed)} usada</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Disco total</p>
            <p className="mt-3 text-xl font-semibold text-white">{formatBytes(diskTotal)}</p>
            <p className="mt-1 text-xs text-slate-400">{formatBytes(diskUsed)} usado</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Dashboard
