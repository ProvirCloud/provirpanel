import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Folder,
  FileText,
  Image,
  FileCode,
  FileArchive,
  UploadCloud,
  Plus,
  Trash2,
  Download,
  ChevronRight,
  Copy,
  Settings2,
  Database,
  Save,
  X,
} from 'lucide-react'
import Editor from '@monaco-editor/react'
import api from '../services/api.js'
import { createMetricsSocket } from '../services/socket.js'

const ARCHIVE_SUFFIXES = ['.tar.gz', '.tgz', '.tar', '.zip']
const STORAGE_ACTIONS = ['list', 'read', 'write', 'delete', 'create', 'move', 'upload', 'download', 'copy', 'preview']

const isArchiveName = (name) => {
  const lowerName = String(name || '').toLowerCase()
  return ARCHIVE_SUFFIXES.some((suffix) => lowerName.endsWith(suffix))
}

const iconFor = (name, isDir) => {
  if (isDir) return Folder
  const ext = name.split('.').pop().toLowerCase()
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return Image
  if (['js', 'jsx', 'ts', 'tsx', 'json', 'yml', 'yaml', 'md'].includes(ext)) return FileCode
  if (isArchiveName(name) || ext === 'gz') return FileArchive
  return FileText
}

const emptyEnvironmentForm = {
  id: null,
  name: '',
  provider: 'local',
  isActive: true,
  config: {},
  permissions: {
    admin: [...STORAGE_ACTIONS],
    dev: ['list', 'read', 'write', 'create', 'move', 'upload', 'download', 'copy', 'preview'],
    viewer: ['list', 'read', 'download', 'preview'],
  },
}

const formatProviderStatus = (status) => {
  if (status === 'active') return 'Ativo'
  if (status === 'planned') return 'Planejado'
  return status || 'n/a'
}

const renderInPortal = (content) => {
  if (typeof document === 'undefined') {
    return content
  }
  return createPortal(content, document.body)
}

const getProviderMeta = (catalog, providerId) => catalog.find((provider) => provider.id === providerId) || null

const FileManager = ({ showPageIntro = true }) => {
  const [providerCatalog, setProviderCatalog] = useState([])
  const [environments, setEnvironments] = useState([])
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState('')
  const [tree, setTree] = useState([])
  const [items, setItems] = useState([])
  const [path, setPath] = useState('/')
  const [selected, setSelected] = useState(null)
  const [preview, setPreview] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewType, setPreviewType] = useState('')
  const [loading, setLoading] = useState(false)
  const [usage, setUsage] = useState({ used: 0, total: 0 })
  const [toast, setToast] = useState('')
  const [editorFile, setEditorFile] = useState(null)
  const [editorContent, setEditorContent] = useState('')
  const [editorLoading, setEditorLoading] = useState(false)
  const [editorLanguage, setEditorLanguage] = useState('plaintext')
  const [menuItem, setMenuItem] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [showRename, setShowRename] = useState(false)
  const [showMove, setShowMove] = useState(false)
  const [moveTarget, setMoveTarget] = useState('/')
  const [dragItem, setDragItem] = useState(null)
  const [extractingPath, setExtractingPath] = useState('')
  const [showEnvironmentModal, setShowEnvironmentModal] = useState(false)
  const [environmentForm, setEnvironmentForm] = useState(emptyEnvironmentForm)
  const [showCopyModal, setShowCopyModal] = useState(false)
  const [copyTargetEnvironmentId, setCopyTargetEnvironmentId] = useState('')
  const [copyTargetPath, setCopyTargetPath] = useState('/')
  const [unsupportedEnvironmentMessage, setUnsupportedEnvironmentMessage] = useState('')
  const uploadRef = useRef(null)
  const socketRef = useRef(null)

  const selectedEnvironment = environments.find((environment) => environment.id === selectedEnvironmentId) || null
  const selectedProviderMeta = providerCatalog.find((provider) => provider.id === environmentForm.provider)
  const canManageEnvironments = true

  const requestConfig = (environmentId) => ({ params: { environmentId } })
  const findEnvironmentById = (environmentId, environmentList = environments) =>
    environmentList.find((environment) => environment.id === environmentId) || null

  const loadProvidersAndEnvironments = async (preferredEnvironmentId = null) => {
    const response = await api.get('/storage/providers')
    const nextCatalog = response.data.catalog || []
    const nextEnvironments = (response.data.environments || []).filter((environment) => environment.isActive !== false)
    setProviderCatalog(nextCatalog)
    setEnvironments(nextEnvironments)

    const nextEnvironmentId =
      preferredEnvironmentId ||
      selectedEnvironmentId ||
      nextEnvironments[0]?.id ||
      ''

    if (nextEnvironmentId) {
      setSelectedEnvironmentId(nextEnvironmentId)
      return {
        environmentId: nextEnvironmentId,
        catalog: nextCatalog,
        environments: nextEnvironments,
      }
    }
    return {
      environmentId: '',
      catalog: nextCatalog,
      environments: nextEnvironments,
    }
  }

  const loadTree = async (environmentId) => {
    const response = await api.get('/storage/tree', requestConfig(environmentId))
    setTree(response.data.tree || [])
    if (Array.isArray(response.data.environments) && response.data.environments.length > 0) {
      setEnvironments(response.data.environments)
    }
  }

  const loadItems = async (environmentId, targetPath) => {
    setLoading(true)
    try {
      const response = await api.get('/storage', { params: { environmentId, path: targetPath } })
      setItems(response.data.items || [])
      setPath(targetPath)
      setSelected(null)
      setPreview(null)
      setPreviewUrl('')
    } catch (err) {
      setToast(err.response?.data?.message || 'Erro ao carregar arquivos')
    } finally {
      setLoading(false)
    }
  }

  const loadStats = async (environmentId) => {
    try {
      const response = await api.get('/storage/stats', requestConfig(environmentId))
      setUsage({
        used: response.data?.stats?.used || 0,
        total: response.data?.stats?.total || 0,
      })
    } catch {
      setUsage({ used: 0, total: 0 })
    }
  }

  const refreshEnvironment = async (
    environmentId,
    targetPath = path,
    options = {}
  ) => {
    if (!environmentId) return
    const catalog = options.catalog || providerCatalog
    const environmentList = options.environments || environments
    const environment = findEnvironmentById(environmentId, environmentList)
    const providerMeta = getProviderMeta(catalog, environment?.provider)
    if (providerMeta && providerMeta.status !== 'active') {
      setTree([])
      setItems([])
      setPath(targetPath)
      setSelected(null)
      setPreview(null)
      setPreviewUrl('')
      setUsage({ used: 0, total: 0 })
      setUnsupportedEnvironmentMessage(`O provider ${providerMeta.label} ainda não está habilitado neste painel.`)
      return
    }
    setUnsupportedEnvironmentMessage('')
    await Promise.all([
      loadTree(environmentId),
      loadItems(environmentId, targetPath),
      loadStats(environmentId),
    ])
  }

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const loaded = await loadProvidersAndEnvironments()
        if (!active || !loaded.environmentId) return
        await refreshEnvironment(loaded.environmentId, '/', loaded)
      } catch (err) {
        if (active) {
          setToast(err.response?.data?.message || 'Erro ao carregar storages')
        }
      }
    })()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    socketRef.current = createMetricsSocket()
    const socket = socketRef.current
    socket.on('metrics', (payload) => {
      setUsage({
        used: payload?.disk?.used || 0,
        total: payload?.disk?.total || 0,
      })
    })
    return () => {
      socket.off('metrics')
      socket.disconnect()
    }
  }, [])

  useEffect(() => {
    let active = true
    if (!selectedEnvironmentId) return undefined

    refreshEnvironment(selectedEnvironmentId, '/').catch((err) => {
      if (active) {
        const status = err.response?.status
        const message = err.response?.data?.message || 'Erro ao carregar ambiente'
        if (status === 501) {
          setUnsupportedEnvironmentMessage(message)
        } else {
          setToast(message)
        }
      }
    })
    return () => {
      active = false
    }
  }, [selectedEnvironmentId, providerCatalog, environments])

  const breadcrumbs = path.split('/').filter(Boolean)

  const openItem = (item) => {
    if (item.isDir) {
      loadItems(selectedEnvironmentId, item.path)
      return
    }
    if (item.isImage) {
      setPreview(item)
      setPreviewUrl('')
      setEditorFile(null)
      setPreviewType('image')
      return
    }

    setPreview(null)
    setPreviewUrl('')
    setPreviewType('')
    const ext = item.name.startsWith('.') ? item.name.slice(1).toLowerCase() : item.name.split('.').pop().toLowerCase()
    if (ext === 'pdf') {
      setPreview(item)
      setPreviewType('pdf')
      return
    }
    if (['mp3', 'wav', 'ogg', 'flac'].includes(ext)) {
      setPreview(item)
      setPreviewType('audio')
      return
    }
    if (['mp4', 'webm', 'avi', 'mkv'].includes(ext)) {
      setPreview(item)
      setPreviewType('video')
      return
    }

    const languageMap = {
      js: 'javascript',
      jsx: 'javascript',
      ts: 'typescript',
      tsx: 'typescript',
      json: 'json',
      html: 'html',
      css: 'css',
      sql: 'sql',
      xml: 'xml',
      py: 'python',
      rb: 'ruby',
      php: 'php',
      java: 'java',
      go: 'go',
      rs: 'rust',
      c: 'c',
      h: 'c',
      hpp: 'cpp',
      cpp: 'cpp',
      yml: 'yaml',
      yaml: 'yaml',
      md: 'markdown',
      sh: 'shell',
      kt: 'kotlin',
      kts: 'kotlin',
      toml: 'toml',
      ini: 'ini',
      conf: 'ini',
      properties: 'ini',
    }
    setEditorFile(item)
    setEditorLanguage(languageMap[ext] || 'plaintext')
  }

  useEffect(() => {
    let active = true
    if (!editorFile?.path || !selectedEnvironmentId) return undefined
    setEditorLoading(true)
    api
      .get('/storage/file', { params: { environmentId: selectedEnvironmentId, path: editorFile.path } })
      .then((response) => {
        if (!active) return
        setEditorContent(response.data.content || '')
      })
      .catch((err) => {
        if (active) setToast(err.response?.data?.message || 'Erro ao carregar arquivo')
      })
      .finally(() => {
        if (active) setEditorLoading(false)
      })
    return () => {
      active = false
    }
  }, [editorFile, selectedEnvironmentId])

  const saveEditor = async () => {
    if (!editorFile || !selectedEnvironmentId) return
    try {
      await api.put('/storage/file', { environmentId: selectedEnvironmentId, path: editorFile.path, content: editorContent })
      setToast('Arquivo salvo')
      await loadItems(selectedEnvironmentId, path)
    } catch (err) {
      setToast(err.response?.data?.message || 'Erro ao salvar arquivo')
    }
  }

  useEffect(() => {
    let active = true
    if (!preview?.path || !selectedEnvironmentId) return undefined
    const endpoint =
      previewType === 'pdf'
        ? '/storage/pdf'
        : previewType === 'audio' || previewType === 'video'
          ? '/storage/media'
          : '/storage/preview'
    api
      .get(endpoint, {
        params: { environmentId: selectedEnvironmentId, path: preview.path },
        responseType: 'arraybuffer',
      })
      .then((response) => {
        if (!active) return
        const mime =
          previewType === 'pdf'
            ? 'application/pdf'
            : response.headers['content-type'] || 'application/octet-stream'
        const url = URL.createObjectURL(new Blob([response.data], { type: mime }))
        setPreviewUrl(url)
      })
      .catch(() => {
        if (active) setPreviewUrl('')
      })
    return () => {
      active = false
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [preview, previewType, selectedEnvironmentId])

  const handleUpload = async (files) => {
    if (!files?.length || !selectedEnvironmentId) return
    const formData = new FormData()
    Array.from(files).forEach((file) => formData.append('files', file))
    formData.append('path', path)
    formData.append('environmentId', selectedEnvironmentId)
    try {
      await api.post('/storage/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setToast('Upload concluído')
      await refreshEnvironment(selectedEnvironmentId, path)
    } catch (err) {
      setToast(err.response?.data?.message || 'Erro no upload')
    }
  }

  const handleCreate = async (type) => {
    if (!selectedEnvironmentId) return
    const name = prompt(`Nome do ${type === 'folder' ? 'pasta' : 'arquivo'}`)
    if (!name) return
    try {
      await api.post('/storage/create', { environmentId: selectedEnvironmentId, path, name, type })
      setToast('Criado com sucesso')
      await refreshEnvironment(selectedEnvironmentId, path)
    } catch (err) {
      setToast(err.response?.data?.message || 'Erro ao criar')
    }
  }

  const handleDelete = async (item = selected) => {
    if (!item || !selectedEnvironmentId) return
    try {
      await api.delete('/storage', { params: { environmentId: selectedEnvironmentId, path: item.path } })
      setToast('Removido')
      setSelected(null)
      await refreshEnvironment(selectedEnvironmentId, path)
    } catch (err) {
      setToast(err.response?.data?.message || 'Erro ao remover')
    }
  }

  const handleDownload = async (item = selected) => {
    if (!item || item.isDir || !selectedEnvironmentId) return
    window.open(`${api.defaults.baseURL}/storage/download?environmentId=${encodeURIComponent(selectedEnvironmentId)}&path=${encodeURIComponent(item.path)}`)
  }

  const handleExtract = async (item = selected) => {
    if (!item || item.isDir || !isArchiveName(item.name) || !selectedEnvironmentId) return
    setExtractingPath(item.path)
    try {
      const response = await api.post('/storage/extract', { environmentId: selectedEnvironmentId, path: item.path })
      setToast(`Descompactado em ${response.data?.extracted?.path || path}`)
      setMenuItem(null)
      await refreshEnvironment(selectedEnvironmentId, path)
    } catch (err) {
      setToast(err.response?.data?.message || 'Erro ao descompactar')
    } finally {
      setExtractingPath('')
    }
  }

  const handleRename = async () => {
    if (!menuItem || !renameValue.trim() || !selectedEnvironmentId) return
    const basePath = menuItem.path.split('/').slice(0, -1).join('/') || '/'
    const targetPath = `${basePath}/${renameValue}`.replace(/\/+/g, '/')
    try {
      await api.post('/storage/move', { environmentId: selectedEnvironmentId, fromPath: menuItem.path, toPath: targetPath })
      setToast('Renomeado')
      setShowRename(false)
      setMenuItem(null)
      await refreshEnvironment(selectedEnvironmentId, path)
    } catch (err) {
      setToast(err.response?.data?.message || 'Erro ao renomear')
    }
  }

  const handleMove = async () => {
    if (!menuItem || !moveTarget || !selectedEnvironmentId) return
    const targetPath = `${moveTarget}/${menuItem.name}`.replace(/\/+/g, '/')
    try {
      await api.post('/storage/move', { environmentId: selectedEnvironmentId, fromPath: menuItem.path, toPath: targetPath })
      setToast('Movido')
      setShowMove(false)
      setMenuItem(null)
      await refreshEnvironment(selectedEnvironmentId, path)
    } catch (err) {
      setToast(err.response?.data?.message || 'Erro ao mover')
    }
  }

  const openCreateEnvironment = () => {
    setEnvironmentForm(emptyEnvironmentForm)
    setShowEnvironmentModal(true)
  }

  const openEditEnvironment = () => {
    if (!selectedEnvironment) return
    setEnvironmentForm({
      id: selectedEnvironment.id,
      name: selectedEnvironment.name,
      provider: selectedEnvironment.provider,
      isActive: selectedEnvironment.isActive !== false,
      config: { ...(selectedEnvironment.config || {}) },
      permissions: {
        admin: [...(selectedEnvironment.permissions?.admin || [])],
        dev: [...(selectedEnvironment.permissions?.dev || [])],
        viewer: [...(selectedEnvironment.permissions?.viewer || [])],
      },
    })
    setShowEnvironmentModal(true)
  }

  const saveEnvironment = async () => {
    try {
      if (environmentForm.id) {
        await api.put(`/storage/environments/${environmentForm.id}`, environmentForm)
      } else {
        await api.post('/storage/environments', environmentForm)
      }
      const loaded = await loadProvidersAndEnvironments(environmentForm.id || selectedEnvironmentId)
      await refreshEnvironment(loaded.environmentId || selectedEnvironmentId, '/', loaded)
      setShowEnvironmentModal(false)
      setToast('Ambiente salvo')
    } catch (err) {
      setToast(err.response?.data?.message || 'Erro ao salvar ambiente')
    }
  }

  const deleteEnvironment = async () => {
    if (!environmentForm.id) return
    try {
      await api.delete(`/storage/environments/${environmentForm.id}`)
      const loaded = await loadProvidersAndEnvironments()
      if (loaded.environmentId) {
        await refreshEnvironment(loaded.environmentId, '/', loaded)
      }
      setShowEnvironmentModal(false)
      setToast('Ambiente removido')
    } catch (err) {
      setToast(err.response?.data?.message || 'Erro ao remover ambiente')
    }
  }

  const togglePermission = (role, action) => {
    setEnvironmentForm((current) => {
      const roleActions = current.permissions[role] || []
      const nextActions = roleActions.includes(action)
        ? roleActions.filter((item) => item !== action)
        : [...roleActions, action]
      return {
        ...current,
        permissions: {
          ...current.permissions,
          [role]: nextActions,
        },
      }
    })
  }

  const handleCrossEnvironmentCopy = async () => {
    if (!selected || !copyTargetEnvironmentId) return
    try {
      await api.post('/storage/copy', {
        sourceEnvironmentId: selectedEnvironmentId,
        sourcePath: selected.path,
        targetEnvironmentId: copyTargetEnvironmentId,
        targetPath: copyTargetPath,
      })
      setToast('Arquivo copiado entre ambientes')
      setShowCopyModal(false)
    } catch (err) {
      setToast(err.response?.data?.message || 'Erro ao copiar arquivo')
    }
  }

  const usagePercent = usage.total ? Math.round((usage.used / usage.total) * 100) : 0

  return (
    <div className="space-y-6">
      <div className={`flex flex-wrap gap-4 ${showPageIntro ? 'items-center justify-between' : 'items-center justify-end'}`}>
        {showPageIntro ? (
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Storage Hub</p>
            <h2 className="text-2xl font-semibold text-white">Gerenciador multi-storage</h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">
              Ambientes locais e conectores multi-cloud operando com a mesma UX de arquivos, permissões por ambiente e cópia entre hubs.
            </p>
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <button
            className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-200 transition hover:border-blue-500/60"
            onClick={openCreateEnvironment}
            disabled={!canManageEnvironments}
          >
            <Database className="h-4 w-4" />
            Novo ambiente
          </button>
          <button
            className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-200 transition hover:border-blue-500/60"
            onClick={openEditEnvironment}
            disabled={!selectedEnvironment}
          >
            <Settings2 className="h-4 w-4" />
            Configurar ambiente
          </button>
          <button
            className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-200 transition hover:border-blue-500/60"
            onClick={() => uploadRef.current?.click()}
            disabled={!selectedEnvironment || !!unsupportedEnvironmentMessage}
          >
            <UploadCloud className="h-4 w-4" />
            Upload
          </button>
          <button
            className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-200 transition hover:border-blue-500/60"
            onClick={() => handleCreate('file')}
            disabled={!selectedEnvironment || !!unsupportedEnvironmentMessage}
          >
            <Plus className="h-4 w-4" />
            Novo arquivo
          </button>
          <button
            className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-200 transition hover:border-blue-500/60"
            onClick={() => handleCreate('folder')}
            disabled={!selectedEnvironment || !!unsupportedEnvironmentMessage}
          >
            <Plus className="h-4 w-4" />
            Nova pasta
          </button>
          <button
            className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-200 transition hover:border-blue-500/60"
            onClick={() => setShowCopyModal(true)}
            disabled={!selected || selected?.isDir || !!unsupportedEnvironmentMessage}
          >
            <Copy className="h-4 w-4" />
            Copiar
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
        <div className="flex flex-wrap gap-2">
          {environments.map((environment) => (
            <button
              key={environment.id}
              className={`rounded-xl border px-4 py-2 text-sm ${
                selectedEnvironmentId === environment.id
                  ? 'border-cyan-400/60 bg-cyan-500/10 text-cyan-100'
                  : 'border-slate-800 bg-slate-950 text-slate-300'
              }`}
              onClick={() => setSelectedEnvironmentId(environment.id)}
            >
              <div className="text-left">
                <p className="font-medium">{environment.name}</p>
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{environment.provider}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-xs text-slate-300">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-slate-500">Ambiente ativo:</span>{' '}
            <span className="text-blue-200">{selectedEnvironment?.name || 'n/a'}</span>
            <span className="ml-3 text-slate-500">Provider:</span>{' '}
            <span className="text-slate-200">{selectedEnvironment?.provider || 'n/a'}</span>
          </div>
          <div>
            <span>Uso de disco local: </span>
            <span className="text-blue-200">
              {usagePercent}% ({(usage.used / 1024 / 1024 / 1024).toFixed(1)} GB de {(usage.total / 1024 / 1024 / 1024).toFixed(1)} GB)
            </span>
          </div>
        </div>
      </div>

      {unsupportedEnvironmentMessage ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-4 text-sm text-amber-100">
          <p className="font-medium">Ambiente configurado, mas não operacional ainda</p>
          <p className="mt-2 text-amber-200/90">{unsupportedEnvironmentMessage}</p>
          <p className="mt-2 text-xs text-amber-200/80">
            Você pode manter a configuração e permissões salvas, mas listagem, edição, upload e cópia só funcionarão quando o conector deste provider for implementado.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Pastas</p>
          <div className="mt-4 space-y-2 text-sm text-slate-200">
            {tree.length === 0 && <p className="text-xs text-slate-500">Sem dados</p>}
            {tree.map((node) => (
              <button
                key={node.path}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-slate-800/60"
                onClick={() => loadItems(selectedEnvironmentId, node.path)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault()
                  if (!dragItem || !selectedEnvironmentId) return
                  api.post('/storage/move', {
                    environmentId: selectedEnvironmentId,
                    fromPath: dragItem.path,
                    toPath: `${node.path}/${dragItem.name}`.replace(/\/+/g, '/'),
                  }).then(async () => {
                    setToast('Movido')
                    setDragItem(null)
                    await refreshEnvironment(selectedEnvironmentId, path)
                  }).catch((err) => setToast(err.response?.data?.message || 'Erro ao mover'))
                }}
              >
                <Folder className="h-4 w-4 text-blue-300" />
                {node.name}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
            <button
              className="rounded-full border border-slate-800 bg-slate-950 px-3 py-1 text-blue-200"
              onClick={() => loadItems(selectedEnvironmentId, '/')}
            >
              root
            </button>
            {breadcrumbs.map((crumb, index) => {
              const crumbPath = `/${breadcrumbs.slice(0, index + 1).join('/')}`
              return (
                <div key={crumbPath} className="flex items-center gap-2">
                  <ChevronRight className="h-3 w-3 text-slate-500" />
                  <button
                    className="rounded-full border border-slate-800 bg-slate-950 px-3 py-1 hover:border-blue-500/60"
                    onClick={() => loadItems(selectedEnvironmentId, crumbPath)}
                  >
                    {crumb}
                  </button>
                </div>
              )
            })}
          </div>

          <div
            className="mt-4 rounded-xl border border-dashed border-slate-700 bg-slate-950/60 p-4 text-center text-xs text-slate-400"
            onDragOver={(event) => {
              if (unsupportedEnvironmentMessage) return
              event.preventDefault()
            }}
            onDrop={(event) => {
              if (unsupportedEnvironmentMessage) return
              event.preventDefault()
              handleUpload(event.dataTransfer.files)
            }}
          >
            Arraste arquivos aqui ou use o botão Upload
          </div>

          <div className="mt-4 grid gap-2">
            {items.map((item) => {
              const Icon = iconFor(item.name, item.isDir)
              return (
                <div
                  key={item.path}
                  className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm ${
                    selected?.path === item.path
                      ? 'border-blue-500/60 bg-blue-500/10'
                      : 'border-slate-800 bg-slate-950'
                  }`}
                  onClick={() => setSelected(item)}
                  onDoubleClick={() => openItem(item)}
                  draggable
                  onDragStart={() => setDragItem(item)}
                  onDragOver={(event) => {
                    if (!item.isDir) return
                    event.preventDefault()
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    if (!item.isDir || !dragItem || !selectedEnvironmentId) return
                    api.post('/storage/move', {
                      environmentId: selectedEnvironmentId,
                      fromPath: dragItem.path,
                      toPath: `${item.path}/${dragItem.name}`.replace(/\/+/g, '/'),
                    }).then(async () => {
                      setToast('Movido')
                      setDragItem(null)
                      await refreshEnvironment(selectedEnvironmentId, path)
                    }).catch((err) => setToast(err.response?.data?.message || 'Erro ao mover'))
                  }}
                >
                  <div className="flex items-center gap-3">
                    <Icon className="h-4 w-4 text-blue-300" />
                    <div>
                      <p className="text-slate-200">{item.name}</p>
                      <p className="text-xs text-slate-500">{item.isDir ? 'Pasta' : `${item.size} bytes`}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">{item.modifiedAt}</span>
                    <button
                      className="rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-[10px] text-slate-300"
                      onClick={(event) => {
                        event.stopPropagation()
                        setMenuItem(item)
                      }}
                    >
                      Opções
                    </button>
                  </div>
                </div>
              )
            })}
            {items.length === 0 && <p className="text-xs text-slate-500">{loading ? 'Carregando...' : 'Sem arquivos'}</p>}
          </div>
        </div>
      </div>

      {preview && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Preview</p>
          <div className="mt-3 flex justify-center rounded-xl bg-slate-950 p-4">
            {previewUrl ? (
              previewType === 'pdf' ? (
                <iframe title={preview.name} src={previewUrl} className="h-[480px] w-full rounded-lg bg-slate-950" />
              ) : previewType === 'audio' ? (
                <audio controls className="w-full"><source src={previewUrl} /></audio>
              ) : previewType === 'video' ? (
                <video controls className="h-[420px] w-full rounded-lg bg-black"><source src={previewUrl} /></video>
              ) : (
                <img src={previewUrl} alt={preview.name} className="max-h-72 rounded-lg object-contain" />
              )
            ) : (
              <span className="text-xs text-slate-500">Carregando preview...</span>
            )}
          </div>
        </div>
      )}

      {editorFile && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Editor</p>
              <p className="text-sm text-slate-200">{editorFile.name}</p>
            </div>
            <div className="flex gap-2">
              <button className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-1 text-xs text-slate-200" onClick={saveEditor} disabled={editorLoading}>
                Salvar
              </button>
              <button className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-1 text-xs text-slate-200" onClick={() => setEditorFile(null)}>
                Fechar
              </button>
            </div>
          </div>
          <div className="mt-3 h-[420px] overflow-hidden rounded-xl border border-slate-800">
            {editorLoading ? (
              <div className="flex h-full items-center justify-center text-xs text-slate-500">Carregando editor...</div>
            ) : (
              <Editor
                height="100%"
                theme="vs-dark"
                value={editorContent}
                language={editorLanguage}
                onChange={(value) => setEditorContent(value || '')}
                options={{ minimap: { enabled: false }, fontSize: 13, wordWrap: 'on' }}
              />
            )}
          </div>
        </div>
      )}

      {menuItem && renderInPortal(
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900/90 p-5">
            <h3 className="text-sm font-semibold text-slate-100">{menuItem.name}</h3>
            <div className="mt-4 space-y-2 text-sm text-slate-200">
              <button className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-left" onClick={() => { setRenameValue(menuItem.name); setShowRename(true); setShowMove(false) }}>
                Renomear
              </button>
              <button className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-left" onClick={() => { setShowMove(true); setShowRename(false) }}>
                Mover
              </button>
              {!menuItem.isDir && (
                <button className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-left" onClick={() => setShowCopyModal(true)}>
                  Copiar para outro ambiente
                </button>
              )}
              {!menuItem.isDir && isArchiveName(menuItem.name) && (
                <button className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-left" onClick={() => handleExtract(menuItem)} disabled={extractingPath === menuItem.path}>
                  {extractingPath === menuItem.path ? 'Descompactando...' : 'Descompactar'}
                </button>
              )}
              <button className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-left" onClick={() => { handleDownload(menuItem); setMenuItem(null) }}>
                Download
              </button>
              <button className="w-full rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-left text-rose-200" onClick={() => { handleDelete(menuItem); setMenuItem(null) }}>
                Delete
              </button>
              <button className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-left" onClick={() => setMenuItem(null)}>
                Fechar
              </button>
            </div>

            {showRename && (
              <div className="mt-4 space-y-2">
                <input className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-100" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} />
                <div className="flex gap-2">
                  <button className="rounded-lg bg-blue-500 px-3 py-2 text-xs font-semibold text-slate-950" onClick={handleRename}>Salvar</button>
                  <button className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200" onClick={() => setShowRename(false)}>Cancelar</button>
                </div>
              </div>
            )}

            {showMove && (
              <div className="mt-4 space-y-2">
                <input className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-100" placeholder="/nova/pasta" value={moveTarget} onChange={(event) => setMoveTarget(event.target.value)} />
                <div className="flex gap-2">
                  <button className="rounded-lg bg-blue-500 px-3 py-2 text-xs font-semibold text-slate-950" onClick={handleMove}>Mover</button>
                  <button className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200" onClick={() => setShowMove(false)}>Cancelar</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showEnvironmentModal && renderInPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-4xl rounded-3xl border border-slate-800 bg-slate-950 p-6">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Storage Environment</p>
                <h3 className="mt-2 text-xl font-semibold text-white">{environmentForm.id ? 'Editar ambiente' : 'Novo ambiente'}</h3>
              </div>
              <button className="rounded-xl border border-slate-800 p-2 text-slate-300" onClick={() => setShowEnvironmentModal(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-6 lg:grid-cols-[1fr,1.2fr]">
              <div className="space-y-4">
                <label className="block">
                  <span className="mb-2 block text-sm text-slate-300">Nome do ambiente</span>
                  <input
                    value={environmentForm.name}
                    onChange={(event) => setEnvironmentForm((current) => ({ ...current, name: event.target.value }))}
                    className="w-full rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-white"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm text-slate-300">Provider</span>
                  <select
                    value={environmentForm.provider}
                    onChange={(event) => setEnvironmentForm((current) => ({ ...current, provider: event.target.value, config: {} }))}
                    className="w-full rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-white"
                  >
                    {providerCatalog.map((provider) => (
                      <option key={provider.id} value={provider.id}>{provider.label}</option>
                    ))}
                  </select>
                </label>

                <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">
                  <p className="font-medium text-white">{selectedProviderMeta?.label || 'Provider'}</p>
                  <p className="mt-2 text-slate-400">Status: {formatProviderStatus(selectedProviderMeta?.status)}</p>
                  <p className="mt-3 text-slate-500">Capacidades: {(selectedProviderMeta?.capabilities || []).join(', ')}</p>
                </div>
              </div>

              <div className="space-y-6">
                <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                  <p className="text-sm font-medium text-white">Configuração dinâmica</p>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {(selectedProviderMeta?.configSchema || []).map((field) => (
                      <label key={field.key} className="block">
                        <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-500">{field.label}</span>
                        {field.type === 'boolean' ? (
                          <input
                            type="checkbox"
                            checked={!!environmentForm.config[field.key]}
                            onChange={(event) => setEnvironmentForm((current) => ({
                              ...current,
                              config: { ...current.config, [field.key]: event.target.checked },
                            }))}
                          />
                        ) : field.type === 'select' ? (
                          <select
                            value={environmentForm.config[field.key] || ''}
                            onChange={(event) => setEnvironmentForm((current) => ({
                              ...current,
                              config: { ...current.config, [field.key]: event.target.value },
                            }))}
                            className="w-full rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-white"
                          >
                            <option value="">Selecione</option>
                            {(field.options || []).map((option) => (
                              <option key={option} value={option}>{option}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={field.secret ? 'password' : field.type === 'number' ? 'number' : 'text'}
                            value={environmentForm.config[field.key] || ''}
                            onChange={(event) => setEnvironmentForm((current) => ({
                              ...current,
                              config: { ...current.config, [field.key]: event.target.value },
                            }))}
                            className="w-full rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-white"
                          />
                        )}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                  <p className="text-sm font-medium text-white">Permissões por ambiente</p>
                  <div className="mt-4 grid gap-4 md:grid-cols-3">
                    {['admin', 'dev', 'viewer'].map((role) => (
                      <div key={role} className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
                        <p className="mb-3 text-xs uppercase tracking-[0.18em] text-slate-500">{role}</p>
                        <div className="space-y-2">
                          {STORAGE_ACTIONS.map((action) => (
                            <label key={`${role}-${action}`} className="flex items-center gap-2 text-sm text-slate-300">
                              <input
                                type="checkbox"
                                checked={(environmentForm.permissions[role] || []).includes(action)}
                                onChange={() => togglePermission(role, action)}
                              />
                              {action}
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-between">
              <div>
                {environmentForm.id && environmentForm.provider !== 'local' ? (
                  <button className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-200" onClick={deleteEnvironment}>
                    Remover ambiente
                  </button>
                ) : null}
              </div>
              <div className="flex gap-2">
                <button className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-2 text-sm text-slate-300" onClick={() => setShowEnvironmentModal(false)}>
                  Cancelar
                </button>
                <button className="inline-flex items-center gap-2 rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950" onClick={saveEnvironment}>
                  <Save className="h-4 w-4" />
                  Salvar ambiente
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showCopyModal && selected && renderInPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-3xl border border-slate-800 bg-slate-950 p-6">
            <h3 className="text-lg font-semibold text-white">Copiar entre ambientes</h3>
            <p className="mt-2 text-sm text-slate-400">{selected.name}</p>
            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="mb-2 block text-sm text-slate-300">Ambiente destino</span>
                <select
                  value={copyTargetEnvironmentId}
                  onChange={(event) => setCopyTargetEnvironmentId(event.target.value)}
                  className="w-full rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-white"
                >
                  <option value="">Selecione</option>
                  {environments.filter((environment) => environment.id !== selectedEnvironmentId).map((environment) => (
                    <option key={environment.id} value={environment.id}>{environment.name}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-2 block text-sm text-slate-300">Pasta/arquivo destino</span>
                <input
                  value={copyTargetPath}
                  onChange={(event) => setCopyTargetPath(event.target.value)}
                  className="w-full rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-white"
                  placeholder="/pasta/arquivo.txt"
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-2 text-sm text-slate-300" onClick={() => setShowCopyModal(false)}>
                Cancelar
              </button>
              <button className="rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950" onClick={handleCrossEnvironmentCopy}>
                Copiar
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && renderInPortal(
        <div className="fixed right-6 top-24 rounded-xl border border-blue-500/40 bg-blue-500/10 px-4 py-3 text-xs text-blue-200">
          {toast}
        </div>
      )}

      <input ref={uploadRef} type="file" className="hidden" multiple onChange={(event) => handleUpload(event.target.files)} />
    </div>
  )
}

export default FileManager
