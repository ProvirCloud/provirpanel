import { useEffect, useState } from 'react'
import { Server, Plus, Save, Trash2, Power, PowerOff, CheckCircle, XCircle, Copy, Zap, Shield, Box } from 'lucide-react'
import api from '../services/api.js'

const NginxPanel = () => {
  const [status, setStatus] = useState(null)
  const [configs, setConfigs] = useState([])
  const [templates, setTemplates] = useState({})
  const [dockerContainers, setDockerContainers] = useState([])
  const [certs, setCerts] = useState([])
  const [selectedConfig, setSelectedConfig] = useState(null)
  const [editContent, setEditContent] = useState('')
  const [originalContent, setOriginalContent] = useState('')
  const [showTemplates, setShowTemplates] = useState(false)
  const [showSSL, setShowSSL] = useState(false)
  const [sslForm, setSSLForm] = useState({ domain: '', email: '' })
  const [error, setError] = useState('')
  const [dockerError, setDockerError] = useState('')
  const [viewMode, setViewMode] = useState('guided')
  const [nginxTest, setNginxTest] = useState(null)
  const [builderType, setBuilderType] = useState('reverse-proxy')
  const [builder, setBuilder] = useState({
    filename: '',
    serverNames: '',
    listenPort: '80',
    targetHost: 'localhost',
    targetPort: '3000',
    targetPath: '/',
    upstreamName: 'app_backend',
    upstreams: [{ host: '127.0.0.1', port: '3000', weight: '1', backup: false }],
    websocket: true,
    forwardHeaders: true,
    clientBodySize: '50m',
    connectTimeout: '5s',
    readTimeout: '60s',
    sendTimeout: '60s',
    enableSsl: false,
    sslCertPath: '',
    sslKeyPath: ''
  })
  const [builderPreview, setBuilderPreview] = useState('')
  const [wizardStep, setWizardStep] = useState(1)
  const [visualForm, setVisualForm] = useState({
    serverNames: '',
    listenPort: '80',
    sslEnabled: false,
    sslCertPath: '',
    sslKeyPath: '',
    mode: 'proxy',
    proxyHost: 'localhost',
    proxyPort: '3000',
    rootPath: '/var/www/html',
    rules: [{ path: '/' }],
    targets: [{ host: '127.0.0.1', port: '3000', weight: '1' }]
  })

  const loadAll = async () => {
    try {
      const [statusRes, configsRes, templatesRes, dockerRes, certsRes] = await Promise.all([
        api.get('/nginx/status'),
        api.get('/nginx/configs'),
        api.get('/nginx/templates'),
        api.get('/nginx/docker-containers'),
        api.get('/nginx/ssl/certs')
      ])
      
      setStatus(statusRes.data)
      setConfigs(configsRes.data.configs || [])
      setTemplates(templatesRes.data.templates || {})
      setDockerContainers(dockerRes.data.containers || [])
      setDockerError(dockerRes.data.error || '')
      setCerts(certsRes.data.certs || [])
      setError('')
      try {
        const testRes = await api.post('/nginx/test')
        setNginxTest(testRes.data)
      } catch (testErr) {
        setNginxTest({ valid: false, error: testErr.response?.data?.error || testErr.message })
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    }
  }

  useEffect(() => {
    loadAll()
  }, [])

  const normalizedServerNames = () => {
    const value = builder.serverNames.trim()
    if (!value) return 'example.com'
    return value
      .split(/[,\s]+/)
      .map(name => name.trim())
      .filter(Boolean)
      .join(' ')
  }

  const buildProxyLocation = (proxyTarget) => {
    const headers = builder.forwardHeaders
      ? `
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;`
      : ''
    const websocket = builder.websocket
      ? `
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';`
      : ''
    return `
    location / {
        proxy_pass ${proxyTarget};
        proxy_http_version 1.1;${websocket}${headers}
        proxy_connect_timeout ${builder.connectTimeout};
        proxy_read_timeout ${builder.readTimeout};
        proxy_send_timeout ${builder.sendTimeout};
        client_max_body_size ${builder.clientBodySize};
    }`
  }

  const buildServerBlock = (proxyTarget) => {
    const names = normalizedServerNames()
    return `server {
    listen ${builder.listenPort};
    server_name ${names};
${buildProxyLocation(proxyTarget)}
}`
  }

  const buildSslBlocks = (proxyTarget) => {
    const names = normalizedServerNames()
    const cert = builder.sslCertPath || '/etc/letsencrypt/live/example.com/fullchain.pem'
    const key = builder.sslKeyPath || '/etc/letsencrypt/live/example.com/privkey.pem'
    return `server {
    listen 80;
    server_name ${names};
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${names};

    ssl_certificate ${cert};
    ssl_certificate_key ${key};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
${buildProxyLocation(proxyTarget)}
}`
  }

  const buildConfigPreview = () => {
    if (builderType === 'static-site') {
      const names = normalizedServerNames()
      return `server {
    listen ${builder.listenPort};
    server_name ${names};
    root ${builder.targetPath || '/var/www/html'};
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
}`
    }

    if (builderType === 'load-balancer') {
      const upstreamName = builder.upstreamName || 'app_backend'
      const upstreamServers = builder.upstreams.length
        ? builder.upstreams
            .map((upstream) => {
              const weight = upstream.weight && upstream.weight !== '1' ? ` weight=${upstream.weight}` : ''
              const backup = upstream.backup ? ' backup' : ''
              return `    server ${upstream.host}:${upstream.port}${weight}${backup};`
            })
            .join('\n')
        : '    server 127.0.0.1:3000;'
      const proxyTarget = `http://${upstreamName}`
      const upstreamBlock = `upstream ${upstreamName} {\n${upstreamServers}\n}`
      const serverBlock = builder.enableSsl ? buildSslBlocks(proxyTarget) : buildServerBlock(proxyTarget)
      return `${upstreamBlock}\n\n${serverBlock}`
    }

    const proxyTarget = `http://${builder.targetHost}:${builder.targetPort}${builder.targetPath || ''}`
    return builder.enableSsl ? buildSslBlocks(proxyTarget) : buildServerBlock(proxyTarget)
  }

  const refreshPreview = () => {
    setBuilderPreview(buildConfigPreview())
  }

  const applyPreviewToEditor = () => {
    const preview = buildConfigPreview()
    setBuilderPreview(preview)
    setEditContent(preview)
    if (!selectedConfig) {
      setSelectedConfig(null)
    }
  }

  const createConfigFromBuilder = async () => {
    const filename = builder.filename.trim()
    if (!filename) {
      alert('Informe o nome do arquivo (ex: meu-site.conf).')
      return
    }
    try {
      const content = buildConfigPreview()
      await api.post('/nginx/configs', {
        filename,
        content
      })
      setBuilderPreview(content)
      loadAll()
      alert('✅ Configuração criada! Selecione na lista para editar.')
    } catch (err) {
      alert('❌ Erro: ' + (err.response?.data?.error || err.message))
    }
  }

  const addUpstream = () => {
    setBuilder((prev) => ({
      ...prev,
      upstreams: [...prev.upstreams, { host: '127.0.0.1', port: '3000', weight: '1', backup: false }]
    }))
  }

  const updateUpstream = (index, field, value) => {
    setBuilder((prev) => ({
      ...prev,
      upstreams: prev.upstreams.map((item, i) =>
        i === index ? { ...item, [field]: value } : item
      )
    }))
  }

  const removeUpstream = (index) => {
    setBuilder((prev) => ({
      ...prev,
      upstreams: prev.upstreams.filter((_, i) => i !== index)
    }))
  }

  const resolveContainerHost = (container) => {
    if (!container) return 'localhost'
    if (!container.ip || container.ip === '0.0.0.0' || container.ip === '::') {
      return 'localhost'
    }
    return container.ip
  }

  const useContainerAsTarget = (container) => {
    if (!container?.port) return
    const host = resolveContainerHost(container)
    if (builderType === 'load-balancer') {
      setBuilder((prev) => ({
        ...prev,
        upstreams: [
          ...prev.upstreams,
          { host, port: String(container.port), weight: '1', backup: false }
        ]
      }))
      return
    }
    setBuilder((prev) => ({
      ...prev,
      targetHost: host,
      targetPort: String(container.port),
      targetPath: '/'
    }))
  }

  const saveConfig = async () => {
    if (!selectedConfig || !selectedConfig.editable || !selectedConfig.readable) return
    try {
      await api.put(`/nginx/configs/${selectedConfig.name}`, { content: editContent })
      alert('✅ Configuração salva.')
      setOriginalContent(editContent)
      loadAll()
    } catch (err) {
      alert('❌ Erro: ' + (err.response?.data?.error || err.message))
    }
  }

  const saveAndApply = async () => {
    if (!selectedConfig || !selectedConfig.editable || !selectedConfig.readable) return
    try {
      let contentToSave = editContent
      if (viewMode === 'guided') {
        contentToSave = generateVisualConfig()
        setEditContent(contentToSave)
      }
      await api.put(`/nginx/configs/${selectedConfig.name}`, { content: contentToSave })
      const testRes = await api.post('/nginx/test')
      setNginxTest(testRes.data)
      if (!testRes.data?.valid) {
        alert('❌ Configuração inválida. Veja o alerta acima.')
        return
      }
      await api.post('/nginx/reload')
      alert('✅ Configuração salva e aplicada!')
      setOriginalContent(editContent)
      loadAll()
    } catch (err) {
      alert('❌ Erro: ' + (err.response?.data?.error || err.message))
    }
  }

  const revertConfig = () => {
    if (!selectedConfig) return
    setEditContent(originalContent)
  }

  const parseNginxConfig = (content) => {
    const upstreams = []
    const servers = []
    const upstreamRegex = /upstream\s+([^\s{]+)\s*\{([\s\S]*?)\}/g
    let match
    while ((match = upstreamRegex.exec(content))) {
      const name = match[1]
      const block = match[2]
      const serverMatches = []
      const serverRegex = /server\s+([^;]+);/g
      let srv
      while ((srv = serverRegex.exec(block))) {
        serverMatches.push(srv[1].trim())
      }
      upstreams.push({ name, servers: serverMatches })
    }

    const serverRegex = /server\s*\{([\s\S]*?)\}/g
    let serverMatch
    while ((serverMatch = serverRegex.exec(content))) {
      const block = serverMatch[1]
      const listenMatch = block.match(/listen\s+([^;]+);/)
      const nameMatch = block.match(/server_name\s+([^;]+);/)
      const rootMatch = block.match(/root\s+([^;]+);/)
      const locations = []
      const locationRegex = /location\s+([^\s{]+)\s*\{([\s\S]*?)\}/g
      let loc
      while ((loc = locationRegex.exec(block))) {
        const locBlock = loc[2]
        const proxyMatch = locBlock.match(/proxy_pass\s+([^;]+);/)
        locations.push({
          path: loc[1],
          proxy: proxyMatch ? proxyMatch[1] : null
        })
      }
      servers.push({
        listen: listenMatch ? listenMatch[1] : null,
        serverName: nameMatch ? nameMatch[1] : null,
        root: rootMatch ? rootMatch[1] : null,
        locations
      })
    }

    return { upstreams, servers }
  }

  const visualConfig = selectedConfig ? parseNginxConfig(selectedConfig.content || '') : null

  const extractVisualForm = (content) => {
    const parsed = parseNginxConfig(content || '')
    const server = parsed.servers[0] || {}
    const serverName = server.serverName || ''
    const listenValue = server.listen ? String(server.listen) : '80'
    const sslEnabled = /ssl/.test(listenValue)
    const listenPort = listenValue.replace(/ssl/g, '').trim() || '80'
    const certMatch = content.match(/ssl_certificate\s+([^;]+);/)
    const keyMatch = content.match(/ssl_certificate_key\s+([^;]+);/)
    const proxyLocation = (server.locations || []).find((loc) => loc.proxy)
    const proxyTarget = proxyLocation?.proxy || ''
    const hasUpstream = parsed.upstreams.length > 0
    const mode = server.root ? 'static' : hasUpstream ? 'balancer' : 'proxy'
    let proxyHost = 'localhost'
    let proxyPort = '3000'
    if (proxyTarget.startsWith('http')) {
      const clean = proxyTarget.replace(/^https?:\/\//, '')
      const [hostPort] = clean.split(/\/(.+)?/)
      const [host, port] = hostPort.split(':')
      proxyHost = host || proxyHost
      proxyPort = port || proxyPort
    }
    const rules = (server.locations || []).map((loc) => ({ path: loc.path }))
    const upstreamTargets = parsed.upstreams[0]?.servers || []
    const targets = upstreamTargets.length
      ? upstreamTargets.map((entry) => {
          const parts = entry.split(/\s+/)
          const hostPort = parts[0] || ''
          const [host, port] = hostPort.split(':')
          const weight = parts.find((p) => p.startsWith('weight='))?.split('=')[1] || '1'
          return { host: host || '127.0.0.1', port: port || '3000', weight }
        })
      : [{ host: proxyHost, port: proxyPort, weight: '1' }]
    return {
      serverNames: serverName,
      listenPort,
      sslEnabled,
      sslCertPath: certMatch ? certMatch[1] : '',
      sslKeyPath: keyMatch ? keyMatch[1] : '',
      mode,
      proxyHost,
      proxyPort,
      rootPath: server.root || '/var/www/html',
      rules: rules.length ? rules : [{ path: '/' }],
      targets
    }
  }

  const syncVisualForm = (config) => {
    if (!config) return
    setVisualForm(extractVisualForm(config.content || ''))
  }

  const addVisualRule = () => {
    setVisualForm((prev) => ({
      ...prev,
      rules: [...prev.rules, { path: '/nova-regra' }]
    }))
  }

  const updateVisualRule = (index, value) => {
    setVisualForm((prev) => ({
      ...prev,
      rules: prev.rules.map((rule, idx) => (idx === index ? { ...rule, path: value } : rule))
    }))
  }

  const removeVisualRule = (index) => {
    setVisualForm((prev) => ({
      ...prev,
      rules: prev.rules.filter((_, idx) => idx !== index)
    }))
  }

  const addVisualTarget = () => {
    setVisualForm((prev) => ({
      ...prev,
      targets: [...prev.targets, { host: '127.0.0.1', port: '3000', weight: '1' }]
    }))
  }

  const updateVisualTarget = (index, field, value) => {
    setVisualForm((prev) => ({
      ...prev,
      targets: prev.targets.map((target, idx) =>
        idx === index ? { ...target, [field]: value } : target
      )
    }))
  }

  const removeVisualTarget = (index) => {
    setVisualForm((prev) => ({
      ...prev,
      targets: prev.targets.filter((_, idx) => idx !== index)
    }))
  }

  const generateVisualConfig = () => {
    const names = visualForm.serverNames.trim() || 'example.com'
    const listenPort = visualForm.listenPort || '80'
    const rules = visualForm.rules.length ? visualForm.rules : [{ path: '/' }]
    const proxyTarget = `http://${visualForm.proxyHost}:${visualForm.proxyPort}`
    const upstreamName = 'lb_targets'
    const targetLines = visualForm.targets
      .map((target) => {
        const weight = target.weight && target.weight !== '1' ? ` weight=${target.weight}` : ''
        return `    server ${target.host}:${target.port}${weight};`
      })
      .join('\n')
    const upstreamBlock =
      visualForm.mode === 'balancer'
        ? `upstream ${upstreamName} {\n${targetLines || '    server 127.0.0.1:3000;'}\n}\n\n`
        : ''
    const buildLocations = (target) =>
      rules
        .map(
          (rule) => `    location ${rule.path} {
        proxy_pass ${target};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }`
        )
        .join('\n')
    if (visualForm.sslEnabled) {
      const cert = visualForm.sslCertPath || '/etc/letsencrypt/live/example.com/fullchain.pem'
      const key = visualForm.sslKeyPath || '/etc/letsencrypt/live/example.com/privkey.pem'
      return `${upstreamBlock}server {
    listen 80;
    server_name ${names};
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${names};

    ssl_certificate ${cert};
    ssl_certificate_key ${key};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    ${visualForm.mode === 'static'
      ? `root ${visualForm.rootPath};
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }`
      : buildLocations(visualForm.mode === 'balancer' ? `http://${upstreamName}` : proxyTarget)}
}`
    }

    return `${upstreamBlock}server {
    listen ${listenPort};
    server_name ${names};

    ${visualForm.mode === 'static'
      ? `root ${visualForm.rootPath};
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }`
      : buildLocations(visualForm.mode === 'balancer' ? `http://${upstreamName}` : proxyTarget)}
}`
  }

  const applyVisualToEditor = () => {
    const content = generateVisualConfig()
    setEditContent(content)
    setBuilderPreview(content)
  }

  const populateBuilderFromConfig = () => {
    if (!selectedConfig || !visualConfig) return
    const firstServer = visualConfig.servers[0] || {}
    const names = firstServer.serverName || ''
    const listen = firstServer.listen ? String(firstServer.listen).replace(/ssl/g, '').trim() : '80'
    const proxyLocation = (firstServer.locations || []).find((loc) => loc.proxy)
    const proxyTarget = proxyLocation?.proxy || ''
    const hasUpstream = visualConfig.upstreams.length > 0

    if (hasUpstream) {
      const upstream = visualConfig.upstreams[0]
      const parsedUpstreams = upstream.servers.map((entry) => {
        const parts = entry.split(/\s+/)
        const hostPort = parts[0] || ''
        const [host, port] = hostPort.split(':')
        const weight = parts.find((p) => p.startsWith('weight='))?.split('=')[1] || '1'
        const backup = parts.includes('backup')
        return {
          host: host || '127.0.0.1',
          port: port || '3000',
          weight,
          backup
        }
      })
      setBuilderType('load-balancer')
      setBuilder((prev) => ({
        ...prev,
        serverNames: names,
        listenPort: listen || '80',
        upstreamName: upstream.name,
        upstreams: parsedUpstreams.length ? parsedUpstreams : prev.upstreams
      }))
      return
    }

    if (proxyTarget.startsWith('http')) {
      const clean = proxyTarget.replace(/^https?:\/\//, '')
      const [hostPort, path = '/'] = clean.split(/\/(.+)?/)
      const [host, port] = hostPort.split(':')
      setBuilderType('reverse-proxy')
      setBuilder((prev) => ({
        ...prev,
        serverNames: names,
        listenPort: listen || '80',
        targetHost: host || prev.targetHost,
        targetPort: port || prev.targetPort,
        targetPath: path ? `/${path}` : '/'
      }))
      return
    }

    if (firstServer.root) {
      setBuilderType('static-site')
      setBuilder((prev) => ({
        ...prev,
        serverNames: names,
        listenPort: listen || '80',
        targetPath: firstServer.root
      }))
    }
  }

  const createFromTemplate = async (templateName) => {
    const filename = prompt('Nome do arquivo (ex: meusite.conf):')
    if (!filename) return
    
    try {
      await api.post('/nginx/configs', {
        filename,
        content: templates[templateName]
      })
      alert('✅ Configuração criada!')
      setShowTemplates(false)
      loadAll()
    } catch (err) {
      alert('❌ Erro: ' + err.message)
    }
  }

  const toggleConfig = async (config) => {
    try {
      if (config.enabled) {
        await api.post(`/nginx/configs/${config.name}/disable`)
      } else {
        await api.post(`/nginx/configs/${config.name}/enable`)
      }
      loadAll()
    } catch (err) {
      alert('❌ Erro ao alterar status')
    }
  }

  const deleteConfig = async (config) => {
    if (!confirm(`Deletar ${config.name}?`)) return
    try {
      await api.delete(`/nginx/configs/${config.name}`)
      loadAll()
      setSelectedConfig(null)
    } catch (err) {
      alert('❌ Erro ao deletar')
    }
  }

  const installSSL = async () => {
    try {
      await api.post('/nginx/ssl/install', sslForm)
      alert('✅ SSL instalado! Atualize sua configuração para usar HTTPS.')
      setShowSSL(false)
      loadAll()
    } catch (err) {
      alert('❌ Erro: ' + err.message)
    }
  }

  const insertDockerProxy = (container) => {
    const proxyConfig = `
    location / {
        proxy_pass http://${container.ip}:${container.port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }`
    
    setEditContent(prev => prev + proxyConfig)
  }

  return (
    <div className="h-full w-full max-w-full flex flex-col space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-white flex items-center gap-2">
            <Server className="h-6 w-6" />
            Nginx Manager
          </h2>
          <p className="text-sm text-slate-400 mt-1">Editor visual de configurações com templates prontos</p>
        </div>
        <div className="flex gap-2 items-center">
          {status?.running ? (
            <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 px-4 py-2 text-emerald-300">
              <CheckCircle className="h-4 w-4" />
              Online
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-xl bg-rose-500/10 px-4 py-2 text-rose-300">
              <XCircle className="h-4 w-4" />
              Offline
            </div>
          )}
          <button
            onClick={loadAll}
            className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-300 hover:bg-slate-700"
          >
            Atualizar status
          </button>
        </div>
      </div>

      {nginxTest && !nginxTest.valid && (
        <div className="rounded-xl border border-rose-900 bg-rose-950/70 px-4 py-3 text-sm text-rose-200">
          ⚠️ Configuração inválida no Nginx: {nginxTest.error || 'Verifique os arquivos'}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-900 bg-rose-950/70 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-0">
        {/* Sidebar - Lista de Configs */}
        <div className="lg:col-span-3 flex flex-col gap-3 overflow-y-auto min-w-0">
          <div className="flex gap-2">
            <button
              onClick={() => setShowTemplates(true)}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-blue-500 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-600"
            >
              <Plus className="h-4 w-4" />
              Novo
            </button>
            <button
              onClick={() => setShowSSL(true)}
              className="flex items-center gap-2 rounded-xl border border-emerald-800 bg-emerald-950 px-3 py-2 text-sm text-emerald-200 hover:bg-emerald-900"
            >
              <Shield className="h-4 w-4" />
              SSL
            </button>
          </div>

          {configs.map((config) => (
            <div
              key={config.name}
              onClick={() => {
                setSelectedConfig(config)
                setEditContent(config.content)
                setOriginalContent(config.content)
                syncVisualForm(config)
              }}
              className={`rounded-xl border p-3 cursor-pointer transition ${
                selectedConfig?.name === config.name
                  ? 'border-blue-500 bg-blue-500/10'
                  : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-white truncate">{config.name}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleConfig(config)
                  }}
                  className={`flex-shrink-0 ${config.toggleable ? '' : 'opacity-40 cursor-not-allowed'}`}
                  disabled={!config.toggleable}
                >
                  {config.enabled ? (
                    <Power className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <PowerOff className="h-4 w-4 text-slate-500" />
                  )}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  config.enabled 
                    ? 'bg-emerald-500/10 text-emerald-300' 
                    : 'bg-slate-500/10 text-slate-400'
                }`}>
                  {config.enabled ? 'Ativo' : 'Inativo'}
                </span>
                <span className="text-xs text-slate-500">{config.type}</span>
                {!config.readable && (
                  <span className="text-xs text-rose-300">sem acesso</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Editor */}
        <div className="lg:col-span-6 flex flex-col gap-3 min-h-0 min-w-0">
          <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-white">Modo de edição</h3>
              <p className="text-xs text-slate-400">Escolha visual ou avançado.</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setViewMode('guided')}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  viewMode === 'guided'
                    ? 'bg-blue-500 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                Visual
              </button>
              <button
                onClick={() => setViewMode('advanced')}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  viewMode === 'advanced'
                    ? 'bg-blue-500 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                Avançado
              </button>
            </div>
          </div>

          {viewMode === 'guided' && selectedConfig && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h4 className="text-sm font-semibold text-white">Visual do Nginx</h4>
                  <p className="text-xs text-slate-400">Diagrama simplificado + formulário.</p>
                </div>
                <button
                  onClick={() => syncVisualForm(selectedConfig)}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1 text-xs text-slate-200"
                >
                  Recarregar do arquivo
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                <div className="rounded-xl border border-blue-900 bg-blue-950/60 p-3 text-xs text-blue-200">
                  <div className="text-xs uppercase text-blue-300">Domínio</div>
                  <div className="mt-1 text-sm text-white">{visualForm.serverNames || '(não definido)'}</div>
                  <div className="mt-1 text-[11px] text-blue-300">Porta {visualForm.listenPort}</div>
                </div>
                <div className="rounded-xl border border-emerald-900 bg-emerald-950/60 p-3 text-xs text-emerald-200">
                  <div className="text-xs uppercase text-emerald-300">
                    {visualForm.mode === 'static' ? 'Site estático' : visualForm.mode === 'balancer' ? 'Load balancer' : 'Proxy'}
                  </div>
                  {visualForm.mode === 'static' ? (
                    <div className="mt-1 text-sm text-white">{visualForm.rootPath}</div>
                  ) : visualForm.mode === 'balancer' ? (
                    <div className="mt-1 text-sm text-white">{visualForm.targets.length} destinos</div>
                  ) : (
                    <div className="mt-1 text-sm text-white">
                      {visualForm.proxyHost}:{visualForm.proxyPort}
                    </div>
                  )}
                  {visualForm.mode === 'proxy' && (
                    <div className="mt-1 text-[11px] text-emerald-300">Regras: {visualForm.rules.length}</div>
                  )}
                </div>
                <div className="rounded-xl border border-violet-900 bg-violet-950/60 p-3 text-xs text-violet-200">
                  <div className="text-xs uppercase text-violet-300">SSL</div>
                  <div className="mt-1 text-sm text-white">{visualForm.sslEnabled ? 'Ativo' : 'Desativado'}</div>
                  {visualForm.sslEnabled && (
                    <div className="mt-1 text-[11px] text-violet-300">Certificado definido</div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-xs text-slate-400">Domínios</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    value={visualForm.serverNames}
                    onChange={(e) => setVisualForm({ ...visualForm, serverNames: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400">Porta</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    value={visualForm.listenPort}
                    onChange={(e) => setVisualForm({ ...visualForm, listenPort: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400">Tipo</label>
                  <select
                    className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    value={visualForm.mode}
                    onChange={(e) => setVisualForm({ ...visualForm, mode: e.target.value })}
                  >
                    <option value="proxy">Proxy reverso</option>
                    <option value="balancer">Load balancer</option>
                    <option value="static">Site estático</option>
                  </select>
                </div>
                {visualForm.mode === 'proxy' ? (
                  <>
                    <div>
                      <label className="text-xs text-slate-400">Destino (host)</label>
                      <input
                        className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                        value={visualForm.proxyHost}
                        onChange={(e) => setVisualForm({ ...visualForm, proxyHost: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400">Destino (porta)</label>
                      <input
                        className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                        value={visualForm.proxyPort}
                        onChange={(e) => setVisualForm({ ...visualForm, proxyPort: e.target.value })}
                      />
                    </div>
                  </>
                ) : visualForm.mode === 'balancer' ? (
                  <div className="col-span-2 rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <h4 className="text-sm font-semibold text-white">Targets</h4>
                        <p className="text-xs text-slate-400">Destinos que recebem o tráfego.</p>
                      </div>
                      <button
                        onClick={addVisualTarget}
                        className="rounded-lg bg-blue-500 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-600"
                      >
                        Adicionar
                      </button>
                    </div>
                    <div className="space-y-2">
                      {visualForm.targets.map((target, index) => (
                        <div key={`${target.host}-${index}`} className="grid grid-cols-6 gap-2">
                          <input
                            className="col-span-2 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
                            value={target.host}
                            onChange={(e) => updateVisualTarget(index, 'host', e.target.value)}
                          />
                          <input
                            className="col-span-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
                            value={target.port}
                            onChange={(e) => updateVisualTarget(index, 'port', e.target.value)}
                          />
                          <input
                            className="col-span-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
                            value={target.weight}
                            onChange={(e) => updateVisualTarget(index, 'weight', e.target.value)}
                          />
                          <div className="col-span-2 flex items-center justify-end">
                            <button
                              onClick={() => removeVisualTarget(index)}
                              className="rounded-lg border border-rose-800 px-2 py-1 text-xs text-rose-200 hover:bg-rose-900"
                            >
                              Remover
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="col-span-2">
                    <label className="text-xs text-slate-400">Pasta do site</label>
                    <input
                      className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                      value={visualForm.rootPath}
                      onChange={(e) => setVisualForm({ ...visualForm, rootPath: e.target.value })}
                    />
                  </div>
                )}
              </div>

              {visualForm.mode !== 'static' && (
                <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <h4 className="text-sm font-semibold text-white">Regras (paths)</h4>
                      <p className="text-xs text-slate-400">Similar ao AWS: cada regra aponta para o destino.</p>
                    </div>
                    <button
                      onClick={addVisualRule}
                      className="rounded-lg bg-blue-500 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-600"
                    >
                      Adicionar
                    </button>
                  </div>
                  <div className="space-y-2">
                    {visualForm.rules.map((rule, index) => (
                      <div key={`${rule.path}-${index}`} className="grid grid-cols-6 gap-2 items-center">
                        <input
                          className="col-span-4 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
                          value={rule.path}
                          onChange={(e) => updateVisualRule(index, e.target.value)}
                        />
                        <div className="col-span-2 flex justify-end">
                          <button
                            onClick={() => removeVisualRule(index)}
                            className="rounded-lg border border-rose-800 px-2 py-1 text-xs text-rose-200 hover:bg-rose-900"
                          >
                            Remover
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={visualForm.sslEnabled}
                    onChange={(e) => setVisualForm({ ...visualForm, sslEnabled: e.target.checked })}
                  />
                  Ativar SSL (certificado já instalado)
                </label>
                {visualForm.sslEnabled && (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <input
                      className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
                      placeholder="/etc/letsencrypt/live/example.com/fullchain.pem"
                      value={visualForm.sslCertPath}
                      onChange={(e) => setVisualForm({ ...visualForm, sslCertPath: e.target.value })}
                    />
                    <input
                      className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
                      placeholder="/etc/letsencrypt/live/example.com/privkey.pem"
                      value={visualForm.sslKeyPath}
                      onChange={(e) => setVisualForm({ ...visualForm, sslKeyPath: e.target.value })}
                    />
                  </div>
                )}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={applyVisualToEditor}
                  className="rounded-xl bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600"
                >
                  Enviar para editor
                </button>
                <button
                  onClick={saveAndApply}
                  className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600"
                >
                  Salvar & Aplicar
                </button>
              </div>
            </div>
          )}

          {viewMode === 'guided' && !selectedConfig && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-lg font-semibold text-white">Wizard em 3 passos</h3>
                  <p className="text-xs text-slate-400">Domínio → Destino → SSL</p>
                </div>
                <div className="flex gap-2">
                  {['reverse-proxy', 'load-balancer', 'static-site'].map((type) => (
                    <button
                      key={type}
                      onClick={() => setBuilderType(type)}
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        builderType === type
                          ? 'bg-blue-500 text-white'
                          : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {type === 'reverse-proxy' ? 'Proxy' : type === 'load-balancer' ? 'Load balancer' : 'Site estático'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-slate-400 mb-4">
                <div className={`rounded-full px-3 py-1 ${wizardStep === 1 ? 'bg-blue-500 text-white' : 'bg-slate-800'}`}>1. Domínio</div>
                <div className={`rounded-full px-3 py-1 ${wizardStep === 2 ? 'bg-blue-500 text-white' : 'bg-slate-800'}`}>2. Destino</div>
                <div className={`rounded-full px-3 py-1 ${wizardStep === 3 ? 'bg-blue-500 text-white' : 'bg-slate-800'}`}>3. SSL</div>
              </div>

              {wizardStep === 1 && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="text-xs text-slate-400">Nome do arquivo</label>
                    <input
                      className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                      placeholder="meu-site.conf"
                      value={builder.filename}
                      onChange={(e) => setBuilder({ ...builder, filename: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400">Domínio(s)</label>
                    <input
                      className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                      placeholder="example.com www.example.com"
                      value={builder.serverNames}
                      onChange={(e) => setBuilder({ ...builder, serverNames: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400">Porta</label>
                    <input
                      className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                      value={builder.listenPort}
                      onChange={(e) => setBuilder({ ...builder, listenPort: e.target.value })}
                    />
                  </div>
                </div>
              )}

              {wizardStep === 2 && (
                <div className="grid grid-cols-2 gap-3">
                  {builderType === 'reverse-proxy' && (
                    <>
                      <div>
                        <label className="text-xs text-slate-400">Destino (host)</label>
                        <input
                          className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                          value={builder.targetHost}
                          onChange={(e) => setBuilder({ ...builder, targetHost: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400">Destino (porta)</label>
                        <input
                          className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                          value={builder.targetPort}
                          onChange={(e) => setBuilder({ ...builder, targetPort: e.target.value })}
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="text-xs text-slate-400">Caminho no destino</label>
                        <input
                          className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                          value={builder.targetPath}
                          onChange={(e) => setBuilder({ ...builder, targetPath: e.target.value })}
                        />
                      </div>
                    </>
                  )}

                  {builderType === 'static-site' && (
                    <div className="col-span-2">
                      <label className="text-xs text-slate-400">Pasta do site</label>
                      <input
                        className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                        value={builder.targetPath}
                        onChange={(e) => setBuilder({ ...builder, targetPath: e.target.value })}
                      />
                    </div>
                  )}

                  {builderType === 'load-balancer' && (
                    <div className="col-span-2 rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <h4 className="text-sm font-semibold text-white">Backends</h4>
                          <p className="text-xs text-slate-400">Adicione destinos e pesos (weight).</p>
                        </div>
                        <button
                          onClick={addUpstream}
                          className="rounded-lg bg-blue-500 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-600"
                        >
                          Adicionar
                        </button>
                      </div>
                      <div className="space-y-2">
                        {builder.upstreams.map((upstream, index) => (
                          <div key={`${upstream.host}-${index}`} className="grid grid-cols-6 gap-2">
                            <input
                              className="col-span-2 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
                              value={upstream.host}
                              onChange={(e) => updateUpstream(index, 'host', e.target.value)}
                            />
                            <input
                              className="col-span-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
                              value={upstream.port}
                              onChange={(e) => updateUpstream(index, 'port', e.target.value)}
                            />
                            <input
                              className="col-span-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
                              value={upstream.weight}
                              onChange={(e) => updateUpstream(index, 'weight', e.target.value)}
                            />
                            <label className="col-span-1 flex items-center gap-2 text-xs text-slate-300">
                              <input
                                type="checkbox"
                                checked={upstream.backup}
                                onChange={(e) => updateUpstream(index, 'backup', e.target.checked)}
                              />
                              Backup
                            </label>
                            <button
                              onClick={() => removeUpstream(index)}
                              className="col-span-1 rounded-lg border border-rose-800 text-xs text-rose-200 hover:bg-rose-900"
                            >
                              Remover
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3">
                        <label className="text-xs text-slate-400">Nome do upstream</label>
                        <input
                          className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
                          value={builder.upstreamName}
                          onChange={(e) => setBuilder({ ...builder, upstreamName: e.target.value })}
                        />
                      </div>
                    </div>
                  )}

                  <div className="col-span-2 grid grid-cols-2 gap-3 mt-2">
                    <label className="flex items-center gap-2 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={builder.websocket}
                        onChange={(e) => setBuilder({ ...builder, websocket: e.target.checked })}
                      />
                      WebSocket / Upgrade
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={builder.forwardHeaders}
                        onChange={(e) => setBuilder({ ...builder, forwardHeaders: e.target.checked })}
                      />
                      Headers de proxy
                    </label>
                    <div>
                      <label className="text-xs text-slate-400">Upload máximo</label>
                      <input
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
                        value={builder.clientBodySize}
                        onChange={(e) => setBuilder({ ...builder, clientBodySize: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400">Timeout leitura</label>
                      <input
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
                        value={builder.readTimeout}
                        onChange={(e) => setBuilder({ ...builder, readTimeout: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400">Timeout conexão</label>
                      <input
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
                        value={builder.connectTimeout}
                        onChange={(e) => setBuilder({ ...builder, connectTimeout: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400">Timeout envio</label>
                      <input
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
                        value={builder.sendTimeout}
                        onChange={(e) => setBuilder({ ...builder, sendTimeout: e.target.value })}
                      />
                    </div>
                  </div>
                </div>
              )}

              {wizardStep === 3 && (
                <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={builder.enableSsl}
                      onChange={(e) => setBuilder({ ...builder, enableSsl: e.target.checked })}
                    />
                    Usar HTTPS (certificado já instalado)
                  </label>
                  {builder.enableSsl && (
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <input
                        className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
                        placeholder="/etc/letsencrypt/live/example.com/fullchain.pem"
                        value={builder.sslCertPath}
                        onChange={(e) => setBuilder({ ...builder, sslCertPath: e.target.value })}
                      />
                      <input
                        className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
                        placeholder="/etc/letsencrypt/live/example.com/privkey.pem"
                        value={builder.sslKeyPath}
                        onChange={(e) => setBuilder({ ...builder, sslKeyPath: e.target.value })}
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={() => setWizardStep((prev) => Math.max(1, prev - 1))}
                  className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-200"
                  disabled={wizardStep === 1}
                >
                  Voltar
                </button>
                <button
                  onClick={() => setWizardStep((prev) => Math.min(3, prev + 1))}
                  className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-200"
                  disabled={wizardStep === 3}
                >
                  Próximo
                </button>
                <button
                  onClick={refreshPreview}
                  className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-200"
                >
                  Gerar preview
                </button>
                <button
                  onClick={applyPreviewToEditor}
                  className="rounded-xl bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600"
                >
                  Enviar para editor
                </button>
                <button
                  onClick={createConfigFromBuilder}
                  className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600"
                >
                  Criar arquivo
                </button>
              </div>

            {builderPreview && (
              <pre className="mt-4 max-h-48 overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300">
                {builderPreview}
              </pre>
            )}
          </div>
          )}

          {viewMode === 'advanced' && selectedConfig ? (
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">{selectedConfig.name}</h3>
                <div className="flex gap-2">
                  <button
                    onClick={saveConfig}
                    className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white ${
                      selectedConfig.editable && selectedConfig.readable
                        ? 'bg-emerald-500 hover:bg-emerald-600'
                        : 'bg-slate-700 cursor-not-allowed'
                    }`}
                    disabled={!selectedConfig.editable || !selectedConfig.readable}
                  >
                    <Save className="h-4 w-4" />
                    Salvar
                  </button>
                  <button
                    onClick={saveAndApply}
                    className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white ${
                      selectedConfig.editable && selectedConfig.readable
                        ? 'bg-blue-500 hover:bg-blue-600'
                        : 'bg-slate-700 cursor-not-allowed'
                    }`}
                    disabled={!selectedConfig.editable || !selectedConfig.readable}
                  >
                    <CheckCircle className="h-4 w-4" />
                    Salvar & Aplicar
                  </button>
                  <button
                    onClick={revertConfig}
                    className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700"
                  >
                    Reverter
                  </button>
                  <button
                    onClick={() => deleteConfig(selectedConfig)}
                    className={`flex items-center gap-2 rounded-xl border border-rose-800 px-4 py-2 text-sm ${
                      selectedConfig.deletable
                        ? 'bg-rose-950 text-rose-200 hover:bg-rose-900'
                        : 'bg-slate-800 text-slate-400 cursor-not-allowed'
                    }`}
                    disabled={!selectedConfig.deletable}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="flex-1 rounded-xl border border-slate-800 bg-slate-950 p-4 text-sm text-white font-mono resize-none focus:border-blue-500 focus:outline-none"
                spellCheck={false}
                readOnly={!selectedConfig.readable}
              />
              
              {selectedConfig.error && (
                <div className="text-xs text-rose-200 bg-rose-950/70 rounded-xl p-3">
                  {selectedConfig.error}
                </div>
              )}

              <div className="text-xs text-slate-400 bg-slate-900/60 rounded-xl p-3">
                💡 <strong>Dica:</strong> Use os containers Docker à direita para inserir proxy automaticamente
              </div>
            </>
          ) : viewMode === 'advanced' ? (
            <div className="flex-1 flex items-center justify-center text-slate-500">
              <div className="text-center">
                <Server className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>Selecione uma configuração para editar</p>
                <p className="text-sm mt-2">ou crie uma nova usando templates</p>
              </div>
            </div>
          ) : null}
        </div>

        {/* Sidebar Direita - Docker & SSL */}
        <div className="lg:col-span-3 flex flex-col gap-3 overflow-y-auto min-w-0">
          {/* Docker Containers */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Box className="h-4 w-4" />
              Containers Docker
            </h4>
            {dockerError && (
              <div className="mb-3 rounded-lg border border-rose-900 bg-rose-950/70 px-3 py-2 text-xs text-rose-200">
                {dockerError}
              </div>
            )}
            <div className="space-y-2">
              {dockerContainers.map((container) => (
                <div
                  key={container.id}
                  className="rounded-lg border border-slate-800 bg-slate-950 p-3"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{container.name}</p>
                      <p className="text-xs text-slate-400 truncate">{container.image}</p>
                    </div>
                    <button
                      onClick={() => insertDockerProxy(container)}
                      className="flex-shrink-0 ml-2 rounded-lg border border-blue-800 bg-blue-950 px-2 py-1 text-xs text-blue-200 hover:bg-blue-900"
                      title="Inserir proxy no editor"
                    >
                      <Zap className="h-3 w-3" />
                    </button>
                  </div>
                  {container.port && (
                    <p className="text-xs text-emerald-400">
                      {container.ip}:{container.port}
                    </p>
                  )}
                  {container.port && (
                    <button
                      onClick={() => useContainerAsTarget(container)}
                      className="mt-2 w-full rounded-lg border border-blue-800 bg-blue-950 px-2 py-1 text-xs text-blue-200 hover:bg-blue-900"
                    >
                      Usar como destino
                    </button>
                  )}
                </div>
              ))}
              {dockerContainers.length === 0 && (
                <p className="text-xs text-slate-500 text-center py-4">
                  Nenhum container rodando
                </p>
              )}
            </div>
          </div>

          {/* SSL Certificates */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Certificados SSL
            </h4>
            <div className="space-y-2">
              {certs.map((cert) => (
                <div
                  key={cert.domain}
                  className="rounded-lg border border-slate-800 bg-slate-950 p-3"
                >
                  <p className="text-sm font-semibold text-white">{cert.domain}</p>
                  <p className="text-xs text-slate-400 mt-1">
                    Expira em {cert.daysLeft} dias
                  </p>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(cert.certPath)
                      alert('Caminho copiado!')
                    }}
                    className="mt-2 text-xs text-blue-300 hover:underline flex items-center gap-1"
                  >
                    <Copy className="h-3 w-3" />
                    Copiar caminho
                  </button>
                </div>
              ))}
              {certs.length === 0 && (
                <p className="text-xs text-slate-500 text-center py-4">
                  Nenhum certificado
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Modal: Templates */}
      {showTemplates && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-semibold text-white mb-4">Escolha um Template</h3>
            
            <div className="grid grid-cols-2 gap-4">
              {Object.entries(templates).map(([name, content]) => (
                <div
                  key={name}
                  className="rounded-xl border border-slate-800 bg-slate-950 p-4 hover:border-blue-500 transition cursor-pointer"
                  onClick={() => createFromTemplate(name)}
                >
                  <h4 className="text-lg font-semibold text-white mb-2 capitalize">
                    {name.replace(/-/g, ' ')}
                  </h4>
                  <pre className="text-xs text-slate-400 overflow-hidden max-h-32">
                    {content.slice(0, 200)}...
                  </pre>
                  <button className="mt-3 w-full rounded-lg bg-blue-500 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-600">
                    Usar Template
                  </button>
                </div>
              ))}
            </div>

            <button
              onClick={() => setShowTemplates(false)}
              className="mt-6 w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-300"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Modal: SSL */}
      {showSSL && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-xl font-semibold text-white mb-4">Instalar Certificado SSL</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-300 mb-2">Domínio</label>
                <input
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                  placeholder="example.com"
                  value={sslForm.domain}
                  onChange={(e) => setSSLForm({...sslForm, domain: e.target.value})}
                />
              </div>

              <div>
                <label className="block text-sm text-slate-300 mb-2">Email</label>
                <input
                  type="email"
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                  placeholder="admin@example.com"
                  value={sslForm.email}
                  onChange={(e) => setSSLForm({...sslForm, email: e.target.value})}
                />
              </div>

              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                <p className="text-xs text-blue-300">
                  ✨ Será usado Let's Encrypt (gratuito). Certifique-se que o domínio aponta para este servidor.
                </p>
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <button
                onClick={installSSL}
                className="flex-1 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600"
              >
                Instalar SSL
              </button>
              <button
                onClick={() => setShowSSL(false)}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-300"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default NginxPanel
