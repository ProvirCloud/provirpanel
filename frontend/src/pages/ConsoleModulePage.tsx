import type { ReactNode } from 'react'
import PageHeader from '../components/layout/PageHeader'
import Card from '../components/ui/Card'

type ConsoleModulePageProps = {
  title: string
  subtitle: string
  children: ReactNode
  showHeader?: boolean
}

const ConsoleModulePage = ({ title, subtitle, children, showHeader = true }: ConsoleModulePageProps) => {
  return (
    <div className={showHeader ? 'space-y-8' : 'space-y-0'}>
      {showHeader ? <PageHeader title={title} subtitle={subtitle} /> : null}
      {showHeader ? <Card className="zeus-module-scope overflow-hidden p-0">{children}</Card> : children}
    </div>
  )
}

export default ConsoleModulePage
