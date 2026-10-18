// Mais casos da lógica da tela de Requests (src/lib/requestTools.ts): bordas, entradas inválidas
// e funções que tests/requests.test.mjs não cobre. Rodar com `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as r from '../src/lib/requestTools.ts';

const okResult = (over = {}) => ({ ok: true, status: 200, statusText: 'OK', headers: [], size: 0, time: 10, truncated: false, body: '', ...over });
const target = (over = {}) => ({ status: 200, statusText: 'OK', headers: [], body: '', time: 10, ...over });
const assertOn = (value, res, name = 'res.body') => r.evaluateAssertion({ name, value, enabled: true }, res);

// ---------------------------------------------------------------------------------------------
// shellWords

test('shellWords separa por qualquer espaço em branco e ignora espaços repetidos', () => {
  assert.deepEqual(r.shellWords('  curl \t -s   x  '), ['curl', '-s', 'x']);
  assert.deepEqual(r.shellWords(''), []);
  assert.deepEqual(r.shellWords('   '), []);
});

test('shellWords junta pedaços com e sem aspas na mesma palavra', () => {
  assert.deepEqual(r.shellWords(`a'b c'"d e"f`), ['ab cd ef']);
});

test('shellWords: aspas simples não interpretam barra invertida', () => {
  assert.deepEqual(r.shellWords(String.raw`'a\nb'`), [String.raw`a\nb`]);
});

test('shellWords: em aspas duplas só \\ " $ ` são escapáveis', () => {
  assert.deepEqual(r.shellWords(String.raw`"a\$b \n \\ \`"`), [String.raw`a$b \n \ ` + '`']);
});

test('shellWords: barra invertida fora de aspas escapa o próximo caractere', () => {
  assert.deepEqual(r.shellWords(String.raw`a\ b c\"d`), ['a b', 'c"d']);
});

test('shellWords: continuação de linha do cmd (^) e do bash (\\) com CRLF', () => {
  assert.deepEqual(r.shellWords('curl ^\r\n -s ^\n x \\\r\n y'), ['curl', '-s', 'x', 'y']);
});

test("shellWords: $'...' entende \\t, \\r, \\' e \\\\", () => {
  assert.deepEqual(r.shellWords(String.raw`$'a\tb\rc\'d\\e'`), ["a\tb\rc'd\\e"]);
  assert.deepEqual(r.shellWords(`$''`), ['']);
});

test('shellWords lança erro com aspas duplas abertas', () => {
  assert.throws(() => r.shellWords('curl "aberto'), /unterminated-quote/);
});

// ---------------------------------------------------------------------------------------------
// looksLikeCurl

test('looksLikeCurl reconhece curl e curl.exe com espaço depois', () => {
  assert.equal(r.looksLikeCurl('curl https://x'), true);
  assert.equal(r.looksLikeCurl('  CURL.EXE -s x'), true);
  assert.equal(r.looksLikeCurl('curl\nx'), true);
});

test('looksLikeCurl recusa o que não é um comando curl', () => {
  assert.equal(r.looksLikeCurl('curl'), false);
  assert.equal(r.looksLikeCurl('curlx https://x'), false);
  assert.equal(r.looksLikeCurl('wget https://x'), false);
  assert.equal(r.looksLikeCurl('https://x curl '), false);
  assert.equal(r.looksLikeCurl(''), false);
});

// ---------------------------------------------------------------------------------------------
// parseCurl

test('parseCurl de GET simples', () => {
  assert.deepEqual(r.parseCurl('curl https://x.com'), { method: 'GET', url: 'https://x.com', headers: [], bodyMode: 'none', body: {}, authMode: 'none', auth: {} });
});

test('parseCurl aceita curl.exe e --request=PUT', () => {
  const out = r.parseCurl('curl.exe --request=put https://x.com');
  assert.equal(out.method, 'PUT');
});

test('parseCurl: -I vira HEAD', () => {
  assert.equal(r.parseCurl('curl -I https://x.com').method, 'HEAD');
  assert.equal(r.parseCurl('curl --head https://x.com').method, 'HEAD');
});

test('parseCurl: só a primeira URL posicional conta', () => {
  assert.equal(r.parseCurl('curl https://a.com https://b.com').url, 'https://a.com');
});

test('parseCurl: --url sobrescreve a URL posicional', () => {
  assert.equal(r.parseCurl('curl https://a.com --url https://b.com').url, 'https://b.com');
});

test('parseCurl lança erro sem URL, com texto vazio ou que não é curl', () => {
  assert.throws(() => r.parseCurl('curl -s'), /no-url/);
  assert.throws(() => r.parseCurl(''), /not-curl/);
  assert.throws(() => r.parseCurl('   '), /not-curl/);
  assert.throws(() => r.parseCurl('curlx https://x'), /not-curl/);
});

test('parseCurl ignora headers sem dois-pontos ou sem nome', () => {
  const out = r.parseCurl(`curl x.com -H 'Sem' -H ': vazio' -H 'A:b'`);
  assert.deepEqual(out.headers, [{ name: 'A', value: 'b', enabled: true }]);
});

test('parseCurl: -A, -b e -e viram headers', () => {
  const out = r.parseCurl(`curl x.com -A 'Bot/1' -b 'sid=1' -e https://ref`);
  assert.deepEqual(out.headers.map((h) => [h.name, h.value]), [['User-Agent', 'Bot/1'], ['Cookie', 'sid=1'], ['Referer', 'https://ref']]);
});

test('parseCurl pula o valor das opções que não mudam a request', () => {
  const out = r.parseCurl('curl -o saida.txt -m 30 -x http://proxy:8080 -w "%{http_code}" https://x.com');
  assert.equal(out.url, 'https://x.com');
  assert.deepEqual(out.headers, []);
});

test('parseCurl não toma o valor de uma opção desconhecida como URL', { todo: 'BUG: requestTools.ts:103-104 trata o valor de opções fora de VALUE_FLAGS (ex.: --max-redirs 5) como a URL' }, () => {
  assert.equal(r.parseCurl('curl --max-redirs 5 https://x.com').url, 'https://x.com');
});

test('parseCurl: vários -d são juntados com &', () => {
  const out = r.parseCurl('curl x.com -d a=1 -d b=2');
  assert.deepEqual(out.body.formUrlEncoded.map((p) => [p.name, p.value]), [['a', '1'], ['b', '2']]);
});

test('parseCurl: corpo começando com < sem Content-Type vira XML', () => {
  const out = r.parseCurl(`curl x.com -d '<a>1</a>'`);
  assert.equal(out.bodyMode, 'xml');
  assert.equal(out.body.xml, '<a>1</a>');
});

test('parseCurl: Content-Type XML força modo XML', () => {
  const out = r.parseCurl(`curl x.com -H 'Content-Type: text/xml' -d 'abc'`);
  assert.equal(out.bodyMode, 'xml');
});

test('parseCurl: corpo livre sem Content-Type vira texto', () => {
  const out = r.parseCurl(`curl x.com --data-binary 'ola mundo'`);
  assert.equal(out.bodyMode, 'text');
  assert.equal(out.body.text, 'ola mundo');
  assert.equal(out.method, 'POST');
});

test('parseCurl: Content-Type JSON vence o formato do corpo', () => {
  const out = r.parseCurl(`curl x.com -H 'Content-Type: application/json' -d 'a=1'`);
  assert.equal(out.bodyMode, 'json');
  assert.equal(out.body.json, 'a=1');
});

test('parseCurl: Content-Type de formulário sai da tabela de headers', () => {
  const out = r.parseCurl(`curl x.com -H 'Content-Type: application/x-www-form-urlencoded' -H 'X: 1' -d 'a=1'`);
  assert.equal(out.bodyMode, 'formUrlEncoded');
  assert.deepEqual(out.headers.map((h) => h.name), ['X']);
});

test('parseCurl decodifica + e %XX do formulário e tolera % inválido', () => {
  const out = r.parseCurl(`curl x.com -d 'nome=Ana+Maria&p=100%'`);
  assert.deepEqual(out.body.formUrlEncoded.map((p) => [p.name, p.value]), [['nome', 'Ana Maria'], ['p', '100%']]);
});

test('parseCurl: --data-urlencode codifica o valor antes de montar o formulário', { todo: 'BUG: requestTools.ts:68/112 trata --data-urlencode como -d; "msg=a&b" vira texto em vez de um campo msg="a&b"' }, () => {
  const out = r.parseCurl(`curl https://x.com --data-urlencode 'msg=a&b'`);
  assert.equal(out.bodyMode, 'formUrlEncoded');
  assert.deepEqual(out.body.formUrlEncoded.map((p) => [p.name, p.value]), [['msg', 'a&b']]);
});

test('parseCurl: -G junta os dados numa query que já existe', () => {
  const out = r.parseCurl('curl -G "https://x.com/a?x=1" -d y=2 -d z=3');
  assert.equal(out.url, 'https://x.com/a?x=1&y=2&z=3');
  assert.equal(out.bodyMode, 'none');
  assert.equal(out.method, 'GET');
});

test('parseCurl: método explícito vence o POST implícito do -d', () => {
  assert.equal(r.parseCurl('curl -X PATCH x.com -d a=1').method, 'PATCH');
  assert.equal(r.parseCurl('curl -Xpatch x.com').method, 'PATCH');
});

test('parseCurl: --json não duplica Content-Type e Accept já informados', () => {
  const out = r.parseCurl(`curl x.com -H 'content-type: application/vnd+json' -H 'accept: */*' --json '{}'`);
  assert.deepEqual(out.headers.map((h) => [h.name, h.value]), [['content-type', 'application/vnd+json'], ['accept', '*/*']]);
  assert.equal(out.bodyMode, 'json');
  assert.equal(out.method, 'POST');
});

test('parseCurl: -u sem senha e -u colado', () => {
  assert.deepEqual(r.parseCurl('curl -u ana x.com').auth.basic, { username: 'ana', password: '' });
  assert.deepEqual(r.parseCurl('curl -uana:a:b x.com').auth.basic, { username: 'ana', password: 'a:b' });
});

test('parseCurl: -u tem prioridade e o Authorization Bearer fica nos headers', () => {
  const out = r.parseCurl(`curl -u a:b -H 'Authorization: Bearer t' x.com`);
  assert.equal(out.authMode, 'basic');
  assert.deepEqual(out.headers.map((h) => h.name), ['Authorization']);
});

test('parseCurl: Authorization que não é Bearer fica como header', () => {
  const out = r.parseCurl(`curl -H 'Authorization: Token abc' x.com`);
  assert.equal(out.authMode, 'none');
  assert.equal(out.headers[0].value, 'Token abc');
});

test('parseCurl: bearer sem diferenciar maiúsculas', () => {
  const out = r.parseCurl(`curl -H 'authorization: BEARER xyz' x.com`);
  assert.equal(out.authMode, 'bearer');
  assert.equal(out.auth.bearer.token, 'xyz');
  assert.deepEqual(out.headers, []);
});

test('parseCurl aceita comando multilinha do Windows (^)', () => {
  const out = r.parseCurl('curl ^\r\n  -X POST ^\r\n  "https://x.com" ^\r\n  -H "A: 1"');
  assert.equal(out.method, 'POST');
  assert.equal(out.url, 'https://x.com');
  assert.equal(out.headers.length, 1);
});

// ---------------------------------------------------------------------------------------------
// applyCurl

test('applyCurl troca headers, mescla corpo e auth, e baixa o método', () => {
  const base = {
    meta: { name: 'X', type: 'http', seq: 3 },
    http: { method: 'get', url: '/velha', body: 'none', auth: 'none' },
    headers: [{ name: 'Velho', value: '1', enabled: true }],
    body: { text: 'antigo' },
    auth: { basic: { username: 'u', password: 'p' } },
  };
  const next = r.applyCurl(base, r.parseCurl(`curl -X POST https://x.com/n -H 'Authorization: Bearer t' -d '{"a":1}'`));
  assert.deepEqual(next.meta, base.meta);
  assert.deepEqual(next.http, { method: 'post', url: 'https://x.com/n', body: 'json', auth: 'bearer' });
  assert.deepEqual(next.headers, []);
  assert.deepEqual(next.body, { text: 'antigo', json: '{"a":1}' });
  assert.deepEqual(next.auth, { basic: { username: 'u', password: 'p' }, bearer: { token: 't' } });
  assert.deepEqual(next.params, []);
  assert.equal(base.http.url, '/velha', 'original intacto');
});

test('applyCurl ignora o fragmento ao montar os params', () => {
  const next = r.applyCurl({ meta: { name: 'X', type: 'http' }, http: { method: 'get', url: '' } }, r.parseCurl(`curl 'https://x.com/a?b=1&&c=2#topo'`));
  assert.deepEqual(next.params, [
    { name: 'b', value: '1', enabled: true, type: 'query' },
    { name: 'c', value: '2', enabled: true, type: 'query' },
  ]);
});

// ---------------------------------------------------------------------------------------------
// toSnippet

const outgoing = (over = {}) => ({ id: '1', method: 'GET', url: 'https://x.com/a', headers: [], body: undefined, ...over });

test('SNIPPET_LANGUAGES lista as quatro linguagens', () => {
  assert.deepEqual(r.SNIPPET_LANGUAGES, ['curl', 'fetch', 'python', 'http']);
});

test('toSnippet curl: URL simples sem aspas e método omitido no GET', () => {
  assert.equal(r.toSnippet(outgoing(), 'curl'), 'curl https://x.com/a');
});

test('toSnippet curl: GET e HEAD não levam corpo; corpo vazio também não', () => {
  assert.doesNotMatch(r.toSnippet(outgoing({ body: 'x' }), 'curl'), /--data-raw/);
  assert.doesNotMatch(r.toSnippet(outgoing({ method: 'HEAD', body: 'x' }), 'curl'), /--data-raw/);
  assert.doesNotMatch(r.toSnippet(outgoing({ method: 'POST', body: '' }), 'curl'), /--data-raw/);
});

test('toSnippet curl: quebra linhas com barra e escapa aspas simples', () => {
  const out = r.toSnippet(outgoing({ method: 'PUT', headers: [['A', "d'x"]], body: "it's" }), 'curl');
  assert.equal(out, `curl -X PUT https://x.com/a \\\n  -H 'A: d'\\''x' \\\n  --data-raw 'it'\\''s'`);
  assert.deepEqual(r.shellWords(out), ['curl', '-X', 'PUT', 'https://x.com/a', '-H', "A: d'x", '--data-raw', "it's"]);
});

test('toSnippet fetch sem headers nem corpo', () => {
  assert.equal(r.toSnippet(outgoing(), 'fetch'), 'const response = await fetch("https://x.com/a", {\n  method: "GET",\n});\nconsole.log(response.status, await response.text());');
});

test('toSnippet fetch escapa strings como JS', () => {
  const out = r.toSnippet(outgoing({ method: 'POST', headers: [['X', 'a"b']], body: 'l1\nl2' }), 'fetch');
  assert.match(out, /"X": "a\\"b",/);
  assert.match(out, /body: "l1\\nl2",/);
});

test('toSnippet python sem headers nem corpo', () => {
  assert.equal(r.toSnippet(outgoing(), 'python'), 'import requests\n\n\nresponse = requests.request("GET", "https://x.com/a")\nprint(response.status_code, response.text)');
});

test('toSnippet python com corpo e sem headers', () => {
  const out = r.toSnippet(outgoing({ method: 'POST', body: 'oi' }), 'python');
  assert.match(out, /data = "oi"/);
  assert.match(out, /requests\.request\("POST", "https:\/\/x\.com\/a", data=data\.encode\("utf-8"\)\)/);
  assert.doesNotMatch(out, /headers/);
});

test('toSnippet http com porta, query e corpo', () => {
  const out = r.toSnippet(outgoing({ method: 'POST', url: 'http://h:8080/p/q?x=1', headers: [['A', 'b']], body: '{}' }), 'http');
  assert.equal(out, 'POST /p/q?x=1 HTTP/1.1\nHost: h:8080\nA: b\n\n{}');
});

test('toSnippet http com URL inválida cai numa linha só', () => {
  assert.equal(r.toSnippet(outgoing({ url: '/relativa' }), 'http'), 'GET /relativa HTTP/1.1');
});

test('toSnippet http sem caminho usa "/"', () => {
  assert.equal(r.toSnippet(outgoing({ url: 'https://x.com' }), 'http'), 'GET / HTTP/1.1\nHost: x.com');
});

// ---------------------------------------------------------------------------------------------
// Path params

test('pathParamNames não repete nomes e ignora :porta e :nome no meio do segmento', () => {
  assert.deepEqual(r.pathParamNames('http://h:8080/a/:id/b/:id/:x-y'), ['id', 'x-y']);
  assert.deepEqual(r.pathParamNames('/a/foo:bar/:1x/:ok.json'), []);
  assert.deepEqual(r.pathParamNames(''), []);
});

test('pathParamNames ignora o fragmento', () => {
  assert.deepEqual(r.pathParamNames('/a/:id#/:nao'), ['id']);
});

test('syncPathParams sem URL de params remove os path params e mantém os outros', () => {
  const params = [
    { name: 'id', value: '1', enabled: true, type: 'path' },
    { name: 'q', value: '2', enabled: true, type: 'query' },
  ];
  assert.deepEqual(r.syncPathParams('/a', params), [params[1]]);
});

test('syncPathParams mantém valores digitados e segue a ordem da URL', () => {
  const params = [
    { name: 'b', value: '2', enabled: true, type: 'path' },
    { name: 'a', value: '1', enabled: false, type: 'path' },
  ];
  const next = r.syncPathParams('/x/:a/:b/:c', params);
  assert.deepEqual(next.map((p) => [p.name, p.value, p.enabled]), [['a', '1', false], ['b', '2', true], ['c', '', true]]);
  assert.equal(next[0], params[1], 'linha antiga reaproveitada');
});

test('syncPathParams sem params e sem :nomes devolve a lista vazia original', () => {
  const empty = [];
  assert.equal(r.syncPathParams('/a', empty), empty);
  assert.deepEqual(r.syncPathParams('/a'), []);
});

test('applyPathParams ignora params desativados e de outro tipo', () => {
  const params = [
    { name: 'id', value: '1', enabled: false, type: 'path' },
    { name: 'id', value: '2', enabled: true, type: 'query' },
  ];
  assert.equal(r.applyPathParams('/u/:id', params), '/u/:id');
});

test('applyPathParams codifica / e ? do valor e não toca a query', () => {
  const params = [{ name: 'id', value: 'a/b?c', enabled: true, type: 'path' }];
  assert.equal(r.applyPathParams('https://x.com/u/:id?id=:id', params), 'https://x.com/u/a%2Fb%3Fc?id=:id');
});

test('applyPathParams troca todas as ocorrências e deixa as sem valor', () => {
  const params = [{ name: 'a', value: '1', enabled: true, type: 'path' }];
  assert.equal(r.applyPathParams('/:a/:b/:a', params), '/1/:b/1');
});

test('applyPathParams funciona com {{baseUrl}} na frente', () => {
  const params = [{ name: 'id', value: '9', enabled: true, type: 'path' }];
  assert.equal(r.applyPathParams('{{baseUrl}}/users/:id', params), '{{baseUrl}}/users/9');
});

// ---------------------------------------------------------------------------------------------
// Edição em massa

test('pairsToText pula linhas totalmente vazias', () => {
  assert.equal(r.pairsToText([{ name: '', value: '', enabled: true }, { name: 'a', value: '', enabled: true }]), 'a: ');
  assert.equal(r.pairsToText([]), '');
});

test('textToPairs aceita CRLF, "//" com espaço e linhas que só têm "//"', () => {
  assert.deepEqual(r.textToPairs('a: 1\r\n//  b: 2\r\n//\r\n: sem nome'), [
    { name: 'a', value: '1', enabled: true },
    { name: 'b', value: '2', enabled: false },
  ]);
});

test('textToPairs mantém URLs no valor', () => {
  assert.deepEqual(r.textToPairs('Referer: https://x.com:8080/a'), [{ name: 'Referer', value: 'https://x.com:8080/a', enabled: true }]);
});

test('textToPairs: o que vem no texto vence os campos extras', () => {
  assert.deepEqual(r.textToPairs('//a: 1', { enabled: true, name: 'x', type: 'path' }), [{ type: 'path', name: 'a', value: '1', enabled: false }]);
});

// ---------------------------------------------------------------------------------------------
// JSON path

test('parseJsonPath devolve os tokens de cada forma', () => {
  assert.deepEqual(r.parseJsonPath('$.a[0]["b c"][*].d.*'), [{ key: 'a' }, { index: 0 }, { key: 'b c' }, { all: true }, { key: 'd' }, { all: true }]);
  assert.deepEqual(r.parseJsonPath("[ 'x' ][ -2 ]"), [{ key: 'x' }, { index: -2 }]);
  assert.deepEqual(r.parseJsonPath('res.body.a'), [{ key: 'a' }]);
  assert.deepEqual(r.parseJsonPath('  '), []);
  assert.deepEqual(r.parseJsonPath('$'), []);
});

test('parseJsonPath lança erro em caminhos mal formados', () => {
  assert.throws(() => r.parseJsonPath('a]'), /invalid-path/);
  assert.throws(() => r.parseJsonPath('a..b'), /invalid-path/);
  assert.throws(() => r.parseJsonPath('a[1'), /invalid-path/);
});

test('queryJson com curinga em objeto pega os valores', () => {
  assert.deepEqual(r.queryJson({ a: { x: 1, y: 2 } }, 'a.*'), [1, 2]);
  assert.deepEqual(r.queryJson({ a: 1 }, 'a[*]'), []);
});

test('queryJson com curingas encadeados achata a lista', () => {
  const data = { g: [{ u: [{ id: 1 }, { id: 2 }] }, { u: [{ id: 3 }] }] };
  assert.deepEqual(r.queryJson(data, 'g[*].u[*].id'), [1, 2, 3]);
  assert.deepEqual(r.queryJson(data, 'g[*].u.length'), [2, 1]);
});

test('queryJson: length de string e chave "length" de objeto', () => {
  assert.equal(r.queryJson({ s: 'abcd' }, 's.length'), 4);
  assert.equal(r.queryJson({ o: { length: 'própria' } }, 'o.length'), 'própria');
  assert.equal(r.queryJson({ o: {} }, 'o.length'), undefined);
});

test('queryJson não segue propriedades herdadas', () => {
  assert.equal(r.queryJson({}, 'constructor'), undefined);
  assert.equal(r.queryJson({ a: [] }, 'a.push'), undefined);
});

test('queryJson: índice negativo fora da lista e índice em não-lista', () => {
  assert.equal(r.queryJson([1, 2], '[-3]'), undefined);
  assert.equal(r.queryJson({ 0: 'x' }, '[0]'), undefined);
  assert.equal(r.queryJson(null, 'a'), undefined);
  assert.equal(r.queryJson('texto', 'a'), undefined);
});

test('queryJson mantém valores falsos encontrados', () => {
  assert.equal(r.queryJson({ a: 0 }, 'a'), 0);
  assert.equal(r.queryJson({ a: null }, 'a'), null);
  assert.equal(r.queryJson({ a: false }, 'a'), false);
});

// ---------------------------------------------------------------------------------------------
// Busca na resposta

test('MAX_MATCHES vale 1000 e findMatches para nele', () => {
  assert.equal(r.MAX_MATCHES, 1000);
  assert.equal(r.findMatches('a'.repeat(5000), 'a').length, 1000);
});

test('findMatches não conta sobreposições', () => {
  assert.deepEqual(r.findMatches('aaaa', 'aa'), [0, 2]);
  assert.deepEqual(r.findMatches('abc', 'z'), []);
  assert.deepEqual(r.findMatches('', 'a'), []);
});

test('highlightSegments sem termo ou sem achado devolve o texto inteiro', () => {
  assert.deepEqual(r.highlightSegments('abc', ''), [{ text: 'abc', match: false }]);
  assert.deepEqual(r.highlightSegments('abc', 'z'), [{ text: 'abc', match: false }]);
});

test('highlightSegments com achados nas pontas e colados', () => {
  assert.deepEqual(r.highlightSegments('abab', 'ab'), [
    { text: 'ab', match: true },
    { text: 'ab', match: true },
  ]);
  assert.deepEqual(r.highlightSegments('Xa', 'x'), [
    { text: 'X', match: true },
    { text: 'a', match: false },
  ]);
});

test('highlightSegments acerta a posição quando toLowerCase muda o tamanho do texto', { todo: 'BUG: requestTools.ts:386-401 usa posições do texto em minúsculas no texto original; "İ" vira 2 caracteres e desloca o destaque' }, () => {
  assert.deepEqual(r.highlightSegments('İx', 'x'), [
    { text: 'İ', match: false },
    { text: 'x', match: true },
  ]);
});

// ---------------------------------------------------------------------------------------------
// Cookies

test('parseSetCookies: domínio, expires com vírgula e atributos em qualquer caixa', () => {
  const [cookie] = r.parseSetCookies([['SET-COOKIE', 'a=1; domain=.x.com; EXPIRES=Wed, 21 Oct 2026 07:28:00 GMT; samesite=None; SECURE']]);
  assert.deepEqual(cookie, { name: 'a', value: '1', domain: '.x.com', expires: 'Wed, 21 Oct 2026 07:28:00 GMT', sameSite: 'None', secure: true, httpOnly: false });
});

test('parseSetCookies: cookie sem "=" vira nome sem valor; sem nome é descartado', () => {
  const cookies = r.parseSetCookies([['set-cookie', 'flag'], ['set-cookie', '=semnome'], ['set-cookie', ''], ['set-cookie', 'v=']]);
  assert.deepEqual(cookies.map((c) => [c.name, c.value]), [['flag', ''], ['v', '']]);
});

test('parseSetCookies ignora atributos desconhecidos e sem headers devolve vazio', () => {
  const [cookie] = r.parseSetCookies([['set-cookie', 'a=1; Partitioned; Priority=High']]);
  assert.deepEqual(cookie, { name: 'a', value: '1', httpOnly: false, secure: false });
  assert.deepEqual(r.parseSetCookies([]), []);
});

// ---------------------------------------------------------------------------------------------
// Asserções: alvo e valor esperado

test('resolveAssertTarget lê status, statusText e tempo', () => {
  const res = target({ status: 204, statusText: 'No Content', time: 77 });
  assert.equal(r.resolveAssertTarget('res.status', res), 204);
  assert.equal(r.resolveAssertTarget(' res.statusText ', res), 'No Content');
  assert.equal(r.resolveAssertTarget('res.responseTime', res), 77);
});

test('resolveAssertTarget lê headers sem diferenciar maiúsculas e junta repetidos', () => {
  const res = target({ headers: [['Set-Cookie', 'a=1'], ['set-cookie', 'b=2'], ['X-Id', '9']] });
  assert.equal(r.resolveAssertTarget('res.headers.set-cookie', res), 'a=1, b=2');
  assert.equal(r.resolveAssertTarget('res.headers["X-ID"]', res), '9');
  assert.equal(r.resolveAssertTarget("res.headers['x-id']", res), '9');
  assert.equal(r.resolveAssertTarget('res.headers[x-id]', res), '9');
  assert.equal(r.resolveAssertTarget('res.headers.nao', res), undefined);
});

test('resolveAssertTarget lê o corpo como JSON ou texto', () => {
  assert.deepEqual(r.resolveAssertTarget('res.body', target({ body: '{"a":[1]}' })), { a: [1] });
  assert.equal(r.resolveAssertTarget('res.body', target({ body: 'texto' })), 'texto');
  assert.equal(r.resolveAssertTarget('res.body.a[0]', target({ body: '{"a":[1]}' })), 1);
  assert.equal(r.resolveAssertTarget('res.body[0]', target({ body: '[5]' })), 5);
});

test('resolveAssertTarget usa o corpo já lido quando recebido', () => {
  assert.equal(r.resolveAssertTarget('res.body.x', target({ body: 'ignorado' }), { x: 'pronto' }), 'pronto');
});

test('resolveAssertTarget lança erro em alvo desconhecido', () => {
  assert.throws(() => r.resolveAssertTarget('res.cookies', target()), /unknown-target/);
  assert.throws(() => r.resolveAssertTarget('', target()), /unknown-target/);
  assert.throws(() => r.resolveAssertTarget('res.headers', target()), /unknown-target/);
});

test('parseExpected entende JSON e cai para texto', () => {
  assert.equal(r.parseExpected(' 42 '), 42);
  assert.equal(r.parseExpected('true'), true);
  assert.equal(r.parseExpected('null'), null);
  assert.equal(r.parseExpected('"a b"'), 'a b');
  assert.deepEqual(r.parseExpected('[1,"x"]'), [1, 'x']);
  assert.deepEqual(r.parseExpected('{"a":1}'), { a: 1 });
  assert.equal(r.parseExpected("'aspas simples'"), 'aspas simples');
  assert.equal(r.parseExpected('texto livre'), 'texto livre');
  assert.equal(r.parseExpected('007'), '007');
  assert.equal(r.parseExpected('   '), '');
});

test('ASSERT_OPERATORS traz os operadores do Bruno', () => {
  assert.equal(r.ASSERT_OPERATORS.length, 28);
  for (const op of ['eq', 'neq', 'between', 'isJson', 'notMatches']) assert.ok(r.ASSERT_OPERATORS.includes(op), op);
});

// ---------------------------------------------------------------------------------------------
// Asserções: operadores

test('evaluateAssertion devolve nome, operador, esperado e valor real', () => {
  assert.deepEqual(assertOn('eq 200', target(), 'res.status'), { name: 'res.status', operator: 'eq', expected: '200', actual: 200, pass: true });
});

test('evaluateAssertion: texto que não é operador vale eq com o texto inteiro', () => {
  const out = assertOn('No Content', target({ statusText: 'No Content' }), 'res.statusText');
  assert.equal(out.operator, 'eq');
  assert.equal(out.expected, 'No Content');
  assert.equal(out.pass, true);
});

test('evaluateAssertion: eq compara número com texto e objetos por JSON', () => {
  assert.equal(assertOn('eq "200"', target(), 'res.status').pass, true);
  assert.equal(assertOn('eq {"a":1}', target({ body: '{"a":1}' })).pass, true);
  assert.equal(assertOn('eq [1,2]', target({ body: '[1,2]' })).pass, true);
  assert.equal(assertOn('eq [2,1]', target({ body: '[1,2]' })).pass, false);
  assert.equal(assertOn('eq null', target({ body: '{"a":null}' }), 'res.body.a').pass, true);
});

test('evaluateAssertion: comparações numéricas', () => {
  const res = target({ body: '{"n":5,"s":"7"}' });
  assert.equal(assertOn('gt 4', res, 'res.body.n').pass, true);
  assert.equal(assertOn('gt 5', res, 'res.body.n').pass, false);
  assert.equal(assertOn('gte 5', res, 'res.body.n').pass, true);
  assert.equal(assertOn('lt 6', res, 'res.body.n').pass, true);
  assert.equal(assertOn('lte 4', res, 'res.body.n').pass, false);
  assert.equal(assertOn('gt 6', res, 'res.body.s').pass, true, 'texto numérico vira número');
  assert.equal(assertOn('gt 1', res, 'res.body.nao').pass, false, 'undefined vira NaN');
});

test('evaluateAssertion: in e notIn com lista separada por vírgula', () => {
  const res = target({ body: '{"s":"b"}' });
  assert.equal(assertOn('in a, b, c', res, 'res.body.s').pass, true);
  assert.equal(assertOn('in "a", "c"', res, 'res.body.s').pass, false);
  assert.equal(assertOn('notIn a, c', res, 'res.body.s').pass, true);
  assert.equal(assertOn('notIn b', res, 'res.body.s').pass, false);
});

test('evaluateAssertion: contains e notContains em texto e em lista', () => {
  const res = target({ body: '{"t":"olá mundo","l":[1,{"a":2}]}' });
  assert.equal(assertOn('contains mundo', res, 'res.body.t').pass, true);
  assert.equal(assertOn('notContains xyz', res, 'res.body.t').pass, true);
  assert.equal(assertOn('contains 1', res, 'res.body.l').pass, true);
  assert.equal(assertOn('contains {"a":2}', res, 'res.body.l').pass, true);
  assert.equal(assertOn('notContains 3', res, 'res.body.l').pass, true);
  assert.equal(assertOn('contains x', res, 'res.body.nao').pass, false, 'undefined vira texto vazio');
});

test('evaluateAssertion: length em lista, texto e outros tipos', () => {
  const res = target({ body: '{"l":[1,2,3],"t":"ab","n":5}' });
  assert.equal(assertOn('length 3', res, 'res.body.l').pass, true);
  assert.equal(assertOn('length 2', res, 'res.body.t').pass, true);
  assert.equal(assertOn('length 1', res, 'res.body.n').pass, false);
});

test('evaluateAssertion: matches usa o texto cru como regex', () => {
  const res = target({ body: '{"e":"ana@x.com"}' });
  assert.equal(assertOn('matches ^[a-z]+@x\\.com$', res, 'res.body.e').pass, true);
  assert.equal(assertOn('notMatches ^b', res, 'res.body.e').pass, true);
  const bad = assertOn('notMatches (', res, 'res.body.e');
  assert.equal(bad.pass, false);
  assert.equal(bad.error, 'expected');
  assert.equal(bad.actual, 'ana@x.com');
});

test('evaluateAssertion: startsWith e endsWith', () => {
  const res = target({ body: '{"u":"https://x.com"}' });
  assert.equal(assertOn('startsWith https://', res, 'res.body.u').pass, true);
  assert.equal(assertOn('endsWith .com', res, 'res.body.u').pass, true);
  assert.equal(assertOn('endsWith .br', res, 'res.body.u').pass, false);
});

test('evaluateAssertion: between inclui as pontas e falha com um valor só', () => {
  assert.equal(assertOn('between 200, 200', target(), 'res.status').pass, true);
  assert.equal(assertOn('between 201, 299', target(), 'res.status').pass, false);
  assert.equal(assertOn('between 100', target(), 'res.status').pass, false);
});

test('evaluateAssertion: operadores unários limpam o esperado', () => {
  const res = target({ body: '{"o":{},"z":0,"s":"x","b":false,"n":1.5}' });
  const unary = (op, name) => assertOn(op, res, name);
  assert.equal(unary('isEmpty', 'res.body.o').pass, true);
  assert.equal(unary('isNotEmpty', 'res.body.s').pass, true);
  assert.equal(unary('isEmpty', 'res.body.z').pass, false, 'zero não é vazio');
  assert.equal(unary('isUndefined', 'res.body.nao').pass, true);
  assert.equal(unary('isDefined', 'res.body.z').pass, true);
  assert.equal(unary('isTruthy', 'res.body.s').pass, true);
  assert.equal(unary('isFalsy', 'res.body.b').pass, true);
  assert.equal(unary('isJson', 'res.body.o').pass, true);
  assert.equal(unary('isJson', 'res.body.s').pass, false);
  assert.equal(unary('isNumber', 'res.body.n').pass, true);
  assert.equal(unary('isString', 'res.body.s').pass, true);
  assert.equal(unary('isBoolean', 'res.body.b').pass, true);
  assert.equal(unary('isArray', 'res.body.o').pass, false);
  assert.equal(unary('isNull', 'res.body.nao').pass, false, 'undefined não é null');
  assert.equal(assertOn('isTruthy sobra', res, 'res.body.s').expected, '');
});

test('evaluateAssertion: isJson aceita o corpo inteiro em JSON e recusa texto', () => {
  assert.equal(assertOn('isJson', target({ body: '[]' })).pass, true);
  assert.equal(assertOn('isJson', target({ body: 'oi' })).pass, false);
});

test('evaluateAssertion com alvo inválido devolve erro de alvo', () => {
  assert.deepEqual(assertOn('eq 1', target(), 'req.url'), { name: 'req.url', operator: 'eq', expected: '1', actual: undefined, pass: false, error: 'target' });
});

test('evaluateAssertion com caminho JSON mal formado devolve erro de alvo', () => {
  assert.equal(assertOn('eq 1', target({ body: '{}' }), 'res.body.a..b').error, 'target');
});

test('evaluateAssertions ignora as sem nome e as desativadas', () => {
  const list = [
    { name: '  ', value: 'eq 1', enabled: true },
    { name: 'res.status', value: 'eq 200', enabled: false },
    { name: 'res.status', value: 'eq 200', enabled: true },
  ];
  const out = r.evaluateAssertions(list, okResult());
  assert.equal(out.length, 1);
  assert.equal(out[0].pass, true);
  assert.deepEqual(r.evaluateAssertions(undefined, okResult()), []);
  assert.deepEqual(r.evaluateAssertions([], { ok: false, error: 'x' }), []);
});

test('evaluateAssertions com request que falhou marca todas com erro de request', () => {
  const out = r.evaluateAssertions([{ name: 'res.status', value: 'eq 200', enabled: true }], { ok: false, error: 'timeout' });
  assert.deepEqual(out, [{ name: 'res.status', operator: '', expected: 'eq 200', actual: undefined, pass: false, error: 'request' }]);
});

// ---------------------------------------------------------------------------------------------
// formatJsonBody

test('formatJsonBody com indentação customizada', () => {
  assert.deepEqual(r.formatJsonBody('{"a":1}', 4), { ok: true, text: '{\n    "a": 1\n}' });
});

test('formatJsonBody devolve texto em branco como veio', () => {
  assert.deepEqual(r.formatJsonBody('\n  \n'), { ok: true, text: '\n  \n' });
});

test('formatJsonBody: variável sozinha, em lista e em chave', () => {
  assert.deepEqual(r.formatJsonBody('{{corpo}}'), { ok: true, text: '{{corpo}}' });
  assert.equal(r.formatJsonBody('[{{a}},{{ b }}]').text, '[\n  {{a}},\n  {{ b }}\n]');
  assert.equal(r.formatJsonBody('{"{{k}}": 1}').text, '{\n  "{{k}}": 1\n}');
});

test('formatJsonBody: aspas escapadas não confundem o que é string', () => {
  const out = r.formatJsonBody('{"a":"x\\"{{v}}","b":{{n}}}');
  assert.equal(out.ok, true);
  assert.equal(out.text, '{\n  "a": "x\\"{{v}}",\n  "b": {{n}}\n}');
});

test('formatJsonBody: chaves que não são variável seguem como JSON', () => {
  assert.equal(r.formatJsonBody('{"a":{"b":1}}').text, '{\n  "a": {\n    "b": 1\n  }\n}');
  assert.equal(r.formatJsonBody('{"a":{{}}}').ok, false);
});

test('formatJsonBody aponta coluna quando o erro tem posição', () => {
  const out = r.formatJsonBody('{"a": 1,}');
  assert.equal(out.ok, false);
  assert.equal(out.line, 1);
  assert.equal(out.column, 9);
});

test('formatJsonBody aponta a linha certa de um token inesperado no meio do texto', { todo: 'BUG: requestTools.ts:596-598 depende de "position N" na mensagem; o V8 não a inclui em "Unexpected token" e o erro cai na última linha' }, () => {
  const out = r.formatJsonBody('{\n  "a": ,\n  "b": 1\n}');
  assert.equal(out.ok, false);
  assert.equal(out.line, 2);
});

// ---------------------------------------------------------------------------------------------
// Filtros das listas

const reqItem = { name: 'Ação de Pagamento', url: 'https://api.x.com/pay', path: 'Requests/Financeiro/Pagar.bru', method: 'PUT' };

test('matchesRequestQuery ignora acentos e maiúsculas na busca e no texto', () => {
  assert.equal(r.matchesRequestQuery(reqItem, 'ACAO'), true);
  assert.equal(r.matchesRequestQuery(reqItem, 'açao pagamento'), true);
});

test('matchesRequestQuery procura na URL e na pasta', () => {
  assert.equal(r.matchesRequestQuery(reqItem, 'api.x'), true);
  assert.equal(r.matchesRequestQuery(reqItem, 'financeiro'), true);
});

test('matchesRequestQuery exige todas as palavras', () => {
  assert.equal(r.matchesRequestQuery(reqItem, 'pay inexistente'), false);
});

test('matchesRequestQuery: palavras de método filtram pelo método', () => {
  assert.equal(r.matchesRequestQuery(reqItem, 'put'), true);
  assert.equal(r.matchesRequestQuery(reqItem, 'DELETE'), false);
  assert.equal(r.matchesRequestQuery(reqItem, '   '), true);
});

test('STATUS_FILTERS e statusClass', () => {
  assert.deepEqual(r.STATUS_FILTERS, ['all', '2xx', '3xx', '4xx', '5xx', 'error']);
  assert.equal(r.statusClass({ ok: false, error: 'x' }), 'error');
  assert.equal(r.statusClass(okResult({ status: 101 })), '1xx');
  assert.equal(r.statusClass(okResult({ status: 200 })), '2xx');
  assert.equal(r.statusClass(okResult({ status: 299 })), '2xx');
  assert.equal(r.statusClass(okResult({ status: 304 })), '3xx');
  assert.equal(r.statusClass(okResult({ status: 499 })), '4xx');
  assert.equal(r.statusClass(okResult({ status: 503 })), '5xx');
  assert.equal(r.statusClass(okResult({ status: 0 })), '1xx');
});

test('filterHistory junta busca e status, sem buscar na pasta', () => {
  const entries = [
    { name: 'Listar', url: '/a', method: 'GET', path: 'Pasta/Secreta.bru', result: okResult({ status: 200 }) },
    { name: 'Criar', url: '/a', method: 'POST', result: okResult({ status: 500 }) },
    { name: 'Listar', url: '/b', method: 'GET', result: okResult({ status: 302 }) },
  ];
  assert.deepEqual(r.filterHistory(entries, 'listar', '2xx').map((e) => e.url), ['/a']);
  assert.deepEqual(r.filterHistory(entries, 'post', 'all').map((e) => e.name), ['Criar']);
  assert.deepEqual(r.filterHistory(entries, '', '3xx').map((e) => e.url), ['/b']);
  assert.deepEqual(r.filterHistory(entries, 'secreta', 'all'), []);
  assert.deepEqual(r.filterHistory([], 'x', 'all'), []);
});

// ---------------------------------------------------------------------------------------------
// Markdown

const docLabels = { params: 'Params', pathParams: 'Path', headers: 'Headers', body: 'Body', auth: 'Auth', name: 'Nome', value: 'Valor', file: 'Arquivo', assertions: 'Asserts' };

test('requestToMarkdown mínimo traz título, método/URL e link do arquivo', () => {
  const md = r.requestToMarkdown({ meta: { name: 'Ping', type: 'http' }, http: { method: 'get', url: '/ping' } }, 'R/Ping.bru', docLabels);
  assert.equal(md, '## Ping\n\n`GET` `/ping`\n\nArquivo: [[R/Ping.bru|Ping]]');
});

test('requestToMarkdown separa params de query e de path e inclui as anotações', () => {
  const request = {
    meta: { name: 'U', type: 'http' },
    http: { method: 'get', url: '/u/:id', auth: 'none' },
    docs: '  Busca um usuário.  ',
    params: [
      { name: 'q', value: 'a\nb', enabled: true, type: 'query' },
      { name: 'id', value: '1', enabled: true, type: 'path' },
      { name: 'off', value: '1', enabled: false, type: 'query' },
    ],
  };
  const md = r.requestToMarkdown(request, 'U.bru', docLabels);
  assert.match(md, /\n\nBusca um usuário\.\n\n/);
  assert.match(md, /\*\*Params\*\*\n\n\| Nome \| Valor \|\n\| --- \| --- \|\n\| q \| a b \|/);
  assert.match(md, /\*\*Path\*\*\n\n\| Nome \| Valor \|\n\| --- \| --- \|\n\| id \| 1 \|/);
  assert.doesNotMatch(md, /off|Auth/);
});

test('requestToMarkdown: corpo texto sem linguagem, XML com linguagem e corpo vazio omitido', () => {
  const base = { meta: { name: 'B', type: 'http' } };
  assert.match(r.requestToMarkdown({ ...base, http: { method: 'post', url: '/', body: 'text' }, body: { text: 'oi' } }, 'b', docLabels), /\*\*Body\*\*\n\n```\noi\n```/);
  assert.match(r.requestToMarkdown({ ...base, http: { method: 'post', url: '/', body: 'xml' }, body: { xml: '<a/>' } }, 'b', docLabels), /```xml\n<a\/>\n```/);
  assert.doesNotMatch(r.requestToMarkdown({ ...base, http: { method: 'post', url: '/', body: 'json' }, body: { json: '   ' } }, 'b', docLabels), /Body/);
});

test('requestToMarkdown com formulário vira tabela e auth aparece pelo modo', () => {
  const md = r.requestToMarkdown(
    { meta: { name: 'F', type: 'http' }, http: { method: 'post', url: '/', body: 'formUrlEncoded', auth: 'basic' }, body: { formUrlEncoded: [{ name: 'a', value: '1', enabled: true }] } },
    'f',
    docLabels,
  );
  assert.match(md, /\*\*Auth\*\*: basic/);
  assert.match(md, /\*\*Body\*\*\n\n\| Nome \| Valor \|\n\| --- \| --- \|\n\| a \| 1 \|/);
});

test('requestToMarkdown omite asserções desativadas', () => {
  const md = r.requestToMarkdown(
    { meta: { name: 'A', type: 'http' }, http: { method: 'get', url: '/' }, assertions: [{ name: 'res.status', value: 'eq 200', enabled: false }] },
    'a',
    docLabels,
  );
  assert.doesNotMatch(md, /Asserts/);
});

test('collectionToMarkdown junta seções com linha em branco e termina com quebra', () => {
  const one = (name) => ({ request: { meta: { name, type: 'http' }, http: { method: 'get', url: `/${name}` } }, path: `${name}.bru` });
  const md = r.collectionToMarkdown([one('A'), one('B')], docLabels);
  assert.match(md, /\[\[A\.bru\|A\]\]\n\n## B\n/);
  assert.ok(md.endsWith('[[B.bru|B]]\n'));
  assert.equal(r.collectionToMarkdown([], docLabels), '\n');
});

const resLabels = { status: 'Status', time: 'Tempo', size: 'Tamanho', headers: 'Headers', body: 'Corpo', sentAt: 'Enviada', name: 'Nome', value: 'Valor' };

test('responseToMarkdown sem headers e sem corpo fica só com o resumo', () => {
  const md = r.responseToMarkdown({ name: 'X', method: 'DELETE', url: 'http://x/1', at: '2026-10-18', size: '0 B', result: okResult({ status: 204, statusText: 'No Content', time: 3 }) }, resLabels);
  assert.equal(md, '`DELETE` `http://x/1`\n\n- Enviada: 2026-10-18\n- Status: 204 No Content\n- Tempo: 3 ms\n- Tamanho: 0 B\n\n');
});

test('responseToMarkdown: corpo texto sem linguagem e JSON quebrado vai como veio', () => {
  const plain = r.responseToMarkdown({ name: 'X', method: 'GET', url: 'u', at: 'h', size: '', result: okResult({ body: 'oi' }) }, resLabels);
  assert.match(plain, /## Corpo\n\n```\noi\n```\n$/);
  const broken = r.responseToMarkdown({ name: 'X', method: 'GET', url: 'u', at: 'h', size: '', result: okResult({ body: '{quebrado' }) }, resLabels);
  assert.match(broken, /```json\n\{quebrado\n```/);
});

test('responseToMarkdown escapa | nos headers e aumenta a cerca do corpo com crases', () => {
  const md = r.responseToMarkdown(
    { name: 'X', method: 'GET', url: 'u', at: 'h', size: '', result: okResult({ headers: [['X|Y', 'a|b']], body: 'tem ```` aqui' }) },
    resLabels,
  );
  assert.match(md, /\| X\\\|Y \| a\\\|b \|/);
  assert.match(md, /`````\ntem ```` aqui\n`````/);
});

// ---------------------------------------------------------------------------------------------
// Autocompletar e nomes

test('COMMON_HEADERS não tem repetidos e COMMON_HEADER_VALUES usa chaves minúsculas conhecidas', () => {
  assert.equal(new Set(r.COMMON_HEADERS.map((h) => h.toLowerCase())).size, r.COMMON_HEADERS.length);
  const known = new Set(r.COMMON_HEADERS.map((h) => h.toLowerCase()));
  for (const key of Object.keys(r.COMMON_HEADER_VALUES)) {
    assert.equal(key, key.toLowerCase());
    assert.ok(known.has(key), key);
  }
  assert.ok(r.COMMON_HEADER_VALUES['content-type'].includes('application/json'));
});

test('uniqueName devolve a base quando livre e aceita qualquer iterável', () => {
  assert.equal(r.uniqueName('Nova', []), 'Nova');
  assert.equal(r.uniqueName('Nova', new Set(['NOVA'])), 'Nova 2');
  assert.equal(r.uniqueName('Nova', ['Nova', 'Nova 3']), 'Nova 2');
  assert.equal(r.uniqueName('', ['']), ' 2');
});

test('safeFileName remove caracteres proibidos, controle e pontos finais', () => {
  assert.equal(r.safeFileName('a/b\\c:d*e?f"g<h>i|j#k^l[m]n'), 'abcdefghijklmn');
  assert.equal(r.safeFileName('a\u0000b\tc'), 'abc');
  assert.equal(r.safeFileName('nome...'), 'nome');
  assert.equal(r.safeFileName('nome. . '), 'nome');
  assert.equal(r.safeFileName('  muitos    espaços  '), 'muitos espaços');
  assert.equal(r.safeFileName('???'), '');
  assert.equal(r.safeFileName('Relatório 2026'), 'Relatório 2026');
});
