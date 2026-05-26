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

// Upload API — same origin but with no size limits and long timeout
export const uploadApi = axios.create({
  baseURL: '/api',
  withCredentials: true,
  maxContentLength: Infinity,
  maxBodyLength: Infinity,
  timeout: 600000, // 10 min
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
