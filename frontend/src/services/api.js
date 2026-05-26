import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('provirpanel-token')
  if (token) {
    config.headers = config.headers || {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Upload API — bypasses Cloudflare by using the server IP directly
// Uses the current page's IP (from window.location) with http:// protocol
const getUploadBaseUrl = () => {
  const host = window.location.hostname
  // If already accessing by IP, use same origin
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return `${window.location.protocol}//${host}/api`
  }
  // Use the same origin but force /api path (works if Cloudflare is DNS-only)
  // If Cloudflare proxy is active, this still goes through CF
  // Best approach: use the server IP from env or fallback to same origin
  const directIp = import.meta.env.VITE_SERVER_IP
  if (directIp) {
    return `http://${directIp}/api`
  }
  // Fallback: same origin (will go through CF if proxied)
  return '/api'
}

export const uploadApi = axios.create({
  baseURL: getUploadBaseUrl(),
  withCredentials: true,
  maxContentLength: Infinity,
  maxBodyLength: Infinity,
  timeout: 600000, // 10 min for large uploads
})

uploadApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('provirpanel-token')
  if (token) {
    config.headers = config.headers || {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

export default api
