import { v4 as uuidv4 } from 'uuid'
import type { DomainNode, NginxConfigState } from '../types/nginxConfig'

export const createDefaultDomain = (name: string = 'example.com'): DomainNode => ({
  id: uuidv4(),
  type: 'domain',
  name,
  servers: [
    {
      id: uuidv4(),
      type: 'server',
      listenPort: 80,
      sslEnabled: false,
      serverName: name,
      locations: [
        {
          id: uuidv4(),
          type: 'location',
          path: '/',
          proxyPass: 'http://localhost:3000',
          websocket: false,
          cache: false,
          headers: {},
          timeout: 30,
          rules: [],
        },
      ],
      upstreams: [],
    },
  ],
})

export const createDefaultState = (): NginxConfigState => ({
  domains: [createDefaultDomain('example.com')],
})
