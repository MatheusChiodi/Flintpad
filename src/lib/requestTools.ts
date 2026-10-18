// Lógica pura da tela de Requests: importar cURL, gerar código, path params, edição em massa,
// filtro JSON, busca na resposta, cookies, asserções, documentação e filtros das listas.
// Nada aqui toca o DOM nem o disco; os testes (tests/requests.test.mjs) importam este arquivo direto.

import type { AuthMode, BodyMode, BruRequest, HttpResult, OutgoingRequest, Pair } from './request';

// ---------------------------------------------------------------------------------------------
// Importar um comando cURL

export type CurlImport = {
  method: string;
  url: string;
  headers: Pair[];
  bodyMode: BodyMode;
  body: { json?: string; text?: string; xml?: string; formUrlEncoded?: Pair[] };
  authMode: AuthMode;
  auth: { bearer?: { token: string }; basic?: { username: string; password: string } };
};

/** Divide uma linha de shell em argumentos (aspas simples, duplas, escapes e quebras com \ ou ^). */
export function shellWords(input: string): string[] {
  const text = input.replace(/\\\r?\n/g, ' ').replace(/\^\r?\n/g, ' ');
  const words: string[] = [];
  let current = '';
  let started = false;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote === "'") {
      if (char === "'") quote = null;
      else current += char;
    } else if (quote === '"') {
      if (char === '"') quote = null;
      else if (char === '\\' && i + 1 < text.length && '"\\$`'.includes(text[i + 1])) current += text[++i];
      else current += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (char === '$' && text[i + 1] === "'") {
      // $'...' do bash: aceita \n, \t, \' e \\ dentro.
      i += 2;
      for (; i < text.length && text[i] !== "'"; i++) {
        if (text[i] === '\\' && i + 1 < text.length) {
          const next = text[++i];
          current += next === 'n' ? '\n' : next === 't' ? '\t' : next === 'r' ? '\r' : next;
        } else current += text[i];
      }
      started = true;
    } else if (char === '\\' && i + 1 < text.length) {
      current += text[++i];
      started = true;
    } else if (/\s/.test(char)) {
      if (started || current) words.push(current);
      current = '';
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (quote) throw new Error('unterminated-quote');
  if (started || current) words.push(current);
  return words;
}

export const looksLikeCurl = (text: string) => /^\s*curl(\.exe)?\s/i.test(text);

const DATA_FLAGS = new Set(['-d', '--data', '--data-raw', '--data-binary', '--data-ascii', '--data-urlencode']);
const VALUE_FLAGS = new Set([
  '-X', '--request', '-H', '--header', '-u', '--user', '--url', '-A', '--user-agent', '-b', '--cookie', '-e', '--referer',
  '--json', '-o', '--output', '-m', '--max-time', '--connect-timeout', '-x', '--proxy', '-F', '--form', '-T', '--upload-file',
  '--cacert', '--cert', '--key', '-w', '--write-out', '--retry', '-c', '--cookie-jar', '--resolve', '--max-redirs',
  '--retry-delay', '--retry-max-time', '--limit-rate', '-r', '--range', '--interface', '--max-filesize',
  ...DATA_FLAGS,
]);

// --data-urlencode: "nome=valor" codifica só o valor; "=valor" ou "valor" codifica tudo; @arquivo fica como está.
function urlencodeData(raw: string): string {
  const eq = raw.indexOf('=');
  const at = raw.indexOf('@');
  if (at >= 0 && (eq < 0 || at < eq)) return raw;
  if (eq < 0) return encodeURIComponent(raw);
  return (eq > 0 ? `${raw.slice(0, eq)}=` : '') + encodeURIComponent(raw.slice(eq + 1));
}

// Sem saber o valor de toda opção do curl, o que sobra solto e parece endereço é a URL (o "5" de --max-redirs 5 não é).
const looksLikeUrl = (word: string) => /:\/\/|^[\w-]+(\.[\w-]+)+|^localhost|^\{\{|^\/|:\d/i.test(word);

const headerValue = (headers: Pair[], name: string) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;

/** Lê um comando cURL e devolve método, URL, headers, corpo e autenticação. Lança Error em comando inválido. */
export function parseCurl(command: string): CurlImport {
  const words = shellWords(command.trim());
  if (!words.length || !/^curl(\.exe)?$/i.test(words[0])) throw new Error('not-curl');
  let method = '';
  let url = '';
  let loose = ''; // primeira palavra solta que não parece URL, para o caso de nenhuma parecer
  let getMode = false;
  let jsonFlag = false;
  const headers: Pair[] = [];
  const data: string[] = [];
  let user: string | null = null;

  for (let i = 1; i < words.length; i++) {
    let flag = words[i];
    let value: string | undefined;
    // --request=POST e -XPOST: o valor vem colado na própria opção.
    const eq = flag.startsWith('--') ? flag.indexOf('=') : -1;
    if (eq > 0) {
      value = flag.slice(eq + 1);
      flag = flag.slice(0, eq);
    } else if (/^-[XHdubAe]./.test(flag)) {
      value = flag.slice(2);
      flag = flag.slice(0, 2);
    }
    const take = () => value ?? words[++i] ?? '';
    if (!flag.startsWith('-') || flag === '-') {
      if (!url && looksLikeUrl(flag)) url = flag;
      else if (!loose) loose = flag;
      continue;
    }
    if (flag === '-X' || flag === '--request') method = take().toUpperCase();
    else if (flag === '-H' || flag === '--header') {
      const raw = take();
      const colon = raw.indexOf(':');
      if (colon > 0) headers.push({ name: raw.slice(0, colon).trim(), value: raw.slice(colon + 1).trim(), enabled: true });
    } else if (flag === '--data-urlencode') data.push(urlencodeData(take()));
    else if (DATA_FLAGS.has(flag)) data.push(take());
    else if (flag === '--json') {
      data.push(take());
      jsonFlag = true;
    } else if (flag === '-u' || flag === '--user') user = take();
    else if (flag === '--url') url = take();
    else if (flag === '-A' || flag === '--user-agent') headers.push({ name: 'User-Agent', value: take(), enabled: true });
    else if (flag === '-b' || flag === '--cookie') headers.push({ name: 'Cookie', value: take(), enabled: true });
    else if (flag === '-e' || flag === '--referer') headers.push({ name: 'Referer', value: take(), enabled: true });
    else if (flag === '-G' || flag === '--get') getMode = true;
    else if (flag === '-I' || flag === '--head') method = 'HEAD';
    else if (VALUE_FLAGS.has(flag)) take(); // opções que não mudam a request (saída, proxy, timeout…)
    // demais opções sem valor (-L, -k, -s, -i, -v, --compressed…) são ignoradas
  }
  url ||= loose;
  if (!url) throw new Error('no-url');

  if (jsonFlag) {
    if (!headerValue(headers, 'content-type')) headers.push({ name: 'Content-Type', value: 'application/json', enabled: true });
    if (!headerValue(headers, 'accept')) headers.push({ name: 'Accept', value: 'application/json', enabled: true });
  }

  let bodyMode: BodyMode = 'none';
  const body: CurlImport['body'] = {};
  const joined = data.join('&');
  if (data.length && getMode) {
    url += (url.includes('?') ? '&' : '?') + joined;
  } else if (data.length) {
    const type = (headerValue(headers, 'content-type') ?? '').toLowerCase();
    const trimmed = joined.trim();
    if (type.includes('json') || (!type && /^[[{]/.test(trimmed))) {
      bodyMode = 'json';
      body.json = joined;
    } else if (type.includes('xml') || (!type && trimmed.startsWith('<'))) {
      bodyMode = 'xml';
      body.xml = joined;
    } else if (type.includes('x-www-form-urlencoded') || (!type && /^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(trimmed))) {
      bodyMode = 'formUrlEncoded';
      body.formUrlEncoded = trimmed.split('&').filter(Boolean).map((part) => {
        const at = part.indexOf('=');
        const decode = (s: string) => {
          try {
            return decodeURIComponent(s.replace(/\+/g, ' '));
          } catch {
            return s;
          }
        };
        return { name: decode(at < 0 ? part : part.slice(0, at)), value: decode(at < 0 ? '' : part.slice(at + 1)), enabled: true };
      });
      // O modo de corpo já põe o Content-Type: não precisa repetir na tabela.
      const index = headers.findIndex((h) => h.name.toLowerCase() === 'content-type' && h.value.toLowerCase().includes('x-www-form-urlencoded'));
      if (index >= 0) headers.splice(index, 1);
    } else {
      bodyMode = 'text';
      body.text = joined;
    }
  }

  let authMode: AuthMode = 'none';
  const auth: CurlImport['auth'] = {};
  if (user !== null) {
    const colon = user.indexOf(':');
    authMode = 'basic';
    auth.basic = { username: colon < 0 ? user : user.slice(0, colon), password: colon < 0 ? '' : user.slice(colon + 1) };
  } else {
    const index = headers.findIndex((h) => h.name.toLowerCase() === 'authorization' && /^bearer\s+/i.test(h.value));
    if (index >= 0) {
      authMode = 'bearer';
      auth.bearer = { token: headers[index].value.replace(/^bearer\s+/i, '') };
      headers.splice(index, 1);
    }
  }

  return { method: method || (data.length && !getMode ? 'POST' : 'GET'), url, headers, bodyMode, body, authMode, auth };
}

/** Aplica um cURL importado sobre a request aberta (nome, anotações e blocos não editados ficam). */
export function applyCurl(request: BruRequest, imported: CurlImport): BruRequest {
  return {
    ...request,
    http: { ...request.http, method: imported.method.toLowerCase(), url: imported.url, body: imported.bodyMode, auth: imported.authMode },
    params: queryPairs(imported.url),
    headers: imported.headers,
    body: { ...request.body, ...imported.body },
    auth: { ...request.auth, ...imported.auth },
  };
}

function queryPairs(url: string): Pair[] {
  const at = url.indexOf('?');
  if (at < 0) return [];
  return url
    .slice(at + 1)
    .split('#')[0]
    .split('&')
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf('=');
      return { name: eq < 0 ? part : part.slice(0, eq), value: eq < 0 ? '' : part.slice(eq + 1), enabled: true, type: 'query' };
    });
}

// ---------------------------------------------------------------------------------------------
// Gerar código a partir da request pronta para envio

export type SnippetLanguage = 'curl' | 'fetch' | 'python' | 'http';
export const SNIPPET_LANGUAGES: SnippetLanguage[] = ['curl', 'fetch', 'python', 'http'];

const shellQuote = (text: string) => (/^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replace(/'/g, `'\\''`)}'`);
const jsString = (text: string) => JSON.stringify(text);
const pyString = (text: string) => JSON.stringify(text); // aspas duplas com escapes valem em Python também

export function toSnippet(request: OutgoingRequest, language: SnippetLanguage): string {
  const { method, url, headers, body } = request;
  const hasBody = body !== undefined && body !== '' && !['GET', 'HEAD'].includes(method);
  switch (language) {
    case 'curl': {
      const parts = [`curl${method === 'GET' ? '' : ` -X ${method}`} ${shellQuote(url)}`];
      for (const [name, value] of headers) parts.push(`-H ${shellQuote(`${name}: ${value}`)}`);
      if (hasBody) parts.push(`--data-raw ${shellQuote(body!)}`);
      return parts.join(' \\\n  ');
    }
    case 'fetch': {
      const lines = [`const response = await fetch(${jsString(url)}, {`, `  method: ${jsString(method)},`];
      if (headers.length) {
        lines.push('  headers: {');
        for (const [name, value] of headers) lines.push(`    ${jsString(name)}: ${jsString(value)},`);
        lines.push('  },');
      }
      if (hasBody) lines.push(`  body: ${jsString(body!)},`);
      lines.push('});', 'console.log(response.status, await response.text());');
      return lines.join('\n');
    }
    case 'python': {
      const lines = ['import requests', ''];
      if (headers.length) {
        lines.push('headers = {');
        for (const [name, value] of headers) lines.push(`    ${pyString(name)}: ${pyString(value)},`);
        lines.push('}');
      }
      if (hasBody) lines.push(`data = ${pyString(body!)}`);
      const args = [pyString(method), pyString(url)];
      if (headers.length) args.push('headers=headers');
      if (hasBody) args.push('data=data.encode("utf-8")');
      lines.push('', `response = requests.request(${args.join(', ')})`, 'print(response.status_code, response.text)');
      return lines.join('\n');
    }
    case 'http': {
      let target: URL;
      try {
        target = new URL(url);
      } catch {
        return `${method} ${url} HTTP/1.1`;
      }
      const lines = [`${method} ${target.pathname}${target.search} HTTP/1.1`, `Host: ${target.host}`, ...headers.map(([name, value]) => `${name}: ${value}`)];
      return hasBody ? `${lines.join('\n')}\n\n${body}` : lines.join('\n');
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Path params (/users/:id), no formato do Bruno (params com type "path")

function splitPath(url: string): [prefix: string, path: string, rest: string] {
  const schemeEnd = url.match(/^[a-z][a-z0-9+.-]*:\/\//i)?.[0].length ?? 0;
  const restAt = url.search(/[?#]/);
  const end = restAt < 0 ? url.length : restAt;
  const slash = url.indexOf('/', schemeEnd);
  const pathStart = slash < 0 || slash > end ? end : slash;
  return [url.slice(0, pathStart), url.slice(pathStart, end), url.slice(end)];
}

const PATH_PARAM = /\/:([A-Za-z_][\w-]*)(?=\/|$)/g;

export function pathParamNames(url: string): string[] {
  const [, path] = splitPath(url);
  return [...new Set([...path.matchAll(PATH_PARAM)].map((m) => m[1]))];
}

/** Ajusta as linhas de path params aos :nomes da URL, mantendo os valores já digitados. */
export function syncPathParams(url: string, params: Pair[] = []): Pair[] {
  const names = pathParamNames(url);
  const previous = new Map(params.filter((p) => p.type === 'path').map((p) => [p.name, p]));
  const others = params.filter((p) => p.type !== 'path');
  const path = names.map((name) => previous.get(name) ?? { name, value: '', enabled: true, type: 'path' });
  const same = path.length === previous.size && path.every((p) => previous.get(p.name) === p);
  return same ? params : [...others, ...path];
}

/** Troca cada /:nome pelo valor (codificado) do path param correspondente. */
export function applyPathParams(url: string, params: Pair[] = []): string {
  const values = new Map(params.filter((p) => p.type === 'path' && p.enabled && p.value !== '').map((p) => [p.name, p.value]));
  if (!values.size) return url;
  const [prefix, path, rest] = splitPath(url);
  return prefix + path.replace(PATH_PARAM, (all, name: string) => (values.has(name) ? `/${encodeURIComponent(values.get(name)!)}` : all)) + rest;
}

// ---------------------------------------------------------------------------------------------
// Edição em massa: uma linha "nome: valor" por par; "//" no começo desativa a linha

export function pairsToText(rows: { name: string; value: string; enabled: boolean }[]): string {
  return rows
    .filter((row) => row.name || row.value)
    .map((row) => `${row.enabled ? '' : '//'}${row.name}: ${row.value}`)
    .join('\n');
}

export function textToPairs(text: string, extra: Partial<Pair> = {}): Pair[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const disabled = line.startsWith('//');
      const content = disabled ? line.slice(2).trim() : line;
      const colon = content.indexOf(':');
      const name = (colon < 0 ? content : content.slice(0, colon)).trim();
      const value = colon < 0 ? '' : content.slice(colon + 1).trim();
      return { ...extra, name, value, enabled: !disabled };
    })
    .filter((row) => row.name);
}

// ---------------------------------------------------------------------------------------------
// Filtro JSON da resposta: users[0].name, $.users[*].id, data["chave com espaço"]

type PathToken = { key: string } | { index: number } | { all: true };

export function parseJsonPath(path: string): PathToken[] {
  let rest = path.trim().replace(/^\$/, '').replace(/^res\.body/, '');
  const tokens: PathToken[] = [];
  while (rest) {
    let m: RegExpMatchArray | null;
    if ((m = rest.match(/^\.?\[\s*\*\s*\]|^\.\*/))) tokens.push({ all: true });
    else if ((m = rest.match(/^\.?\[\s*(-?\d+)\s*\]/))) tokens.push({ index: Number(m[1]) });
    else if ((m = rest.match(/^\.?\[\s*(["'])(.*?)\1\s*\]/))) tokens.push({ key: m[2] });
    else if ((m = rest.match(/^\.?([^.[\]]+)/))) tokens.push({ key: m[1].trim() });
    else throw new Error('invalid-path');
    rest = rest.slice(m[0].length);
  }
  return tokens;
}

/** Aplica o caminho ao valor. Com [*] o resultado vira lista. undefined quando não existe. */
export function queryJson(value: unknown, path: string): unknown {
  let current: unknown[] = [value];
  let many = false;
  for (const token of parseJsonPath(path)) {
    const next: unknown[] = [];
    for (const item of current) {
      if ('all' in token) {
        if (Array.isArray(item)) next.push(...item);
        else if (item && typeof item === 'object') next.push(...Object.values(item));
      } else if ('index' in token) {
        if (Array.isArray(item)) {
          const at = token.index < 0 ? item.length + token.index : token.index;
          if (at >= 0 && at < item.length) next.push(item[at]);
        }
      } else if (token.key === 'length' && (Array.isArray(item) || typeof item === 'string')) next.push(item.length);
      else if (item && typeof item === 'object' && Object.prototype.hasOwnProperty.call(item, token.key)) next.push((item as Record<string, unknown>)[token.key]);
    }
    if ('all' in token) many = true;
    current = next;
  }
  return many ? current : current[0];
}

// ---------------------------------------------------------------------------------------------
// Busca no corpo da resposta

export const MAX_MATCHES = 1000;

// Início e fim de cada achado no texto original. Se toLowerCase muda o tamanho ("İ" vira 2 caracteres),
// as posições do texto em minúsculas são levadas de volta caractere a caractere.
function matchRanges(text: string, query: string): [start: number, end: number][] {
  if (!query) return [];
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  let starts: number[] | null = null;
  let ends: number[] | null = null;
  if (haystack.length !== text.length) {
    starts = [];
    ends = [];
    for (let i = 0; i < text.length; ) {
      const size = text.codePointAt(i)! > 0xffff ? 2 : 1;
      for (let k = text.slice(i, i + size).toLowerCase().length; k > 0; k--) {
        starts.push(i);
        ends.push(i + size);
      }
      i += size;
    }
  }
  const found: [number, number][] = [];
  for (let at = haystack.indexOf(needle); at >= 0 && found.length < MAX_MATCHES; at = haystack.indexOf(needle, at + needle.length)) {
    const last = at + needle.length - 1;
    found.push(starts && ends ? [starts[at], ends[last]] : [at, at + needle.length]);
  }
  return found;
}

/** Posições onde o termo aparece (sem diferenciar maiúsculas), até MAX_MATCHES. */
export const findMatches = (text: string, query: string): number[] => matchRanges(text, query).map(([start]) => start);

/** Corta o texto em trechos comuns e trechos que batem com o termo, para destacar. */
export function highlightSegments(text: string, query: string): { text: string; match: boolean }[] {
  const ranges = matchRanges(text, query);
  if (!ranges.length) return [{ text, match: false }];
  const segments: { text: string; match: boolean }[] = [];
  let last = 0;
  for (const [at, end] of ranges) {
    if (at > last) segments.push({ text: text.slice(last, at), match: false });
    segments.push({ text: text.slice(at, end), match: true });
    last = end;
  }
  if (last < text.length) segments.push({ text: text.slice(last), match: false });
  return segments;
}

// ---------------------------------------------------------------------------------------------
// Cookies da resposta

export type Cookie = { name: string; value: string; domain?: string; path?: string; expires?: string; maxAge?: string; httpOnly: boolean; secure: boolean; sameSite?: string };

export function parseSetCookies(headers: [string, string][]): Cookie[] {
  return headers
    .filter(([name]) => name.toLowerCase() === 'set-cookie')
    .map(([, raw]) => {
      const [pair, ...attributes] = raw.split(';').map((part) => part.trim());
      const eq = pair.indexOf('=');
      const cookie: Cookie = { name: eq < 0 ? pair : pair.slice(0, eq), value: eq < 0 ? '' : pair.slice(eq + 1), httpOnly: false, secure: false };
      for (const attribute of attributes) {
        const at = attribute.indexOf('=');
        const key = (at < 0 ? attribute : attribute.slice(0, at)).toLowerCase();
        const value = at < 0 ? '' : attribute.slice(at + 1);
        if (key === 'domain') cookie.domain = value;
        else if (key === 'path') cookie.path = value;
        else if (key === 'expires') cookie.expires = value;
        else if (key === 'max-age') cookie.maxAge = value;
        else if (key === 'samesite') cookie.sameSite = value;
        else if (key === 'httponly') cookie.httpOnly = true;
        else if (key === 'secure') cookie.secure = true;
      }
      return cookie;
    })
    .filter((cookie) => cookie.name);
}

// ---------------------------------------------------------------------------------------------
// Asserções (bloco "assert" do Bruno): res.status: eq 200, res.body.users.length: gt 0…

export type Assertion = { name: string; value: string; enabled: boolean };
export type AssertionResult = { name: string; operator: string; expected: string; actual: unknown; pass: boolean; error?: string };

export const ASSERT_OPERATORS = [
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'contains', 'notContains', 'length', 'matches', 'notMatches',
  'startsWith', 'endsWith', 'between', 'isEmpty', 'isNotEmpty', 'isNull', 'isUndefined', 'isDefined', 'isTruthy', 'isFalsy',
  'isJson', 'isNumber', 'isString', 'isBoolean', 'isArray',
] as const;
const UNARY = new Set(['isEmpty', 'isNotEmpty', 'isNull', 'isUndefined', 'isDefined', 'isTruthy', 'isFalsy', 'isJson', 'isNumber', 'isString', 'isBoolean', 'isArray']);

export type AssertTarget = { status: number; statusText: string; headers: [string, string][]; body: string; time: number };

function parseBody(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

/** Valor do lado esquerdo: res.status, res.statusText, res.responseTime, res.headers.x, res.body… */
export function resolveAssertTarget(name: string, res: AssertTarget, parsed = parseBody(res.body)): unknown {
  const key = name.trim();
  if (key === 'res.status') return res.status;
  if (key === 'res.statusText') return res.statusText;
  if (key === 'res.responseTime') return res.time;
  if (key.startsWith('res.headers.') || key.startsWith('res.headers[')) {
    const header = key.slice('res.headers'.length).replace(/^\.|^\[["']?|["']?\]$/g, '').toLowerCase();
    const found = res.headers.filter(([h]) => h.toLowerCase() === header).map(([, v]) => v);
    return found.length ? found.join(', ') : undefined;
  }
  if (key === 'res.body') return parsed;
  if (key.startsWith('res.body')) return queryJson(parsed, key.slice('res.body'.length));
  throw new Error('unknown-target');
}

/** Valor esperado: número, booleano, null, JSON entre aspas ou texto puro. */
export function parseExpected(raw: string): unknown {
  const text = raw.trim();
  if (text === '') return '';
  try {
    return JSON.parse(text);
  } catch {
    return text.replace(/^'(.*)'$/, '$1');
  }
}

const same = (a: unknown, b: unknown) => (typeof a === 'object' || typeof b === 'object' ? JSON.stringify(a) === JSON.stringify(b) : a === b || String(a) === String(b));
const isEmptyValue = (value: unknown) =>
  value === '' || value === null || value === undefined || (Array.isArray(value) && !value.length) || (typeof value === 'object' && value !== null && !Object.keys(value).length);
const listOf = (raw: string) => raw.split(',').map((item) => parseExpected(item));

export function evaluateAssertion(assertion: Assertion, res: AssertTarget, parsed = parseBody(res.body)): AssertionResult {
  const trimmed = assertion.value.trim();
  const space = trimmed.indexOf(' ');
  const first = space < 0 ? trimmed : trimmed.slice(0, space);
  const known = (ASSERT_OPERATORS as readonly string[]).includes(first);
  const operator = known ? first : 'eq';
  const expected = known ? (space < 0 ? '' : trimmed.slice(space + 1).trim()) : trimmed;
  const base = { name: assertion.name, operator, expected };
  let actual: unknown;
  try {
    actual = resolveAssertTarget(assertion.name, res, parsed);
  } catch {
    return { ...base, actual: undefined, pass: false, error: 'target' };
  }
  const want = parseExpected(expected);
  const num = (value: unknown) => (typeof value === 'number' ? value : Number(value));
  let pass: boolean;
  try {
    switch (operator) {
      case 'eq': pass = same(actual, want); break;
      case 'neq': pass = !same(actual, want); break;
      case 'gt': pass = num(actual) > num(want); break;
      case 'gte': pass = num(actual) >= num(want); break;
      case 'lt': pass = num(actual) < num(want); break;
      case 'lte': pass = num(actual) <= num(want); break;
      case 'in': pass = listOf(expected).some((item) => same(actual, item)); break;
      case 'notIn': pass = !listOf(expected).some((item) => same(actual, item)); break;
      case 'contains': pass = Array.isArray(actual) ? actual.some((item) => same(item, want)) : String(actual ?? '').includes(String(want)); break;
      case 'notContains': pass = Array.isArray(actual) ? !actual.some((item) => same(item, want)) : !String(actual ?? '').includes(String(want)); break;
      case 'length': pass = (Array.isArray(actual) || typeof actual === 'string') && actual.length === num(want); break;
      case 'matches': pass = new RegExp(expected).test(String(actual ?? '')); break;
      case 'notMatches': pass = !new RegExp(expected).test(String(actual ?? '')); break;
      case 'startsWith': pass = String(actual ?? '').startsWith(String(want)); break;
      case 'endsWith': pass = String(actual ?? '').endsWith(String(want)); break;
      case 'between': {
        const [low, high] = listOf(expected).map(num);
        pass = num(actual) >= low && num(actual) <= high;
        break;
      }
      case 'isEmpty': pass = isEmptyValue(actual); break;
      case 'isNotEmpty': pass = !isEmptyValue(actual); break;
      case 'isNull': pass = actual === null; break;
      case 'isUndefined': pass = actual === undefined; break;
      case 'isDefined': pass = actual !== undefined; break;
      case 'isTruthy': pass = Boolean(actual); break;
      case 'isFalsy': pass = !actual; break;
      case 'isJson': pass = typeof actual === 'object' && actual !== null; break;
      case 'isNumber': pass = typeof actual === 'number'; break;
      case 'isString': pass = typeof actual === 'string'; break;
      case 'isBoolean': pass = typeof actual === 'boolean'; break;
      case 'isArray': pass = Array.isArray(actual); break;
      default: pass = false;
    }
  } catch {
    return { ...base, actual, pass: false, error: 'expected' };
  }
  return { ...base, expected: UNARY.has(operator) ? '' : expected, actual, pass };
}

export function evaluateAssertions(assertions: Assertion[] | undefined, result: HttpResult): AssertionResult[] {
  const active = (assertions ?? []).filter((a) => a.enabled && a.name.trim());
  if (!active.length) return [];
  if (!result.ok) return active.map((a) => ({ name: a.name, operator: '', expected: a.value, actual: undefined, pass: false, error: 'request' }));
  const target: AssertTarget = { status: result.status, statusText: result.statusText, headers: result.headers, body: result.body, time: result.time };
  const parsed = parseBody(result.body);
  return active.map((assertion) => evaluateAssertion(assertion, target, parsed));
}

// ---------------------------------------------------------------------------------------------
// Corpo JSON: formatar mesmo com {{variáveis}} soltas, e apontar linha e coluna do erro

const VAR_TOKEN = /\{\{\s*[\w.-]+\s*\}\}/g;

export type JsonCheck = { ok: true; text: string } | { ok: false; line: number; column: number; message: string };

export function formatJsonBody(text: string, indent = 2): JsonCheck {
  if (!text.trim()) return { ok: true, text };
  const originals: string[] = [];
  // Variável fora de aspas vira string marcada; dentro de aspas, só o marcador. Depois tudo volta.
  let inString = false;
  let masked = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' && !isEscaped(text, i)) inString = !inString;
    if (char === '{' && text[i + 1] === '{') {
      VAR_TOKEN.lastIndex = i;
      const m = VAR_TOKEN.exec(text);
      if (m && m.index === i) {
        const n = originals.length;
        originals.push(m[0]);
        masked += inString ? `\uE000${n}\uE001` : `"\uE002${n}\uE001"`;
        i += m[0].length - 1;
        continue;
      }
    }
    masked += char;
  }
  try {
    let out = JSON.stringify(JSON.parse(masked), null, indent);
    out = out.replace(/"\uE002(\d+)\uE001"/g, (_, n: string) => originals[Number(n)]);
    out = out.replace(/\uE000(\d+)\uE001/g, (_, n: string) => originals[Number(n)]);
    return { ok: true, text: out };
  } catch (error) {
    const message = (error as Error).message;
    // A posição é no texto mascarado; para linha/coluna serve, porque as variáveis não têm quebra de linha.
    const position = jsonErrorAt(masked);
    const at = position >= 0 ? position : masked.length;
    const before = masked.slice(0, at).split('\n');
    return { ok: false, line: before.length, column: before[before.length - 1].length + 1, message };
  }
}

// Onde o JSON quebra, varrendo o texto: a mensagem do JSON.parse nem sempre traz "position N". -1 se for válido.
function jsonErrorAt(text: string): number {
  let i = 0;
  const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  const fail = (): never => {
    throw i;
  };
  const space = () => {
    while (i < text.length && ' \t\n\r'.includes(text[i])) i++;
  };
  const expect = (char: string) => (text[i] === char ? i++ : fail());
  const string = () => {
    expect('"');
    for (; text[i] !== '"'; i++) {
      if (i >= text.length || text[i] < ' ') fail();
      if (text[i] !== '\\') continue;
      i++;
      if (text[i] === 'u') {
        if (!/^[\da-fA-F]{4}$/.test(text.slice(i + 1, i + 5))) fail();
        i += 4;
      } else if (i >= text.length || !'"\\/bfnrt'.includes(text[i])) fail();
    }
    i++;
  };
  const list = (close: string, item: () => void) => {
    i++;
    space();
    if (text[i] === close) return void i++;
    for (;;) {
      item();
      space();
      if (text[i] === close) return void i++;
      expect(',');
    }
  };
  const value = (): void => {
    space();
    const char = text[i];
    if (char === '{')
      list('}', () => {
        space();
        string();
        space();
        expect(':');
        value();
      });
    else if (char === '[') list(']', value);
    else if (char === '"') string();
    else if (char === 't' || char === 'f' || char === 'n') {
      const word = char === 't' ? 'true' : char === 'f' ? 'false' : 'null';
      if (!text.startsWith(word, i)) fail();
      i += word.length;
    } else {
      NUMBER.lastIndex = i;
      if (!NUMBER.test(text)) fail();
      i = NUMBER.lastIndex;
    }
  };
  try {
    value();
    space();
    return i < text.length ? i : -1;
  } catch (at) {
    return at as number;
  }
}

function isEscaped(text: string, at: number) {
  let slashes = 0;
  for (let i = at - 1; i >= 0 && text[i] === '\\'; i--) slashes++;
  return slashes % 2 === 1;
}

// ---------------------------------------------------------------------------------------------
// Filtros das listas

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const METHOD_WORDS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

/** Cada palavra precisa bater com o nome, a URL ou a pasta; "post" e afins filtram pelo método. */
export function matchesRequestQuery(request: { name: string; url: string; path: string; method: string }, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = fold(`${request.name} ${request.url} ${request.path}`);
  return words.every((word) => (METHOD_WORDS.has(word.toUpperCase()) ? request.method.toUpperCase() === word.toUpperCase() : haystack.includes(word)));
}

export type StatusFilter = 'all' | '2xx' | '3xx' | '4xx' | '5xx' | 'error';
export const STATUS_FILTERS: StatusFilter[] = ['all', '2xx', '3xx', '4xx', '5xx', 'error'];

export function statusClass(result: HttpResult): Exclude<StatusFilter, 'all'> | '1xx' {
  if (!result.ok) return 'error';
  if (result.status >= 500) return '5xx';
  if (result.status >= 400) return '4xx';
  if (result.status >= 300) return '3xx';
  if (result.status >= 200) return '2xx';
  return '1xx';
}

export function filterHistory<T extends { name: string; url: string; method: string; path?: string; result: HttpResult }>(entries: T[], query: string, status: StatusFilter): T[] {
  return entries.filter(
    (entry) => (status === 'all' || statusClass(entry.result) === status) && matchesRequestQuery({ name: entry.name, url: entry.url, method: entry.method, path: '' }, query),
  );
}

// ---------------------------------------------------------------------------------------------
// Documentação e resposta como página Markdown

const fenceFor = (text: string) => '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)));
const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function codeBlock(text: string, language = '') {
  const fence = fenceFor(text);
  return `${fence}${language}\n${text}\n${fence}`;
}

function pairTable(title: string, rows: Pair[] | undefined, nameHeader: string, valueHeader: string) {
  const active = (rows ?? []).filter((row) => row.enabled && row.name);
  if (!active.length) return '';
  return [`**${title}**`, '', `| ${nameHeader} | ${valueHeader} |`, '| --- | --- |', ...active.map((row) => `| ${cell(row.name)} | ${cell(row.value)} |`)].join('\n');
}

export type DocLabels = { params: string; pathParams: string; headers: string; body: string; auth: string; name: string; value: string; file: string; assertions: string };

/** Uma seção "## Nome" por request; blocos vazios ficam de fora e os demais vêm separados por uma linha. */
export function requestToMarkdown(request: BruRequest, path: string, labels: DocLabels): string {
  const method = request.http.method.toUpperCase();
  const blocks = [`## ${request.meta.name}`, `\`${method}\` \`${request.http.url}\``, `${labels.file}: [[${path}|${request.meta.name}]]`];
  if (request.docs?.trim()) blocks.push(request.docs.trim());
  blocks.push(pairTable(labels.params, request.params?.filter((p) => p.type !== 'path'), labels.name, labels.value));
  blocks.push(pairTable(labels.pathParams, request.params?.filter((p) => p.type === 'path'), labels.name, labels.value));
  blocks.push(pairTable(labels.headers, request.headers, labels.name, labels.value));
  const mode = request.http.auth;
  if (mode && mode !== 'none') blocks.push(`**${labels.auth}**: ${mode}`);
  const bodyMode = request.http.body;
  if (bodyMode === 'json' || bodyMode === 'text' || bodyMode === 'xml') {
    const text = String(request.body?.[bodyMode] ?? '').trim();
    if (text) blocks.push(`**${labels.body}**\n\n${codeBlock(text, bodyMode === 'text' ? '' : bodyMode)}`);
  } else if (bodyMode === 'formUrlEncoded') blocks.push(pairTable(labels.body, request.body?.formUrlEncoded, labels.name, labels.value));
  const asserts = (request.assertions as Assertion[] | undefined)?.filter((a) => a.enabled);
  if (asserts?.length) blocks.push([`**${labels.assertions}**`, '', ...asserts.map((a) => `- \`${a.name}\` ${a.value}`)].join('\n'));
  return blocks.filter(Boolean).join('\n\n');
}

/** Página de documentação de uma pasta (o título da página já é o nome do arquivo). */
export function collectionToMarkdown(entries: { request: BruRequest; path: string }[], labels: DocLabels): string {
  return entries.map(({ request, path }) => requestToMarkdown(request, path, labels)).join('\n\n') + '\n';
}

export type ResponseLabels = { status: string; time: string; size: string; headers: string; body: string; sentAt: string; name: string; value: string };

export function responseToMarkdown(input: { name: string; method: string; url: string; at: string; result: HttpResult; size: string }, labels: ResponseLabels): string {
  const { result } = input;
  // O nome da request vai no título da página; aqui começa direto pelo envio.
  const lines = [`\`${input.method}\` \`${input.url}\``, '', `- ${labels.sentAt}: ${input.at}`];
  if (!result.ok) {
    lines.push(`- ${labels.status}: ${result.error}`);
    return lines.join('\n') + '\n';
  }
  lines.push(`- ${labels.status}: ${result.status} ${result.statusText}`, `- ${labels.time}: ${result.time} ms`, `- ${labels.size}: ${input.size}`, '');
  if (result.headers.length) lines.push(`## ${labels.headers}`, '', `| ${labels.name} | ${labels.value} |`, '| --- | --- |', ...result.headers.map(([n, v]) => `| ${cell(n)} | ${cell(v)} |`), '');
  const isJson = /^\s*[[{]/.test(result.body);
  let body = result.body;
  if (isJson) {
    try {
      body = JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      // corpo que parece JSON mas não é: vai como veio
    }
  }
  if (body) lines.push(`## ${labels.body}`, '', codeBlock(body, isJson ? 'json' : ''));
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------------------------
// Autocompletar headers

export const COMMON_HEADERS = [
  'Accept', 'Accept-Encoding', 'Accept-Language', 'Authorization', 'Cache-Control', 'Connection', 'Content-Length', 'Content-Type',
  'Cookie', 'If-Match', 'If-Modified-Since', 'If-None-Match', 'Origin', 'Pragma', 'Range', 'Referer', 'User-Agent',
  'X-API-Key', 'X-Correlation-ID', 'X-Request-ID', 'X-Requested-With',
];

export const COMMON_HEADER_VALUES: Record<string, string[]> = {
  accept: ['application/json', 'application/xml', 'text/plain', 'text/html', '*/*'],
  'content-type': ['application/json', 'application/x-www-form-urlencoded', 'application/xml', 'text/plain', 'multipart/form-data'],
  'cache-control': ['no-cache', 'no-store', 'max-age=0'],
  'accept-encoding': ['gzip, deflate, br', 'identity'],
  connection: ['keep-alive', 'close'],
};

/** Próximo nome livre: "Base", "Base 2", "Base 3"… */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((name) => name.toLowerCase()));
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base} ${i}`;
  return name;
}

/** Nome de arquivo seguro para ambientes e páginas geradas. */
export const safeFileName = (name: string) => name.replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
