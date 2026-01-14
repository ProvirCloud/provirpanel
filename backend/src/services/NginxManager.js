'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class NginxManager {
  constructor() {
    this.configPath = '/etc/nginx';
    this.sitesAvailable = path.join(this.configPath, 'sites-available');
    this.sitesEnabled = path.join(this.configPath, 'sites-enabled');
  }

  // Listar TODOS os arquivos de configuração com conteúdo RAW
  listAllConfigs() {
    const configs = [];
    
    // Sites available
    if (fs.existsSync(this.sitesAvailable)) {
      const files = fs.readdirSync(this.sitesAvailable);
      files.forEach(file => {
        const fullPath = path.join(this.sitesAvailable, file);
        const content = fs.readFileSync(fullPath, 'utf8');
        const enabled = fs.existsSync(path.join(this.sitesEnabled, file));
        
        configs.push({
          name: file,
          path: fullPath,
          content,
          enabled,
          type: 'site'
        });
      });
    }
    
    return configs;
  }

  // Salvar configuração editada
  saveConfig(filename, content) {
    const filePath = path.join(this.sitesAvailable, filename);
    fs.writeFileSync(filePath, content);
    return this.testConfig();
  }

  // Criar novo arquivo
  createConfig(filename, content) {
    const filePath = path.join(this.sitesAvailable, filename);
    if (fs.existsSync(filePath)) {
      throw new Error('Arquivo já existe');
    }
    fs.writeFileSync(filePath, content);
    return { success: true };
  }

  // Deletar
  deleteConfig(filename) {
    this.disableConfig(filename);
    const filePath = path.join(this.sitesAvailable, filename);
    fs.unlinkSync(filePath);
  }

  // Enable/Disable
  enableConfig(filename) {
    const source = path.join(this.sitesAvailable, filename);
    const target = path.join(this.sitesEnabled, filename);
    if (!fs.existsSync(target)) {
      fs.symlinkSync(source, target);
    }
    this.reload();
  }

  disableConfig(filename) {
    const target = path.join(this.sitesEnabled, filename);
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
    }
    this.reload();
  }

  // Templates prontos
  getTemplates() {
    return {
      'reverse-proxy': `server {
    listen 80;
    server_name example.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}`,
      'static-site': `server {
    listen 80;
    server_name example.com;
    root /var/www/html;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
}`,
      'load-balancer': `upstream backend {
    server 192.168.1.10:3000 weight=3;
    server 192.168.1.11:3000 weight=2;
    server 192.168.1.12:3000 backup;
}

server {
    listen 80;
    server_name example.com;

    location / {
        proxy_pass http://backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}`,
      'ssl-site': `server {
    listen 80;
    server_name example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name example.com;

    ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}`
    };
  }

  // Integração com Docker - listar containers rodando
  async getDockerContainers() {
    try {
      const DockerManager = require('./DockerManager');
      const docker = new DockerManager();
      const containers = await docker.listContainers();
      
      return containers
        .filter(c => c.State === 'running')
        .map(c => {
          const ports = c.Ports || [];
          const mainPort = ports.find(p => p.PublicPort);
          
          return {
            id: c.Id,
            name: c.Names?.[0]?.replace('/', '') || c.Id.slice(0, 12),
            port: mainPort?.PublicPort || null,
            ip: mainPort?.IP || 'localhost',
            image: c.Image
          };
        });
    } catch {
      return [];
    }
  }

  // Instalar SSL Let's Encrypt
  installSSL(domain, email) {
    try {
      execSync(`certbot certonly --nginx -d ${domain} --email ${email} --agree-tos --non-interactive`, { stdio: 'inherit' });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // Listar certificados
  listCerts() {
    const certs = [];
    try {
      const livePath = '/etc/letsencrypt/live';
      if (!fs.existsSync(livePath)) return certs;
      
      const domains = fs.readdirSync(livePath);
      domains.forEach(domain => {
        const certPath = path.join(livePath, domain, 'fullchain.pem');
        if (fs.existsSync(certPath)) {
          const stats = fs.statSync(certPath);
          const output = execSync(`openssl x509 -in ${certPath} -noout -enddate`, { encoding: 'utf8' });
          const expiryMatch = output.match(/notAfter=(.+)/);
          
          certs.push({
            domain,
            certPath,
            keyPath: path.join(livePath, domain, 'privkey.pem'),
            createdAt: stats.mtime,
            expiresAt: expiryMatch ? new Date(expiryMatch[1]) : null,
            daysLeft: expiryMatch ? Math.floor((new Date(expiryMatch[1]) - new Date()) / (1000 * 60 * 60 * 24)) : null
          });
        }
      });
    } catch {}
    return certs;
  }

  testConfig() {
    try {
      execSync('nginx -t', { stdio: 'pipe' });
      return { valid: true };
    } catch (err) {
      return { valid: false, error: err.stderr?.toString() || err.message };
    }
  }

  reload() {
    execSync('systemctl reload nginx');
  }

  getStatus() {
    try {
      const output = execSync('systemctl is-active nginx', { encoding: 'utf8' }).trim();
      return { running: output === 'active' };
    } catch {
      return { running: false };
    }
  }
}

module.exports = NginxManager;
