// Lógica da tela de Requests (src/lib/requestTools.ts). Rodar com `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as r from '../src/lib/requestTools.ts';

test('shellWords entende aspas, escapes e quebras de linha com barra invertida', () => {
  assert.deepEqual(r.shellWords(`curl -H 'A: b c' "x \\"y\\"" \\\n --data $'l1\\nl2'`), ['curl', '-H', 'A: b c', 'x "y"', '--data', 'l1\nl2']);
  assert.deepEqual(r.shellWords('curl ""'), ['curl', '']);
  assert.throws(() => r.shellWords("curl 'aberto"));
});

test('parseCurl lê método, headers, corpo JSON e bearer', () => {
  const cmd = `curl -X POST 'https://api.x.com/users?page=2' -H 'Content-Type: application/json' -H "Authorization: Bearer tok123" --data-raw '{"name":"Ana"}'`;
  const out = r.parseCurl(cmd);
  assert.equal(out.method, 'POST');
  assert.equal(out.url, 'https://api.x.com/users?page=2');
  assert.equal(out.bodyMode, 'json');
  assert.equal(out.body.json, '{"name":"Ana"}');
  assert.equal(out.authMode, 'bearer');
  assert.equal(out.auth.bearer.token, 'tok123');
  assert.deepEqual(out.headers.map((h) => h.name), ['Content-Type']);
});

test('parseCurl: -d sem método vira POST de formulário; -G manda os dados na query; -u vira Basic', () => {
  const form = r.parseCurl('curl https://x.com/login -d user=ana -d "senha=a%20b"');
  assert.equal(form.method, 'POST');
  assert.equal(form.bodyMode, 'formUrlEncoded');
  assert.deepEqual(form.body.formUrlEncoded.map((p) => [p.name, p.value]), [['user', 'ana'], ['senha', 'a b']]);
  const get = r.parseCurl('curl -G https://x.com/busca -d q=ana');
  assert.equal(get.method, 'GET');
  assert.equal(get.url, 'https://x.com/busca?q=ana');
  const basic = r.parseCurl('curl -u ana:segredo --url https://x.com -XDELETE -L --compressed');
  assert.equal(basic.method, 'DELETE');
  assert.equal(basic.authMode, 'basic');
  assert.deepEqual(basic.auth.basic, { username: 'ana', password: 'segredo' });
  assert.equal(r.parseCurl('curl --json \'{"a":1}\' x.com').headers.length, 2);
  assert.throws(() => r.parseCurl('wget x'));
  assert.throws(() => r.parseCurl('curl -H "A: b"'));
});

test('applyCurl mantém nome e anotações e sincroniza a query', () => {
  const base = { meta: { name: 'Minha', type: 'http' }, http: { method: 'get', url: '' }, docs: 'nota', script: { req: 'x' } };
  const next = r.applyCurl(base, r.parseCurl("curl 'https://x.com/a?b=1&c'"));
  assert.equal(next.meta.name, 'Minha');
  assert.equal(next.docs, 'nota');
  assert.deepEqual(next.script, { req: 'x' });
  assert.equal(next.http.method, 'get');
  assert.deepEqual(next.params.map((p) => [p.name, p.value]), [['b', '1'], ['c', '']]);
});

test('toSnippet gera cURL que volta igual pelo parseCurl, e fetch/Python/HTTP', () => {
  const req = { id: '1', method: 'POST', url: 'https://x.com/a?b=1', headers: [['Content-Type', 'application/json'], ['X-Nome', "d'Ana"]], body: '{"a":"it\'s"}' };
  const curl = r.toSnippet(req, 'curl');
  const back = r.parseCurl(curl);
  assert.equal(back.method, 'POST');
  assert.equal(back.url, req.url);
  assert.equal(back.body.json, req.body);
  assert.deepEqual(back.headers.map((h) => [h.name, h.value]), req.headers);
  assert.match(r.toSnippet(req, 'fetch'), /method: "POST"/);
  assert.match(r.toSnippet(req, 'python'), /requests\.request\("POST", "https:\/\/x\.com\/a\?b=1", headers=headers, data=/);
  assert.match(r.toSnippet(req, 'http'), /^POST \/a\?b=1 HTTP\/1\.1\nHost: x\.com/);
  assert.equal(r.toSnippet({ ...req, method: 'GET', headers: [], body: undefined }, 'curl'), "curl 'https://x.com/a?b=1'");
});

test('path params: nomes, sincronia com a tabela e troca na URL', () => {
  assert.deepEqual(r.pathParamNames('{{baseUrl}}/users/:id/posts/:postId?x=:nao'), ['id', 'postId']);
  assert.deepEqual(r.pathParamNames('http://localhost:8080/a'), []);
  const params = r.syncPathParams('/users/:id', [{ name: 'q', value: '1', enabled: true, type: 'query' }]);
  assert.deepEqual(params.map((p) => [p.name, p.type]), [['q', 'query'], ['id', 'path']]);
  const typed = params.map((p) => (p.name === 'id' ? { ...p, value: '7' } : p));
  assert.equal(r.syncPathParams('/users/:id', typed), typed, 'sem mudança devolve a mesma lista');
  assert.equal(r.syncPathParams('/users', typed).length, 1);
  assert.equal(r.applyPathParams('http://h:80/users/:id/x?y=1', [{ name: 'id', value: 'a b', enabled: true, type: 'path' }]), 'http://h:80/users/a%20b/x?y=1');
  assert.equal(r.applyPathParams('/users/:id', [{ name: 'id', value: '', enabled: true, type: 'path' }]), '/users/:id');
});

test('edição em massa vai e volta, com linhas desativadas', () => {
  const rows = [
    { name: 'Accept', value: 'application/json', enabled: true },
    { name: 'X-Debug', value: '1', enabled: false },
  ];
  const text = r.pairsToText(rows);
  assert.equal(text, 'Accept: application/json\n//X-Debug: 1');
  assert.deepEqual(r.textToPairs(text), rows);
  assert.deepEqual(r.textToPairs('a\n\n b : c:d ', { type: 'query' }), [
    { type: 'query', name: 'a', value: '', enabled: true },
    { type: 'query', name: 'b', value: 'c:d', enabled: true },
  ]);
});

test('queryJson navega por chaves, índices, curingas e length', () => {
  const data = { users: [{ id: 1, name: 'Ana' }, { id: 2, name: 'Bia' }], 'com espaço': true };
  assert.equal(r.queryJson(data, 'users[0].name'), 'Ana');
  assert.equal(r.queryJson(data, '$.users[-1].id'), 2);
  assert.deepEqual(r.queryJson(data, 'users[*].id'), [1, 2]);
  assert.equal(r.queryJson(data, 'users.length'), 2);
  assert.equal(r.queryJson(data, '["com espaço"]'), true);
  assert.equal(r.queryJson(data, 'users[5]'), undefined);
  assert.equal(r.queryJson(data, ''), data);
  assert.throws(() => r.parseJsonPath('a[]'));
});

test('findMatches e highlightSegments ignoram maiúsculas', () => {
  assert.deepEqual(r.findMatches('Ana ana ANA', 'ana'), [0, 4, 8]);
  assert.deepEqual(r.findMatches('abc', ''), []);
  assert.deepEqual(r.highlightSegments('xAnay', 'ana'), [
    { text: 'x', match: false },
    { text: 'Ana', match: true },
    { text: 'y', match: false },
  ]);
});

test('parseSetCookies lê atributos', () => {
  const cookies = r.parseSetCookies([
    ['content-type', 'x'],
    ['set-cookie', 'sid=abc=1; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=60'],
    ['Set-Cookie', 'tema=escuro'],
  ]);
  assert.equal(cookies.length, 2);
  assert.deepEqual(cookies[0], { name: 'sid', value: 'abc=1', path: '/', httpOnly: true, secure: true, sameSite: 'Lax', maxAge: '60' });
  assert.equal(cookies[1].value, 'escuro');
});

test('asserções no formato do Bruno', () => {
  const result = {
    ok: true,
    status: 201,
    statusText: 'Created',
    headers: [['Content-Type', 'application/json; charset=utf-8']],
    size: 10,
    time: 42,
    truncated: false,
    body: JSON.stringify({ users: [{ name: 'Ana' }], total: 1, vazio: [], nulo: null }),
  };
  const check = (name, value) => r.evaluateAssertions([{ name, value, enabled: true }], result)[0];
  assert.equal(check('res.status', 'eq 201').pass, true);
  assert.equal(check('res.status', '201').pass, true, 'sem operador vale eq');
  assert.equal(check('res.status', 'in 200, 201').pass, true);
  assert.equal(check('res.status', 'between 200, 299').pass, true);
  assert.equal(check('res.status', 'neq 201').pass, false);
  assert.equal(check('res.responseTime', 'lt 1000').pass, true);
  assert.equal(check('res.headers.content-type', 'contains json').pass, true);
  assert.equal(check('res.body.users[0].name', 'eq "Ana"').pass, true);
  assert.equal(check('res.body.users', 'length 1').pass, true);
  assert.equal(check('res.body.users', 'isArray').pass, true);
  assert.equal(check('res.body.vazio', 'isEmpty').pass, true);
  assert.equal(check('res.body.nulo', 'isNull').pass, true);
  assert.equal(check('res.body.total', 'gte 1').pass, true);
  assert.equal(check('res.body.users[0].name', 'matches ^A').pass, true);
  assert.equal(check('res.body.users[0].name', 'matches [').error, 'expected');
  assert.equal(check('req.url', 'eq x').error, 'target');
  assert.deepEqual(r.evaluateAssertions([{ name: 'res.status', value: 'eq 200', enabled: false }], result), []);
  const failed = r.evaluateAssertions([{ name: 'res.status', value: 'eq 200', enabled: true }], { ok: false, error: 'x' });
  assert.equal(failed[0].pass, false);
});

test('formatJsonBody formata com variáveis e aponta linha e coluna do erro', () => {
  const ok = r.formatJsonBody('{"id": {{id}}, "nome": "{{ nome }}", "a":[1,2]}');
  assert.equal(ok.ok, true);
  assert.equal(ok.text, '{\n  "id": {{id}},\n  "nome": "{{ nome }}",\n  "a": [\n    1,\n    2\n  ]\n}');
  const bad = r.formatJsonBody('{\n  "a": 1,\n  "b": }');
  assert.equal(bad.ok, false);
  assert.equal(bad.line, 3);
  assert.equal(r.formatJsonBody('  ').ok, true);
});

test('filtros da coleção e do histórico', () => {
  const req = { name: 'Criar usuário', url: '{{baseUrl}}/users', path: 'Requests/Users/Criar.bru', method: 'post' };
  assert.equal(r.matchesRequestQuery(req, 'usuario'), true, 'sem acento');
  assert.equal(r.matchesRequestQuery(req, 'post users'), true);
  assert.equal(r.matchesRequestQuery(req, 'get users'), false);
  assert.equal(r.matchesRequestQuery(req, ''), true);
  const ok = { ok: true, status: 404, statusText: '', headers: [], size: 0, time: 0, truncated: false, body: '' };
  const entries = [
    { name: 'A', url: 'x', method: 'GET', result: ok },
    { name: 'B', url: 'y', method: 'GET', result: { ok: false, error: 'e' } },
  ];
  assert.deepEqual(r.filterHistory(entries, '', '4xx').map((e) => e.name), ['A']);
  assert.deepEqual(r.filterHistory(entries, '', 'error').map((e) => e.name), ['B']);
  assert.deepEqual(r.filterHistory(entries, 'y', 'all').map((e) => e.name), ['B']);
});

test('documentação Markdown escapa tabelas e usa cerca maior que o conteúdo', () => {
  const labels = { params: 'Params', pathParams: 'Path', headers: 'Headers', body: 'Body', auth: 'Auth', name: 'Nome', value: 'Valor', file: 'Arquivo', assertions: 'Asserts' };
  const request = {
    meta: { name: 'Criar', type: 'http' },
    http: { method: 'post', url: '/u', body: 'json', auth: 'bearer' },
    headers: [{ name: 'X', value: 'a|b', enabled: true }, { name: 'Off', value: '1', enabled: false }],
    body: { json: 'tem ``` dentro' },
    assertions: [{ name: 'res.status', value: 'eq 200', enabled: true }],
  };
  const md = r.collectionToMarkdown('API', [{ request, path: 'Requests/Criar.bru' }], labels);
  assert.match(md, /^# API\n\n## Criar\n/);
  assert.match(md, /\| X \| a\\\|b \|/);
  assert.doesNotMatch(md, /Off/);
  assert.match(md, /````json\ntem ``` dentro\n````/);
  assert.match(md, /\[\[Requests\/Criar\.bru\|Criar\]\]/);
  assert.match(md, /- `res\.status` eq 200/);
});

test('responseToMarkdown formata JSON e lista headers', () => {
  const labels = { request: 'Request', status: 'Status', time: 'Tempo', size: 'Tamanho', headers: 'Headers', body: 'Corpo', sentAt: 'Enviada' };
  const md = r.responseToMarkdown(
    { name: 'Lista', method: 'GET', url: 'http://x', at: 'hoje', size: '1 KB', result: { ok: true, status: 200, statusText: 'OK', headers: [['a', 'b']], size: 1, time: 5, truncated: false, body: '{"a":1}' } },
    labels,
  );
  assert.match(md, /- Status: 200 OK/);
  assert.match(md, /```json\n\{\n {2}"a": 1\n\}\n```/);
  assert.match(r.responseToMarkdown({ name: 'X', method: 'GET', url: 'u', at: 'h', size: '', result: { ok: false, error: 'falhou' } }, labels), /Status: falhou/);
});

test('uniqueName e safeFileName', () => {
  assert.equal(r.uniqueName('Ambiente', ['ambiente', 'Ambiente 2']), 'Ambiente 3');
  assert.equal(r.safeFileName(' Prod: v2? '), 'Prod v2');
});
