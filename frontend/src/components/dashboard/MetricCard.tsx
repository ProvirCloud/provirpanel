import Card from '../ui/Card'

type MetricCardProps = {
  label: string
  value: string | number
  hint?: string
}

const MetricCard = ({ label, value, hint }: MetricCardProps) => {
  return (
    <Card className="p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--metric-label)]">{label}</p>
      <p className="mt-4 text-3xl font-bold tracking-[-0.05em] text-[var(--metric-value)]">{value}</p>
      {hint ? <p className="mt-2 text-sm text-[var(--color-text-muted)]">{hint}</p> : null}
    </Card>
  )
}

export default MetricCard
