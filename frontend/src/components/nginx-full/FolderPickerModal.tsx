import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, Folder, X } from 'lucide-react'
import api from '../../services/api.js'

type BrowseItem = { name: string; path: string; isDir: boolean }
type Root = { key: string; label: string }

type Props = {
  initialPath?: string
  onSelect: (path: string) => void
  onClose: () => void
}

const normalize = (p: string) => p.replace(/\/+$/, '') || '/'

export default function FolderPickerModal({ initialPath = '/', onSelect, onClose }: Props) {
  const [source, setSource] = useState<string>('storage')
  const [currentPath, setCurrentPath] = useState(normalize(initialPath))
  const [items, setItems] = useState<BrowseItem[]>([])
  const [roots, setRoots] = useState<Root[]>([
    { key: 'storage', label: 'Arquivos' },
    { key: 'www', label: 'WWW' },
  ])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const reqRef = useRef(0)

  const load = useCallback(async (path: string, src: string) => {
    const id = ++reqRef.current
    setLoading(true)
    setError('')
    try {
      const res = await api.get('/nginx/static-sites/browse', { params: { path, source: src } })
      if (id !== reqRef.current) return
      setItems((res.data?.items || []).filter((i: BrowseItem) => i.isDir))
      if (res.data?.roots) setRoots(res.data.roots)
      setCurrentPath(path)
      setSource(src)
    } catch (err: any) {
      if (id !== reqRef.current) return
      setError(err.response?.data?.message || err.message || 'Erro ao carregar pastas')
    } finally {
      if (id === reqRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(normalize(initialPath), 'storage')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const parentPath =
    currentPath === '/'
      ? '/'
      : normalize(currentPath.split('/').slice(0, -1).join('/') || '/')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-[20px] border border-white/10 bg-[linear-gradient(160deg,rgba(8,16,32,0.99),rgba(6,13,26,0.97))] shadow-[0_32px_100px_rgba(0,0,0,0.7)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/6 px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
              Selecionar pasta
            </p>
            <p className="mt-1 font-mono text-[13px] text-white/70">{currentPath}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-white/8 bg-white/4 text-white/50 transition hover:bg-white/8 hover:text-white/80"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Source tabs + back button */}
        <div className="flex items-center gap-2 border-b border-white/6 px-4 py-2.5">
          {roots.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => load('/', r.key)}
              className={[
                'rounded-[8px] px-3 py-1 text-[12px] font-medium transition',
                source === r.key
                  ? 'bg-[#1a3060] text-[#7ab0ff]'
                  : 'border border-white/8 text-white/45 hover:bg-white/4 hover:text-white/70',
              ].join(' ')}
            >
              {r.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => load(parentPath, source)}
            disabled={loading || currentPath === '/'}
            className="ml-auto flex items-center gap-1 rounded-[8px] border border-white/8 px-3 py-1 text-[12px] text-white/45 transition hover:bg-white/4 hover:text-white/70 disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Voltar
          </button>
        </div>

        {/* Directory listing */}
        <div className="max-h-[38vh] overflow-y-auto">
          {loading && (
            <p className="px-5 py-4 text-[13px] text-white/38">Carregando...</p>
          )}
          {!loading && error && (
            <p className="px-5 py-4 text-[13px] text-[#f87171]">{error}</p>
          )}
          {!loading && !error && items.length === 0 && (
            <p className="px-5 py-4 text-[13px] text-white/30">Nenhuma subpasta encontrada.</p>
          )}
          {!loading &&
            !error &&
            items.map((item) => (
              <button
                key={item.path}
                type="button"
                className="flex w-full items-center gap-3 border-b border-white/5 px-4 py-2.5 text-left text-[13px] transition hover:bg-white/4 last:border-b-0"
                onClick={() => load(item.path, source)}
              >
                <Folder className="h-4 w-4 flex-shrink-0 text-[#6aa4ff]" />
                <span className="flex-1 text-white/80">{item.name}</span>
                <span className="font-mono text-[11px] text-white/30">{item.path}</span>
              </button>
            ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/6 px-5 py-3.5">
          <p className="text-[12px] text-white/40">
            Origem:{' '}
            <span className="text-white/65">
              {roots.find((r) => r.key === source)?.label ?? source}
            </span>
          </p>
          <button
            type="button"
            onClick={() => onSelect(currentPath)}
            className="rounded-[10px] border border-[#2d4f8f]/80 bg-[linear-gradient(135deg,#1a3a72,#142d58)] px-4 py-2 text-[13px] font-semibold text-white shadow-[0_4px_16px_rgba(30,80,200,0.22)] transition hover:brightness-110"
          >
            Usar esta pasta
          </button>
        </div>
      </div>
    </div>
  )
}
