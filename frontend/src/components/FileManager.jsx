import { useEffect, useMemo, useRef, useState } from 'react'
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
  ChevronRight
} from 'lucide-react'
import Editor from '@monaco-editor/react'
import api from '../services/api.js'
import { createMetricsSocket } from '../services/socket.js'

const iconFor = (name, isDir) => {
  if (isDir) return Folder
  const ext = name.split('.').pop().toLowerCase()
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return Image
  if (['js', 'jsx', 'ts', 'tsx', 'json', 'yml', 'yaml', 'md'].includes(ext)) return FileCode
  if (['zip', 'tar', 'gz'].includes(ext)) return FileArchive
  return FileText
}

const FileManager = () => {
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
  const uploadRef = useRef(null)
  const token = localStorage.getItem('token')
  const socket = useMemo(() => createMetricsSocket(token), [token])

  const loadTree = async () => {
    try {
      const response = await api.get('/storage/tree')
      setTree(response.data.tree || [])
    } catch (err) {
      setToast('Erro ao carregar arvore')
    }
  }

  const loadItems = async (targetPath) => {
    setLoading(true)
    try {
      const response = await api.get('/storage', { params: { path: targetPath } })
      setItems(response.data.items || [])
      setPath(targetPath)
      setSelected(null)
      setPreview(null)
    } catch (err) {
      setToast('Erro ao carregar arquivos')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTree()
    loadItems('/')
  }, [])

  useEffect(() => {
    if (!socket) {
      return undefined
    }
    const handleMetrics = (payload) => {
      setUsage({
        used: payload?.disk?.used || 0,
        total: payload?.disk?.total || 0
      })
    }
    socket.on('metrics', handleMetrics)
    return () => {
      socket.off('metrics', handleMetrics)
      socket.disconnect()
    }
  }, [socket])

  useEffect(() => {
    let active = true
    const loadStats = async () => {
      try {
        const response = await api.get('/storage/stats')
        if (!active) return
        setUsage({
          used: response.data?.stats?.used || 0,
          total: response.data?.stats?.total || 0
        })
      } catch {
        // Ignore stats errors.
      }
    }
    loadStats()
    const interval = setInterval(() => {
      if (!socket) {
        loadStats()
      }
    }, 15000)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [socket])

  const breadcrumbs = path.split('/').filter(Boolean)

  const openItem = (item) => {
    if (item.isDir) {
      loadItems(item.path)
      return
    }
    if (item.isImage) {
      setPreview(item)
      setPreviewUrl('')
      setEditorFile(null)
      setPreviewType('image')
    } else {
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
      const textExts = new Set([
        'java',
        'js',
        'jsx',
        'ts',
        'tsx',
        'sol',
        'json',
        'txt',
        'env',
        'md',
        'yml',
        'yaml',
        'css',
        'html',
        'sh',
        'sql',
        'xml',
        'toml',
        'ini',
        'conf',
        'properties',
        'gradle',
        'kt',
        'kts',
        'go',
        'rs',
        'py',
        'rb',
        'php',
        'c',
        'h',
        'hpp',
        'cpp'
      ])
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
        properties: 'ini'
      }
      if (textExts.has(ext) || !item.isImage) {
        setEditorFile(item)
        setEditorLanguage(languageMap[ext] || 'plaintext')
      }
    }
  }

  useEffect(() => {
    let active = true
    if (!editorFile?.path) {
      return undefined
    }
    setEditorLoading(true)
    api
      .get('/storage/file', { params: { path: editorFile.path } })
      .then((response) => {
        if (!active) return
        setEditorContent(response.data.content || '')
      })
      .catch(() => {
        if (active) setToast('Erro ao carregar arquivo')
      })
      .finally(() => {
        if (active) setEditorLoading(false)
      })
    return () => {
      active = false
    }
  }, [editorFile])

  const saveEditor = async () => {
    if (!editorFile) return
    try {
      await api.put('/storage/file', { path: editorFile.path, content: editorContent })
      setToast('Arquivo salvo')
    } catch (err) {
      setToast('Erro ao salvar arquivo')
    }
  }

  useEffect(() => {
    let active = true
    if (!preview?.path) {
      return undefined
    }
    const endpoint =
      previewType === 'pdf'
        ? '/storage/pdf'
        : previewType === 'audio' || previewType === 'video'
          ? '/storage/media'
          : '/storage/preview'
    api
      .get(endpoint, {
        params: { path: preview.path },
        responseType: 'arraybuffer'
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
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
      }
    }
  }, [preview, previewType])

  const handleUpload = async (files) => {
    if (!files?.length) return
    const formData = new FormData()
    Array.from(files).forEach((file) => formData.append('files', file))
    formData.append('path', path)
    try {
      await api.post('/storage/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      setToast('Upload concluido')
      loadItems(path)
      loadTree()
    } catch (err) {
      setToast('Erro no upload')
    }
  }

  const handleCreate = async (type) => {
    const name = prompt(`Nome do ${type === 'folder' ? 'pasta' : 'arquivo'}`)
    if (!name) return
    try {
      await api.post('/storage/create', { path, name, type })
      setToast('Criado com sucesso')
      loadItems(path)
      loadTree()
    } catch (err) {
      setToast('Erro ao criar')
    }
  }

  const handleDelete = async () => {
    if (!selected) return
    try {
      await api.delete('/storage', { params: { path: selected.path } })
      setToast('Removido')
      loadItems(path)
      loadTree()
    } catch (err) {
      setToast('Erro ao remover')
    }
  }

  const handleDownload = async () => {
    if (!selected || selected.isDir) return
    window.open(`${api.defaults.baseURL}/storage/download?path=${encodeURIComponent(selected.path)}`)
  }

  const handleRename = async () => {
    if (!menuItem || !renameValue.trim()) return
    const basePath = menuItem.path.split('/').slice(0, -1).join('/') || '/'
    const targetPath = `${basePath}/${renameValue}`.replace(/\/+/g, '/')
    try {
      await api.post('/storage/move', { fromPath: menuItem.path, toPath: targetPath })
      setToast('Renomeado')
      setShowRename(false)
      setMenuItem(null)
      loadItems(path)
      loadTree()
    } catch (err) {
      setToast('Erro ao renomear')
    }
  }

  const handleMove = async () => {
    if (!menuItem || !moveTarget) return
    const targetPath = `${moveTarget}/${menuItem.name}`.replace(/\/+/g, '/')
    try {
      await api.post('/storage/move', { fromPath: menuItem.path, toPath: targetPath })
      setToast('Movido')
      setShowMove(false)
      setMenuItem(null)
      loadItems(path)
      loadTree()
    } catch (err) {
      setToast('Erro ao mover')
    }
  }

  const usagePercent = usage.total ? Math.round((usage.used / usage.total) * 100) : 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Storage</p>
          <h2 className="text-2xl font-semibold text-white">Gerenciador de arquivos</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-200 transition hover:border-blue-500/60"
            onClick={() => uploadRef.current?.click()}
          >
            <UploadCloud className="h-4 w-4" />
            Upload
          </button>
          <button
            className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-200 transition hover:border-blue-500/60"
            onClick={() => handleCreate('file')}
          >
            <Plus className="h-4 w-4" />
            Novo arquivo
          </button>
          <button
            className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-200 transition hover:border-blue-500/60"
            onClick={() => handleCreate('folder')}
          >
            <Plus className="h-4 w-4" />
            Nova pasta
          </button>
          <button
            className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-200 transition hover:border-blue-500/60"
            onClick={handleDelete}
            disabled={!selected}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
          <button
            className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-200 transition hover:border-blue-500/60"
            onClick={handleDownload}
            disabled={!selected || selected?.isDir}
          >
            <Download className="h-4 w-4" />
            Download
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-xs text-slate-300">
        <span>Uso de disco: </span>
        <span className="text-blue-200">
          {usagePercent}% ({(usage.used / 1024 / 1024 / 1024).toFixed(1)} GB de{' '}
          {(usage.total / 1024 / 1024 / 1024).toFixed(1)} GB)
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Pastas</p>
          <div className="mt-4 space-y-2 text-sm text-slate-200">
            {tree.length === 0 && <p className="text-xs text-slate-500">Sem dados</p>}
            {tree.map((node) => (
              <button
                key={node.path}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-slate-800/60"
                onClick={() => loadItems(node.path)}
                onDragOver={(event) => {
                  event.preventDefault()
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  if (!dragItem) return
                  api
                    .post('/storage/move', {
                      fromPath: dragItem.path,
                      toPath: `${node.path}/${dragItem.name}`.replace(/\/+/g, '/')
                    })
                    .then(() => {
                      setToast('Movido')
                      setDragItem(null)
                      loadItems(path)
                      loadTree()
                    })
                    .catch(() => setToast('Erro ao mover'))
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
              onClick={() => loadItems('/')}
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
                    onClick={() => loadItems(crumbPath)}
                  >
                    {crumb}
                  </button>
                </div>
              )
            })}
          </div>

          <div
            className="mt-4 rounded-xl border border-dashed border-slate-700 bg-slate-950/60 p-4 text-center text-xs text-slate-400"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              handleUpload(event.dataTransfer.files)
            }}
          >
            Arraste arquivos aqui ou use o botao Upload
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
                    if (!item.isDir || !dragItem) return
                    api
                      .post('/storage/move', {
                        fromPath: dragItem.path,
                        toPath: `${item.path}/${dragItem.name}`.replace(/\/+/g, '/')
                      })
                      .then(() => {
                        setToast('Movido')
                        setDragItem(null)
                        loadItems(path)
                        loadTree()
                      })
                      .catch(() => setToast('Erro ao mover'))
                  }}
                >
                  <div className="flex items-center gap-3">
                    <Icon className="h-4 w-4 text-blue-300" />
                    <div>
                      <p className="text-slate-200">{item.name}</p>
                      <p className="text-xs text-slate-500">{item.isDir ? 'Pasta' : item.size}</p>
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
                      Opcoes
                    </button>
                  </div>
                </div>
              )
            })}
            {items.length === 0 && (
              <p className="text-xs text-slate-500">{loading ? 'Carregando...' : 'Sem arquivos'}</p>
            )}
          </div>
        </div>
      </div>

      {preview && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Preview</p>
          <div className="mt-3 flex justify-center rounded-xl bg-slate-950 p-4">
            {previewUrl ? (
              previewType === 'pdf' ? (
                <iframe
                  title={preview.name}
                  src={previewUrl}
                  className="h-[480px] w-full rounded-lg bg-slate-950"
                />
              ) : previewType === 'audio' ? (
                <audio controls className="w-full">
                  <source src={previewUrl} />
                </audio>
              ) : previewType === 'video' ? (
                <video controls className="h-[420px] w-full rounded-lg bg-black">
                  <source src={previewUrl} />
                </video>
              ) : (
                <img
                  src={previewUrl}
                  alt={preview.name}
                  className="max-h-72 rounded-lg object-contain"
                />
              )
            ) : (
              <span className="text-xs text-slate-500">Carregando preview...</span>
            )}
          </div>
        </div>
      )}

      {menuItem && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900/90 p-5">
            <h3 className="text-sm font-semibold text-slate-100">{menuItem.name}</h3>
            <div className="mt-4 space-y-2 text-sm text-slate-200">
              <button
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-left"
                onClick={() => {
                  setRenameValue(menuItem.name)
                  setShowRename(true)
                  setShowMove(false)
                }}
              >
                Renomear
              </button>
              <button
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-left"
                onClick={() => {
                  setShowMove(true)
                  setShowRename(false)
                }}
              >
                Mover
              </button>
              <button
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-left"
                onClick={() => {
                  setSelected(menuItem)
                  handleDownload()
                  setMenuItem(null)
                }}
              >
                Download
              </button>
              <button
                className="w-full rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-left text-rose-200"
                onClick={() => {
                  setSelected(menuItem)
                  handleDelete()
                  setMenuItem(null)
                }}
              >
                Delete
              </button>
              <button
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-left"
                onClick={() => setMenuItem(null)}
              >
                Fechar
              </button>
            </div>

            {showRename && (
              <div className="mt-4 space-y-2">
                <input
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-100"
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                />
                <div className="flex gap-2">
                  <button
                    className="rounded-lg bg-blue-500 px-3 py-2 text-xs font-semibold text-slate-950"
                    onClick={handleRename}
                  >
                    Salvar
                  </button>
                  <button
                    className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200"
                    onClick={() => setShowRename(false)}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {showMove && (
              <div className="mt-4 space-y-2">
                <input
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-100"
                  placeholder="/nova/pasta"
                  value={moveTarget}
                  onChange={(event) => setMoveTarget(event.target.value)}
                />
                <div className="flex gap-2">
                  <button
                    className="rounded-lg bg-blue-500 px-3 py-2 text-xs font-semibold text-slate-950"
                    onClick={handleMove}
                  >
                    Mover
                  </button>
                  <button
                    className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200"
                    onClick={() => setShowMove(false)}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
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
              <p className="mt-1 text-xs text-slate-400">
                IntelliSense, Validation and basic syntax colorization available in browser.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-1 text-xs text-slate-200"
                onClick={saveEditor}
                disabled={editorLoading}
              >
                Salvar
              </button>
              <button
                className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-1 text-xs text-slate-200"
                onClick={() => setEditorFile(null)}
              >
                Fechar
              </button>
            </div>
          </div>
          <div className="mt-3 h-[420px] overflow-hidden rounded-xl border border-slate-800">
            {editorLoading ? (
              <div className="flex h-full items-center justify-center text-xs text-slate-500">
                Carregando editor...
              </div>
            ) : (
              <Editor
                height="100%"
                theme="vs-dark"
                value={editorContent}
                language={editorLanguage}
                onChange={(value) => setEditorContent(value || '')}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  wordWrap: 'on',
                  quickSuggestions: true,
                  suggestOnTriggerCharacters: true,
                  tabCompletion: 'on'
                }}
              />
            )}
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed right-6 top-24 rounded-xl border border-blue-500/40 bg-blue-500/10 px-4 py-3 text-xs text-blue-200">
          {toast}
        </div>
      )}

      <input
        ref={uploadRef}
        type="file"
        className="hidden"
        multiple
        onChange={(event) => handleUpload(event.target.files)}
      />
    </div>
  )
}

export default FileManager
