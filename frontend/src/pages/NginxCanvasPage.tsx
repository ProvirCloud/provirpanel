import { useEffect, useMemo, useState } from 'react'
import { LayoutGrid, List, Network, Plus, RefreshCw, ShieldAlert } from 'lucide-react'
import api from '../services/api.js'
import MetricsRow from '../components/dashboard/MetricsRow'
import Button from '../components/ui/Button'
import SectionContainer from '../components/ui/SectionContainer'
import PageHeader from '../components/layout/PageHeader'
import EmptyState from '../components/ui/EmptyState'
import SiteCard from '../components/nginx/SiteCard'
import SiteModal from '../components/nginx/SiteModal'
import SiteEditForm from '../components/nginx/SiteEditForm'
import NginxConfigFileEditor from '../components/nginx/NginxConfigFileEditor'
import NginxTopologyDiagram from '../components/nginx/NginxTopologyDiagram'
import NginxFilesView from '../components/nginx/NginxFilesView'
import type { BackendConfig, DockerContainer, NginxSite } from '../types/nginx'
import { extractSiteInfo } from '../types/nginx'

type ViewMode = 'topology' | 'cards' | 'files'
type ModalMode = 'create' | 'edit' | 'raw' | null

const NginxCanvasPage = () => {
  const [sites, setSites] = useState<NginxSite[]>([])
  const [nginxStatus, setNginxStatus] = useState<{ running: boolean } | null>(null)
  const [dockerContainers, setDockerContainers] = useState<DockerContainer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [modalMode, setModalMode] = useState<ModalMode>(null)
  const [editingSite, setEditingSite] = useState<NginxSite | null>(null)
  const [busyToggle, setBusyToggle] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('files')

  const loadAll = async () => {
    setLoading(true)
    setError('')
    try {
      const [statusRes, configsRes, dockerRes] = await Promise.all([
        api.get('/nginx/status'),
        api.get('/nginx/configs'),
        api.get('/nginx/docker-containers').catch(() => ({ data: { containers: [] } })),
      ])
      setNginxStatus(statusRes.data)
      setDockerContainers(dockerRes.data.containers || [])
      const configs: BackendConfig[] = configsRes.data.configs || []
      setSites(configs.filter((c) => c.readable !== false).map(extractSiteInfo))
    } catch (err: any) {
      setError(err.response?.data?.error || err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
  }, [])

  const handleToggle = async (site: NginxSite) => {
    setBusyToggle(site.name)
    setNotice('')
    try {
      if (site.enabled) {
        await api.post(`/nginx/configs/${site.name}/disable`)
        setNotice(`"${site.displayName}" desativado.`)
      } else {
        await api.post(`/nginx/configs/${site.name}/enable`)
        setNotice(`"${site.displayName}" ativado.`)
      }
      await loadAll()
    } catch (err: any) {
      setError(err.response?.data?.error || err.message)
    } finally {
      setBusyToggle(null)
    }
  }

  const handleDelete = async (site: NginxSite) => {
    if (!window.confirm(`Remover "${site.displayName}"? Esta ação não pode ser desfeita.`)) return
    setNotice('')
    try {
      await api.delete(`/nginx/configs/${site.name}`)
      setNotice(`"${site.displayName}" removido.`)
      await loadAll()
    } catch (err: any) {
      setError(err.response?.data?.error || err.message)
    }
  }

  const handleEdit = (site: NginxSite) => {
    setEditingSite(site)
    setModalMode('edit')
  }

  const handleCreate = () => {
    setEditingSite(null)
    setModalMode('create')
  }

  const handleOpenRawEditor = (site: NginxSite) => {
    setEditingSite(site)
    setModalMode('raw')
  }

  const handleModalClose = () => {
    setModalMode(null)
    setEditingSite(null)
  }

  const handleModalSave = async () => {
    setModalMode(null)
    setEditingSite(null)
    setNotice(editingSite ? `"${editingSite.displayName}" atualizado.` : 'Site criado com sucesso.')
    await loadAll()
  }

  const metrics = useMemo(
    () => [
      { label: 'Sites configurados', value: sites.length },
      { label: 'Ativos', value: sites.filter((s) => s.enabled).length },
      { label: 'Com SSL', value: sites.filter((s) => s.sslEnabled).length },
      {
        label: 'Nginx',
        value: nginxStatus === null ? '—' : nginxStatus.running ? 'Online' : 'Offline',
        hint: nginxStatus?.running ? undefined : nginxStatus === null ? undefined : 'Serviço parado',
      },
    ],
    [sites, nginxStatus],
  )

  return (
    <div className="space-y-8">
      <PageHeader
        title="Nginx Canvas"
        subtitle="Visualize e configure o servidor web por camadas — do tráfego de entrada ao destino final. Clique em um virtual host para editar."
        actions={
          <>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <Button
                variant={viewMode === 'files' ? 'secondary' : 'ghost'}
                size="sm"
                leadingIcon={<List size={14} />}
                onClick={() => setViewMode('files')}
              >
                Arquivos
              </Button>
              <Button
                variant={viewMode === 'topology' ? 'secondary' : 'ghost'}
                size="sm"
                leadingIcon={<Network size={14} />}
                onClick={() => setViewMode('topology')}
              >
                Topologia
              </Button>
              <Button
                variant={viewMode === 'cards' ? 'secondary' : 'ghost'}
                size="sm"
                leadingIcon={<LayoutGrid size={14} />}
                onClick={() => setViewMode('cards')}
              >
                Cards
              </Button>
            </div>
            <Button variant="secondary" leadingIcon={<RefreshCw size={15} />} onClick={loadAll}>
              Atualizar
            </Button>
            <Button variant="primary" leadingIcon={<Plus size={15} />} onClick={handleCreate}>
              Novo Site
            </Button>
          </>
        }
      />

      <MetricsRow metrics={metrics} />

      {/* ── Files view (default) ────────────────────────────────────────── */}
      {viewMode === 'files' && !loading && (
        <SectionContainer title="Configurações" subtitle="Cada arquivo separado com sua topologia interna">
          {sites.length ? (
            <NginxFilesView
              sites={sites}
              nginxRunning={nginxStatus?.running ?? false}
              onEditSite={handleEdit}
              onToggleSite={handleToggle}
              onDeleteSite={handleDelete}
              onViewRawConfig={handleOpenRawEditor}
              busyToggle={busyToggle}
            />
          ) : (
            <EmptyState
              title="Nenhum site configurado"
              description="Crie sua primeira configuração de proxy reverso, load balancer ou site estático."
              action={
                <Button variant="primary" leadingIcon={<Plus size={15} />} onClick={handleCreate}>
                  Novo Site
                </Button>
              }
            />
          )}
        </SectionContainer>
      )}

      {/* ── Topology view ───────────────────────────────────────────────── */}
      {viewMode === 'topology' && !loading && (
        <NginxTopologyDiagram
          sites={sites}
          nginxRunning={nginxStatus?.running ?? false}
          onEditSite={handleEdit}
          onToggleSite={handleToggle}
          onDeleteSite={handleDelete}
          onCreateSite={handleCreate}
          busyToggle={busyToggle}
        />
      )}

      {/* ── Cards view ──────────────────────────────────────────────────── */}
      {viewMode === 'cards' && (
        <SectionContainer
          title="Sites e rotas"
          subtitle="Cada card representa um virtual host com seu fluxo de tráfego — do cliente ao destino."
        >
          {loading ? (
            <div
              className="rounded-[24px] border px-6 py-16 text-center text-[var(--color-text-muted)]"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel-muted)' }}
            >
              Carregando configurações do Nginx...
            </div>
          ) : sites.length ? (
            <div className="grid gap-4 xl:grid-cols-2">
              {sites.map((site) => (
                <SiteCard
                  key={site.name}
                  site={site}
                  onEdit={handleEdit}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                  onViewRawConfig={handleOpenRawEditor}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title="Nenhum site configurado"
              description="Crie sua primeira configuração de proxy reverso, load balancer ou site estático."
              action={
                <Button variant="primary" leadingIcon={<Plus size={15} />} onClick={handleCreate}>
                  Novo Site
                </Button>
              }
            />
          )}
        </SectionContainer>
      )}

      {/* ── Loading state ───────────────────────────────────────────────── */}
      {(viewMode === 'topology' || viewMode === 'files') && loading && (
        <div
          className="rounded-[24px] border px-6 py-16 text-center text-[var(--color-text-muted)]"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel-muted)' }}
        >
          Carregando configurações do Nginx...
        </div>
      )}

      {notice && (
        <div
          className="rounded-[20px] border px-4 py-3 text-sm"
          style={{
            borderColor: 'var(--color-success)',
            background: 'var(--color-success-soft)',
            color: 'var(--color-success)',
          }}
        >
          {notice}
        </div>
      )}

      {error && (
        <div
          className="rounded-[20px] border px-4 py-3 text-sm flex items-start gap-2"
          style={{
            borderColor: 'var(--color-danger)',
            background: 'var(--color-danger-soft)',
            color: 'var(--color-danger)',
          }}
        >
          <ShieldAlert size={16} className="flex-shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* Create modal (wizard) */}
      {modalMode === 'create' && (
        <SiteModal
          site={null}
          dockerContainers={dockerContainers}
          onClose={handleModalClose}
          onSave={handleModalSave}
        />
      )}

      {/* Edit modal (simple form) */}
      {modalMode === 'edit' && editingSite && (
        <SiteEditForm
          site={editingSite}
          onClose={handleModalClose}
          onSave={handleModalSave}
          onOpenRawEditor={() => setModalMode('raw')}
        />
      )}

      {/* Raw config file editor */}
      {modalMode === 'raw' && editingSite && (
        <NginxConfigFileEditor
          site={editingSite}
          onClose={handleModalClose}
          onSave={handleModalSave}
        />
      )}
    </div>
  )
}

export default NginxCanvasPage
