const { Router } = require('express');
const { collectLocalContext, formatContextForPrompt, collectPanelsContext, formatPanelsContext } = require('../services/zeus-context');
const { TOOL_DEFS, runTool, WRITE_TOOL_DEFS, WRITE_TOOL_META, WRITE_TOOL_NAMES, canRoleUseWriteTool, runWriteTool } = require('../services/zeus-agent-tools');
const { routeProvider } = require('../services/zeus-router');
const aiTurn = require('../services/ai-turn');
const aiAgents = require('../services/ai-agents');
const aiBlocksMapper = require('../services/ai-blocks-mapper');
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

// POST /zeus/chat/smart — intelligent routing (Bedrock + Ollama)
router.post('/chat/smart', async (req, res, next) => {
  try {
    const { message, clienteId, confirmedPlan, sessionId } = req.body;

    // If not streaming or confirming plan, do simple JSON request
    if (confirmedPlan || !req.body.stream) {
      const data = await zeusRequest('/api/chat/smart', { message, clienteId, confirmedPlan, sessionId });
      return res.json(data);
    }

    // SSE streaming mode
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(`: ${' '.repeat(2048)}\n\n`);

    const streamRes = await fetch(`${ZEUS_GATEWAY_URL}/api/chat/smart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ZEUS_API_KEY },
      body: JSON.stringify({ message, clienteId, sessionId, stream: true })
    });

    if (!streamRes.ok) {
      const err = await streamRes.text();
      res.write(`data: ${JSON.stringify({ type: 'error', error: err })}\n\n`);
      return res.end();
    }

    // Check if response is SSE (streaming) or JSON (plan/resposta)
    const contentType = streamRes.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream')) {
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
    } else {
      // JSON response (plan or resposta) — convert to SSE event
      const data = await streamRes.json();
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ type: 'end' })}\n\n`);
    return res.end();
  } catch (err) {
    if (!res.headersSent) return next(err);
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
    res.end();
  }
});

// POST /zeus/chat/smart/confirm — confirm and execute plan
router.post('/chat/smart/confirm', async (req, res, next) => {
  try {
    const { plan, sessionId } = req.body;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(`: ${' '.repeat(2048)}\n\n`);

    const streamRes = await fetch(`${ZEUS_GATEWAY_URL}/api/chat/smart/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ZEUS_API_KEY },
      body: JSON.stringify({ plan, sessionId })
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
  } catch (err) {
    if (!res.headersSent) return next(err);
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
    res.end();
  }
});

// POST /zeus/agent — agente read-only com tool-use (Bedrock Converse)
// Loop: modelo → toolUse → executa tool localmente (JWT do user) → toolResult → repete.
// Streama eventos SSE: tool_call, tool_result, token (resposta final), end, error.
const AGENT_SYSTEM_PROMPT = `Você é o Zeus, assistente de infraestrutura do Provir Cloud Panel.
Você tem ferramentas de LEITURA (list_services, get_service_metrics, list_docker_containers, list_databases, list_sites, get_server_metrics, list_nginx) e ferramentas de AÇÃO (restart_service, start_service, stop_service, update_service, create_service, delete_service).

Regras de LEITURA:
- Para consultar estado de máquina, serviços, containers, bancos, sites ou métricas, USE as ferramentas de leitura em vez de inventar dados.

Regras de AÇÃO (importante):
- Ações NÃO são executadas por você diretamente. Ao chamar uma ferramenta de ação, o sistema apenas PREPARA uma proposta que o usuário precisa CONFIRMAR manualmente.
- Antes de propor uma ação sobre um serviço, resolva o serviceId real (use list_services se necessário) para garantir o alvo correto.
- delete_service NUNCA remove nada: serve só para explicar o impacto e verificar bloqueios/dependências.
- Se faltar informação essencial para create_service ou update_service, PERGUNTE ao usuário em vez de assumir valores.
- Permissões: usuários 'viewer' só podem reiniciar (restart_service) e consultar; demais ações são exclusivas de 'admin'. Se o usuário não tiver permissão, explique isso.
- IMPORTANTE: você só dispõe das ferramentas que lhe foram fornecidas neste turno. Se o usuário pedir uma ação para a qual você NÃO tem a ferramenta correspondente disponível, isso significa que ele não tem permissão — NÃO finja propor a ação nem escreva "proposta de ação"; apenas explique, de forma clara, que a ação requer perfil admin e que o perfil atual não pode executá-la.

Responda em português, objetivo, usando markdown quando ajudar.`;

// Adaptação de tom por nível de conhecimento (inferido silenciosamente; nunca
// exposto ao usuário). Injetado no system prompt do turno.
const SKILL_GUIDANCE = {
  iniciante: 'O usuário é iniciante. Use linguagem simples, evite jargão, explique termos técnicos com analogias e dê exemplos práticos passo a passo. Não presuma conhecimento prévio.',
  intermediario: 'O usuário tem conhecimento intermediário. Seja claro e direto, pode usar termos técnicos comuns, mas explique conceitos mais avançados quando surgirem.',
  avancado: 'O usuário é avançado. Seja técnico, direto e conciso. Pode usar terminologia especializada sem explicar o básico. Foque em precisão e eficiência.',
  auto: '',
};

router.post('/agent', async (req, res, next) => {
  const MAX_ITERATIONS = 6;
  const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const { message, history, conversationId, agent } = req.body;
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'token ausente' });

    // ── Persistência (Fase 1.6): grava a msg do usuário, atualiza perfil e
    // devolve o nível de conhecimento efetivo (para adaptar o tom — Fase 4).
    // Best-effort: se conversationId for inválido/ausente, apenas não persiste.
    const turn = await aiTurn.beginTurn({ conversationId, user: req.user, message: message.trim() });
    const skillLevel = turn.skillLevel || 'auto';
    const persistEnabled = turn.ok;

    // Agente efetivo (Fase 2.1): a conversa persistida tem precedência sobre o
    // body; cai para 'auto' se inválido/ausente.
    const effectiveAgent = turn.conversation?.agent || agent || 'auto';

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(`: ${' '.repeat(2048)}\n\n`);

    // Monta histórico no formato Converse (só texto).
    // Se a conversa é persistida, usa o histórico do banco (summary + msgs
    // recentes já com orçamento de tokens); senão, usa o `history` do cliente.
    const messages = [];
    let summaryText = '';
    if (persistEnabled) {
      const built = await aiTurn.buildConverseHistory({ conversationId, user: req.user });
      summaryText = built.summaryText || '';
      // O histórico persistido já inclui a mensagem do usuário recém-gravada;
      // removemos a última se for a própria mensagem atual (evita duplicar).
      const hist = built.messages;
      if (hist.length && hist[hist.length - 1].role === 'user') hist.pop();
      messages.push(...hist);
    } else if (Array.isArray(history)) {
      for (const h of history.slice(-8)) {
        if (!h || !h.role || !h.content) continue;
        const role = h.role === 'assistant' ? 'assistant' : 'user';
        messages.push({ role, content: [{ text: String(h.content) }] });
      }
    }
    messages.push({ role: 'user', content: [{ text: `[contexto: seu perfil de usuário é "${req.user?.role || 'viewer'}"]\n\n${message.trim()}` }] });

    // System prompt do turno: base + persona do agente (Fase 2.1) + adaptação ao
    // nível (Fase 4) + resumo do histórico antigo (quando a conversa é longa).
    const persona = aiAgents.getPersona(effectiveAgent);
    const skillGuidance = SKILL_GUIDANCE[skillLevel] || '';
    const systemForTurn = [
      AGENT_SYSTEM_PROMPT,
      persona ? `\n\n[Persona do agente selecionado] ${persona}` : '',
      skillGuidance ? `\n\n[Adaptação de tom] ${skillGuidance}` : '',
      summaryText ? `\n\n[Resumo da conversa até aqui]\n${summaryText}` : '',
    ].join('');

    // ── Roteamento híbrido: mensagens triviais/conversacionais vão para o LLM
    // local (Ollama, grátis). Consultas/ações e qualquer dúvida vão para o
    // Bedrock (tool-use). Conservador: só desvia o que é claramente trivial.
    const provider = routeProvider(message, history);
    if (provider === 'ollama') {
      sendEvent({ type: 'provider', provider: 'ollama' });
      try {
        const streamRes = await fetch(`${ZEUS_GATEWAY_URL}/api/chat/direct/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': ZEUS_API_KEY },
          body: JSON.stringify({
            messages: [
              { role: 'system', content: `Você é o Zeus, assistente de infraestrutura do Provir Cloud Panel. Responda em português brasileiro, de forma breve e cordial. Nunca diga que é outro modelo (como Qwen ou Alibaba); você é o Zeus AI da Provir Cloud. Para conversas triviais, seja simpático e, quando fizer sentido, lembre que pode consultar serviços, containers, bancos, métricas e sites do painel.${aiAgents.getPersona(effectiveAgent) ? `\n\n[Persona] ${aiAgents.getPersona(effectiveAgent)}` : ''}` },
              { role: 'user', content: message.trim() },
            ],
            options: { large: false },
          }),
        });
        if (!streamRes.ok) throw new Error(`Ollama direct falhou (${streamRes.status})`);
        // Repassa os eventos SSE do gateway (type: token / done / end)
        const decoder = new TextDecoder();
        let buf = '';
        let ollamaText = '';
        for await (const chunk of streamRes.body) {
          buf += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              res.write(line + '\n\n');
              // Acumula o texto para persistir ao final (best-effort).
              try {
                const ev = JSON.parse(line.slice(6));
                if (ev && ev.type === 'token' && ev.content) ollamaText += ev.content;
              } catch { /* linha não-JSON */ }
            }
          }
        }
        if (buf.startsWith('data: ')) res.write(buf + '\n\n');
        if (persistEnabled) {
          await aiTurn.endTurn({ conversationId, user: req.user, content: ollamaText });
        }
        sendEvent({ type: 'end' });
        return res.end();
      } catch (err) {
        // Fallback conservador: se o Ollama falhar, cai no Bedrock.
        console.warn('[zeus/agent] Ollama trivial falhou, fallback Bedrock:', err.message);
        sendEvent({ type: 'provider', provider: 'bedrock', fallback: true });
      }
    } else {
      sendEvent({ type: 'provider', provider: 'bedrock' });
    }

    const role = req.user?.role || 'viewer';

    // Ferramentas expostas ao modelo: leitura sempre; escrita conforme role.
    // (viewer só enxerga restart entre as de escrita; admin vê todas.)
    const writeToolsForRole = WRITE_TOOL_DEFS.filter((t) => canRoleUseWriteTool(role, t.name));
    const toolsForModel = [...TOOL_DEFS, ...writeToolsForRole];

    let finalText = '';
    const turnBlocks = []; // blocos interativos acumulados a partir dos tool_result

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const result = await zeusRequest('/api/chat/converse', {
        messages,
        system: systemForTurn,
        tools: toolsForModel,
        maxTokens: 2048,
        temperature: 0.2,
      });

      // Reinsere a mensagem do assistant (com eventuais toolUse) no histórico
      if (result.assistantMessage) {
        messages.push(result.assistantMessage);
      }

      if (result.stopReason === 'tool_use' && Array.isArray(result.toolUses) && result.toolUses.length) {
        // Se QUALQUER tool pedida for de escrita, interceptamos: propomos a ação
        // (a primeira write tool encontrada) e encerramos o turno SEM executar.
        const writeUse = result.toolUses.find((tu) => WRITE_TOOL_NAMES.has(tu.name));
        if (writeUse) {
          const meta = WRITE_TOOL_META[writeUse.name] || {};
          const allowed = canRoleUseWriteTool(role, writeUse.name);

          if (!allowed) {
            const denyMsg = `🔒 A ação **${writeUse.name}** requer perfil **admin**. Seu perfil (**${role}**) pode consultar informações e reiniciar serviços. Peça a um administrador para executar esta ação.`;
            sendEvent({ type: 'token', content: denyMsg });
            if (persistEnabled) {
              await aiTurn.endTurn({ conversationId, user: req.user, content: denyMsg });
            }
            sendEvent({ type: 'end' });
            return res.end();
          }

          if (meta.executes === false) {
            // delete_service e afins: nunca executa — instrui o modelo a explicar.
            const explainMsg = {
              role: 'user',
              content: [{
                text: `A ação "${writeUse.name}" NÃO é executável pelo agente. Explique ao usuário o impacto de remover o serviço (id: ${writeUse.input?.serviceId || '?'}), verifique via list_services se ele existe e mencione que a remoção precisa ser feita manualmente pelo painel. NÃO proponha executar.`,
              }],
            };
            messages.push(explainMsg);
            continue;
          }

          // Proposta de ação — exige confirmação humana.
          const proposal = { tool: writeUse.name, input: writeUse.input || {} };
          const proposalMeta = { risk: meta.risk || 'medium', requiredRole: meta.requiredRole || 'admin', rollback: meta.rollback || null };
          sendEvent({ type: 'action_proposal', action: proposal, meta: proposalMeta });
          if (persistEnabled) {
            await aiTurn.endTurn({
              conversationId,
              user: req.user,
              content: `Ação proposta: \`${writeUse.name}\` (aguardando confirmação).`,
              blocks: [{ kind: 'action_proposal', action: proposal, meta: proposalMeta }],
            });
          }
          sendEvent({ type: 'end' });
          return res.end();
        }

        // Nenhuma write tool → executa as read tools normalmente
        const toolResultBlocks = [];
        for (const tu of result.toolUses) {
          sendEvent({ type: 'tool_call', name: tu.name, input: tu.input });
          let toolContent;
          let isError = false;
          try {
            const out = await runTool(tu.name, tu.input, token);
            toolContent = out;
          } catch (err) {
            isError = true;
            toolContent = { error: err.message };
          }
          sendEvent({ type: 'tool_result', name: tu.name, error: isError, result: toolContent });
          // Bloco interativo (generative UI) — tabela/métrica/erro conforme a tool.
          try {
            const block = isError
              ? aiBlocksMapper.errorBlock(tu.name, toolContent?.error)
              : aiBlocksMapper.toolResultToBlock(tu.name, toolContent);
            if (block) {
              turnBlocks.push(block);
              sendEvent({ type: 'block', block });
            }
          } catch { /* mapeamento best-effort */ }
          toolResultBlocks.push({
            toolResult: {
              toolUseId: tu.toolUseId,
              content: [{ json: toolContent }],
              ...(isError ? { status: 'error' } : {}),
            },
          });
        }
        messages.push({ role: 'user', content: toolResultBlocks });
        continue;
      }

      // stopReason end_turn (ou outro) → resposta final
      finalText = result.text || '';
      break;
    }

    if (!finalText) {
      finalText = 'Não consegui concluir a consulta (limite de iterações atingido ou resposta vazia).';
    }

    sendEvent({ type: 'token', content: finalText });
    if (persistEnabled) {
      await aiTurn.endTurn({
        conversationId,
        user: req.user,
        content: finalText,
        blocks: turnBlocks.length ? turnBlocks : undefined,
      });
    }
    sendEvent({ type: 'end' });
    return res.end();
  } catch (err) {
    if (!res.headersSent) return next(err);
    sendEvent({ type: 'error', error: err.message });
    res.end();
  }
});

// POST /zeus/agent/confirm — executa uma ação previamente PROPOSTA e confirmada
// pelo usuário. Revalida o role no servidor (defesa em profundidade) e devolve
// a referência de rollback. É o ÚNICO ponto onde write tools são executadas.
router.post('/agent/confirm', async (req, res, next) => {
  const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  try {
    const { action } = req.body;
    if (!action || !action.tool) {
      return res.status(400).json({ error: 'action.tool é obrigatório' });
    }
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'token ausente' });

    const role = req.user?.role || 'viewer';
    const toolName = action.tool;

    // Gate de role (revalidação no servidor)
    if (!WRITE_TOOL_NAMES.has(toolName)) {
      return res.status(400).json({ error: `Ação inválida: ${toolName}` });
    }
    if (!canRoleUseWriteTool(role, toolName)) {
      return res.status(403).json({ error: `Perfil "${role}" não pode executar "${toolName}". Requer admin.` });
    }
    const meta = WRITE_TOOL_META[toolName] || {};
    if (meta.executes === false) {
      return res.status(400).json({ error: `A ação "${toolName}" não é executável pelo agente.` });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(`: ${' '.repeat(2048)}\n\n`);

    sendEvent({ type: 'action_running', tool: toolName, input: action.input || {} });

    try {
      const { result, rollback } = await runWriteTool(toolName, action.input || {}, token);
      sendEvent({ type: 'action_result', tool: toolName, result, rollback });
    } catch (err) {
      sendEvent({ type: 'action_error', tool: toolName, error: err.message });
    }

    sendEvent({ type: 'end' });
    return res.end();
  } catch (err) {
    if (!res.headersSent) return next(err);
    sendEvent({ type: 'error', error: err.message });
    res.end();
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

// ─── Integration tokens (somente HubCentral + admin) ─────────────────────────
// Geração de credenciais é sensível: só no painel central e para admins.
const centralAdminOnly = (req, res, next) => {
  if (ZEUS_PANEL_ROLE !== 'central') {
    return res.status(403).json({ error: 'Disponível apenas no Hub Central.' });
  }
  if ((req.user?.role || 'viewer') !== 'admin') {
    return res.status(403).json({ error: 'Requer perfil admin.' });
  }
  next();
};

router.get('/integrations/tokens', centralAdminOnly, async (_req, res, next) => {
  try { res.json(await zeusGet('/api/integrations/tokens')); } catch (err) { next(err); }
});

router.post('/integrations/tokens', centralAdminOnly, async (req, res, next) => {
  try {
    const { name, scope } = req.body || {};
    res.status(201).json(await zeusRequest('/api/integrations/tokens', { name, scope }));
  } catch (err) { next(err); }
});

router.delete('/integrations/tokens/:id', centralAdminOnly, async (req, res, next) => {
  try {
    const r = await fetch(`${ZEUS_GATEWAY_URL}/api/integrations/tokens/${encodeURIComponent(req.params.id)}`, {
      method: 'DELETE',
      headers: { 'x-api-key': ZEUS_API_KEY }
    });
    res.status(r.status).json(await r.json());
  } catch (err) { next(err); }
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
      panelId: ZEUS_PANEL_ID || null,
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

// GET /zeus/index-git/status/:jobId — poll job status
router.get('/index-git/status/:jobId(*)', async (req, res, next) => {
  try {
    const data = await zeusGet(`/api/index/git/status/${encodeURIComponent(req.params.jobId)}`);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /zeus/hierarchy/contexts/:wsId/:projId/:type — list context files
router.get('/hierarchy/contexts/:wsId/:projId/:type', async (req, res, next) => {
  try {
    const { wsId, projId, type } = req.params;
    const data = await zeusGet(`/api/hierarchy/workspaces/${wsId}/projects/${projId}/contexts/${type}`);
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

// POST /zeus/hierarchy/context-push — painel envia contexto estruturado para as pastas da hierarquia
router.post('/hierarchy/context-push', async (req, res, next) => {
  try {
    const { type, filename, content } = req.body;
    if (!type || !filename || content === undefined) {
      return res.status(400).json({ error: 'type, filename, content required' });
    }
    const PANEL_API_KEY = process.env.ZEUS_PANEL_API_KEY || '';
    const data = await zeusRequest('/api/hierarchy/context-push', {
      panelId: ZEUS_PANEL_ID,
      apiKey: PANEL_API_KEY,
      type,
      filename,
      content
    });
    res.json(data);
  } catch (err) { next(err); }
});

// POST /zeus/openapi/index — indexar spec OpenAPI/Swagger
router.post('/openapi/index', async (req, res, next) => {
  try {
    const { specUrl, specObject, collection, name } = req.body;
    if (!specUrl && !specObject) return res.status(400).json({ error: 'specUrl or specObject required' });
    if (!collection) return res.status(400).json({ error: 'collection required' });
    const data = await zeusRequest('/api/openapi/index', {
      specUrl, specObject, collection, name,
      panelId: ZEUS_PANEL_ID || undefined
    });
    res.status(202).json(data);
  } catch (err) { next(err); }
});

// GET /zeus/openapi/status/:jobId
router.get('/openapi/status/:jobId', async (req, res, next) => {
  try {
    res.json(await zeusGet(`/api/openapi/status/${req.params.jobId}`));
  } catch (err) { next(err); }
});


// POST /zeus/storage/index — indexar bucket MinIO/S3
router.post('/storage/index', async (req, res, next) => {
  try {
    const { endpoint, accessKey, secretKey, region, bucket, prefix, collection } = req.body;
    if (!accessKey || !secretKey || !bucket) return res.status(400).json({ error: 'accessKey, secretKey and bucket are required' });
    const data = await zeusRequest('/api/storage/index', {
      endpoint, accessKey, secretKey, region, bucket, prefix, collection,
      panelId: ZEUS_PANEL_ID || undefined
    });
    res.status(202).json(data);
  } catch (err) { next(err); }
});

// GET /zeus/storage/status/:jobId
router.get('/storage/status/:jobId', async (req, res, next) => {
  try {
    res.json(await zeusGet(`/api/storage/status/${encodeURIComponent(req.params.jobId)}`));
  } catch (err) { next(err); }
});

module.exports = router;
