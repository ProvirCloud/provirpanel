'use strict';

const fs = require('fs');
const path = require('path');

class ProjectTemplateManager {
  constructor() {
    this.templates = {
      'node-app': {
        files: {
          'package.json': JSON.stringify({
            name: 'my-node-app',
            version: '1.0.0',
            main: 'index.js',
            scripts: {
              start: 'node index.js',
              dev: 'nodemon index.js'
            },
            dependencies: {
              express: '^4.18.0'
            }
          }, null, 2),
          'index.js': `const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    service: 'CloudPainel Node.js Demo'
  });
});

// API endpoint
app.get('/api/status', (req, res) => {
  res.json({ 
    message: 'Serviço funcionando perfeitamente!',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  });
});

// Serve demo page
app.get('/', (req, res) => {
  res.send(\`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CloudPainel - Node.js Demo</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .container {
            max-width: 800px;
            padding: 40px;
            text-align: center;
        }
        .card {
            background: rgba(255,255,255,0.1);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 40px;
            margin: 20px 0;
            border: 1px solid rgba(255,255,255,0.2);
        }
        h1 { font-size: 3em; margin-bottom: 20px; }
        .status {
            display: inline-flex;
            align-items: center;
            gap: 10px;
            background: rgba(34, 197, 94, 0.2);
            padding: 10px 20px;
            border-radius: 50px;
            border: 1px solid rgba(34, 197, 94, 0.3);
        }
        .status-dot {
            width: 12px;
            height: 12px;
            background: #22c55e;
            border-radius: 50%;
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
        .btn {
            background: rgba(59, 130, 246, 0.8);
            color: white;
            padding: 12px 24px;
            border: none;
            border-radius: 10px;
            cursor: pointer;
            font-size: 16px;
            margin: 10px;
            transition: all 0.3s;
        }
        .btn:hover {
            background: rgba(59, 130, 246, 1);
            transform: translateY(-2px);
        }
        .info {
            background: rgba(0,0,0,0.2);
            padding: 20px;
            border-radius: 10px;
            margin: 20px 0;
            font-family: monospace;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 CloudPainel Node.js</h1>
        
        <div class="card">
            <div class="status">
                <div class="status-dot"></div>
                <span>Serviço Online</span>
            </div>
            <p style="margin-top: 20px; font-size: 1.2em;">Seu serviço Node.js está funcionando perfeitamente!</p>
        </div>
        
        <div class="card">
            <h2>Teste os Endpoints</h2>
            <button class="btn" onclick="testHealth()">🏥 Health Check</button>
            <button class="btn" onclick="testAPI()">📡 API Status</button>
            <div id="result" class="info" style="display: none;"></div>
        </div>
        
        <div class="card">
            <h2>Próximos Passos</h2>
            <p>• Edite o código em <code>/usr/src/app/index.js</code></p>
            <p>• Adicione novas rotas e funcionalidades</p>
            <p>• Configure variáveis de ambiente</p>
            <p>• Conecte com banco de dados</p>
        </div>
    </div>
    
    <script>
        async function testHealth() {
            try {
                const response = await fetch('/health');
                const data = await response.json();
                showResult('Health Check', data);
            } catch (err) {
                showResult('Erro', { error: err.message });
            }
        }
        
        async function testAPI() {
            try {
                const response = await fetch('/api/status');
                const data = await response.json();
                showResult('API Status', data);
            } catch (err) {
                showResult('Erro', { error: err.message });
            }
        }
        
        function showResult(title, data) {
            const result = document.getElementById('result');
            result.style.display = 'block';
            result.innerHTML = '<h3>' + title + '</h3><pre>' + JSON.stringify(data, null, 2) + '</pre>';
        }
        
        // Auto health check on load
        window.onload = () => {
            setTimeout(testHealth, 1000);
        };
    </script>
</body>
</html>
\`);
});

app.listen(port, () => {
  console.log(\`🚀 CloudPainel Node.js Demo running on port \${port}\`);
  console.log(\`📍 Health check: http://localhost:\${port}/health\`);
  console.log(\`🌐 Demo page: http://localhost:\${port}\`);
});`,
          'README.md': `# Node.js Demo - CloudPainel\n\nAplicacao Node.js de demonstracao criada pelo CloudPainel.\n\n## Funcionalidades\n\n- Pagina de demonstracao com interface visual\n- Health check endpoint para monitoramento\n- API de status com informacoes do servico\n- Interface responsiva com design moderno\n\n## Endpoints\n\n- GET / - Pagina de demonstracao\n- GET /health - Health check (monitoramento)\n- GET /api/status - Status da API\n\n## Como usar\n\n1. Instale as dependencias:\nnpm install\n\n2. Execute em desenvolvimento:\nnpm run dev\n\n3. Execute em producao:\nnpm start\n\n4. Acesse no navegador:\n   - Demo: http://localhost:3000\n   - Health: http://localhost:3000/health\n\n## Personalizacao\n\n- Edite index.js para adicionar novas rotas\n- Modifique a pagina HTML no endpoint /\n- Adicione middlewares e funcionalidades\n- Configure variaveis de ambiente\n\n## Monitoramento\n\nO endpoint /health retorna informacoes de status do servico.\nUse este endpoint para verificacoes de saude do container.\n`
        }
      },
      'nginx-static': {
        files: {
          'index.html': `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Meu Site</title>
    <style>
        body { 
            font-family: Arial, sans-serif; 
            margin: 0; 
            padding: 40px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            min-height: 100vh;
        }
        .container { 
            max-width: 800px; 
            margin: 0 auto; 
            text-align: center;
        }
        h1 { font-size: 3em; margin-bottom: 20px; }
        p { font-size: 1.2em; line-height: 1.6; }
        .card { 
            background: rgba(255,255,255,0.1); 
            padding: 30px; 
            border-radius: 15px; 
            margin: 20px 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 Site criado com CloudPainel</h1>
        <div class="card">
            <p>Seu site estático está funcionando perfeitamente!</p>
            <p>Edite este arquivo HTML para personalizar seu conteúdo.</p>
        </div>
        <div class="card">
            <h2>Próximos passos:</h2>
            <p>• Adicione mais páginas HTML<br>
               • Inclua CSS e JavaScript<br>
               • Configure seu domínio</p>
        </div>
    </div>
</body>
</html>`,
          'style.css': `/* Adicione seus estilos personalizados aqui */
body {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
}

.custom-button {
    background: #4CAF50;
    color: white;
    padding: 12px 24px;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 16px;
}

.custom-button:hover {
    background: #45a049;
}`,
          'README.md': `# Site Estático

Site estático criado pelo CloudPainel.

## Estrutura

- \`index.html\` - Página principal
- \`style.css\` - Estilos personalizados

## Como personalizar

1. Edite o \`index.html\` para alterar o conteúdo
2. Modifique o \`style.css\` para personalizar o visual
3. Adicione mais arquivos HTML, CSS e JS conforme necessário

Seu site estará disponível em: http://localhost:PORTA
`
        }
      },
      'postgres-db': {
        files: {
          'init.sql': `-- Script de inicialização do banco
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS posts (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    content TEXT,
    user_id INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Dados de exemplo
INSERT INTO users (name, email) VALUES 
    ('João Silva', 'joao@exemplo.com'),
    ('Maria Santos', 'maria@exemplo.com')
ON CONFLICT (email) DO NOTHING;

INSERT INTO posts (title, content, user_id) VALUES 
    ('Primeiro Post', 'Conteúdo do primeiro post', 1),
    ('Segundo Post', 'Conteúdo do segundo post', 2)
ON CONFLICT DO NOTHING;`,
          'queries.sql': `-- Consultas úteis

-- Listar todos os usuários
SELECT * FROM users ORDER BY created_at DESC;

-- Listar posts com autores
SELECT p.title, p.content, u.name as author, p.created_at
FROM posts p
JOIN users u ON p.user_id = u.id
ORDER BY p.created_at DESC;

-- Contar posts por usuário
SELECT u.name, COUNT(p.id) as total_posts
FROM users u
LEFT JOIN posts p ON u.id = p.user_id
GROUP BY u.id, u.name;`,
          'README.md': `# PostgreSQL Database

Banco PostgreSQL criado pelo CloudPainel.

## Configuração

- **Usuário:** app
- **Senha:** change-me
- **Database:** appdb
- **Porta:** 5432

## Conexão

\`\`\`bash
psql -h localhost -p 5432 -U app -d appdb
\`\`\`

## Arquivos

- \`init.sql\` - Script de inicialização com tabelas e dados exemplo
- \`queries.sql\` - Consultas úteis para testar o banco

## Estrutura

- Tabela \`users\` - Usuários do sistema
- Tabela \`posts\` - Posts dos usuários
`
        }
      },
      'mysql-db': {
        files: {
          'init.sql': `-- Script de inicialização MySQL
CREATE DATABASE IF NOT EXISTS app;
USE app;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Dados de exemplo
INSERT IGNORE INTO users (name, email) VALUES 
    ('Admin User', 'admin@exemplo.com'),
    ('Test User', 'test@exemplo.com');

INSERT IGNORE INTO products (name, price, description) VALUES 
    ('Produto A', 29.99, 'Descrição do produto A'),
    ('Produto B', 49.99, 'Descrição do produto B');`,
          'README.md': `# MySQL Database

Banco MySQL criado pelo CloudPainel.

## Configuração

- **Usuário:** root
- **Senha:** root
- **Database:** app
- **Porta:** 3306

## Conexão

\`\`\`bash
mysql -h localhost -P 3306 -u root -p app
\`\`\`

## Estrutura

- Tabela \`users\` - Usuários
- Tabela \`products\` - Produtos
`
        }
      },
      'redis-cache': {
        files: {
          'redis-commands.txt': `# Comandos Redis úteis

# Definir uma chave
SET mykey "Hello World"

# Obter uma chave
GET mykey

# Definir com expiração (60 segundos)
SETEX session:user1 60 "user_data"

# Trabalhar com listas
LPUSH mylist "item1"
LPUSH mylist "item2"
LRANGE mylist 0 -1

# Trabalhar com hashes
HSET user:1 name "João"
HSET user:1 email "joao@exemplo.com"
HGETALL user:1

# Trabalhar com sets
SADD tags "redis" "cache" "database"
SMEMBERS tags

# Verificar todas as chaves
KEYS *

# Informações do servidor
INFO

# Limpar tudo (cuidado!)
FLUSHALL`,
          'README.md': `# Redis Cache

Cache Redis criado pelo CloudPainel.

## Configuração

- **Porta:** 6379
- **Sem senha** (configuração padrão)

## Conexão

\`\`\`bash
redis-cli -h localhost -p 6379
\`\`\`

## Uso

Redis é um banco de dados em memória, ideal para:

- Cache de aplicações
- Sessões de usuário
- Filas de mensagens
- Contadores em tempo real

Veja o arquivo \`redis-commands.txt\` para comandos úteis.
`
        }
      }
    };
  }

  async createProjectFiles(templateId, projectPath) {
    const template = this.templates[templateId];
    if (!template) {
      throw new Error(`Template ${templateId} não encontrado`);
    }

    // Criar diretório do projeto
    await fs.promises.mkdir(projectPath, { recursive: true });

    // Criar arquivos do template
    for (const [fileName, content] of Object.entries(template.files)) {
      const filePath = path.join(projectPath, fileName);
      await fs.promises.writeFile(filePath, content, 'utf8');
    }

    return Object.keys(template.files);
  }

  getAvailableTemplates() {
    return Object.keys(this.templates);
  }

  hasTemplate(templateId) {
    return templateId in this.templates;
  }
}

module.exports = ProjectTemplateManager;