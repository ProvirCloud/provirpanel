import { io } from 'socket.io-client'

const baseUrl = import.meta.env.VITE_SOCKET_URL || window.location.origin
const getToken = (token) => token || localStorage.getItem('provirpanel-token') || undefined

export const createTerminalSocket = (token) => {
  return io(`${baseUrl}/api/terminal`, {
    auth: getToken(token) ? { token: getToken(token) } : undefined,
    withCredentials: true
  })
}

export const createDockerLogsSocket = (token) => {
  return io(`${baseUrl}/api/docker/logs`, {
    auth: getToken(token) ? { token: getToken(token) } : undefined,
    withCredentials: true
  })
}

export const createDockerProgressSocket = (token) => {
  return io(`${baseUrl}/api/docker/progress`, {
    auth: getToken(token) ? { token: getToken(token) } : undefined,
    withCredentials: true
  })
}

export const createDockerTerminalSocket = (token) => {
  return io(`${baseUrl}/api/docker/terminal`, {
    auth: getToken(token) ? { token: getToken(token) } : undefined,
    withCredentials: true
  })
}

export const createMetricsSocket = (token) => {
  return io(baseUrl, {
    auth: getToken(token) ? { token: getToken(token) } : undefined,
    withCredentials: true
  })
}

export const createNginxLogsSocket = (token) => {
  return io(`${baseUrl}/api/nginx/logs`, {
    auth: getToken(token) ? { token: getToken(token) } : undefined,
    withCredentials: true
  })
}

export const createAiChatSocket = (token) => {
  return io(`${baseUrl}/api/ai-chat`, {
    auth: getToken(token) ? { token: getToken(token) } : undefined,
    withCredentials: true,
    transports: ['websocket']
  })
}
