# Nginx Canvas — Documentação Técnica

## Visão geral

O **Nginx Canvas** é uma interface visual para gerenciar configurações nginx, inspirada no Infra Canvas (Docker stacks). Cada virtual host é representado como um card com um diagrama de fluxo mostrando de onde vem o tráfego e para onde vai.

Rota: `/nginx` → `NginxCanvasPage.tsx`

---

## Estrutura de arquivos

```
src/
  pages/
    NginxCanvasPage.tsx          # Página principal — lista de cards + modal
  components/
    nginx/
      SiteCard.tsx               # Card visual de cada virtual host
      SiteModal.tsx              # Wizard de criação/edição (3–4 passos)
  types/
    nginx.ts                     # Tipos, parser e builder de config nginx
```

---

## Fluxo de dados

```
Backend  →  GET /nginx/configs  →  BackendConfig[]
                                        ↓
                               extractSiteInfo()      ← tipos/nginx.ts
                                        ↓
                                   NginxSite[]
                                        ↓
                        SiteCard  ←  NginxCanvasPage  →  SiteModal
```

O backend retorna o conteúdo **raw** de cada arquivo `.conf`. O frontend faz todo o parsing no cliente, dentro de `extractSiteInfo()`.

---

## Parser (`types/nginx.ts`)

### Por que parsing no cliente?

O backend lê e retorna o texto bruto dos arquivos nginx. Em vez de parsear no servidor (que quebraria configs incomuns), o cliente extrai o que consegue e exibe o que não entende como fallback em modo read-only.

### Extração de server blocks — `extractServerBlocks()`

Usa **contagem de chaves** (`depth++` / `depth--`) em vez de regex, porque blocos aninhados (`location { if { } }`) quebrariam qualquer regex simples.

```
upstream app { ... }
server { ... }     ← extraído
server { ... }     ← extraído (bloco HTTPS preferido quando há dois)
```

Quando o arquivo tem dois server blocks (redirect HTTP → HTTPS), o parser **prefere o bloco HTTPS** para extrair as configurações principais:

```typescript
const mainBlock =
  serverBlocks.find(b => /\blisten\s[^;]*443[^;]*ssl/.test(b)) ||
  serverBlocks[0]
```

### Extração de location blocks — `extractLocationBlocks()`

Também usa contagem de chaves. O regex do path usa `([^{]+?)` (lazy, sem `\s`) para capturar paths multi-palavra como:

| Tipo           | Exemplo                                    |
|----------------|--------------------------------------------|
| Exato          | `= /robots.txt`                            |
| Prefixo forte  | `^~ /admin/`                               |
| Regex          | `~* \.(jpg\|png)$`                         |
| Verificação    | `= /google4ce1fbbc8da57702.html`           |

### Filtro de locations

Locations que são **apenas redirect** são descartadas do display:

```typescript
const isRedirectOnly =
  /\breturn\s+30[12]\s/.test(inner) &&
  !/proxy_pass/.test(inner) &&
  !/\broot\s/.test(inner) &&
  !/try_files/.test(inner)
```

Isso limpa entradas como `location = /admin { return 301 /admin/; }` que poluiriam o card.

### Suporte a `alias`

Além de `root`, o parser também extrai `alias`:

```nginx
location ^~ /admin/ {
    alias /var/www/panel/;       ← capturado no campo root
    try_files $uri $uri/ /admin/index.html;
}
```

Prioridade: `root` → `alias` → root do server block.

### Detecção de tipo

| Condição                               | Tipo detectado   |
|----------------------------------------|------------------|
| Tem bloco `upstream { }`              | `load-balancer`  |
| Tem `proxy_pass` em alguma location   | `proxy`          |
| Tem `root` sem proxy_pass             | `static`         |

Configs **mistas** (proxy + alias/static) são classificadas como `proxy`, pois `hasProxy` tem prioridade.

### Tratamento de erros por config

Cada config é envolvida em try/catch:

```typescript
export const extractSiteInfo = (config: BackendConfig): NginxSite => {
  try {
    return _extractSiteInfo(config)
  } catch {
    return FALLBACK_SITE(config)  // exibe o card em modo degradado
  }
}
```

Um arquivo malformado não quebra a página inteira — aparece como card com dados mínimos.

---

## Tipos principais

```typescript
type NginxSite = {
  name: string              // nome do arquivo .conf
  displayName: string       // nome sem extensão
  type: 'proxy' | 'load-balancer' | 'static'
  serverNames: string[]     // domínios do server_name
  listenPort: string        // porta (sem "ssl http2")
  sslEnabled: boolean
  targets: NginxTarget[]    // servidores do upstream (load-balancer)
  locations: NginxLocation[] // todos os location blocks relevantes
  proxySettings: NginxProxySettings
  rootPath: string          // root do servidor (static)
  indexFiles: string        // index (static)
  toggleable/deletable/editable/readable: boolean
}

type NginxLocation = {
  path: string
  proxyHost: string         // host do proxy_pass (vazio se não for proxy)
  proxyPort: string
  root: string              // root ou alias
  tryFiles: string
  returnDirective: string
}

type NginxProxySettings = {
  websocket: boolean        // proxy_set_header Upgrade
  forwardHeaders: boolean   // X-Real-IP / X-Forwarded-For
  cacheBypass: boolean      // proxy_cache_bypass
  clientBodySize: string    // client_max_body_size
  connectTimeout: string    // proxy_connect_timeout
  readTimeout: string       // proxy_read_timeout
  sendTimeout: string       // proxy_send_timeout
}
```

---

## SiteCard

Exibe cada virtual host com:

- **Header**: domínio principal + badge de status (Ativo/Inativo)
- **Badges**: tipo + SSL
- **Diagrama de fluxo**: `Internet → Nginx:porta → destinos`
- **Pills de configuração**: WebSocket, Headers, Cache bypass, timeouts, body size, upstream method
- **Ações**: Editar, Ativar/Desativar, Remover

### Destinos por tipo

| Tipo           | Exibição                                              |
|----------------|-------------------------------------------------------|
| `proxy`        | Locations com `proxy_pass` → `host:porta`            |
| `load-balancer`| Lista de targets com peso e badge "backup"           |
| `static`       | Locations com path → `try_files` (ou `root`)         |

Para configs mistas (proxy + alias), apenas as locations com `proxy_pass` aparecem no card — as locations estáticas são detalhes de implementação.

---

## SiteModal

Wizard de 3 ou 4 passos:

| Passo | Nome          | Proxy | LB | Static |
|-------|---------------|-------|----|--------|
| 0     | Identificação | ✓     | ✓  | ✓      |
| 1     | Roteamento    | ✓     | ✓  | ✓      |
| 2     | Proxy         | ✓     | ✓  | —      |
| 3     | SSL           | ✓     | ✓  | ✓      |

### Inicialização ao editar

- **Proxy**: carrega apenas locations com `proxy_pass` (configs mistas perdem as locations alias — o editor não suporta configs mistas)
- **Static**: carrega `staticLocations` a partir dos location blocks existentes (`path` + `try_files`)
- **Load-balancer**: carrega targets do upstream

### Campos por tipo (Passo 1 — Roteamento)

**Proxy**: lista de locations com Path / Host / Porta  
**Load-balancer**: nome do upstream + método + lista de servidores (Host / Porta / Peso / Backup)  
**Static**: root + index + lista de locations (`path` + `try_files` editáveis)

### Builder — `buildNginxConfig()`

Gera o arquivo `.conf` a partir do formulário. Para static com SSL:

```nginx
server {
    listen 80;
    server_name example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name example.com;
    ssl_certificate ...;

    root /var/www/html;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

---

## Limitações conhecidas

- **Configs mistas** (proxy + alias na mesma porta): exibidas corretamente no card, mas editar no wizard reconstrói apenas as locations proxy — as locations alias são perdidas. Recomenda-se editar configs mistas diretamente no arquivo.
- **Múltiplos upstreams**: apenas o primeiro bloco `upstream { }` é extraído.
- **Diretivas avançadas**: `add_header`, `ssl_session_cache`, `proxy_buffering`, `server_tokens`, etc. são preservadas no campo `raw` mas não são editáveis no wizard.
- **`location = {`** (malformed, sem path): filtrado automaticamente por ser redirect-only.
