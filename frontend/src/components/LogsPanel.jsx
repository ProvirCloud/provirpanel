import { useState, useEffect, useRef, useMemo } from 'react'
import {
  Search, Calendar, AlertTriangle, CheckCircle, XCircle, RefreshCw,
  Download, Copy, ChevronDown, ChevronUp, Filter, X, TrendingUp,
  Activity, AlertCircle, Info, Bug, Server, Clock, BarChart3,
  FileText, CheckSquare, Square, ChevronLeft, ChevronRight, Maximize2
} from 'lucide-react'
import api from '../services/api.js'

const LogsPanel = () => {
  const [logs, setLogs] = useState([])
  const [filteredLogs, setFilteredLogs] = useState([])
  const [stats, setStats] = useState(null)
  const [health, setHealth] = useState({})
  const [loading, setLoading] = useState(true)
  const [searchText, setSearchText] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [levelFilter, setLevelFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [selectedLogs, setSelectedLogs] = useState(new Set())
  const [showFilters, setShowFilters] = useState(true)
  const [errorOnly, setErrorOnly] = useState(false)
  const [expandedLog, setExpandedLog] = useState(null)
  const [currentErrorIndex, setCurrentErrorIndex] = useState(-1)
  const logsEndRef = useRef(null)
  const logsContainerRef = useRef(null)

  const loadLogs = async () => {
    try {
      const response = await api.get('/logs')
      setLogs(response.data.logs || [])
    } catch (error) {
      try {
        const response = await api.get('/logs/health')
        setLogs(response.data.logs || [])
      } catch (fallbackErr) {
        setLogs([])
        console.error('Erro ao carregar logs:', error)
      }
    }
  }

  const loadStats = async () => {
    try {
      const response = await api.get('/logs/stats')
      setStats(response.data.stats)
    } catch (error) {
      console.error('Erro ao carregar estatísticas:', error)
    }
  }

  const loadHealth = async () => {
    try {
      const response = await api.get('/health')
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
    loadStats()
    loadHealth()

    if (autoRefresh) {
      const interval = setInterval(() => {
        loadLogs()
        loadStats()
        loadHealth()
      }, 5000)
      return () => clearInterval(interval)
    }
  }, [autoRefresh])

  const errorLogs = useMemo(() => {
    return filteredLogs
      .map((log, index) => ({ log, index }))
      .filter(({ log }) => log.level === 'error')
  }, [filteredLogs])

  useEffect(() => {
    let filtered = logs

    if (errorOnly) {
      filtered = filtered.filter(log => log.level === 'error')
    }

    if (searchText) {
      const searchLower = searchText.toLowerCase()
      filtered = filtered.filter(log =>
        log.message.toLowerCase().includes(searchLower) ||
        log.level.toLowerCase().includes(searchLower) ||
        (log.source && log.source.toLowerCase().includes(searchLower))
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
  }, [logs, searchText, dateFilter, levelFilter, sourceFilter, errorOnly])

  useEffect(() => {
    if (autoRefresh) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [filteredLogs, autoRefresh])

  const getLevelColor = (level) => {
    switch (level.toLowerCase()) {
      case 'error': return 'text-red-400 bg-red-500/10 border-red-500/30'
      case 'warn': return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30'
      case 'info': return 'text-blue-400 bg-blue-500/10 border-blue-500/30'
      case 'debug': return 'text-slate-400 bg-slate-500/10 border-slate-500/30'
      default: return 'text-slate-300 bg-slate-500/10 border-slate-500/30'
    }
  }

  const getLevelIcon = (level) => {
    switch (level.toLowerCase()) {
      case 'error': return <XCircle className="h-4 w-4" />
      case 'warn': return <AlertTriangle className="h-4 w-4" />
      case 'info': return <Info className="h-4 w-4" />
      case 'debug': return <Bug className="h-4 w-4" />
      default: return <Activity className="h-4 w-4" />
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
    const date = new Date(timestamp)
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }

  const exportLogs = async (format) => {
    try {
      const response = await api.get(`/logs/export?format=${format}`, {
        responseType: format === 'json' ? 'json' : 'blob'
      })

      const blob = format === 'json'
        ? new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' })
        : response.data

      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `logs-${Date.now()}.${format}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Erro ao exportar logs:', error)
    }
  }

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text)
  }

  const copySelectedLogs = () => {
    const selected = filteredLogs.filter((_, index) => selectedLogs.has(index))
    const text = selected.map(log =>
      `[${formatTimestamp(log.timestamp)}] [${log.level.toUpperCase()}] [${log.source || 'unknown'}] ${log.message}`
    ).join('\n')
    copyToClipboard(text)
  }

  const copyAllLogs = () => {
    const text = filteredLogs.map(log =>
      `[${formatTimestamp(log.timestamp)}] [${log.level.toUpperCase()}] [${log.source || 'unknown'}] ${log.message}`
    ).join('\n')
    copyToClipboard(text)
  }

  const toggleLogSelection = (index) => {
    const newSelected = new Set(selectedLogs)
    if (newSelected.has(index)) {
      newSelected.delete(index)
    } else {
      newSelected.add(index)
    }
    setSelectedLogs(newSelected)
  }

  const selectAllLogs = () => {
    if (selectedLogs.size === filteredLogs.length) {
      setSelectedLogs(new Set())
    } else {
      setSelectedLogs(new Set(filteredLogs.map((_, index) => index)))
    }
  }

  const navigateToError = (direction) => {
    if (errorLogs.length === 0) return

    let newIndex
    if (currentErrorIndex === -1) {
      newIndex = direction === 'next' ? 0 : errorLogs.length - 1
    } else {
      newIndex = direction === 'next'
        ? (currentErrorIndex + 1) % errorLogs.length
        : (currentErrorIndex - 1 + errorLogs.length) % errorLogs.length
    }

    setCurrentErrorIndex(newIndex)
    const logIndex = errorLogs[newIndex].index
    setExpandedLog(logIndex)

    // Scroll to the error
    const logElement = document.getElementById(`log-${logIndex}`)
    if (logElement) {
      logElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }

  const sources = Array.from(
    new Set(logs.map((log) => log.source).filter(Boolean))
  ).sort()

  const sourceCounts = logs.reduce((acc, log) => {
    const key = log.source || 'unknown'
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})

  const clearFilters = () => {
    setSearchText('')
    setDateFilter('')
    setLevelFilter('all')
    setSourceFilter('all')
    setErrorOnly(false)
    setSelectedLogs(new Set())
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Sistema</p>
          <h2 className="text-2xl font-semibold text-white">Logs Avançados</h2>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-slate-600 bg-slate-700 text-blue-500"
            />
            Auto-refresh (5s)
          </label>
          <button
            onClick={() => { loadLogs(); loadStats(); loadHealth(); }}
            className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-200 transition hover:border-blue-500/60"
          >
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </button>
        </div>
      </div>

      {/* KPIs */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-blue-500/10 to-slate-900/60 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-400">Total de Logs</p>
                <p className="text-2xl font-bold text-white">{stats.total}</p>
              </div>
              <FileText className="h-8 w-8 text-blue-400" />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-red-500/10 to-slate-900/60 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-400">Erros</p>
                <p className="text-2xl font-bold text-white">{stats.byLevel.error || 0}</p>
                <p className="text-xs text-red-400">{stats.errorRate}% taxa</p>
              </div>
              <XCircle className="h-8 w-8 text-red-400" />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-yellow-500/10 to-slate-900/60 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-400">Avisos</p>
                <p className="text-2xl font-bold text-white">{stats.byLevel.warn || 0}</p>
                <p className="text-xs text-yellow-400">{stats.warnRate}% taxa</p>
              </div>
              <AlertTriangle className="h-8 w-8 text-yellow-400" />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-green-500/10 to-slate-900/60 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-400">Fontes Ativas</p>
                <p className="text-2xl font-bold text-white">{Object.keys(stats.bySource).length}</p>
              </div>
              <Server className="h-8 w-8 text-green-400" />
            </div>
          </div>
        </div>
      )}

      {/* Health Status */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Status dos Serviços
        </h3>
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

      {/* Toolbar */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
            >
              <Filter className="h-4 w-4" />
              Filtros
              {showFilters ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>

            <button
              onClick={() => setErrorOnly(!errorOnly)}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${
                errorOnly
                  ? 'border-red-500/60 bg-red-500/10 text-red-200'
                  : 'border-slate-800 bg-slate-950 text-slate-200 hover:bg-slate-800'
              }`}
            >
              <AlertCircle className="h-4 w-4" />
              Apenas Erros ({stats?.byLevel?.error || 0})
            </button>

            {errorLogs.length > 0 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => navigateToError('prev')}
                  className="rounded-lg border border-slate-800 bg-slate-950 p-2 text-slate-200 hover:bg-slate-800"
                  title="Erro anterior"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-xs text-slate-400 px-2">
                  {currentErrorIndex >= 0 ? currentErrorIndex + 1 : 0}/{errorLogs.length}
                </span>
                <button
                  onClick={() => navigateToError('next')}
                  className="rounded-lg border border-slate-800 bg-slate-950 p-2 text-slate-200 hover:bg-slate-800"
                  title="Próximo erro"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {selectedLogs.size > 0 && (
              <>
                <span className="text-sm text-slate-400">{selectedLogs.size} selecionados</span>
                <button
                  onClick={copySelectedLogs}
                  className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
                >
                  <Copy className="h-4 w-4" />
                  Copiar Selecionados
                </button>
              </>
            )}

            <button
              onClick={copyAllLogs}
              className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
            >
              <Copy className="h-4 w-4" />
              Copiar Todos
            </button>

            <div className="relative group">
              <button className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">
                <Download className="h-4 w-4" />
                Exportar
                <ChevronDown className="h-4 w-4" />
              </button>
              <div className="absolute right-0 top-full mt-2 hidden group-hover:block z-10">
                <div className="rounded-xl border border-slate-800 bg-slate-950 shadow-xl p-2 min-w-[150px]">
                  <button
                    onClick={() => exportLogs('json')}
                    className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 rounded-lg"
                  >
                    JSON
                  </button>
                  <button
                    onClick={() => exportLogs('csv')}
                    className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 rounded-lg"
                  >
                    CSV
                  </button>
                  <button
                    onClick={() => exportLogs('txt')}
                    className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 rounded-lg"
                  >
                    TXT
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        {showFilters && (
          <div className="grid gap-4 md:grid-cols-4 mb-4">
            <div>
              <label className="block text-sm text-slate-300 mb-2">Buscar</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filtrar logs..."
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-10 pr-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
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
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-10 pr-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-2">Nível</label>
              <select
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
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
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
              >
                <option value="all">Todas ({logs.length})</option>
                {sources.map((source) => (
                  <option key={source} value={source}>
                    {source} ({sourceCounts[source] || 0})
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {(searchText || dateFilter || levelFilter !== 'all' || sourceFilter !== 'all' || errorOnly) && (
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs text-slate-400">Filtros ativos:</span>
            <div className="flex flex-wrap gap-2">
              {searchText && (
                <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-xs text-blue-200">
                  Busca: "{searchText}"
                  <X className="h-3 w-3 cursor-pointer" onClick={() => setSearchText('')} />
                </span>
              )}
              {dateFilter && (
                <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-xs text-blue-200">
                  Data: {dateFilter}
                  <X className="h-3 w-3 cursor-pointer" onClick={() => setDateFilter('')} />
                </span>
              )}
              {levelFilter !== 'all' && (
                <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-xs text-blue-200">
                  Nível: {levelFilter}
                  <X className="h-3 w-3 cursor-pointer" onClick={() => setLevelFilter('all')} />
                </span>
              )}
              {sourceFilter !== 'all' && (
                <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-xs text-blue-200">
                  Fonte: {sourceFilter}
                  <X className="h-3 w-3 cursor-pointer" onClick={() => setSourceFilter('all')} />
                </span>
              )}
              {errorOnly && (
                <span className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-200">
                  Apenas erros
                  <X className="h-3 w-3 cursor-pointer" onClick={() => setErrorOnly(false)} />
                </span>
              )}
              <button
                onClick={clearFilters}
                className="text-xs text-slate-400 hover:text-slate-200 underline"
              >
                Limpar todos
              </button>
            </div>
          </div>
        )}

        {/* Source Pills */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            className={`rounded-full border px-3 py-1 text-xs transition ${
              sourceFilter === 'all'
                ? 'border-blue-500/60 bg-blue-500/10 text-blue-200'
                : 'border-slate-700 text-slate-300 hover:bg-slate-800'
            }`}
            onClick={() => setSourceFilter('all')}
          >
            Todas ({logs.length})
          </button>
          {sources.slice(0, 8).map((source) => (
            <button
              key={source}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                sourceFilter === source
                  ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-200'
                  : 'border-slate-700 text-slate-300 hover:bg-slate-800'
              }`}
              onClick={() => setSourceFilter(source)}
            >
              {source} ({sourceCounts[source] || 0})
            </button>
          ))}
          {sources.length > 8 && (
            <span className="text-xs text-slate-400">+{sources.length - 8} mais</span>
          )}
        </div>
      </div>

      {/* Logs Container */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Logs ({filteredLogs.length})
          </h3>
          <button
            onClick={selectAllLogs}
            className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200"
          >
            {selectedLogs.size === filteredLogs.length ? (
              <CheckSquare className="h-4 w-4" />
            ) : (
              <Square className="h-4 w-4" />
            )}
            Selecionar todos
          </button>
        </div>

        <div
          ref={logsContainerRef}
          className="h-[600px] overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/80 p-4"
        >
          {filteredLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 space-y-2">
              <FileText className="h-12 w-12 text-slate-600" />
              <p>Nenhum log encontrado</p>
              {(searchText || dateFilter || levelFilter !== 'all' || sourceFilter !== 'all') && (
                <button
                  onClick={clearFilters}
                  className="text-sm text-blue-400 hover:text-blue-300 underline"
                >
                  Limpar filtros
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredLogs.map((log, index) => {
                const isExpanded = expandedLog === index
                const isSelected = selectedLogs.has(index)
                const isHighlighted = errorLogs.find(e => e.index === index) && currentErrorIndex >= 0 && errorLogs[currentErrorIndex].index === index

                return (
                  <div
                    key={index}
                    id={`log-${index}`}
                    className={`group relative flex gap-2 py-2 px-3 rounded-lg transition-all ${
                      isHighlighted
                        ? 'bg-red-500/20 border-2 border-red-500/50'
                        : isSelected
                        ? 'bg-blue-500/10 border border-blue-500/30'
                        : 'hover:bg-slate-800/40 border border-transparent'
                    }`}
                  >
                    <div className="flex items-start gap-2 flex-1 min-w-0">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleLogSelection(index)}
                        className="mt-1 rounded border-slate-600 bg-slate-700 text-blue-500"
                      />

                      <div className="flex-1 min-w-0 font-mono text-sm">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className="text-slate-500 whitespace-nowrap text-xs flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatTimestamp(log.timestamp)}
                          </span>
                          <span className={`px-2 py-1 rounded-md text-xs font-semibold whitespace-nowrap border flex items-center gap-1 ${getLevelColor(log.level)}`}>
                            {getLevelIcon(log.level)}
                            {log.level.toUpperCase()}
                          </span>
                          {log.source && (
                            <span className="px-2 py-1 rounded-md text-xs font-semibold whitespace-nowrap bg-slate-700/60 text-slate-200 flex items-center gap-1">
                              <Server className="h-3 w-3" />
                              {log.source}
                            </span>
                          )}
                        </div>
                        <div className={`text-slate-200 ${isExpanded ? '' : 'truncate'}`}>
                          {log.message}
                        </div>
                        {log.metadata && Object.keys(log.metadata).length > 0 && isExpanded && (
                          <div className="mt-2 p-2 rounded bg-slate-900/60 border border-slate-800">
                            <p className="text-xs text-slate-400 mb-1">Metadados:</p>
                            <pre className="text-xs text-slate-300 overflow-x-auto">
                              {JSON.stringify(log.metadata, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-start gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => setExpandedLog(isExpanded ? null : index)}
                        className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-slate-200"
                        title={isExpanded ? "Recolher" : "Expandir"}
                      >
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                      </button>
                      <button
                        onClick={() => copyToClipboard(`[${formatTimestamp(log.timestamp)}] [${log.level.toUpperCase()}] [${log.source || 'unknown'}] ${log.message}`)}
                        className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-slate-200"
                        title="Copiar"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )
              })}
              <div ref={logsEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* Recent Errors */}
      {stats && stats.recentErrors && stats.recentErrors.length > 0 && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-red-400" />
            Erros Recentes
          </h3>
          <div className="space-y-2">
            {stats.recentErrors.map((error, index) => (
              <div key={index} className="rounded-lg border border-red-500/20 bg-red-500/10 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs text-red-400">{formatTimestamp(error.timestamp)}</span>
                      <span className="text-xs text-red-300 font-medium">{error.source}</span>
                    </div>
                    <p className="text-sm text-red-200 break-words">{error.message}</p>
                  </div>
                  <button
                    onClick={() => copyToClipboard(error.message)}
                    className="p-1 rounded hover:bg-red-500/20 text-red-400"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default LogsPanel
