import React, { useState, useCallback } from 'react'
import { Plus, Code, Eye, Download, Copy, Check } from 'lucide-react'
import NginxDiagram from '../components/nginx/NginxDiagram'
import NodeConfigPanel from '../components/nginx/NodeConfigPanel'
import { createDefaultState } from '../services/nginxConfigSchema'
import { generateNginxConf } from '../services/nginxConfigGenerator'
import type { NginxConfigState, SelectionPath } from '../types/nginxConfig'

type TabType = 'editor' | 'config'

const NginxVisualEditor: React.FC = () => {
  const [state, setState] = useState<NginxConfigState>(createDefaultState())
  const [selectedPath, setSelectedPath] = useState<SelectionPath>({})
  const [tab, setTab] = useState<TabType>('editor')
  const [copied, setCopied] = useState(false)

  const handleStateUpdate = useCallback((newState: NginxConfigState) => {
    setState(newState)
  }, [])

  const generatedConf = generateNginxConf(state.domains)

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedConf)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const downloadConf = () => {
    const element = document.createElement('a')
    element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(generatedConf))
    element.setAttribute('download', 'nginx.conf')
    element.style.display = 'none'
    document.body.appendChild(element)
    element.click()
    document.body.removeChild(element)
  }

  return (
    <div className="h-screen flex flex-col bg-slate-950">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 border-b border-slate-800 px-6 py-4 bg-slate-900/50">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Nginx Visual Editor</h1>
          <p className="text-xs text-slate-400 mt-1">Visual configuration for Zeus Cloud</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setTab('editor')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === 'editor'
                ? 'bg-blue-600 text-white'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Eye size={14} />
            Visual Editor
          </button>
          <button
            onClick={() => setTab('config')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === 'config'
                ? 'bg-blue-600 text-white'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Code size={14} />
            nginx.conf
          </button>
        </div>
      </div>

      {/* Content */}
      {tab === 'editor' ? (
        <div className="flex-1 flex gap-0 overflow-hidden">
          {/* Left: Diagram */}
          <div className="w-80 flex flex-col border-r border-slate-800 bg-slate-900/30">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-100">Config Tree</h2>
              <button
                onClick={() => {
                  const newDomain = {
                    id: Math.random().toString(36).substr(2, 9),
                    type: 'domain' as const,
                    name: 'new-domain.com',
                    servers: [],
                  }
                  setState({
                    ...state,
                    domains: [...state.domains, newDomain],
                  })
                }}
                className="p-1 hover:bg-blue-600/30 rounded text-blue-400"
                title="Add domain"
              >
                <Plus size={14} />
              </button>
            </div>
            <NginxDiagram
              domains={state.domains}
              selectedPath={selectedPath}
              onSelectNode={setSelectedPath}
            />
          </div>

          {/* Center: JSON State */}
          <div className="flex-1 flex flex-col border-r border-slate-800 bg-slate-950/50 p-4">
            <h2 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              State JSON
            </h2>
            <pre className="flex-1 overflow-auto bg-slate-900 rounded-lg border border-slate-800 p-3 text-xs font-mono text-slate-300 text-left">
              {JSON.stringify(state, null, 2)}
            </pre>
          </div>

          {/* Right: Panel */}
          <div className="w-96 flex flex-col border-l border-slate-800 bg-slate-900/30">
            <NodeConfigPanel
              state={state}
              selectedPath={selectedPath}
              onUpdate={handleStateUpdate}
              onClose={() => setSelectedPath({})}
            />
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col p-6 overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-100">Generated nginx.conf</h2>
            <div className="flex gap-2">
              <button
                onClick={copyToClipboard}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-medium transition-all"
              >
                {copied ? (
                  <>
                    <Check size={14} /> Copied
                  </>
                ) : (
                  <>
                    <Copy size={14} /> Copy
                  </>
                )}
              </button>
              <button
                onClick={downloadConf}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-all"
              >
                <Download size={14} /> Download
              </button>
            </div>
          </div>

          <pre className="flex-1 overflow-auto bg-slate-900 rounded-lg border border-slate-800 p-4 text-xs font-mono text-slate-300 text-left">
            {generatedConf}
          </pre>
        </div>
      )}
    </div>
  )
}

export default NginxVisualEditor
