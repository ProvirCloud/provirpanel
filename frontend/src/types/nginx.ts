export type NginxSiteType = 'proxy' | 'load-balancer' | 'static'

export type NginxTarget = {
  host: string
  port: string
  weight: string
}

export type NginxSite = {
  name: string
  displayName: string
  enabled: boolean
  type: NginxSiteType
  serverNames: string[]
  listenPort: string
  sslEnabled: boolean
  proxyHost: string
  proxyPort: string
  targets: NginxTarget[]
  rootPath: string
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

const parseRawConfig = (content: string) => {
  const upstreams: Array<{ name: string; servers: string[] }> = []
  const servers: Array<{
    listen: string | null
    serverName: string | null
    root: string | null
    locations: Array<{ path: string; proxy: string | null }>
  }> = []

  const upstreamRegex = /upstream\s+([^\s{]+)\s*\{([\s\S]*?)\}/g
  let match: RegExpExecArray | null
  while ((match = upstreamRegex.exec(content))) {
    const name = match[1]
    const block = match[2]
    const serverMatches: string[] = []
    const srvRegex = /server\s+([^;]+);/g
    let srv: RegExpExecArray | null
    while ((srv = srvRegex.exec(block))) serverMatches.push(srv[1].trim())
    upstreams.push({ name, servers: serverMatches })
  }

  const serverRegex = /server\s*\{([\s\S]*?)\}/g
  let serverMatch: RegExpExecArray | null
  while ((serverMatch = serverRegex.exec(content))) {
    const block = serverMatch[1]
    const listenMatch = block.match(/listen\s+([^;]+);/)
    const nameMatch = block.match(/server_name\s+([^;]+);/)
    const rootMatch = block.match(/root\s+([^;]+);/)
    const locations: Array<{ path: string; proxy: string | null }> = []
    const locationRegex = /location\s+([^\s{]+)\s*\{([\s\S]*?)\}/g
    let loc: RegExpExecArray | null
    while ((loc = locationRegex.exec(block))) {
      const proxyMatch = loc[2].match(/proxy_pass\s+([^;]+);/)
      locations.push({ path: loc[1], proxy: proxyMatch ? proxyMatch[1] : null })
    }
    servers.push({
      listen: listenMatch ? listenMatch[1] : null,
      serverName: nameMatch ? nameMatch[1] : null,
      root: rootMatch ? rootMatch[1] : null,
      locations,
    })
  }

  return { upstreams, servers }
}

export const extractSiteInfo = (config: BackendConfig): NginxSite => {
  const parsed = parseRawConfig(config.content || '')
  const server = parsed.servers[0] || {}
  const serverName = server.serverName || ''
  const listenValue = server.listen ? String(server.listen) : '80'
  const sslEnabled = /ssl/.test(listenValue)
  const listenPort = listenValue.replace(/ssl/g, '').trim() || '80'

  const certMatch = (config.content || '').match(/ssl_certificate\s+([^;]+);/)
  const keyMatch = (config.content || '').match(/ssl_certificate_key\s+([^;]+);/)

  const proxyLocation = (server.locations || []).find((loc) => loc.proxy)
  const proxyTarget = proxyLocation?.proxy || ''
  const hasUpstream = parsed.upstreams.length > 0

  let type: NginxSiteType = 'proxy'
  if (server.root) type = 'static'
  else if (hasUpstream) type = 'load-balancer'

  let proxyHost = 'localhost'
  let proxyPort = '3000'
  if (proxyTarget.startsWith('http')) {
    const clean = proxyTarget.replace(/^https?:\/\//, '')
    const [hostPort] = clean.split(/\//)
    const [host, port] = hostPort.split(':')
    proxyHost = host || proxyHost
    proxyPort = port || proxyPort
  }

  const upstreamTargets = parsed.upstreams[0]?.servers || []
  const targets: NginxTarget[] = upstreamTargets.length
    ? upstreamTargets.map((entry) => {
        const parts = entry.split(/\s+/)
        const hostPort = parts[0] || ''
        const [host, port] = hostPort.split(':')
        const weight = parts.find((p) => p.startsWith('weight='))?.split('=')[1] || '1'
        return { host: host || '127.0.0.1', port: port || '3000', weight }
      })
    : [{ host: proxyHost, port: proxyPort, weight: '1' }]

  return {
    name: config.name,
    displayName: config.name.replace(/\.conf$/, ''),
    enabled: config.enabled ?? false,
    type,
    serverNames: serverName ? serverName.trim().split(/\s+/) : [],
    listenPort: sslEnabled ? '443' : listenPort,
    sslEnabled,
    proxyHost,
    proxyPort,
    targets,
    rootPath: server.root || '/var/www/html',
    raw: config.content || '',
    toggleable: config.toggleable ?? false,
    deletable: config.deletable ?? false,
    editable: config.editable ?? false,
    readable: config.readable !== false,
    ...(certMatch ? { sslCertPath: certMatch[1] } : {}),
    ...(keyMatch ? { sslKeyPath: keyMatch[1] } : {}),
  } as NginxSite
}

export const buildNginxConfig = (form: {
  serverNames: string
  listenPort: string
  type: NginxSiteType
  proxyHost: string
  proxyPort: string
  targets: NginxTarget[]
  rootPath: string
  sslEnabled: boolean
  sslCertPath: string
  sslKeyPath: string
}): string => {
  const names = form.serverNames.trim().split(/\s+/).filter(Boolean).join(' ') || 'example.com'
  const cert = form.sslCertPath || '/etc/letsencrypt/live/example.com/fullchain.pem'
  const key = form.sslKeyPath || '/etc/letsencrypt/live/example.com/privkey.pem'

  const sslDirectives = `    ssl_certificate ${cert};
    ssl_certificate_key ${key};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;`

  const proxyHeaders = `        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;`

  if (form.type === 'static') {
    const staticLocation = `    root ${form.rootPath};
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }`

    if (!form.sslEnabled) {
      return `server {\n    listen ${form.listenPort};\n    server_name ${names};\n\n${staticLocation}\n}`
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

${staticLocation}
}`
  }

  const upstreamName = 'app_backend'
  let proxyTarget = `http://${form.proxyHost}:${form.proxyPort}`
  let upstreamBlock = ''

  if (form.type === 'load-balancer') {
    const serverLines = form.targets
      .map((t) => {
        const w = t.weight && t.weight !== '1' ? ` weight=${t.weight}` : ''
        return `    server ${t.host}:${t.port}${w};`
      })
      .join('\n')
    upstreamBlock = `upstream ${upstreamName} {\n${serverLines}\n}\n\n`
    proxyTarget = `http://${upstreamName}`
  }

  const locationBlock = `    location / {
        proxy_pass ${proxyTarget};
${proxyHeaders}
    }`

  if (!form.sslEnabled) {
    return `${upstreamBlock}server {
    listen ${form.listenPort};
    server_name ${names};

${locationBlock}
}`
  }

  return `${upstreamBlock}server {
    listen 80;
    server_name ${names};
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${names};
${sslDirectives}

${locationBlock}
}`
}
