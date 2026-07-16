'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { detectBuildErrorType, detectHealthcheckFailure } = require('./ai-fix-workflow');

test('classifica rota de healthcheck inexistente e sugere a raiz', () => {
  const service = { containerPort: 3000, healthcheck: { enabled: true, target: '/health' } };
  const error = 'Healthcheck falhou para app: porta interna 3000: HTTP 404';
  const result = detectHealthcheckFailure(error, '', service);

  assert.equal(result.type, 'healthcheck-path-not-found');
  assert.equal(result.fix.target, '/');
  assert.equal(detectBuildErrorType(error, '', service), 'healthcheck-path-not-found');
});

test('não cria loop de correção quando a própria raiz retorna 404', () => {
  const service = { containerPort: 3000, healthcheck: { enabled: true, target: '/' } };
  const result = detectHealthcheckFailure('Healthcheck app: HTTP 404', '', service);

  assert.equal(result.type, 'healthcheck-path-not-found');
  assert.equal(result.fix, null);
});

test('detecta divergência entre porta configurada e porta informada pelo runtime', () => {
  const service = { containerPort: 3000, healthcheck: { enabled: true, target: '/' } };
  const logs = 'Server running and listening on port 8080\nHealthcheck: connect ECONNREFUSED';
  const result = detectHealthcheckFailure('', logs, service);

  assert.equal(result.type, 'healthcheck-port-mismatch');
  assert.equal(result.fix.port, 8080);
});

test('detecta servidor preso ao localhost dentro do container', () => {
  const service = { containerPort: 3000, healthcheck: { enabled: true, target: '/' } };
  const logs = 'Server listening on 127.0.0.1:3000\nHealthcheck: connect ECONNREFUSED';
  const result = detectHealthcheckFailure('', logs, service);

  assert.equal(result.type, 'healthcheck-localhost-bind');
  assert.equal(result.fix, null);
});
