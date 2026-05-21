export type NginxSiteType = 'proxy' | 'load-balancer' | 'static'

export type NginxTarget = {
  host: string
  port: string
  weight: string
  backup: boolean
}

export type NginxLocation = {
  path: string
  // proxy mode
  proxyHost: string
  proxyPort: string
  // static mode
  root: string
  tryFiles: string
  // return
  returnDirective: string
}

export type NginxProxySettings = {
  websocket: boolean
  forwardHeaders: boolean
  cacheBypass: boolean
  clientBodySize: string
  connectTimeout: string
  readTimeout: string
  sendTimeout: string
}

export type NginxSite = {
  name: string
  displayName: string
  enabled: boolean
  type: NginxSiteType
  serverNames: string[]
  listenPort: string
  sslEnabled: boolean
  sslCertPath: string
  sslKeyPath: string
  upstreamName: string
  upstreamMethod: '' | 'least_conn' | 'ip_hash' | 'random'
  targets: NginxTarget[]
  locations: NginxLocation[]
  proxySettings: NginxProxySettings
  rootPath: string
  indexFiles: string
  raw: string
  toggleable: boolean
  deletable: boolean
  editable: boolean
  readable: boolean
}

export type BackendConfig = {
  name: string
  content: string
  enabled: boolean
  type: string
  editable?: boolean
  readable?: boolean
  deletable?: boolean
  toggleable?: boolean
  error?: string
}

export type DockerContainer = {
  id: string
  name: string
  ip: string
  port: number | null
  image: string
}

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Extract every top-level `server { }` block from the file.
 * Uses brace counting so nested location blocks don't break the extraction.
 */
const extractServerBlocks = (content: string): string[] => {
  const blocks: string[] = []
  let i = 0
  while (i < content.length) {
    const match = /\bserver\s*\{/.exec(content.slice(i))
    if (!match) break
    const openIdx = i + match.index + match[0].length - 1
    let depth = 1
    let j = openIdx + 1
    while (j < content.length && depth > 0) {
      if (content[j] === '{') depth++
      else if (content[j] === '}') depth--
      j++
    }
    blocks.push(content.slice(openIdx + 1, j - 1))
    i = j
  }
  return blocks
}

/**
 * Extract every `location <path> { }` from a server block string.
 * Handles multi-word paths: `~* pattern`, `= /exact`, `^~ /prefix`.
 */
const extractLocationBlocks = (serverContent: string): Array<{ path: string; inner: string }> => {
  const results: Array<{ path: string; inner: string }> = []
  let i = 0
  while (i < serverContent.length) {
    // `[^{]+?` captures everything before the opening brace (trimmed by \s*)
    const match = /\blocation\s+([^{]+?)\s*\{/.exec(serverContent.slice(i))
    if (!match) break
    const path = match[1].trim()
    const openIdx = i + match.index + match[0].length - 1
    let depth = 1
    let j = openIdx + 1
    while (j < serverContent.length && depth > 0) {
      if (serverContent[j] === '{') depth++
      else if (serverContent[j] === '}') depth--
      j++
    }
    results.push({ path, inner: serverContent.slice(openIdx + 1, j - 1) })
    i = j
  }
  return results
}

const parseProxyUrl = (url: string): { host: string; port: string } => {
  const clean = url.replace(/^https?:\/\//, '').split('/')[0]
  const [host, port] = clean.split(':')
  return { host: host || 'localhost', port: port || '80' }
}

const DEFAULT_PROXY_SETTINGS: NginxProxySettings = {
  websocket: false,
  forwardHeaders: false,
  cacheBypass: false,
  clientBodySize: '',
  connectTimeout: '',
  readTimeout: '',
  sendTimeout: '',
}

const FALLBACK_SITE = (config: BackendConfig): NginxSite => ({
  name: config.name,
  displayName: config.name.replace(/\.conf$/, ''),
  enabled: config.enabled ?? false,
  type: 'proxy',
  serverNames: [],
  listenPort: '80',
  sslEnabled: false,
  sslCertPath: '',
  sslKeyPath: '',
  upstreamName: 'app_backend',
  upstreamMethod: '',
  targets: [],
  locations: [{ path: '/', proxyHost: '', proxyPort: '', root: '', tryFiles: '', returnDirective: '' }],
  proxySettings: { ...DEFAULT_PROXY_SETTINGS },
  rootPath: '/var/www/html',
  indexFiles: 'index.html',
  raw: config.content || '',
  toggleable: config.toggleable ?? false,
  deletable: config.deletable ?? false,
  editable: config.editable ?? false,
  readable: config.readable !== false,
})

export const extractSiteInfo = (config: BackendConfig): NginxSite => {
  try {
    return _extractSiteInfo(config)
  } catch {
    return FALLBACK_SITE(config)
  }
}

const _extractSiteInfo = (config: BackendConfig): NginxSite => {
  const raw = config.content || ''

  // ── Upstreams ─────────────────────────────────────────────────────────────
  const targets: NginxTarget[] = []
  let upstreamName = 'app_backend'
  let upstreamMethod: NginxSite['upstreamMethod'] = ''

  const upstreamRegex = /\bupstream\s+([^\s{]+)\s*\{([\s\S]*?)\}/g
  let um: RegExpExecArray | null
  while ((um = upstreamRegex.exec(raw))) {
    upstreamName = um[1]
    const block = um[2]
    const methodMatch = block.match(/^\s*(least_conn|ip_hash|random)\s*;/m)
    if (methodMatch) upstreamMethod = methodMatch[1] as NginxSite['upstreamMethod']
    const srvRegex = /\bserver\s+([^;]+);/g
    let srv: RegExpExecArray | null
    while ((srv = srvRegex.exec(block))) {
      const parts = srv[1].trim().split(/\s+/)
      const [host, port] = (parts[0] || '').split(':')
      const weight = parts.find((p) => p.startsWith('weight='))?.split('=')[1] || '1'
      const backup = parts.includes('backup')
      targets.push({ host: host || '127.0.0.1', port: port || '80', weight, backup })
    }
    break // only the first upstream
  }

  // ── Server blocks ─────────────────────────────────────────────────────────
  const serverBlocks = extractServerBlocks(raw)

  // Prefer the HTTPS/SSL block; fall back to the first one
  const mainBlock =
    serverBlocks.find((b) => /\blisten\s[^;]*443[^;]*ssl/.test(b) || /\blisten\s[^;]*ssl/.test(b)) ||
    serverBlocks[0] ||
    ''

  const listenMatch = mainBlock.match(/\blisten\s+([^;]+);/)
  const listenValue = listenMatch ? listenMatch[1].trim() : '80'
  const sslEnabled = /\bssl\b/.test(listenValue)
  const listenPort = listenValue.replace(/\bssl\b/g, '').replace(/\bhttp2\b/g, '').trim().split(/\s+/)[0] || '80'

  const serverNameMatch = mainBlock.match(/\bserver_name\s+([^;]+);/)
  const serverNames = serverNameMatch ? serverNameMatch[1].trim().split(/\s+/) : []

  const certMatch = raw.match(/\bssl_certificate\s+([^;]+);/)
  const keyMatch = raw.match(/\bssl_certificate_key\s+([^;]+);/)

  // ── Proxy settings from anywhere in the raw file ──────────────────────────
  const proxySettings: NginxProxySettings = {
    websocket: /proxy_set_header\s+Upgrade/.test(raw),
    forwardHeaders: /proxy_set_header\s+X-Real-IP/.test(raw),
    cacheBypass: /proxy_cache_bypass/.test(raw),
    clientBodySize: raw.match(/\bclient_max_body_size\s+([^;]+);/)?.[1]?.trim() || '',
    connectTimeout: raw.match(/\bproxy_connect_timeout\s+([^;]+);/)?.[1]?.trim() || '',
    readTimeout: raw.match(/\bproxy_read_timeout\s+([^;]+);/)?.[1]?.trim() || '',
    sendTimeout: raw.match(/\bproxy_send_timeout\s+([^;]+);/)?.[1]?.trim() || '',
  }

  // ── Server-level directives ───────────────────────────────────────────────
  const rootMatch = mainBlock.match(/\broot\s+([^;]+);/)
  const serverRoot = rootMatch ? rootMatch[1].trim() : ''
  const indexMatch = mainBlock.match(/\bindex\s+([^;]+);/)
  const serverIndex = indexMatch ? indexMatch[1].trim() : 'index.html'

  // ── Location blocks ───────────────────────────────────────────────────────
  const rawLocations = extractLocationBlocks(mainBlock)

  const locations: NginxLocation[] = rawLocations
    .filter(({ inner }) => {
      // Drop pure redirect locations (return 301/302 only, no content)
      const isRedirectOnly =
        /\breturn\s+30[12]\s/.test(inner) &&
        !/proxy_pass/.test(inner) &&
        !/\broot\s/.test(inner) &&
        !/try_files/.test(inner)
      return !isRedirectOnly
    })
    .map(({ path, inner }) => {
      const proxyPassMatch = inner.match(/\bproxy_pass\s+([^;]+);/)
      const locRootMatch = inner.match(/\broot\s+([^;]+);/)
      const aliasMatch = inner.match(/\balias\s+([^;]+);/)
      const tryFilesMatch = inner.match(/\btry_files\s+([^;]+);/)
      const returnMatch = inner.match(/\breturn\s+([^;]+);/)

      let proxyHost = ''
      let proxyPort = ''
      if (proxyPassMatch) {
        const parsed = parseProxyUrl(proxyPassMatch[1].trim())
        proxyHost = parsed.host
        proxyPort = parsed.port
      }

      const locRoot = locRootMatch
        ? locRootMatch[1].trim()
        : aliasMatch
        ? aliasMatch[1].trim()
        : serverRoot

      return {
        path,
        proxyHost,
        proxyPort,
        root: locRoot,
        tryFiles: tryFilesMatch ? tryFilesMatch[1].trim() : '',
        returnDirective: returnMatch ? returnMatch[1].trim() : '',
      }
    })

  // ── Type detection ────────────────────────────────────────────────────────
  const hasUpstream = targets.length > 0
  const hasProxy = locations.some((l) => l.proxyHost !== '')
  const hasStaticRoot = serverRoot !== '' || locations.some((l) => l.root !== '' && l.proxyHost === '')

  let type: NginxSiteType = 'proxy'
  if (hasUpstream) type = 'load-balancer'
  else if (hasStaticRoot && !hasProxy) type = 'static'

  // Ensure at least one location is present
  const finalLocations: NginxLocation[] =
    locations.length > 0
      ? locations
      : [
          {
            path: '/',
            proxyHost: type === 'static' ? '' : 'localhost',
            proxyPort: type === 'static' ? '' : '3000',
            root: serverRoot,
            tryFiles: type === 'static' ? '$uri $uri/ =404' : '',
            returnDirective: '',
          },
        ]

  // For load-balancer with no parsed targets, derive from the first proxy location
  const finalTargets =
    targets.length > 0
      ? targets
      : finalLocations
          .filter((l) => l.proxyHost)
          .map((l) => ({ host: l.proxyHost, port: l.proxyPort, weight: '1', backup: false }))

  return {
    name: config.name,
    displayName: config.name.replace(/\.conf$/, ''),
    enabled: config.enabled ?? false,
    type,
    serverNames,
    listenPort,
    sslEnabled,
    sslCertPath: certMatch ? certMatch[1].trim() : '',
    sslKeyPath: keyMatch ? keyMatch[1].trim() : '',
    upstreamName,
    upstreamMethod,
    targets: finalTargets,
    locations: finalLocations,
    proxySettings,
    rootPath: serverRoot || '/var/www/html',
    indexFiles: serverIndex,
    raw,
    toggleable: config.toggleable ?? false,
    deletable: config.deletable ?? false,
    editable: config.editable ?? false,
    readable: config.readable !== false,
  }
}

// ─── Config builder ───────────────────────────────────────────────────────────

export type BuildForm = {
  serverNames: string
  listenPort: string
  type: NginxSiteType
  // proxy
  locations: Array<{ path: string; proxyHost: string; proxyPort: string }>
  // load-balancer
  upstreamName: string
  upstreamMethod: NginxSite['upstreamMethod']
  targets: NginxTarget[]
  // static
  rootPath: string
  indexFiles: string
  staticLocations: Array<{ path: string; tryFiles: string }>
  // proxy settings
  proxySettings: NginxProxySettings
  // ssl
  sslEnabled: boolean
  sslCertPath: string
  sslKeyPath: string
}

const indent = (n: number) => '    '.repeat(n)

const proxyLocationBlock = (path: string, target: string, s: NginxProxySettings): string => {
  const lines: string[] = []
  lines.push(`${indent(2)}proxy_pass ${target};`)
  lines.push(`${indent(2)}proxy_http_version 1.1;`)
  if (s.websocket) {
    lines.push(`${indent(2)}proxy_set_header Upgrade $http_upgrade;`)
    lines.push(`${indent(2)}proxy_set_header Connection 'upgrade';`)
  }
  if (s.forwardHeaders) {
    lines.push(`${indent(2)}proxy_set_header Host $host;`)
    lines.push(`${indent(2)}proxy_set_header X-Real-IP $remote_addr;`)
    lines.push(`${indent(2)}proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`)
    lines.push(`${indent(2)}proxy_set_header X-Forwarded-Proto $scheme;`)
  }
  if (s.cacheBypass) lines.push(`${indent(2)}proxy_cache_bypass $http_upgrade;`)
  if (s.connectTimeout) lines.push(`${indent(2)}proxy_connect_timeout ${s.connectTimeout};`)
  if (s.readTimeout) lines.push(`${indent(2)}proxy_read_timeout ${s.readTimeout};`)
  if (s.sendTimeout) lines.push(`${indent(2)}proxy_send_timeout ${s.sendTimeout};`)
  return `${indent(1)}location ${path} {\n${lines.join('\n')}\n${indent(1)}}`
}

const staticLocationBlock = (path: string, tryFiles: string): string => {
  const tf = tryFiles || '$uri $uri/ =404'
  return `${indent(1)}location ${path} {\n${indent(2)}try_files ${tf};\n${indent(1)}}`
}

const serverHead = (names: string, port: string, extras: string[]): string => {
  const lines = [`${indent(1)}listen ${port};`, `${indent(1)}server_name ${names};`, ...extras.map((l) => `${indent(1)}${l}`)]
  return lines.join('\n')
}

export const buildNginxConfig = (form: BuildForm): string => {
  const names = form.serverNames.trim().split(/\s+/).filter(Boolean).join(' ') || 'example.com'
  const cert = form.sslCertPath || '/etc/letsencrypt/live/example.com/fullchain.pem'
  const key = form.sslKeyPath || '/etc/letsencrypt/live/example.com/privkey.pem'
  const s = form.proxySettings

  const sslBlock = `${indent(1)}ssl_certificate ${cert};\n${indent(1)}ssl_certificate_key ${key};\n${indent(1)}ssl_protocols TLSv1.2 TLSv1.3;\n${indent(1)}ssl_ciphers HIGH:!aNULL:!MD5;`
  const bodyExtra = s.clientBodySize ? `client_max_body_size ${s.clientBodySize};` : ''

  // ── Static ────────────────────────────────────────────────────────────────
  if (form.type === 'static') {
    const locs = form.staticLocations?.length
      ? form.staticLocations
      : [{ path: '/', tryFiles: '$uri $uri/ =404' }]

    const rootLine = `root ${form.rootPath || '/var/www/html'};`
    const indexLine = `index ${form.indexFiles || 'index.html'};`
    const locationBlocks = locs.map((l) => staticLocationBlock(l.path, l.tryFiles)).join('\n\n')
    const body = `${serverHead(names, form.listenPort, [rootLine, indexLine])}\n\n${locationBlocks}`

    if (!form.sslEnabled) return `server {\n${body}\n}`
    return `server {\n${serverHead(names, '80', [])}\n${indent(1)}return 301 https://$server_name$request_uri;\n}\n\nserver {\n${serverHead(names, '443 ssl http2', [])}\n${sslBlock}\n\n${indent(1)}${rootLine}\n${indent(1)}${indexLine}\n\n${locationBlocks}\n}`
  }

  // ── Load balancer ─────────────────────────────────────────────────────────
  if (form.type === 'load-balancer') {
    const uName = form.upstreamName || 'app_backend'
    const methodLine = form.upstreamMethod ? `    ${form.upstreamMethod};\n` : ''
    const serverLines = form.targets
      .map((t) => `    server ${t.host}:${t.port}${t.weight !== '1' ? ` weight=${t.weight}` : ''}${t.backup ? ' backup' : ''};`)
      .join('\n')
    const upstreamBlock = `upstream ${uName} {\n${methodLine}${serverLines}\n}`
    const target = `http://${uName}`
    const locs = form.locations?.length ? form.locations : [{ path: '/', proxyHost: '', proxyPort: '' }]
    const locationBlocks = locs.map((l) => proxyLocationBlock(l.path, target, s)).join('\n\n')
    const extras = bodyExtra ? [bodyExtra] : []

    if (!form.sslEnabled) {
      return `${upstreamBlock}\n\nserver {\n${serverHead(names, form.listenPort, extras)}\n\n${locationBlocks}\n}`
    }
    return `${upstreamBlock}\n\nserver {\n${serverHead(names, '80', [])}\n${indent(1)}return 301 https://$server_name$request_uri;\n}\n\nserver {\n${serverHead(names, '443 ssl http2', extras)}\n${sslBlock}\n\n${locationBlocks}\n}`
  }

  // ── Proxy reverso ─────────────────────────────────────────────────────────
  const locs = form.locations?.length
    ? form.locations
    : [{ path: '/', proxyHost: 'localhost', proxyPort: '3000' }]
  const locationBlocks = locs
    .map((l) => proxyLocationBlock(l.path, `http://${l.proxyHost}:${l.proxyPort}`, s))
    .join('\n\n')
  const extras = bodyExtra ? [bodyExtra] : []

  if (!form.sslEnabled) {
    return `server {\n${serverHead(names, form.listenPort, extras)}\n\n${locationBlocks}\n}`
  }
  return `server {\n${serverHead(names, '80', [])}\n${indent(1)}return 301 https://$server_name$request_uri;\n}\n\nserver {\n${serverHead(names, '443 ssl http2', extras)}\n${sslBlock}\n\n${locationBlocks}\n}`
}
