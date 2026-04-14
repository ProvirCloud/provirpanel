import type { ReactNode } from 'react'

import PageHeader from '../components/layout/PageHeader'
import Card from '../components/ui/Card'

type ConsoleModulePageProps = {
  title: string
  subtitle: string
  children: ReactNode
}

const ConsoleModulePage = ({ title, subtitle, children }: ConsoleModulePageProps) => {
  return (
    <div className="space-y-8">
      <PageHeader title={title} subtitle={subtitle} />
      <Card className="overflow-hidden border-white/8 bg-[#0f1522]/92 p-0">
        {children}
      </Card>
    </div>
  )
}

export default ConsoleModulePage
