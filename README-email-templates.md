# ProvirPanel — Email/Template Editor (Documentação Técnica)

Este documento descreve todas as alterações realizadas no **painel** (frontend + backend) relacionadas a Email/SMTP, editor de templates, storage público de imagens e parametrização dinâmica.

## 1) Backend — Email/SMTP

### 1.1. SES sem exigir SMTP host
- Correção: quando o provider é `provir` (SES via API), não exige `SMTP host`.
- Arquivo: `painel/backend/src/routes/email.js`

### 1.2. Parâmetros dinâmicos
- Suporte a placeholders no HTML e subject:
  - `{{name}}`, `{{code}}`, `{{request_id}}` (e outras chaves via `params`)
- Substituição é aplicada antes de enviar o e-mail.
- Arquivo: `painel/backend/src/routes/email.js`

**Exemplo de payload**
```json
{
  "templateId": 1,
  "to": "user@dominio.com",
  "params": {
    "name": "Samuel",
    "code": "123456",
    "request_id": "REQ-9921"
  }
}
```

---

## 2) Backend — Storage público de imagens

### 2.1. Upload e listagem de imagens
Rotas novas:
- `GET /storage/email-images` → lista imagens
- `POST /storage/email-images/upload` → upload (multipart)
- `POST /storage/email-images/from-url` → baixa URL externa e salva no storage

### 2.2. Rota pública
- `GET /api/public/storage/image?path=...`
- Somente imagens dentro de `/email-assets`

### 2.3. Regras
- Tipos permitidos: png, jpg, jpeg, gif, webp, svg
- Limite de tamanho: 5MB
- URLs externas sempre são baixadas e salvas localmente

**Arquivos**
- `painel/backend/src/routes/storage.js`
- `painel/backend/src/routes/public-storage.js` (novo)
- `painel/backend/src/server.js`

---

## 3) Frontend — Editor de Templates

### 3.1. Editor visual + HTML
- Editor visual por blocos
- Modo HTML com Monaco Editor (syntax highlight)
- HTML é gerado automaticamente ao alternar para HTML

**Arquivo:**
- `painel/frontend/src/components/EmailPanel.jsx`

### 3.2. Preview
- Preview sempre visível (coluna direita sticky)
- Scroll interno quando excede altura
- Preview com params: JSON aplicado em tempo real

### 3.3. Layout do modal
- Modal maior (`max-w-6xl`)
- Coluna de propriedades com scroll
- Preview sempre visível
- Editor HTML com opção “Expandir” (tela cheia)

---

## 4) Blocos e Componentes

### 4.1. Blocos disponíveis
- header
- text
- button
- image
- divider
- footer
- **code** (OTP / verificação)
- **alert** (info / warning / danger)
- **spacer**
- **grid** (duas colunas)

### 4.2. Grid (duas colunas)
- Para imagem + texto lado a lado
- Cada lado possui:
  - título, texto, imagem, upload, URL externa, biblioteca
- Controle de tamanho das imagens

---

## 5) Imagens no Editor

### 5.1. Upload
- Upload direto salva no storage
- Usa URL pública automaticamente

### 5.2. URL externa
- Baixa e salva no storage
- Nunca mantém link externo

### 5.3. Biblioteca
- Mostra todas imagens do storage
- Click aplica no bloco

---

## 6) Identidade (Branding)

- Logo + nome da marca
- Opções:
  - **Apenas logo**
  - **Logo + texto**
- Upload/URL/biblioteca para logo
- Tamanho configurável (px)
- Logo em “logo + texto” sem corte (`object-fit: contain`)

---

## 7) Templates rápidos (presets)

- Verification code
- Request completed successfully
- Password reset requested
- Service DOWN alert
- New payment service update
- Memory usage threshold exceeded alert

---

## 8) Observações gerais

- Todas imagens do template são normalizadas para o storage antes de salvar.
- URLs públicas seguem:
  - `/api/public/storage/image?path=/email-assets/arquivo.png`
- Editor HTML permite expansão em tela cheia.

---

## 9) Arquivos modificados (resumo)

**Backend**
- `painel/backend/src/routes/email.js`
- `painel/backend/src/routes/storage.js`
- `painel/backend/src/routes/public-storage.js` (novo)
- `painel/backend/src/server.js`

**Frontend**
- `painel/frontend/src/components/EmailPanel.jsx`

---

Se quiser, posso gerar também:
- README com endpoints completos e exemplos
- checklist de deploy
- documentação para clientes (uso do template editor)
