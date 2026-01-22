const express = require('express');
const axios = require('axios');
const tls = require('tls');
const fs = require('fs');
const path = require('path');
const NginxManager = require('../services/NginxManager');
const reputationUrl = process.env.REPUTATION_CHECK_URL || '';
const reputationToken = process.env.REPUTATION_CHECK_TOKEN || '';
const reputationProvider = process.env.REPUTATION_PROVIDER || '';
const googleSafeBrowsingKey = process.env.GOOGLE_SAFE_BROWSING_API_KEY || '';

const router = express.Router();

const parseCookies = (setCookie) => {
  if (!setCookie || setCookie.length === 0) {
    return [];
  }
  return setCookie.map((entry) =>
    entry
      .split(';')
      .map((part) => part.trim().toLowerCase())
  );
};

const checkTlsNegotiation = (hostname, port) =>
  new Promise((resolve) => {
    const socket = tls.connect(
      {
        host: hostname,
        port,
        servername: hostname,
        timeout: 5000
      },
      () => {
        resolve(socket.getProtocol());
        socket.end();
      }
    );
    socket.on('error', () => resolve(null));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(null);
    });
  });

const buildCheck = (id, title, status, recommendation, detail, weight) => ({
  id,
  title,
  status,
  recommendation,
  detail,
  weight
});

const buildSecuritySnippet = ({ includeHsts, includeCsp, includeTlsMin }) => {
  const lines = [
    '# ProvirPanel Security Headers',
    'add_header X-Frame-Options "SAMEORIGIN" always;',
    'add_header X-Content-Type-Options "nosniff" always;',
    'add_header Referrer-Policy "strict-origin-when-cross-origin" always;',
    'add_header X-XSS-Protection "1; mode=block" always;'
  ];
  if (includeTlsMin) {
    lines.push('# TLS Min Version');
    lines.push('ssl_protocols TLSv1.2 TLSv1.3;');
  }
  if (includeHsts) {
    lines.push('add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;');
  }
  if (includeCsp) {
    lines.push(
      'add_header Content-Security-Policy "default-src \'self\' https: data:; img-src \'self\' https: data:; style-src \'self\' \'unsafe-inline\' https:; script-src \'self\' \'unsafe-inline\' https:; connect-src \'self\' https: wss:; frame-ancestors \'self\';" always;'
    );
  }
  return `${lines.join('\n')}\n`;
};

router.post('/audit', async (req, res) => {
  const { url, auth } = req.body || {};
  if (!url) {
    return res.status(400).json({ message: 'URL obrigatoria.' });
  }

  let target;
  try {
    target = new URL(url);
  } catch (err) {
    return res.status(400).json({ message: 'URL invalida.' });
  }

  if (!['http:', 'https:'].includes(target.protocol)) {
    return res.status(400).json({ message: 'Somente http/https sao suportados.' });
  }

  try {
    const response = await axios.get(target.toString(), {
      maxRedirects: 5,
      timeout: 8000,
      validateStatus: () => true
    });

    const headers = Object.fromEntries(
      Object.entries(response.headers || {}).map(([key, value]) => [key.toLowerCase(), value])
    );
    let cookieSource = 'response';
    let cookieError = null;
    let cookieEntries = headers['set-cookie'];
    if (auth?.username && auth?.password) {
      try {
        const loginPath = auth?.path || '/api/auth/login';
        const loginUrl = new URL(loginPath, target.origin).toString();
        const loginResponse = await axios.post(
          loginUrl,
          { username: auth.username, password: auth.password },
          { timeout: 8000, validateStatus: () => true }
        );
        if (loginResponse.headers?.['set-cookie']) {
          cookieEntries = loginResponse.headers['set-cookie'];
          cookieSource = 'login';
        } else if (loginResponse.data?.mfaRequired && auth?.mfaCode) {
          const mfaUrl = new URL('/api/auth/mfa/confirm', target.origin).toString();
          const mfaResponse = await axios.post(
            mfaUrl,
            { token: auth.mfaCode, mfaToken: loginResponse.data.mfaToken },
            { timeout: 8000, validateStatus: () => true }
          );
          if (mfaResponse.headers?.['set-cookie']) {
            cookieEntries = mfaResponse.headers['set-cookie'];
            cookieSource = 'mfa';
          }
        }
      } catch (err) {
        cookieSource = 'login';
        cookieError = err.message;
      }
    }
    const cookies = parseCookies(cookieEntries);
    const hasCookies = cookies.length > 0;

    const hsts = headers['strict-transport-security'];
    const xfo = headers['x-frame-options'];
    const xcto = headers['x-content-type-options'];
    const csp = headers['content-security-policy'];
    const referrer = headers['referrer-policy'];
    const xss = headers['x-xss-protection'];
    const cors = headers['access-control-allow-origin'];
    const serverHeader = headers['server'];
    const poweredBy = headers['x-powered-by'];

    const httpsEnabled = target.protocol === 'https:';
    const negotiatedProtocol = httpsEnabled
      ? await checkTlsNegotiation(target.hostname, Number(target.port || 443))
      : null;

    const cookieSecure = hasCookies
      ? cookies.every((attrs) => attrs.includes('secure'))
      : false;
    const cookieSameSite = hasCookies
      ? cookies.every((attrs) => attrs.some((attr) => attr.startsWith('samesite=')))
      : false;

    const checks = [
      buildCheck(
        'hsts',
        'HSTS (HTTP Strict Transport Security)',
        hsts ? 'PASS' : 'FAIL',
        'Configure: Strict-Transport-Security: max-age=31536000; includeSubDomains; preload',
        hsts || 'Header ausente',
        12
      ),
      buildCheck(
        'x-frame-options',
        'X-Frame-Options',
        xfo ? 'PASS' : 'FAIL',
        'Configure: X-Frame-Options: SAMEORIGIN',
        xfo || 'Header ausente',
        12
      ),
      buildCheck(
        'x-content-type-options',
        'X-Content-Type-Options',
        xcto && String(xcto).toLowerCase() === 'nosniff' ? 'PASS' : 'FAIL',
        'Configure: X-Content-Type-Options: nosniff',
        xcto || 'Header ausente',
        12
      ),
      buildCheck(
        'csp',
        'Content Security Policy (CSP)',
        csp ? 'PASS' : 'FAIL',
        'Implemente CSP robusta com script-src, style-src, img-src restritivos',
        csp || 'Header ausente',
        12
      ),
      buildCheck(
        'referrer-policy',
        'Referrer-Policy',
        referrer && String(referrer).toLowerCase().includes('strict-origin-when-cross-origin')
          ? 'PASS'
          : 'WARNING',
        'Configure: Referrer-Policy: strict-origin-when-cross-origin',
        referrer || 'Header ausente',
        5
      ),
      buildCheck(
        'x-xss-protection',
        'X-XSS-Protection',
        xss && String(xss).toLowerCase().includes('1')
          ? 'PASS'
          : 'WARNING',
        'Configure: X-XSS-Protection: 1; mode=block',
        xss || 'Header ausente',
        5
      ),
      buildCheck(
        'cors',
        'CORS (Cross-Origin Resource Sharing)',
        cors && String(cors).trim() === '*'
          ? 'WARNING'
          : 'PASS',
        'Se usar CORS, especifique apenas origens confiaveis',
        cors || 'Nao configurado',
        5
      ),
      buildCheck(
        'https',
        'HTTPS/TLS',
        httpsEnabled ? 'PASS' : 'FAIL',
        'Habilite HTTPS no painel e nos servicos',
        httpsEnabled ? 'HTTPS ativo' : 'HTTP detectado',
        5
      ),
      buildCheck(
        'tls-min',
        'Versao TLS Minima',
        negotiatedProtocol && ['TLSv1.2', 'TLSv1.3'].includes(negotiatedProtocol)
          ? 'PASS'
          : 'WARNING',
        'Garanta TLS 1.2+ no servidor',
        negotiatedProtocol ? `Negociado: ${negotiatedProtocol}` : 'Nao detectado',
        5
      ),
      buildCheck(
        'cookies-secure',
        'Secure Flag em Cookies',
        hasCookies ? (cookieSecure ? 'PASS' : 'WARNING') : 'INFO',
        'Adicione Secure em cookies HTTPS',
        hasCookies
          ? (cookieSecure ? 'OK' : 'Alguns cookies sem Secure')
          : (cookieError ? `Falha ao validar cookies: ${cookieError}` : 'Nenhum cookie emitido'),
        5
      ),
      buildCheck(
        'cookies-samesite',
        'SameSite Flag em Cookies',
        hasCookies ? (cookieSameSite ? 'PASS' : 'FAIL') : 'INFO',
        'Use SameSite=Lax ou SameSite=Strict',
        hasCookies
          ? (cookieSameSite ? 'OK' : 'Alguns cookies sem SameSite')
          : (cookieError ? `Falha ao validar cookies: ${cookieError}` : 'Nenhum cookie emitido'),
        12
      ),
      buildCheck(
        'server-header',
        'Divulgacao de Servidor (Server Header)',
        serverHeader && String(serverHeader).includes('/')
          ? 'WARNING'
          : 'PASS',
        'Configure server_tokens off para ocultar a versao do Nginx',
        serverHeader || 'Header ausente',
        5
      ),
      buildCheck(
        'x-powered-by',
        'X-Powered-By Header',
        poweredBy ? 'WARNING' : 'PASS',
        'Remova o header X-Powered-By',
        poweredBy || 'Header ausente',
        5
      )
    ];

    const score = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          checks.reduce((total, check) => {
            if (check.status === 'PASS') return total + check.weight;
            if (check.status === 'WARNING') return total + Math.round(check.weight / 2);
            return total;
          }, 0)
        )
      )
    );

    const recommendations = checks
      .filter((check) => check.status !== 'PASS')
      .map((check) => ({
        id: check.id,
        title: check.title,
        status: check.status,
        recommendation: check.recommendation
      }));

    return res.json({
      generatedAt: new Date().toISOString(),
      url: target.toString(),
      score,
      checks,
      recommendations,
      cookieSource
    });
  } catch (err) {
    return res.status(500).json({
      message: 'Falha ao auditar URL.',
      detail: err.message
    });
  }
});

router.post('/plan', async (req, res) => {
  const { url } = req.body || {};
  if (!url) {
    return res.status(400).json({ message: 'URL obrigatoria.' });
  }

  let target;
  try {
    target = new URL(url);
  } catch (err) {
    return res.status(400).json({ message: 'URL invalida.' });
  }

  const httpsEnabled = target.protocol === 'https:';
  const nginxManager = new NginxManager();
  const confDir = nginxManager.confD;
  const filename = 'provirpanel-security.conf';
  const filePath = path.join(confDir, filename);
  const content = buildSecuritySnippet({ includeHsts: httpsEnabled, includeCsp: true, includeTlsMin: httpsEnabled });

  return res.json({
    filePath,
    content,
    notes: httpsEnabled
      ? 'HSTS habilitado por HTTPS.'
      : 'HSTS nao aplicado porque a URL esta em HTTP.',
    requiresReload: true
  });
});

router.post('/apply', async (req, res) => {
  const { url } = req.body || {};
  if (!url) {
    return res.status(400).json({ message: 'URL obrigatoria.' });
  }

  let target;
  try {
    target = new URL(url);
  } catch (err) {
    return res.status(400).json({ message: 'URL invalida.' });
  }

  const httpsEnabled = target.protocol === 'https:';
  const nginxManager = new NginxManager();
  const confDir = nginxManager.confD;
  const filename = 'provirpanel-security.conf';
  const filePath = path.join(confDir, filename);
  const content = buildSecuritySnippet({ includeHsts: httpsEnabled, includeCsp: true, includeTlsMin: httpsEnabled });

  let backupPath = null;
  try {
    fs.mkdirSync(confDir, { recursive: true });
    if (fs.existsSync(filePath)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      backupPath = `${filePath}.bak-${stamp}`;
      fs.copyFileSync(filePath, backupPath);
    }
    fs.writeFileSync(filePath, content, 'utf8');

    const test = nginxManager.testConfig();
    if (!test.valid) {
      if (backupPath) {
        fs.copyFileSync(backupPath, filePath);
      } else {
        fs.unlinkSync(filePath);
      }
      return res.status(400).json({ message: 'Nginx -t falhou', detail: test.error });
    }

    nginxManager.reload();
    return res.json({
      applied: true,
      filePath,
      backupPath
    });
  } catch (err) {
    return res.status(500).json({ message: 'Falha ao aplicar correcoes.', detail: err.message });
  }
});

router.post('/reputation', async (req, res) => {
  const { url, domain } = req.body || {};
  const target = url || (domain ? `https://${domain}` : '');
  if (!target) {
    return res.status(400).json({ message: 'URL obrigatoria.' });
  }

  if (!reputationUrl) {
    if (!reputationProvider || reputationProvider === 'generic') {
      return res.status(400).json({
        message: 'Reputation provider nao configurado.',
        detail: 'Defina REPUTATION_PROVIDER e/ou REPUTATION_CHECK_URL no backend/.env'
      });
    }
  }

  try {
    if (reputationProvider === 'google_safe_browsing' || reputationProvider === 'google') {
      if (!googleSafeBrowsingKey) {
        return res.status(400).json({
          message: 'Google Safe Browsing nao configurado.',
          detail: 'Defina GOOGLE_SAFE_BROWSING_API_KEY no backend/.env'
        });
      }
      const response = await axios.post(
        `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${googleSafeBrowsingKey}`,
        {
          client: { clientId: 'provirpanel', clientVersion: '1.0.0' },
          threatInfo: {
            threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
            platformTypes: ['ANY_PLATFORM'],
            threatEntryTypes: ['URL'],
            threatEntries: [{ url: target }]
          }
        },
        { timeout: 10000 }
      );
      const matches = response.data?.matches || [];
      return res.json({
        provider: 'google_safe_browsing',
        url: target,
        verdict: matches.length > 0 ? 'malicious' : 'clean',
        result: response.data
      });
    }

    const headers = reputationToken ? { Authorization: `Bearer ${reputationToken}` } : {};
    const response = await axios.post(reputationUrl, { url: target }, { headers, timeout: 10000 });
    return res.json({
      provider: reputationProvider || reputationUrl,
      url: target,
      result: response.data
    });
  } catch (err) {
    return res.status(500).json({
      message: 'Falha ao consultar reputacao.',
      detail: err.response?.data || err.message
    });
  }
});

module.exports = router;
