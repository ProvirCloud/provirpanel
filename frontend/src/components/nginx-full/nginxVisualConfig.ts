export type LoadBalancerMethod = 'round_robin' | 'least_conn' | 'ip_hash' | 'random'

export type HeaderName =
  | 'Host'
  | 'X-Real-IP'
  | 'X-Forwarded-For'
  | 'X-Forwarded-Proto'
  | 'Upgrade'
  | 'Connection'

export type RouteType =
  | 'proxy'
  | 'websocket'
  | 'static-app'
  | 'static-assets'
  | 'static-site'
  | 'redirect'

export type SelectedNode =
  | { kind: 'domain'; id: 'domain' }
  | { kind: 'http'; id: 'http' }
  | { kind: 'https'; id: 'https' }
  | { kind: 'route'; id: string }
  | { kind: 'upstream'; id: string }
  | { kind: 'static-target'; id: string }

export type UpstreamServer = {
  id: string
  host: string
  port: number
}

export type UpstreamConfig = {
  id: string
  name: string
  method: LoadBalancerMethod
  servers: UpstreamServer[]
}

export type RouteTimeouts = {
  connect: number
  read: number
  send: number
}

export type LocationModifier = '' | '=' | '~' | '~*' | '^~'

export type RouteConfig = {
  id: string
  path: string
  title: string
  type: RouteType
  modifier?: LocationModifier
  upstreamId?: string
  alias?: string
  fallback?: string
  tryFiles?: string
  redirectTo?: string
  redirectCode?: 301 | 302 | 307 | 308
  headers: HeaderName[]
  timeouts?: RouteTimeouts
  proxyBuffering?: boolean
  disabled?: boolean
}

export type NginxVisualState = {
  internetLabel: string
  domain: {
    primary: string
    additional: string[]
  }
  http: {
    port: number
    redirectToHttps: boolean
  }
  https: {
    port: number
    sslEnabled: boolean
    http2Enabled: boolean
    certPath: string
    keyPath: string
    securityHeadersEnabled: boolean
    hstsEnabled: boolean
    serverTokensOff: boolean
    clientMaxBodySize: string
  }
  upstreams: UpstreamConfig[]
  routes: RouteConfig[]
}

export const BASIC_PROXY_HEADERS: HeaderName[] = [
  'Host',
  'X-Real-IP',
  'X-Forwarded-For',
  'X-Forwarded-Proto',
]

export const BASIC_WEBSOCKET_HEADERS: HeaderName[] = [
  'Upgrade',
  'Connection',
  'Host',
  'X-Real-IP',
  'X-Forwarded-For',
  'X-Forwarded-Proto',
]

const makeId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

export const createInitialNginxVisualState = (): NginxVisualState => ({
  internetLabel: 'Internet',
  domain: {
    primary: 'zeusengine.com.br',
    additional: ['www.zeusengine.com.br'],
  },
  http: {
    port: 80,
    redirectToHttps: true,
  },
  https: {
    port: 443,
    sslEnabled: true,
    http2Enabled: true,
    certPath: '/etc/letsencrypt/live/zeusengine.com.br/fullchain.pem',
    keyPath: '/etc/letsencrypt/live/zeusengine.com.br/privkey.pem',
    securityHeadersEnabled: true,
    hstsEnabled: true,
    serverTokensOff: true,
    clientMaxBodySize: '500m',
  },
  upstreams: [
    {
      id: 'zeus_api',
      name: 'zeus_api',
      method: 'least_conn',
      servers: [
        { id: 'api-1', host: '127.0.0.1', port: 3000 },
        { id: 'api-2', host: '127.0.0.1', port: 3001 },
        { id: 'api-3', host: '127.0.0.1', port: 3002 },
      ],
    },
    {
      id: 'zeus_socket',
      name: 'zeus_socket',
      method: 'ip_hash',
      servers: [
        { id: 'socket-1', host: '127.0.0.1', port: 3000 },
        { id: 'socket-2', host: '127.0.0.1', port: 3001 },
        { id: 'socket-3', host: '127.0.0.1', port: 3002 },
      ],
    },
  ],
  routes: [
    {
      id: 'route-api',
      path: '/api/',
      title: '/api/',
      type: 'proxy',
      upstreamId: 'zeus_api',
      headers: BASIC_PROXY_HEADERS,
      timeouts: { connect: 5, read: 60, send: 60 },
      proxyBuffering: false,
    },
    {
      id: 'route-socket',
      path: '/socket.io/',
      title: '/socket.io/',
      type: 'websocket',
      upstreamId: 'zeus_socket',
      headers: BASIC_WEBSOCKET_HEADERS,
      timeouts: { connect: 5, read: 3600, send: 3600 },
      proxyBuffering: false,
    },
    {
      id: 'route-admin',
      path: '/admin/',
      title: '/admin/',
      type: 'static-app',
      alias: '/var/www/panel/',
      fallback: '/admin/index.html',
      headers: [],
    },
    {
      id: 'route-admin-assets',
      path: '/admin/assets/',
      title: '/admin/assets/',
      type: 'static-assets',
      alias: '/var/www/panel/assets/',
      tryFiles: '=404',
      headers: [],
    },
    {
      id: 'route-zeus-assets',
      path: '/zeus/assets/',
      title: '/zeus/assets/',
      type: 'static-assets',
      alias: '/var/www/zeus/assets/',
      tryFiles: '=404',
      headers: [],
    },
    {
      id: 'route-root',
      path: '/',
      title: '/',
      type: 'static-site',
      alias: '/var/www/zeus/',
      fallback: '/index.html',
      headers: [],
    },
  ],
})

// ─── Lookup helpers ───────────────────────────────────────────────────────────

export const findRouteById = (state: NginxVisualState, routeId: string) =>
  state.routes.find((route) => route.id === routeId) || null

export const findUpstreamById = (state: NginxVisualState, upstreamId?: string) =>
  state.upstreams.find((upstream) => upstream.id === upstreamId) || null

// ─── State mutation helpers ───────────────────────────────────────────────────

export const mutateRoute = (
  state: NginxVisualState,
  routeId: string,
  updater: (r: RouteConfig) => RouteConfig,
): NginxVisualState => ({
  ...state,
  routes: state.routes.map((r) => (r.id === routeId ? updater(r) : r)),
})

export const mutateUpstream = (
  state: NginxVisualState,
  upstreamId: string,
  updater: (u: UpstreamConfig) => UpstreamConfig,
): NginxVisualState => ({
  ...state,
  upstreams: state.upstreams.map((u) => (u.id === upstreamId ? updater(u) : u)),
})

export const mutateHttp = (
  state: NginxVisualState,
  patch: Partial<NginxVisualState['http']>,
): NginxVisualState => ({ ...state, http: { ...state.http, ...patch } })

export const mutateHttps = (
  state: NginxVisualState,
  patch: Partial<NginxVisualState['https']>,
): NginxVisualState => ({ ...state, https: { ...state.https, ...patch } })

export const mutateDomain = (
  state: NginxVisualState,
  patch: Partial<NginxVisualState['domain']>,
): NginxVisualState => ({ ...state, domain: { ...state.domain, ...patch } })

export const addRoute = (state: NginxVisualState): NginxVisualState => {
  const id = `route-${makeId()}`
  const newRoute: RouteConfig = {
    id,
    path: '/nova-rota',
    title: '/nova-rota',
    type: 'proxy',
    upstreamId: state.upstreams[0]?.id,
    headers: BASIC_PROXY_HEADERS,
    timeouts: { connect: 5, read: 60, send: 60 },
    proxyBuffering: false,
  }
  return { ...state, routes: [...state.routes, newRoute] }
}

export const removeRoute = (state: NginxVisualState, routeId: string): NginxVisualState => ({
  ...state,
  routes: state.routes.filter((r) => r.id !== routeId),
})

export const addUpstream = (state: NginxVisualState): NginxVisualState => {
  const id = `upstream-${makeId()}`
  const newUpstream: UpstreamConfig = {
    id,
    name: id,
    method: 'least_conn',
    servers: [{ id: `srv-${makeId()}`, host: '127.0.0.1', port: 3000 }],
  }
  return { ...state, upstreams: [...state.upstreams, newUpstream] }
}

export const removeUpstream = (state: NginxVisualState, upstreamId: string): NginxVisualState => ({
  ...state,
  upstreams: state.upstreams.filter((u) => u.id !== upstreamId),
})

export const addServer = (state: NginxVisualState, upstreamId: string): NginxVisualState =>
  mutateUpstream(state, upstreamId, (u) => ({
    ...u,
    servers: [...u.servers, { id: `srv-${makeId()}`, host: '127.0.0.1', port: 3000 }],
  }))

export const removeServer = (
  state: NginxVisualState,
  upstreamId: string,
  serverId: string,
): NginxVisualState =>
  mutateUpstream(state, upstreamId, (u) => ({
    ...u,
    servers: u.servers.filter((s) => s.id !== serverId),
  }))

export const updateServer = (
  state: NginxVisualState,
  upstreamId: string,
  serverId: string,
  patch: Partial<UpstreamServer>,
): NginxVisualState =>
  mutateUpstream(state, upstreamId, (u) => ({
    ...u,
    servers: u.servers.map((s) => (s.id === serverId ? { ...s, ...patch } : s)),
  }))
