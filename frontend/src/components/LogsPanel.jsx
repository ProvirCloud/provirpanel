import { useState, useEffect, useRef } from 'react'
import { Search, Calendar, AlertTriangle, CheckCircle, XCircle, RefreshCw } from 'lucide-react'
import api from '../services/api.js'

const LogsPanel = () => {
  const [logs, setLogs] = useState([])
  const [filteredLogs, setFilteredLogs] = useState([])
  const [health, setHealth] = useState({})
  const [loading, setLoading] = useState(true)
  const [searchText, setSearchText] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [levelFilter, setLevelFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [groupBySource, setGroupBySource] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const logsEndRef = useRef(null)

  const loadLogs = async () => {
    try {
      const response = await api.get('/logs')
      setLogs(response.data.logs || [])
    } catch (error) {
      console.error('Erro ao carregar logs:', error)
    }
  }

  const loadHealth = async () => {
    try {
      const response = await api.get('/health')
      console.log('Health response:', response.data)
      setHealth(response.data)
    } catch (error) {
      console.error('Erro ao carregar health:', error)
      setHealth({ status: 'error', message: 'Erro ao conectar com o servidor' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadLogs()
    loadHealth()
    
    if (autoRefresh) {
      const interval = setInterval(() => {
        loadLogs()
        loadHealth()
      }, 5000)
      return () => clearInterval(interval)
    }
  }, [autoRefresh])

  useEffect(() => {
    let filtered = logs

    if (searchText) {
      filtered = filtered.filter(log => 
        log.message.toLowerCase().includes(searchText.toLowerCase()) ||
        log.level.toLowerCase().includes(searchText.toLowerCase())
      )
    }

    if (dateFilter) {
      const filterDate = new Date(dateFilter).toDateString()
      filtered = filtered.filter(log => 
        new Date(log.timestamp).toDateString() === filterDate
      )
    }

    if (levelFilter !== 'all') {
      filtered = filtered.filter(log => log.level === levelFilter)
    }

    if (sourceFilter !== 'all') {
      filtered = filtered.filter(log => log.source === sourceFilter)
    }

    setFilteredLogs(filtered)
  }, [logs, searchText, dateFilter, levelFilter, sourceFilter])

  useEffect(() => {
    if (autoRefresh) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [filteredLogs, autoRefresh])

  const getLevelColor = (level) => {
    switch (level.toLowerCase()) {
      case 'error': return 'text-red-400 bg-red-500/10'
      case 'warn': return 'text-yellow-400 bg-yellow-500/10'
      case 'info': return 'text-blue-400 bg-blue-500/10'
      case 'debug': return 'text-slate-400 bg-slate-500/10'
      default: return 'text-slate-300 bg-slate-500/10'
    }
  }

  const getHealthIcon = (status) => {
    switch (status) {
      case 'healthy': return <CheckCircle className="h-5 w-5 text-green-400" />
      case 'warning': return <AlertTriangle className="h-5 w-5 text-yellow-400" />
      case 'error': return <XCircle className="h-5 w-5 text-red-400" />
      default: return <AlertTriangle className="h-5 w-5 text-slate-400" />
    }
  }

  const formatTimestamp = (timestamp) => {
    return new Date(timestamp).toLocaleString('pt-BR')
  }

  const sources = Array.from(
    new Set(logs.map((log) => log.source).filter(Boolean))
  ).sort()

  const sourceCounts = logs.reduce((acc, log) => {
    const key = log.source || 'unknown'
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})

  const groupedLogs = filteredLogs.reduce((acc, log) => {
    const key = log.source || 'unknown'
    if (!acc[key]) acc[key] = []
    acc[key].push(log)
    return acc
  }, {})

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Sistema</p>
          <h2 className="text-2xl font-semibold text-white">Logs e Monitoramento</h2>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-slate-600 bg-slate-700 text-blue-500"
            />
            Auto-refresh
          </label>
          <button
            onClick={() => { loadLogs(); loadHealth(); }}
            className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-200 transition hover:border-blue-500/60"
          >
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </button>
        </div>
      </div>

      {/* Health Check */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <h3 className="text-lg font-semibold text-white mb-4">Status dos Serviços</h3>
        {loading ? (
          <div className="text-slate-400">Verificando serviços...</div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {Object.entries(health.services || {}).map(([service, data]) => (
              <div key={service} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <div>
                  <p className="font-medium text-white">{service}</p>
                  <p className="text-xs text-slate-400">{data.message}</p>
                </div>
                {getHealthIcon(data.status)}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Filtros */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="grid gap-4 md:grid-cols-5">
          <div>
            <label className="block text-sm text-slate-300 mb-2">Buscar</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Filtrar logs..."
                className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-10 pr-3 py-2 text-sm text-white"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-2">Data</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="date"
                className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-10 pr-3 py-2 text-sm text-white"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-2">Nível</label>
            <select
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value)}
            >
              <option value="all">Todos</option>
              <option value="error">Error</option>
              <option value="warn">Warning</option>
              <option value="info">Info</option>
              <option value="debug">Debug</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-2">Fonte</label>
            <select
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
            >
              <option value="all">Todas</option>
              {sources.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-2">Ações</label>
            <button
              onClick={() => {
                setSearchText('')
                setDateFilter('')
                setLevelFilter('all')
                setSourceFilter('all')
                setGroupBySource(false)
              }}
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
            >
              Limpar Filtros
            </button>
          </div>
        </div>
      </div>

      {/* Logs */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">
            Logs do Sistema ({filteredLogs.length})
          </h3>
          <div className="text-xs text-slate-400">
            {filteredLogs.length !== logs.length && `${logs.length} total`}
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            className={`rounded-full border px-3 py-1 text-xs ${
              sourceFilter === 'all'
                ? 'border-blue-500/60 bg-blue-500/10 text-blue-200'
                : 'border-slate-700 text-slate-300 hover:bg-slate-800'
            }`}
            onClick={() => setSourceFilter('all')}
          >
            Todas ({logs.length})
          </button>
          {sources.map((source) => (
            <button
              key={source}
              className={`rounded-full border px-3 py-1 text-xs ${
                sourceFilter === source
                  ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-200'
                  : 'border-slate-700 text-slate-300 hover:bg-slate-800'
              }`}
              onClick={() => setSourceFilter(source)}
            >
              {source} ({sourceCounts[source] || 0})
            </button>
          ))}
          <label className="ml-auto flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={groupBySource}
              onChange={(e) => setGroupBySource(e.target.checked)}
              className="rounded border-slate-600 bg-slate-700 text-blue-500"
            />
            Agrupar por fonte
          </label>
        </div>
        
        <div className="h-96 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/80 p-4">
          {filteredLogs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-slate-400">
              Nenhum log encontrado
            </div>
          ) : (
            <div className="space-y-2 font-mono text-sm">
              {!groupBySource &&
                filteredLogs.map((log, index) => (
                  <div key={index} className="flex gap-3 py-1">
                    <span className="text-slate-500 whitespace-nowrap">
                      {formatTimestamp(log.timestamp)}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold whitespace-nowrap ${getLevelColor(log.level)}`}>
                      {log.level.toUpperCase()}
                    </span>
                    {log.source && (
                      <span className="px-2 py-0.5 rounded text-xs font-semibold whitespace-nowrap bg-slate-700/60 text-slate-200">
                        {log.source}
                      </span>
                    )}
                    <span className="text-slate-200 break-all">
                      {log.message}
                    </span>
                  </div>
                ))}
              {groupBySource &&
                Object.entries(groupedLogs).map(([source, items]) => (
                  <div key={source} className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-emerald-200">{source}</span>
                      <span className="text-[10px] text-slate-400">{items.length} linhas</span>
                    </div>
                    <div className="space-y-2">
                      {items.map((log, index) => (
                        <div key={`${source}-${index}`} className="flex gap-3 py-1">
                          <span className="text-slate-500 whitespace-nowrap">
                            {formatTimestamp(log.timestamp)}
                          </span>
                          <span className={`px-2 py-0.5 rounded text-xs font-semibold whitespace-nowrap ${getLevelColor(log.level)}`}>
                            {log.level.toUpperCase()}
                          </span>
                          <span className="text-slate-200 break-all">
                            {log.message}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              <div ref={logsEndRef} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default LogsPanel
