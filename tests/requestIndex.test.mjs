// Índice de requests compartilhado (src/lib/requestIndex.ts). Rodar com `npm test`.
// O módulo usa window (api.bruList e eventos): o teste monta um window mínimo sobre EventTarget,
// e um hook de resolução completa '.ts' nos imports relativos de src/ (que vêm sem extensão).
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.includes('/src/') && /^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) return next(`${specifier}.ts`, context);
    return next(specifier, context);
  },
});

const win = new EventTarget();
globalThis.window = win;

const idx = await import('../src/lib/requestIndex.ts');
const React = await import('react');

// Sem renderizador de cliente no projeto: o dispatcher interno do React 19 é trocado por um que
// implementa só useSyncExternalStore, guardando o subscribe para o teste conferir as notificações.
const internals = React.default.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
let lastSubscribe = null;
function summaryOf(target) {
  const previous = internals.H;
  internals.H = { useSyncExternalStore: (subscribe, getSnapshot) => ((lastSubscribe = subscribe), getSnapshot()) };
  try {
    return idx.useRequestSummary(target);
  } finally {
    internals.H = previous;
  }
}

const sample = [
  { path: 'Requests/Users/Listar.bru', name: 'Listar', method: 'get', url: '/users' },
  { path: 'Requests/Users/Criar.bru', name: 'Criar', method: 'post', url: '/users' },
];

test('getRequestIndex começa vazio', () => {
  assert.deepEqual(idx.getRequestIndex(), []);
});

test('setRequestIndex troca a lista e getRequestIndex devolve a mesma referência', () => {
  idx.setRequestIndex(sample);
  assert.equal(idx.getRequestIndex(), sample);
  idx.setRequestIndex([]);
  assert.deepEqual(idx.getRequestIndex(), []);
});

test('loadRequestIndex lê as requests do window.api.bruList', async () => {
  win.api = { bruList: async () => ({ requests: sample }) };
  const out = await idx.loadRequestIndex();
  assert.equal(out, sample);
  assert.equal(idx.getRequestIndex(), sample);
});

test('loadRequestIndex com falha na leitura zera a lista em vez de lançar', async () => {
  idx.setRequestIndex(sample);
  win.api = { bruList: async () => { throw new Error('EACCES'); } };
  const out = await idx.loadRequestIndex();
  assert.deepEqual(out, []);
  assert.deepEqual(idx.getRequestIndex(), []);
});

test('loadRequestIndex sem window.api também zera a lista', async () => {
  idx.setRequestIndex(sample);
  delete win.api;
  assert.deepEqual(await idx.loadRequestIndex(), []);
});

test('useRequestSummary acha a request pelo caminho, sem diferenciar maiúsculas, barras ou "/" inicial', () => {
  idx.setRequestIndex(sample);
  assert.equal(summaryOf('Requests/Users/Criar.bru'), sample[1]);
  assert.equal(summaryOf('requests/users/criar.bru'), sample[1]);
  assert.equal(summaryOf('/Requests\\Users\\Listar.bru'), sample[0]);
  assert.equal(summaryOf('  Requests/Users/Listar.bru  '), sample[0]);
});

test('useRequestSummary devolve undefined para request que não existe', () => {
  idx.setRequestIndex(sample);
  assert.equal(summaryOf('Requests/Outra.bru'), undefined);
  idx.setRequestIndex([]);
  assert.equal(summaryOf('Requests/Users/Criar.bru'), undefined);
});

test('o subscribe do hook avisa a cada setRequestIndex e para de avisar depois de cancelado', () => {
  summaryOf('x.bru');
  let calls = 0;
  const unsubscribe = lastSubscribe(() => calls++);
  idx.setRequestIndex(sample);
  idx.setRequestIndex([]);
  assert.equal(calls, 2);
  unsubscribe();
  idx.setRequestIndex(sample);
  assert.equal(calls, 2);
});

test('focusRequestEvent tem o nome esperado', () => {
  assert.equal(idx.focusRequestEvent, 'obnotion:focus-request');
});

test('focusRequest dispara o evento com o caminho e guarda o pedido', () => {
  const seen = [];
  const listener = (event) => seen.push(event.detail);
  win.addEventListener(idx.focusRequestEvent, listener);
  try {
    idx.focusRequest('Requests/Users/Criar.bru');
  } finally {
    win.removeEventListener(idx.focusRequestEvent, listener);
  }
  assert.deepEqual(seen, ['Requests/Users/Criar.bru']);
  assert.equal(idx.takeFocusedRequest(), 'Requests/Users/Criar.bru');
});

test('takeFocusedRequest consome o pedido: a segunda leitura é null', () => {
  idx.focusRequest('a.bru');
  assert.equal(idx.takeFocusedRequest(), 'a.bru');
  assert.equal(idx.takeFocusedRequest(), null);
});

test('focusRequest repetido fica só com o último pedido', () => {
  idx.focusRequest('a.bru');
  idx.focusRequest('b.bru');
  assert.equal(idx.takeFocusedRequest(), 'b.bru');
  assert.equal(idx.takeFocusedRequest(), null);
});

test('takeFocusedRequest sem pedido devolve null', () => {
  assert.equal(idx.takeFocusedRequest(), null);
});
