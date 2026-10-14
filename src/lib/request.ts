// Modelo de request no formato JSON do @usebruno/lang (arquivos .bru).

import { translate } from './i18n';

export type Pair = { name: string; value: string; enabled: boolean; type?: string };

export type BodyMode = 'none' | 'json' | 'text' | 'xml' | 'formUrlEncoded' | 'multipartForm';
export type AuthMode = 'none' | 'inherit' | 'bearer' | 'basic' | 'apikey';

export type BruRequest = {
  meta: { name: string; type: string; seq?: number | string };
  http: { method: string; url: string; body?: BodyMode | string; auth?: AuthMode | string };
  params?: Pair[];
  headers?: Pair[];
  auth?: {
    bearer?: { token?: string };
    basic?: { username?: string; password?: string };
    apikey?: { key?: string; value?: string; placement?: string };
    [mode: string]: unknown;
  };
  body?: { json?: string; text?: string; xml?: string; formUrlEncoded?: Pair[]; [mode: string]: unknown };
  docs?: string;
  // Blocos que a interface não edita (scripts, testes, vars) são preservados ao salvar.
  [block: string]: unknown;
};

export type RequestSummary = { path: string; name: string; method: string; url: string };
export type EnvVar = { name: string; value: string; enabled: boolean; secret: boolean };
export type Environment = { path: string; name: string; variables: EnvVar[] };

export type HttpResult =
  | {
      ok: true;
      status: number;
      statusText: string;
      headers: [string, string][];
      size: number;
      time: number;
      truncated: boolean;
      body: string;
    }
  | { ok: false; cancelled?: boolean; error: string; time?: number };

// Um envio guardado no histórico: a request como estava (sem variáveis resolvidas) e a resposta.
export type HistoryEntry = {
  id: string;
  at: string;
  /** Arquivo .bru de origem, quando o envio partiu de uma request salva. */
  source: string | null;
  name: string;
  method: string;
  /** URL já com as variáveis do ambiente aplicadas. */
  url: string;
  environment: string | null;
  request: BruRequest;
  result: HttpResult;
};

// Respostas grandes entram cortadas no histórico: o arquivo fica leve e rápido de ler.
export const MAX_HISTORY_BODY = 256 * 1024;

export function historyResult(result: HttpResult): HttpResult {
  if (!result.ok || result.body.length <= MAX_HISTORY_BODY) return result;
  return { ...result, body: result.body.slice(0, MAX_HISTORY_BODY), truncated: true };
}

/** Grupos por dia, do mais recente ao mais antigo (a lista já vem nessa ordem). */
export function groupByDay<T extends { at: string }>(entries: T[]): [day: string, items: T[]][] {
  const groups = new Map<string, T[]>();
  for (const entry of entries) {
    const day = entry.at.slice(0, 10);
    groups.set(day, [...(groups.get(day) ?? []), entry]);
  }
  return [...groups.entries()];
}

export type OutgoingRequest = { id: string; method: string; url: string; headers: [string, string][]; body?: string };

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

const VARIABLE = /\{\{\s*([\w.-]+)\s*\}\}/g;

export const envToVars = (env?: Environment): Record<string, string> =>
  Object.fromEntries((env?.variables ?? []).filter((v) => v.enabled && v.name).map((v) => [v.name, v.value]));

export const interpolate = (text: string, vars: Record<string, string>) =>
  text.replace(VARIABLE, (all, name: string) => (name in vars ? vars[name] : all));

export function unresolvedVariables(request: BruRequest, vars: Record<string, string>): string[] {
  const missing = new Set<string>();
  for (const match of JSON.stringify(request).matchAll(VARIABLE)) if (!(match[1] in vars)) missing.add(match[1]);
  return [...missing];
}

const splitUrl = (url: string): [base: string, query: string] => {
  const at = url.indexOf('?');
  return at < 0 ? [url, ''] : [url.slice(0, at), url.slice(at + 1)];
};

// A URL e a tabela de parâmetros são dois retratos da mesma query, como no Bruno.
export function paramsFromUrl(url: string, previous: Pair[] = []): Pair[] {
  const [, query] = splitUrl(url);
  const enabled = query
    .split('&')
    .filter(Boolean)
    .map((part): Pair => {
      const eq = part.indexOf('=');
      return { name: eq < 0 ? part : part.slice(0, eq), value: eq < 0 ? '' : part.slice(eq + 1), enabled: true, type: 'query' };
    });
  return [...enabled, ...previous.filter((p) => !p.enabled || (p.type && p.type !== 'query'))];
}

export function urlFromParams(url: string, params: Pair[]): string {
  const [base] = splitUrl(url);
  const query = params
    .filter((p) => p.enabled && p.name && (!p.type || p.type === 'query'))
    .map((p) => (p.value ? `${p.name}=${p.value}` : p.name))
    .join('&');
  return query ? `${base}?${query}` : base;
}

const hasHeader = (headers: [string, string][], name: string) =>
  headers.some(([key]) => key.toLowerCase() === name.toLowerCase());

const toBase64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

export function buildRequest(request: BruRequest, vars: Record<string, string>, id: string): OutgoingRequest {
  const fill = (text = '') => interpolate(text, vars);

  let rawUrl = fill(request.http.url).trim();
  if (!rawUrl) throw new Error(translate('requests.error.noUrl'));
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl)) rawUrl = `http://${rawUrl}`;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(translate('requests.error.invalidUrl', { url: rawUrl }));
  }

  const headers: [string, string][] = (request.headers ?? [])
    .filter((h) => h.enabled && h.name)
    .map((h) => [fill(h.name), fill(h.value)]);

  const auth = request.auth ?? {};
  switch (request.http.auth) {
    case 'bearer':
      headers.push(['Authorization', `Bearer ${fill(auth.bearer?.token)}`]);
      break;
    case 'basic':
      headers.push(['Authorization', `Basic ${toBase64(`${fill(auth.basic?.username)}:${fill(auth.basic?.password)}`)}`]);
      break;
    case 'apikey':
      if (auth.apikey?.placement === 'queryparams') url.searchParams.append(fill(auth.apikey.key), fill(auth.apikey.value));
      else if (auth.apikey?.key) headers.push([fill(auth.apikey.key), fill(auth.apikey.value)]);
      break;
  }

  let body: string | undefined;
  const contentType = (type: string) => {
    if (!hasHeader(headers, 'content-type')) headers.push(['Content-Type', type]);
  };
  switch (request.http.body) {
    case 'json':
      body = fill(request.body?.json);
      contentType('application/json');
      break;
    case 'text':
      body = fill(request.body?.text);
      contentType('text/plain');
      break;
    case 'xml':
      body = fill(request.body?.xml);
      contentType('application/xml');
      break;
    case 'formUrlEncoded':
      body = new URLSearchParams(
        (request.body?.formUrlEncoded ?? []).filter((f) => f.enabled && f.name).map((f) => [fill(f.name), fill(f.value)]),
      ).toString();
      contentType('application/x-www-form-urlencoded');
      break;
    case 'multipartForm':
      throw new Error(translate('requests.error.multipart'));
  }

  return { id, method: request.http.method.toUpperCase(), url: url.toString(), headers, body };
}

export function formatBody(body: string, headers: [string, string][]): string {
  const type = headers.find(([key]) => key.toLowerCase() === 'content-type')?.[1] ?? '';
  if (!type.includes('json') && !/^\s*[[{]/.test(body)) return body;
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
