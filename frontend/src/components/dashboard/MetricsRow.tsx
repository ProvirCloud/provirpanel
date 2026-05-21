import MetricCard from './MetricCard'

type Metric = {
  label: string
  value: string | number
  hint?: string
}

type MetricsRowProps = {
  metrics: Metric[]
}

const MetricsRow = ({ metrics }: MetricsRowProps) => {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map((metric) => (
        <MetricCard key={metric.label} {...metric} />
      ))}
    </div>
  )
}

export default MetricsRow
