import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true
})

api.interceptors.request.use((config) => {
  return config
})

export default api
