import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { dirName } from '../lib/links';
import {
  buildRequest,
  envToVars,
  formatBody,
  formatSize,
  METHODS,
  paramsFromUrl,
  unresolvedVariables,
  urlFromParams,
  type BruRequest,
  type Environment,
  type EnvVar,
  type HttpResult,
  type Pair,
  type RequestSummary,
} from '../lib/request';

const ROOT_FOLDER = 'Requests';
const SAVE_DELAY_MS = 500;
const MAX_SHOWN_CHARS = 400_000;
const ENV_STORAGE_KEY = 'obnotion:environment';

const METHOD_COLOR: Record<string, string> = {
  GET: '#86d9cd',
  POST: '#e6c07b',
  PUT: '#8fb4ff',
  PATCH: '#c8a6f2',
  DELETE: '#f0908d',
};

const BODY_MODES = [
  ['none', 'Sem corpo'],
  ['json', 'JSON'],
  ['text', 'Texto'],
  ['xml', 'XML'],
  ['formUrlEncoded', 'Form URL-encoded'],
] as const;

const AUTH_MODES = [
  ['none', 'Sem autenticação'],
  ['bearer', 'Bearer token'],
  ['basic', 'Basic'],
  ['apikey', 'API key'],
] as const;

const field =
  'min-w-0 rounded-md bg-obsidian-950/60 px-2.5 py-1.5 font-mono text-[12.5px] text-frost-100 outline-none ring-1 ring-[var(--hairline-strong)] placeholder:text-frost-500 focus:ring-sheen-400';
const ghostButton =
  'rounded-md px-2.5 py-1.5 text-[12.5px] text-frost-300 ring-1 ring-[var(--hairline-strong)] hover:bg-[var(--hover)] hover:text-frost-100';

function Method({ value }: { value: string }) {
  const method = value.toUpperCase();
  return (
    <span className="w-11 shrink-0 font-mono text-[10.5px] font-semibold" style={{ color: METHOD_COLOR[method] ?? '#aeb8c7' }}>
      {method === 'DELETE' ? 'DEL' : method === 'OPTIONS' ? 'OPT' : method}
    </span>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: readonly (readonly [T, ReactNode])[]; onChange: (value: T) => void }) {
  return (
    <div className="flex gap-1">
      {options.map(([key, label]) => (
        <button
          key={key}
          className={`rounded-md px-2.5 py-1 text-[12.5px] ${
            key === value ? 'bg-[var(--hover-strong)] text-frost-100' : 'text-frost-500 hover:bg-[var(--hover)] hover:text-frost-300'
          }`}
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

type PairRow = { name: string; value: string; enabled: boolean };

function PairTable<T extends PairRow>({
  rows,
  blank,
  onChange,
  namePlaceholder,
  valuePlaceholder = 'Valor',
  valueDisabled,
}: {
  rows: T[];
  blank: T;
  onChange: (rows: T[]) => void;
  namePlaceholder: string;
  valuePlaceholder?: string;
  valueDisabled?: (row: T) => string | undefined;
}) {
  const patch = (index: number, change: Partial<T>) => onChange(rows.map((row, i) => (i === index ? { ...row, ...change } : row)));

  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((row, index) => {
        const lockedReason = valueDisabled?.(row);
        return (
          <div key={index} className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-3.5 accent-[#4fbfb4]"
              checked={row.enabled}
              title={row.enabled ? 'Desativar' : 'Ativar'}
              onChange={(event) => patch(index, { enabled: event.target.checked } as Partial<T>)}
            />
            <input className={`${field} flex-[2]`} placeholder={namePlaceholder} value={row.name} spellCheck={false} onChange={(event) => patch(index, { name: event.target.value } as Partial<T>)} />
            <input
              className={`${field} flex-[3] disabled:opacity-50`}
              placeholder={lockedReason ?? valuePlaceholder}
              value={lockedReason ? '' : row.value}
              disabled={Boolean(lockedReason)}
              spellCheck={false}
              onChange={(event) => patch(index, { value: event.target.value } as Partial<T>)}
            />
            <button className="rounded px-1.5 py-1 text-frost-500 hover:bg-[var(--hover)] hover:text-danger" title="Remover linha" onClick={() => onChange(rows.filter((_, i) => i !== index))}>
              ×
            </button>
          </div>
        );
      })}
      <button className={`${ghostButton} self-start`} onClick={() => onChange([...rows, blank])}>
        Adicionar linha
      </button>
    </div>
  );
}

function ResponseView({ result, sending }: { result: HttpResult | null; sending: boolean }) {
  const [tab, setTab] = useState<'body' | 'headers'>('body');
  const pretty = useMemo(() => (result?.ok ? formatBody(result.body, result.headers) : ''), [result]);

  if (sending) return <p className="p-4 text-frost-500">Enviando…</p>;
  if (!result) return <p className="p-4 text-frost-500">A resposta aparece aqui. Ctrl+Enter envia a request.</p>;
  if (!result.ok) {
    return (
      <div className="p-4">
        <p className="font-medium text-danger">{result.cancelled ? 'Request cancelada.' : 'A request não foi concluída.'}</p>
        {!result.cancelled && <p className="mt-1 font-mono text-[12.5px] text-frost-300">{result.error}</p>}
      </div>
    );
  }

  const statusColor = result.status < 300 ? '#86d9cd' : result.status < 400 ? '#e6c07b' : '#f0908d';
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-4 px-4 py-2">
        <Segmented value={tab} onChange={setTab} options={[['body', 'Corpo'], ['headers', `Headers (${result.headers.length})`]] as const} />
        <span className="ml-auto font-mono text-[12.5px] font-semibold" style={{ color: statusColor }}>
          {result.status} {result.statusText}
        </span>
        <span className="font-mono text-[12px] text-frost-500">{result.time} ms</span>
        <span className="font-mono text-[12px] text-frost-500">{formatSize(result.size)}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
        {tab === 'body' ? (
          <>
            <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed text-frost-100 select-text">
              {pretty.slice(0, MAX_SHOWN_CHARS) || <span className="text-frost-500">Resposta sem corpo.</span>}
            </pre>
            {(pretty.length > MAX_SHOWN_CHARS || result.truncated) && <p className="mt-2 text-frost-500">Resposta grande: só o início é mostrado.</p>}
          </>
        ) : (
          <table className="w-full font-mono text-[12.5px]">
            <tbody>
              {result.headers.map(([name, value], index) => (
                <tr key={index} className="align-top">
                  <td className="py-0.5 pr-4 text-sheen-300">{name}</td>
                  <td className="break-all py-0.5 text-frost-100 select-text">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

type Listing = { requests: RequestSummary[]; environments: Environment[] };
type RequestTab = 'params' | 'headers' | 'body' | 'auth' | 'docs';

export function Requests() {
  const [listing, setListing] = useState<Listing>({ requests: [], environments: [] });
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<BruRequest | null>(null);
  const [view, setView] = useState<'request' | 'environments'>('request');
  const [tab, setTab] = useState<RequestTab>('params');
  const [envPath, setEnvPath] = useState(() => localStorage.getItem(ENV_STORAGE_KEY) ?? '');
  const [result, setResult] = useState<HttpResult | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  const pending = useRef<{ timer: number; save?: () => Promise<void> }>({ timer: 0 });

  const environment = listing.environments.find((e) => e.path === envPath);
  const vars = useMemo(() => envToVars(environment), [environment]);

  const refresh = async () => {
    const next: Listing = await window.api.bruList();
    setListing(next);
    return next;
  };

  const flush = async () => {
    window.clearTimeout(pending.current.timer);
    const save = pending.current.save;
    pending.current.save = undefined;
    await save?.();
  };

  const schedule = (save: () => Promise<void>) => {
    window.clearTimeout(pending.current.timer);
    pending.current.save = save;
    pending.current.timer = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
  };

  useEffect(() => {
    void refresh().then((next) => next.requests[0] && void select(next.requests[0].path));
    return () => void flush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const select = async (path: string) => {
    await flush();
    setDraft(await window.api.bruRead(path));
    setSelected(path);
    setView('request');
    setResult(null);
    setProblem('');
  };

  const update = (change: (request: BruRequest) => BruRequest) => {
    if (!draft || !selected) return;
    const next = change(draft);
    const path = selected;
    setDraft(next);
    setListing((prev) => ({
      ...prev,
      requests: prev.requests.map((r) => (r.path === path ? { ...r, name: next.meta.name, method: next.http.method, url: next.http.url } : r)),
    }));
    schedule(() => window.api.bruWrite(path, next));
  };

  const createRequest = async () => {
    const folder = selected ? dirName(selected).replace(/\/$/, '') || ROOT_FOLDER : ROOT_FOLDER;
    const path: string = await window.api.bruCreate(folder, 'Nova request');
    await refresh();
    await select(path);
  };

  const deleteRequest = async (path: string) => {
    if (path === selected) {
      pending.current.save = undefined;
      setSelected(null);
      setDraft(null);
    }
    await window.api.remove(path);
    await refresh();
  };

  const send = async () => {
    if (!draft || sendingId) return;
    setProblem('');
    const id = crypto.randomUUID();
    let outgoing;
    try {
      outgoing = buildRequest(draft, vars, id);
    } catch (error) {
      return setProblem((error as Error).message);
    }
    setSendingId(id);
    setResult(null);
    setResult(await window.api.httpSend(outgoing));
    setSendingId(null);
  };

  const saveEnvironment = (env: Environment, variables: EnvVar[]) => {
    setListing((prev) => ({ ...prev, environments: prev.environments.map((e) => (e.path === env.path ? { ...e, variables } : e)) }));
    schedule(() => window.api.envWrite(env.path, variables));
  };

  const createEnvironment = async () => {
    await flush();
    const taken = new Set(listing.environments.map((e) => e.name));
    let name = 'Ambiente';
    for (let i = 2; taken.has(name); i++) name = `Ambiente ${i}`;
    const path = `${ROOT_FOLDER}/environments/${name}.bru`;
    await window.api.envWrite(path, [{ name: 'baseUrl', value: 'https://', enabled: true, secret: false }]);
    await refresh();
    chooseEnvironment(path);
  };

  const chooseEnvironment = (path: string) => {
    setEnvPath(path);
    localStorage.setItem(ENV_STORAGE_KEY, path);
  };

  const groups = useMemo(() => {
    const byFolder = new Map<string, RequestSummary[]>();
    for (const request of listing.requests) {
      const folder = dirName(request.path).replace(/\/$/, '');
      byFolder.set(folder, [...(byFolder.get(folder) ?? []), request]);
    }
    return [...byFolder.entries()];
  }, [listing.requests]);

  const missing = draft ? unresolvedVariables(draft, vars) : [];
  const bodyMode = (draft?.http.body ?? 'none') as (typeof BODY_MODES)[number][0];
  const authMode = (draft?.http.auth === 'inherit' ? 'none' : draft?.http.auth ?? 'none') as (typeof AUTH_MODES)[number][0];
  const textBodyKey = bodyMode === 'json' || bodyMode === 'text' || bodyMode === 'xml' ? bodyMode : null;

  return (
    <div className="flex h-full min-h-0 text-[13px]">
      <aside className="flex w-64 shrink-0 flex-col border-r border-[var(--hairline)]">
        <div className="flex items-center gap-2 px-3 pb-2 pt-3">
          <span className="section-label flex-1">Requests</span>
          <button className={ghostButton} onClick={createRequest}>
            Nova request
          </button>
        </div>
        <div className="flex items-center gap-2 px-3 pb-3">
          <select className={`${field} flex-1 font-sans`} value={environment?.path ?? ''} title="Ambiente ativo" onChange={(event) => chooseEnvironment(event.target.value)}>
            <option value="">Sem ambiente</option>
            {listing.environments.map((env) => (
              <option key={env.path} value={env.path}>
                {env.name}
              </option>
            ))}
          </select>
          <button className={`${ghostButton} shrink-0 ${view === 'environments' ? 'bg-[var(--hover-strong)] text-frost-100' : ''}`} onClick={() => setView(view === 'environments' ? 'request' : 'environments')}>
            Variáveis
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {groups.map(([folder, requests]) => (
            <div key={folder} className="mb-2">
              <div className="truncate px-2 py-1 font-mono text-[11px] text-frost-500" title={folder}>
                {folder || '/'}
              </div>
              {requests.map((request) => (
                <div
                  key={request.path}
                  className={`row group cursor-pointer px-2 ${request.path === selected && view === 'request' ? 'bg-[var(--hover-strong)] text-frost-100' : 'hover:bg-[var(--hover)]'}`}
                  title={request.url}
                  onClick={() => void select(request.path)}
                >
                  <Method value={request.method} />
                  <span className="flex-1 truncate">{request.name}</span>
                  <button
                    className="rounded px-1 text-frost-500 opacity-0 hover:text-danger group-hover:opacity-100"
                    title="Mover para a lixeira"
                    onClick={(event) => {
                      event.stopPropagation();
                      void deleteRequest(request.path);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ))}
          {!listing.requests.length && <p className="px-2 py-1 text-frost-500">Nenhuma request ainda. Crie a primeira ou copie uma coleção do Bruno para o vault.</p>}
        </div>
      </aside>

      {view === 'environments' ? (
        <section className="min-w-0 flex-1 overflow-y-auto p-5">
          <div className="mb-4 flex items-center gap-3">
            <h2 className="font-display text-xl font-semibold text-frost-100">Variáveis de ambiente</h2>
            <button className={ghostButton} onClick={createEnvironment}>
              Novo ambiente
            </button>
          </div>
          {environment ? (
            <>
              <p className="mb-3 text-frost-500">
                Ambiente <span className="text-frost-100">{environment.name}</span>. Use <code className="font-mono text-sheen-300">{'{{nome}}'}</code> na URL, nos headers, no corpo e na autenticação.
              </p>
              <PairTable
                rows={environment.variables}
                blank={{ name: '', value: '', enabled: true, secret: false }}
                namePlaceholder="Nome da variável"
                valueDisabled={(row) => (row.secret ? 'Secreta: o valor fica só no Bruno' : undefined)}
                onChange={(variables) => saveEnvironment(environment, variables)}
              />
            </>
          ) : (
            <p className="text-frost-500">Escolha um ambiente na lista ao lado ou crie um novo.</p>
          )}
        </section>
      ) : draft && selected ? (
        <section
          className="flex min-w-0 flex-1 flex-col"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void send();
          }}
        >
          <div className="px-5 pt-4">
            <input
              className="w-full bg-transparent font-display text-xl font-semibold text-frost-100 outline-none placeholder:text-frost-500"
              value={draft.meta.name}
              placeholder="Nome da request"
              spellCheck={false}
              onChange={(event) => update((r) => ({ ...r, meta: { ...r.meta, name: event.target.value } }))}
            />
            <div className="mt-3 flex gap-2">
              <select
                className={`${field} w-28 shrink-0 font-semibold`}
                style={{ color: METHOD_COLOR[draft.http.method.toUpperCase()] }}
                value={draft.http.method.toUpperCase()}
                onChange={(event) => update((r) => ({ ...r, http: { ...r.http, method: event.target.value.toLowerCase() } }))}
              >
                {METHODS.map((method) => (
                  <option key={method}>{method}</option>
                ))}
              </select>
              <input
                className={`${field} flex-1`}
                value={draft.http.url}
                placeholder="https://api.exemplo.com/recurso ou {{baseUrl}}/recurso"
                spellCheck={false}
                onChange={(event) => update((r) => ({ ...r, http: { ...r.http, url: event.target.value }, params: paramsFromUrl(event.target.value, r.params) }))}
              />
              {sendingId ? (
                <button className="shrink-0 rounded-md px-4 py-1.5 font-medium text-danger ring-1 ring-danger/50 hover:bg-danger/10" onClick={() => void window.api.httpCancel(sendingId)}>
                  Cancelar
                </button>
              ) : (
                <button className="shrink-0 rounded-md bg-sheen-400 px-4 py-1.5 font-semibold text-obsidian-950 hover:bg-sheen-300" onClick={() => void send()}>
                  Enviar
                </button>
              )}
            </div>
            {(problem || missing.length > 0) && (
              <p className="mt-2 text-[12.5px] text-danger">
                {problem || `Variáveis sem valor no ambiente ativo: ${missing.join(', ')}`}
              </p>
            )}
            <div className="mt-3">
              <Segmented
                value={tab}
                onChange={setTab}
                options={
                  [
                    ['params', `Parâmetros${draft.params?.length ? ` (${draft.params.length})` : ''}`],
                    ['headers', `Headers${draft.headers?.length ? ` (${draft.headers.length})` : ''}`],
                    ['body', 'Corpo'],
                    ['auth', 'Autenticação'],
                    ['docs', 'Anotações'],
                  ] as const
                }
              />
            </div>
          </div>

          <div className="max-h-[42%] min-h-32 shrink-0 overflow-y-auto px-5 py-3">
            {tab === 'params' && (
              <PairTable
                rows={draft.params ?? []}
                blank={{ name: '', value: '', enabled: true, type: 'query' } as Pair}
                namePlaceholder="Parâmetro"
                onChange={(params) => update((r) => ({ ...r, params, http: { ...r.http, url: urlFromParams(r.http.url, params) } }))}
              />
            )}
            {tab === 'headers' && (
              <PairTable rows={draft.headers ?? []} blank={{ name: '', value: '', enabled: true } as Pair} namePlaceholder="Header" onChange={(headers) => update((r) => ({ ...r, headers }))} />
            )}
            {tab === 'body' && (
              <div className="flex flex-col gap-3">
                <Segmented value={bodyMode} options={BODY_MODES} onChange={(mode) => update((r) => ({ ...r, http: { ...r.http, body: mode } }))} />
                {textBodyKey && (
                  <textarea
                    className={`${field} min-h-40 w-full resize-y leading-relaxed`}
                    value={(draft.body?.[textBodyKey] as string) ?? ''}
                    placeholder={textBodyKey === 'json' ? '{\n  "chave": "valor"\n}' : 'Conteúdo do corpo'}
                    spellCheck={false}
                    onChange={(event) => update((r) => ({ ...r, body: { ...r.body, [textBodyKey]: event.target.value } }))}
                  />
                )}
                {bodyMode === 'formUrlEncoded' && (
                  <PairTable
                    rows={draft.body?.formUrlEncoded ?? []}
                    blank={{ name: '', value: '', enabled: true } as Pair}
                    namePlaceholder="Campo"
                    onChange={(formUrlEncoded) => update((r) => ({ ...r, body: { ...r.body, formUrlEncoded } }))}
                  />
                )}
                {draft.http.body === 'multipartForm' && <p className="text-frost-500">Corpo multipart é preservado no arquivo, mas ainda não é editado nem enviado aqui.</p>}
              </div>
            )}
            {tab === 'auth' && (
              <div className="flex max-w-xl flex-col gap-3">
                <Segmented value={authMode} options={AUTH_MODES} onChange={(mode) => update((r) => ({ ...r, http: { ...r.http, auth: mode } }))} />
                {authMode === 'bearer' && (
                  <input className={`${field} w-full`} placeholder="Token" value={draft.auth?.bearer?.token ?? ''} spellCheck={false} onChange={(event) => update((r) => ({ ...r, auth: { ...r.auth, bearer: { token: event.target.value } } }))} />
                )}
                {authMode === 'basic' && (
                  <>
                    <input className={`${field} w-full`} placeholder="Usuário" value={draft.auth?.basic?.username ?? ''} spellCheck={false} onChange={(event) => update((r) => ({ ...r, auth: { ...r.auth, basic: { ...r.auth?.basic, username: event.target.value } } }))} />
                    <input className={`${field} w-full`} type="password" placeholder="Senha" value={draft.auth?.basic?.password ?? ''} onChange={(event) => update((r) => ({ ...r, auth: { ...r.auth, basic: { ...r.auth?.basic, password: event.target.value } } }))} />
                  </>
                )}
                {authMode === 'apikey' && (
                  <>
                    <input className={`${field} w-full`} placeholder="Nome da chave (ex.: X-API-Key)" value={draft.auth?.apikey?.key ?? ''} spellCheck={false} onChange={(event) => update((r) => ({ ...r, auth: { ...r.auth, apikey: { placement: 'header', ...r.auth?.apikey, key: event.target.value } } }))} />
                    <input className={`${field} w-full`} placeholder="Valor" value={draft.auth?.apikey?.value ?? ''} spellCheck={false} onChange={(event) => update((r) => ({ ...r, auth: { ...r.auth, apikey: { placement: 'header', ...r.auth?.apikey, value: event.target.value } } }))} />
                    <Segmented
                      value={draft.auth?.apikey?.placement === 'queryparams' ? 'queryparams' : 'header'}
                      options={[['header', 'Enviar no header'], ['queryparams', 'Enviar na query']] as const}
                      onChange={(placement) => update((r) => ({ ...r, auth: { ...r.auth, apikey: { ...r.auth?.apikey, placement } } }))}
                    />
                  </>
                )}
                {draft.http.auth === 'inherit' && <p className="text-frost-500">No Bruno esta request herda a autenticação da coleção; aqui ela é enviada sem autenticação.</p>}
              </div>
            )}
            {tab === 'docs' && (
              <textarea
                className={`${field} min-h-40 w-full resize-y font-sans leading-relaxed`}
                value={draft.docs ?? ''}
                placeholder="Anotações sobre esta request (Markdown)."
                onChange={(event) => update((r) => ({ ...r, docs: event.target.value }))}
              />
            )}
          </div>

          <div className="flex min-h-0 flex-1 flex-col border-t border-[var(--hairline)] bg-obsidian-950/40">
            <ResponseView result={result} sending={Boolean(sendingId)} />
          </div>
        </section>
      ) : (
        <section className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 text-frost-500">
          <p className="font-display text-lg text-frost-100">Nenhuma request selecionada</p>
          <button className={ghostButton} onClick={createRequest}>
            Nova request
          </button>
        </section>
      )}
    </div>
  );
}
