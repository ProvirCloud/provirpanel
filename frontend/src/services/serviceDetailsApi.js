import api, { uploadApi } from './api.js'

const CHUNKED_UPLOAD_THRESHOLD_BYTES = 50 * 1024 * 1024
const UPLOAD_CHUNK_SIZE_BYTES = 25 * 1024 * 1024
const DEPLOY_UPLOAD_PROGRESS_CEILING = 30
const DEPLOY_PHASE_PROGRESS = {
  init: 0,
  upload: 18,
  process: 24,
  prepare: 34,
  extract: 46,
  candidate: 58,
  compile: 68,
  healthcheck: 80,
  cleanup: 86,
  promote: 92,
  rollback: 95,
  done: 100,
  error: 100
}

const clampProgress = (value, fallback = 0) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(0, Math.min(100, Math.round(number)))
}

const toUploadDeployProgress = (uploadPercent) =>
  clampProgress((clampProgress(uploadPercent) / 100) * DEPLOY_UPLOAD_PROGRESS_CEILING, 1)

const resolveDeployErrorMessage = (err) =>
  err?.response?.data?.message || err?.message || 'Falha na publicação'

const notifyDeployProgress = (onProgress, payload = {}) => {
  if (typeof onProgress !== 'function') return null
  const phase = payload.phase || 'process'
  const status =
    payload.status ||
    (phase === 'done' ? 'success' : phase === 'error' ? 'error' : 'processing')
  const fallbackProgress = DEPLOY_PHASE_PROGRESS[phase] ?? 0
  const progress = clampProgress(payload.progress ?? payload.progressPercent, fallbackProgress)
  const nextPayload = {
    ...payload,
    status,
    phase,
    progress,
    message: payload.message || 'Publicação em andamento...',
    updatedAt: payload.updatedAt || new Date().toISOString()
  }
  onProgress(nextPayload)
  return nextPayload
}

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
  notifyDeployProgress(onProgress, {
    status: 'initializing',
    phase: 'init',
    progress: 0,
    progressSessionId: metadata.progressSessionId,
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
          const uploadProgress = Math.min(100, Math.round((loaded / file.size) * 100))
          notifyDeployProgress(onProgress, {
            status: uploadProgress >= 100 ? 'processing' : 'uploading',
            phase: uploadProgress >= 100 ? 'process' : 'upload',
            progress: uploadProgress >= 100 ? DEPLOY_UPLOAD_PROGRESS_CEILING : toUploadDeployProgress(uploadProgress),
            uploadProgress,
            progressSessionId: metadata.progressSessionId,
            message:
              uploadProgress >= 100
                ? 'Arquivo enviado. Processando no servidor...'
                : `Enviando arquivo em partes (${chunkIndex + 1}/${totalChunks}) - ${uploadProgress}%`,
            chunkIndex: chunkIndex + 1,
            totalChunks
          })
        }
      }
    )

    const uploadProgress = Math.min(100, Math.round((end / file.size) * 100))
    notifyDeployProgress(onProgress, {
      status: uploadProgress >= 100 ? 'processing' : 'uploading',
      phase: uploadProgress >= 100 ? 'process' : 'upload',
      progress: uploadProgress >= 100 ? DEPLOY_UPLOAD_PROGRESS_CEILING : toUploadDeployProgress(uploadProgress),
      uploadProgress,
      progressSessionId: metadata.progressSessionId,
      message:
        uploadProgress >= 100
          ? 'Arquivo enviado. Processando no servidor...'
          : `Enviando arquivo em partes (${chunkIndex + 1}/${totalChunks}) - ${uploadProgress}%`,
      chunkIndex: chunkIndex + 1,
      totalChunks
    })
  }

  notifyDeployProgress(onProgress, {
    status: 'processing',
    phase: 'process',
    progress: DEPLOY_UPLOAD_PROGRESS_CEILING,
    uploadProgress: 100,
    progressSessionId: metadata.progressSessionId,
    message: 'Upload finalizado. Iniciando publicação no servidor...'
  })
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
    let lastProgress = 0
    const emitProgress = (payload = {}) => {
      const nextPayload = notifyDeployProgress(onProgress, {
        progressSessionId: options.progressSessionId,
        ...payload
      })
      if (nextPayload) lastProgress = nextPayload.progress
      return nextPayload
    }
    const metadata = {}
    if (Array.isArray(options.envVars)) metadata.envVars = options.envVars
    if (options.healthcheck) metadata.healthcheck = options.healthcheck
    if (options.autoRollback !== undefined) metadata.autoRollback = !!options.autoRollback
    if (options.versionMetadata) metadata.versionMetadata = options.versionMetadata
    if (options.nodeServiceMode) metadata.nodeServiceMode = options.nodeServiceMode
    if (options.nodeSiteConfig) metadata.nodeSiteConfig = options.nodeSiteConfig
    if (options.progressSessionId) metadata.progressSessionId = options.progressSessionId

    try {
      emitProgress({
        status: 'uploading',
        phase: 'upload',
        progress: 0,
        uploadProgress: 0,
        message: 'Subindo arquivos...'
      })

      if (file.size > CHUNKED_UPLOAD_THRESHOLD_BYTES) {
        const response = await uploadFileInChunks({ serviceId, file, metadata, onProgress: emitProgress })
        const job = response.data?.job || {}
        emitProgress({
          status: response.status === 202 || response.data?.accepted ? 'processing' : 'success',
          phase: response.status === 202 || response.data?.accepted ? job.phase || 'prepare' : 'done',
          progress: response.status === 202 || response.data?.accepted ? job.progressPercent ?? 34 : 100,
          uploadProgress: 100,
          jobId: response.data?.jobId || job.id,
          events: response.data?.progress || [],
          message: response.data?.message || 'Publicação recebida pelo servidor.'
        })
        return response
      }

      const formData = buildDeployFormData({ file, ...options })
      const fileSize = file.size || 1
      const response = await uploadApi.post(`/docker/services/${serviceId}/project-upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (event) => {
          const total = event.total || fileSize
          const uploadProgress = Math.min(100, Math.round((event.loaded / total) * 100))
          emitProgress({
            status: uploadProgress >= 100 ? 'processing' : 'uploading',
            phase: uploadProgress >= 100 ? 'process' : 'upload',
            progress: uploadProgress >= 100 ? DEPLOY_UPLOAD_PROGRESS_CEILING : toUploadDeployProgress(uploadProgress),
            uploadProgress,
            message:
              uploadProgress >= 100
                ? 'Arquivo enviado. Processando no servidor...'
                : `Enviando arquivo... ${uploadProgress}%`
          })
        },
        timeout: 900000
      })
      const job = response.data?.job || {}
      emitProgress({
        status: response.status === 202 || response.data?.accepted ? 'processing' : 'success',
        phase: response.status === 202 || response.data?.accepted ? job.phase || 'prepare' : 'done',
        progress: response.status === 202 || response.data?.accepted ? job.progressPercent ?? 34 : 100,
        uploadProgress: 100,
        jobId: response.data?.jobId || job.id,
        events: response.data?.progress || [],
        message: response.data?.message || 'Publicação recebida pelo servidor.'
      })
      return response
    } catch (err) {
      const message = resolveDeployErrorMessage(err)
      emitProgress({
        status: 'error',
        phase: 'error',
        progress: lastProgress || 1,
        message,
        error: message
      })
      throw err
    }
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
  },

  async aiAnalyze(serviceId, force = false) {
    const response = await api.post(`/docker/services/${serviceId}/ai-analyze`, { force })
    return response.data
  },

  async aiGetAnalysis(serviceId) {
    const response = await api.get(`/docker/services/${serviceId}/ai-analysis`)
    return response.data
  },

  async aiStartFix(serviceId, payload = {}) {
    const response = await api.post(`/docker/services/${serviceId}/ai-fix`, payload)
    return response.data
  },

  async aiGetFixJob(serviceId, jobId) {
    const response = await api.get(`/docker/services/${serviceId}/ai-fix/jobs/${jobId}`)
    return response.data
  },

  async aiChat(serviceId, question) {
    const response = await api.post(`/docker/services/${serviceId}/ai-chat`, { question })
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

  async removeConnection(connectionId) {
    const response = await api.delete(`/ci-cd/github/connections/${connectionId}`)
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
  },

  async getWorkflowRunStatus(serviceId) {
    const response = await api.get(`/ci-cd/github/services/${serviceId}/workflow/run-status`)
    return response.data
  },

  async smartBlueprint(serviceId) {
    const response = await api.post(`/ci-cd/github/services/${serviceId}/smart-blueprint`)
    return response.data
  },

  async aiValidate(serviceId, autoFix = true) {
    const response = await api.post(`/ci-cd/services/${serviceId}/ai-validate`, { autoFix })
    return response.data
  },

  async aiInfraAnalysis(serviceId) {
    const response = await api.post(`/ci-cd/services/${serviceId}/ai-infra-analysis`)
    return response.data
  },

  async aiApplyFixes(serviceId, fixes) {
    const response = await api.post(`/ci-cd/services/${serviceId}/ai-apply-fixes`, { fixes })
    return response.data
  },

  async aiProjectAnalysis(serviceId) {
    const response = await api.post(`/docker/services/${serviceId}/ai-project-analysis`)
    return response.data
  },

  async workflowFailed(serviceId, runId) {
    const response = await api.post(`/ci-cd/services/${serviceId}/workflow-failed`, { runId })
    return response.data
  },

  async aiChat(serviceId, message, history = []) {
    const response = await api.post(`/ci-cd/services/${serviceId}/ai-chat`, { message, history }, { timeout: 120000 })
    return response.data
  },

  aiChatStream(serviceId, message, history = []) {
    const token = localStorage.getItem('provirpanel-token')
    const baseURL = api.defaults.baseURL || '/api'
    return fetch(`${baseURL}/ci-cd/services/${serviceId}/ai-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ message, history, stream: true })
    })
  },

  async aiChatReindex(serviceId) {
    const response = await api.post(`/ci-cd/services/${serviceId}/ai-chat/reindex`)
    return response.data
  }
}
