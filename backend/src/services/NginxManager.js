'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class NginxManager {
  constructor() {
    this.configPath = '/etc/nginx';
    this.sitesAvailable = path.join(this.configPath, 'sites-available');
    this.sitesEnabled = path.join(this.configPath, 'sites-enabled');
    this.sslPath = path.join(this.configPath, 'ssl');
    this.certbotPath = '/etc/letsencrypt';
  }

  // Detectar Nginx instalado
  isInstalled() {
    try {
      execSync('which nginx', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  // Status do Nginx
  getStatus() {
    try {
      const output = execSync('systemctl is-active nginx', { encoding: 'utf8' }).trim();
      return { running: output === 'active', status: output };
    } catch {
      return { running: false, status: 'inactive' };
    }
  }

  // Listar todos os hosts configurados
  listHosts() {
    const hosts = [];
    const files = fs.readdirSync(this.sitesAvailable);
    
    files.forEach(file => {
      if (file === 'default') return;
      
      const configPath = path.join(this.sitesAvailable, file);
      const config = fs.readFileSync(configPath, 'utf8');
      const enabled = fs.existsSync(path.join(this.sitesEnabled, file));
      
      const host = this.parseConfig(config, file);
      host.enabled = enabled;
      host.configFile = file;
      hosts.push(host);
    });
    
    return hosts;
  }

  // Parse de configuração Nginx
  parseConfig(config, filename) {
    const serverNameMatch = config.match(/server_name\s+([^;]+);/);
    const listenMatch = config.match(/listen\s+(\d+)/);
    const sslMatch = config.match(/ssl_certificate\s+([^;]+);/);
    const upstreamMatch = config.match(/proxy_pass\s+http:\/\/([^;\/]+)/);
    const rootMatch = config.match(/root\s+([^;]+);/);
    const locationsMatch = config.match(/location\s+([^\s{]+)/g);
    
    return {
      id: filename,
      serverName: serverNameMatch ? serverNameMatch[1].trim().split(/\s+/) : [],
      port: listenMatch ? parseInt(listenMatch[1]) : 80,
      ssl: !!sslMatch,
      sslCert: sslMatch ? sslMatch[1].trim() : null,
      upstream: upstreamMatch ? upstreamMatch[1].trim() : null,
      root: rootMatch ? rootMatch[1].trim() : null,
      locations: locationsMatch ? locationsMatch.map(l => l.replace('location ', '')) : [],
      type: this.detectType(config)
    };
  }

  detectType(config) {
    if (config.includes('proxy_pass')) return 'reverse-proxy';
    if (config.includes('upstream')) return 'load-balancer';
    if (config.includes('root')) return 'static';
    return 'custom';
  }

  // Criar novo host
  createHost(data) {
    const { serverName, port = 80, type, upstream, root, ssl = false, locations = [] } = data;
    const filename = serverName[0].replace(/[^a-z0-9.-]/gi, '_');
    const configPath = path.join(this.sitesAvailable, filename);
    
    let config = '';
    
    // Upstream para load balancer
    if (type === 'load-balancer' && upstream && upstream.length > 0) {
      config += `upstream ${filename}_backend {\n`;
      upstream.forEach(server => {
        config += `    server ${server.host}:${server.port} weight=${server.weight || 1};\n`;
      });
      config += `}\n\n`;
    }
    
    config += `server {\n`;
    config += `    listen ${port};\n`;
    config += `    server_name ${serverName.join(' ')};\n\n`;
    
    if (ssl) {
      config += `    listen 443 ssl;\n`;
      config += `    ssl_certificate ${this.sslPath}/${filename}.crt;\n`;
      config += `    ssl_certificate_key ${this.sslPath}/${filename}.key;\n\n`;
    }
    
    // Configurações por tipo
    if (type === 'reverse-proxy') {
      config += `    location / {\n`;
      config += `        proxy_pass http://${upstream};\n`;
      config += `        proxy_set_header Host $host;\n`;
      config += `        proxy_set_header X-Real-IP $remote_addr;\n`;
      config += `        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n`;
      config += `        proxy_set_header X-Forwarded-Proto $scheme;\n`;
      config += `    }\n`;
    } else if (type === 'load-balancer') {
      config += `    location / {\n`;
      config += `        proxy_pass http://${filename}_backend;\n`;
      config += `        proxy_set_header Host $host;\n`;
      config += `        proxy_set_header X-Real-IP $remote_addr;\n`;
      config += `    }\n`;
    } else if (type === 'static') {
      config += `    root ${root};\n`;
      config += `    index index.html index.htm;\n\n`;
      config += `    location / {\n`;
      config += `        try_files $uri $uri/ =404;\n`;
      config += `    }\n`;
    }
    
    // Locations customizadas
    locations.forEach(loc => {
      config += `\n    location ${loc.path} {\n`;
      if (loc.proxyPass) {
        config += `        proxy_pass ${loc.proxyPass};\n`;
      }
      if (loc.root) {
        config += `        root ${loc.root};\n`;
      }
      config += `    }\n`;
    });
    
    config += `}\n`;
    
    fs.writeFileSync(configPath, config);
    return { filename, config };
  }

  // Habilitar host
  enableHost(filename) {
    const source = path.join(this.sitesAvailable, filename);
    const target = path.join(this.sitesEnabled, filename);
    
    if (!fs.existsSync(target)) {
      fs.symlinkSync(source, target);
    }
    
    this.testConfig();
    this.reload();
  }

  // Desabilitar host
  disableHost(filename) {
    const target = path.join(this.sitesEnabled, filename);
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
    }
    this.reload();
  }

  // Deletar host
  deleteHost(filename) {
    this.disableHost(filename);
    const configPath = path.join(this.sitesAvailable, filename);
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
  }

  // Testar configuração
  testConfig() {
    try {
      execSync('nginx -t', { stdio: 'pipe' });
      return { valid: true };
    } catch (err) {
      return { valid: false, error: err.stderr.toString() };
    }
  }

  // Reload Nginx
  reload() {
    execSync('systemctl reload nginx');
  }

  // Restart Nginx
  restart() {
    execSync('systemctl restart nginx');
  }

  // Instalar SSL Let's Encrypt
  async installSSL(domain, email) {
    try {
      const cmd = `certbot certonly --nginx -d ${domain} --email ${email} --agree-tos --non-interactive`;
      execSync(cmd);
      
      return {
        success: true,
        certPath: `/etc/letsencrypt/live/${domain}/fullchain.pem`,
        keyPath: `/etc/letsencrypt/live/${domain}/privkey.pem`
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // Listar certificados SSL
  listSSLCerts() {
    const certs = [];
    try {
      const livePath = path.join(this.certbotPath, 'live');
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
            expiresAt: expiryMatch ? new Date(expiryMatch[1]) : null
          });
        }
      });
    } catch (err) {
      // Ignore errors
    }
    return certs;
  }

  // Renovar certificados
  renewSSL() {
    try {
      execSync('certbot renew --quiet');
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // Configurar auto-renovação (cron)
  setupAutoRenew() {
    const cronJob = '0 0 * * * certbot renew --quiet && systemctl reload nginx';
    try {
      execSync(`(crontab -l 2>/dev/null; echo "${cronJob}") | crontab -`);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // Estatísticas do Nginx
  getStats() {
    try {
      const status = execSync('curl -s http://localhost/nginx_status', { encoding: 'utf8' });
      return { status };
    } catch {
      return { status: 'Status endpoint not configured' };
    }
  }

  // Logs do Nginx
  getLogs(type = 'access', lines = 100) {
    const logPath = type === 'error' 
      ? '/var/log/nginx/error.log' 
      : '/var/log/nginx/access.log';
    
    try {
      const output = execSync(`tail -n ${lines} ${logPath}`, { encoding: 'utf8' });
      return output.split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }
}

module.exports = NginxManager;
