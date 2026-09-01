'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { planFixes } = require('./service-doctor');

// Helper: acha um fix por campo.
const byField = (plan, field) => plan.fixes.find((f) => f.field === field);

test('alinha containerPort com a porta informada nos logs', () => {
  const plan = planFixes({
    service: { containerPort: 3000, hostPort: 8000, healthcheck: { enabled: true, target: '/' } },
    image: { exposedPorts: ['3000/tcp'] },
    recentLogs: 'Server running and listening on port 8080',
  });
  const fix = byField(plan, 'containerPort');
  assert.ok(fix, 'esperava um fix de containerPort');
  assert.equal(fix.to, 8080);
  assert.equal(plan.updates.containerPort, 8080);
});

test('usa a porta exposta da imagem quando o log não informa porta', () => {
  const plan = planFixes({
    service: { containerPort: null, hostPort: 9000, healthcheck: { enabled: true, target: '/' } },
    image: { exposedPorts: ['3000/tcp'] },
    recentLogs: 'app iniciado',
  });
  const fix = byField(plan, 'containerPort');
  assert.ok(fix);
  assert.equal(fix.to, 3000);
});

test('publica hostPort ausente para expor o serviço', () => {
  const plan = planFixes({
    service: { containerPort: 3000, hostPort: null, healthcheck: { enabled: true, target: '/' } },
    image: { exposedPorts: ['3000/tcp'] },
    recentLogs: '',
  });
  const fix = byField(plan, 'hostPort');
  assert.ok(fix);
  assert.equal(fix.to, 3000);
  assert.equal(plan.updates.hostPort, 3000);
});

test('habilita healthcheck ausente usando a rota /health detectada no código', () => {
  const plan = planFixes({
    service: { containerPort: 3000, hostPort: 8000, healthcheck: null },
    image: { exposedPorts: ['3000/tcp'] },
    recentLogs: 'CloudPainel Node.js Demo running on port 3000',
    sourceSample: [
      { file: 'index.js', content: "app.get('/health', (req, res) => res.json({ status: 'ok' }));" },
    ],
  });
  const fix = byField(plan, 'healthcheck');
  assert.ok(fix, 'esperava um fix habilitando o healthcheck');
  assert.equal(plan.updates.healthcheck.enabled, true);
  assert.equal(plan.updates.healthcheck.target, '/health');
});

test('habilita healthcheck ausente com fallback "/" quando não há rota de health', () => {
  const plan = planFixes({
    service: { containerPort: 3000, hostPort: 8000, healthcheck: { enabled: false } },
    image: { exposedPorts: ['3000/tcp'] },
    recentLogs: 'server started on port 3000',
    sourceSample: [{ file: 'index.js', content: "app.get('/', (req,res)=>res.send('hi'))" }],
  });
  const fix = byField(plan, 'healthcheck');
  assert.ok(fix);
  assert.equal(plan.updates.healthcheck.target, '/');
});

test('NÃO habilita healthcheck quando a app faz bind em localhost (precisa fix de código)', () => {
  const plan = planFixes({
    service: { containerPort: 3000, hostPort: 8000, healthcheck: null },
    image: { exposedPorts: ['3000/tcp'] },
    recentLogs: 'Server listening on 127.0.0.1:3000',
    sourceSample: [{ file: 'index.js', content: "app.get('/health', h)" }],
  });
  assert.equal(byField(plan, 'healthcheck'), undefined, 'não deveria propor healthcheck com bind localhost');
  assert.ok(plan.pending.some((p) => p.issue === 'localhost-bind'), 'esperava pendência de localhost-bind');
});

test('não altera healthcheck já habilitado e coerente', () => {
  const plan = planFixes({
    service: { containerPort: 3000, hostPort: 8000, healthcheck: { enabled: true, target: '/health' } },
    image: { exposedPorts: ['3000/tcp'] },
    recentLogs: 'running on port 3000',
    sourceSample: [{ file: 'index.js', content: "app.get('/health', h)" }],
  });
  assert.equal(byField(plan, 'healthcheck'), undefined);
});
