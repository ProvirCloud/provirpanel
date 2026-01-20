import { useEffect, useMemo, useState } from 'react'
import { Mail, Plus, Trash2, Pencil, Send, ShieldCheck } from 'lucide-react'
import api from '../services/api.js'

const buildBlock = (type) => ({
  id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
  type,
  title: '',
  subtitle: '',
  text: '',
  url: '',
  label: '',
  imageUrl: '',
  imageAlt: ''
})

const buildHtml = (blocks = [], meta = {}) => {
  const header = `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:32px 0;font-family:Arial,sans-serif;">
      <tr><td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#0b1220;border-radius:20px;overflow:hidden;border:1px solid #1f2a44;">
          <tr><td style="padding:32px;text-align:center;background:linear-gradient(135deg,#0ea5e9,#22c55e);color:#0b1220;">
            <h1 style="margin:0;font-size:26px;font-weight:700;">${meta.title || 'Provir Cloud'}</h1>
            <p style="margin:8px 0 0;font-size:14px;">${meta.subtitle || 'Mensagem automatica'}</p>
          </td></tr>
          <tr><td style="padding:28px 32px;background:#0b1220;color:#e2e8f0;">
  `

  const footer = `
          </td></tr>
          <tr><td style="padding:20px 32px;background:#0f172a;color:#94a3b8;font-size:12px;text-align:center;">
            ${meta.footer || 'Enviado pelo ProvirPanel'}
          </td></tr>
        </table>
      </td></tr>
    </table>
  `

  const body = blocks.map((block) => {
    if (block.type === 'header') {
      return `
        <div style="margin-bottom:20px;">
          <h2 style="margin:0 0 6px;font-size:20px;color:#f8fafc;">${block.title || 'Titulo'}</h2>
          <p style="margin:0;color:#94a3b8;font-size:14px;">${block.subtitle || ''}</p>
        </div>
      `
    }
    if (block.type === 'text') {
      return `
        <p style="margin:0 0 16px;color:#cbd5f5;font-size:14px;line-height:1.6;">
          ${block.text || ''}
        </p>
      `
    }
    if (block.type === 'button') {
      return `
        <div style="margin:18px 0;">
          <a href="${block.url || '#'}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#22c55e;color:#0b1220;font-weight:600;font-size:14px;text-decoration:none;">
            ${block.label || 'Acessar'}
          </a>
        </div>
      `
    }
    if (block.type === 'image') {
      return `
        <div style="margin:20px 0;text-align:center;">
          <img src="${block.imageUrl || ''}" alt="${block.imageAlt || ''}" style="max-width:100%;border-radius:14px;border:1px solid #1f2a44;" />
        </div>
      `
    }
    if (block.type === 'divider') {
      return `<hr style="border:none;border-top:1px solid #1f2a44;margin:20px 0;" />`
    }
    if (block.type === 'footer') {
      return `
        <p style="margin:20px 0 0;color:#64748b;font-size:12px;line-height:1.6;">
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
                    blocks: [buildBlock('header'), buildBlock('text'), buildBlock('button')],
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
                          blocks: Array.isArray(tpl.design) ? tpl.design : [],
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

const TemplateModal = ({ data, onClose, onSave }) => {
  const [name, setName] = useState(data.name || '')
  const [subject, setSubject] = useState(data.subject || '')
  const [preheader, setPreheader] = useState(data.preheader || '')
  const [blocks, setBlocks] = useState(data.blocks || [])
  const [htmlMode, setHtmlMode] = useState(data.htmlMode || false)
  const [html, setHtml] = useState(data.html || '')

  const preview = useMemo(() => {
    if (htmlMode) return html
    return buildHtml(blocks, { title: name || 'Template', subtitle: preheader })
  }, [blocks, htmlMode, html, name, preheader])

  const addBlock = (type) => setBlocks((prev) => [...prev, buildBlock(type)])

  const updateBlock = (index, patch) => {
    setBlocks((prev) => prev.map((block, i) => (i === index ? { ...block, ...patch } : block)))
  }

  const removeBlock = (index) => {
    setBlocks((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSave = () => {
    const payload = {
      id: data.id,
      name,
      subject,
      preheader,
      html: htmlMode ? html : preview,
      design: htmlMode ? null : blocks
    }
    onSave(payload)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-5xl rounded-2xl border border-slate-800 bg-slate-900/90 p-6 text-slate-100">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Template</h3>
          <button
            className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-1 text-xs text-slate-200"
            onClick={() => setHtmlMode((prev) => !prev)}
          >
            {htmlMode ? 'Editor visual' : 'Editar HTML'}
          </button>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-4">
          <div className="col-span-1 space-y-3">
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

            {!htmlMode && (
              <div className="space-y-2">
                <p className="text-xs text-slate-400">Blocos</p>
                <div className="flex flex-wrap gap-2">
                  {['header', 'text', 'button', 'image', 'divider', 'footer'].map((type) => (
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
                        </>
                      )}
                      {block.type === 'text' && (
                        <textarea
                          className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                          placeholder="Texto"
                          value={block.text}
                          onChange={(e) => updateBlock(index, { text: e.target.value })}
                        />
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
                          <input
                            className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                            placeholder="Alt"
                            value={block.imageAlt}
                            onChange={(e) => updateBlock(index, { imageAlt: e.target.value })}
                          />
                        </>
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
              <textarea
                className="h-96 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs"
                value={html}
                onChange={(e) => setHtml(e.target.value)}
              />
            )}
          </div>
          <div className="col-span-2">
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
              <p className="text-xs text-slate-400 mb-2">Preview</p>
              <div
                className="rounded-lg border border-slate-800 bg-white p-2"
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
