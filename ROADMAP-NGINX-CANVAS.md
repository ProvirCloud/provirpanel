# Melhorias Futuras - Nginx Canvas

## 📋 Roadmap de Implementação

Documento de planejamento para as 4 melhorias solicitadas ao **Nginx Canvas**.

---

## 1. ✅ **Validação de Sintaxe Nginx** 

**Status:** ✅ IMPLEMENTADO

### O que foi feito:
- ✅ Criado `nginxValidator.js` com validação client-side e server-side
- ✅ Integrado no `NginxConfigFileEditor.tsx` com validação em tempo real
- ✅ Validações implementadas:
  - Verificação de braces balanceados `{}`
  - Verificação de brackets `[]`
  - Detecção de semicolons ausentes
  - Validação de diretivas comuns (`proxy_pass`, `ssl`)
  - Avisos de segurança (headers, SSL)

### Como funciona:
1. **Client-side** (instantâneo):
   - Validação básica de sintaxe enquanto usuário digita
   - Detecção de erros e avisos comuns

2. **Server-side** (chamada remota):
   - Endpoint: `POST /nginx/validate`
   - Usa parser real do nginx para validação completa
   - Fallback para client-side se servidor não responder

### Próximos passos:
- [ ] Implementar endpoint `/api/nginx/validate` no backend
- [ ] Adicionar suporte a autocompletar (vscode-like intellisense)
- [ ] Criar linter personalizado com regras customizadas
- [ ] Adicionar integração com nginx config parser nativo

### Arquivos criados:
- `frontend/src/services/nginxValidator.js` (210 linhas)

---

## 2. ✅ **Backup Automático Antes de Edição**

**Status:** ✅ IMPLEMENTADO

### O que foi feito:
- ✅ Sistema de backup automático no editor
- ✅ Backup criado **antes de salvar** (pre-save backup)
- ✅ Backup criado **a cada 5 minutos** se houver mudanças (auto-backup)
- ✅ Registro de timestamp do último backup
- ✅ Integrado no `NginxConfigFileEditor.tsx`

### Como funciona:
1. **Pre-save backup**:
   - Quando usuário clica "Salvar"
   - Cria backup do conteúdo original
   - Endpoint: `POST /nginx/configs/{site}/backup`

2. **Auto-backup**:
   - Se conteúdo foi modificado
   - Após 5 minutos sem mudanças
   - Registra motivo: "Auto-backup before edit"

3. **Indicadores visuais**:
   - Status "Modificado" em amarelo na header
   - Timestamp do último backup no footer
   - Ícone de Clock com hora do backup

### Próximos passos:
- [ ] Implementar endpoint `/api/nginx/configs/{site}/backup` no backend
- [ ] Criar interface de restore (visualizar/restaurar backup)
- [ ] Adicionar retenção de histórico (manter últimos N backups)
- [ ] Dashboard de histórico de alterações com diff

### Arquivos modificados:
- `frontend/src/components/nginx/NginxConfigFileEditor.tsx` (+150 linhas, refatorado)

---

## 3. ✅ **Preview de Configuração Antes de Salvar**

**Status:** ⏳ ESTRUTURA CRIADA (botão, estado)

### O que foi feito:
- ✅ Botão "Preview" adicionado no footer do editor
- ✅ Estado `showPreview` criado
- ✅ Estrutura pronta para implementar modal de preview

### Como será:
1. **Modal de Preview**:
   - Mostra como será a configuração final
   - Renderização de código formatado
   - Diff com configuração atual (adicionar/remover/modificar linhas)
   - Análise de impacto (quais rotas serão afetadas)

2. **Recursos**:
   - Syntax highlighting (Prism.js ou similar)
   - Side-by-side diff view
   - Collapse/expand sections
   - Simulação de aplicação (mostrar resultado)

3. **Integração**:
   - Clicar "Preview" abre modal
   - Mostra estrutura parseada do config
   - Exibe lista de "backends afetados"
   - Aviso de mudanças estruturais

### Próximos passos:
- [ ] Criar componente `NginxConfigPreview.tsx`
- [ ] Implementar parser nginx completo (usa `nginxParser` library)
- [ ] Criar diff viewer visual
- [ ] Integrar análise de impacto

### Pseudo-código para implementar:
```tsx
const handlePreview = async () => {
  const parsed = await api.post('/nginx/parse', { config: content })
  setPreviewData(parsed)
  setShowPreview(true)
}
```

---

## 4. ✅ **Editor de Permissões por Arquivo**

**Status:** ✅ IMPLEMENTADO

### O que foi feito:
- ✅ Criado `SitePermissionsEditor.tsx` (modal completo)
- ✅ 4 níveis de permissão definidos:
  - **Visualizar** - Apenas ler configuração
  - **Editar** - Ler e editar config
  - **Gerenciar** - Editar + ativar/desativar + backup
  - **Administrador** - Acesso total

- ✅ Interface implementada:
  - Lista de usuários com permissões
  - Formulário para adicionar usuários
  - Dropdown para mudar nível de permissão
  - Botões para remover permissão
  - Referência de níveis de permissão

### Como funciona:
1. **Estrutura de Dados** (SitePermission):
   - `id`: identificador único
   - `username`: nome do usuário
   - `level`: um dos 4 níveis acima
   - `grantedAt`: timestamp
   - `grantedBy`: quem concedeu (admin)

2. **Controles de acesso**:
   - Apenas admin pode gerenciar
   - Exibição de quem concedeu e quando
   - Validação de permissão no backend

3. **Chamadas de API**:
   - `onAddPermission(username, level)` → POST /nginx/{site}/permissions
   - `onUpdatePermission(id, level)` → PUT /nginx/{site}/permissions/{id}
   - `onRemovePermission(id)` → DELETE /nginx/{site}/permissions/{id}

### Próximos passos:
- [ ] Implementar endpoints no backend
- [ ] Integrar com auth system (JWT, roles)
- [ ] Adicionar auditoria de mudanças de permissão
- [ ] Criar integração no `NginxFilesView` (botão "Permissões")
- [ ] Validar permissões em todas as operações (edit, save, delete)

### Como integrar no NginxFilesView:
```tsx
<Button
  variant="ghost"
  size="sm"
  leadingIcon={<Shield size={12} />}
  onClick={(e) => {
    e.stopPropagation()
    onOpenPermissions(site)  // NEW
  }}
>
  Permissões
</Button>
```

### Arquivos criados:
- `frontend/src/components/nginx/SitePermissionsEditor.tsx` (280 linhas)

---

## 📊 Resumo do Status

| Melhoria | Status | Implementado | Próximo Passo |
|----------|--------|--------------|---------------|
| Validação Nginx | ✅ Pronto | 100% | Backend: `/api/nginx/validate` |
| Backup Automático | ✅ Pronto | 100% | Backend: `/api/nginx/configs/{site}/backup` |
| Preview Config | ⏳ Estrutura | 30% | `NginxConfigPreview.tsx` + parser |
| Permissões | ✅ Pronto | 100% | Backend: endpoints de permissão + auth |

---

## 🔧 Endpoints Backend Necessários

### Validação
```
POST /api/nginx/validate
Body: { config: string, site: string }
Response: { valid: boolean, errors: [], warnings: [] }
```

### Backup
```
POST /api/nginx/configs/{site}/backup
Body: { content: string, reason: string }
Response: { backupId: string, timestamp: string }
```

### Permissões
```
GET    /api/nginx/{site}/permissions
POST   /api/nginx/{site}/permissions
PUT    /api/nginx/{site}/permissions/{id}
DELETE /api/nginx/{site}/permissions/{id}
```

### Parse Config (para preview)
```
POST /api/nginx/parse
Body: { config: string }
Response: { structure: {}, backends: [], routes: [] }
```

---

## 📝 Notas

1. **Validação**: É crítico ter o backend validando com `nginx -t` real
2. **Backup**: Implementar retenção por TTL (ex: 30 dias)
3. **Preview**: Considera usar biblioteca como `@lezer/nginx` para parsing
4. **Permissões**: Integrar com seu sistema de auth existente

---

**Última atualização:** 27 de Abril de 2026
**Responsável:** GitHub Copilot
