import { useEffect, useMemo, useState } from 'react'
import { Mail, Plus, Trash2, Pencil, Send, ShieldCheck } from 'lucide-react'
import Editor from '@monaco-editor/react'
import api from '../services/api.js'

const DEFAULT_THEME = {
  brandName: 'Provir Cloud',
  logoUrl: '',
  backgroundColor: '#0b1120',
  surfaceColor: '#111827',
  borderColor: '#1f2937',
  accentColor: '#22c55e',
  textColor: '#e2e8f0',
  mutedColor: '#94a3b8',
  buttonColor: '#22c55e',
  buttonTextColor: '#0b1120',
  fontFamily: "'Trebuchet MS', Verdana, sans-serif",
  footerText: 'Enviado pelo ProvirPanel',
  logoSize: 32
}

const buildBlock = (type) => {
  const base = {
    id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    type,
    align: 'left',
    textColor: '',
    backgroundColor: '',
    padding: 0
  }

  if (type === 'header') {
    return { ...base, title: '', subtitle: '' }
  }
  if (type === 'text') {
    return { ...base, text: '', fontSize: 14 }
  }
  if (type === 'button') {
    return { ...base, label: '', url: '', buttonColor: '', buttonTextColor: '', radius: 999 }
  }
  if (type === 'image') {
    return { ...base, imageUrl: '', imageAlt: '', width: 100, height: 80, radius: 14, linkUrl: '' }
  }
  if (type === 'divider') {
    return { ...base, thickness: 1, color: '' }
  }
  if (type === 'footer') {
    return { ...base, text: '' }
  }
  if (type === 'code') {
    return { ...base, label: '', code: '', codeSize: 28 }
  }
  if (type === 'alert') {
    return { ...base, title: '', text: '', tone: 'warning' }
  }
  if (type === 'spacer') {
    return { ...base, height: 16 }
  }
  if (type === 'grid') {
    return {
      ...base,
      columns: 2,
      gap: 16,
      leftTitle: '',
      leftText: '',
      leftImageUrl: '',
      leftImageAlt: '',
      leftImageWidth: 140,
      leftImageHeight: 80,
      rightTitle: '',
      rightText: '',
      rightImageUrl: '',
      rightImageAlt: '',
      rightImageWidth: 140,
      rightImageHeight: 80
    }
  }
  return base
}

const hydrateBlock = (block) => {
  const type = block?.type || 'text'
  const base = buildBlock(type)
  return {
    ...base,
    ...block,
    id: block?.id || base.id
  }
}

const normalizeDesign = (design) => {
  if (Array.isArray(design)) {
    return { blocks: design.map(hydrateBlock), theme: { ...DEFAULT_THEME } }
  }
  if (design && typeof design === 'object') {
    return {
      blocks: Array.isArray(design.blocks) ? design.blocks.map(hydrateBlock) : [],
      theme: { ...DEFAULT_THEME, ...(design.theme || {}) }
    }
  }
  return { blocks: [], theme: { ...DEFAULT_THEME } }
}

const buildHtml = (blocks = [], meta = {}) => {
  const theme = { ...DEFAULT_THEME, ...(meta.theme || {}) }
  const brandName = meta.brandName || theme.brandName
  const title = meta.title || 'Mensagem'
  const subtitle = meta.subtitle || ''
  const brandStyle = theme.brandStyle || 'logo'
  const logoSize = Number(theme.logoSize) || 32

  const header = `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:${theme.backgroundColor};padding:32px 0;font-family:${theme.fontFamily};">
      <tr><td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:${theme.surfaceColor};border-radius:22px;overflow:hidden;border:1px solid ${theme.borderColor};box-shadow:0 20px 50px rgba(15,23,42,0.35);">
          <tr><td style="padding:24px 28px;background:${theme.surfaceColor};">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td align="left" style="vertical-align:middle;">
                  ${brandStyle === 'logo'
                    ? (theme.logoUrl
                      ? `<img src="${theme.logoUrl}" alt="${brandName}" style="max-height:38px;max-width:160px;display:block;" />`
                      : `<span style="font-size:16px;font-weight:700;color:${theme.textColor};">${brandName}</span>`)
                    : `<div style="display:flex;align-items:center;gap:10px;">
                        ${theme.logoUrl ? `<img src="${theme.logoUrl}" alt="${brandName}" style="height:${logoSize}px;width:${logoSize}px;border-radius:10px;object-fit:contain;border:1px solid ${theme.borderColor};background:${theme.surfaceColor};" />` : ''}
                        <span style="font-size:16px;font-weight:700;color:${theme.textColor};">${brandName}</span>
                      </div>`}
                </td>
                <td align="right" style="vertical-align:middle;">
                  <span style="display:inline-block;background:${theme.accentColor};color:${theme.buttonTextColor};padding:6px 12px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.08em;">NOTIFICAÇÃO</span>
                </td>
              </tr>
            </table>
          </td></tr>
          <tr><td style="padding:28px 32px;background:${theme.surfaceColor};color:${theme.textColor};">
            <div style="margin-bottom:18px;padding:18px 20px;border-radius:16px;background:${theme.borderColor};">
              <h1 style="margin:0 0 6px;font-size:24px;line-height:1.3;color:${theme.textColor};">${title}</h1>
              ${subtitle ? `<p style="margin:0;color:${theme.mutedColor};font-size:14px;line-height:1.5;">${subtitle}</p>` : ''}
            </div>
  `

  const footer = `
          </td></tr>
          <tr><td style="padding:20px 32px;background:${theme.backgroundColor};color:${theme.mutedColor};font-size:12px;text-align:center;">
            ${meta.footer || theme.footerText}
          </td></tr>
        </table>
      </td></tr>
    </table>
  `

  const body = blocks.map((block) => {
    const blockTextColor = block.textColor || theme.textColor
    const blockBackground = block.backgroundColor || 'transparent'
    const blockPadding = block.padding ? `padding:${block.padding}px;` : ''

    if (block.type === 'header') {
      return `
        <div style="margin-bottom:20px;text-align:${block.align || 'left'};background:${blockBackground};border-radius:12px;${blockPadding}">
          <h2 style="margin:0 0 6px;font-size:20px;color:${blockTextColor};">${block.title || 'Titulo'}</h2>
          <p style="margin:0;color:${theme.mutedColor};font-size:14px;">${block.subtitle || ''}</p>
        </div>
      `
    }
    if (block.type === 'text') {
      return `
        <p style="margin:0 0 16px;color:${blockTextColor};font-size:${block.fontSize || 14}px;line-height:1.7;text-align:${block.align || 'left'};background:${blockBackground};border-radius:12px;${blockPadding}">
          ${block.text || ''}
        </p>
      `
    }
    if (block.type === 'button') {
      const buttonColor = block.buttonColor || theme.buttonColor
      const buttonTextColor = block.buttonTextColor || theme.buttonTextColor
      return `
        <div style="margin:18px 0;text-align:${block.align || 'left'};">
          <a href="${block.url || '#'}" style="display:inline-block;padding:12px 24px;border-radius:${block.radius || 12}px;background:${buttonColor};color:${buttonTextColor};font-weight:700;font-size:14px;text-decoration:none;">
            ${block.label || 'Acessar'}
          </a>
        </div>
      `
    }
    if (block.type === 'image') {
      const imageTag = `
        <img src="${block.imageUrl || ''}" alt="${block.imageAlt || ''}" style="max-width:100%;width:${block.width || 100}%;height:${block.height || 80}px;object-fit:cover;border-radius:${block.radius || 12}px;border:1px solid ${theme.borderColor};" />
      `
      return `
        <div style="margin:20px 0;text-align:${block.align || 'center'};">
          ${block.linkUrl ? `<a href="${block.linkUrl}" style="text-decoration:none;">${imageTag}</a>` : imageTag}
        </div>
      `
    }
    if (block.type === 'divider') {
      return `<hr style="border:none;border-top:${block.thickness || 1}px solid ${block.color || theme.borderColor};margin:20px 0;" />`
    }
    if (block.type === 'code') {
      return `
        <div style="margin:18px 0;text-align:${block.align || 'left'};background:${blockBackground};border-radius:16px;border:1px dashed ${theme.borderColor};padding:16px;">
          ${block.label ? `<p style="margin:0 0 8px;font-size:12px;color:${theme.mutedColor};text-transform:uppercase;letter-spacing:0.2em;">${block.label}</p>` : ''}
          <div style="font-size:${block.codeSize || 28}px;font-weight:700;letter-spacing:0.35em;color:${blockTextColor};">${block.code || '123456'}</div>
        </div>
      `
    }
    if (block.type === 'alert') {
      const toneMap = {
        info: { bg: '#1e293b', border: '#38bdf8', text: '#e2e8f0' },
        warning: { bg: '#312e1b', border: '#f59e0b', text: '#fde68a' },
        danger: { bg: '#2b1118', border: '#f43f5e', text: '#fecdd3' }
      }
      const tone = toneMap[block.tone] || toneMap.warning
      return `
        <div style="margin:18px 0;padding:14px 16px;border-radius:14px;border:1px solid ${tone.border};background:${tone.bg};text-align:${block.align || 'left'};">
          <p style="margin:0 0 6px;font-size:12px;letter-spacing:0.2em;text-transform:uppercase;color:${tone.text};">Alerta</p>
          ${block.title ? `<h3 style="margin:0 0 6px;font-size:16px;color:${tone.text};">${block.title}</h3>` : ''}
          <p style="margin:0;color:${tone.text};font-size:13px;line-height:1.6;">${block.text || ''}</p>
        </div>
      `
    }
    if (block.type === 'spacer') {
      return `<div style="height:${block.height || 16}px;"></div>`
    }
    if (block.type === 'grid') {
      return `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;">
          <tr>
            <td width="50%" style="vertical-align:top;padding-right:${block.gap || 16}px;">
              ${block.leftImageUrl
                ? `<img src="${block.leftImageUrl}" alt="${block.leftImageAlt || ''}" style="display:block;width:${block.leftImageWidth || 140}px;height:${block.leftImageHeight || 80}px;object-fit:cover;border-radius:12px;border:1px solid ${theme.borderColor};margin-bottom:12px;" />`
                : ''}
              ${block.leftTitle ? `<h3 style="margin:0 0 6px;font-size:16px;color:${theme.textColor};">${block.leftTitle}</h3>` : ''}
              ${block.leftText ? `<p style="margin:0;color:${theme.mutedColor};font-size:13px;line-height:1.6;">${block.leftText}</p>` : ''}
            </td>
            <td width="50%" style="vertical-align:top;padding-left:${block.gap || 16}px;">
              ${block.rightImageUrl
                ? `<img src="${block.rightImageUrl}" alt="${block.rightImageAlt || ''}" style="display:block;width:${block.rightImageWidth || 140}px;height:${block.rightImageHeight || 80}px;object-fit:cover;border-radius:12px;border:1px solid ${theme.borderColor};margin-bottom:12px;" />`
                : ''}
              ${block.rightTitle ? `<h3 style="margin:0 0 6px;font-size:16px;color:${theme.textColor};">${block.rightTitle}</h3>` : ''}
              ${block.rightText ? `<p style="margin:0;color:${theme.mutedColor};font-size:13px;line-height:1.6;">${block.rightText}</p>` : ''}
            </td>
          </tr>
        </table>
      `
    }
    if (block.type === 'footer') {
      return `
        <p style="margin:20px 0 0;color:${theme.mutedColor};font-size:12px;line-height:1.6;text-align:${block.align || 'left'};">
          ${block.text || ''}
        </p>
      `
    }
    return ''
  }).join('')

  return `${header}${body}${footer}`
}

const EmailPanel = () => {
  const [activeTab, setActiveTab] = useState('smtp')
  const [configs, setConfigs] = useState([])
  const [templates, setTemplates] = useState([])
  const [smtpModal, setSmtpModal] = useState(null)
  const [templateModal, setTemplateModal] = useState(null)
  const [testModal, setTestModal] = useState(null)
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState('')

  const loadConfigs = async () => {
    const response = await api.get('/email/configs')
    setConfigs(response.data.configs || [])
  }

  const loadTemplates = async () => {
    const response = await api.get('/email/templates')
    setTemplates(response.data.templates || [])
  }

  useEffect(() => {
    loadConfigs()
    loadTemplates()
  }, [])

  const activeConfig = configs.find((cfg) => cfg.isActive)

  const handleSaveConfig = async (payload) => {
    if (payload.id) {
      await api.put(`/email/configs/${payload.id}`, payload)
    } else {
      await api.post('/email/configs', payload)
    }
    setSmtpModal(null)
    loadConfigs()
  }

  const handleDeleteConfig = async (id) => {
    await api.delete(`/email/configs/${id}`)
    loadConfigs()
  }

  const handleSaveTemplate = async (payload) => {
    if (payload.id) {
      await api.put(`/email/templates/${payload.id}`, payload)
    } else {
      await api.post('/email/templates', payload)
    }
    setTemplateModal(null)
    loadTemplates()
  }

  const handleDeleteTemplate = async (id) => {
    await api.delete(`/email/templates/${id}`)
    loadTemplates()
  }

  const sendTest = async (payload) => {
    setSending(true)
    setMessage('')
    try {
      await api.post('/email/test', payload)
      setMessage('Email enviado com sucesso')
    } catch (err) {
      setMessage(err.response?.data?.message || 'Falha ao enviar')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Emails</p>
          <h2 className="text-2xl font-semibold text-white">SMTP & Templates</h2>
        </div>
        <div className="flex gap-2">
          <button
            className={`rounded-xl px-4 py-2 text-sm font-semibold ${
              activeTab === 'smtp' ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-200'
            }`}
            onClick={() => setActiveTab('smtp')}
          >
            SMTP
          </button>
          <button
            className={`rounded-xl px-4 py-2 text-sm font-semibold ${
              activeTab === 'templates' ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-200'
            }`}
            onClick={() => setActiveTab('templates')}
          >
            Templates
          </button>
        </div>
      </div>

      {activeTab === 'smtp' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-white">Configuracoes SMTP</p>
                <p className="text-xs text-slate-400">Escolha o remetente para o painel e servicos.</p>
              </div>
              <button
                className="rounded-xl bg-blue-500 px-3 py-2 text-xs font-semibold text-slate-950"
                onClick={() =>
                  setSmtpModal({
                    name: '',
                    provider: 'provir',
                    host: '',
                    port: 587,
                    secure: false,
                    username: '',
                    password: '',
                    fromName: '',
                    fromEmail: '',
                    replyTo: '',
                    tlsRejectUnauthorized: true,
                    tlsCaText: '',
                    isActive: true
                  })
                }
              >
                <Plus className="h-3 w-3 inline mr-1" /> Novo SMTP
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {configs.length === 0 && (
                <p className="text-xs text-slate-500">Nenhuma configuracao cadastrada.</p>
              )}
              {configs.map((cfg) => (
                <div key={cfg.id} className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm text-white flex items-center gap-2">
                      {cfg.name}
                      {cfg.isActive && (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-300">
                          <ShieldCheck className="h-3 w-3" /> ativo
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-400">
                      {cfg.provider?.toUpperCase()} • {cfg.host || 'env'}:{cfg.port || 'auto'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs text-slate-200"
                      onClick={() => setTestModal({ type: 'smtp', configId: cfg.id, to: '' })}
                    >
                      <Send className="h-3 w-3 inline mr-1" /> Testar
                    </button>
                    <button
                      className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs text-slate-200"
                      onClick={() => setSmtpModal({ ...cfg, password: '' })}
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      className="rounded-lg border border-rose-800 px-2 py-1 text-xs text-rose-200 hover:bg-rose-900"
                      onClick={() => handleDeleteConfig(cfg.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {activeConfig && (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-emerald-200">
              SMTP ativo: <span className="font-semibold">{activeConfig.name}</span>
            </div>
          )}
        </div>
      )}

      {activeTab === 'templates' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-white">Templates</p>
                <p className="text-xs text-slate-400">Crie mensagens elegantes para email.</p>
              </div>
              <button
                className="rounded-xl bg-blue-500 px-3 py-2 text-xs font-semibold text-slate-950"
                onClick={() =>
                  setTemplateModal({
                    name: '',
                    subject: '',
                    preheader: '',
                    design: {
                      blocks: [buildBlock('header'), buildBlock('text'), buildBlock('button')],
                      theme: { ...DEFAULT_THEME }
                    },
                    htmlMode: false,
                    html: ''
                  })
                }
              >
                <Plus className="h-3 w-3 inline mr-1" /> Novo template
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {templates.length === 0 && (
                <p className="text-xs text-slate-500">Nenhum template cadastrado.</p>
              )}
              {templates.map((tpl) => (
                <div key={tpl.id} className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm text-white">{tpl.name}</p>
                    <p className="text-xs text-slate-400">{tpl.subject}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs text-slate-200"
                      onClick={() => setTestModal({ type: 'template', templateId: tpl.id, to: '' })}
                    >
                      <Send className="h-3 w-3 inline mr-1" /> Testar
                    </button>
                    <button
                      className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs text-slate-200"
                      onClick={() =>
                        setTemplateModal({
                          id: tpl.id,
                          name: tpl.name,
                          subject: tpl.subject,
                          preheader: tpl.preheader || '',
                          design: tpl.design || null,
                          htmlMode: !tpl.design,
                          html: tpl.html || ''
                        })
                      }
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      className="rounded-lg border border-rose-800 px-2 py-1 text-xs text-rose-200 hover:bg-rose-900"
                      onClick={() => handleDeleteTemplate(tpl.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {smtpModal && (
        <SmtpModal
          data={smtpModal}
          onClose={() => setSmtpModal(null)}
          onSave={handleSaveConfig}
        />
      )}
      {templateModal && (
        <TemplateModal
          data={templateModal}
          onClose={() => setTemplateModal(null)}
          onSave={handleSaveTemplate}
        />
      )}
      {testModal && (
        <TestModal
          data={testModal}
          onClose={() => setTestModal(null)}
          onSend={sendTest}
          sending={sending}
          templates={templates}
          configs={configs}
        />
      )}
      {message && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-2 text-xs text-slate-300">
          {message}
        </div>
      )}
    </div>
  )
}

const SmtpModal = ({ data, onClose, onSave }) => {
  const [form, setForm] = useState(data)
  useEffect(() => {
    setForm(data)
  }, [data])

  const updateField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900/90 p-6 text-slate-100">
        <h3 className="text-lg font-semibold">SMTP Sender</h3>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-xs text-slate-400">Nome</label>
            <input
              className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
              value={form.name || ''}
              onChange={(e) => updateField('name', e.target.value)}
            />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-slate-400">Tipo</label>
            <select
              className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
              value={form.provider || 'smtp_custom'}
              onChange={(e) => updateField('provider', e.target.value)}
            >
              <option value="provir">Provir Cloud Mail (SES)</option>
              <option value="smtp_sender">SMTP Sender Custom (SES/SendGrid/Mailgun)</option>
              <option value="smtp_custom">SMTP Custom (cliente)</option>
            </select>
            {form.provider === 'provir' && (
              <p className="mt-2 text-xs text-emerald-300">
                Usa AWS SES via API (PROVIR_SES_REGION/ACCESS_KEY/SECRET/FROM_EMAIL).
              </p>
            )}
          </div>
          {form.provider !== 'provir' && (
            <>
              <div>
                <label className="text-xs text-slate-400">Host</label>
                <input
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                  value={form.host || ''}
                  onChange={(e) => updateField('host', e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">Porta</label>
                <input
                  type="number"
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                  value={form.port || 587}
                  onChange={(e) => updateField('port', parseInt(e.target.value, 10) || 587)}
                />
              </div>
              <div className="col-span-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!form.secure}
                  onChange={(e) => updateField('secure', e.target.checked)}
                />
                <span className="text-xs text-slate-300">Conexao SSL (secure)</span>
              </div>
              <div>
                <label className="text-xs text-slate-400">Usuario</label>
                <input
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                  value={form.username || ''}
                  onChange={(e) => updateField('username', e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">Senha</label>
                <input
                  type="password"
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                  value={form.password || ''}
                  onChange={(e) => updateField('password', e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">Nome do remetente</label>
                <input
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                  value={form.fromName || ''}
                  onChange={(e) => updateField('fromName', e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">Email do remetente</label>
                <input
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                  value={form.fromEmail || ''}
                  onChange={(e) => updateField('fromEmail', e.target.value)}
                />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-slate-400">Reply-to (opcional)</label>
                <input
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                  value={form.replyTo || ''}
                  onChange={(e) => updateField('replyTo', e.target.value)}
                />
              </div>
              <div className="col-span-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.tlsRejectUnauthorized !== false}
                  onChange={(e) => updateField('tlsRejectUnauthorized', e.target.checked)}
                />
                <span className="text-xs text-slate-300">Rejeitar certificado invalido</span>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-slate-400">CA Certificado (opcional)</label>
                <textarea
                  className="mt-1 h-24 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs"
                  value={form.tlsCaText || ''}
                  onChange={(e) => updateField('tlsCaText', e.target.value)}
                  placeholder="Cole o certificado CA se necessario"
                />
              </div>
            </>
          )}
          <div className="col-span-2 flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!form.isActive}
              onChange={(e) => updateField('isActive', e.target.checked)}
            />
            <span className="text-xs text-slate-300">Definir como ativo</span>
          </div>
        </div>
        <div className="mt-5 flex gap-2 justify-end">
          <button
            onClick={() => onSave(form)}
            className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950"
          >
            Salvar
          </button>
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-xs text-slate-200"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}

const resolvePublicUrl = (url) => {
  if (!url) return ''
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  if (typeof window !== 'undefined') {
    return `${window.location.origin}${url}`
  }
  return url
}

const applyTemplateParams = (input, params = {}) => {
  if (!input) return input
  return String(input).replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (match, key) => {
    const value = params[key]
    return value === undefined || value === null ? match : String(value)
  })
}

const TEMPLATE_PRESETS = [
  {
    key: 'verification',
    name: 'Verification code',
    subject: 'Your verification code',
    preheader: 'Use este código para confirmar seu acesso.',
    build: () => ({
      blocks: [
        buildBlock('header'),
        { ...buildBlock('text'), text: 'Use o código abaixo para confirmar seu acesso. Ele expira em 10 minutos.' },
        { ...buildBlock('code'), label: 'Verification code', code: '123456', align: 'center' },
        { ...buildBlock('text'), text: 'Se você não solicitou este código, ignore este e-mail.' },
        { ...buildBlock('footer'), text: 'Segurança em primeiro lugar. Se precisar de ajuda, responda este e-mail.' }
      ]
    })
  },
  {
    key: 'request-completed',
    name: 'Request completed',
    subject: 'Request completed successfully',
    preheader: 'Sua solicitação foi concluída.',
    build: () => ({
      blocks: [
        buildBlock('header'),
        { ...buildBlock('text'), text: 'Boa notícia! Sua solicitação foi processada e concluída com sucesso.' },
        { ...buildBlock('button'), label: 'Ver detalhes', url: 'https://example.com', align: 'left' },
        { ...buildBlock('footer'), text: 'Obrigado por usar nosso serviço.' }
      ]
    })
  },
  {
    key: 'password-reset',
    name: 'Password reset',
    subject: 'Password reset requested',
    preheader: 'Recebemos um pedido de redefinição de senha.',
    build: () => ({
      blocks: [
        buildBlock('header'),
        { ...buildBlock('text'), text: 'Recebemos uma solicitação para redefinir sua senha. Se foi você, clique no botão abaixo.' },
        { ...buildBlock('button'), label: 'Redefinir senha', url: 'https://example.com', align: 'left' },
        { ...buildBlock('text'), text: 'Se não foi você, apenas ignore este e-mail.' }
      ]
    })
  },
  {
    key: 'service-down',
    name: 'Service DOWN alert',
    subject: 'Service DOWN alert',
    preheader: 'Detectamos indisponibilidade no serviço.',
    build: () => ({
      blocks: [
        { ...buildBlock('alert'), tone: 'danger', title: 'Serviço indisponível', text: 'O serviço principal ficou indisponível. Nosso time já foi acionado.' },
        { ...buildBlock('text'), text: 'Atualizaremos você a cada mudança de status.' }
      ]
    })
  },
  {
    key: 'payment-update',
    name: 'Payment update',
    subject: 'New payment service update',
    preheader: 'Atualização importante sobre pagamentos.',
    build: () => ({
      blocks: [
        buildBlock('header'),
        { ...buildBlock('text'), text: 'Publicamos uma atualização no serviço de pagamentos. Veja os detalhes e impacto.' },
        { ...buildBlock('button'), label: 'Ver changelog', url: 'https://example.com', align: 'left' }
      ]
    })
  },
  {
    key: 'memory-alert',
    name: 'Memory alert',
    subject: 'Memory usage threshold exceeded alert',
    preheader: 'Uso de memória acima do limite.',
    build: () => ({
      blocks: [
        { ...buildBlock('alert'), tone: 'warning', title: 'Memória acima do limite', text: 'O uso de memória ultrapassou 85%. Considere ajustar o plano ou otimizar serviços.' },
        { ...buildBlock('button'), label: 'Ver métricas', url: 'https://example.com', align: 'left' }
      ]
    })
  }
]

const TemplateModal = ({ data, onClose, onSave }) => {
  const normalizedDesign = normalizeDesign(data.design)
  const [name, setName] = useState(data.name || '')
  const [subject, setSubject] = useState(data.subject || '')
  const [preheader, setPreheader] = useState(data.preheader || '')
  const [blocks, setBlocks] = useState(
    Array.isArray(data.blocks) ? data.blocks.map(hydrateBlock) : normalizedDesign.blocks || []
  )
  const [theme, setTheme] = useState(normalizedDesign.theme || { ...DEFAULT_THEME })
  const [brandStyle, setBrandStyle] = useState(normalizedDesign.theme?.brandStyle || 'logo')
  const [htmlMode, setHtmlMode] = useState(data.htmlMode || false)
  const [html, setHtml] = useState(data.html || '')
  const [imageLibrary, setImageLibrary] = useState([])
  const [imageLoading, setImageLoading] = useState(false)
  const [imageError, setImageError] = useState('')
  const [imageUploading, setImageUploading] = useState(false)
  const [urlInputs, setUrlInputs] = useState({})
  const [logoUrlInput, setLogoUrlInput] = useState('')
  const [paramsText, setParamsText] = useState('{"name":"Samuel","code":"123456"}')
  const [editorExpanded, setEditorExpanded] = useState(false)

  const preview = useMemo(() => {
    if (htmlMode) return html
    let params = {}
    try {
      params = paramsText ? JSON.parse(paramsText) : {}
    } catch (err) {
      params = {}
    }
    const raw = buildHtml(blocks, { title: name || 'Template', subtitle: preheader, theme })
    return applyTemplateParams(raw, params)
  }, [blocks, htmlMode, html, name, preheader, theme, paramsText])

  const addBlock = (type) => setBlocks((prev) => [...prev, buildBlock(type)])

  const updateBlock = (index, patch) => {
    setBlocks((prev) => prev.map((block, i) => (i === index ? { ...block, ...patch } : block)))
  }

  const removeBlock = (index) => {
    setBlocks((prev) => prev.filter((_, i) => i !== index))
  }

  const updateTheme = (key, value) => {
    setTheme((prev) => ({ ...prev, [key]: value }))
  }

  const applyPreset = (preset) => {
    const next = preset.build()
    setName(preset.name)
    setSubject(preset.subject)
    setPreheader(preset.preheader)
    setBlocks(next.blocks || [])
  }

  const loadImageLibrary = async () => {
    setImageLoading(true)
    setImageError('')
    try {
      const response = await api.get('/storage/email-images')
      setImageLibrary(response.data.images || [])
    } catch (err) {
      setImageError('Falha ao carregar imagens')
    } finally {
      setImageLoading(false)
    }
  }

  useEffect(() => {
    loadImageLibrary()
  }, [])

  const updateUrlInput = (blockId, value) => {
    setUrlInputs((prev) => ({ ...prev, [blockId]: value }))
  }

  const handleImageUpload = async (file, index) => {
    if (!file) return
    setImageUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await api.post('/storage/email-images/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      const image = response.data.image
      await loadImageLibrary()
      if (image?.publicUrl) {
        updateBlock(index, {
          imageUrl: resolvePublicUrl(image.publicUrl),
          imageAlt: image.name || ''
        })
      }
    } catch (err) {
      setImageError('Falha ao enviar imagem')
    } finally {
      setImageUploading(false)
    }
  }

  const handleGridImageUpload = async (file, index, side) => {
    if (!file) return
    setImageUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await api.post('/storage/email-images/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      const image = response.data.image
      await loadImageLibrary()
      if (image?.publicUrl) {
        updateBlock(index, side === 'left'
          ? { leftImageUrl: resolvePublicUrl(image.publicUrl), leftImageAlt: image.name || '' }
          : { rightImageUrl: resolvePublicUrl(image.publicUrl), rightImageAlt: image.name || '' }
        )
      }
    } catch (err) {
      setImageError('Falha ao enviar imagem')
    } finally {
      setImageUploading(false)
    }
  }

  const handleGridImportUrl = async (index, side, blockId) => {
    const key = `${blockId}-${side}`
    const url = urlInputs[key]
    if (!url) return
    setImageUploading(true)
    try {
      const response = await api.post('/storage/email-images/from-url', { url })
      const image = response.data.image
      await loadImageLibrary()
      if (image?.publicUrl) {
        updateBlock(index, side === 'left'
          ? { leftImageUrl: resolvePublicUrl(image.publicUrl), leftImageAlt: image.name || '' }
          : { rightImageUrl: resolvePublicUrl(image.publicUrl), rightImageAlt: image.name || '' }
        )
      }
      updateUrlInput(key, '')
    } catch (err) {
      setImageError('Falha ao importar imagem')
    } finally {
      setImageUploading(false)
    }
  }

  const handleLogoUpload = async (file) => {
    if (!file) return
    setImageUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await api.post('/storage/email-images/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      const image = response.data.image
      await loadImageLibrary()
      if (image?.publicUrl) {
        updateTheme('logoUrl', resolvePublicUrl(image.publicUrl))
      }
    } catch (err) {
      setImageError('Falha ao enviar imagem')
    } finally {
      setImageUploading(false)
    }
  }

  const handleLogoImportUrl = async () => {
    if (!logoUrlInput) return
    setImageUploading(true)
    try {
      const response = await api.post('/storage/email-images/from-url', { url: logoUrlInput })
      const image = response.data.image
      await loadImageLibrary()
      if (image?.publicUrl) {
        updateTheme('logoUrl', resolvePublicUrl(image.publicUrl))
      }
      setLogoUrlInput('')
    } catch (err) {
      setImageError('Falha ao importar imagem')
    } finally {
      setImageUploading(false)
    }
  }

  const handleImportUrl = async (index, blockId) => {
    const url = urlInputs[blockId]
    if (!url) return
    setImageUploading(true)
    try {
      const response = await api.post('/storage/email-images/from-url', { url })
      const image = response.data.image
      await loadImageLibrary()
      if (image?.publicUrl) {
        updateBlock(index, {
          imageUrl: resolvePublicUrl(image.publicUrl),
          imageAlt: image.name || ''
        })
      }
      updateUrlInput(blockId, '')
    } catch (err) {
      setImageError('Falha ao importar imagem')
    } finally {
      setImageUploading(false)
    }
  }

  const isStoredImageUrl = (url) => {
    if (!url) return false
    if (url.startsWith('/public/storage/image')) return true
    if (url.startsWith('/api/public/storage/image')) return true
    if (typeof window !== 'undefined' && url.startsWith(`${window.location.origin}/public/storage/image`)) {
      return true
    }
    if (typeof window !== 'undefined' && url.startsWith(`${window.location.origin}/api/public/storage/image`)) {
      return true
    }
    return false
  }

  const importImageUrl = async (url) => {
    if (!url || isStoredImageUrl(url)) return url
    const response = await api.post('/storage/email-images/from-url', { url })
    const image = response.data.image
    await loadImageLibrary()
    return image?.publicUrl ? resolvePublicUrl(image.publicUrl) : url
  }

  const normalizeTemplateImages = async () => {
    const nextTheme = { ...theme }
    if (nextTheme.logoUrl && !isStoredImageUrl(nextTheme.logoUrl)) {
      nextTheme.logoUrl = await importImageUrl(nextTheme.logoUrl)
    }

    const nextBlocks = await Promise.all(
      blocks.map(async (block) => {
        if (block.type === 'image' && block.imageUrl && !isStoredImageUrl(block.imageUrl)) {
          const imageUrl = await importImageUrl(block.imageUrl)
          return { ...block, imageUrl }
        }
        if (block.type === 'grid') {
          const leftImageUrl = block.leftImageUrl && !isStoredImageUrl(block.leftImageUrl)
            ? await importImageUrl(block.leftImageUrl)
            : block.leftImageUrl
          const rightImageUrl = block.rightImageUrl && !isStoredImageUrl(block.rightImageUrl)
            ? await importImageUrl(block.rightImageUrl)
            : block.rightImageUrl
          return { ...block, leftImageUrl, rightImageUrl }
        }
        return block
      })
    )

    setTheme(nextTheme)
    setBlocks(nextBlocks)
    return { nextTheme, nextBlocks }
  }

  const handleSave = async () => {
    setImageUploading(true)
    setImageError('')
    let nextTheme = theme
    let nextBlocks = blocks
    try {
      const normalized = await normalizeTemplateImages()
      nextTheme = normalized.nextTheme
      nextBlocks = normalized.nextBlocks
      nextTheme.brandStyle = brandStyle
    } catch (err) {
      setImageError('Falha ao salvar imagens no storage')
    } finally {
      setImageUploading(false)
    }

    const payload = {
      id: data.id,
      name,
      subject,
      preheader,
      html: htmlMode ? html : preview,
      design: htmlMode ? null : { blocks: nextBlocks, theme: { ...nextTheme, brandStyle } }
    }
    onSave(payload)
  }

  const handleToggleHtml = () => {
    if (!htmlMode) {
      const rawPreview = buildHtml(blocks, { title: name || 'Template', subtitle: preheader, theme })
      setHtml(rawPreview)
      setHtmlMode(true)
      return
    }
    setHtmlMode(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-6xl max-h-[92vh] overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/90 p-6 text-slate-100">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Template</h3>
          <button
            className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-1 text-xs text-slate-200"
            onClick={handleToggleHtml}
          >
            {htmlMode ? 'Editor visual' : 'Editar HTML'}
          </button>
        </div>
        <div className="mt-4 grid h-[74vh] grid-cols-5 gap-4">
          <div className="col-span-2 overflow-y-auto pr-2">
            <div className="space-y-3">
            <input
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
              placeholder="Nome do template"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
              placeholder="Assunto"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
            <input
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
              placeholder="Preheader"
              value={preheader}
              onChange={(e) => setPreheader(e.target.value)}
            />
            <div className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[10px] text-slate-400">
              Variaveis dinamicas: use <span className="text-slate-200">{'{{name}}'}</span>,{' '}
              <span className="text-slate-200">{'{{code}}'}</span>,{' '}
              <span className="text-slate-200">{'{{request_id}}'}</span> e outras chaves enviadas via API em{' '}
              <span className="text-slate-200">params</span>.
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[10px] text-slate-400">
              <p className="mb-2 text-[10px] text-slate-400">Preview com params (JSON)</p>
              <textarea
                className="h-20 w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-[11px] text-slate-200"
                value={paramsText}
                onChange={(e) => setParamsText(e.target.value)}
              />
            </div>

            {!htmlMode && (
              <div className="space-y-2">
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                  <p className="text-xs text-slate-400 mb-2">Identidade</p>
                  <div className="mb-2 grid grid-cols-2 gap-2">
                    <button
                      className={`rounded-lg border px-2 py-1 text-[10px] ${brandStyle === 'logo' ? 'border-emerald-400 text-emerald-200' : 'border-slate-800 text-slate-300'}`}
                      onClick={() => {
                        setBrandStyle('logo')
                        updateTheme('brandStyle', 'logo')
                      }}
                    >
                      Apenas logo
                    </button>
                    <button
                      className={`rounded-lg border px-2 py-1 text-[10px] ${brandStyle === 'logo_text' ? 'border-emerald-400 text-emerald-200' : 'border-slate-800 text-slate-300'}`}
                      onClick={() => {
                        setBrandStyle('logo_text')
                        updateTheme('brandStyle', 'logo_text')
                      }}
                    >
                      Logo + texto
                    </button>
                  </div>
                  <input
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                    placeholder="Marca / Nome"
                    value={theme.brandName || ''}
                    onChange={(e) => updateTheme('brandName', e.target.value)}
                  />
                  {brandStyle === 'logo_text' && (
                    <input
                      type="number"
                      className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                      placeholder="Tamanho da logo (px)"
                      value={theme.logoSize || 32}
                      onChange={(e) => updateTheme('logoSize', Number(e.target.value) || 32)}
                    />
                  )}
                  <input
                    className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                    placeholder="Logo (URL salva no storage)"
                    value={theme.logoUrl || ''}
                    onChange={(e) => updateTheme('logoUrl', e.target.value)}
                  />
                  <div className="mt-2 rounded-lg border border-slate-800 bg-slate-900 p-2">
                    <p className="text-[10px] text-slate-400 mb-2">Upload de logo</p>
                    <input
                      type="file"
                      accept="image/*"
                      className="w-full text-[10px] text-slate-300"
                      onChange={(e) => handleLogoUpload(e.target.files?.[0])}
                    />
                    <p className="mt-2 text-[10px] text-slate-500">
                      {imageUploading ? 'Enviando...' : 'Salva no storage e usa no template.'}
                    </p>
                  </div>
                  <div className="mt-2 rounded-lg border border-slate-800 bg-slate-900 p-2">
                    <p className="text-[10px] text-slate-400 mb-2">Importar URL externa</p>
                    <div className="flex gap-2">
                      <input
                        className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs"
                        placeholder="https://..."
                        value={logoUrlInput}
                        onChange={(e) => setLogoUrlInput(e.target.value)}
                      />
                      <button
                        className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-[10px] text-slate-200"
                        onClick={handleLogoImportUrl}
                      >
                        Salvar
                      </button>
                    </div>
                    <p className="mt-2 text-[10px] text-slate-500">
                      Baixa a imagem e guarda no storage do painel.
                    </p>
                  </div>
                  <div className="mt-2 rounded-lg border border-slate-800 bg-slate-900 p-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] text-slate-400">Biblioteca de imagens</p>
                      <button
                        className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-[10px] text-slate-200"
                        onClick={loadImageLibrary}
                      >
                        Atualizar
                      </button>
                    </div>
                    {imageError && <p className="mt-1 text-[10px] text-rose-300">{imageError}</p>}
                    {imageLoading && <p className="mt-1 text-[10px] text-slate-500">Carregando...</p>}
                    {!imageLoading && imageLibrary.length === 0 && (
                      <p className="mt-1 text-[10px] text-slate-500">Nenhuma imagem no storage.</p>
                    )}
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {imageLibrary.map((image) => (
                        <button
                          key={image.path}
                          className="rounded-lg border border-slate-800 bg-slate-950 p-1 text-[10px] text-slate-200"
                          onClick={() => updateTheme('logoUrl', resolvePublicUrl(image.publicUrl))}
                        >
                          <img
                            src={resolvePublicUrl(image.publicUrl)}
                            alt={image.name}
                            className="h-10 w-full rounded-md object-cover"
                          />
                          <span className="mt-1 block truncate">{image.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 space-y-2">
                  <p className="text-xs text-slate-400">Tema</p>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-[10px] text-slate-400">
                      Fundo
                      <input
                        type="color"
                        className="mt-1 h-8 w-full rounded-lg border border-slate-800 bg-slate-900 p-1"
                        value={theme.backgroundColor}
                        onChange={(e) => updateTheme('backgroundColor', e.target.value)}
                      />
                    </label>
                    <label className="text-[10px] text-slate-400">
                      Cartao
                      <input
                        type="color"
                        className="mt-1 h-8 w-full rounded-lg border border-slate-800 bg-slate-900 p-1"
                        value={theme.surfaceColor}
                        onChange={(e) => updateTheme('surfaceColor', e.target.value)}
                      />
                    </label>
                    <label className="text-[10px] text-slate-400">
                      Destaque
                      <input
                        type="color"
                        className="mt-1 h-8 w-full rounded-lg border border-slate-800 bg-slate-900 p-1"
                        value={theme.accentColor}
                        onChange={(e) => updateTheme('accentColor', e.target.value)}
                      />
                    </label>
                    <label className="text-[10px] text-slate-400">
                      Texto
                      <input
                        type="color"
                        className="mt-1 h-8 w-full rounded-lg border border-slate-800 bg-slate-900 p-1"
                        value={theme.textColor}
                        onChange={(e) => updateTheme('textColor', e.target.value)}
                      />
                    </label>
                    <label className="text-[10px] text-slate-400">
                      Botao
                      <input
                        type="color"
                        className="mt-1 h-8 w-full rounded-lg border border-slate-800 bg-slate-900 p-1"
                        value={theme.buttonColor}
                        onChange={(e) => updateTheme('buttonColor', e.target.value)}
                      />
                    </label>
                    <label className="text-[10px] text-slate-400">
                      Texto botao
                      <input
                        type="color"
                        className="mt-1 h-8 w-full rounded-lg border border-slate-800 bg-slate-900 p-1"
                        value={theme.buttonTextColor}
                        onChange={(e) => updateTheme('buttonTextColor', e.target.value)}
                      />
                    </label>
                  </div>
                  <input
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                    placeholder="Fonte (ex: Trebuchet MS)"
                    value={theme.fontFamily}
                    onChange={(e) => updateTheme('fontFamily', e.target.value)}
                  />
                  <input
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                    placeholder="Texto do rodape"
                    value={theme.footerText}
                    onChange={(e) => updateTheme('footerText', e.target.value)}
                  />
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                  <p className="text-xs text-slate-400 mb-2">Templates rapidos</p>
                  <div className="flex flex-wrap gap-2">
                    {TEMPLATE_PRESETS.map((preset) => (
                      <button
                        key={preset.key}
                        className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-[10px] text-slate-200"
                        onClick={() => applyPreset(preset)}
                      >
                        {preset.name}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-slate-400">Blocos</p>
                <div className="flex flex-wrap gap-2">
                  {['header', 'text', 'button', 'image', 'grid', 'code', 'alert', 'divider', 'spacer', 'footer'].map((type) => (
                    <button
                      key={type}
                      className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-200"
                      onClick={() => addBlock(type)}
                    >
                      + {type}
                    </button>
                  ))}
                </div>
                <div className="space-y-2">
                  {blocks.map((block, index) => (
                    <div key={block.id} className="rounded-lg border border-slate-800 bg-slate-950 p-2">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-slate-300">{block.type}</span>
                        <button
                          className="text-xs text-rose-300"
                          onClick={() => removeBlock(index)}
                        >
                          remover
                        </button>
                      </div>
                      {block.type === 'header' && (
                        <>
                          <input
                            className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                            placeholder="Titulo"
                            value={block.title}
                            onChange={(e) => updateBlock(index, { title: e.target.value })}
                          />
                          <input
                            className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                            placeholder="Subtitulo"
                            value={block.subtitle}
                            onChange={(e) => updateBlock(index, { subtitle: e.target.value })}
                          />
                          <select
                            className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                            value={block.align || 'left'}
                            onChange={(e) => updateBlock(index, { align: e.target.value })}
                          >
                            <option value="left">Alinhar esquerda</option>
                            <option value="center">Centralizar</option>
                            <option value="right">Alinhar direita</option>
                          </select>
                        </>
                      )}
                      {block.type === 'text' && (
                        <>
                          <textarea
                            className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                            placeholder="Texto"
                            value={block.text}
                            onChange={(e) => updateBlock(index, { text: e.target.value })}
                          />
                          <select
                            className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                            value={block.align || 'left'}
                            onChange={(e) => updateBlock(index, { align: e.target.value })}
                          >
                            <option value="left">Alinhar esquerda</option>
                            <option value="center">Centralizar</option>
                            <option value="right">Alinhar direita</option>
                          </select>
                        </>
                      )}
                      {block.type === 'button' && (
                        <>
                          <input
                            className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                            placeholder="Label"
                            value={block.label}
                            onChange={(e) => updateBlock(index, { label: e.target.value })}
                          />
                          <input
                            className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                            placeholder="URL"
                            value={block.url}
                            onChange={(e) => updateBlock(index, { url: e.target.value })}
                          />
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <label className="text-[10px] text-slate-400">
                              Cor botao
                              <input
                                type="color"
                                className="mt-1 h-8 w-full rounded-lg border border-slate-800 bg-slate-900 p-1"
                                value={block.buttonColor || theme.buttonColor}
                                onChange={(e) => updateBlock(index, { buttonColor: e.target.value })}
                              />
                            </label>
                            <label className="text-[10px] text-slate-400">
                              Texto botao
                              <input
                                type="color"
                                className="mt-1 h-8 w-full rounded-lg border border-slate-800 bg-slate-900 p-1"
                                value={block.buttonTextColor || theme.buttonTextColor}
                                onChange={(e) => updateBlock(index, { buttonTextColor: e.target.value })}
                              />
                            </label>
                          </div>
                          <select
                            className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                            value={block.align || 'left'}
                            onChange={(e) => updateBlock(index, { align: e.target.value })}
                          >
                            <option value="left">Alinhar esquerda</option>
                            <option value="center">Centralizar</option>
                            <option value="right">Alinhar direita</option>
                          </select>
                        </>
                      )}
                      {block.type === 'image' && (
                        <>
                          <input
                            className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                            placeholder="URL da imagem"
                            value={block.imageUrl}
                            onChange={(e) => updateBlock(index, { imageUrl: e.target.value })}
                          />
                          <div className="mt-2 rounded-lg border border-slate-800 bg-slate-900 p-2">
                            <p className="text-[10px] text-slate-400 mb-2">Upload</p>
                            <input
                              type="file"
                              accept="image/*"
                              className="w-full text-[10px] text-slate-300"
                              onChange={(e) => handleImageUpload(e.target.files?.[0], index)}
                            />
                            <p className="mt-2 text-[10px] text-slate-500">
                              {imageUploading ? 'Enviando...' : 'Salva no storage e usa no template.'}
                            </p>
                          </div>
                          <input
                            className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                            placeholder="Alt"
                            value={block.imageAlt}
                            onChange={(e) => updateBlock(index, { imageAlt: e.target.value })}
                          />
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <input
                              type="number"
                              className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                              placeholder="Largura (%)"
                              value={block.width || 100}
                              onChange={(e) => updateBlock(index, { width: Number(e.target.value) || 100 })}
                            />
                            <input
                              type="number"
                              className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                              placeholder="Altura (px)"
                              value={block.height || 80}
                              onChange={(e) => updateBlock(index, { height: Number(e.target.value) || 80 })}
                            />
                          </div>
                          <input
                            className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                            placeholder="Link (opcional)"
                            value={block.linkUrl || ''}
                            onChange={(e) => updateBlock(index, { linkUrl: e.target.value })}
                          />
                          <div className="mt-2 rounded-lg border border-slate-800 bg-slate-900 p-2">
                            <p className="text-[10px] text-slate-400 mb-2">Importar URL externa</p>
                            <div className="flex gap-2">
                              <input
                                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs"
                                placeholder="https://..."
                                value={urlInputs[block.id] || ''}
                                onChange={(e) => updateUrlInput(block.id, e.target.value)}
                              />
                              <button
                                className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-[10px] text-slate-200"
                                onClick={() => handleImportUrl(index, block.id)}
                              >
                                Salvar
                              </button>
                            </div>
                            <p className="mt-2 text-[10px] text-slate-500">
                              Baixa a imagem e guarda no storage do painel.
                            </p>
                          </div>
                          <select
                            className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                            value={block.align || 'center'}
                            onChange={(e) => updateBlock(index, { align: e.target.value })}
                          >
                            <option value="left">Alinhar esquerda</option>
                            <option value="center">Centralizar</option>
                            <option value="right">Alinhar direita</option>
                          </select>
                          <div className="mt-2 rounded-lg border border-slate-800 bg-slate-900 p-2">
                            <div className="flex items-center justify-between">
                              <p className="text-[10px] text-slate-400">Biblioteca de imagens</p>
                              <button
                                className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-[10px] text-slate-200"
                                onClick={loadImageLibrary}
                              >
                                Atualizar
                              </button>
                            </div>
                            {imageError && <p className="mt-1 text-[10px] text-rose-300">{imageError}</p>}
                            {imageLoading && <p className="mt-1 text-[10px] text-slate-500">Carregando...</p>}
                            {!imageLoading && imageLibrary.length === 0 && (
                              <p className="mt-1 text-[10px] text-slate-500">Nenhuma imagem no storage.</p>
                            )}
                            <div className="mt-2 grid grid-cols-3 gap-2">
                              {imageLibrary.map((image) => (
                                <button
                                  key={image.path}
                                  className="rounded-lg border border-slate-800 bg-slate-950 p-1 text-[10px] text-slate-200"
                                  onClick={() =>
                                    updateBlock(index, {
                                      imageUrl: resolvePublicUrl(image.publicUrl),
                                      imageAlt: image.name || ''
                                    })
                                  }
                                >
                                  <img
                                    src={resolvePublicUrl(image.publicUrl)}
                                    alt={image.name}
                                    className="h-16 w-full rounded-md object-cover"
                                  />
                                  <span className="mt-1 block truncate">{image.name}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        </>
                      )}
                      {block.type === 'grid' && (
                        <>
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                              placeholder="Titulo esquerda"
                              value={block.leftTitle || ''}
                              onChange={(e) => updateBlock(index, { leftTitle: e.target.value })}
                            />
                            <input
                              className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                              placeholder="Titulo direita"
                              value={block.rightTitle || ''}
                              onChange={(e) => updateBlock(index, { rightTitle: e.target.value })}
                            />
                          </div>
                          <textarea
                            className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                            placeholder="Texto esquerda"
                            value={block.leftText || ''}
                            onChange={(e) => updateBlock(index, { leftText: e.target.value })}
                          />
                          <textarea
                            className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                            placeholder="Texto direita"
                            value={block.rightText || ''}
                            onChange={(e) => updateBlock(index, { rightText: e.target.value })}
                          />
                          <input
                            className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                            placeholder="Imagem esquerda (URL)"
                            value={block.leftImageUrl || ''}
                            onChange={(e) => updateBlock(index, { leftImageUrl: e.target.value })}
                          />
                          <div className="mt-2 rounded-lg border border-slate-800 bg-slate-900 p-2">
                            <p className="text-[10px] text-slate-400 mb-2">Upload imagem esquerda</p>
                            <input
                              type="file"
                              accept="image/*"
                              className="w-full text-[10px] text-slate-300"
                              onChange={(e) => handleGridImageUpload(e.target.files?.[0], index, 'left')}
                            />
                            <p className="mt-2 text-[10px] text-slate-500">
                              {imageUploading ? 'Enviando...' : 'Salva no storage e usa no template.'}
                            </p>
                          </div>
                          <div className="mt-2 rounded-lg border border-slate-800 bg-slate-900 p-2">
                            <p className="text-[10px] text-slate-400 mb-2">Importar URL externa</p>
                            <div className="flex gap-2">
                              <input
                                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs"
                                placeholder="https://..."
                                value={urlInputs[`${block.id}-left`] || ''}
                                onChange={(e) => updateUrlInput(`${block.id}-left`, e.target.value)}
                              />
                              <button
                                className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-[10px] text-slate-200"
                                onClick={() => handleGridImportUrl(index, 'left', block.id)}
                              >
                                Salvar
                              </button>
                            </div>
                          </div>
                          <div className="mt-2 rounded-lg border border-slate-800 bg-slate-900 p-2">
                            <div className="flex items-center justify-between">
                              <p className="text-[10px] text-slate-400">Biblioteca (esquerda)</p>
                              <button
                                className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-[10px] text-slate-200"
                                onClick={loadImageLibrary}
                              >
                                Atualizar
                              </button>
                            </div>
                            {imageError && <p className="mt-1 text-[10px] text-rose-300">{imageError}</p>}
                            {imageLoading && <p className="mt-1 text-[10px] text-slate-500">Carregando...</p>}
                            {!imageLoading && imageLibrary.length === 0 && (
                              <p className="mt-1 text-[10px] text-slate-500">Nenhuma imagem no storage.</p>
                            )}
                            <div className="mt-2 grid grid-cols-3 gap-2">
                              {imageLibrary.map((image) => (
                                <button
                                  key={`${image.path}-left`}
                                  className="rounded-lg border border-slate-800 bg-slate-950 p-1 text-[10px] text-slate-200"
                                  onClick={() =>
                                    updateBlock(index, {
                                      leftImageUrl: resolvePublicUrl(image.publicUrl),
                                      leftImageAlt: image.name || ''
                                    })
                                  }
                                >
                                  <img
                                    src={resolvePublicUrl(image.publicUrl)}
                                    alt={image.name}
                                    className="h-10 w-full rounded-md object-cover"
                                  />
                                  <span className="mt-1 block truncate">{image.name}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <input
                              type="number"
                              className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                              placeholder="Largura esq. (px)"
                              value={block.leftImageWidth || 140}
                              onChange={(e) => updateBlock(index, { leftImageWidth: Number(e.target.value) || 140 })}
                            />
                            <input
                              type="number"
                              className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                              placeholder="Altura esq. (px)"
                              value={block.leftImageHeight || 80}
                              onChange={(e) => updateBlock(index, { leftImageHeight: Number(e.target.value) || 80 })}
                            />
                          </div>
                          <input
                            className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                            placeholder="Imagem direita (URL)"
                            value={block.rightImageUrl || ''}
                            onChange={(e) => updateBlock(index, { rightImageUrl: e.target.value })}
                          />
                          <div className="mt-2 rounded-lg border border-slate-800 bg-slate-900 p-2">
                            <p className="text-[10px] text-slate-400 mb-2">Upload imagem direita</p>
                            <input
                              type="file"
                              accept="image/*"
                              className="w-full text-[10px] text-slate-300"
                              onChange={(e) => handleGridImageUpload(e.target.files?.[0], index, 'right')}
                            />
                            <p className="mt-2 text-[10px] text-slate-500">
                              {imageUploading ? 'Enviando...' : 'Salva no storage e usa no template.'}
                            </p>
                          </div>
                          <div className="mt-2 rounded-lg border border-slate-800 bg-slate-900 p-2">
                            <p className="text-[10px] text-slate-400 mb-2">Importar URL externa</p>
                            <div className="flex gap-2">
                              <input
                                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs"
                                placeholder="https://..."
                                value={urlInputs[`${block.id}-right`] || ''}
                                onChange={(e) => updateUrlInput(`${block.id}-right`, e.target.value)}
                              />
                              <button
                                className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-[10px] text-slate-200"
                                onClick={() => handleGridImportUrl(index, 'right', block.id)}
                              >
                                Salvar
                              </button>
                            </div>
                          </div>
                          <div className="mt-2 rounded-lg border border-slate-800 bg-slate-900 p-2">
                            <div className="flex items-center justify-between">
                              <p className="text-[10px] text-slate-400">Biblioteca (direita)</p>
                              <button
                                className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-[10px] text-slate-200"
                                onClick={loadImageLibrary}
                              >
                                Atualizar
                              </button>
                            </div>
                            {imageError && <p className="mt-1 text-[10px] text-rose-300">{imageError}</p>}
                            {imageLoading && <p className="mt-1 text-[10px] text-slate-500">Carregando...</p>}
                            {!imageLoading && imageLibrary.length === 0 && (
                              <p className="mt-1 text-[10px] text-slate-500">Nenhuma imagem no storage.</p>
                            )}
                            <div className="mt-2 grid grid-cols-3 gap-2">
                              {imageLibrary.map((image) => (
                                <button
                                  key={`${image.path}-right`}
                                  className="rounded-lg border border-slate-800 bg-slate-950 p-1 text-[10px] text-slate-200"
                                  onClick={() =>
                                    updateBlock(index, {
                                      rightImageUrl: resolvePublicUrl(image.publicUrl),
                                      rightImageAlt: image.name || ''
                                    })
                                  }
                                >
                                  <img
                                    src={resolvePublicUrl(image.publicUrl)}
                                    alt={image.name}
                                    className="h-10 w-full rounded-md object-cover"
                                  />
                                  <span className="mt-1 block truncate">{image.name}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <input
                              type="number"
                              className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                              placeholder="Largura dir. (px)"
                              value={block.rightImageWidth || 140}
                              onChange={(e) => updateBlock(index, { rightImageWidth: Number(e.target.value) || 140 })}
                            />
                            <input
                              type="number"
                              className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                              placeholder="Altura dir. (px)"
                              value={block.rightImageHeight || 80}
                              onChange={(e) => updateBlock(index, { rightImageHeight: Number(e.target.value) || 80 })}
                            />
                          </div>
                          <input
                            type="number"
                            className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                            placeholder="Espacamento (px)"
                            value={block.gap || 16}
                            onChange={(e) => updateBlock(index, { gap: Number(e.target.value) || 16 })}
                          />
                        </>
                      )}
                      {block.type === 'code' && (
                        <>
                          <input
                            className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                            placeholder="Label"
                            value={block.label}
                            onChange={(e) => updateBlock(index, { label: e.target.value })}
                          />
                          <input
                            className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                            placeholder="Codigo"
                            value={block.code}
                            onChange={(e) => updateBlock(index, { code: e.target.value })}
                          />
                          <select
                            className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                            value={block.align || 'left'}
                            onChange={(e) => updateBlock(index, { align: e.target.value })}
                          >
                            <option value="left">Alinhar esquerda</option>
                            <option value="center">Centralizar</option>
                            <option value="right">Alinhar direita</option>
                          </select>
                        </>
                      )}
                      {block.type === 'alert' && (
                        <>
                          <input
                            className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                            placeholder="Titulo"
                            value={block.title}
                            onChange={(e) => updateBlock(index, { title: e.target.value })}
                          />
                          <textarea
                            className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                            placeholder="Texto do alerta"
                            value={block.text}
                            onChange={(e) => updateBlock(index, { text: e.target.value })}
                          />
                          <select
                            className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                            value={block.tone || 'warning'}
                            onChange={(e) => updateBlock(index, { tone: e.target.value })}
                          >
                            <option value="info">Info</option>
                            <option value="warning">Warning</option>
                            <option value="danger">Critical</option>
                          </select>
                        </>
                      )}
                      {block.type === 'divider' && (
                        <label className="text-[10px] text-slate-400">
                          Cor do divisor
                          <input
                            type="color"
                            className="mt-1 h-8 w-full rounded-lg border border-slate-800 bg-slate-900 p-1"
                            value={block.color || theme.borderColor}
                            onChange={(e) => updateBlock(index, { color: e.target.value })}
                          />
                        </label>
                      )}
                      {block.type === 'spacer' && (
                        <input
                          type="number"
                          className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                          placeholder="Altura"
                          value={block.height || 16}
                          onChange={(e) => updateBlock(index, { height: Number(e.target.value) || 16 })}
                        />
                      )}
                      {block.type === 'footer' && (
                        <textarea
                          className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                          placeholder="Texto do rodape"
                          value={block.text}
                          onChange={(e) => updateBlock(index, { text: e.target.value })}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {htmlMode && (
              <div className="w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
                <div className="flex items-center justify-between border-b border-slate-800 px-2 py-1 text-[10px] text-slate-400">
                  <span>HTML</span>
                  <button
                    className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] text-slate-200"
                    onClick={() => setEditorExpanded(true)}
                  >
                    Expandir
                  </button>
                </div>
                <Editor
                  height="384px"
                  language="html"
                  theme="vs-dark"
                  value={html}
                  onChange={(value) => setHtml(value || '')}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 12,
                    wordWrap: 'on',
                    scrollBeyondLastLine: false
                  }}
                />
              </div>
            )}
            </div>
          </div>
          <div className="col-span-3">
            <div className="sticky top-0 rounded-xl border border-slate-800 bg-slate-950 p-4">
              <p className="text-xs text-slate-400 mb-2">Preview</p>
              <div
                className="max-h-[62vh] overflow-y-auto rounded-lg border border-slate-800 bg-white p-2"
                dangerouslySetInnerHTML={{ __html: preview }}
              />
            </div>
          </div>
        </div>
        <div className="mt-5 flex gap-2 justify-end">
          <button
            onClick={handleSave}
            className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950"
          >
            Salvar
          </button>
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-xs text-slate-200"
          >
            Cancelar
          </button>
        </div>
      </div>
      {editorExpanded && (
        <div className="fixed inset-0 z-[60] bg-slate-950/90 p-4">
          <div className="flex h-full flex-col rounded-2xl border border-slate-800 bg-slate-950">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3 text-xs text-slate-300">
              <span>Editor HTML (tela cheia)</span>
              <button
                className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-200"
                onClick={() => setEditorExpanded(false)}
              >
                Fechar
              </button>
            </div>
            <div className="flex-1">
              <Editor
                height="100%"
                language="html"
                theme="vs-dark"
                value={html}
                onChange={(value) => setHtml(value || '')}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  wordWrap: 'on',
                  scrollBeyondLastLine: false
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const TestModal = ({ data, onClose, onSend, sending, templates, configs }) => {
  const [to, setTo] = useState(data.to || '')
  const [templateId, setTemplateId] = useState(data.templateId || '')
  const [configId, setConfigId] = useState(data.configId || '')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/90 p-6 text-slate-100">
        <h3 className="text-lg font-semibold">Enviar teste</h3>
        <div className="mt-4 space-y-3">
          <input
            className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
            placeholder="email@destino.com"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          {data.type !== 'smtp' && (
            <select
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              <option value="">Selecione o template</option>
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name}
                </option>
              ))}
            </select>
          )}
          <select
            className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
            value={configId}
            onChange={(e) => setConfigId(e.target.value)}
          >
            <option value="">SMTP ativo</option>
            {configs.map((cfg) => (
              <option key={cfg.id} value={cfg.id}>
                {cfg.name}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-5 flex gap-2 justify-end">
          <button
            onClick={() => onSend({ to, templateId: templateId || undefined, configId: configId || undefined, subject: 'Teste SMTP', html: '<p>Teste enviado pelo ProvirPanel.</p>' })}
            className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950"
            disabled={sending}
          >
            {sending ? 'Enviando...' : 'Enviar'}
          </button>
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-xs text-slate-200"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}

export default EmailPanel
