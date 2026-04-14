import { useEffect, useMemo, useState } from 'react'
import { Layers3, Sparkles } from 'lucide-react'
import api from '../services/api.js'
import MetricsRow from '../components/dashboard/MetricsRow'
import StackGrid from '../components/dashboard/StackGrid'
import Button from '../components/ui/Button'
import SectionContainer from '../components/ui/SectionContainer'
import PageHeader from '../components/layout/PageHeader'
import EmptyState from '../components/ui/EmptyState'
import { mockStacks } from '../data/mockStacks'
import type { Stack, StackStatus } from '../types/stack'

type BackendService = {
  id: string
  name?: string
  status?: string
}

type BackendStack = {
  id: string
  name?: string
  client?: string
  environment?: string
  network?: string
  services?: BackendService[]
}

const normalizeStatus = (services: BackendService[]): StackStatus => {
  const running = services.filter((service) => service.status === 'running').length
  if (services.length === 0 || running === 0) return 'stopped'
  if (running === services.length) return 'running'
  return 'partial'
}

const mapStack = (stack: BackendStack): Stack => {
  const services = stack.services || []
  const runningServices = services.filter((service) => service.status === 'running').length

  return {
    id: stack.id,
    name: stack.name || 'Stack sem nome',
    project: stack.client || 'Sem projeto',
    environment: stack.environment || 'N/D',
    services: services.map((service) => service.name || 'serviço').filter(Boolean),
    totalServices: services.length,
    runningServices,
    network: stack.network || undefined,
    status: normalizeStatus(services),
  }
}

const InfrastructureCanvasPage = () => {
  const [stacks, setStacks] = useState<Stack[]>(mockStacks)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    const loadStacks = async () => {
      setLoading(true)
      setError('')
      try {
        const response = await api.get('/stacks')
        if (!active) return
        const nextStacks = Array.isArray(response.data) && response.data.length ? response.data.map(mapStack) : mockStacks
        setStacks(nextStacks)
      } catch {
        if (!active) return
        setError('Não foi possível carregar as stacks do backend. Exibindo cenário de referência da plataforma.')
        setStacks(mockStacks)
      } finally {
        if (active) setLoading(false)
      }
    }

    loadStacks()
    return () => {
      active = false
    }
  }, [])

  const metrics = useMemo(() => [
    { label: 'Total de Stacks', value: stacks.length },
    { label: 'Rodando', value: stacks.filter((stack) => stack.status === 'running').length },
    { label: 'Parciais', value: stacks.filter((stack) => stack.status === 'partial').length },
    { label: 'Serviços', value: stacks.reduce((total, stack) => total + stack.totalServices, 0) },
  ], [stacks])

  return (
    <div className="space-y-8">
      <PageHeader
        title="Infrastructure Canvas"
        subtitle="Ambientes Docker agrupados de serviços e aplicações. Visualize o estado operacional de cada stack com contexto, prioridade e ações rápidas."
        actions={(
          <>
            <Button variant="secondary" leadingIcon={<Sparkles size={15} />}>Blueprints</Button>
            <Button variant="primary" leadingIcon={<Layers3 size={15} />}>Nova Stack</Button>
          </>
        )}
      />

      <MetricsRow metrics={metrics} />

      <SectionContainer
        title="Stacks em operação"
        subtitle="Visualize rapidamente o estado de cada ambiente, seus serviços e ações prioritárias."
      >
        {loading ? (
          <div className="rounded-[24px] border px-6 py-16 text-center text-[var(--color-text-muted)]" style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel-muted)' }}>
            Carregando stacks do ambiente...
          </div>
        ) : stacks.length ? (
          <StackGrid stacks={stacks} />
        ) : (
          <EmptyState title="Nenhuma stack encontrada" description="Assim que novas stacks forem criadas, elas aparecerão aqui com status, serviços e ações operacionais." />
        )}
      </SectionContainer>

      {error ? (
        <div className="rounded-[20px] border px-4 py-3 text-sm" style={{ borderColor: 'var(--color-warning)', background: 'var(--color-warning-soft)', color: 'var(--color-warning)' }}>
          {error}
        </div>
      ) : null}
    </div>
  )
}

export default InfrastructureCanvasPage
