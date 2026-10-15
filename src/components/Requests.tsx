import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import { Trans, useT, type Translate } from '../lib/i18n';
import { dirName, requestLinkMarkdown, requestMentions } from '../lib/links';
import {
  buildRequest,
  envToVars,
  formatSize,
  groupByDay,
  historyResult,
  METHODS,
  paramsFromUrl,
  unresolvedVariables,
  urlFromParams,
  type BruRequest,
  type Environment,
  type EnvVar,
  type HistoryEntry,
  type HttpResult,
  type Pair,
  type RequestSummary,
} from '../lib/request';
import { focusRequestEvent, setRequestIndex, takeFocusedRequest } from '../lib/requestIndex';
import {
  applyCurl,
  ASSERT_OPERATORS,
  collectionToMarkdown,
  COMMON_HEADER_VALUES,
  COMMON_HEADERS,
  evaluateAssertions,
  filterHistory,
  formatJsonBody,
  looksLikeCurl,
  matchesRequestQuery,
  parseCurl,
  pathParamNames,
  responseToMarkdown,
  safeFileName,
  STATUS_FILTERS,
  syncPathParams,
  uniqueName,
  type Assertion,
  type DocLabels,
  type StatusFilter,
} from '../lib/requestTools';
import type { Note } from '../types';
import { ChevronIcon, CodeIcon, EyeIcon, PageIcon, PlayIcon, PlusIcon, RequestIcon, TrashIcon, VariablesIcon } from './Icons';
import { CodeDialog } from './requests/CodeDialog';
import { ResponsePanel } from './requests/ResponsePanel';
import { Runner } from './requests/Runner';
import { dangerButton, field, ghostButton, iconButton, Method, METHOD_COLOR, PairTable, primaryButton, Segmented, statusColor, toolButton } from './requests/ui';

const ROOT_FOLDER = 'Requests';
const ENV_FOLDER = `${ROOT_FOLDER}/environments`;
const SAVE_DELAY_MS = 500;
const ENV_STORAGE_KEY = 'obnotion:environment';
const COLLAPSED_STORAGE_KEY = 'obnotion:requests-collapsed';

// localStorage pode faltar (janela privada, dados bloqueados): a tela segue sem lembrar.
const readStored = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writeStored = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // sem armazenamento: só não lembra a escolha
  }
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

type Listing = { requests: RequestSummary[]; environments: Environment[] };
type RequestTab = 'params' | 'headers' | 'body' | 'auth' | 'asserts' | 'docs';
type SaveDialog = { request: BruRequest; name: string; folder: string };
type View = 'request' | 'environments' | 'history' | 'runner';

const ASSERT_TARGETS = ['res.status', 'res.statusText', 'res.responseTime', 'res.body', 'res.headers.content-type'];
const headerValues = (name: string) => COMMON_HEADER_VALUES[name.toLowerCase()];

// Rascunhos não salvos por request: sobrevivem à troca de request e de aba (Ctrl+S grava).
const drafts = new Map<string, BruRequest>();

const requestFolder = (path: string) => dirName(path).replace(/\/$/, '') || ROOT_FOLDER;
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const shortUrl = (url: string) => url.replace(/^https?:\/\//i, '');
// Na lista a pasta aparece sem o prefixo da raiz (Requests/Usuarios → Usuarios); o caminho inteiro fica na dica.
const folderLabel = (folder: string) => (!folder ? '/' : folder.startsWith(`${ROOT_FOLDER}/`) ? folder.slice(ROOT_FOLDER.length + 1) : folder);

// Aviso de erro: uma faixa tingida, legível e separada do resto do cabeçalho.
const problemBox = 'rounded-md bg-danger/10 px-2.5 py-1.5 text-[12.5px] text-danger ring-1 ring-danger/25';
const localDay = (iso: string) => {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

function StatusBadge({ result }: { result: HttpResult }) {
  const t = useT();
  if (!result.ok) return <span className="font-mono text-[10.5px] text-danger">{result.cancelled ? t('requests.history.cancelled') : t('requests.history.failed')}</span>;
  return (
    <span className="font-mono text-[10.5px] font-semibold" style={{ color: statusColor(result.status) }}>
      {result.status}
    </span>
  );
}

// Campo de segredo (token, senha, valor da API key): escondido até pedir para mostrar.
function SecretInput({ value, placeholder, revealed, onReveal, onChange }: { value: string; placeholder: string; revealed: boolean; onReveal: () => void; onChange: (value: string) => void }) {
  const t = useT();
  return (
    <div className="flex items-center gap-1.5">
      <input
        className={`${field} w-full`}
        type={revealed ? 'text' : 'password'}
        placeholder={placeholder}
        aria-label={placeholder}
        value={value}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
      />
      <button type="button" className={iconButton} title={revealed ? t('requests.secret.hide') : t('requests.secret.show')} aria-label={revealed ? t('requests.secret.hide') : t('requests.secret.show')} aria-pressed={revealed} onClick={onReveal}>
        <EyeIcon size={14} off={revealed} />
      </button>
    </div>
  );
}

type Props = {
  notes: Note[];
  contents: Record<string, string>;
  onOpenNote: (path: string) => void;
  /** Cria uma página com o conteúdo dado e a abre (resposta salva, documentação da pasta). */
  onCreateNote?: (name: string, content: string) => Promise<void>;
};

export function Requests({ notes, contents, onOpenNote, onCreateNote }: Props) {
  const t = useT();
  const [listing, setListing] = useState<Listing>({ requests: [], environments: [] });
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<BruRequest | null>(null);
  const [view, setView] = useState<View>('request');
  const [side, setSide] = useState<'collection' | 'history'>('collection');
  const [tab, setTab] = useState<RequestTab>('params');
  const [envPath, setEnvPath] = useState(() => readStored(ENV_STORAGE_KEY) ?? '');
  const [result, setResult] = useState<HttpResult | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  const [notice, setNotice] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<SaveDialog | null>(null);
  const [, setDraftVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(readStored(COLLAPSED_STORAGE_KEY) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  });
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyStatus, setHistoryStatus] = useState<StatusFilter>('all');
  const [codeOpen, setCodeOpen] = useState(false);
  const [runnerFolder, setRunnerFolder] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [jsonError, setJsonError] = useState('');
  const [envName, setEnvName] = useState('');
  const envPending = useRef<{ timer: number; write?: () => Promise<void> }>({ timer: 0 });

  const environment = listing.environments.find((e) => e.path === envPath);
  const vars = useMemo(() => envToVars(environment), [environment]);
  const dirty = selected !== null && drafts.has(selected);

  useEffect(() => setEnvName(environment?.name ?? ''), [environment?.name]);

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
    let request: BruRequest;
    try {
      request = drafts.get(path) ?? (await window.api.bruRead(path));
    } catch (error) {
      // Arquivo apagado por fora ou .bru inválido: avisa em vez de deixar a promessa solta.
      setProblem(t('requests.error.read', { path, reason: (error as Error).message }));
      return;
    }
    setDraft(request);
    setSelected(path);
    setView('request');
    setSide('collection');
    setHistoryId(null);
    setJsonError('');
    // A última resposta desta request, se houver, aparece de volta.
    setResult(known.find((entry) => entry.source === path)?.result ?? null);
    setProblem('');
  };
  const selectRef = useRef(select);
  selectRef.current = select;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  useEffect(() => {
    void (async () => {
      try {
        const [next, past] = await Promise.all([refresh(), window.api.historyList().catch(() => [] as HistoryEntry[])]);
        setHistory(past);
        const wanted = takeFocusedRequest();
        const first = wanted ?? next.requests[0]?.path;
        if (first) await select(first, past);
      } catch (error) {
        setLoadError((error as Error).message);
      } finally {
        setLoading(false);
      }
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

  const createRequest = async (folder = selected ? requestFolder(selected) : ROOT_FOLDER) => {
    try {
      const path: string = await window.api.bruCreate(folder, t('requests.new'));
      setFilter('');
      setCollapsed((prev) => {
        if (!prev.has(folder)) return prev;
        const next = new Set(prev);
        next.delete(folder);
        return next;
      });
      await refresh();
      await select(path);
    } catch (error) {
      setProblem((error as Error).message);
    }
  };

  const deleteRequest = async (path: string) => {
    drafts.delete(path);
    if (path === selected) {
      setSelected(null);
      setDraft(null);
    }
    try {
      await window.api.remove(path);
      flash(t('requests.trashed'));
    } catch (error) {
      setProblem((error as Error).message);
    }
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

  const copyText = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text);
      flash(message);
    } catch (error) {
      setProblem((error as Error).message);
    }
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
    // Se o usuário trocou de request durante o envio, a resposta não aparece na outra.
    if (selectedRef.current === source) setResult(response);
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

  // Colar um comando cURL na URL preenche a request inteira, como no Postman e no Bruno.
  const onUrlPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text');
    if (!looksLikeCurl(text)) return;
    event.preventDefault();
    try {
      const imported = parseCurl(text);
      update((r) => {
        const next = applyCurl(r, imported);
        return { ...next, params: syncPathParams(next.http.url, next.params) };
      });
      setProblem('');
      flash(t('requests.curl.imported'));
    } catch {
      setProblem(t('requests.curl.invalid'));
    }
  };

  const formatJson = () => {
    const text = (draft?.body?.json as string) ?? '';
    const check = formatJsonBody(text);
    if (check.ok) {
      setJsonError('');
      if (check.text !== text) update((r) => ({ ...r, body: { ...r.body, json: check.text } }));
    } else setJsonError(t('requests.body.jsonError', { line: check.line, column: check.column }));
  };

  // ---- ambientes

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

  // Grava já o que estava esperando o atraso (antes de renomear, duplicar ou apagar o arquivo).
  const flushEnvironment = async () => {
    const pending = envPending.current;
    window.clearTimeout(pending.timer);
    const write = pending.write;
    pending.write = undefined;
    await write?.();
  };

  const chooseEnvironment = (path: string) => {
    setEnvPath(path);
    writeStored(ENV_STORAGE_KEY, path);
  };

  const createEnvironment = async (variables: EnvVar[] = [{ name: 'baseUrl', value: 'https://', enabled: true, secret: false }], base = t('requests.env.defaultName')) => {
    try {
      await flushEnvironment();
      const name = uniqueName(safeFileName(base) || t('requests.env.defaultName'), listing.environments.map((e) => e.name));
      const path = `${ENV_FOLDER}/${name}.bru`;
      await window.api.envWrite(path, variables);
      await refresh();
      chooseEnvironment(path);
    } catch (error) {
      setProblem((error as Error).message);
    }
  };

  const renameEnvironment = async (env: Environment, raw: string) => {
    const name = safeFileName(raw);
    if (!name || name === env.name) return setEnvName(env.name);
    try {
      await flushEnvironment();
      const path = await window.api.rename(env.path, `${dirName(env.path)}${name}.bru`);
      await refresh();
      chooseEnvironment(path);
    } catch (error) {
      setEnvName(env.name);
      setProblem((error as Error).message);
    }
  };

  const deleteEnvironment = async (env: Environment) => {
    try {
      await flushEnvironment();
      await window.api.remove(env.path);
      chooseEnvironment('');
      await refresh();
      flash(t('requests.env.trashed', { name: env.name }));
    } catch (error) {
      setProblem((error as Error).message);
    }
  };

  // ---- histórico

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

  // ---- páginas geradas

  const docLabels = (): DocLabels => ({
    params: t('requests.tab.params'),
    pathParams: t('requests.pathParams'),
    headers: t('requests.tab.headers'),
    body: t('requests.tab.body'),
    auth: t('requests.tab.auth'),
    name: t('requests.cookie.name'),
    value: t('common.value'),
    file: t('requests.docs.file'),
    assertions: t('requests.tab.asserts'),
  });

  const documentFolder = async (folder: string, requests: RequestSummary[]) => {
    if (!onCreateNote) return;
    try {
      const entries = await Promise.all(requests.map(async (r) => ({ path: r.path, request: drafts.get(r.path) ?? (await window.api.bruRead(r.path)) })));
      const title = folder.split('/').pop() || ROOT_FOLDER;
      await onCreateNote(t('requests.docs.noteName', { folder: title }), collectionToMarkdown(entries, docLabels()));
    } catch (error) {
      setProblem((error as Error).message);
    }
  };

  const saveResponseAsNote = async (input: { name: string; method: string; url: string; at: string; result: HttpResult }) => {
    if (!onCreateNote) return;
    try {
      const at = new Date(input.at);
      const md = responseToMarkdown(
        { ...input, at: `${at.toLocaleDateString()} ${timeOf(input.at)}`, size: input.result.ok ? formatSize(input.result.size) : '' },
        {
          status: t('requests.docs.status'),
          time: t('requests.docs.time'),
          size: t('requests.docs.size'),
          headers: t('requests.tab.headers'),
          body: t('requests.tab.body'),
          sentAt: t('requests.docs.sentAt'),
          name: t('requests.cookie.name'),
          value: t('common.value'),
        },
      );
      await onCreateNote(t('requests.response.noteName', { name: input.name, date: localDay(input.at) }), md);
    } catch (error) {
      setProblem((error as Error).message);
    }
  };

  // ---- dados derivados

  const filtered = useMemo(() => listing.requests.filter((request) => matchesRequestQuery(request, filter)), [listing.requests, filter]);
  const groups = useMemo(() => {
    const byFolder = new Map<string, RequestSummary[]>();
    for (const request of filtered) {
      const folder = dirName(request.path).replace(/\/$/, '');
      byFolder.set(folder, [...(byFolder.get(folder) ?? []), request]);
    }
    return [...byFolder.entries()];
  }, [filtered]);

  const toggleFolder = (folder: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      writeStored(COLLAPSED_STORAGE_KEY, JSON.stringify([...next]));
      return next;
    });

  const folders = useMemo(() => [...new Set([ROOT_FOLDER, ...listing.requests.map((r) => requestFolder(r.path))])].sort(), [listing.requests]);
  const mentions = useMemo(() => (selected ? requestMentions(selected, notes, contents) : []), [selected, notes, contents]);
  const historyEntry = history.find((entry) => entry.id === historyId) ?? null;

  const dayLabel = (day: string) => {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 86_400_000);
    // As datas do histórico estão em UTC; o rótulo usa o dia local de cada envio.
    if (day === localDay(today.toISOString())) return t('requests.history.today');
    if (day === localDay(yesterday.toISOString())) return t('requests.history.yesterday');
    return new Date(`${day}T12:00:00`).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
  };
  const shownHistory = useMemo(() => filterHistory(history, historyQuery, historyStatus), [history, historyQuery, historyStatus]);
  const historyGroups = useMemo(() => groupByDay(shownHistory.map((entry) => ({ ...entry, at: localDay(entry.at) + entry.at.slice(10) }))), [shownHistory]);

  const missing = draft ? unresolvedVariables(draft, vars) : [];
  const bodyMode = (draft?.http.body ?? 'none') as BodyChoice;
  const authMode = (draft?.http.auth === 'inherit' ? 'none' : (draft?.http.auth ?? 'none')) as AuthChoice;
  const counted = (label: string, count?: number) => (count ? t('requests.tabCount', { label, count }) : label);
  const textBodyKey = bodyMode === 'json' || bodyMode === 'text' || bodyMode === 'xml' ? bodyMode : null;
  const queryParams = draft?.params?.filter((p) => p.type !== 'path') ?? [];
  const pathParams = draft?.params?.filter((p) => p.type === 'path') ?? [];
  const assertions = (draft?.assertions as Assertion[] | undefined) ?? [];
  const assertionResults = useMemo(() => (result ? evaluateAssertions(assertions, result) : []), [result, assertions]);
  const historyAssertions = useMemo(
    () => (historyEntry && !sendingId ? evaluateAssertions(historyEntry.request.assertions as Assertion[] | undefined, historyEntry.result) : []),
    [historyEntry, sendingId],
  );

  // URL como sai de fato (variáveis e path params aplicados), quando difere do que está escrito.
  const finalUrl = useMemo(() => {
    if (!draft || (!draft.http.url.includes('{{') && !pathParamNames(draft.http.url).length)) return '';
    try {
      const url = buildRequest(draft, vars, 'preview').url;
      // Com variável sem valor a prévia engana (o host sai em minúsculas e com {{ }} codificado).
      return /\{\{|%7B%7B/i.test(url) ? '' : url;
    } catch {
      return '';
    }
  }, [draft, vars]);

  // Enter/Espaço abrem a linha; setas andam entre as linhas da lista lateral.
  const onRowKey = (event: ReactKeyboardEvent<HTMLElement>, activate: () => void) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const rows = [...(event.currentTarget.closest('aside')?.querySelectorAll<HTMLElement>('[data-request-row]') ?? [])];
      rows[rows.indexOf(event.currentTarget) + (event.key === 'ArrowDown' ? 1 : -1)]?.focus();
    }
  };

  const openHistory = (id: string) => {
    setHistoryId(id);
    setView('history');
    setProblem('');
  };

  const runnerRequests = runnerFolder === null ? [] : listing.requests.filter((r) => dirName(r.path).replace(/\/$/, '') === runnerFolder);

  return (
    <div className="relative flex h-full min-h-0 text-[13px]">
      <aside className="flex w-64 shrink-0 flex-col border-r border-[var(--hairline)] max-[1100px]:w-56 max-[820px]:w-48">
        <div className="px-3 pb-2 pt-3">
          <Segmented
            label={t('requests.sidebar')}
            value={side}
            onChange={setSide}
            variant="fill"
            options={[['collection', t('requests.collection')], ['history', counted(t('requests.history'), history.length)]] as const}
          />
        </div>

        {side === 'collection' ? (
          <>
            <div className="flex items-center gap-2 px-3 pb-2">
              <select className={`${field} flex-1 font-sans`} value={environment?.path ?? ''} title={t('requests.activeEnvironment')} aria-label={t('requests.activeEnvironment')} onChange={(event) => chooseEnvironment(event.target.value)}>
                <option value="">{t('requests.noEnvironment')}</option>
                {listing.environments.map((env) => (
                  <option key={env.path} value={env.path}>
                    {env.name}
                  </option>
                ))}
              </select>
              <button
                className={`${ghostButton} inline-flex shrink-0 items-center gap-1.5 max-[1100px]:px-2 ${view === 'environments' ? 'bg-[var(--hover-strong)] text-frost-100 ring-sheen-400/40' : ''}`}
                aria-pressed={view === 'environments'}
                title={t('requests.variables')}
                onClick={() => setView(view === 'environments' ? 'request' : 'environments')}
              >
                <VariablesIcon size={13} />
                <span className="max-[1100px]:sr-only">{t('requests.variables')}</span>
              </button>
            </div>
            <div className="flex items-center gap-2 px-3 pb-2">
              <input
                className={`${field} flex-1 font-sans`}
                type="search"
                value={filter}
                placeholder={t('requests.filter')}
                aria-label={t('requests.filter')}
                title={t('requests.filterHelp')}
                spellCheck={false}
                onChange={(event) => setFilter(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setFilter('');
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    event.currentTarget.closest('aside')?.querySelector<HTMLElement>('[data-request-row]')?.focus();
                  }
                }}
              />
              <button className={`${ghostButton} grid shrink-0 place-items-center self-stretch px-2`} onClick={() => void createRequest()} title={t('requests.new')} aria-label={t('requests.new')}>
                <PlusIcon size={14} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
              {groups.map(([folder, requests]) => {
                const isCollapsed = !filter && collapsed.has(folder);
                return (
                  <div key={folder} className="mb-1.5">
                    <div className="group/folder flex items-center gap-0.5 pr-1">
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-1 rounded px-1.5 py-1 text-left font-mono text-[11px] text-frost-500 transition-colors hover:text-frost-100"
                        title={folder}
                        aria-expanded={!isCollapsed}
                        onClick={() => toggleFolder(folder)}
                      >
                        <ChevronIcon size={11} className={`shrink-0 transition-transform duration-200 ${isCollapsed ? '' : 'rotate-90'}`} />
                        <span className="truncate">{folderLabel(folder)}</span>
                        <span className="shrink-0 rounded-full bg-[var(--hover)] px-1.5 text-[10px] leading-4 text-frost-500">{requests.length}</span>
                      </button>
                      <span className="hidden group-focus-within/folder:flex group-hover/folder:flex">
                        <button type="button" className={iconButton} title={t('requests.runner.runFolder')} aria-label={`${t('requests.runner.runFolder')}: ${folder}`} onClick={() => { setRunnerFolder(folder); setView('runner'); }}>
                          <PlayIcon size={12} />
                        </button>
                        {onCreateNote && (
                          <button type="button" className={iconButton} title={t('requests.docs.generate')} aria-label={`${t('requests.docs.generate')}: ${folder}`} onClick={() => void documentFolder(folder, requests)}>
                            <PageIcon size={12} />
                          </button>
                        )}
                        <button type="button" className={iconButton} title={t('requests.newInFolder')} aria-label={`${t('requests.newInFolder')}: ${folder}`} onClick={() => void createRequest(folder || ROOT_FOLDER)}>
                          <PlusIcon size={12} />
                        </button>
                      </span>
                    </div>
                    {!isCollapsed &&
                      requests.map((request) => (
                        <div
                          key={request.path}
                          role="button"
                          tabIndex={0}
                          data-request-row
                          aria-current={request.path === selected && view === 'request' ? 'true' : undefined}
                          className="rq-row group pl-2.5 pr-1"
                          title={request.url}
                          onClick={() => void select(request.path)}
                          onKeyDown={(event) => onRowKey(event, () => void select(request.path))}
                        >
                          <Method value={request.method} />
                          <span className="flex-1 truncate">{request.name}</span>
                          {drafts.has(request.path) && <span className="mr-2 size-1.5 shrink-0 rounded-full bg-sheen-400 group-focus-within:hidden group-hover:hidden" title={t('requests.unsaved')} />}
                          <button
                            type="button"
                            className={`${iconButton} hidden hover:text-danger group-focus-within:grid group-hover:grid`}
                            title={t('common.moveToTrash')}
                            aria-label={`${t('common.moveToTrash')}: ${request.name}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              void deleteRequest(request.path);
                            }}
                          >
                            <TrashIcon size={12} />
                          </button>
                        </div>
                      ))}
                  </div>
                );
              })}
              {loading ? (
                <p className="animate-pulse px-2 py-1 text-frost-500" role="status">
                  {t('requests.loading')}
                </p>
              ) : loadError ? (
                <p className={`mx-1 ${problemBox}`} role="alert">
                  {t('requests.error.list', { reason: loadError })}
                </p>
              ) : !listing.requests.length ? (
                <p className="px-2 py-1 text-[12.5px] leading-relaxed text-frost-500">{t('requests.empty')}</p>
              ) : (
                !filtered.length && <p className="px-2 py-1 text-frost-500">{t('requests.filterEmpty')}</p>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 px-3 pb-2">
              <input
                className={`${field} min-w-0 flex-1 font-sans`}
                type="search"
                value={historyQuery}
                placeholder={t('requests.history.filter')}
                aria-label={t('requests.history.filter')}
                spellCheck={false}
                onChange={(event) => setHistoryQuery(event.target.value)}
                onKeyDown={(event) => event.key === 'Escape' && setHistoryQuery('')}
              />
              <select className={`${field} w-20 shrink-0 font-sans`} value={historyStatus} aria-label={t('requests.history.status')} title={t('requests.history.status')} onChange={(event) => setHistoryStatus(event.target.value as StatusFilter)}>
                {STATUS_FILTERS.map((status) => (
                  <option key={status} value={status}>
                    {status === 'all' ? t('requests.history.allStatus') : status === 'error' ? t('requests.history.failed') : status}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
              {!history.length ? (
                <p className="px-2 py-1 text-[12.5px] leading-relaxed text-frost-500">{t('requests.history.empty')}</p>
              ) : (
                !shownHistory.length && <p className="px-2 py-1 text-frost-500">{t('requests.filterEmpty')}</p>
              )}
              {historyGroups.map(([day, entries]) => (
                <div key={day} className="mb-2">
                  <div className="section-label px-2 pb-1 pt-1.5">{dayLabel(day)}</div>
                  {entries.map((entry) => (
                    <div
                      key={entry.id}
                      role="button"
                      tabIndex={0}
                      data-request-row
                      aria-current={entry.id === historyId && view === 'history' ? 'true' : undefined}
                      onKeyDown={(event) => onRowKey(event, () => openHistory(entry.id))}
                      className="rq-row px-2.5 py-1.5"
                      title={entry.url}
                      onClick={() => openHistory(entry.id)}
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
                <button className={`${toolButton} mx-1 mt-1 hover:text-danger`} onClick={() => void clearHistory()}>
                  {t('requests.history.clear')}
                </button>
              )}
            </div>
          </>
        )}
      </aside>

      {view === 'runner' && runnerFolder !== null ? (
        <Runner
          key={runnerFolder}
          folder={runnerFolder || '/'}
          requests={runnerRequests}
          vars={vars}
          environment={environment?.name ?? null}
          readRequest={async (path) => drafts.get(path) ?? (await window.api.bruRead(path))}
          onOpen={(path) => void select(path)}
          onClose={() => setView('request')}
        />
      ) : view === 'environments' ? (
        <section className="rq-enter min-w-0 flex-1 overflow-y-auto p-5 max-[820px]:p-4">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h2 className="font-display text-xl font-semibold text-frost-100">{t('requests.env.title')}</h2>
            <button className={`${ghostButton} inline-flex items-center gap-1.5`} onClick={() => void createEnvironment()}>
              <PlusIcon size={13} />
              {t('requests.env.new')}
            </button>
          </div>
          {environment ? (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <input
                  className={`${field} w-56 font-sans text-[13px] font-medium max-[820px]:w-44`}
                  value={envName}
                  aria-label={t('requests.env.name')}
                  title={t('requests.env.renameHelp')}
                  spellCheck={false}
                  onChange={(event) => setEnvName(event.target.value)}
                  onBlur={() => void renameEnvironment(environment, envName)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                    if (event.key === 'Escape') setEnvName(environment.name);
                  }}
                />
                <button className={toolButton} onClick={() => void createEnvironment(environment.variables, `${environment.name} ${t('requests.copySuffix')}`)}>
                  {t('requests.duplicate')}
                </button>
                <button className={`${toolButton} hover:text-danger`} onClick={() => void deleteEnvironment(environment)}>
                  {t('common.moveToTrash')}
                </button>
              </div>
              <p className="mb-4 max-w-2xl text-[12.5px] leading-relaxed text-frost-500">
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
                bulk={false}
                onChange={(variables) => saveEnvironment(environment, variables)}
              />
              {problem && (
                <p className={`mt-3 ${problemBox}`} role="alert">
                  {problem}
                </p>
              )}
            </>
          ) : (
            <div className="mt-10 flex flex-col items-center gap-3 text-center">
              <span className="rq-empty-mark">
                <VariablesIcon size={18} />
              </span>
              <p className="max-w-xs text-[12.5px] text-frost-500">{t('requests.env.choose')}</p>
            </div>
          )}
        </section>
      ) : view === 'history' && historyEntry ? (
        <section className="rq-enter @container flex min-w-0 flex-1 flex-col [@media(max-height:620px)]:overflow-y-auto">
          <div className="px-5 pt-4 max-[820px]:px-4 max-[820px]:pt-3">
            <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
              <h2 className="min-w-0 flex-1 basis-full truncate font-display text-xl font-semibold text-frost-100 @2xl:basis-0" title={historyEntry.name}>
                {historyEntry.name}
              </h2>
              {historyEntry.source && listing.requests.some((r) => r.path === historyEntry.source) ? (
                <button className={toolButton} onClick={() => void select(historyEntry.source!)}>
                  {t('requests.history.openSource')}
                </button>
              ) : (
                historyEntry.source && <span className="px-2 text-[12px] text-frost-500">{t('requests.history.sourceGone')}</span>
              )}
              <button className={toolButton} onClick={() => openSaveDialog(historyEntry.request, historyEntry.name, historyEntry.source ? requestFolder(historyEntry.source) : ROOT_FOLDER)}>
                {t('requests.history.saveToCollection')}
              </button>
              <button className={`${toolButton} hover:text-danger`} onClick={() => void removeHistory(historyEntry.id)}>
                {t('requests.history.remove')}
              </button>
              {sendingId ? (
                <button className={`${dangerButton} ml-auto`} onClick={() => void window.api.httpCancel(sendingId)}>
                  {t('requests.cancel')}
                </button>
              ) : (
                <button className={`${primaryButton} ml-auto`} onClick={() => void send(historyEntry.request, historyEntry.source)}>
                  {t('requests.history.resend')}
                </button>
              )}
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-obsidian-950/60 px-3 py-2 ring-1 ring-[var(--hairline-strong)]">
              <Method value={historyEntry.method} />
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-frost-100 select-text" title={historyEntry.url}>
                {historyEntry.url}
              </span>
            </div>
            <p className="mt-2 text-[12px] text-frost-500">
              {t('requests.history.sentAt', { time: `${new Date(historyEntry.at).toLocaleDateString()} ${timeOf(historyEntry.at)}` })}
              {historyEntry.environment && ` · ${t('requests.history.environment', { name: historyEntry.environment })}`}
            </p>
            {problem && (
              <p className={`mt-2 ${problemBox}`} role="alert">
                {problem}
              </p>
            )}
          </div>
          <div className="mt-3 flex min-h-0 flex-1 flex-col border-t border-[var(--hairline)] bg-obsidian-950/40 [@media(max-height:620px)]:min-h-72">
            {sendingId && <div className="rq-progress -mt-px" aria-hidden="true" />}
            <ResponsePanel
              key={historyEntry.id}
              result={sendingId ? null : historyEntry.result}
              sending={Boolean(sendingId)}
              assertions={historyAssertions}
              onCopy={(text) => void copyText(text, t('requests.response.copied'))}
              onSaveAsNote={onCreateNote ? () => void saveResponseAsNote(historyEntry) : undefined}
            />
          </div>
        </section>
      ) : draft && selected ? (
        <section
          className="rq-enter @container flex min-w-0 flex-1 flex-col [@media(max-height:620px)]:overflow-y-auto"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void send();
          }}
        >
          <div className="px-5 pt-4 max-[820px]:px-4 max-[820px]:pt-3">
            <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
              <input
                className="-ml-1.5 min-w-0 flex-1 basis-full truncate rounded-md bg-transparent px-1.5 py-0.5 font-display text-xl font-semibold text-frost-100 outline-none transition-colors placeholder:text-frost-500 hover:bg-[var(--hover)] focus:bg-obsidian-950/50 focus:ring-1 focus:ring-[var(--hairline-strong)] @2xl:basis-0"
                value={draft.meta.name}
                aria-label={t('requests.namePlaceholder')}
                placeholder={t('requests.namePlaceholder')}
                spellCheck={false}
                onChange={(event) => update((r) => ({ ...r, meta: { ...r.meta, name: event.target.value } }))}
              />
              <button
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-[12.5px] font-medium transition-colors ${dirty ? 'rq-press bg-sheen-400/15 text-sheen-300 ring-1 ring-sheen-400/40 hover:bg-sheen-400/25' : 'text-frost-500'}`}
                disabled={!dirty}
                title={dirty ? t('requests.unsaved') : undefined}
                onClick={() => void save()}
              >
                <span className={`size-1.5 rounded-full ${dirty ? 'bg-sheen-400' : 'bg-frost-500/50'}`} aria-hidden="true" />
                {dirty ? t('requests.save') : t('requests.saved')}
              </button>
              <button className={toolButton} onClick={() => openSaveDialog(draft, draft.meta.name, requestFolder(selected))}>
                {t('requests.saveAs')}
              </button>
              <button className={toolButton} onClick={() => openSaveDialog(draft, `${draft.meta.name} ${t('requests.copySuffix')}`, requestFolder(selected))}>
                {t('requests.duplicate')}
              </button>
              <button className={toolButton} onClick={() => void copyText(requestLinkMarkdown(selected, draft.meta.name), t('requests.linkCopied'))}>
                {t('requests.copyLink')}
              </button>
              <button className={`${toolButton} inline-flex items-center gap-1`} onClick={() => setCodeOpen(true)}>
                <CodeIcon size={13} />
                {t('requests.code.open')}
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <div className="rq-url">
                <select
                  aria-label={t('requests.method')}
                  style={{ color: METHOD_COLOR[draft.http.method.toUpperCase()] }}
                  value={draft.http.method.toUpperCase()}
                  onChange={(event) => update((r) => ({ ...r, http: { ...r.http, method: event.target.value.toLowerCase() } }))}
                >
                  {METHODS.map((method) => (
                    <option key={method}>{method}</option>
                  ))}
                </select>
                <input
                  value={draft.http.url}
                  aria-label="URL"
                  placeholder={t('requests.urlPlaceholder')}
                  spellCheck={false}
                  onPaste={onUrlPaste}
                  onChange={(event) =>
                    update((r) => ({ ...r, http: { ...r.http, url: event.target.value }, params: syncPathParams(event.target.value, paramsFromUrl(event.target.value, r.params)) }))
                  }
                />
              </div>
              {sendingId ? (
                <button className={dangerButton} onClick={() => void window.api.httpCancel(sendingId)}>
                  {t('requests.cancel')}
                </button>
              ) : (
                <button className={`${primaryButton} inline-flex items-center gap-1.5`} title={t('requests.sendHint')} onClick={() => void send()}>
                  <PlayIcon size={12} />
                  {t('requests.send')}
                </button>
              )}
            </div>
            {finalUrl && (
              <p className="mt-1.5 truncate font-mono text-[11.5px] text-frost-500" title={finalUrl}>
                <span aria-hidden="true">→ </span>
                <span className="sr-only">{t('requests.finalUrl')}: </span>
                <span className="select-text">{finalUrl}</span>
              </p>
            )}
            {(problem || missing.length > 0) && (
              <p className={`mt-2 ${problemBox}`} role="alert">
                {problem || t('requests.missingVariables', { names: missing.join(', ') })}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
              <span className="text-frost-500">{t('requests.mentions')}:</span>
              {mentions.length ? (
                mentions.map((note) => (
                  <button
                    key={note.path}
                    className="inline-flex max-w-48 items-center gap-1 rounded-full px-2 py-0.5 text-sheen-300 ring-1 ring-[var(--hairline-strong)] transition-colors hover:bg-[var(--hover)] hover:ring-sheen-400/40"
                    title={note.path}
                    onClick={() => onOpenNote(note.path)}
                  >
                    <PageIcon size={11} className="shrink-0" />
                    <span className="truncate">{note.name}</span>
                  </button>
                ))
              ) : (
                <span className="text-frost-500">{t('requests.noMentions')}</span>
              )}
            </div>
            <div className="mt-2.5 border-b border-[var(--hairline)]">
              <Segmented
                label={t('requests.sections')}
                value={tab}
                variant="tabs"
                onChange={setTab}
                options={
                  [
                    ['params', counted(t('requests.tab.params'), draft.params?.length)],
                    ['headers', counted(t('requests.tab.headers'), draft.headers?.length)],
                    ['body', t('requests.tab.body')],
                    ['auth', t('requests.tab.auth')],
                    ['asserts', counted(t('requests.tab.asserts'), assertions.length)],
                    ['docs', t('requests.tab.docs')],
                  ] as const
                }
              />
            </div>
          </div>

          <div className="max-h-[42%] min-h-24 shrink-0 overflow-y-auto px-5 py-3 max-[820px]:px-4 [@media(max-height:620px)]:max-h-[32%]">
            {tab === 'params' && (
              <div className="flex flex-col gap-4">
                <PairTable
                  rows={queryParams}
                  blank={{ name: '', value: '', enabled: true, type: 'query' } as Pair}
                  namePlaceholder={t('requests.param')}
                  onChange={(rows) => {
                    const params = [...rows, ...pathParams];
                    update((r) => ({ ...r, params, http: { ...r.http, url: urlFromParams(r.http.url, params) } }));
                  }}
                />
                {pathParams.length > 0 && (
                  <div>
                    <h3 className="section-label mb-2">{t('requests.pathParams')}</h3>
                    <PairTable rows={pathParams} blank={{ name: '', value: '', enabled: true, type: 'path' } as Pair} namePlaceholder={t('requests.param')} lockNames onChange={(rows) => update((r) => ({ ...r, params: [...queryParams, ...rows] }))} />
                  </div>
                )}
                {!pathParams.length && <p className="text-[11.5px] text-frost-500">{t('requests.pathParamsHelp')}</p>}
              </div>
            )}
            {tab === 'headers' && (
              <PairTable
                rows={draft.headers ?? []}
                blank={{ name: '', value: '', enabled: true } as Pair}
                namePlaceholder={t('requests.header')}
                nameSuggestions={COMMON_HEADERS}
                valueSuggestions={headerValues}
                onChange={(headers) => update((r) => ({ ...r, headers }))}
              />
            )}
            {tab === 'body' && (
              <div className="flex flex-col gap-3">
                <Segmented label={t('requests.tab.body')} value={bodyMode} options={bodyModes(t)} onChange={(mode) => update((r) => ({ ...r, http: { ...r.http, body: mode } }))} />
                {textBodyKey && (
                  <textarea
                    className={`${field} min-h-40 w-full resize-y leading-relaxed`}
                    value={(draft.body?.[textBodyKey] as string) ?? ''}
                    aria-label={t('requests.tab.body')}
                    placeholder={textBodyKey === 'json' ? t('requests.body.jsonPlaceholder') : t('requests.body.placeholder')}
                    spellCheck={false}
                    onChange={(event) => {
                      setJsonError('');
                      update((r) => ({ ...r, body: { ...r.body, [textBodyKey]: event.target.value } }));
                    }}
                    onKeyDown={(event) => {
                      // Shift+Alt+F formata o JSON, como no VS Code (só com o foco no corpo).
                      if (textBodyKey === 'json' && event.shiftKey && event.altKey && event.key.toLowerCase() === 'f') {
                        event.preventDefault();
                        formatJson();
                      }
                    }}
                  />
                )}
                {textBodyKey === 'json' && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className={ghostButton} onClick={formatJson} title="Shift+Alt+F">
                      {t('requests.body.format')}
                    </button>
                    {jsonError ? (
                      <span className="text-[12px] text-danger" role="alert">
                        {jsonError}
                      </span>
                    ) : (
                      <span className="text-[11.5px] text-frost-500">{t('requests.body.formatHelp')}</span>
                    )}
                  </div>
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
                <Segmented label={t('requests.tab.auth')} value={authMode} options={authModes(t)} onChange={(mode) => update((r) => ({ ...r, http: { ...r.http, auth: mode } }))} />
                {authMode === 'bearer' && (
                  <SecretInput
                    value={draft.auth?.bearer?.token ?? ''}
                    placeholder="Token"
                    revealed={revealed}
                    onReveal={() => setRevealed(!revealed)}
                    onChange={(token) => update((r) => ({ ...r, auth: { ...r.auth, bearer: { token } } }))}
                  />
                )}
                {authMode === 'basic' && (
                  <>
                    <input className={`${field} w-full`} placeholder={t('requests.auth.user')} aria-label={t('requests.auth.user')} value={draft.auth?.basic?.username ?? ''} spellCheck={false} onChange={(event) => update((r) => ({ ...r, auth: { ...r.auth, basic: { ...r.auth?.basic, username: event.target.value } } }))} />
                    <SecretInput
                      value={draft.auth?.basic?.password ?? ''}
                      placeholder={t('requests.auth.password')}
                      revealed={revealed}
                      onReveal={() => setRevealed(!revealed)}
                      onChange={(password) => update((r) => ({ ...r, auth: { ...r.auth, basic: { ...r.auth?.basic, password } } }))}
                    />
                  </>
                )}
                {authMode === 'apikey' && (
                  <>
                    <input className={`${field} w-full`} placeholder={t('requests.auth.keyName')} aria-label={t('requests.auth.keyName')} value={draft.auth?.apikey?.key ?? ''} spellCheck={false} onChange={(event) => update((r) => ({ ...r, auth: { ...r.auth, apikey: { placement: 'header', ...r.auth?.apikey, key: event.target.value } } }))} />
                    <SecretInput
                      value={draft.auth?.apikey?.value ?? ''}
                      placeholder={t('common.value')}
                      revealed={revealed}
                      onReveal={() => setRevealed(!revealed)}
                      onChange={(value) => update((r) => ({ ...r, auth: { ...r.auth, apikey: { placement: 'header', ...r.auth?.apikey, value } } }))}
                    />
                    <Segmented
                      label={t('requests.auth.placement')}
                      value={draft.auth?.apikey?.placement === 'queryparams' ? 'queryparams' : 'header'}
                      options={[['header', t('requests.auth.inHeader')], ['queryparams', t('requests.auth.inQuery')]] as const}
                      onChange={(placement) => update((r) => ({ ...r, auth: { ...r.auth, apikey: { ...r.auth?.apikey, placement } } }))}
                    />
                  </>
                )}
                {draft.http.auth === 'inherit' && <p className="text-frost-500">{t('requests.auth.inherit')}</p>}
              </div>
            )}
            {tab === 'asserts' && (
              <div className="flex flex-col gap-2">
                <p className="text-[12px] text-frost-500">{t('requests.assert.help')}</p>
                <PairTable
                  rows={assertions}
                  blank={{ name: 'res.status', value: 'eq 200', enabled: true }}
                  namePlaceholder="res.status"
                  valuePlaceholder="eq 200"
                  nameSuggestions={ASSERT_TARGETS}
                  valueSuggestions={() => ASSERT_OPERATORS.map((op) => `${op} `)}
                  onChange={(rows) => update((r) => ({ ...r, assertions: rows }))}
                />
              </div>
            )}
            {tab === 'docs' && (
              <textarea
                className={`${field} min-h-40 w-full resize-y font-sans leading-relaxed`}
                value={draft.docs ?? ''}
                aria-label={t('requests.tab.docs')}
                placeholder={t('requests.docsPlaceholder')}
                onChange={(event) => update((r) => ({ ...r, docs: event.target.value }))}
              />
            )}
          </div>

          {/* Em janela baixa a resposta não encolhe até sumir: a request inteira rola e ela guarda altura útil. */}
          <div className="flex min-h-0 flex-1 flex-col border-t border-[var(--hairline)] bg-obsidian-950/40 [@media(max-height:620px)]:min-h-72">
            {sendingId && <div className="rq-progress -mt-px" aria-hidden="true" />}
            <ResponsePanel
              key={selected}
              result={result}
              sending={Boolean(sendingId)}
              assertions={assertionResults}
              onCopy={(text) => void copyText(text, t('requests.response.copied'))}
              onSaveAsNote={
                onCreateNote && result
                  ? () => void saveResponseAsNote({ name: draft.meta.name, method: draft.http.method.toUpperCase(), url: history.find((e) => e.source === selected)?.url ?? draft.http.url, at: history.find((e) => e.source === selected)?.at ?? new Date().toISOString(), result })
                  : undefined
              }
            />
          </div>
        </section>
      ) : (
        <section className="rq-enter flex min-w-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto px-6 py-6 text-center text-frost-500">
          <span className={`rq-empty-mark ${loading ? 'animate-pulse' : ''}`}>
            <RequestIcon size={18} />
          </span>
          <p className="font-display text-lg font-semibold text-frost-100">{loading ? t('requests.loading') : t('requests.noneSelected')}</p>
          {!loading && <p className="max-w-sm text-[12.5px] leading-relaxed">{t('requests.noneSelectedHelp')}</p>}
          {problem && (
            <p className={`max-w-md ${problemBox}`} role="alert">
              {problem}
            </p>
          )}
          {!loading && (
            <button className={`${primaryButton} mt-1 inline-flex items-center gap-1.5`} onClick={() => void createRequest()}>
              <PlusIcon size={13} />
              {t('requests.new')}
            </button>
          )}
        </section>
      )}

      {notice && (
        <div key={notice} role="status" className="toast pointer-events-none text-frost-100">
          <span className="toast-dot" aria-hidden="true" />
          {notice}
        </div>
      )}

      {codeOpen && draft && <CodeDialog request={draft} vars={vars} onClose={() => setCodeOpen(false)} onCopied={() => flash(t('requests.code.copied'))} />}

      {dialog && (
        <div className="scrim absolute inset-0 z-30 flex items-start justify-center overflow-y-auto pt-24 max-[600px]:pt-10 [@media(max-height:560px)]:pt-8" onMouseDown={() => setDialog(null)}>
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="request-save-title"
            className="palette w-[min(420px,calc(100%-32px))] rounded-xl p-5"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              void confirmSave();
            }}
            onKeyDown={(event) => event.key === 'Escape' && setDialog(null)}
          >
            <h2 id="request-save-title" className="font-display text-lg font-semibold text-frost-100">
              {t('requests.saveDialog.title')}
            </h2>
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
              <button type="submit" className={primaryButton} disabled={!dialog.name.trim()}>
                {t('requests.saveDialog.confirm')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
