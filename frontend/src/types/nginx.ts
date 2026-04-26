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
  // return directive
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
  // proxy / load-balancer
  upstreamName: string
  upstreamMethod: '' | 'least_conn' | 'ip_hash' | 'random'
  targets: NginxTarget[]
  locations: NginxLocation[]
  proxySettings: NginxProxySettings
  // static
  rootPath: string
  indexFiles: string
  // raw content
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

// ─── Parser ─────────────────────────────────────────────────────────────────

/** Extract the inner content of every top-level `server { }` block */
const extractServerBlocks = (content: string): string[] => {
  const blocks: string[] = []
  let i = 0
  while (i < content.length) {
    // find "server" followed by optional whitespace then "{"
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

/** Extract every `location <path> { }` block from a server block string */
const extractLocationBlocks = (serverContent: string): Array<{ path: string; inner: string }> => {
  const results: Array<{ path: string; inner: string }> = []
  let i = 0
  while (i < serverContent.length) {
    const match = /\blocation\s+([^\s{]+)\s*\{/.exec(serverContent.slice(i))
    if (!match) break
    const path = match[1]
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

/** Parse a proxy_pass URL into host and port */
const parseProxyUrl = (url: string): { host: string; port: string } => {
  const clean = url.replace(/^https?:\/\//, '').split('/')[0]
  const [host, port] = clean.split(':')
  return { host: host || 'localhost', port: port || '80' }
}

export const extractSiteInfo = (config: BackendConfig): NginxSite => {
  const raw = config.content || ''

  // ── Upstreams ────────────────────────────────────────────────────────────
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
    break // use first upstream
  }

  // ── Server blocks ────────────────────────────────────────────────────────
  const serverBlocks = extractServerBlocks(raw)

  // Use the HTTPS block if available, else the first block
  const mainBlock =
    serverBlocks.find((b) => /\blisten\s+[^;]*443[^;]*ssl/.test(b) || /\blisten\s+[^;]*ssl/.test(b)) ||
    serverBlocks[0] ||
    ''

  // skip redirect-only blocks (contain "return 301" with no locations with proxy_pass)
  const listenMatch = mainBlock.match(/\blisten\s+([^;]+);/)
  const listenValue = listenMatch ? listenMatch[1].trim() : '80'
  const sslEnabled = /ssl/.test(listenValue)
  const listenPort = listenValue.replace(/\bssl\b/g, '').replace(/\bhttp2\b/g, '').trim().split(/\s+/)[0] || '80'

  const serverNameMatch = mainBlock.match(/\bserver_name\s+([^;]+);/)
  const serverNames = serverNameMatch
    ? serverNameMatch[1].trim().split(/\s+/)
    : []

  const certMatch = raw.match(/\bssl_certificate\s+([^;]+);/)
  const keyMatch = raw.match(/\bssl_certificate_key\s+([^;]+);/)

  // ── Global proxy settings from server block / any location ───────────────
  const proxySettings: NginxProxySettings = {
    websocket: /proxy_set_header\s+Upgrade/.test(raw),
    forwardHeaders: /proxy_set_header\s+X-Real-IP/.test(raw),
    cacheBypass: /proxy_cache_bypass/.test(raw),
    clientBodySize: raw.match(/\bclient_max_body_size\s+([^;]+);/)?.[1]?.trim() || '',
    connectTimeout: raw.match(/\bproxy_connect_timeout\s+([^;]+);/)?.[1]?.trim() || '',
    readTimeout: raw.match(/\bproxy_read_timeout\s+([^;]+);/)?.[1]?.trim() || '',
    sendTimeout: raw.match(/\bproxy_send_timeout\s+([^;]+);/)?.[1]?.trim() || '',
  }

  // ── Locations ─────────────────────────────────────────────────────────────
  const rootMatch = mainBlock.match(/\broot\s+([^;]+);/)
  const serverRoot = rootMatch ? rootMatch[1].trim() : ''
  const indexMatch = mainBlock.match(/\bindex\s+([^;]+);/)
  const serverIndex = indexMatch ? indexMatch[1].trim() : 'index.html'

  const rawLocations = extractLocationBlocks(mainBlock)
  const locations: NginxLocation[] = rawLocations
    .filter((loc) => {
      // skip redirect-only locations
      const isRedirectOnly = /\breturn\s+30[12]/.test(loc.inner) && !/proxy_pass/.test(loc.inner) && !/root/.test(loc.inner)
      return !isRedirectOnly
    })
    .map((loc) => {
      const proxyPassMatch = loc.inner.match(/\bproxy_pass\s+([^;]+);/)
      const locRootMatch = loc.inner.match(/\broot\s+([^;]+);/)
      const tryFilesMatch = loc.inner.match(/\btry_files\s+([^;]+);/)
      const returnMatch = loc.inner.match(/\breturn\s+([^;]+);/)
      let proxyHost = ''
      let proxyPort = ''
      if (proxyPassMatch) {
        const parsed = parseProxyUrl(proxyPassMatch[1].trim())
        proxyHost = parsed.host
        proxyPort = parsed.port
      }
      return {
        path: loc.path,
        proxyHost,
        proxyPort,
        root: locRootMatch ? locRootMatch[1].trim() : serverRoot,
        tryFiles: tryFilesMatch ? tryFilesMatch[1].trim() : '',
        returnDirective: returnMatch ? returnMatch[1].trim() : '',
      }
    })

  // ── Determine type ────────────────────────────────────────────────────────
  const hasUpstream = targets.length > 0
  const hasProxy = locations.some((l) => l.proxyHost)
  const hasRoot = !!serverRoot || locations.some((l) => l.root && !l.proxyHost)

  let type: NginxSiteType = 'proxy'
  if (hasUpstream) type = 'load-balancer'
  else if (hasRoot && !hasProxy) type = 'static'

  // If no usable locations, create a default
  const finalLocations =
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

  // For lb, the "targets" already come from upstream; location proxy host may be the upstream name
  // Normalize proxy host/port for lb targets if needed
  const normalizedTargets =
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
    targets: normalizedTargets,
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

// ─── Config generator ────────────────────────────────────────────────────────

export type BuildForm = {
  serverNames: string
  listenPort: string
  type: NginxSiteType
  locations: Array<{ path: string; proxyHost: string; proxyPort: string; root: string; tryFiles: string }>
  upstreamName: string
  upstreamMethod: NginxSite['upstreamMethod']
  targets: NginxTarget[]
  rootPath: string
  indexFiles: string
  proxySettings: NginxProxySettings
  sslEnabled: boolean
  sslCertPath: string
  sslKeyPath: string
}

const buildProxyHeaders = (s: NginxProxySettings, indent = '        '): string => {
  const lines: string[] = []
  lines.push(`${indent}proxy_http_version 1.1;`)
  if (s.websocket) {
    lines.push(`${indent}proxy_set_header Upgrade $http_upgrade;`)
    lines.push(`${indent}proxy_set_header Connection 'upgrade';`)
  }
  if (s.forwardHeaders) {
    lines.push(`${indent}proxy_set_header Host $host;`)
    lines.push(`${indent}proxy_set_header X-Real-IP $remote_addr;`)
    lines.push(`${indent}proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`)
    lines.push(`${indent}proxy_set_header X-Forwarded-Proto $scheme;`)
  }
  if (s.cacheBypass) {
    lines.push(`${indent}proxy_cache_bypass $http_upgrade;`)
  }
  if (s.connectTimeout) lines.push(`${indent}proxy_connect_timeout ${s.connectTimeout};`)
  if (s.readTimeout) lines.push(`${indent}proxy_read_timeout ${s.readTimeout};`)
  if (s.sendTimeout) lines.push(`${indent}proxy_send_timeout ${s.sendTimeout};`)
  return lines.join('\n')
}

const buildLocationBlock = (
  path: string,
  target: string,
  settings: NginxProxySettings,
): string => {
  return `    location ${path} {
        proxy_pass ${target};
${buildProxyHeaders(settings)}
    }`
}

const buildStaticLocationBlock = (
  path: string,
  root: string,
  index: string,
  tryFiles: string,
): string => {
  return `    location ${path} {
        root ${root};
        index ${index || 'index.html'};
        try_files ${tryFiles || '$uri $uri/ =404'};
    }`
}

export const buildNginxConfig = (form: BuildForm): string => {
  const names = form.serverNames.trim().split(/\s+/).filter(Boolean).join(' ') || 'example.com'
  const cert = form.sslCertPath || '/etc/letsencrypt/live/example.com/fullchain.pem'
  const key = form.sslKeyPath || '/etc/letsencrypt/live/example.com/privkey.pem'
  const bodySize = form.proxySettings.clientBodySize

  const sslDirectives = `    ssl_certificate ${cert};
    ssl_certificate_key ${key};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;`

  // ── Static ────────────────────────────────────────────────────────────────
  if (form.type === 'static') {
    const locs = form.locations.length
      ? form.locations
      : [{ path: '/', root: form.rootPath, tryFiles: '$uri $uri/ =404', proxyHost: '', proxyPort: '' }]

    const locationBlocks = locs
      .map((l) => buildStaticLocationBlock(l.path, l.root || form.rootPath, form.indexFiles, l.tryFiles))
      .join('\n\n')

    if (!form.sslEnabled) {
      return `server {
    listen ${form.listenPort};
    server_name ${names};

${locationBlocks}
}`
    }
    return `server {
    listen 80;
    server_name ${names};
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${names};
${sslDirectives}

${locationBlocks}
}`
  }

  // ── Load balancer ─────────────────────────────────────────────────────────
  if (form.type === 'load-balancer') {
    const uName = form.upstreamName || 'app_backend'
    const serverLines = form.targets
      .map((t) => {
        const w = t.weight && t.weight !== '1' ? ` weight=${t.weight}` : ''
        const b = t.backup ? ' backup' : ''
        return `    server ${t.host}:${t.port}${w}${b};`
      })
      .join('\n')
    const methodLine = form.upstreamMethod ? `    ${form.upstreamMethod};\n` : ''
    const upstreamBlock = `upstream ${uName} {\n${methodLine}${serverLines}\n}`
    const target = `http://${uName}`
    const locationBlocks = (form.locations.length ? form.locations : [{ path: '/' }])
      .map((l) => buildLocationBlock(l.path, target, form.proxySettings))
      .join('\n\n')
    const bodySizeLine = bodySize ? `\n    client_max_body_size ${bodySize};` : ''

    if (!form.sslEnabled) {
      return `${upstreamBlock}

server {
    listen ${form.listenPort};
    server_name ${names};${bodySizeLine}

${locationBlocks}
}`
    }
    return `${upstreamBlock}

server {
    listen 80;
    server_name ${names};
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${names};
${sslDirectives}${bodySizeLine}

${locationBlocks}
}`
  }

  // ── Proxy reverso ─────────────────────────────────────────────────────────
  const locs = form.locations.length
    ? form.locations
    : [{ path: '/', proxyHost: 'localhost', proxyPort: '3000', root: '', tryFiles: '' }]

  const locationBlocks = locs
    .map((l) => buildLocationBlock(l.path, `http://${l.proxyHost}:${l.proxyPort}`, form.proxySettings))
    .join('\n\n')

  const bodySizeLine = bodySize ? `\n    client_max_body_size ${bodySize};` : ''

  if (!form.sslEnabled) {
    return `server {
    listen ${form.listenPort};
    server_name ${names};${bodySizeLine}

${locationBlocks}
}`
  }
  return `server {
    listen 80;
    server_name ${names};
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${names};
${sslDirectives}${bodySizeLine}

${locationBlocks}
}`
}
