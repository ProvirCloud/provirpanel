import { Check, Copy, Download, Pencil, X } from 'lucide-react'
import { useState } from 'react'

type Props = {
  config: string
  editedContent?: string
  onContentChange?: (value: string) => void
}

export default function GeneratedNginxConfig({ config, editedContent, onContentChange }: Props) {
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)

  const displayContent = editedContent !== undefined ? editedContent : config
  const isEdited = editedContent !== undefined && editedContent !== config

  const handleCopy = async () => {
    await navigator.clipboard.writeText(displayContent)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  const handleDownload = () => {
    const blob = new Blob([displayContent], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'nginx.conf'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleReset = () => {
    onContentChange?.(config)
    setEditing(false)
  }

  return (
    <section className="rounded-[20px] border border-white/8 bg-[linear-gradient(160deg,rgba(8,16,32,0.98),rgba(6,13,26,0.96))] shadow-[0_24px_80px_rgba(1,5,16,0.5)] overflow-hidden">
      <div className="flex items-center justify-between gap-4 border-b border-white/6 px-5 py-3.5">
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">
            Configuração gerada
          </span>
          {isEdited && (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300">
              editado manualmente
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onContentChange && (
            isEdited ? (
              <button
                type="button"
                onClick={handleReset}
                title="Restaurar config gerada"
                className="flex items-center gap-1.5 rounded-[10px] border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-[12px] text-rose-300 transition hover:bg-rose-500/20"
              >
                <X className="h-3.5 w-3.5" />
                Restaurar
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setEditing((v) => !v)}
                className={[
                  'flex items-center gap-1.5 rounded-[10px] border px-3 py-1.5 text-[12px] transition',
                  editing
                    ? 'border-blue-500/40 bg-blue-500/10 text-blue-300'
                    : 'border-white/10 bg-white/4 text-white/60 hover:bg-white/8 hover:text-white/80',
                ].join(' ')}
              >
                <Pencil className="h-3.5 w-3.5" />
                {editing ? 'Editando' : 'Editar'}
              </button>
            )
          )}
          <button
            type="button"
            onClick={handleDownload}
            title="Baixar nginx.conf"
            className="flex items-center gap-1.5 rounded-[10px] border border-white/10 bg-white/4 px-3 py-1.5 text-[12px] text-white/60 transition hover:bg-white/8 hover:text-white/80"
          >
            <Download className="h-3.5 w-3.5" />
            Baixar
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className={[
              'flex items-center gap-1.5 rounded-[10px] border px-3 py-1.5 text-[12px] font-medium transition',
              copied
                ? 'border-[#1b5c38]/80 bg-[#1b5c38]/40 text-[#86efac]'
                : 'border-white/10 bg-white/4 text-white/60 hover:bg-white/8 hover:text-white/80',
            ].join(' ')}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copiado!' : 'Copiar'}
          </button>
        </div>
      </div>
      <div className="bg-[#050d1a]">
        {editing && onContentChange ? (
          <textarea
            className="max-h-[320px] min-h-[200px] w-full overflow-auto bg-transparent px-5 py-4 font-mono text-[12.5px] leading-[1.7] text-slate-300 outline-none scrollbar-thin resize-y"
            value={displayContent}
            onChange={(e) => onContentChange(e.target.value)}
            spellCheck={false}
          />
        ) : (
          <pre className="max-h-[320px] overflow-auto px-5 py-4 text-[12.5px] leading-[1.7] text-slate-300 scrollbar-thin">
            <code>{displayContent}</code>
          </pre>
        )}
      </div>
    </section>
  )
}
