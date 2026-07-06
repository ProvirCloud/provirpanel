import { io } from 'socket.io-client'

const baseUrl = import.meta.env.VITE_SOCKET_URL || window.location.origin
const getToken = (token) => token || localStorage.getItem('provirpanel-token') || undefined

const socketOpts = (token) => ({
  auth: getToken(token) ? { token: getToken(token) } : undefined,
  withCredentials: true,
  transports: ['websocket']
})

export const createTerminalSocket = (token) => io(`${baseUrl}/api/terminal`, socketOpts(token))
export const createDockerLogsSocket = (token) => io(`${baseUrl}/api/docker/logs`, socketOpts(token))
export const createDockerProgressSocket = (token) => io(`${baseUrl}/api/docker/progress`, socketOpts(token))
export const createDockerTerminalSocket = (token) => io(`${baseUrl}/api/docker/terminal`, socketOpts(token))
export const createMetricsSocket = (token) => io(baseUrl, socketOpts(token))
export const createNginxLogsSocket = (token) => io(`${baseUrl}/api/nginx/logs`, socketOpts(token))
export const createAiChatSocket = (token) => io(`${baseUrl}/api/ai-chat`, socketOpts(token))
