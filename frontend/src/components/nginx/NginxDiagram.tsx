import React, { useState } from 'react'
import NginxNode from './NginxNode'
import type { DomainNode, SelectionPath } from '../types/nginxConfig'

type ExpandedState = Record<string, boolean>

type NginxDiagramProps = {
  domains: DomainNode[]
  selectedPath: SelectionPath
  onSelectNode: (path: SelectionPath) => void
}

const NginxDiagram: React.FC<NginxDiagramProps> = ({ domains, selectedPath, onSelectNode }) => {
  const [expanded, setExpanded] = useState<ExpandedState>({})

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => ({
      ...prev,
      [id]: !prev[id],
    }))
  }

  const isNodeSelected = (id: string): boolean => {
    return (
      selectedPath.domainId === id ||
      selectedPath.serverId === id ||
      selectedPath.locationId === id ||
      selectedPath.upstreamId === id ||
      selectedPath.ruleId === id
    )
  }

  return (
    <div className="h-full overflow-y-auto p-4 bg-slate-950/50">
      <div className="space-y-2">
        {domains.map((domain) => (
          <div key={domain.id}>
            <NginxNode
              node={domain}
              isSelected={isNodeSelected(domain.id)}
              isExpanded={expanded[domain.id] ?? false}
              onSelect={() => onSelectNode({ domainId: domain.id })}
              onToggleExpand={() => toggleExpanded(domain.id)}
              level={0}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export default NginxDiagram
