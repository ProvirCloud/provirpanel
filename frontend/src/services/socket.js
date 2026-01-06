import { io } from 'socket.io-client'

const baseUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000'

export const createTerminalSocket = (token) => {
  if (!token) {
    return null
  }
  return io(`${baseUrl}/api/terminal`, {
    auth: { token }
  })
}

export const createDockerLogsSocket = (token) => {
  if (!token) {
    return null
  }
  return io(`${baseUrl}/api/docker/logs`, {
    auth: { token }
  })
}

export const createDockerProgressSocket = (token) => {
  if (!token) {
    return null
  }
  return io(`${baseUrl}/api/docker/progress`, {
    auth: { token }
  })
}

export const createMetricsSocket = (token) => {
  if (!token) {
    return null
  }
  return io(baseUrl, {
    auth: { token }
  })
}
