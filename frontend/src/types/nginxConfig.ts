// ─── Nginx Config Visual Editor Types ────────────────────────────────────

export type RuleNode = {
  id: string
  type: 'rule'
  condition: string
  action: string
}

export type UpstreamNode = {
  id: string
  type: 'upstream'
  name: string
  servers: Array<{ host: string; port: number; weight?: number; backup?: boolean }>
  method?: 'round_robin' | 'least_conn' | 'ip_hash'
}

export type LocationNode = {
  id: string
  type: 'location'
  path: string
  proxyPass?: string
  upstreamId?: string
  websocket?: boolean
  cache?: boolean
  headers?: Record<string, string>
  timeout?: number // seconds
  rules?: RuleNode[]
}

export type ServerNode = {
  id: string
  type: 'server'
  listenPort: number
  sslEnabled: boolean
  sslCert?: string
  sslKey?: string
  serverName: string
  locations: LocationNode[]
  upstreams: UpstreamNode[]
}

export type DomainNode = {
  id: string
  type: 'domain'
  name: string
  servers: ServerNode[]
}

export type NginxConfigState = {
  domains: DomainNode[]
}

export type SelectionPath = {
  domainId?: string
  serverId?: string
  locationId?: string
  upstreamId?: string
  ruleId?: string
}
