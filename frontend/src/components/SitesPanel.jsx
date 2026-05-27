import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  ExternalLink,
  FileArchive,
  Globe,
  KeyRound,
  LoaderCircle,
  Plus,
  RefreshCcw,
  Server,
  Settings2,
  Shield,
  UploadCloud,
  Wrench,
} from 'lucide-react'
import api, { uploadApi } from '../services/api.js'
import Button from './ui/Button'
import Input from './ui/Input'

const CHUNKED_UPLOAD_THRESHOLD_BYTES = 50 * 1024 * 1024
const UPLOAD_CHUNK_SIZE_BYTES = 25 * 1024 * 1024

const defaultCreateForm = {
  name: '',
  domain: '',
  adminUser: 'admin',
  adminEmail: '',
  adminPassword: '',
}

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
  { id: 'create', label: 'Criar', icon: Plus },
  { id: 'migrate', label: 'Migrar', icon: UploadCloud },
  { id: 'operate', label: 'Operar', icon: Wrench },
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

const formatBytes = (value) => {
  const bytes = Number(value || 0)
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

const getErrorMessage = (err, fallback) =>
  err?.response?.data?.message || err?.response?.data?.error || err?.message || fallback

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
  const totalChunks = Math.ceil(file.size / UPLOAD_CHUNK_SIZE_BYTES)
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
          onProgress?.(Math.min(99, Math.round((loaded / file.size) * 100)), chunkIndex + 1, totalChunks)
        },
      }
    )
    onProgress?.(Math.min(99, Math.round((end / file.size) * 100)), chunkIndex + 1, totalChunks)
  }

  return uploadApi.post(`/sites/${siteId}/migrate/complete`, { uploadId }, { timeout: 900000 })
}

const SitesPanel = () => {
  const [activeTab, setActiveTab] = useState('create')
  const [sites, setSites] = useState([])
  const [baseDir, setBaseDir] = useState('')
  const [selectedSiteId, setSelectedSiteId] = useState('')
  const [createForm, setCreateForm] = useState(defaultCreateForm)
  const [domainForm, setDomainForm] = useState({ domain: '' })
  const [passwordForm, setPasswordForm] = useState({ username: 'admin', password: '' })
  const [migrationFile, setMigrationFile] = useState(null)
  const [migrationProgress, setMigrationProgress] = useState(0)
  const [migrationStep, setMigrationStep] = useState('')
  const [creationProgress, setCreationProgress] = useState([])
  const [migrationResult, setMigrationResult] = useState(null)
  const [generatedPassword, setGeneratedPassword] = useState(null)
  const [message, setMessage] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')

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
      setSelectedSiteId((current) => current || nextSites[0]?.id || '')
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
    setDomainForm({ domain: selectedSite.domain || '' })
    setPasswordForm((current) => ({
      ...current,
      username: selectedSite.wordpress?.adminUser || 'admin',
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
    setBusy('password')
    setMessage(null)
    setGeneratedPassword(null)
    try {
      const response = await api.post(`/sites/${selectedSite.id}/reset-password`, passwordForm)
      setGeneratedPassword({ username: response.data.username, password: response.data.password })
      setSites((current) => current.map((site) => (site.id === response.data.site.id ? response.data.site : site)))
      setPasswordForm((current) => ({ ...current, password: '' }))
      setMessage({ type: 'success', text: 'Senha do WordPress atualizada' })
    } catch (err) {
      setMessage({ type: 'error', text: getErrorMessage(err, 'Erro ao resetar senha') })
    } finally {
      setBusy('')
    }
  }

  const optimizeDatabase = async () => {
    if (!selectedSite) return
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

  const submitMigration = async (event) => {
    event.preventDefault()
    if (!selectedSite || !migrationFile) return
    setBusy('migration')
    setMessage(null)
    setMigrationResult(null)
    setMigrationProgress(0)
    setMigrationStep('Preparando upload')
    try {
      let response
      if (migrationFile.size >= CHUNKED_UPLOAD_THRESHOLD_BYTES) {
        response = await uploadFileInChunks({
          siteId: selectedSite.id,
          file: migrationFile,
          onProgress: (progress, chunkIndex, totalChunks) => {
            setMigrationProgress(progress)
            setMigrationStep(`Enviando parte ${chunkIndex}/${totalChunks}`)
          },
        })
      } else {
        const formData = new FormData()
        formData.append('backup', migrationFile)
        response = await uploadApi.post(`/sites/${selectedSite.id}/migrate`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 900000,
          onUploadProgress: (event) => {
            if (!event.total) return
            setMigrationProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)))
          },
        })
      }
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
                {site.name} - {site.domain}
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

          <Panel title="Novo WordPress" icon={Globe}>
            <form className="grid gap-4 lg:grid-cols-2" onSubmit={submitCreate}>
              <Field label="Cliente ou projeto">
                <Input value={createForm.name} onChange={(event) => handleCreateChange('name', event.target.value)} placeholder="cliente-site" required />
              </Field>
              <Field label="Domínio">
                <Input value={createForm.domain} onChange={(event) => handleCreateChange('domain', event.target.value)} placeholder="site.com.br" required />
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
          <Panel title="Migração WordPress" icon={FileArchive}>
            <form className="space-y-4" onSubmit={submitMigration}>
              <Field label="Arquivo">
                <input
                  className="zeus-input"
                  type="file"
                  accept=".zip,.tar,.tar.gz,.tgz,.sql"
                  onChange={(event) => setMigrationFile(event.target.files?.[0] || null)}
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
                disabled={!selectedSite || !migrationFile}
              >
                Aplicar migração
              </Button>
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
            title="Operação"
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
                <form className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_160px]" onSubmit={submitDomain}>
                  <Field label="Domínio">
                    <Input value={domainForm.domain} onChange={(event) => setDomainForm({ domain: event.target.value })} required />
                  </Field>
                  <div className="flex items-end">
                    <Button type="submit" variant="secondary" className="w-full" leadingIcon={<Globe size={16} />} loading={busy === 'domain'}>
                      Alterar
                    </Button>
                  </div>
                </form>

                <form className="grid gap-3 lg:grid-cols-[1fr_1fr_160px]" onSubmit={submitPasswordReset}>
                  <Field label="Usuário">
                    <Input value={passwordForm.username} onChange={(event) => setPasswordForm((current) => ({ ...current, username: event.target.value }))} />
                  </Field>
                  <Field label="Nova senha">
                    <Input type="password" value={passwordForm.password} onChange={(event) => setPasswordForm((current) => ({ ...current, password: event.target.value }))} placeholder="Gerar automaticamente" />
                  </Field>
                  <div className="flex items-end">
                    <Button type="submit" variant="secondary" className="w-full" leadingIcon={<KeyRound size={16} />} loading={busy === 'password'}>
                      Resetar
                    </Button>
                  </div>
                </form>

                {generatedPassword ? (
                  <div className="rounded-lg border border-cyan-400/20 bg-cyan-500/10 p-3 text-sm text-cyan-100">
                    <p className="font-semibold">{generatedPassword.username}</p>
                    <p className="mt-1 break-all font-mono">{generatedPassword.password}</p>
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" leadingIcon={<Database size={16} />} loading={busy === 'optimize'} onClick={optimizeDatabase}>
                    Otimizar banco
                  </Button>
                  <Button type="button" variant="ghost" leadingIcon={<RefreshCcw size={16} />} onClick={loadSites} loading={loading}>
                    Recarregar status
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
