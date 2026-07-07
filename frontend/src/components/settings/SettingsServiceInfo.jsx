import { Server, Package, Globe2, Copy } from 'lucide-react'

const Badge = ({ children, variant = 'default' }) => {
  const cls = variant === 'success'
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
    : variant === 'warn'
      ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
      : 'border-slate-700 bg-slate-900 text-slate-300'
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>
}

const Row = ({ label, value, mono }) => (
  <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
    <span className="text-xs text-slate-500">{label}</span>
    <span className={`text-sm text-slate-200 ${mono ? 'font-mono' : ''} truncate max-w-[60%] text-right`}>{value || '—'}</span>
  </div>
)

const SettingsServiceInfo = ({ service }) => {
  const env = service.environment || service.env || 'PROD'
  const version = service.activeVersion || service.versionLabel || '—'
  const runtime = service.runtime || service.buildType || '—'
  const status = service.containerStatus || service.status || '—'

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
      <div className="mb-4 flex items-center gap-2">
        <Server className="h-4 w-4 text-blue-300" />
        <h2 className="text-sm font-semibold text-white">Informações do Serviço</h2>
      </div>
      <div className="grid gap-2">
        <Row label="Nome" value={service.name} mono />
        <Row label="Ambiente" value={<Badge variant={env === 'PROD' ? 'warn' : 'default'}>{env}</Badge>} />
        <Row label="Status" value={<Badge variant={String(status).includes('Up') ? 'success' : 'default'}>{status}</Badge>} />
        <Row label="Versão ativa" value={version} />
        <Row label="Runtime" value={runtime} />
        <Row label="Imagem Docker" value={service.image} mono />
      </div>
    </section>
  )
}

export default SettingsServiceInfo
