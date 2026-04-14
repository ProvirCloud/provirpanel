import Card from '../ui/Card'

type MetricCardProps = {
  label: string
  value: string | number
  hint?: string
}

const MetricCard = ({ label, value, hint }: MetricCardProps) => {
  return (
    <Card className="p-5">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <p className="mt-4 text-3xl font-semibold tracking-[-0.05em] text-white">{value}</p>
      {hint ? <p className="mt-2 text-sm text-slate-400">{hint}</p> : null}
    </Card>
  )
}

export default MetricCard
