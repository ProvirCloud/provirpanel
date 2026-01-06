'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class ProxyManager {
  constructor(options = {}) {
    this.registryPath = options.registryPath || path.join(__dirname, '../../data/proxy-routes.json');
    this.baseUrl = options.baseUrl || process.env.PROXY_BASE_URL || 'portal.exbonus.com.br';
    this.nginxConfigPath = options.nginxConfigPath || '/etc/nginx/sites-available/provirpanel';
    
    fs.mkdirSync(path.dirname(this.registryPath), { recursive: true });
    if (!fs.existsSync(this.registryPath)) {
      fs.writeFileSync(this.registryPath, '[]');
    }
  }

  readRegistry() {
    try {
      const raw = fs.readFileSync(this.registryPath, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  writeRegistry(routes) {
    fs.writeFileSync(this.registryPath, JSON.stringify(routes, null, 2));
  }

  saveRoute(route) {
    const routes = this.readRegistry();
    const idx = routes.findIndex(r => r.id === route.id);
    if (idx >= 0) {
      routes[idx] = route;
    } else {
      routes.push(route);
    }
    this.writeRegistry(routes);
    this.generateNginxConfig();
    return route;
  }

  removeRoute(routeId) {
    const routes = this.readRegistry();
    const updated = routes.filter(r => r.id !== routeId);
    this.writeRegistry(updated);
    this.generateNginxConfig();
    return true;
  }

  listRoutes() {
    return this.readRegistry();
  }

  createServiceRoute(serviceId, serviceName, pathPrefix, targetIP, targetPort) {
    const crypto = require('crypto');
    const routeId = crypto.randomUUID();
    
    const route = {
      id: routeId,
      serviceId,
      serviceName,
      pathPrefix: pathPrefix.startsWith('/') ? pathPrefix : `/${pathPrefix}`,
      targetIP,
      targetPort,
      url: `https://${this.baseUrl}${pathPrefix.startsWith('/') ? pathPrefix : `/${pathPrefix}`}`,
      status: 'active',
      createdAt: new Date().toISOString()
    };
    
    return this.saveRoute(route);
  }

  generateNginxConfig() {
    const routes = this.readRegistry();
    
    let config = `server {
    listen 80;
    server_name ${this.baseUrl};
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${this.baseUrl};

    # SSL configuration (configure with your certificates)
    # ssl_certificate /path/to/cert.pem;
    # ssl_certificate_key /path/to/key.pem;

    # Default location for Provir Panel
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

`;

    routes.forEach(route => {
      config += `    # Route for ${route.serviceName}
    location ${route.pathPrefix} {
        proxy_pass http://${route.targetIP}:${route.targetPort};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Prefix ${route.pathPrefix};
    }

`;
    });

    config += `}
`;

    try {
      fs.writeFileSync(this.nginxConfigPath, config);
      // Reload nginx
      execSync('nginx -t && systemctl reload nginx', { stdio: 'ignore' });
    } catch (err) {
      console.warn('Failed to update nginx config:', err.message);
    }
  }
}

module.exports = ProxyManager;