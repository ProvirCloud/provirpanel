import { Code, Copy, Download, X, Save, Eye, AlertCircle, CheckCircle, Clock, Loader } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import api from '../../services/api.js'
import Button from '../ui/Button'
import type { NginxSite } from '../../types/nginx'
import { validateNginxSyntaxClient, validateNginxConfigRemote } from '../../services/nginxValidator'
import { useTheme } from '../../app/providers/theme-provider'

type NginxConfigFileEditorProps = {
  site: NginxSite
  onClose: () => void
  onSave: () => void
}

type ValidationResult = {
  valid: boolean
  errors: Array<{ line: number; message: string; severity: 'error' | 'warning' }>
  warnings: Array<{ line: number; message: string; severity: 'warning' }>
  hasIssues: boolean
}

const NginxConfigFileEditor = ({ site, onClose, onSave }: NginxConfigFileEditorProps) => {
  const { theme } = useTheme()
  const isLight = theme === 'light'
  
  const [content, setContent] = useState(site.raw || '')
  const [originalContent] = useState(site.raw || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [validating, setValidating] = useState(false)
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [backupCreated, setBackupCreated] = useState(false)
  const [lastBackupTime, setLastBackupTime] = useState<string | null>(null)
  const autoSaveRef = useRef<NodeJS.Timeout | null>(null)

  // Auto-validation on content change (debounced)
  useEffect(() => {
    if (validating) return

    const timer = setTimeout(async () => {
      setValidating(true)
      try {
        // Client-side validation first
        const clientResult = validateNginxSyntaxClient(content)
        setValidation(clientResult)

        // Then server-side validation
        if (clientResult.valid) {
          try {
            const remoteResult = await validateNginxConfigRemote(content, site.name)
            setValidation(remoteResult)
          } catch {
            // If remote validation fails, keep client-side result
          }
        }
      } finally {
        setValidating(false)
      }
    }, 800)

    return () => clearTimeout(timer)
  }, [content, site.name])

  // Auto-backup (every 5 minutes if content changed)
  useEffect(() => {
    if (content === originalContent) return

    const timer = setTimeout(async () => {
      try {
        // Create backup before making changes
        await api.post(`/nginx/configs/${site.name}/backup`, {
          content: originalContent,
          reason: 'Auto-backup before edit'
        })
        setBackupCreated(true)
        setLastBackupTime(new Date().toLocaleTimeString('pt-BR'))
      } catch (err) {
        console.warn('Backup failed:', err)
      }
    }, 5 * 60 * 1000) // 5 minutes

    return () => clearTimeout(timer)
  }, [content, originalContent, site.name])

  const hasChanges = content !== originalContent

  const handleSave = async () => {
    if (!validation?.valid) {
      setError('Corrija os erros de sintaxe antes de salvar')
      return
    }

    setSaving(true)
    setError('')
    try {
      // Create backup before saving
      await api.post(`/nginx/configs/${site.name}/backup`, {
        content: originalContent,
        reason: 'Pre-save backup'
      })

      // Save new content
      await api.put(`/nginx/configs/${site.name}`, { content })
      onSave()
      onClose()
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDownload = () => {
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = site.displayName + '.conf'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const lineCount = content.split('\n').length

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(2px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '90%',
          maxWidth: 1000,
          maxHeight: '90vh',
          borderRadius: 20,
          border: `1px solid ${isLight ? '#e5e7eb' : 'var(--color-border)'}`,
          background: isLight ? '#ffffff' : 'var(--color-surface)',
          boxShadow: isLight ? '0 20px 25px rgba(0,0,0,0.15)' : 'var(--shadow-lg)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '20px 24px',
            borderBottom: `1px solid ${isLight ? '#e5e7eb' : 'var(--color-border-subtle)'}`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
            <Code size={20} style={{ color: '#3b82f6', flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <h2 style={{ 
                fontSize: 16, 
                fontWeight: 600, 
                margin: 0, 
                color: isLight ? '#111827' : 'var(--color-text)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}>
                {site.displayName}.conf
              </h2>
              <p style={{ 
                fontSize: 12, 
                color: isLight ? '#6b7280' : 'var(--color-text-muted)', 
                margin: '4px 0 0 0',
                display: 'flex',
                gap: 8,
                alignItems: 'center'
              }}>
                {hasChanges && <span style={{ color: '#f59e0b' }}>● Modificado</span>}
                {lastBackupTime && <span>{lineCount} linhas</span>}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              borderRadius: 8,
              border: 'none',
              background: isLight ? '#f3f4f6' : 'var(--color-canvas-subtle)',
              color: isLight ? '#6b7280' : 'var(--color-text-muted)',
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Validation panel */}
        {validation && (
          <div
            style={{
              borderBottom: `1px solid ${isLight ? '#e5e7eb' : 'var(--color-border-subtle)'}`,
              background: validation.valid 
                ? isLight ? '#f0fdf4' : 'rgba(16,185,129,0.1)'
                : isLight ? '#fef2f2' : 'rgba(239,68,68,0.1)',
              padding: '12px 24px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              {validating ? (
                <>
                  <Loader size={14} style={{ color: '#3b82f6', animation: 'spin 1s linear infinite' }} />
                  <span style={{ color: isLight ? '#1f2937' : 'var(--color-text)' }}>Validando sintaxe...</span>
                </>
              ) : validation.valid ? (
                <>
                  <CheckCircle size={14} style={{ color: '#10b981' }} />
                  <span style={{ color: '#10b981' }}>Sintaxe válida</span>
                </>
              ) : (
                <>
                  <AlertCircle size={14} style={{ color: '#ef4444' }} />
                  <span style={{ color: '#ef4444' }}>
                    {validation.errors.length} erro(s), {validation.warnings.length} aviso(s)
                  </span>
                </>
              )}
            </div>
            {(validation.errors.length > 0 || validation.warnings.length > 0) && (
              <div style={{ marginTop: 8, fontSize: 11, maxHeight: 100, overflowY: 'auto' }}>
                {validation.errors.map((err, i) => (
                  <div key={`err-${i}`} style={{ color: '#ef4444', marginBottom: 4 }}>
                    Linha {err.line}: {err.message}
                  </div>
                ))}
                {validation.warnings.map((warn, i) => (
                  <div key={`warn-${i}`} style={{ color: '#f59e0b', marginBottom: 4 }}>
                    Linha {warn.line}: {warn.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Editor */}
        <div
          style={{
            flex: 1,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            padding: '16px 0',
          }}
        >
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            {/* Line numbers */}
            <div
              style={{
                width: 48,
                paddingRight: 8,
                paddingLeft: 16,
                paddingTop: 16,
                paddingBottom: 16,
                borderRight: `1px solid ${isLight ? '#e5e7eb' : 'var(--color-border-subtle)'}`,
                background: isLight ? '#f9fafb' : 'var(--color-canvas-subtle)',
                overflow: 'hidden',
                textAlign: 'right',
                fontSize: 12,
                color: isLight ? '#d1d5db' : 'var(--color-text-muted)',
                lineHeight: 1.6,
                fontFamily: 'monospace',
                userSelect: 'none',
              }}
            >
              {content.split('\n').map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>

            {/* Textarea */}
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              style={{
                flex: 1,
                padding: '16px 20px',
                border: 'none',
                outline: 'none',
                background: isLight ? '#ffffff' : 'var(--color-surface)',
                color: isLight ? '#1f2937' : 'var(--color-text)',
                fontFamily: 'monospace',
                fontSize: 12,
                lineHeight: 1.6,
                resize: 'none',
                overflow: 'auto',
              }}
              spellCheck="false"
            />
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div
            style={{
              padding: '12px 24px',
              borderTop: `1px solid ${isLight ? '#fee2e2' : 'var(--color-border-subtle)'}`,
              background: isLight ? '#fef2f2' : 'var(--color-danger-soft)',
              color: isLight ? '#dc2626' : 'var(--color-danger)',
              fontSize: 12,
              borderRadius: 0,
            }}
          >
            {error}
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 24px',
            borderTop: `1px solid ${isLight ? '#e5e7eb' : 'var(--color-border-subtle)'}`,
            background: isLight ? '#f9fafb' : 'var(--color-canvas-subtle)',
            flexWrap: 'wrap',
            gap: 8
          }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<Copy size={13} />}
              onClick={handleCopy}
            >
              {copied ? 'Copiado!' : 'Copiar'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<Download size={13} />}
              onClick={handleDownload}
            >
              Baixar
            </Button>
            {lastBackupTime && (
              <span style={{ fontSize: 11, color: isLight ? '#6b7280' : 'var(--color-text-muted)', marginLeft: 8 }}>
                <Clock size={11} style={{ display: 'inline', marginRight: 4 }} />
                Backup: {lastBackupTime}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <Button 
              variant="ghost" 
              size="sm" 
              leadingIcon={<Eye size={13} />}
              onClick={() => setShowPreview(!showPreview)}
            >
              Preview
            </Button>
            <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSave}
              disabled={!hasChanges || !validation?.valid || saving}
              leadingIcon={<Save size={13} />}
            >
              {saving ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default NginxConfigFileEditor
