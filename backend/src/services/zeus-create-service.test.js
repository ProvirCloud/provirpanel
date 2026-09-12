'use strict';

// Testes da validação de templateId em create_service (write tool do Zeus).
// Objetivo: garantir que templateIds inválidos/alucinados (ex.: nome de imagem
// posto no lugar do template) falhem com mensagem ACIONÁVEL — em vez do erro
// opaco "Template not found" que vinha cru do backend — e ANTES de qualquer
// chamada HTTP de criação.

const test = require('node:test');
const assert = require('node:assert');

const { runWriteTool } = require('./zeus-agent-tools');

const FAKE_TOKEN = 'x'; // não deve ser usado: a validação falha antes do HTTP.

async function expectReject(input) {
  let err = null;
  try {
    await runWriteTool('create_service', input, FAKE_TOKEN);
  } catch (e) {
    err = e;
  }
  assert.ok(err, 'esperava que create_service rejeitasse');
  return err;
}

test('rejeita templateId ausente com mensagem clara', async () => {
  const err = await expectReject({ name: 'svc', config: {} });
  assert.match(err.message, /templateId/i);
});

test('nome de imagem no templateId (node-slim-22) → orienta usar custom-image', async () => {
  const err = await expectReject({ name: 'servico-backend-nextjs', config: { templateId: 'node-slim-22' } });
  assert.match(err.message, /custom-image/);
  assert.match(err.message, /imagem Docker|nome de imagem/i);
  // NÃO deve ser o erro opaco antigo do backend
  assert.doesNotMatch(err.message, /^Template not found$/);
});

test('imagem com tag no templateId (node:22) → orienta custom-image', async () => {
  const err = await expectReject({ name: 'svc', config: { templateId: 'node:22' } });
  assert.match(err.message, /custom-image/);
});

test('templateId desconhecido sem cara de imagem → lista templates válidos', async () => {
  const err = await expectReject({ name: 'svc', config: { templateId: 'foobar' } });
  assert.match(err.message, /não existe/i);
  assert.match(err.message, /nextjs-app/);
  assert.match(err.message, /custom-image/);
});

test('custom-image sem imageName é rejeitado', async () => {
  const err = await expectReject({ name: 'svc', config: { templateId: 'custom-image', containerPort: 3000 } });
  assert.match(err.message, /imageName/);
});

test('custom-image sem containerPort é rejeitado', async () => {
  const err = await expectReject({ name: 'svc', config: { templateId: 'custom-image', imageName: 'grafana/grafana:latest' } });
  assert.match(err.message, /containerPort/);
});

test('templateId válido do catálogo passa da validação (não lança erro de validação)', async () => {
  // nextjs-app é válido: a validação NÃO deve barrar. Como não há backend HTTP
  // no ambiente de teste, a chamada seguirá para localPost e falhará por rede —
  // o importante é que o erro NÃO seja de validação de template.
  const err = await expectReject({ name: 'svc', config: { templateId: 'nextjs-app' } });
  assert.doesNotMatch(err.message, /não existe|custom-image é obrigatório|Template not found/i);
});
