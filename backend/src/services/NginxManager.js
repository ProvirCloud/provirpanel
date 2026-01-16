'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class NginxManager {
  constructor() {
    this.configPath = '/etc/nginx';
    this.sitesAvailable = path.join(this.configPath, 'sites-available');
    this.sitesEnabled = path.join(this.configPath, 'sites-enabled');
    this.confD = path.join(this.configPath, 'conf.d');
    this.mainConfig = path.join(this.configPath, 'nginx.conf');
  }

  getOsInfo() {
    let id = '';
    let like = '';
    try {
      if (fs.existsSync('/etc/os-release')) {
        const content = fs.readFileSync('/etc/os-release', 'utf8');
        const idMatch = content.match(/^ID=(.+)$/m);
        const likeMatch = content.match(/^ID_LIKE=(.+)$/m);
        id = idMatch ? idMatch[1].replace(/"/g, '') : '';
        like = likeMatch ? likeMatch[1].replace(/"/g, '') : '';
      }
    } catch (err) {
      // ignore
    }
    return { id, like, platform: process.platform };
  }

  runInstallStep(command, args = []) {
    try {
      const output = execSync([command, ...args].join(' '), { encoding: 'utf8', stdio: 'pipe' });
      return { ok: true, output };
    } catch (err) {
      return {
        ok: false,
        output: err.stdout ? err.stdout.toString() : '',
        error: err.stderr ? err.stderr.toString() : err.message
      };
    }
  }

  isValidFilename(filename) {
    return typeof filename === 'string' && /^[A-Za-z0-9._-]+$/.test(filename);
  }

  resolveConfigPath(filename) {
    if (!this.isValidFilename(filename)) {
      throw new Error('Nome de arquivo invalido');
    }
    const candidates = [
      path.join(this.sitesAvailable, filename),
      path.join(this.confD, filename),
      path.join(this.configPath, filename)
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return path.join(this.sitesAvailable, filename);
  }

  getTargetDirForNewConfig() {
    if (fs.existsSync(this.sitesAvailable)) return this.sitesAvailable;
    if (fs.existsSync(this.confD)) return this.confD;
    throw new Error('Diretorio de configuracao do Nginx nao encontrado');
  }

  safeReadFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return { content, readable: true, error: null };
    } catch (err) {
      return {
        content: '',
        readable: false,
        error: err && err.message ? err.message : 'Erro ao ler arquivo'
      };
    }
  }

  listConfigsInDir(dirPath, type, toggleable) {
    const configs = [];
    if (!fs.existsSync(dirPath)) return configs;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    entries.forEach((entry) => {
      if (!entry.isFile()) return;
      const file = entry.name;
      const fullPath = path.join(dirPath, file);
      const fileRead = this.safeReadFile(fullPath);
      const enabled = toggleable
        ? fs.existsSync(path.join(this.sitesEnabled, file))
        : true;
      configs.push({
        name: file,
        path: fullPath,
        content: fileRead.content,
        enabled,
        type,
        readable: fileRead.readable,
        error: fileRead.error,
        editable: true,
        toggleable,
        deletable: true
      });
    });
    return configs;
  }

  // Listar TODOS os arquivos de configuração com conteúdo RAW
  listAllConfigs() {
    const configs = [];
    
    // Sites available
    configs.push(...this.listConfigsInDir(this.sitesAvailable, 'site', true));

    // conf.d
    configs.push(...this.listConfigsInDir(this.confD, 'conf', false));

    // main nginx.conf
    if (fs.existsSync(this.mainConfig)) {
      const fileRead = this.safeReadFile(this.mainConfig);
      configs.push({
        name: path.basename(this.mainConfig),
        path: this.mainConfig,
        content: fileRead.content,
        enabled: true,
        type: 'main',
        readable: fileRead.readable,
        error: fileRead.error,
        editable: true,
        toggleable: false,
        deletable: false
      });
    }
    
    return configs;
  }

  // Salvar configuração editada
  saveConfig(filename, content) {
    const filePath = this.resolveConfigPath(filename);
    if (!fs.existsSync(filePath)) {
      throw new Error('Arquivo nao encontrado para edicao');
    }
    fs.writeFileSync(filePath, content);
    return this.testConfig();
  }

  // Criar novo arquivo
  createConfig(filename, content) {
    if (!this.isValidFilename(filename)) {
      throw new Error('Nome de arquivo invalido');
    }
    const targetDir = this.getTargetDirForNewConfig();
    const filePath = path.join(targetDir, filename);
    if (fs.existsSync(filePath)) {
      throw new Error('Arquivo já existe');
    }
    fs.writeFileSync(filePath, content);
    return { success: true };
  }

  // Deletar
  deleteConfig(filename) {
    const filePath = this.resolveConfigPath(filename);
    if (path.resolve(filePath) === path.resolve(this.mainConfig)) {
      throw new Error('Nao e permitido deletar nginx.conf');
    }
    const sitePath = path.join(this.sitesAvailable, filename);
    if (fs.existsSync(sitePath)) {
      this.disableConfig(filename);
    }
    fs.unlinkSync(filePath);
  }

  // Enable/Disable
  enableConfig(filename) {
    const source = path.join(this.sitesAvailable, filename);
    if (!fs.existsSync(source)) {
      throw new Error('Configuracao nao encontrada em sites-available');
    }
    const target = path.join(this.sitesEnabled, filename);
    if (!fs.existsSync(target)) {
      fs.symlinkSync(source, target);
    }
    this.reload();
  }

  disableConfig(filename) {
    const source = path.join(this.sitesAvailable, filename);
    if (!fs.existsSync(source)) {
      throw new Error('Configuracao nao encontrada em sites-available');
    }
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
      
      const formatted = containers
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
      return { containers: formatted, error: null };
    } catch (err) {
      return {
        containers: [],
        error: err && err.message ? err.message : 'Erro ao acessar Docker'
      };
    }
  }

  // Instalar SSL Let's Encrypt
  installSSL(domain, email) {
    try {
      if (!domain || !email) {
        return { success: false, error: 'Dominio e email sao obrigatorios' };
      }
      try {
        execSync('command -v certbot', { stdio: 'pipe' });
      } catch (err) {
        return { success: false, error: 'Certbot nao instalado na maquina' };
      }
      execSync(`certbot certonly --nginx -d ${domain} --email ${email} --agree-tos --non-interactive`, { stdio: 'inherit' });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  getCertbotStatus() {
    try {
      const pathOutput = execSync('command -v certbot', { encoding: 'utf8' }).trim();
      const versionOutput = execSync('certbot --version', { encoding: 'utf8' }).trim();
      return { installed: true, path: pathOutput, version: versionOutput };
    } catch (err) {
      return {
        installed: false,
        error: err && err.message ? err.message : 'Certbot nao encontrado'
      };
    }
  }

  installCertbot() {
    try {
      const status = this.getCertbotStatus();
      if (status.installed) {
        return { success: true, message: 'Certbot ja instalado', ...status };
      }
      const osInfo = this.getOsInfo();
      const logs = [];
      const steps = [];

      const tryStep = (label, command, args) => {
        steps.push({ label, command, args });
        const result = this.runInstallStep(command, args);
        logs.push({
          label,
          command: [command, ...(args || [])].join(' '),
          ok: result.ok,
          output: result.output || '',
          error: result.error || ''
        });
        return result.ok;
      };

      const platform = osInfo.platform;
      const osId = `${osInfo.id} ${osInfo.like}`.toLowerCase();

      if (platform === 'darwin') {
        const brewOk = tryStep('brew update', 'brew', ['update']);
        if (brewOk) {
          tryStep('brew install certbot', 'brew', ['install', 'certbot']);
          tryStep('brew install certbot nginx', 'brew', ['install', 'certbot-nginx']);
        }
      } else if (osId.includes('debian') || osId.includes('ubuntu')) {
        tryStep('apt-get update', 'apt-get', ['update']);
        tryStep('apt-get install certbot', 'apt-get', ['install', '-y', 'certbot', 'python3-certbot-nginx']);
      } else if (osId.includes('fedora') || osId.includes('rhel') || osId.includes('centos')) {
        const dnfOk = tryStep('dnf install certbot', 'dnf', ['install', '-y', 'certbot', 'python3-certbot-nginx']);
        if (!dnfOk) {
          tryStep('yum install certbot', 'yum', ['install', '-y', 'certbot', 'python3-certbot-nginx']);
        }
      } else if (osId.includes('alpine')) {
        tryStep('apk add certbot', 'apk', ['add', 'certbot', 'certbot-nginx']);
      } else if (osId.includes('arch')) {
        tryStep('pacman install certbot', 'pacman', ['-S', '--noconfirm', 'certbot', 'certbot-nginx']);
      }

      // fallback to snap if still not installed
      const after = this.getCertbotStatus();
      if (!after.installed) {
        tryStep('snap install certbot', 'snap', ['install', '--classic', 'certbot']);
        tryStep('snap link certbot', 'ln', ['-s', '/snap/bin/certbot', '/usr/bin/certbot']);
      }

      const updated = this.getCertbotStatus();
      return { success: updated.installed, ...updated, osInfo, steps, logs };
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
