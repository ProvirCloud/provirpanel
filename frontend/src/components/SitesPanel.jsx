import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  ExternalLink,
  FileArchive,
  FolderOpen,
  Globe,
  KeyRound,
  LayoutList,
  LoaderCircle,
  Lock,
  Plus,
  RefreshCcw,
  Server,
  Settings2,
  Shield,
  Trash2,
  UploadCloud,
  UserRound,
  Wrench,
} from 'lucide-react'
import api, { uploadApi } from '../services/api.js'
import Button from './ui/Button'
import Input from './ui/Input'
import { useConfirm } from './ui/ConfirmModal'

const UPLOAD_CHUNK_SIZE_BYTES = 25 * 1024 * 1024

const defaultCreateForm = {
  name: '',
  domain: '',
  proxyPath: '',
  adminUser: 'admin',
  adminEmail: '',
  adminPassword: '',
  ssl: true,
}

const normalizeDisplayProxyPath = (value = '/') => {
  const path = String(value || '').trim()
  if (!path || path === '/') return ''
  return path.startsWith('/') ? path : `/${path}`
}

const getSiteDisplayHost = (site = {}) => {
  if (site.domain) return site.domain
  const host = site.proxyHost || site.localUrl || 'proxy pendente'
  return `${host}${normalizeDisplayProxyPath(site.proxyPath)}`
}

const isProxyMode = (site = {}) => Boolean(site.proxyMode || (!site.domain && site.proxyHost))

const serviceOptions = [
  { id: 'wordpress', label: 'WordPress', icon: Globe, active: true, accent: 'text-cyan-300' },
  { id: 'static', label: 'Site estático', icon: Server, active: false, accent: 'text-emerald-300' },
  { id: 'shopify', label: 'Shopify', icon: Globe, active: false, accent: 'text-lime-300' },
  { id: 'joomla', label: 'Joomla', icon: Shield, active: false, accent: 'text-amber-300' },
  { id: 'drupal', label: 'Drupal', icon: Settings2, active: false, accent: 'text-fuchsia-300' },
  { id: 'magento', label: 'Magento', icon: Database, active: false, accent: 'text-rose-300' },
  { id: 'zeus', label: 'Zeus Engine', icon: Wrench, active: false, accent: 'text-indigo-300' },
]

const tabs = [
  { id: 'overview', label: 'Sites', icon: LayoutList },
  { id: 'operate', label: 'Manutenção', icon: Wrench },
  { id: 'migrate', label: 'Restaurar', icon: UploadCloud },
]

const Field = ({ label, children }) => (
  <label className="block space-y-2">
    <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-text-soft)]">{label}</span>
    {children}
  </label>
)

const Panel = ({ title, icon: Icon, action, children }) => (
  <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/70 p-4 shadow-[0_16px_40px_rgba(0,0,0,0.16)] sm:p-5">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {Icon ? (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)] text-[var(--color-brand)]">
            <Icon size={18} />
          </span>
        ) : null}
        <h2 className="truncate text-base font-semibold text-[var(--color-text)]">{title}</h2>
      </div>
      {action}
    </div>
    {children}
  </section>
)

const StatusPill = ({ ok, children }) => (
  <span className={`inline-flex min-h-[26px] items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
    ok ? 'bg-emerald-500/12 text-emerald-200' : 'bg-amber-500/12 text-amber-200'
  }`}>
    {ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
    {children}
  </span>
)

const formatBytes = (value) => {
  const bytes = Number(value || 0)
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

const getErrorMessage = (err, fallback) =>
  err?.response?.data?.message || err?.response?.data?.error || err?.message || fallback

const getBlobAwareErrorMessage = async (err, fallback) => {
  const data = err?.response?.data
  if (data instanceof Blob) {
    try {
      const text = await data.text()
      const parsed = JSON.parse(text)
      return parsed.message || parsed.error || fallback
    } catch {
      return fallback
    }
  }
  return getErrorMessage(err, fallback)
}

const formatDateTime = (value) => {
  if (!value) return 'Nunca'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Nunca'
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const getDownloadFilename = (response, fallback) => {
  const disposition = response.headers?.['content-disposition'] || ''
  const match = disposition.match(/filename="?([^"]+)"?/i)
  return match?.[1] || response.headers?.['x-provirpanel-backup-file'] || fallback
}

const downloadBlob = (blob, filename) => {
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}

const normalizeStoragePath = (value = '/') => {
  const raw = String(value || '/').trim() || '/'
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`
  return withSlash.replace(/\/+/g, '/')
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

const uploadFileInChunks = async ({ siteId, file, onProgress }) => {
  const totalChunks = Math.max(1, Math.ceil(file.size / UPLOAD_CHUNK_SIZE_BYTES))
  const safeSize = Math.max(1, file.size)
  const initResponse = await uploadApi.post(`/sites/${siteId}/migrate/init`, {
    filename: file.name,
    size: file.size,
    totalChunks,
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
      `/sites/${siteId}/migrate/chunk`,
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
          onProgress?.(Math.min(99, Math.round((loaded / safeSize) * 100)), chunkIndex + 1, totalChunks)
        },
      }
    )
    onProgress?.(Math.min(99, Math.round((end / safeSize) * 100)), chunkIndex + 1, totalChunks)
  }

  onProgress?.(99, totalChunks, totalChunks, 'Processando backup no servidor')
  return uploadApi.post(`/sites/${siteId}/migrate/complete`, { uploadId }, { timeout: 900000 })
}

const SitesPanel = () => {
  const confirm = useConfirm()
  const [activeTab, setActiveTab] = useState('overview')
  const [sites, setSites] = useState([])
  const [baseDir, setBaseDir] = useState('')
  const [selectedSiteId, setSelectedSiteId] = useState('')
  const [createForm, setCreateForm] = useState(defaultCreateForm)
  const [domainForm, setDomainForm] = useState({ domain: '', proxyPath: '' })
  const [passwordForm, setPasswordForm] = useState({
    username: 'admin',
    password: '',
    generatePassword: false,
    email: '',
    displayName: '',
    firstName: '',
    lastName: '',
  })
  const [migrationFile, setMigrationFile] = useState(null)
  const [migrationProgress, setMigrationProgress] = useState(0)
  const [migrationStep, setMigrationStep] = useState('')
  const [creationProgress, setCreationProgress] = useState([])
  const [migrationResult, setMigrationResult] = useState(null)
  const [generatedPassword, setGeneratedPassword] = useState(null)
  const [message, setMessage] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')

  const askConfirm = useCallback(
    async (options) => {
      if (!confirm) return window.confirm(options.message || options.title || 'Confirmar')
      return confirm(options)
    },
    [confirm]
  )

  const selectedSite = useMemo(
    () => sites.find((site) => site.id === selectedSiteId) || sites[0] || null,
    [selectedSiteId, sites]
  )

  const loadSites = useCallback(async () => {
    setLoading(true)
    try {
      const response = await api.get('/sites')
      const nextSites = response.data?.sites || []
      setSites(nextSites)
      setBaseDir(response.data?.baseDir || '')
      setSelectedSiteId((current) => (nextSites.some((site) => site.id === current) ? current : nextSites[0]?.id || ''))
    } catch (err) {
      setMessage({ type: 'error', text: getErrorMessage(err, 'Erro ao carregar sites') })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSites()
  }, [loadSites])

  useEffect(() => {
    if (!selectedSite) return
    setDomainForm({ domain: selectedSite.domain || '', proxyPath: selectedSite.proxyPath || '' })
    setPasswordForm((current) => ({
      ...current,
      username: selectedSite.wordpress?.adminUser || 'admin',
      email: selectedSite.wordpress?.adminEmail || '',
      displayName: selectedSite.wordpress?.adminDisplayName || '',
      firstName: selectedSite.wordpress?.adminFirstName || '',
      lastName: selectedSite.wordpress?.adminLastName || '',
    }))
  }, [selectedSite])

  const handleCreateChange = (field, value) => {
    setCreateForm((current) => ({ ...current, [field]: value }))
  }

  const submitCreate = async (event) => {
    event.preventDefault()
    setBusy('create')
    setMessage(null)
    setCreationProgress([])
    try {
      const response = await api.post('/sites/wordpress', createForm)
      setCreationProgress(response.data?.progress || [])
      setSites((current) => [response.data.site, ...current.filter((site) => site.id !== response.data.site.id)])
      setSelectedSiteId(response.data.site.id)
      setCreateForm(defaultCreateForm)
      setActiveTab('operate')
      const warningText = (response.data?.warnings || []).filter(Boolean).join(' ')
      setMessage({ type: warningText ? 'warning' : 'success', text: warningText || 'WordPress criado e publicado no Nginx Manager' })
    } catch (err) {
      setMessage({ type: 'error', text: getErrorMessage(err, 'Erro ao criar WordPress') })
    } finally {
      setBusy('')
    }
  }

  const submitDomain = async (event) => {
    event.preventDefault()
    if (!selectedSite) return
    const nextDomain = domainForm.domain.trim()
    const nextProxyPath = normalizeDisplayProxyPath(domainForm.proxyPath)
    const confirmed = await askConfirm({
      title: 'Alterar domínio',
      message: nextDomain
        ? `Aplicar o domínio ${nextDomain} no site ${selectedSite.name}? O painel também tentará atualizar siteurl/home no WordPress.`
        : `Remover o domínio público de ${selectedSite.name} e usar o proxy temporário ${selectedSite.proxyHost || 'gerado pelo painel'}${nextProxyPath || ''}?`,
      confirmText: nextDomain ? 'Aplicar domínio' : 'Usar proxy',
      variant: 'warning',
    })
    if (!confirmed) return
    setBusy('domain')
    setMessage(null)
    try {
      const response = await api.post(`/sites/${selectedSite.id}/domain`, domainForm)
      setSites((current) => current.map((site) => (site.id === response.data.site.id ? response.data.site : site)))
      const warnings = (response.data?.warnings || []).filter(Boolean).join(' ')
      setMessage({ type: warnings ? 'warning' : 'success', text: warnings || 'Domínio atualizado' })
    } catch (err) {
      setMessage({ type: 'error', text: getErrorMessage(err, 'Erro ao alterar domínio') })
    } finally {
      setBusy('')
    }
  }

  const submitPasswordReset = async (event) => {
    event.preventDefault()
    if (!selectedSite) return
    const confirmed = await askConfirm({
      title: 'Atualizar perfil WordPress',
      message: `Atualizar o usuário ${passwordForm.username} no site ${selectedSite.name}? A senha só será alterada se você informar uma nova senha ou marcar a geração automática.`,
      confirmText: 'Atualizar usuário',
      variant: 'warning',
    })
    if (!confirmed) return
    setBusy('password')
    setMessage(null)
    setGeneratedPassword(null)
    try {
      const response = await api.post(`/sites/${selectedSite.id}/reset-password`, passwordForm)
      setGeneratedPassword(response.data.password ? { username: response.data.username, password: response.data.password } : null)
      setSites((current) => current.map((site) => (site.id === response.data.site.id ? response.data.site : site)))
      setPasswordForm((current) => ({ ...current, password: '', generatePassword: false }))
      setMessage({ type: 'success', text: 'Usuário do WordPress atualizado' })
    } catch (err) {
      setMessage({ type: 'error', text: getErrorMessage(err, 'Erro ao resetar senha') })
    } finally {
      setBusy('')
    }
  }

  const optimizeDatabase = async () => {
    if (!selectedSite) return
    const confirmed = await askConfirm({
      title: 'Otimizar banco',
      message: `Executar otimização no banco do site ${selectedSite.name}? A ação usa mysqlcheck/mariadb-check no container do banco.`,
      confirmText: 'Otimizar',
      variant: 'warning',
    })
    if (!confirmed) return
    setBusy('optimize')
    setMessage(null)
    try {
      const response = await api.post(`/sites/${selectedSite.id}/db/optimize`)
      setSites((current) => current.map((site) => (site.id === response.data.site.id ? response.data.site : site)))
      setMessage({ type: 'success', text: 'Banco otimizado' })
    } catch (err) {
      setMessage({ type: 'error', text: getErrorMessage(err, 'Erro ao otimizar banco') })
    } finally {
      setBusy('')
    }
  }

  const fixSsl = async () => {
    if (!selectedSite) return
    const confirmed = await askConfirm({
      title: 'Ativar HTTPS',
      message: `Atualizar wp-config.php e banco do site ${selectedSite.name} para operar atrás do proxy HTTPS?`,
      confirmText: 'Ativar HTTPS',
      variant: 'warning',
    })
    if (!confirmed) return
    setBusy('fix-ssl')
    setMessage(null)
    try {
      const response = await api.post(`/sites/${selectedSite.id}/fix-ssl`)
      setSites((current) => current.map((site) => (site.id === response.data.site.id ? response.data.site : site)))
      const warnings = (response.data?.warnings || []).filter(Boolean).join(' ')
      setMessage({ type: warnings ? 'warning' : 'success', text: warnings || 'HTTPS ativado — wp-config.php e banco atualizados' })
    } catch (err) {
      setMessage({ type: 'error', text: getErrorMessage(err, 'Erro ao ativar HTTPS') })
    } finally {
      setBusy('')
    }
  }

  const disableSsl = async () => {
    if (!selectedSite) return
    setBusy('disable-ssl')
    setMessage(null)
    try {
      const response = await api.post(`/sites/${selectedSite.id}/disable-ssl`)
      setSites((current) => current.map((site) => (site.id === response.data.site.id ? response.data.site : site)))
      const warnings = (response.data?.warnings || []).filter(Boolean).join(' ')
      setMessage({ type: warnings ? 'warning' : 'success', text: warnings || 'HTTPS desativado — site operando em HTTP' })
    } catch (err) {
      setMessage({ type: 'error', text: getErrorMessage(err, 'Erro ao desativar HTTPS') })
    } finally {
      setBusy('')
    }
  }

  const fixPermissions = async () => {
    if (!selectedSite) return
    const confirmed = await askConfirm({
      title: 'Corrigir permissões',
      message: `Ajustar permissões dos arquivos WordPress do site ${selectedSite.name}?`,
      confirmText: 'Corrigir',
      variant: 'warning',
    })
    if (!confirmed) return
    setBusy('fix-permissions')
    setMessage(null)
    try {
      await api.post(`/sites/${selectedSite.id}/fix-permissions`)
      setMessage({ type: 'success', text: 'Permissões do WordPress corrigidas' })
    } catch (err) {
      setMessage({ type: 'error', text: getErrorMessage(err, 'Erro ao corrigir permissões') })
    } finally {
      setBusy('')
    }
  }

  const cleanupCache = async () => {
    if (!selectedSite) return
    const confirmed = await askConfirm({
      title: 'Limpar cache do WordPress',
      message: `Remover cache de otimização e desativar minificação antiga do backup no site ${selectedSite.name}? Use quando o tema carregar sem CSS/JS após restauração ou troca de domínio.`,
      confirmText: 'Limpar cache',
      variant: 'warning',
    })
    if (!confirmed) return
    setBusy('cleanup-cache')
    setMessage(null)
    try {
      const response = await api.post(`/sites/${selectedSite.id}/cleanup-cache`)
      setSites((current) => current.map((site) => (site.id === response.data.site.id ? response.data.site : site)))
      const removed = response.data?.cleanup?.removedPaths?.length || 0
      const tables = response.data?.cleanup?.optionTables || 0
      setMessage({ type: 'success', text: `Cache limpo (${removed} caminhos removidos, ${tables} tabelas ajustadas)` })
    } catch (err) {
      setMessage({ type: 'error', text: getErrorMessage(err, 'Erro ao limpar cache') })
    } finally {
      setBusy('')
    }
  }

  const submitMigration = async (event) => {
    event.preventDefault()
    if (!selectedSite || !migrationFile) return
    if (selectedSite.databaseStatus !== 'running') {
      setMessage({ type: 'error', text: 'A migração precisa de um site WordPress criado com o banco em execução.' })
      return
    }
    const confirmed = await askConfirm({
      title: 'Restaurar backup',
      message: `Aplicar ${migrationFile.name} no site ${selectedSite.name}? Esta ação pode sobrescrever wp-content, importar SQL e alterar siteurl/home.`,
      confirmText: 'Restaurar',
      variant: 'warning',
    })
    if (!confirmed) return
    setBusy('migration')
    setMessage(null)
    setMigrationResult(null)
    setMigrationProgress(0)
    setMigrationStep('Preparando upload')
    try {
      const response = await uploadFileInChunks({
        siteId: selectedSite.id,
        file: migrationFile,
        onProgress: (progress, chunkIndex, totalChunks, step) => {
          setMigrationProgress(progress)
          setMigrationStep(step || `Enviando parte ${chunkIndex}/${totalChunks}`)
        },
      })
      setMigrationProgress(100)
      setMigrationStep('Migração aplicada')
      setMigrationResult(response.data?.migration || null)
      setSites((current) => current.map((site) => (site.id === response.data.site.id ? response.data.site : site)))
      setMessage({ type: 'success', text: 'Backup processado' })
    } catch (err) {
      setMessage({ type: 'error', text: getErrorMessage(err, 'Erro ao processar migração') })
    } finally {
      setBusy('')
    }
  }

  const handleMigrationFileChange = (event) => {
    const file = event.target.files?.[0] || null
    setMigrationFile(file)
    setMigrationResult(null)
    setMigrationProgress(0)
    if (!file) {
      setMigrationStep('')
      return
    }
    const totalChunks = Math.max(1, Math.ceil(file.size / UPLOAD_CHUNK_SIZE_BYTES))
    setMigrationStep(`Arquivo pronto em ${totalChunks} parte${totalChunks > 1 ? 's' : ''}`)
  }

  const generateBackup = async (site = selectedSite) => {
    if (!site) return
    const confirmed = await askConfirm({
      title: 'Gerar backup',
      message: `Gerar e baixar um backup completo do site ${site.name}? O pacote inclui dump SQL, arquivos WordPress, configuração e README de restauração.`,
      confirmText: 'Gerar backup',
      variant: 'info',
    })
    if (!confirmed) return
    setBusy(`backup-${site.id}`)
    setMessage(null)
    try {
      const response = await api.post(`/sites/${site.id}/backup`, {}, { responseType: 'blob', timeout: 900000 })
      const filename = getDownloadFilename(response, `${site.slug || site.name || 'wordpress'}-backup.tar.gz`)
      downloadBlob(new Blob([response.data], { type: response.headers?.['content-type'] || 'application/gzip' }), filename)
      await loadSites()
      setMessage({ type: 'success', text: 'Backup gerado e baixado' })
    } catch (err) {
      setMessage({ type: 'error', text: await getBlobAwareErrorMessage(err, 'Erro ao gerar backup') })
    } finally {
      setBusy('')
    }
  }

  const openWpContentStorage = async (site = selectedSite, targetPath = '/') => {
    if (!site) return
    const normalizedPath = normalizeStoragePath(targetPath)
    setBusy(`wp-content-${site.id}`)
    setMessage(null)
    try {
      const response = await api.post(`/sites/${site.id}/wp-content/storage`)
      const environmentId = response.data?.environment?.id || response.data?.wpContentStorage?.environmentId
      if (!environmentId) {
        throw new Error('Ambiente wp-content não foi criado')
      }
      window.location.assign(`/files?environmentId=${encodeURIComponent(environmentId)}&path=${encodeURIComponent(normalizedPath)}`)
    } catch (err) {
      setMessage({ type: 'error', text: getErrorMessage(err, 'Erro ao abrir wp-content') })
      setBusy('')
    }
  }

  const deleteSite = async (site) => {
    if (!site) return
    const confirmed = await askConfirm({
      title: 'Excluir site',
      message: `Esta ação remove containers, registro do painel, configuração Nginx e arquivos locais de ${site.name}. Gere um backup antes se precisar manter uma cópia.`,
      confirmText: 'Excluir site',
      variant: 'danger',
      requiredText: site.name,
      requiredTextLabel: `Digite exatamente "${site.name}" para excluir`,
    })
    if (!confirmed) return
    setBusy(`delete-${site.id}`)
    setMessage(null)
    try {
      const response = await api.delete(`/sites/${site.id}`, {
        data: { confirmName: site.name, removeFiles: true },
      })
      const warnings = (response.data?.warnings || []).filter(Boolean).join(' ')
      const nextSites = sites.filter((entry) => entry.id !== site.id)
      setSites(nextSites)
      setSelectedSiteId((currentSelected) => (currentSelected === site.id ? nextSites[0]?.id || '' : currentSelected))
      setActiveTab('overview')
      setMessage({ type: warnings ? 'warning' : 'success', text: warnings || 'Site removido' })
    } catch (err) {
      setMessage({ type: 'error', text: getErrorMessage(err, 'Erro ao excluir site') })
    } finally {
      setBusy('')
    }
  }

  const statusCounts = useMemo(() => {
    const running = sites.filter((site) => site.status === 'running').length
    return {
      total: sites.length,
      running,
      attention: sites.length - running,
    }
  }, [sites])

  return (
    <div className="space-y-5">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/70 p-4 sm:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-text-soft)]">Sites</p>
              <h1 className="mt-2 text-2xl font-semibold text-[var(--color-text)]">Publicação, CMS e migração</h1>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-box-muted)] px-3 py-2">
                  <p className="text-xs text-[var(--color-text-soft)]">Total</p>
                  <p className="text-lg font-semibold text-[var(--color-text)]">{statusCounts.total}</p>
                </div>
                <div className="rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 py-2">
                  <p className="text-xs text-emerald-200">Online</p>
                  <p className="text-lg font-semibold text-emerald-100">{statusCounts.running}</p>
                </div>
                <div className="rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2">
                  <p className="text-xs text-amber-200">Atenção</p>
                  <p className="text-lg font-semibold text-amber-100">{statusCounts.attention}</p>
                </div>
              </div>
              <Button type="button" variant="primary" leadingIcon={<Plus size={16} />} onClick={() => setActiveTab('create')}>
                Criar novo site
              </Button>
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {tabs.map((tab) => {
              const Icon = tab.icon
              const active = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex min-h-[44px] items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold transition ${
                    active
                      ? 'border-[var(--color-brand)] bg-[var(--color-brand)]/16 text-[var(--color-text)]'
                      : 'border-[var(--color-border-subtle)] bg-[var(--color-box-muted)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                  }`}
                >
                  <Icon size={16} />
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/70 p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-[var(--color-text)]">Site ativo</p>
            <Button type="button" size="sm" variant="ghost" leadingIcon={<RefreshCcw size={15} />} onClick={loadSites} loading={loading}>
              Atualizar
            </Button>
          </div>
          <select
            className="zeus-select"
            value={selectedSite?.id || ''}
            onChange={(event) => setSelectedSiteId(event.target.value)}
          >
            {sites.length === 0 ? <option value="">Nenhum site</option> : null}
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name} - {getSiteDisplayHost(site)}
              </option>
            ))}
          </select>
          {selectedSite ? (
            <div className="mt-4 space-y-2 text-sm text-[var(--color-text-muted)]">
              <div className="flex items-center justify-between gap-3">
                <span>Status</span>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${selectedSite.status === 'running' ? 'bg-emerald-500/12 text-emerald-200' : 'bg-amber-500/12 text-amber-200'}`}>
                  {selectedSite.status === 'running' ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
                  {selectedSite.status === 'running' ? 'Online' : 'Verificar'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Porta local</span>
                <span className="font-mono text-[var(--color-text)]">{selectedSite.port}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>{isProxyMode(selectedSite) ? 'Proxy temporário' : 'Domínio'}</span>
                <span className="truncate font-mono text-xs text-[var(--color-text)]">{getSiteDisplayHost(selectedSite)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Volume</span>
                <span className="truncate font-mono text-xs text-[var(--color-text)]">{selectedSite.paths?.wordpress || baseDir}</span>
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-text-muted)]">
              Nenhum WordPress criado ainda.
            </div>
          )}
        </div>
      </div>

      {message ? (
        <div className={`rounded-lg border px-4 py-3 text-sm ${
          message.type === 'error'
            ? 'border-rose-400/30 bg-rose-500/10 text-rose-100'
            : message.type === 'warning'
              ? 'border-amber-400/30 bg-amber-500/10 text-amber-100'
              : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'
        }`}>
          {message.text}
        </div>
      ) : null}

      {activeTab === 'overview' ? (
        <Panel
          title="Sites existentes"
          icon={LayoutList}
          action={
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="ghost" leadingIcon={<RefreshCcw size={15} />} onClick={loadSites} loading={loading}>
                Atualizar
              </Button>
              <Button type="button" size="sm" variant="primary" leadingIcon={<Plus size={15} />} onClick={() => setActiveTab('create')}>
                Criar novo site
              </Button>
            </div>
          }
        >
          {sites.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-box-muted)] p-6 text-sm text-[var(--color-text-muted)]">
              <p className="font-semibold text-[var(--color-text)]">Nenhum site cadastrado ainda.</p>
              <p className="mt-1">Crie um WordPress para liberar manutenção, backup, restauração e ajustes de perfil.</p>
              <Button type="button" className="mt-4" variant="primary" leadingIcon={<Plus size={16} />} onClick={() => setActiveTab('create')}>
                Criar novo site
              </Button>
            </div>
          ) : (
            <div className="grid gap-3">
              {sites.map((site) => (
                <article
                  key={site.id}
                  className={`rounded-lg border p-4 transition ${
                    selectedSite?.id === site.id
                      ? 'border-[var(--color-brand)] bg-[var(--color-brand)]/10'
                      : 'border-[var(--color-border-subtle)] bg-[var(--color-box-muted)]'
                  }`}
                >
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-base font-semibold text-[var(--color-text)]">{site.name}</h2>
                        <StatusPill ok={site.status === 'running'}>{site.status === 'running' ? 'Online' : 'Verificar'}</StatusPill>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[var(--color-text-muted)]">
                        <span className="inline-flex items-center gap-1">
                          <Globe size={14} />
                          {getSiteDisplayHost(site)}
                        </span>
                        {isProxyMode(site) ? <span className="rounded-full bg-blue-500/12 px-2 py-0.5 text-xs font-semibold text-blue-200">Proxy temporário</span> : null}
                        <span className="font-mono text-xs">:{site.port}</span>
                        <span>Criado {formatDateTime(site.createdAt)}</span>
                        <span>Backup {formatDateTime(site.lastBackup?.createdAt)}</span>
                      </div>
                      <div className="grid gap-2 text-xs sm:grid-cols-3">
                        <div className="rounded-lg border border-[var(--color-border-subtle)] bg-black/10 px-3 py-2">
                          <p className="text-[var(--color-text-soft)]">WordPress</p>
                          <p className="mt-1 font-semibold text-[var(--color-text)]">{site.wordpressStatus}</p>
                        </div>
                        <div className="rounded-lg border border-[var(--color-border-subtle)] bg-black/10 px-3 py-2">
                          <p className="text-[var(--color-text-soft)]">Banco</p>
                          <p className="mt-1 font-semibold text-[var(--color-text)]">{site.databaseStatus}</p>
                        </div>
                        <div className="rounded-lg border border-[var(--color-border-subtle)] bg-black/10 px-3 py-2">
                          <p className="text-[var(--color-text-soft)]">Última restauração</p>
                          <p className="mt-1 font-semibold text-[var(--color-text)]">{formatDateTime(site.lastMigration?.createdAt)}</p>
                        </div>
                      </div>
                    </div>

                    <div className="grid w-full shrink-0 grid-cols-2 gap-2 sm:grid-cols-3 xl:w-[360px] xl:grid-cols-2">
                      {site.url ? (
                        <a className="zeus-btn zeus-btn-secondary min-h-[36px] w-full justify-center px-3 py-2 text-xs" href={site.url} target="_blank" rel="noreferrer">
                          <ExternalLink size={14} />
                          Abrir
                        </a>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="w-full justify-center"
                        leadingIcon={<Wrench size={15} />}
                        onClick={() => {
                          setSelectedSiteId(site.id)
                          setActiveTab('operate')
                        }}
                      >
                        Manutenção
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="w-full justify-center"
                        leadingIcon={<FolderOpen size={15} />}
                        loading={busy === `wp-content-${site.id}`}
                        onClick={() => openWpContentStorage(site, '/')}
                      >
                        wp-content
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="w-full justify-center"
                        leadingIcon={<Download size={15} />}
                        loading={busy === `backup-${site.id}`}
                        onClick={() => generateBackup(site)}
                      >
                        Backup
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="w-full justify-center"
                        leadingIcon={<UploadCloud size={15} />}
                        onClick={() => {
                          setSelectedSiteId(site.id)
                          setActiveTab('migrate')
                        }}
                      >
                        Restaurar
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="danger"
                        className="w-full justify-center"
                        leadingIcon={<Trash2 size={15} />}
                        loading={busy === `delete-${site.id}`}
                        onClick={() => deleteSite(site)}
                      >
                        Remover
                      </Button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </Panel>
      ) : null}

      {activeTab === 'create' ? (
        <div className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
          <Panel title="Serviço" icon={Server}>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              {serviceOptions.map((service) => {
                const Icon = service.icon
                return (
                  <button
                    key={service.id}
                    type="button"
                    disabled={!service.active}
                    className={`flex min-h-[62px] items-center justify-between rounded-lg border px-4 text-left transition ${
                      service.active
                        ? 'border-cyan-400/40 bg-cyan-500/10 text-[var(--color-text)]'
                        : 'border-[var(--color-border-subtle)] bg-[var(--color-box-muted)] text-[var(--color-text-soft)] opacity-70'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <Icon className={service.accent} size={18} />
                      <span className="truncate text-sm font-semibold">{service.label}</span>
                    </span>
                    <span className="text-xs font-medium">{service.active ? 'Ativo' : 'Em breve'}</span>
                  </button>
                )
              })}
            </div>
          </Panel>

          <Panel
            title="Novo WordPress"
            icon={Globe}
            action={
              <Button type="button" size="sm" variant="ghost" onClick={() => setActiveTab('overview')}>
                Voltar para sites
              </Button>
            }
          >
            <form className="grid gap-4 lg:grid-cols-2" onSubmit={submitCreate}>
              <Field label="Cliente ou projeto">
                <Input value={createForm.name} onChange={(event) => handleCreateChange('name', event.target.value)} placeholder="cliente-site" required />
              </Field>
              <Field label="Domínio">
                <Input value={createForm.domain} onChange={(event) => handleCreateChange('domain', event.target.value)} placeholder="opcional: site.com.br" />
                <p className="text-xs text-[var(--color-text-soft)]">
                  Deixe vazio para criar com proxy temporário até apontar o domínio real.
                </p>
              </Field>
              <Field label="Path do proxy">
                <Input value={createForm.proxyPath} onChange={(event) => handleCreateChange('proxyPath', event.target.value)} placeholder="/bio" />
                <p className="text-xs text-[var(--color-text-soft)]">
                  Usado quando o domínio estiver vazio. Exemplo: /bio.
                </p>
              </Field>
              <Field label="Usuário admin">
                <Input value={createForm.adminUser} onChange={(event) => handleCreateChange('adminUser', event.target.value)} placeholder="admin" />
              </Field>
              <Field label="E-mail admin">
                <Input type="email" value={createForm.adminEmail} onChange={(event) => handleCreateChange('adminEmail', event.target.value)} placeholder="admin@site.com.br" />
              </Field>
              <Field label="Senha admin">
                <Input type="password" value={createForm.adminPassword} onChange={(event) => handleCreateChange('adminPassword', event.target.value)} placeholder="Gerar automaticamente" />
              </Field>
              <div className="flex items-center gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--color-text-muted)]">
                  <input
                    type="checkbox"
                    checked={createForm.ssl}
                    onChange={(event) => handleCreateChange('ssl', event.target.checked)}
                    className="h-4 w-4 rounded border-[var(--color-border)] accent-[var(--color-brand)]"
                  />
                  <Lock size={14} />
                  HTTPS (proxy reverso)
                </label>
              </div>
              <div className="flex items-end">
                <Button type="submit" variant="primary" className="w-full" leadingIcon={<Plus size={16} />} loading={busy === 'create'}>
                  Criar WordPress
                </Button>
              </div>
            </form>
            {creationProgress.length > 0 ? (
              <div className="mt-5 max-h-52 overflow-auto rounded-lg border border-[var(--color-border-subtle)] bg-black/20 p-3 font-mono text-xs text-[var(--color-text-muted)]">
                {creationProgress.map((line, index) => (
                  <p key={`${line}-${index}`}>{line}</p>
                ))}
              </div>
            ) : null}
          </Panel>
        </div>
      ) : null}

      {activeTab === 'migrate' ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <Panel title={selectedSite ? `Restaurar backup - ${selectedSite.name}` : 'Restaurar backup'} icon={FileArchive}>
            <form className="space-y-4" onSubmit={submitMigration}>
              <Field label="Arquivo">
                <input
                  className="zeus-input"
                  type="file"
                  accept=".zip,.tar,.tar.gz,.tgz,.sql"
                  onChange={handleMigrationFileChange}
                />
              </Field>
              {migrationFile ? (
                <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-box-muted)] px-4 py-3 text-sm text-[var(--color-text-muted)]">
                  <span className="font-medium text-[var(--color-text)]">{migrationFile.name}</span>
                  <span className="ml-2">{formatBytes(migrationFile.size)}</span>
                </div>
              ) : null}
              <div className="space-y-2">
                <div className="h-2 overflow-hidden rounded-full bg-[var(--color-box-muted)]">
                  <div className="h-full rounded-full bg-cyan-400 transition-all" style={{ width: `${migrationProgress}%` }} />
                </div>
                <div className="flex justify-between text-xs text-[var(--color-text-soft)]">
                  <span>{migrationStep || 'Aguardando arquivo'}</span>
                  <span>{migrationProgress}%</span>
                </div>
              </div>
              <Button
                type="submit"
                variant="primary"
                leadingIcon={<UploadCloud size={16} />}
                loading={busy === 'migration'}
                disabled={!selectedSite || selectedSite.databaseStatus !== 'running' || !migrationFile}
              >
                Restaurar backup
              </Button>
              {selectedSite && selectedSite.databaseStatus !== 'running' ? (
                <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                  Banco do site precisa estar em execução.
                </div>
              ) : null}
            </form>
          </Panel>

          <Panel title="Resultado" icon={CheckCircle2}>
            {migrationResult ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-box-muted)] px-3 py-2">
                    <p className="text-xs text-[var(--color-text-soft)]">SQL</p>
                    <p className="font-semibold text-[var(--color-text)]">{migrationResult.sqlFound ? 'Encontrado' : 'Ausente'}</p>
                  </div>
                  <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-box-muted)] px-3 py-2">
                    <p className="text-xs text-[var(--color-text-soft)]">wp-content</p>
                    <p className="font-semibold text-[var(--color-text)]">{migrationResult.wpContentFound ? 'Copiado' : 'Ausente'}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  {(migrationResult.actions || []).map((action, index) => (
                    <div key={`${action}-${index}`} className="flex items-start gap-2 text-sm text-[var(--color-text-muted)]">
                      <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-300" size={15} />
                      <span>{action}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-text-muted)]">
                O relatório aparece depois do processamento.
              </div>
            )}
          </Panel>
        </div>
      ) : null}

      {activeTab === 'operate' ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <Panel
            title={selectedSite ? `Manutenção - ${selectedSite.name}` : 'Manutenção'}
            icon={Settings2}
            action={selectedSite?.url ? (
              <a className="zeus-btn zeus-btn-secondary min-h-[36px] px-3 py-2 text-xs" href={selectedSite.url} target="_blank" rel="noreferrer">
                <ExternalLink size={14} />
                Abrir site
              </a>
            ) : null}
          >
            {selectedSite ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-box-muted)] p-4">
                  {isProxyMode(selectedSite) ? (
                    <div className="mb-3 rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs text-blue-100">
                      Sem domínio público definido. O site está configurado pelo proxy temporário <span className="font-mono text-white">{getSiteDisplayHost(selectedSite)}</span>.
                    </div>
                  ) : null}
                  <form className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_160px]" onSubmit={submitDomain}>
                    <Field label="Domínio">
                      <Input
                        value={domainForm.domain}
                        onChange={(event) => setDomainForm((current) => ({ ...current, domain: event.target.value }))}
                        placeholder={selectedSite.proxyHost || 'proxy temporário'}
                      />
                      <p className="text-xs text-[var(--color-text-soft)]">
                        Deixe vazio para manter o site pelo proxy temporário.
                      </p>
                    </Field>
                    <Field label="Path do proxy">
                      <Input
                        value={domainForm.proxyPath}
                        onChange={(event) => setDomainForm((current) => ({ ...current, proxyPath: event.target.value }))}
                        placeholder="/bio"
                      />
                      <p className="text-xs text-[var(--color-text-soft)]">
                        Usado apenas sem domínio.
                      </p>
                    </Field>
                    <div className="flex items-end">
                      <Button type="submit" variant="secondary" className="w-full" leadingIcon={<Globe size={16} />} loading={busy === 'domain'}>
                        Alterar
                      </Button>
                    </div>
                  </form>
                </div>

                <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-box-muted)] p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
                    <UserRound size={16} />
                    Usuário e perfil do WordPress
                  </div>
                  <form className="grid gap-3 lg:grid-cols-2" onSubmit={submitPasswordReset}>
                    <Field label="Usuário existente">
                      <Input value={passwordForm.username} onChange={(event) => setPasswordForm((current) => ({ ...current, username: event.target.value }))} />
                    </Field>
                    <Field label="Nova senha">
                      <Input type="password" value={passwordForm.password} onChange={(event) => setPasswordForm((current) => ({ ...current, password: event.target.value }))} placeholder="Manter senha atual" />
                    </Field>
                    <Field label="E-mail">
                      <Input type="email" value={passwordForm.email} onChange={(event) => setPasswordForm((current) => ({ ...current, email: event.target.value }))} placeholder="usuario@site.com.br" />
                    </Field>
                    <Field label="Nome de exibição">
                      <Input value={passwordForm.displayName} onChange={(event) => setPasswordForm((current) => ({ ...current, displayName: event.target.value }))} placeholder="Nome público" />
                    </Field>
                    <Field label="Nome">
                      <Input value={passwordForm.firstName} onChange={(event) => setPasswordForm((current) => ({ ...current, firstName: event.target.value }))} />
                    </Field>
                    <Field label="Sobrenome">
                      <Input value={passwordForm.lastName} onChange={(event) => setPasswordForm((current) => ({ ...current, lastName: event.target.value }))} />
                    </Field>
                    <div className="flex items-center gap-3 lg:col-span-2">
                      <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--color-text-muted)]">
                        <input
                          type="checkbox"
                          checked={passwordForm.generatePassword}
                          onChange={(event) => setPasswordForm((current) => ({ ...current, generatePassword: event.target.checked }))}
                          className="h-4 w-4 rounded border-[var(--color-border)] accent-[var(--color-brand)]"
                        />
                        <KeyRound size={14} />
                        Gerar senha automaticamente
                      </label>
                    </div>
                    <div className="flex items-end lg:col-span-2">
                      <Button type="submit" variant="secondary" className="w-full sm:w-auto" leadingIcon={<KeyRound size={16} />} loading={busy === 'password'}>
                        Atualizar usuário
                      </Button>
                    </div>
                  </form>
                </div>

                {generatedPassword ? (
                  <div className="rounded-lg border border-cyan-400/20 bg-cyan-500/10 p-3 text-sm text-cyan-100">
                    <p className="font-semibold">{generatedPassword.username}</p>
                    <p className="mt-1 break-all font-mono">{generatedPassword.password}</p>
                  </div>
                ) : null}

                <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-box-muted)] p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
                    <FolderOpen size={16} />
                    Arquivos do wp-content
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" leadingIcon={<FolderOpen size={16} />} loading={busy === `wp-content-${selectedSite.id}`} onClick={() => openWpContentStorage(selectedSite, '/')}>
                      Abrir wp-content
                    </Button>
                    <Button type="button" variant="ghost" loading={busy === `wp-content-${selectedSite.id}`} onClick={() => openWpContentStorage(selectedSite, '/themes')}>
                      Temas
                    </Button>
                    <Button type="button" variant="ghost" loading={busy === `wp-content-${selectedSite.id}`} onClick={() => openWpContentStorage(selectedSite, '/plugins')}>
                      Plugins
                    </Button>
                    <Button type="button" variant="ghost" loading={busy === `wp-content-${selectedSite.id}`} onClick={() => openWpContentStorage(selectedSite, '/uploads')}>
                      Uploads
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" leadingIcon={<Download size={16} />} loading={busy === `backup-${selectedSite.id}`} onClick={() => generateBackup(selectedSite)}>
                    Fazer backup
                  </Button>
                  <Button type="button" variant="secondary" leadingIcon={<Database size={16} />} loading={busy === 'optimize'} onClick={optimizeDatabase}>
                    Otimizar banco
                  </Button>
                  <Button type="button" variant="secondary" leadingIcon={<Shield size={16} />} loading={busy === 'fix-permissions'} onClick={fixPermissions}>
                    Corrigir permissões
                  </Button>
                  <Button type="button" variant="secondary" leadingIcon={<RefreshCcw size={16} />} loading={busy === 'cleanup-cache'} onClick={cleanupCache}>
                    Limpar cache WP
                  </Button>
                  {!selectedSite.ssl ? (
                    <Button type="button" variant="secondary" leadingIcon={<Lock size={16} />} loading={busy === 'fix-ssl'} onClick={fixSsl}>
                      Ativar HTTPS
                    </Button>
                  ) : (
                    <Button type="button" variant="ghost" leadingIcon={<Lock size={16} />} loading={busy === 'disable-ssl'} onClick={disableSsl}>
                      Desativar HTTPS
                    </Button>
                  )}
                  <Button type="button" variant="ghost" leadingIcon={<RefreshCcw size={16} />} onClick={loadSites} loading={loading}>
                    Recarregar status
                  </Button>
                  <Button type="button" variant="danger" leadingIcon={<Trash2 size={16} />} loading={busy === `delete-${selectedSite.id}`} onClick={() => deleteSite(selectedSite)}>
                    Remover site
                  </Button>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-text-muted)]">
                Crie um site WordPress para liberar as ações.
              </div>
            )}
          </Panel>

          <Panel title="Inventário" icon={Database}>
            {selectedSite ? (
              <div className="space-y-3 text-sm">
                <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-box-muted)] p-3">
                  <p className="text-xs text-[var(--color-text-soft)]">Containers</p>
                  <p className="mt-2 text-[var(--color-text)]">WordPress: {selectedSite.wordpressStatus}</p>
                  <p className="text-[var(--color-text)]">Banco: {selectedSite.databaseStatus}</p>
                </div>
                <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-box-muted)] p-3">
                  <p className="text-xs text-[var(--color-text-soft)]">Banco</p>
                  <p className="mt-2 font-mono text-xs text-[var(--color-text)]">{selectedSite.database?.name}</p>
                </div>
                <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-box-muted)] p-3">
                  <p className="text-xs text-[var(--color-text-soft)]">Nginx</p>
                  <p className="mt-2 font-mono text-xs text-[var(--color-text)]">{selectedSite.nginxConfigName || 'pendente'}</p>
                  {selectedSite.proxyHost ? (
                    <p className="mt-1 break-all font-mono text-[10px] text-[var(--color-text-soft)]">Proxy: {getSiteDisplayHost(selectedSite)}</p>
                  ) : null}
                </div>
                <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-box-muted)] p-3">
                  <p className="text-xs text-[var(--color-text-soft)]">wp-content</p>
                  <p className="mt-2 break-all font-mono text-xs text-[var(--color-text)]">{selectedSite.wpContentStorage?.basePath || selectedSite.paths?.wpContent || `${selectedSite.paths?.wordpress || ''}/wp-content`}</p>
                  <p className="mt-1 break-all font-mono text-[10px] text-[var(--color-text-soft)]">{selectedSite.wpContentStorage?.environmentId || 'ambiente ainda não criado'}</p>
                </div>
                <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-box-muted)] p-3">
                  <p className="text-xs text-[var(--color-text-soft)]">Rotinas</p>
                  <p className="mt-2 text-[var(--color-text)]">Backup: {formatDateTime(selectedSite.lastBackup?.createdAt)}</p>
                  <p className="text-[var(--color-text)]">Banco otimizado: {formatDateTime(selectedSite.lastDbOptimizeAt)}</p>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-text-muted)]">
                Inventário vazio.
              </div>
            )}
          </Panel>
        </div>
      ) : null}

      {busy ? (
        <div className="fixed bottom-4 right-4 z-30 flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-4 py-3 text-sm text-[var(--color-text)] shadow-lg">
          <LoaderCircle className="animate-spin" size={16} />
          Processando
        </div>
      ) : null}
    </div>
  )
}

export default SitesPanel
