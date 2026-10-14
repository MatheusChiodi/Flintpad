import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { Trans, useT, type Translate } from '../lib/i18n';
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
  groupByDay,
  historyResult,
  type HistoryEntry,
} from '../lib/request';
import { requestLinkMarkdown, requestMentions } from '../lib/links';
import { focusRequestEvent, setRequestIndex, takeFocusedRequest } from '../lib/requestIndex';
import type { Note } from '../types';

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

// Nomes de formato e de esquema (JSON, Bearer…) são os mesmos em qualquer língua.
const bodyModes = (t: Translate) =>
  [
    ['none', t('requests.body.none')],
    ['json', 'JSON'],
    ['text', t('requests.body.text')],
    ['xml', 'XML'],
    ['formUrlEncoded', 'Form URL-encoded'],
  ] as const;

const authModes = (t: Translate) =>
  [
    ['none', t('requests.auth.none')],
    ['bearer', 'Bearer token'],
    ['basic', 'Basic'],
    ['apikey', 'API key'],
  ] as const;

type BodyChoice = ReturnType<typeof bodyModes>[number][0];
type AuthChoice = ReturnType<typeof authModes>[number][0];

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
    <div className="flex flex-wrap gap-1">
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
  valuePlaceholder,
  valueDisabled,
}: {
  rows: T[];
  blank: T;
  onChange: (rows: T[]) => void;
  namePlaceholder: string;
  valuePlaceholder?: string;
  valueDisabled?: (row: T) => string | undefined;
}) {
  const t = useT();
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
              title={row.enabled ? t('requests.row.disable') : t('requests.row.enable')}
              onChange={(event) => patch(index, { enabled: event.target.checked } as Partial<T>)}
            />
            <input className={`${field} flex-[2]`} placeholder={namePlaceholder} value={row.name} spellCheck={false} onChange={(event) => patch(index, { name: event.target.value } as Partial<T>)} />
            <input
              className={`${field} flex-[3] disabled:opacity-50`}
              placeholder={lockedReason ?? valuePlaceholder ?? t('common.value')}
              value={lockedReason ? '' : row.value}
              disabled={Boolean(lockedReason)}
              spellCheck={false}
              onChange={(event) => patch(index, { value: event.target.value } as Partial<T>)}
            />
            <button className="rounded px-1.5 py-1 text-frost-500 hover:bg-[var(--hover)] hover:text-danger" title={t('requests.row.remove')} onClick={() => onChange(rows.filter((_, i) => i !== index))}>
              ×
            </button>
          </div>
        );
      })}
      <button className={`${ghostButton} self-start`} onClick={() => onChange([...rows, blank])}>
        {t('requests.row.add')}
      </button>
    </div>
  );
}

function ResponseView({ result, sending }: { result: HttpResult | null; sending: boolean }) {
  const t = useT();
  const [tab, setTab] = useState<'body' | 'headers'>('body');
  const pretty = useMemo(() => (result?.ok ? formatBody(result.body, result.headers) : ''), [result]);

  if (sending) return <p className="p-4 text-frost-500">{t('requests.response.sending')}</p>;
  if (!result) return <p className="p-4 text-frost-500">{t('requests.response.idle')}</p>;
  if (!result.ok) {
    return (
      <div className="p-4">
        <p className="font-medium text-danger">{result.cancelled ? t('requests.response.cancelled') : t('requests.response.failed')}</p>
        {!result.cancelled && <p className="mt-1 font-mono text-[12.5px] text-frost-300">{result.error}</p>}
      </div>
    );
  }

  const statusColor = result.status < 300 ? '#86d9cd' : result.status < 400 ? '#e6c07b' : '#f0908d';
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-4 px-4 py-2">
        <Segmented value={tab} onChange={setTab} options={[['body', t('requests.tab.body')], ['headers', t('requests.tabCount', { label: t('requests.tab.headers'), count: result.headers.length })]] as const} />
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
              {pretty.slice(0, MAX_SHOWN_CHARS) || <span className="text-frost-500">{t('requests.response.noBody')}</span>}
            </pre>
            {(pretty.length > MAX_SHOWN_CHARS || result.truncated) && <p className="mt-2 text-frost-500">{t('requests.response.truncated')}</p>}
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
type SaveDialog = { request: BruRequest; name: string; folder: string };

// Rascunhos não salvos por request: sobrevivem à troca de request e de aba (Ctrl+S grava).
const drafts = new Map<string, BruRequest>();

const requestFolder = (path: string) => dirName(path).replace(/\/$/, '') || ROOT_FOLDER;
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const shortUrl = (url: string) => url.replace(/^https?:\/\//i, '');

function StatusBadge({ result }: { result: HttpResult }) {
  const t = useT();
  if (!result.ok) return <span className="font-mono text-[10.5px] text-danger">{result.cancelled ? t('requests.history.cancelled') : t('requests.history.failed')}</span>;
  const color = result.status < 300 ? '#86d9cd' : result.status < 400 ? '#e6c07b' : '#f0908d';
  return (
    <span className="font-mono text-[10.5px] font-semibold" style={{ color }}>
      {result.status}
    </span>
  );
}

type Props = { notes: Note[]; contents: Record<string, string>; onOpenNote: (path: string) => void };

export function Requests({ notes, contents, onOpenNote }: Props) {
  const t = useT();
  const [listing, setListing] = useState<Listing>({ requests: [], environments: [] });
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<BruRequest | null>(null);
  const [view, setView] = useState<'request' | 'environments' | 'history'>('request');
  const [side, setSide] = useState<'collection' | 'history'>('collection');
  const [tab, setTab] = useState<RequestTab>('params');
  const [envPath, setEnvPath] = useState(() => localStorage.getItem(ENV_STORAGE_KEY) ?? '');
  const [result, setResult] = useState<HttpResult | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  const [notice, setNotice] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<SaveDialog | null>(null);
  const [, setDraftVersion] = useState(0);
  const envPending = useRef<{ timer: number; write?: () => Promise<void> }>({ timer: 0 });

  const environment = listing.environments.find((e) => e.path === envPath);
  const vars = useMemo(() => envToVars(environment), [environment]);
  const dirty = selected !== null && drafts.has(selected);

  const refresh = async () => {
    const next: Listing = await window.api.bruList();
    setListing(next);
    setRequestIndex(next.requests);
    return next;
  };

  const flash = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice((current) => (current === text ? '' : current)), 3500);
  };

  const select = async (path: string, known: HistoryEntry[] = history) => {
    const request = drafts.get(path) ?? (await window.api.bruRead(path));
    setDraft(request);
    setSelected(path);
    setView('request');
    setSide('collection');
    setHistoryId(null);
    // A última resposta desta request, se houver, aparece de volta.
    setResult(known.find((entry) => entry.source === path)?.result ?? null);
    setProblem('');
  };
  const selectRef = useRef(select);
  selectRef.current = select;

  useEffect(() => {
    void (async () => {
      const [next, past] = await Promise.all([refresh(), window.api.historyList().catch(() => [] as HistoryEntry[])]);
      setHistory(past);
      const wanted = takeFocusedRequest();
      const first = wanted ?? next.requests[0]?.path;
      if (first) await select(first, past);
    })();
    // Link numa página com a aba já aberta: troca para a request citada.
    const onFocus = () => {
      const path = takeFocusedRequest();
      if (path) void selectRef.current(path);
    };
    window.addEventListener(focusRequestEvent, onFocus);
    const pending = envPending.current;
    return () => {
      window.removeEventListener(focusRequestEvent, onFocus);
      // Variáveis editadas logo antes de sair da aba ainda são gravadas.
      window.clearTimeout(pending.timer);
      void pending.write?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (change: (request: BruRequest) => BruRequest) => {
    if (!draft || !selected) return;
    const next = change(draft);
    const path = selected;
    drafts.set(path, next);
    setDraft(next);
    setListing((prev) => ({
      ...prev,
      requests: prev.requests.map((r) => (r.path === path ? { ...r, name: next.meta.name, method: next.http.method, url: next.http.url } : r)),
    }));
  };

  const save = async () => {
    if (!selected || !draft || !drafts.has(selected)) return;
    const path = selected;
    const request = draft;
    try {
      await window.api.bruWrite(path, request);
      // Só limpa se nada mudou durante a gravação.
      if (drafts.get(path) === request) drafts.delete(path);
      setDraftVersion((n) => n + 1);
      await refresh();
      flash(t('requests.saved'));
    } catch (error) {
      setProblem((error as Error).message);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  // Ctrl+S salva a request aberta (a aba só existe montada quando está à vista).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const createRequest = async () => {
    const folder = selected ? requestFolder(selected) : ROOT_FOLDER;
    const path: string = await window.api.bruCreate(folder, t('requests.new'));
    await refresh();
    await select(path);
  };

  const deleteRequest = async (path: string) => {
    drafts.delete(path);
    if (path === selected) {
      setSelected(null);
      setDraft(null);
    }
    await window.api.remove(path);
    await refresh();
  };

  const openSaveDialog = (request: BruRequest, name: string, folder: string) => setDialog({ request, name, folder });

  const confirmSave = async () => {
    if (!dialog) return;
    const name = dialog.name.trim().replace(/[\\/:*?"<>|]/g, '');
    const folder = dialog.folder.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') || ROOT_FOLDER;
    if (!name) return;
    try {
      const path: string = await window.api.bruCreate(folder, name);
      await window.api.bruWrite(path, { ...dialog.request, meta: { ...dialog.request.meta, name } });
      setDialog(null);
      await refresh();
      await select(path);
      flash(t('requests.saved'));
    } catch (error) {
      setProblem((error as Error).message);
    }
  };

  const copyLink = async (path: string, name: string) => {
    await navigator.clipboard.writeText(requestLinkMarkdown(path, name));
    flash(t('requests.linkCopied'));
  };

  // Envia a request (a aberta ou uma do histórico) e guarda o envio no histórico.
  const send = async (request: BruRequest | null = draft, source: string | null = selected) => {
    if (!request || sendingId) return;
    setProblem('');
    const id = crypto.randomUUID();
    let outgoing;
    try {
      outgoing = buildRequest(request, vars, id);
    } catch (error) {
      return setProblem((error as Error).message);
    }
    setSendingId(id);
    setResult(null);
    const response = await window.api.httpSend(outgoing);
    setResult(response);
    setSendingId(null);
    const entry: HistoryEntry = {
      id,
      at: new Date().toISOString(),
      source,
      name: request.meta.name,
      method: outgoing.method,
      url: outgoing.url,
      environment: environment?.name ?? null,
      request,
      result: historyResult(response),
    };
    setHistory((prev) => [entry, ...prev].slice(0, 200));
    if (view === 'history') setHistoryId(id);
    void window.api.historyAdd(entry).catch(() => {});
  };

  const saveEnvironment = (env: Environment, variables: EnvVar[]) => {
    setListing((prev) => ({ ...prev, environments: prev.environments.map((e) => (e.path === env.path ? { ...e, variables } : e)) }));
    const pending = envPending.current;
    window.clearTimeout(pending.timer);
    pending.write = () => window.api.envWrite(env.path, variables);
    pending.timer = window.setTimeout(() => {
      void pending.write?.();
      pending.write = undefined;
    }, SAVE_DELAY_MS);
  };

  const createEnvironment = async () => {
    const taken = new Set(listing.environments.map((e) => e.name));
    const base = t('requests.env.defaultName');
    let name = base;
    for (let i = 2; taken.has(name); i++) name = `${base} ${i}`;
    const path = `${ROOT_FOLDER}/environments/${name}.bru`;
    await window.api.envWrite(path, [{ name: 'baseUrl', value: 'https://', enabled: true, secret: false }]);
    await refresh();
    chooseEnvironment(path);
  };

  const chooseEnvironment = (path: string) => {
    setEnvPath(path);
    localStorage.setItem(ENV_STORAGE_KEY, path);
  };

  const removeHistory = async (id: string) => {
    setHistory((prev) => prev.filter((entry) => entry.id !== id));
    if (historyId === id) {
      setHistoryId(null);
      setView('request');
    }
    await window.api.historyRemove(id).catch(() => {});
  };

  const clearHistory = async () => {
    setHistory([]);
    setHistoryId(null);
    if (view === 'history') setView('request');
    await window.api.historyClear().catch(() => {});
  };

  const groups = useMemo(() => {
    const byFolder = new Map<string, RequestSummary[]>();
    for (const request of listing.requests) {
      const folder = dirName(request.path).replace(/\/$/, '');
      byFolder.set(folder, [...(byFolder.get(folder) ?? []), request]);
    }
    return [...byFolder.entries()];
  }, [listing.requests]);

  const folders = useMemo(() => [...new Set([ROOT_FOLDER, ...listing.requests.map((r) => requestFolder(r.path))])].sort(), [listing.requests]);
  const mentions = useMemo(() => (selected ? requestMentions(selected, notes, contents) : []), [selected, notes, contents]);
  const historyEntry = history.find((entry) => entry.id === historyId) ?? null;

  const dayLabel = (day: string) => {
    const today = new Date();
    const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const yesterday = new Date(today.getTime() - 86_400_000);
    // As datas do histórico estão em UTC; o rótulo usa o dia local de cada envio.
    if (day === iso(today)) return t('requests.history.today');
    if (day === iso(yesterday)) return t('requests.history.yesterday');
    return new Date(`${day}T12:00:00`).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
  };
  const localDay = (iso: string) => {
    const date = new Date(iso);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const historyGroups = useMemo(() => groupByDay(history.map((entry) => ({ ...entry, at: localDay(entry.at) + entry.at.slice(10) }))), [history]);

  const missing = draft ? unresolvedVariables(draft, vars) : [];
  const bodyMode = (draft?.http.body ?? 'none') as BodyChoice;
  const authMode = (draft?.http.auth === 'inherit' ? 'none' : draft?.http.auth ?? 'none') as AuthChoice;
  const counted = (label: string, count?: number) => (count ? t('requests.tabCount', { label, count }) : label);
  const textBodyKey = bodyMode === 'json' || bodyMode === 'text' || bodyMode === 'xml' ? bodyMode : null;
  const toolButton = 'rounded-md px-2 py-1 text-[12px] text-frost-500 transition-colors hover:bg-[var(--hover)] hover:text-frost-100';

  return (
    <div className="relative flex h-full min-h-0 text-[13px]">
      <aside className="flex w-64 shrink-0 flex-col border-r border-[var(--hairline)] max-[1100px]:w-52 max-[820px]:w-44">
        <div className="flex items-center gap-2 px-3 pb-2 pt-3">
          <Segmented
            value={side}
            onChange={setSide}
            options={[['collection', t('requests.collection')], ['history', counted(t('requests.history'), history.length)]] as const}
          />
          <span className="flex-1" />
          {side === 'collection' && (
            <button className={`${ghostButton} shrink-0`} onClick={createRequest} title={t('requests.new')}>
              +
            </button>
          )}
        </div>

        {side === 'collection' ? (
          <>
            <div className="flex items-center gap-2 px-3 pb-3">
              <select className={`${field} flex-1 font-sans`} value={environment?.path ?? ''} title={t('requests.activeEnvironment')} onChange={(event) => chooseEnvironment(event.target.value)}>
                <option value="">{t('requests.noEnvironment')}</option>
                {listing.environments.map((env) => (
                  <option key={env.path} value={env.path}>
                    {env.name}
                  </option>
                ))}
              </select>
              <button className={`${ghostButton} shrink-0 ${view === 'environments' ? 'bg-[var(--hover-strong)] text-frost-100' : ''}`} onClick={() => setView(view === 'environments' ? 'request' : 'environments')}>
                {t('requests.variables')}
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
                      {drafts.has(request.path) && <span className="size-1.5 shrink-0 rounded-full bg-sheen-400 group-hover:hidden" title={t('requests.unsaved')} />}
                      <button
                        className="rounded px-1 text-frost-500 opacity-0 hover:text-danger group-hover:opacity-100"
                        title={t('common.moveToTrash')}
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
              {!listing.requests.length && <p className="px-2 py-1 text-frost-500">{t('requests.empty')}</p>}
            </div>
          </>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {!history.length && <p className="px-2 py-1 text-frost-500">{t('requests.history.empty')}</p>}
            {historyGroups.map(([day, entries]) => (
              <div key={day} className="mb-2">
                <div className="px-2 py-1 text-[11px] font-medium text-frost-500">{dayLabel(day)}</div>
                {entries.map((entry) => (
                  <div
                    key={entry.id}
                    className={`group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 ${entry.id === historyId && view === 'history' ? 'bg-[var(--hover-strong)] text-frost-100' : 'hover:bg-[var(--hover)]'}`}
                    title={entry.url}
                    onClick={() => {
                      setHistoryId(entry.id);
                      setView('history');
                      setProblem('');
                    }}
                  >
                    <Method value={entry.method} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{entry.name}</span>
                      <span className="block truncate font-mono text-[10.5px] text-frost-500">{shortUrl(entry.url)}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-0.5">
                      <StatusBadge result={entry.result} />
                      <span className="font-mono text-[10px] text-frost-500">{timeOf(history.find((item) => item.id === entry.id)?.at ?? entry.at)}</span>
                    </span>
                  </div>
                ))}
              </div>
            ))}
            {history.length > 0 && (
              <button className={`${ghostButton} mx-2 mt-2`} onClick={() => void clearHistory()}>
                {t('requests.history.clear')}
              </button>
            )}
          </div>
        )}
      </aside>

      {view === 'environments' ? (
        <section className="min-w-0 flex-1 overflow-y-auto p-5">
          <div className="mb-4 flex items-center gap-3">
            <h2 className="font-display text-xl font-semibold text-frost-100">{t('requests.env.title')}</h2>
            <button className={ghostButton} onClick={createEnvironment}>
              {t('requests.env.new')}
            </button>
          </div>
          {environment ? (
            <>
              <p className="mb-3 text-frost-500">
                <Trans
                  k="requests.env.help"
                  values={{
                    name: <span className="text-frost-100">{environment.name}</span>,
                    variable: <code className="font-mono text-sheen-300">{t('requests.env.example')}</code>,
                  }}
                />
              </p>
              <PairTable
                rows={environment.variables}
                blank={{ name: '', value: '', enabled: true, secret: false }}
                namePlaceholder={t('requests.env.variableName')}
                valueDisabled={(row) => (row.secret ? t('requests.env.secret') : undefined)}
                onChange={(variables) => saveEnvironment(environment, variables)}
              />
            </>
          ) : (
            <p className="text-frost-500">{t('requests.env.choose')}</p>
          )}
        </section>
      ) : view === 'history' && historyEntry ? (
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="px-5 pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="min-w-0 flex-1 truncate font-display text-xl font-semibold text-frost-100">{historyEntry.name}</h2>
              {historyEntry.source && listing.requests.some((r) => r.path === historyEntry.source) ? (
                <button className={toolButton} onClick={() => void select(historyEntry.source!)}>
                  {t('requests.history.openSource')}
                </button>
              ) : (
                historyEntry.source && <span className="text-[12px] text-frost-500">{t('requests.history.sourceGone')}</span>
              )}
              <button className={toolButton} onClick={() => openSaveDialog(historyEntry.request, historyEntry.name, historyEntry.source ? requestFolder(historyEntry.source) : ROOT_FOLDER)}>
                {t('requests.history.saveToCollection')}
              </button>
              <button className={`${toolButton} hover:text-danger`} onClick={() => void removeHistory(historyEntry.id)}>
                {t('requests.history.remove')}
              </button>
              {sendingId ? (
                <button className="shrink-0 rounded-md px-4 py-1.5 font-medium text-danger ring-1 ring-danger/50 hover:bg-danger/10" onClick={() => void window.api.httpCancel(sendingId)}>
                  {t('requests.cancel')}
                </button>
              ) : (
                <button className="shrink-0 rounded-md bg-sheen-400 px-4 py-1.5 font-semibold text-obsidian-950 hover:bg-sheen-300" onClick={() => void send(historyEntry.request, historyEntry.source)}>
                  {t('requests.history.resend')}
                </button>
              )}
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-md bg-obsidian-950/60 px-3 py-2 ring-1 ring-[var(--hairline-strong)]">
              <Method value={historyEntry.method} />
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-frost-100 select-text">{historyEntry.url}</span>
            </div>
            <p className="mt-2 text-[12px] text-frost-500">
              {t('requests.history.sentAt', { time: `${new Date(historyEntry.at).toLocaleDateString()} ${timeOf(historyEntry.at)}` })}
              {historyEntry.environment && ` · ${t('requests.history.environment', { name: historyEntry.environment })}`}
            </p>
            {problem && <p className="mt-2 text-[12.5px] text-danger">{problem}</p>}
          </div>
          <div className="mt-3 flex min-h-0 flex-1 flex-col border-t border-[var(--hairline)] bg-obsidian-950/40">
            <ResponseView result={sendingId ? null : historyEntry.result} sending={Boolean(sendingId)} />
          </div>
        </section>
      ) : draft && selected ? (
        <section
          className="flex min-w-0 flex-1 flex-col"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void send();
          }}
        >
          <div className="px-5 pt-4">
            <div className="flex items-center gap-2">
              <input
                className="min-w-0 flex-1 bg-transparent font-display text-xl font-semibold text-frost-100 outline-none placeholder:text-frost-500"
                value={draft.meta.name}
                placeholder={t('requests.namePlaceholder')}
                spellCheck={false}
                onChange={(event) => update((r) => ({ ...r, meta: { ...r.meta, name: event.target.value } }))}
              />
              <button
                className={`shrink-0 rounded-md px-3 py-1 text-[12.5px] font-medium transition-colors ${dirty ? 'bg-sheen-400/15 text-sheen-300 ring-1 ring-sheen-400/40 hover:bg-sheen-400/25' : 'text-frost-500'}`}
                disabled={!dirty}
                title={dirty ? t('requests.unsaved') : undefined}
                onClick={() => void save()}
              >
                {dirty ? t('requests.save') : t('requests.saved')}
              </button>
              <button className={toolButton} onClick={() => openSaveDialog(draft, draft.meta.name, requestFolder(selected))}>
                {t('requests.saveAs')}
              </button>
              <button className={toolButton} onClick={() => openSaveDialog(draft, `${draft.meta.name} ${t('requests.copySuffix')}`, requestFolder(selected))}>
                {t('requests.duplicate')}
              </button>
              <button className={toolButton} onClick={() => void copyLink(selected, draft.meta.name)}>
                {t('requests.copyLink')}
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
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
                className={`${field} min-w-48 flex-1`}
                value={draft.http.url}
                placeholder={t('requests.urlPlaceholder')}
                spellCheck={false}
                onChange={(event) => update((r) => ({ ...r, http: { ...r.http, url: event.target.value }, params: paramsFromUrl(event.target.value, r.params) }))}
              />
              {sendingId ? (
                <button className="shrink-0 rounded-md px-4 py-1.5 font-medium text-danger ring-1 ring-danger/50 hover:bg-danger/10" onClick={() => void window.api.httpCancel(sendingId)}>
                  {t('requests.cancel')}
                </button>
              ) : (
                <button className="shrink-0 rounded-md bg-sheen-400 px-4 py-1.5 font-semibold text-obsidian-950 hover:bg-sheen-300" onClick={() => void send()}>
                  {t('requests.send')}
                </button>
              )}
            </div>
            {(problem || missing.length > 0) && (
              <p className="mt-2 text-[12.5px] text-danger">
                {problem || t('requests.missingVariables', { names: missing.join(', ') })}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
              <span className="text-frost-500">{t('requests.mentions')}:</span>
              {mentions.length ? (
                mentions.map((note) => (
                  <button key={note.path} className="rounded-full px-2 py-0.5 text-sheen-300 ring-1 ring-[var(--hairline-strong)] transition-colors hover:bg-[var(--hover)]" title={note.path} onClick={() => onOpenNote(note.path)}>
                    {note.name}
                  </button>
                ))
              ) : (
                <span className="text-frost-500">{t('requests.noMentions')}</span>
              )}
            </div>
            <div className="mt-3">
              <Segmented
                value={tab}
                onChange={setTab}
                options={
                  [
                    ['params', counted(t('requests.tab.params'), draft.params?.length)],
                    ['headers', counted(t('requests.tab.headers'), draft.headers?.length)],
                    ['body', t('requests.tab.body')],
                    ['auth', t('requests.tab.auth')],
                    ['docs', t('requests.tab.docs')],
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
                namePlaceholder={t('requests.param')}
                onChange={(params) => update((r) => ({ ...r, params, http: { ...r.http, url: urlFromParams(r.http.url, params) } }))}
              />
            )}
            {tab === 'headers' && (
              <PairTable rows={draft.headers ?? []} blank={{ name: '', value: '', enabled: true } as Pair} namePlaceholder={t('requests.header')} onChange={(headers) => update((r) => ({ ...r, headers }))} />
            )}
            {tab === 'body' && (
              <div className="flex flex-col gap-3">
                <Segmented value={bodyMode} options={bodyModes(t)} onChange={(mode) => update((r) => ({ ...r, http: { ...r.http, body: mode } }))} />
                {textBodyKey && (
                  <textarea
                    className={`${field} min-h-40 w-full resize-y leading-relaxed`}
                    value={(draft.body?.[textBodyKey] as string) ?? ''}
                    placeholder={textBodyKey === 'json' ? t('requests.body.jsonPlaceholder') : t('requests.body.placeholder')}
                    spellCheck={false}
                    onChange={(event) => update((r) => ({ ...r, body: { ...r.body, [textBodyKey]: event.target.value } }))}
                  />
                )}
                {bodyMode === 'formUrlEncoded' && (
                  <PairTable
                    rows={draft.body?.formUrlEncoded ?? []}
                    blank={{ name: '', value: '', enabled: true } as Pair}
                    namePlaceholder={t('requests.field')}
                    onChange={(formUrlEncoded) => update((r) => ({ ...r, body: { ...r.body, formUrlEncoded } }))}
                  />
                )}
                {draft.http.body === 'multipartForm' && <p className="text-frost-500">{t('requests.body.multipart')}</p>}
              </div>
            )}
            {tab === 'auth' && (
              <div className="flex max-w-xl flex-col gap-3">
                <Segmented value={authMode} options={authModes(t)} onChange={(mode) => update((r) => ({ ...r, http: { ...r.http, auth: mode } }))} />
                {authMode === 'bearer' && (
                  <input className={`${field} w-full`} placeholder="Token" value={draft.auth?.bearer?.token ?? ''} spellCheck={false} onChange={(event) => update((r) => ({ ...r, auth: { ...r.auth, bearer: { token: event.target.value } } }))} />
                )}
                {authMode === 'basic' && (
                  <>
                    <input className={`${field} w-full`} placeholder={t('requests.auth.user')} value={draft.auth?.basic?.username ?? ''} spellCheck={false} onChange={(event) => update((r) => ({ ...r, auth: { ...r.auth, basic: { ...r.auth?.basic, username: event.target.value } } }))} />
                    <input className={`${field} w-full`} type="password" placeholder={t('requests.auth.password')} value={draft.auth?.basic?.password ?? ''} onChange={(event) => update((r) => ({ ...r, auth: { ...r.auth, basic: { ...r.auth?.basic, password: event.target.value } } }))} />
                  </>
                )}
                {authMode === 'apikey' && (
                  <>
                    <input className={`${field} w-full`} placeholder={t('requests.auth.keyName')} value={draft.auth?.apikey?.key ?? ''} spellCheck={false} onChange={(event) => update((r) => ({ ...r, auth: { ...r.auth, apikey: { placement: 'header', ...r.auth?.apikey, key: event.target.value } } }))} />
                    <input className={`${field} w-full`} placeholder={t('common.value')} value={draft.auth?.apikey?.value ?? ''} spellCheck={false} onChange={(event) => update((r) => ({ ...r, auth: { ...r.auth, apikey: { placement: 'header', ...r.auth?.apikey, value: event.target.value } } }))} />
                    <Segmented
                      value={draft.auth?.apikey?.placement === 'queryparams' ? 'queryparams' : 'header'}
                      options={[['header', t('requests.auth.inHeader')], ['queryparams', t('requests.auth.inQuery')]] as const}
                      onChange={(placement) => update((r) => ({ ...r, auth: { ...r.auth, apikey: { ...r.auth?.apikey, placement } } }))}
                    />
                  </>
                )}
                {draft.http.auth === 'inherit' && <p className="text-frost-500">{t('requests.auth.inherit')}</p>}
              </div>
            )}
            {tab === 'docs' && (
              <textarea
                className={`${field} min-h-40 w-full resize-y font-sans leading-relaxed`}
                value={draft.docs ?? ''}
                placeholder={t('requests.docsPlaceholder')}
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
          <p className="font-display text-lg text-frost-100">{t('requests.noneSelected')}</p>
          <button className={ghostButton} onClick={createRequest}>
            {t('requests.new')}
          </button>
        </section>
      )}

      {notice && (
        <div role="status" className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-obsidian-800 px-3.5 py-2 text-[12.5px] text-frost-100 shadow-lg ring-1 ring-[var(--hairline-strong)]">
          {notice}
        </div>
      )}

      {dialog && (
        <div className="scrim absolute inset-0 z-30 flex items-start justify-center pt-24" onMouseDown={() => setDialog(null)}>
          <form
            className="w-[min(420px,calc(100%-32px))] rounded-xl bg-obsidian-800 p-5 shadow-2xl ring-1 ring-[var(--hairline-strong)]"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              void confirmSave();
            }}
            onKeyDown={(event) => event.key === 'Escape' && setDialog(null)}
          >
            <h2 className="font-display text-lg font-semibold text-frost-100">{t('requests.saveDialog.title')}</h2>
            <label className="mt-4 block text-[12px] text-frost-500">
              {t('requests.saveDialog.name')}
              <input autoFocus className={`${field} mt-1 w-full font-sans`} value={dialog.name} spellCheck={false} onChange={(event) => setDialog({ ...dialog, name: event.target.value })} />
            </label>
            <label className="mt-3 block text-[12px] text-frost-500">
              {t('requests.saveDialog.folder')}
              <input className={`${field} mt-1 w-full`} list="request-folders" value={dialog.folder} spellCheck={false} onChange={(event) => setDialog({ ...dialog, folder: event.target.value })} />
              <datalist id="request-folders">
                {folders.map((folder) => (
                  <option key={folder} value={folder} />
                ))}
              </datalist>
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className={ghostButton} onClick={() => setDialog(null)}>
                {t('requests.cancel')}
              </button>
              <button type="submit" className="rounded-md bg-sheen-400 px-4 py-1.5 font-semibold text-obsidian-950 hover:bg-sheen-300 disabled:opacity-50" disabled={!dialog.name.trim()}>
                {t('requests.saveDialog.confirm')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
