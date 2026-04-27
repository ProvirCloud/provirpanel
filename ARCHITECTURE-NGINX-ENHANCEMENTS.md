# Diagrama de Arquitetura - Nginx Canvas Enhancements

## 🏗️ Estrutura Geral

```
NginxCanvasPage (viewMode: 'files' | 'topology' | 'cards')
├── NginxFilesView (default)
│   └── SiteFlowDiagram (por site)
│       └── Expandable Containers
│           ├── Actions
│           │   ├── Edit → SiteEditForm
│           │   ├── View .conf → NginxConfigFileEditor
│           │   ├── Permissions → SitePermissionsEditor [NEW]
│           │   ├── Enable/Disable
│           │   └── Delete
│           └── SiteFlowDiagram (mini-topologia)
├── NginxTopologyDiagram (view global)
└── Cards View (grid)
```

---

## 🔍 Fluxo de Edição com Validação

```
User edita .conf
    ↓
onChange → content
    ↓
⏱️ 800ms debounce
    ↓
validateNginxSyntaxClient()
    ├─ Verificar braces {}
    ├─ Verificar brackets []
    ├─ Verificar diretivas
    └─ Retorna: errors[], warnings[]
    ↓
validation.valid ? 
    ↓ SIM
validateNginxConfigRemote() 
    POST /api/nginx/validate
    ├─ nginx -t realizado no servidor
    └─ Retorna validação final
    ↓
[Validation Panel]
├─ ✅ Valid (verde)
├─ ❌ Errors (vermelho) 
└─ ⚠️ Warnings (amarelo)
    ↓
User clica "Salvar"
    ↓
validation.valid && hasChanges ?
    ↓ SIM
createBackup() 
    POST /api/nginx/configs/{site}/backup
    └─ Razão: "Pre-save backup"
    ↓
api.put(/nginx/configs/{site}, { content })
    ↓
✅ Sucesso → onSave() → onClose()
```

---

## 💾 Estratégia de Backup

```
Timeline de um arquivo

T=0s      [Arquivo original]
          Usuário abre editor
          
T=5min    [Auto-backup #1]
          5 minutos se houver mudanças
          Razão: "Auto-backup before edit"
          
T=10min   [Auto-backup #2]
          Continua a cada 5min
          
T=20min   [User clica Salvar]
          ├─ Pre-save backup criado
          │  Razão: "Pre-save backup"
          ├─ Validação OK
          ├─ API put() executado
          └─ ✅ Novo config ativo

Histórico de backup
├─ Auto-backup #1 (T=5min) 
├─ Auto-backup #2 (T=10min)
├─ Auto-backup #3 (T=15min)
├─ Pre-save backup (T=20min)
└─ [Arquivo ativo agora]
```

---

## 🔐 Sistema de Permissões

```
SitePermissionsEditor Modal
    ├─ LEVELS
    │   ├─ 👁️  Visualizar (view only)
    │   ├─ ✏️  Editar (view + edit)
    │   ├─ 🔒 Gerenciar (edit + toggle + backup)
    │   └─ 🛡️  Admin (full access)
    │
    └─ INTERFACE
        ├─ [Add Permission Form]
        │   ├─ Input: username
        │   ├─ Select: level
        │   └─ Button: Adicionar
        │
        ├─ [Permissions List]
        │   ├─ User: "alice"
        │   │   ├─ Level: Editar
        │   │   ├─ Granted: 25/04/2026 by admin
        │   │   ├─ Change level: [dropdown]
        │   │   └─ Remove: [button]
        │   │
        │   ├─ User: "bob"
        │   │   ├─ Level: Visualizar
        │   │   ├─ Granted: 26/04/2026 by admin
        │   │   ├─ Change level: [dropdown]
        │   │   └─ Remove: [button]
        │   │
        │   └─ ... more users
        │
        └─ Backend Validation
            ├─ GET /api/nginx/{site}/permissions
            ├─ POST /api/nginx/{site}/permissions
            ├─ PUT  /api/nginx/{site}/permissions/{id}
            └─ DELETE /api/nginx/{site}/permissions/{id}
```

---

## 🔍 Preview de Configuração (Futuro)

```
NginxConfigPreview Modal (quando implementar)
    ├─ [Parsed Structure]
    │   ├─ server
    │   │   ├─ listen 80
    │   │   ├─ server_name example.com
    │   │   └─ location /api
    │   │       └─ proxy_pass http://localhost:3000
    │   │
    │   └─ upstream backend
    │       ├─ server 192.168.1.10:3000
    │       └─ server 192.168.1.11:3000
    │
    ├─ [Diff View] (mudanças)
    │   ├─ + nova linha
    │   ├─ - linha removida
    │   └─ ~ linha modificada
    │
    ├─ [Impact Analysis]
    │   ├─ Rotas afetadas: 5
    │   ├─ Backends afetados: 2
    │   ├─ SSL status: changed
    │   └─ ⚠️ Breaking changes: 1
    │
    └─ [Actions]
        ├─ [Copy] Copiar preview
        ├─ [Download] Baixar estrutura
        └─ [Back to Edit]
```

---

## 📊 Arquivos Criados/Modificados

```
✅ Criados:
├─ services/nginxValidator.js
│   └─ validateNginxSyntax()
│   └─ validateNginxConfigRemote()
│
├─ components/nginx/SitePermissionsEditor.tsx
│   └─ Modal completo com UI
│
└─ ROADMAP-NGINX-CANVAS.md
    └─ Documentação completa

🔄 Modificados:
├─ components/nginx/NginxConfigFileEditor.tsx
│   ├─ + Validação em tempo real
│   ├─ + Auto-backup
│   ├─ + Indicadores visuais
│   └─ + Botão Preview
│
└─ components/nginx/NginxFilesView.tsx
    └─ Pronto para integrar permissões
```

---

## 🚀 Implementação do Backend

### Endpoint 1: Validação
```javascript
// POST /api/nginx/validate
async validateConfig(req, res) {
  const { config, site } = req.body
  
  try {
    // Usar nginx -t para validar
    const result = await exec(`nginx -t -c ${tempFile}`)
    res.json({ 
      valid: true, 
      errors: [], 
      warnings: [] 
    })
  } catch (error) {
    res.json({ 
      valid: false, 
      errors: [{ line: error.line, message: error.msg }],
      warnings: []
    })
  }
}
```

### Endpoint 2: Backup
```javascript
// POST /api/nginx/configs/{site}/backup
async createBackup(req, res) {
  const { site } = req.params
  const { content, reason } = req.body
  
  const backupId = `backup_${Date.now()}`
  const backupPath = `${BACKUP_DIR}/${site}/${backupId}.conf`
  
  await fs.writeFile(backupPath, content)
  
  res.json({ 
    backupId, 
    timestamp: new Date(),
    reason 
  })
}
```

### Endpoint 3: Permissões
```javascript
// GET /api/nginx/{site}/permissions
async getPermissions(req, res) {
  const { site } = req.params
  const permissions = await db.getSitePermissions(site)
  res.json(permissions)
}

// POST /api/nginx/{site}/permissions
async addPermission(req, res) {
  const { site } = req.params
  const { username, level } = req.body
  
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin required' })
  }
  
  const perm = await db.addSitePermission(site, {
    username,
    level,
    grantedBy: req.user.id,
    grantedAt: new Date()
  })
  
  res.json(perm)
}
```

---

## 🔗 Integração com NginxFilesView

```tsx
// Adicionar em SiteFlowDiagram/Actions
<Button
  variant="ghost"
  size="sm"
  leadingIcon={<Shield size={12} />}
  onClick={(e) => {
    e.stopPropagation()
    onOpenPermissions(site)  // Callback para abrir modal
  }}
  disabled={!canManagePermissions}
>
  Permissões
</Button>

// No NginxCanvasPage
const [permissionsSite, setPermissionsSite] = useState(null)

const handleOpenPermissions = (site: NginxSite) => {
  setPermissionsSite(site)
}

{permissionsSite && (
  <SitePermissionsEditor
    siteName={permissionsSite.name}
    permissions={...}
    currentUserRole={userRole}
    onAddPermission={...}
    onRemovePermission={...}
    onUpdatePermission={...}
    onClose={() => setPermissionsSite(null)}
  />
)}
```

---

## ✅ Checklist de Implementação

- [x] Validação de sintaxe (client + server ready)
- [x] Backup automático (client ready)
- [x] Editor de permissões (client ready)
- [ ] Preview de configuração (estrutura criada)
- [ ] Backend: /api/nginx/validate
- [ ] Backend: /api/nginx/configs/{site}/backup
- [ ] Backend: /api/nginx/{site}/permissions
- [ ] Integração de permissões em NginxFilesView
- [ ] Testes E2E de fluxos
- [ ] Documentação do usuário
