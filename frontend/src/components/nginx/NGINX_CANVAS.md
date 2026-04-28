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

---

# Nginx Visual Full — `/nginx-visual-full`

## Resumo

A rota **`/nginx-visual-full`** é uma implementação separada do canvas clássico. Ela não depende do parser de configs reais do backend e opera com um **estado local em JSON**, voltado para uma experiência visual guiada do fluxo Nginx do Zeus.

Entrada:

```tsx
frontend/src/pages/NginxVisualEditorFull.tsx
```

Esse arquivo apenas renderiza:

```tsx
<NginxVisualFullPage />
```

Ou seja: toda a lógica da tela full foi isolada em `components/nginx-full/`.

---

## Objetivo da tela

Representar visualmente o cenário Zeus:

```text
Internet
→ zeusengine.com.br / www.zeusengine.com.br
→ HTTP :80
→ HTTPS :443 (SSL)
→ /api/        → zeus_api
→ /socket.io/  → zeus_socket
→ /admin/      → /var/www/panel
→ /            → /var/www/zeus
```

Com edição guiada de:

- path
- upstream
- load balancer
- timeouts
- headers
- SSL / HTTP2
- alias / fallback

Sem backend, sem deploy real, sem parser de `.conf` e sem autosave.

---

## Estrutura de arquivos

```text
frontend/src/
  pages/
    NginxVisualEditorFull.tsx

  components/
    nginx-full/
      NginxVisualFullPage.tsx
      NginxFlowCanvas.tsx
      NginxFlowNode.tsx
      NginxConfigPanel.tsx
      GeneratedNginxConfig.tsx
      UpstreamList.tsx
      SecurityRulesPanel.tsx
      nginxVisualConfig.ts
      nginxConfigGenerator.ts
```

---

## Fonte da verdade

O estado da tela fica em:

```ts
frontend/src/components/nginx-full/nginxVisualConfig.ts
```

### Tipos principais

- `NginxVisualState`
- `RouteConfig`
- `UpstreamConfig`
- `SelectedNode`
- `RouteTimeouts`
- `LoadBalancerMethod`
- `HeaderName`

### Cenário inicial implementado

O JSON inicial já nasce com:

- domínio principal `zeusengine.com.br`
- domínio adicional `www.zeusengine.com.br`
- HTTP `:80` com redirect para HTTPS
- HTTPS `:443` com:
  - SSL ativo
  - HTTP/2 ativo
  - Let's Encrypt
  - security headers
  - HSTS
  - `server_tokens off`
  - `client_max_body_size = 500m`
- upstream `zeus_api`
  - `least_conn`
  - `127.0.0.1:3000`
  - `127.0.0.1:3001`
  - `127.0.0.1:3002`
- upstream `zeus_socket`
  - `ip_hash`
  - `127.0.0.1:3000`
  - `127.0.0.1:3001`
  - `127.0.0.1:3002`
- rotas:
  - `/api/`
  - `/socket.io/`
  - `/admin/`
  - `/admin/assets/`
  - `/zeus/assets/`
  - `/`

---

## Página principal — `NginxVisualFullPage.tsx`

Responsável por:

- montar o layout da página
- manter o `state`
- manter o `selected`
- gerar o `nginx.conf`
- compor canvas, painel lateral e cards inferiores

### Estado mantido

```ts
const [state, setState] = useState(createInitialNginxVisualState)
const [selected, setSelected] = useState<SelectedNode>({ kind: 'route', id: 'route-api' })
```

### Configuração gerada

```ts
const generatedConfig = useMemo(() => generateNginxConfig(state), [state])
```

### Layout atual

Topo:

- título `Nginx Manager`
- subtítulo operacional

Área central:

- esquerda: `NginxFlowCanvas`
- direita: `NginxConfigPanel`

Rodapé:

- `GeneratedNginxConfig`
- `UpstreamList`
- `SecurityRulesPanel`

Esse layout foi ajustado várias vezes ao longo do trabalho para aproximar do mock visual enviado pelo usuário.

---

## Canvas visual — `NginxFlowCanvas.tsx`

Responsável por desenhar o fluxo fixo do Nginx.

### Características

- não usa React Flow
- não usa drag-and-drop
- não tem posicionamento livre
- é um canvas **estruturado**, em colunas/layers fixas

### O que aparece no mapa

Bloco superior:

- domínio principal
- HTTP :80
- HTTPS :443

Quatro colunas de rotas:

- `/api/`
- `/socket.io/`
- `/admin/`
- `/`

Blocos de destino:

- `LB: zeus_api`
- `LB: zeus_socket`
- `/var/www/panel`
- `/var/www/zeus`

Sublistas:

- servidores do upstream da API
- servidores do upstream do socket
- leaves estáticos:
  - `/admin/`
  - `/admin/assets/`
  - `/zeus/assets/`
  - `/index.html`

### Toolbar funcional

O mapa ganhou botões reais:

- `+`
  - aumenta o zoom
- `-`
  - reduz o zoom
- `expand`
  - abre o canvas em modo expandido
  - usa overlay sobre a página
  - bloqueia o scroll do body enquanto está expandido
- `shield`
  - ativa modo de bloqueio de seleção
  - quando ativo, clicar nos nodes não altera mais o `selected`

### Estado local do canvas

```ts
const [zoom, setZoom] = useState(1)
const [expanded, setExpanded] = useState(false)
const [locked, setLocked] = useState(false)
```

### Comportamento de seleção

Todos os cliques do canvas passam por:

```ts
const selectNode = (selection: SelectedNode) => {
  if (locked) return
  onSelect(selection)
}
```

Ou seja, o mapa pode entrar em modo protegido.

### Ajustes visuais feitos no canvas

Ao longo da evolução da tela, estes pontos foram trabalhados:

- nodes muito grandes
- excesso de respiro vertical
- largura excessiva
- espaçamento horizontal exagerado
- falta de comportamento real no botão expandir

Resultado atual:

- nodes compactados
- conectores mais curtos
- grid mais densa
- canvas mais próximo do mock operacional do Zeus

---

## Node visual — `NginxFlowNode.tsx`

Componente base de card clicável do mapa.

### Props

- `title`
- `subtitle`
- `detail`
- `tone`
- `icon`
- `selected`
- `onClick`
- `children`
- `className`

### Tons suportados

- `domain`
- `http`
- `https`
- `proxy`
- `websocket`
- `static`
- `upstream`
- `target`

Cada tom controla:

- borda
- background
- cor do texto
- cor do ícone
- cor da linha de detalhe

### O que foi ajustado nesse componente

- redução de padding
- redução do tamanho dos ícones
- redução do tamanho do texto
- redução da altura geral
- melhor densidade visual para o mapa

---

## Painel lateral — `NginxConfigPanel.tsx`

Responsável pela edição contextual do node selecionado.

### Seleções tratadas

- `domain`
- `http`
- `https`
- `route`
- `upstream`
- `static-target`

### O que o painel mostra hoje

Para rotas proxy/websocket:

- tipo
- upstream
- load balancer
- websocket toggle visual
- proxy buffering
- timeouts
- headers

Para rotas estáticas:

- alias
- fallback
- `try_files`

Para upstream:

- método
- lista de servidores

Para domínio/HTTP/HTTPS:

- informações resumidas e campos básicos

### Ações do rodapé

- `Desativar Rota`
- `Salvar Rota`

Hoje essas ações são visuais; não fazem deploy real.

---

## Geração de nginx.conf — `nginxConfigGenerator.ts`

Esse arquivo gera o preview textual da configuração com base no JSON.

### Garantias implementadas

- server `80` com redirect para HTTPS
- server `443 ssl http2`
- certificados Let’s Encrypt
- `client_max_body_size 500m`
- upstream `zeus_api` com `least_conn`
- upstream `zeus_socket` com `ip_hash`
- `/api/` com:
  - proxy headers
  - `proxy_buffering off`
  - `connect/read/send`
- `/socket.io/` com:
  - websocket headers
  - timeouts longos
- rotas estáticas com alias / fallback
- raiz usando `location / { ... }`

### Importante

Não gera:

```nginx
location = {
```

Esse caso foi explicitamente evitado.

---

## Card de config — `GeneratedNginxConfig.tsx`

Mostra o preview gerado do `nginx.conf`.

### Funcionalidades

- renderização do texto completo
- botão `Copiar`
- feedback visual de copiado

Essa seção hoje aparece no rodapé, como no mock aprovado.

---

## Card de upstreams — `UpstreamList.tsx`

Mostra cada upstream com:

- nome
- ícone
- método
- badge `Ativo`
- lista de servidores
- botão visual `Novo Upstream`

Os cards são clicáveis e atualizam o painel lateral com `selected.kind = 'upstream'`.

---

## Card de segurança — `SecurityRulesPanel.tsx`

Mostra um resumo operacional das regras globais:

- SSL/TLS
- HSTS
- Security Headers
- Server Tokens
- Body Size
- HTTP/2
- redirect HTTP → HTTPS

Também possui botão visual:

- `Editar Regras`

---

## Evolução da UI feita até aqui

### Fase 1

Criação da versão isolada da rota full, separada do canvas legado.

### Fase 2

Introdução de:

- canvas fixo
- painel lateral contextual
- preview de config
- upstreams
- segurança

### Fase 3

Refino visual para:

- reduzir poluição
- compactar nodes
- aproximar do design do mock

### Fase 4

Aproximação estrutural do screenshot:

- header `Nginx Manager`
- card grande do mapa
- painel direito fixo
- rodapé triplo

### Fase 5

Toolbar do mapa funcional:

- zoom
- expandir
- lock

### Fase 6

Compactação adicional do mapa:

- menos espaçamento sobrando
- melhor uso da largura
- nodes menores

---

## O que não foi implementado

Nesta tela full, propositalmente não foi feito:

- backend
- persistência real
- autosave
- deploy do Nginx
- parser de `.conf` do servidor
- leitura/escrita de arquivos reais
- múltiplos sites reais
- drag-and-drop
- React Flow

---

## Limitações atuais

- a tela é visual e orientada a um cenário fixo Zeus
- o mapa ainda usa coordenadas/layout estruturado manualmente
- o botão `Salvar Rota` ainda não publica nada
- o botão `Desativar Rota` ainda é visual
- a toolbar do mapa controla a visualização local, não o domínio nem o deploy

---

## Arquivos realmente alterados/criados nesta entrega

### Entrada da rota

- `frontend/src/pages/NginxVisualEditorFull.tsx`

### Implementação da tela full

- `frontend/src/components/nginx-full/NginxVisualFullPage.tsx`
- `frontend/src/components/nginx-full/NginxFlowCanvas.tsx`
- `frontend/src/components/nginx-full/NginxFlowNode.tsx`
- `frontend/src/components/nginx-full/NginxConfigPanel.tsx`
- `frontend/src/components/nginx-full/GeneratedNginxConfig.tsx`
- `frontend/src/components/nginx-full/UpstreamList.tsx`
- `frontend/src/components/nginx-full/SecurityRulesPanel.tsx`
- `frontend/src/components/nginx-full/nginxVisualConfig.ts`
- `frontend/src/components/nginx-full/nginxConfigGenerator.ts`

---

## Resumo final

O trabalho feito na `/nginx-visual-full` foi:

1. isolar a nova tela do canvas legado
2. definir um modelo JSON próprio como fonte da verdade
3. montar um fluxo visual fixo do cenário Zeus
4. criar um painel lateral contextual
5. gerar `nginx.conf` a partir do estado
6. estruturar rodapé com config, upstreams e segurança
7. aproximar a UI do mock operacional enviado
8. tornar a toolbar do mapa funcional
9. reduzir o excesso de espaço e o tamanho do canvas

Esse documento cobre o que foi construído até o estado atual da implementação.
