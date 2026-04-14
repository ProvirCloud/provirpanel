import { useEffect, useMemo, useState } from 'react'
import { Layers3, Sparkles } from 'lucide-react'

import api from '../services/api.js'
import MetricsRow from '../components/dashboard/MetricsRow'
import StackGrid from '../components/dashboard/StackGrid'
import Button from '../components/ui/Button'
import SectionContainer from '../components/ui/SectionContainer'
import PageHeader from '../components/layout/PageHeader'
import EmptyState from '../components/ui/EmptyState'
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
  const [stacks, setStacks] = useState<Stack[]>([])
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
        const nextStacks = Array.isArray(response.data) ? response.data.map(mapStack) : []
        setStacks(nextStacks)
      } catch {
        if (!active) return
        setError('Não foi possível carregar as stacks do backend.')
      } finally {
        if (active) setLoading(false)
      }
    }

    loadStacks()
    return () => { active = false }
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
        subtitle="Ambientes Docker agrupados de serviços e aplicações"
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
          <div className="rounded-3xl border border-white/8 bg-white/[0.02] px-6 py-16 text-center text-slate-400">
            Carregando stacks do ambiente...
          </div>
        ) : error ? (
          <EmptyState title="Falha ao carregar stacks" description={error} action={<Button variant="secondary" onClick={() => window.location.reload()}>Tentar novamente</Button>} />
        ) : (
          <StackGrid stacks={stacks} />
        )}
      </SectionContainer>
    </div>
  )
}

export default InfrastructureCanvasPage
