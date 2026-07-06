const { Router } = require('express');
const { collectLocalContext, formatContextForPrompt, collectPanelsContext, formatPanelsContext } = require('../services/zeus-context');
const router = Router();

// Allow self-signed certs for server-to-server communication
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const ZEUS_GATEWAY_URL = process.env.ZEUS_GATEWAY_URL || 'http://localhost:3002';
const ZEUS_API_KEY = process.env.ZEUS_API_KEY || 'zeus_master_key_change_me';
const ZEUS_PANEL_ID = process.env.ZEUS_PANEL_ID || '';
const ZEUS_PANEL_ROLE = process.env.ZEUS_PANEL_ROLE || 'project';
const PANEL_NAME = process.env.ZEUS_PANEL_NAME || 'Local';

// Cache tokens for remote panels (avoid login on every request)
const tokenCache = new Map();

const getRemotePanelToken = async (panel) => {
  // Check cache (tokens valid for 30min)
  const cached = tokenCache.get(panel.id);
  if (cached && cached.expires > Date.now()) return cached.token;

  const credentials = panel.credentials;
  if (!credentials || !credentials.password) return null;

  try {
    const loginUrl = (panel.internalUrl || panel.url).replace(/\/$/, '');
    const loginRes = await fetch(`${loginUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Host': new URL(panel.url).hostname },
      body: JSON.stringify(credentials),
      signal: AbortSignal.timeout(8000)
    });
    if (!loginRes.ok) return null;
    const data = await loginRes.json();
    const token = data.token;
    if (token) {
      tokenCache.set(panel.id, { token, expires: Date.now() + 30 * 60 * 1000 });
    }
    return token;
  } catch {
    return null;
  }
};

const zeusRequest = async (path, body, method = 'POST') => {
  const res = await fetch(`${ZEUS_GATEWAY_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-api-key': ZEUS_API_KEY },
    body: method !== 'GET' ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const text = await res.text();
    let errorMsg;
    try { errorMsg = JSON.parse(text).error; } catch { errorMsg = text; }
    const err = new Error(errorMsg || `Zeus Gateway error (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
};

const zeusGet = async (path) => {
  const res = await fetch(`${ZEUS_GATEWAY_URL}${path}`, {
    headers: { 'x-api-key': ZEUS_API_KEY }
  });
  if (!res.ok) {
    const text = await res.text();
    let errorMsg;
    try { errorMsg = JSON.parse(text).error; } catch { errorMsg = text; }
    const err = new Error(errorMsg || `Zeus Gateway error (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
};

// POST /zeus/chat — RAG chat with local context
router.post('/chat', async (req, res, next) => {
  try {
    const { message, collection, history, options } = req.body;
    if (!message) return res.status(400).json({ error: 'message is required' });

    // Detect if the question is about infrastructure/panel
    const infraKeywords = /site|container|docker|nginx|servidor|servi[cç]o|painel|stack|deploy|ssl|https|banco|database|m[eé]trica|cpu|ram|disco|log|porta|dom[ií]nio|dns|status|rodando|ativo|offline|erro|problema|health|vers[aã]o|version|changelog|mudou|mudan[cç]a|atualiza[cç]ão|novo|nova/i;
    const isInfraQuestion = infraKeywords.test(message);

    let contextText = '';

    if (isInfraQuestion) {
      // Check if asking about a specific remote panel
      let panels = [];
      try {
        panels = await collectPanelsContext();
      } catch {}

      const mentionedPanel = panels.find(p =>
        message.toLowerCase().includes(p.name.toLowerCase()) ||
        (p.url && message.toLowerCase().includes(new URL(p.url).hostname.split('.')[0]))
      );

      if (mentionedPanel && mentionedPanel.url) {
        // Use cached context from heartbeat (push model)
        try {
          const ctxRes = await fetch(`${ZEUS_GATEWAY_URL}/api/panels/${mentionedPanel.id}/context`, {
            headers: { 'x-api-key': ZEUS_API_KEY },
            signal: AbortSignal.timeout(5000)
          });
          if (ctxRes.ok) {
            const cached = await ctxRes.json();
            if (cached.context && Object.keys(cached.context).length) {
              contextText = formatContextForPrompt(cached.context, mentionedPanel.name);
              contextText += `\n\n_Dados atualizados em: ${cached.receivedAt}_`;
            }
          }
        } catch (err) {
          console.error('[Zeus Cached Context] Failed:', err.message);
        }

        // Also add panels list for reference
        if (panels.length) {
          contextText += '\n\n' + formatPanelsContext(panels);
        }
      } else {
        // Collect local context
        const token = req.headers.authorization?.replace('Bearer ', '');
        const baseUrl = `http://localhost:${process.env.PORT || 3000}`;

        try {
          const context = await collectLocalContext(baseUrl, token);
          if (context && Object.keys(context).length) {
            contextText = formatContextForPrompt(context, PANEL_NAME);
          }
        } catch (err) {
          console.error('[Zeus Context] Failed to collect:', err.message);
        }

        // Add panels info
        if (panels.length) {
          contextText += '\n\n' + formatPanelsContext(panels);
        }
      }
    }

    // Enhance message with context only if relevant
    const enhancedMessage = contextText
      ? `${message}\n\n---\n${contextText}`
      : message;

    if (req.body.stream) {
      // SSE streaming
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      res.write(`: ${' '.repeat(2048)}\n\n`);

      const streamRes = await fetch(`${ZEUS_GATEWAY_URL}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ZEUS_API_KEY },
        body: JSON.stringify({ message: enhancedMessage, collection, history, options })
      });
      if (!streamRes.ok) {
        const err = await streamRes.text();
        res.write(`data: ${JSON.stringify({ type: 'error', error: err })}\n\n`);
        return res.end();
      }
      const decoder = new TextDecoder();
      let buf = '';
      for await (const chunk of streamRes.body) {
        buf += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            res.write(line + '\n\n');
          }
        }
      }
      if (buf.startsWith('data: ')) res.write(buf + '\n\n');
      res.write(`data: ${JSON.stringify({ type: 'end' })}\n\n`);
      return res.end();
    }

    const data = await zeusRequest('/api/chat', {
      message: enhancedMessage,
      collection,
      history,
      options
    });

    res.json(data);
  } catch (err) {
    if (!res.headersSent) return next(err);
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
    res.end();
  }
});

// POST /zeus/chat/direct — direct LLM without RAG
router.post('/chat/direct', async (req, res, next) => {
  try {
    const { messages, options } = req.body;
    const data = await zeusRequest('/api/chat/direct', { messages, options });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// POST /zeus/index — index document
router.post('/index', async (req, res, next) => {
  try {
    const data = await zeusRequest('/api/index', req.body);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// POST /zeus/index/site — index site data
router.post('/index/site', async (req, res, next) => {
  try {
    const data = await zeusRequest('/api/index/site', req.body);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /zeus/collections
router.get('/collections', async (_req, res, next) => {
  try {
    const data = await zeusGet('/api/collections');
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /zeus/health
router.get('/health', async (_req, res, next) => {
  try {
    const data = await zeusGet('/api/health');
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// --- Multi-Panel Management ---

router.get('/panels', async (_req, res, next) => {
  try {
    const scopeParam = ZEUS_PANEL_ROLE !== 'central' && ZEUS_PANEL_ID ? `?panelId=${ZEUS_PANEL_ID}` : '';
    const data = await zeusGet(`/api/panels${scopeParam}`);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.get('/panel-info', async (_req, res) => {
  let scopeName = null;
  try {
    if (ZEUS_PANEL_ID) {
      const scope = await zeusGet(`/api/hierarchy/scope/${ZEUS_PANEL_ID}`);
      if (scope.workspace) scopeName = scope.workspace.name;
      if (scope.project) scopeName = scope.project.name;
    }
  } catch {}
  res.json({
    panelId: ZEUS_PANEL_ID || null,
    panelName: PANEL_NAME,
    role: ZEUS_PANEL_ROLE,
    scopeName
  });
});

router.post('/panels/register', async (req, res, next) => {
  try {
    const data = await zeusRequest('/api/panels/register', req.body);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.get('/panels/:id', async (req, res, next) => {
  try {
    const data = await zeusGet(`/api/panels/${req.params.id}`);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.put('/panels/:id', async (req, res, next) => {
  try {
    const response = await fetch(`${ZEUS_GATEWAY_URL}/api/panels/${req.params.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ZEUS_API_KEY },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.delete('/panels/:id', async (req, res, next) => {
  try {
    const response = await fetch(`${ZEUS_GATEWAY_URL}/api/panels/${req.params.id}`, {
      method: 'DELETE',
      headers: { 'x-api-key': ZEUS_API_KEY }
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.post('/panels/:id/sync', async (req, res, next) => {
  try {
    const data = await zeusRequest(`/api/panels/${req.params.id}/sync`, {});
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.post('/panels/:id/index', async (req, res, next) => {
  try {
    const data = await zeusRequest(`/api/panels/${req.params.id}/index`, {});
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// POST /zeus/index-git — index a GitHub repository into Qdrant
router.post('/index-git', async (req, res, next) => {
  try {
    const { org, repo, branch, collection, metadata } = req.body;
    if (!org || !repo) return res.status(400).json({ error: 'org and repo are required' });
    const data = await zeusRequest('/api/index/git', {
      org,
      repo,
      branch: branch || 'main',
      collection: collection || `project_${repo.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`,
      category: 'dev',
      metadata: metadata || {}
    });
    res.status(202).json(data);
  } catch (err) {
    next(err);
  }
});

// GET /zeus/index-git/repos — list repos from a GitHub org
router.get('/index-git/repos', async (req, res, next) => {
  try {
    const org = req.query.org;
    if (!org) return res.status(400).json({ error: 'org query param is required' });
    const data = await zeusGet(`/api/index/git/repos?org=${encodeURIComponent(org)}`);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// --- Hierarchy Management (proxy to Gateway) ---

router.get('/hierarchy/workspaces', async (_req, res, next) => {
  try { res.json(await zeusGet('/api/hierarchy/workspaces')); } catch (err) { next(err); }
});

router.post('/hierarchy/workspaces', async (req, res, next) => {
  try { res.json(await zeusRequest('/api/hierarchy/workspaces', req.body)); } catch (err) { next(err); }
});

router.put('/hierarchy/workspaces/:id', async (req, res, next) => {
  try {
    const r = await fetch(`${ZEUS_GATEWAY_URL}/api/hierarchy/workspaces/${req.params.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-api-key': ZEUS_API_KEY }, body: JSON.stringify(req.body)
    });
    res.json(await r.json());
  } catch (err) { next(err); }
});

router.delete('/hierarchy/workspaces/:id', async (req, res, next) => {
  try {
    const r = await fetch(`${ZEUS_GATEWAY_URL}/api/hierarchy/workspaces/${req.params.id}`, {
      method: 'DELETE', headers: { 'x-api-key': ZEUS_API_KEY }
    });
    res.json(await r.json());
  } catch (err) { next(err); }
});

router.get('/hierarchy/workspaces/:wsId/projects', async (req, res, next) => {
  try { res.json(await zeusGet(`/api/hierarchy/workspaces/${req.params.wsId}/projects`)); } catch (err) { next(err); }
});

router.post('/hierarchy/workspaces/:wsId/projects', async (req, res, next) => {
  try { res.json(await zeusRequest(`/api/hierarchy/workspaces/${req.params.wsId}/projects`, req.body)); } catch (err) { next(err); }
});

router.put('/hierarchy/workspaces/:wsId/projects/:projId', async (req, res, next) => {
  try {
    const r = await fetch(`${ZEUS_GATEWAY_URL}/api/hierarchy/workspaces/${req.params.wsId}/projects/${req.params.projId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-api-key': ZEUS_API_KEY }, body: JSON.stringify(req.body)
    });
    res.json(await r.json());
  } catch (err) { next(err); }
});

router.delete('/hierarchy/workspaces/:wsId/projects/:projId', async (req, res, next) => {
  try {
    const r = await fetch(`${ZEUS_GATEWAY_URL}/api/hierarchy/workspaces/${req.params.wsId}/projects/${req.params.projId}`, {
      method: 'DELETE', headers: { 'x-api-key': ZEUS_API_KEY }
    });
    res.json(await r.json());
  } catch (err) { next(err); }
});

router.get('/hierarchy/scope', async (_req, res, next) => {
  try {
    const panelId = ZEUS_PANEL_ID || 'central';
    res.json(await zeusGet(`/api/hierarchy/scope/${panelId}`));
  } catch (err) { next(err); }
});

router.get('/hierarchy/context', async (_req, res, next) => {
  try {
    const panelId = ZEUS_PANEL_ID || 'central';
    res.json(await zeusGet(`/api/hierarchy/context-for/${panelId}`));
  } catch (err) { next(err); }
});

// Join this panel to a workspace (plug & play)
router.post('/hierarchy/join', async (req, res, next) => {
  try {
    const { workspaceId, projectName } = req.body;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
    const data = await zeusRequest('/api/hierarchy/join', {
      panelId: ZEUS_PANEL_ID,
      workspaceId,
      projectName: projectName || process.env.ZEUS_PANEL_NAME || 'Unknown'
    });
    res.json(data);
  } catch (err) { next(err); }
});

module.exports = router;
