import React from 'react'
import { Globe, Server, MapPin, ArrowUpRight, Code, ChevronDown, ChevronRight } from 'lucide-react'
import type { DomainNode, ServerNode, LocationNode, UpstreamNode, RuleNode } from '../types/nginxConfig'

type NodeProps = {
  node: DomainNode | ServerNode | LocationNode | UpstreamNode | RuleNode
  isSelected: boolean
  isExpanded: boolean
  onSelect: () => void
  onToggleExpand: () => void
  level: number
}

const getNodeIcon = (node: any) => {
  switch (node.type) {
    case 'domain':
      return <Globe size={14} />
    case 'server':
      return <Server size={14} />
    case 'location':
      return <MapPin size={14} />
    case 'upstream':
      return <ArrowUpRight size={14} />
    case 'rule':
      return <Code size={14} />
    default:
      return null
  }
}

const getNodeLabel = (node: any): string => {
  switch (node.type) {
    case 'domain':
      return node.name
    case 'server':
      return `Port ${node.listenPort}${node.sslEnabled ? ' (SSL)' : ''}`
    case 'location':
      return node.path
    case 'upstream':
      return node.name
    case 'rule':
      return `${node.condition} → ${node.action}`
    default:
      return 'Unknown'
  }
}

const getNodeColor = (node: any) => {
  switch (node.type) {
    case 'domain':
      return 'from-blue-500/20 to-cyan-500/20 border-blue-500/30'
    case 'server':
      return 'from-purple-500/20 to-pink-500/20 border-purple-500/30'
    case 'location':
      return 'from-emerald-500/20 to-teal-500/20 border-emerald-500/30'
    case 'upstream':
      return 'from-amber-500/20 to-orange-500/20 border-amber-500/30'
    case 'rule':
      return 'from-slate-500/20 to-gray-500/20 border-slate-500/30'
    default:
      return 'from-gray-500/20 to-gray-500/20 border-gray-500/30'
  }
}

const hasChildren = (node: any): boolean => {
  return !!(
    ('servers' in node && node.servers?.length > 0) ||
    ('locations' in node && node.locations?.length > 0) ||
    ('upstreams' in node && node.upstreams?.length > 0) ||
    ('rules' in node && node.rules?.length > 0)
  )
}

const NginxNode: React.FC<NodeProps> = ({ node, isSelected, isExpanded, onSelect, onToggleExpand, level }) => {
  const hasChildNodes = hasChildren(node)

  return (
    <div style={{ paddingLeft: `${level * 20}px` }}>
      <div
        onClick={onSelect}
        className={`
          flex items-center gap-2 rounded-lg px-3 py-2 mb-1 cursor-pointer transition-all duration-200
          border bg-gradient-to-r
          ${
            isSelected
              ? 'border-blue-400 bg-gradient-to-r from-blue-500/40 to-cyan-500/40 ring-2 ring-blue-400/50'
              : `${getNodeColor(node)} hover:from-blue-500/30 hover:to-cyan-500/30`
          }
        `}
      >
        {hasChildNodes ? (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggleExpand()
            }}
            className="p-0 hover:bg-white/10 rounded"
          >
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <div className="w-5" />
        )}

        <span className="text-xs opacity-70">{getNodeIcon(node)}</span>
        <span className="text-sm font-medium text-slate-100 flex-1">{getNodeLabel(node)}</span>
      </div>

      {hasChildNodes && isExpanded && (
        <div>
          {'servers' in node &&
            node.servers?.map((child) => (
              <NginxNode
                key={child.id}
                node={child}
                isSelected={false}
                isExpanded={false}
                onSelect={() => onSelect()}
                onToggleExpand={() => {}}
                level={level + 1}
              />
            ))}

          {'locations' in node &&
            node.locations?.map((child) => (
              <NginxNode
                key={child.id}
                node={child}
                isSelected={false}
                isExpanded={false}
                onSelect={() => onSelect()}
                onToggleExpand={() => {}}
                level={level + 1}
              />
            ))}

          {'upstreams' in node &&
            node.upstreams?.map((child) => (
              <NginxNode
                key={child.id}
                node={child}
                isSelected={false}
                isExpanded={false}
                onSelect={() => onSelect()}
                onToggleExpand={() => {}}
                level={level + 1}
              />
            ))}

          {'rules' in node &&
            node.rules?.map((child) => (
              <NginxNode
                key={child.id}
                node={child}
                isSelected={false}
                isExpanded={false}
                onSelect={() => onSelect()}
                onToggleExpand={() => {}}
                level={level + 1}
              />
            ))}
        </div>
      )}
    </div>
  )
}

export default NginxNode
