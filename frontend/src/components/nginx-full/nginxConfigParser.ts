import {
  type NginxVisualState,
  type RouteConfig,
  type UpstreamConfig,
  type UpstreamServer,
  type HeaderName,
  BASIC_PROXY_HEADERS,
  BASIC_WEBSOCKET_HEADERS,
  createInitialNginxVisualState,
} from './nginxVisualConfig'

const makeId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

// ─── Low-level parsers (brace-counting) ──────────────────────────────────────

function extractServerBlocks(content: string): string[] {
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

function extractLocationBlocks(serverContent: string): Array<{ path: string; inner: string }> {
  const results: Array<{ path: string; inner: string }> = []
  let i = 0
  while (i < serverContent.length) {
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

// ─── Upstream parser ──────────────────────────────────────────────────────────

function parseUpstreams(content: string): UpstreamConfig[] {
  const upstreams: UpstreamConfig[] = []
  const upstreamRegex = /\bupstream\s+([^\s{]+)\s*\{([\s\S]*?)\}/g
  let um: RegExpExecArray | null
  while ((um = upstreamRegex.exec(content))) {
    const name = um[1]
    const block = um[2]
    const methodMatch = block.match(/^\s*(least_conn|ip_hash|random)\s*;/m)
    const method = (methodMatch?.[1] as UpstreamConfig['method']) ?? 'round_robin'

    const servers: UpstreamServer[] = []
    const srvRegex = /\bserver\s+([^;]+);/g
    let srv: RegExpExecArray | null
    while ((srv = srvRegex.exec(block))) {
      const addrPart = srv[1].trim().split(/\s+/)[0]
      if (!addrPart || addrPart.startsWith('unix:')) continue
      const [host, portStr] = addrPart.split(':')
      const port = parseInt(portStr || '80', 10)
      if (host && !isNaN(port)) {
        servers.push({ id: `srv-${makeId()}`, host, port })
      }
    }

    if (servers.length > 0) {
      // Use the upstream name as ID so routes can reference it by name
      upstreams.push({ id: name, name, method, servers })
    }
  }
  return upstreams
}

// ─── Route type detection ─────────────────────────────────────────────────────

type RouteDetection = {
  type: RouteConfig['type']
  upstreamId?: string
  alias?: string
  fallback?: string
  tryFiles?: string
  headers: HeaderName[]
  timeouts?: { connect: number; read: number; send: number }
  proxyBuffering?: boolean
}

function detectRoute(
  inner: string,
  path: string,
  upstreamNames: Set<string>,
  adhocUpstreams: UpstreamConfig[],
): RouteDetection {
  const proxyPassMatch = inner.match(/\bproxy_pass\s+([^;]+);/)
  const aliasMatch = inner.match(/\balias\s+([^;]+);/)
  const tryFilesMatch = inner.match(/\btry_files\s+([^;]+);/)
  const alias = aliasMatch?.[1]?.trim() ?? ''
  const tryFiles = tryFilesMatch?.[1]?.trim() ?? ''

  const hasUpgrade = /proxy_set_header\s+Upgrade/i.test(inner)
  const proxyBuffering = !/proxy_buffering\s+off/i.test(inner)
  const connectTimeout = parseInt(inner.match(/\bproxy_connect_timeout\s+(\d+)/)?.[1] ?? '5', 10)
  const readTimeout = parseInt(inner.match(/\bproxy_read_timeout\s+(\d+)/)?.[1] ?? '60', 10)
  const sendTimeout = parseInt(inner.match(/\bproxy_send_timeout\s+(\d+)/)?.[1] ?? '60', 10)
  const timeouts = { connect: connectTimeout, read: readTimeout, send: sendTimeout }

  // ── Proxy / WebSocket ──────────────────────────────────────────────────────
  if (proxyPassMatch) {
    const rawTarget = proxyPassMatch[1].trim()
    const withoutScheme = rawTarget.replace(/^https?:\/\//, '').split('/')[0]
    // Check if target is a named upstream
    let upstreamId: string | undefined
    if (upstreamNames.has(withoutScheme)) {
      upstreamId = withoutScheme
    } else {
      // Inline proxy_pass host:port -> create ad-hoc upstream
      const [host, portStr] = withoutScheme.split(':')
      const port = parseInt(portStr || '80', 10)
      // Avoid reserved names like 'localhost' as upstream name
      const safeName = (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0')
        ? `backend_${isNaN(port) ? 80 : port}`
        : (host || 'app')
      const inlineUpstream: UpstreamConfig = {
        id: `upstream-${makeId()}`,
        name: safeName,
        method: 'round_robin',
        servers: [{ id: `srv-${makeId()}`, host: host || '127.0.0.1', port: isNaN(port) ? 80 : port }],
      }
      adhocUpstreams.push(inlineUpstream)
      upstreamId = inlineUpstream.id
    }

    const headers: HeaderName[] = hasUpgrade ? [...BASIC_WEBSOCKET_HEADERS] : [...BASIC_PROXY_HEADERS]
    return {
      type: hasUpgrade ? 'websocket' : 'proxy',
      upstreamId,
      headers,
      timeouts,
      proxyBuffering,
    }
  }

  // ── Static ─────────────────────────────────────────────────────────────────
  if (alias || /\broot\s/.test(inner)) {
    // Assets: path segment OR try_files returning 404 without SPA fallback
    const isAssetsPath = /assets|static|media|public/i.test(path)
    const isAssetsTryFiles = tryFiles.includes('=404') && !tryFiles.includes('index.html')

    if (isAssetsPath || isAssetsTryFiles) {
      return { type: 'static-assets', alias: alias || undefined, tryFiles: tryFiles || '=404', headers: [] }
    }

    // SPA app: try_files ends with an HTML fallback
    const spaFallback = tryFiles.match(/(\S+index\.html)/)?.[1]
    if (spaFallback) {
      return { type: 'static-app', alias: alias || undefined, fallback: spaFallback, headers: [] }
    }

    return { type: 'static-site', alias: alias || undefined, fallback: tryFiles || undefined, headers: [] }
  }

  // Fallback
  return { type: 'proxy', headers: [...BASIC_PROXY_HEADERS], timeouts, proxyBuffering }
}

// ─── Main parser ──────────────────────────────────────────────────────────────

export function parseNginxConfigToState(content: string, filename: string): NginxVisualState {
  const defaults = createInitialNginxVisualState()

  // 1. Upstreams
  const upstreams = parseUpstreams(content)
  const upstreamNames = new Set(upstreams.map((u) => u.name))
  const adhocUpstreams: UpstreamConfig[] = []

  // 2. Server blocks
  const serverBlocks = extractServerBlocks(content)
  if (serverBlocks.length === 0) return defaults

  // Prefer HTTPS/SSL block as main; HTTP-only redirect block as the http config
  const httpsBlock =
    serverBlocks.find((b) => /\blisten\s[^;]*443[^;]*ssl/i.test(b) || /\blisten\s[^;]*ssl/i.test(b)) ??
    serverBlocks.find((b) => !/\breturn\s+30[12]\s/.test(b)) ??
    serverBlocks[0] ??
    ''

  const httpBlock =
    serverBlocks.find(
      (b) => /\breturn\s+30[12]\s/.test(b) && !/\blisten\s[^;]*443/i.test(b),
    ) ?? null

  // 3. Domain
  const serverNameMatch = httpsBlock.match(/\bserver_name\s+([^;]+);/)
  const serverNames = serverNameMatch
    ? serverNameMatch[1].trim().split(/\s+/).filter(Boolean)
    : [filename.replace(/\.conf$/, '')]
  const primary = serverNames[0]
  const additional = serverNames.slice(1)

  // 4. HTTP block
  const httpListenMatch = httpBlock?.match(/\blisten\s+(\d+)/)
  const httpPort = httpListenMatch ? parseInt(httpListenMatch[1], 10) : 80
  const redirectToHttps = httpBlock ? /\breturn\s+30[12]\s/.test(httpBlock) : serverBlocks.length > 1

  // 5. HTTPS / SSL block
  const httpsListenMatch = httpsBlock.match(/\blisten\s+([^;]+);/)
  const httpsListenVal = httpsListenMatch ? httpsListenMatch[1].trim() : '443 ssl'
  const httpsPort = parseInt(httpsListenVal.split(/\s+/)[0], 10) || 443
  const sslEnabled =
    /\bssl\b/.test(httpsListenVal) ||
    /\bssl_certificate\b/.test(httpsBlock) ||
    /\bssl_certificate\b/.test(content)
  const http2Enabled = /\bhttp2\b/.test(httpsListenVal) || /\bhttp2\b/.test(httpsBlock)

  const certMatch = content.match(/\bssl_certificate\s+([^;]+);/)
  const keyMatch = content.match(/\bssl_certificate_key\s+([^;]+);/)
  const bodyMatch = content.match(/\bclient_max_body_size\s+([^;]+);/)

  const securityHeadersEnabled = /add_header\s+X-Frame-Options/i.test(content)
  const hstsEnabled = /add_header\s+Strict-Transport-Security/i.test(content)
  const serverTokensOff = /server_tokens\s+off/i.test(content)

  // 6. Routes from HTTPS block (fall back to first block)
  const parseBlock = httpsBlock || serverBlocks[0]
  const locationBlocks = extractLocationBlocks(parseBlock)
  const routes: RouteConfig[] = []

  for (const { path, inner } of locationBlocks) {
    // Skip pure redirects
    const isRedirect =
      /\breturn\s+30[12]\s/.test(inner) &&
      !/proxy_pass/.test(inner) &&
      !/\broot\s/.test(inner) &&
      !/try_files/.test(inner)
    if (isRedirect) continue

    const detection = detectRoute(inner, path, upstreamNames, adhocUpstreams)
    routes.push({
      id: `route-${makeId()}`,
      path,
      title: path,
      ...detection,
    })
  }

  const allUpstreams = [...upstreams, ...adhocUpstreams]

  return {
    internetLabel: 'Internet',
    domain: { primary, additional },
    http: { port: httpPort, redirectToHttps },
    https: {
      port: httpsPort,
      sslEnabled,
      http2Enabled,
      certPath: certMatch?.[1]?.trim() ?? '',
      keyPath: keyMatch?.[1]?.trim() ?? '',
      securityHeadersEnabled,
      hstsEnabled,
      serverTokensOff,
      clientMaxBodySize: bodyMatch?.[1]?.trim() ?? defaults.https.clientMaxBodySize,
    },
    upstreams: allUpstreams,
    routes,
  }
}
