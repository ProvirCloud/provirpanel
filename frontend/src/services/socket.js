import { io } from 'socket.io-client'

const baseUrl = import.meta.env.VITE_SOCKET_URL || window.location.origin

export const createTerminalSocket = (token) => {
  return io(`${baseUrl}/api/terminal`, {
    auth: token ? { token } : undefined,
    withCredentials: true
  })
}

export const createDockerLogsSocket = (token) => {
  return io(`${baseUrl}/api/docker/logs`, {
    auth: token ? { token } : undefined,
    withCredentials: true
  })
}

export const createDockerProgressSocket = (token) => {
  return io(`${baseUrl}/api/docker/progress`, {
    auth: token ? { token } : undefined,
    withCredentials: true
  })
}

export const createMetricsSocket = (token) => {
  return io(baseUrl, {
    auth: token ? { token } : undefined,
    withCredentials: true
  })
}

export const createNginxLogsSocket = (token) => {
  return io(`${baseUrl}/api/nginx/logs`, {
    auth: token ? { token } : undefined,
    withCredentials: true
  })
}
