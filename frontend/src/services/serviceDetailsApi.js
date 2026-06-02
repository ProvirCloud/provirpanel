import api, { uploadApi } from './api.js'

const CHUNKED_UPLOAD_THRESHOLD_BYTES = 50 * 1024 * 1024
const UPLOAD_CHUNK_SIZE_BYTES = 25 * 1024 * 1024

const postUploadChunk = async (url, buildFormData, config = {}) => {
  let lastError = null
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await uploadApi.post(url, buildFormData(), config)
    } catch (err) {
      lastError = err
      if (attempt === 3) break
      await new Promise((resolve) => setTimeout(resolve, attempt * 500))
    }
  }
  throw lastError
}

const uploadFileInChunks = async ({
  serviceId,
  file,
  metadata = {},
  onProgress
}) => {
  const totalChunks = Math.ceil(file.size / UPLOAD_CHUNK_SIZE_BYTES)
  onProgress?.({
    status: 'initializing',
    phase: 'init',
    progress: 0,
    message: 'Inicializando upload em partes...'
  })
  const initResponse = await uploadApi.post(`/docker/services/${serviceId}/project-upload/init`, {
    ...metadata,
    filename: file.name,
    size: file.size,
    totalChunks
  })
  const uploadId = initResponse.data?.uploadId
  if (!uploadId) {
    throw new Error('Upload em partes não foi iniciado pelo servidor')
  }

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    const start = chunkIndex * UPLOAD_CHUNK_SIZE_BYTES
    const end = Math.min(start + UPLOAD_CHUNK_SIZE_BYTES, file.size)
    const chunk = file.slice(start, end)
    const uploadedBefore = start

    await postUploadChunk(
      `/docker/services/${serviceId}/project-upload/chunk`,
      () => {
        const formData = new FormData()
        formData.append('uploadId', uploadId)
        formData.append('chunkIndex', String(chunkIndex))
        formData.append('chunk', chunk, `${file.name}.part-${chunkIndex}`)
        return formData
      },
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (event) => {
          const loaded = uploadedBefore + (event.loaded || 0)
          const progress = Math.min(99, Math.round((loaded / file.size) * 100))
          onProgress?.({
            status: progress >= 99 ? 'processing' : 'uploading',
            phase: progress >= 99 ? 'process' : 'upload',
            progress,
            message:
              progress >= 99
                ? 'Arquivo enviado. Processando no servidor...'
                : `Enviando arquivo em partes (${chunkIndex + 1}/${totalChunks})...`,
            chunkIndex: chunkIndex + 1,
            totalChunks
          })
        }
      }
    )

    const progress = Math.min(99, Math.round((end / file.size) * 100))
    onProgress?.({
      status: progress >= 99 ? 'processing' : 'uploading',
      phase: progress >= 99 ? 'process' : 'upload',
      progress,
      message:
        progress >= 99
          ? 'Arquivo enviado. Processando no servidor...'
          : `Enviando arquivo em partes (${chunkIndex + 1}/${totalChunks})...`,
      chunkIndex: chunkIndex + 1,
      totalChunks
    })
  }

  return uploadApi.post(`/docker/services/${serviceId}/project-upload/complete`, { uploadId }, { timeout: 900000 })
}

const buildDeployFormData = ({ file, progressSessionId, envVars, healthcheck, autoRollback, versionMetadata, nodeServiceMode, nodeSiteConfig }) => {
  const formData = new FormData()
  formData.append('archive', file)
  if (progressSessionId) formData.append('progressSessionId', progressSessionId)
  if (Array.isArray(envVars)) formData.append('envVars', JSON.stringify(envVars))
  if (healthcheck) formData.append('healthcheck', JSON.stringify(healthcheck))
  if (autoRollback !== undefined) formData.append('autoRollback', String(!!autoRollback))
  if (versionMetadata) formData.append('versionMetadata', JSON.stringify(versionMetadata))
  if (nodeServiceMode) formData.append('nodeServiceMode', nodeServiceMode)
  if (nodeSiteConfig) formData.append('nodeSiteConfig', JSON.stringify(nodeSiteConfig))
  return formData
}

export const servicesApi = {
  async getById(serviceId) {
    const response = await api.get(`/docker/services/${serviceId}`)
    return response.data
  },

  async update(serviceId, payload) {
    const response = await api.put(`/docker/services/${serviceId}`, payload)
    return response.data
  },

  async start(serviceId) {
    const response = await api.post(`/docker/services/${serviceId}/start`)
    return response.data
  },

  async stop(serviceId) {
    const response = await api.post(`/docker/services/${serviceId}/stop`)
    return response.data
  },

  async restart(serviceId) {
    const response = await api.post(`/docker/services/${serviceId}/restart`)
    return response.data
  },

  async deployProjectArchive(serviceId, { file, ...options }, onProgress) {
    if (!file) throw new Error('Selecione um arquivo para publicar')
    const metadata = {}
    if (Array.isArray(options.envVars)) metadata.envVars = options.envVars
    if (options.healthcheck) metadata.healthcheck = options.healthcheck
    if (options.autoRollback !== undefined) metadata.autoRollback = !!options.autoRollback
    if (options.versionMetadata) metadata.versionMetadata = options.versionMetadata
    if (options.nodeServiceMode) metadata.nodeServiceMode = options.nodeServiceMode
    if (options.nodeSiteConfig) metadata.nodeSiteConfig = options.nodeSiteConfig
    if (options.progressSessionId) metadata.progressSessionId = options.progressSessionId

    onProgress?.({
      status: 'uploading',
      phase: 'upload',
      progress: 0,
      message: 'Subindo arquivos...'
    })

    if (file.size > CHUNKED_UPLOAD_THRESHOLD_BYTES) {
      return uploadFileInChunks({ serviceId, file, metadata, onProgress })
    }

    const formData = buildDeployFormData({ file, ...options })
    return uploadApi.post(`/docker/services/${serviceId}/project-upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (event) => {
        const total = event.total || 0
        const progress = total ? Math.round((event.loaded / total) * 100) : 0
        onProgress?.({
          status: total && event.loaded >= total ? 'processing' : 'uploading',
          phase: total && event.loaded >= total ? 'process' : 'upload',
          progress,
          message:
            total && event.loaded >= total
              ? 'Arquivo enviado. Processando no servidor...'
              : 'Subindo arquivos...'
        })
      },
      timeout: 900000
    })
  },

  async getDeployJob(serviceId, jobId) {
    const response = await api.get(`/docker/services/${serviceId}/project-upload/jobs/${jobId}`)
    return response.data
  },

  async listVersions(serviceId) {
    const response = await api.get(`/docker/services/${serviceId}/versions`)
    return response.data?.versions || []
  },

  async rollback(serviceId, versionId) {
    const response = await api.post(`/docker/services/${serviceId}/rollback`, { versionId })
    return response.data
  },

  async removeVersion(serviceId, versionId) {
    const response = await api.delete(`/docker/services/${serviceId}/versions/${versionId}`)
    return response.data
  },

  downloadVersionUrl(serviceId, versionId) {
    return `/api/docker/services/${serviceId}/versions/${versionId}/download`
  },

  async downloadVersion(serviceId, version) {
    const response = await api.get(`/docker/services/${serviceId}/versions/${version.id}/download`, {
      responseType: 'blob'
    })
    const disposition = response.headers?.['content-disposition'] || ''
    const filenameMatch = disposition.match(/filename="?([^"]+)"?/i)
    const filename = filenameMatch?.[1] || `${version.versionLabel || version.id || 'version'}.tar.gz`
    return { blob: response.data, filename }
  },

  async remove(serviceId, options = {}) {
    const response = await api.delete(`/docker/services/${serviceId}`, { data: options })
    return response.data
  }
}

export const serviceLogsApi = {
  async getLogs(serviceId, filters = {}) {
    const response = await api.get(`/docker/services/${serviceId}/logs`, { params: filters })
    return response.data
  }
}

export const serviceMetricsApi = {
  async getMetrics(serviceId, range = '15m') {
    const response = await api.get(`/docker/services/${serviceId}/metrics`, { params: { range } })
    return response.data?.metrics || response.data
  }
}

export const serviceActivityApi = {
  async list(serviceId, filters = {}) {
    const response = await api.get(`/docker/services/${serviceId}/activity`, { params: filters })
    return response.data?.events || []
  }
}

export const serviceEnvironmentApi = {
  async list(serviceId) {
    const payload = await servicesApi.getById(serviceId)
    return payload.service?.envVars || []
  },

  async upsert(serviceId, envVars, options = {}) {
    return servicesApi.update(serviceId, {
      envVars,
      apply: options.apply ?? false
    })
  },

  async remove(serviceId, key, currentEnvVars = [], options = {}) {
    const nextEnvVars = currentEnvVars.filter((env) => env.key !== key)
    return this.upsert(serviceId, nextEnvVars, options)
  }
}

export const githubDeliveryApi = {
  async status() {
    const response = await api.get('/ci-cd/github/status')
    return response.data
  },

  async connect({ token, label }) {
    const response = await api.post('/ci-cd/github/connect', { token, label })
    return response.data
  },

  async listRepositories(connectionId) {
    const response = await api.get('/ci-cd/github/repositories', {
      params: connectionId ? { connectionId } : {}
    })
    return response.data?.repositories || []
  },

  async listBranches({ connectionId, owner, repo }) {
    const response = await api.get(`/ci-cd/github/repositories/${owner}/${repo}/branches`, {
      params: connectionId ? { connectionId } : {}
    })
    return response.data?.branches || []
  },

  async analyze({ connectionId, owner, repo, branch }) {
    const response = await api.post('/ci-cd/github/analyze', {
      connectionId,
      owner,
      repo,
      branch
    })
    return response.data?.analysis || response.data
  },

  async createServiceFromBlueprint(payload) {
    const response = await api.post('/ci-cd/github/services/from-blueprint', payload)
    return response.data
  },

  async saveServiceDelivery(serviceId, payload) {
    const response = await api.put(`/ci-cd/github/services/${serviceId}/delivery`, payload)
    return response.data
  },

  async generateWorkflow(serviceId, payload) {
    const response = await api.post(`/ci-cd/github/services/${serviceId}/workflow`, payload)
    return response.data
  },

  async dispatchWorkflow(serviceId, payload = {}) {
    const response = await api.post(`/ci-cd/github/services/${serviceId}/workflow/dispatch`, payload)
    return response.data
  }
}
