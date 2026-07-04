const { Router } = require('express');
const { collectLocalContext, formatContextForPrompt, collectPanelsContext, formatPanelsContext } = require('../services/zeus-context');
const router = Router();

// Allow self-signed certs for server-to-server communication
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const ZEUS_GATEWAY_URL = process.env.ZEUS_GATEWAY_URL || 'http://localhost:3002';
const ZEUS_API_KEY = process.env.ZEUS_API_KEY || 'zeus_master_key_change_me';
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

    const data = await zeusRequest('/api/chat', {
      message: enhancedMessage,
      collection,
      history,
      options
    });

    res.json(data);
  } catch (err) {
    next(err);
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
    const data = await zeusGet('/api/panels');
    res.json(data);
  } catch (err) {
    next(err);
  }
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

module.exports = router;
