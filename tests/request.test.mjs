// Modelo e montagem de requests (src/lib/request.ts). Rodar com `npm test`.
// request.ts importa './i18n' (TSX, não roda no Node) e './requestTools' sem extensão: um hook de
// resolução troca o i18n por um stub mínimo e completa '.ts' nos imports relativos de src/.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

const I18N_STUB = 'export const translate = (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key);';
registerHooks({
  resolve(specifier, context, next) {
    const fromSrc = context.parentURL?.includes('/src/');
    if (fromSrc && specifier === './i18n') return { url: `data:text/javascript,${encodeURIComponent(I18N_STUB)}`, shortCircuit: true };
    if (fromSrc && /^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) return next(`${specifier}.ts`, context);
    return next(specifier, context);
  },
});

const r = await import('../src/lib/request.ts');

const req = (over = {}) => ({ meta: { name: 'R', type: 'http' }, http: { method: 'get', url: 'https://api.x.com/a', ...(over.http ?? {}) }, ...over, http: { method: 'get', url: 'https://api.x.com/a', ...(over.http ?? {}) } });
const header = (out, name) => out.headers.find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];

// ---------------------------------------------------------------------------------------------
// Constantes

test('METHODS lista os sete métodos em maiúsculas', () => {
  assert.deepEqual(r.METHODS, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
});

test('MAX_HISTORY_BODY vale 256 KiB', () => {
  assert.equal(r.MAX_HISTORY_BODY, 262144);
});

// ---------------------------------------------------------------------------------------------
// historyResult

test('historyResult devolve o mesmo objeto quando o corpo cabe', () => {
  const ok = { ok: true, status: 200, statusText: 'OK', headers: [], size: 2, time: 1, truncated: false, body: 'ok' };
  assert.equal(r.historyResult(ok), ok);
});

test('historyResult corta o corpo grande e marca truncated sem mexer no original', () => {
  const body = 'x'.repeat(r.MAX_HISTORY_BODY + 10);
  const ok = { ok: true, status: 200, statusText: 'OK', headers: [['a', 'b']], size: body.length, time: 1, truncated: false, body };
  const out = r.historyResult(ok);
  assert.notEqual(out, ok);
  assert.equal(out.body.length, r.MAX_HISTORY_BODY);
  assert.equal(out.truncated, true);
  assert.equal(out.status, 200);
  assert.deepEqual(out.headers, [['a', 'b']]);
  assert.equal(ok.body.length, r.MAX_HISTORY_BODY + 10, 'original intacto');
  assert.equal(ok.truncated, false);
});

test('historyResult: corpo exatamente no limite não é cortado', () => {
  const ok = { ok: true, status: 200, statusText: '', headers: [], size: 0, time: 0, truncated: false, body: 'y'.repeat(r.MAX_HISTORY_BODY) };
  assert.equal(r.historyResult(ok), ok);
});

test('historyResult devolve erros como vieram', () => {
  const err = { ok: false, error: 'ECONNREFUSED', time: 3 };
  assert.equal(r.historyResult(err), err);
});

// ---------------------------------------------------------------------------------------------
// groupByDay

test('groupByDay agrupa pelo dia ISO mantendo a ordem de chegada', () => {
  const entries = [
    { id: 1, at: '2026-10-18T10:00:00Z' },
    { id: 2, at: '2026-10-18T08:00:00Z' },
    { id: 3, at: '2026-10-17T23:59:00Z' },
    { id: 4, at: '2026-10-18T01:00:00Z' },
  ];
  const groups = r.groupByDay(entries);
  assert.deepEqual(groups.map(([day]) => day), ['2026-10-18', '2026-10-17']);
  assert.deepEqual(groups[0][1].map((e) => e.id), [1, 2, 4]);
  assert.deepEqual(groups[1][1].map((e) => e.id), [3]);
});

test('groupByDay de lista vazia é lista vazia', () => {
  assert.deepEqual(r.groupByDay([]), []);
});

// ---------------------------------------------------------------------------------------------
// envToVars e interpolate

test('envToVars ignora variáveis desativadas e sem nome', () => {
  const env = {
    path: 'e.bru',
    name: 'Dev',
    variables: [
      { name: 'baseUrl', value: 'http://localhost', enabled: true, secret: false },
      { name: 'off', value: '1', enabled: false, secret: false },
      { name: '', value: 'sem nome', enabled: true, secret: false },
      { name: 'token', value: 's3', enabled: true, secret: true },
    ],
  };
  assert.deepEqual(r.envToVars(env), { baseUrl: 'http://localhost', token: 's3' });
});

test('envToVars sem ambiente devolve objeto vazio', () => {
  assert.deepEqual(r.envToVars(), {});
  assert.deepEqual(r.envToVars(undefined), {});
});

test('envToVars: nome repetido fica com o último valor', () => {
  const env = { path: '', name: '', variables: [{ name: 'a', value: '1', enabled: true, secret: false }, { name: 'a', value: '2', enabled: true, secret: false }] };
  assert.deepEqual(r.envToVars(env), { a: '2' });
});

test('interpolate troca variáveis conhecidas, aceita espaços, pontos e hífens', () => {
  const vars = { a: '1', 'b.c': '2', 'd-e': '3' };
  assert.equal(r.interpolate('{{a}}/{{ b.c }}/{{d-e}}', vars), '1/2/3');
});

test('interpolate mantém variáveis desconhecidas como estão', () => {
  assert.equal(r.interpolate('x {{nao}} y', {}), 'x {{nao}} y');
});

test('interpolate aceita valor vazio e não reinterpreta o valor inserido', () => {
  assert.equal(r.interpolate('[{{a}}]', { a: '' }), '[]');
  assert.equal(r.interpolate('{{a}}', { a: '{{b}}', b: 'X' }), '{{b}}');
});

test('interpolate não mexe em chaves que não são variáveis', () => {
  assert.equal(r.interpolate('{a} {{ }} {{a b}}', { a: '1' }), '{a} {{ }} {{a b}}');
});

test('interpolate não trata nomes herdados de Object.prototype como variáveis', () => {
  assert.equal(r.interpolate('{{toString}}', {}), '{{toString}}');
  assert.equal(r.interpolate('{{constructor}}', {}), '{{constructor}}');
});

// ---------------------------------------------------------------------------------------------
// unresolvedVariables

test('unresolvedVariables lista as variáveis da URL, params, headers, auth e corpo sem valor', () => {
  const request = {
    meta: { name: 'R', type: 'http' },
    http: { method: 'post', url: '{{baseUrl}}/u', body: 'json', auth: 'bearer' },
    params: [{ name: 'q', value: '{{q}}', enabled: true }],
    headers: [{ name: 'X', value: '{{h}}', enabled: true }],
    auth: { bearer: { token: '{{token}}' } },
    body: { json: '{"a": {{corpo}}}' },
  };
  assert.deepEqual(r.unresolvedVariables(request, { baseUrl: 'x' }).sort(), ['corpo', 'h', 'q', 'token']);
});

test('unresolvedVariables ignora linhas desativadas, auth inherit/none e corpos de outro modo', () => {
  const request = {
    meta: { name: 'R', type: 'http' },
    http: { method: 'get', url: '/u', body: 'json', auth: 'inherit' },
    params: [{ name: 'q', value: '{{off}}', enabled: false }],
    headers: [{ name: 'X', value: '{{off2}}', enabled: false }],
    auth: { bearer: { token: '{{token}}' } },
    body: { json: '{}', text: '{{texto}}' },
    docs: '{{nota}}',
  };
  assert.deepEqual(r.unresolvedVariables(request, {}), []);
});

test('unresolvedVariables com corpo formUrlEncoded só olha as linhas ativas', () => {
  const request = {
    meta: { name: 'R', type: 'http' },
    http: { method: 'post', url: '/u', body: 'formUrlEncoded', auth: 'none' },
    body: { formUrlEncoded: [{ name: 'a', value: '{{on}}', enabled: true }, { name: 'b', value: '{{off}}', enabled: false }] },
  };
  assert.deepEqual(r.unresolvedVariables(request, {}), ['on']);
});

test('unresolvedVariables não repete nomes e respeita as variáveis conhecidas', () => {
  const request = { meta: { name: 'R', type: 'http' }, http: { method: 'get', url: '{{a}}/{{a}}/{{ b }}' } };
  assert.deepEqual(r.unresolvedVariables(request, {}), ['a', 'b']);
  assert.deepEqual(r.unresolvedVariables(request, { a: '', b: '1' }), []);
});

// ---------------------------------------------------------------------------------------------
// paramsFromUrl e urlFromParams

test('paramsFromUrl lê a query em pares do tipo query', () => {
  assert.deepEqual(r.paramsFromUrl('https://x.com/a?b=1&c&d=x=y'), [
    { name: 'b', value: '1', enabled: true, type: 'query' },
    { name: 'c', value: '', enabled: true, type: 'query' },
    { name: 'd', value: 'x=y', enabled: true, type: 'query' },
  ]);
});

test('paramsFromUrl sem query e com "&" sobrando', () => {
  assert.deepEqual(r.paramsFromUrl('https://x.com/a'), []);
  assert.deepEqual(r.paramsFromUrl('https://x.com/a?'), []);
  assert.deepEqual(r.paramsFromUrl('/a?&&b=2&').map((p) => p.name), ['b']);
});

test('paramsFromUrl preserva linhas desativadas e path params, descarta as query ativas antigas', () => {
  const previous = [
    { name: 'velho', value: '1', enabled: true, type: 'query' },
    { name: 'desligado', value: '2', enabled: false, type: 'query' },
    { name: 'id', value: '7', enabled: true, type: 'path' },
  ];
  assert.deepEqual(r.paramsFromUrl('/u/:id?novo=3', previous).map((p) => p.name), ['novo', 'desligado', 'id']);
});

test('paramsFromUrl não leva o fragmento (#) para o valor do último parâmetro', () => {
  assert.deepEqual(r.paramsFromUrl('https://x.com/a?q=1#sec').map((p) => [p.name, p.value]), [['q', '1']]);
});

test('urlFromParams remonta a query só com params ativos, com nome e de query', () => {
  const params = [
    { name: 'a', value: '1', enabled: true, type: 'query' },
    { name: 'flag', value: '', enabled: true },
    { name: 'off', value: '2', enabled: false, type: 'query' },
    { name: '', value: '3', enabled: true, type: 'query' },
    { name: 'id', value: '9', enabled: true, type: 'path' },
  ];
  assert.equal(r.urlFromParams('https://x.com/u?antigo=1', params), 'https://x.com/u?a=1&flag');
});

test('urlFromParams sem params ativos tira o "?"', () => {
  assert.equal(r.urlFromParams('https://x.com/u?a=1', []), 'https://x.com/u');
});

test('paramsFromUrl e urlFromParams fazem ida e volta', () => {
  const url = '{{baseUrl}}/busca?q={{termo}}&page=2&raw';
  assert.equal(r.urlFromParams(url, r.paramsFromUrl(url)), url);
});

// ---------------------------------------------------------------------------------------------
// buildRequest

test('buildRequest aplica variáveis, sobe o método e completa http://', () => {
  const out = r.buildRequest(req({ http: { method: 'post', url: '{{host}}/users' } }), { host: 'localhost:3000' }, 'id-1');
  assert.equal(out.id, 'id-1');
  assert.equal(out.method, 'POST');
  assert.equal(out.url, 'http://localhost:3000/users');
  assert.deepEqual(out.headers, []);
  assert.equal(out.body, undefined);
});

test('buildRequest mantém esquemas explícitos', () => {
  assert.equal(r.buildRequest(req({ http: { url: 'https://x.com' } }), {}, '1').url, 'https://x.com/');
  assert.equal(r.buildRequest(req({ http: { url: 'ws+unix://sock/a' } }), {}, '1').url.startsWith('ws+unix://'), true);
});

test('buildRequest troca path params já com variáveis aplicadas', () => {
  const request = req({
    http: { url: 'https://x.com/users/:id/posts/:post' },
    params: [
      { name: 'id', value: '{{uid}}', enabled: true, type: 'path' },
      { name: 'post', value: 'a b', enabled: true, type: 'path' },
    ],
  });
  assert.equal(r.buildRequest(request, { uid: '42' }, '1').url, 'https://x.com/users/42/posts/a%20b');
});

test('buildRequest com URL vazia ou só espaços lança erro', () => {
  assert.throws(() => r.buildRequest(req({ http: { url: '' } }), {}, '1'), /requests\.error\.noUrl/);
  assert.throws(() => r.buildRequest(req({ http: { url: '   ' } }), {}, '1'), /requests\.error\.noUrl/);
  assert.throws(() => r.buildRequest(req({ http: { url: '{{vazio}}' } }), { vazio: '' }, '1'), /noUrl/);
});

test('buildRequest com URL inválida lança erro com a URL', () => {
  assert.throws(() => r.buildRequest(req({ http: { url: 'http://a b:99999' } }), {}, '1'), /requests\.error\.invalidUrl/);
});

test('buildRequest leva só headers ativos e com nome, com variáveis aplicadas', () => {
  const request = req({
    headers: [
      { name: 'X-{{n}}', value: '{{v}}', enabled: true },
      { name: 'Off', value: '1', enabled: false },
      { name: '', value: 'sem nome', enabled: true },
    ],
  });
  assert.deepEqual(r.buildRequest(request, { n: 'A', v: 'B' }, '1').headers, [['X-A', 'B']]);
});

test('buildRequest com bearer põe o Authorization', () => {
  const out = r.buildRequest(req({ http: { auth: 'bearer' }, auth: { bearer: { token: '{{tok}}' } } }), { tok: 'abc' }, '1');
  assert.equal(header(out, 'authorization'), 'Bearer abc');
});

test('buildRequest com basic codifica usuário:senha em base64 UTF-8', () => {
  const out = r.buildRequest(req({ http: { auth: 'basic' }, auth: { basic: { username: 'ana', password: 'sênha' } } }), {}, '1');
  assert.equal(header(out, 'authorization'), `Basic ${Buffer.from('ana:sênha', 'utf8').toString('base64')}`);
});

test('buildRequest com basic sem dados manda ":" codificado', () => {
  const out = r.buildRequest(req({ http: { auth: 'basic' } }), {}, '1');
  assert.equal(header(out, 'authorization'), `Basic ${Buffer.from(':').toString('base64')}`);
});

test('buildRequest com apikey no header', () => {
  const out = r.buildRequest(req({ http: { auth: 'apikey' }, auth: { apikey: { key: 'X-Key', value: '{{k}}', placement: 'header' } } }), { k: 'segredo' }, '1');
  assert.deepEqual(out.headers, [['X-Key', 'segredo']]);
});

test('buildRequest com apikey sem chave não cria header', () => {
  const out = r.buildRequest(req({ http: { auth: 'apikey' }, auth: { apikey: { value: 'v' } } }), {}, '1');
  assert.deepEqual(out.headers, []);
});

test('buildRequest com apikey na query acrescenta o parâmetro', () => {
  const out = r.buildRequest(req({ http: { url: 'https://x.com/a?b=1', auth: 'apikey' }, auth: { apikey: { key: 'api_key', value: 'a b', placement: 'queryparams' } } }), {}, '1');
  assert.equal(out.url, 'https://x.com/a?b=1&api_key=a+b');
  assert.deepEqual(out.headers, []);
});

test('buildRequest com apikey na query e sem chave não acrescenta "=valor"', () => {
  const out = r.buildRequest(req({ http: { auth: 'apikey' }, auth: { apikey: { value: 'v', placement: 'queryparams' } } }), {}, '1');
  assert.equal(out.url, 'https://api.x.com/a');
});

test('buildRequest com auth inherit ou none não adiciona header', () => {
  for (const mode of ['inherit', 'none']) {
    const out = r.buildRequest(req({ http: { auth: mode }, auth: { bearer: { token: 't' } } }), {}, '1');
    assert.deepEqual(out.headers, [], mode);
  }
});

test('buildRequest com corpo JSON, texto e XML põe o Content-Type certo', () => {
  const cases = [
    ['json', { json: '{"a":{{n}}}' }, '{"a":1}', 'application/json'],
    ['text', { text: 'oi {{n}}' }, 'oi 1', 'text/plain'],
    ['xml', { xml: '<a>{{n}}</a>' }, '<a>1</a>', 'application/xml'],
  ];
  for (const [mode, body, expected, type] of cases) {
    const out = r.buildRequest(req({ http: { method: 'post', body: mode }, body }), { n: '1' }, '1');
    assert.equal(out.body, expected, mode);
    assert.equal(header(out, 'content-type'), type, mode);
  }
});

test('buildRequest não duplica Content-Type informado pelo usuário (sem diferenciar maiúsculas)', () => {
  const out = r.buildRequest(
    req({ http: { method: 'post', body: 'json' }, headers: [{ name: 'content-type', value: 'application/vnd.api+json', enabled: true }], body: { json: '{}' } }),
    {},
    '1',
  );
  assert.deepEqual(out.headers, [['content-type', 'application/vnd.api+json']]);
});

test('buildRequest com corpo JSON ausente manda string vazia', () => {
  const out = r.buildRequest(req({ http: { method: 'post', body: 'json' } }), {}, '1');
  assert.equal(out.body, '');
});

test('buildRequest com formUrlEncoded codifica só as linhas ativas', () => {
  const out = r.buildRequest(
    req({
      http: { method: 'post', body: 'formUrlEncoded' },
      body: {
        formUrlEncoded: [
          { name: 'nome', value: '{{n}}', enabled: true },
          { name: 'x', value: 'a&b=c', enabled: true },
          { name: 'off', value: '1', enabled: false },
          { name: '', value: 'sem', enabled: true },
        ],
      },
    }),
    { n: 'Ana Maria' },
    '1',
  );
  assert.equal(out.body, 'nome=Ana+Maria&x=a%26b%3Dc');
  assert.equal(header(out, 'content-type'), 'application/x-www-form-urlencoded');
});

test('buildRequest com multipartForm lança erro', () => {
  assert.throws(() => r.buildRequest(req({ http: { method: 'post', body: 'multipartForm' } }), {}, '1'), /requests\.error\.multipart/);
});

test('buildRequest com corpo none não manda corpo nem Content-Type', () => {
  const out = r.buildRequest(req({ http: { method: 'post', body: 'none' }, body: { json: '{}' } }), {}, '1');
  assert.equal(out.body, undefined);
  assert.deepEqual(out.headers, []);
});

test('buildRequest não altera a request original', () => {
  const request = req({ http: { auth: 'bearer', body: 'json' }, auth: { bearer: { token: 't' } }, headers: [{ name: 'A', value: '1', enabled: true }], body: { json: '{}' } });
  const snapshot = structuredClone(request);
  r.buildRequest(request, {}, '1');
  assert.deepEqual(request, snapshot);
});

// ---------------------------------------------------------------------------------------------
// formatBody e formatSize

test('formatBody indenta JSON pelo Content-Type', () => {
  assert.equal(r.formatBody('{"a":[1]}', [['Content-Type', 'application/json']]), '{\n  "a": [\n    1\n  ]\n}');
});

test('formatBody indenta JSON pelo formato mesmo sem Content-Type', () => {
  assert.equal(r.formatBody(' [1,2]', []), '[\n  1,\n  2\n]');
});

test('formatBody devolve como veio quando não é JSON', () => {
  assert.equal(r.formatBody('<a/>', [['content-type', 'text/xml']]), '<a/>');
  assert.equal(r.formatBody('{quebrado', [['content-type', 'application/json']]), '{quebrado');
  assert.equal(r.formatBody('', [['content-type', 'application/json']]), '');
  assert.equal(r.formatBody('42', []), '42', 'sem Content-Type JSON e sem { ou [ não mexe');
});

test('formatBody com Content-Type JSON formata escalares', () => {
  assert.equal(r.formatBody('"x"', [['CONTENT-TYPE', 'application/problem+json']]), '"x"');
  assert.equal(r.formatBody(' 42 ', [['content-type', 'application/json']]), '42');
});

test('formatSize escolhe B, KB ou MB', () => {
  assert.equal(r.formatSize(0), '0 B');
  assert.equal(r.formatSize(1023), '1023 B');
  assert.equal(r.formatSize(1024), '1.0 KB');
  assert.equal(r.formatSize(1536), '1.5 KB');
  assert.equal(r.formatSize(1024 * 1024), '1.00 MB');
  assert.equal(r.formatSize(5.5 * 1024 * 1024), '5.50 MB');
  assert.equal(r.formatSize(3 * 1024 * 1024 * 1024), '3072.00 MB');
});
