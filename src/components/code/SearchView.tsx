import { useEffect, useRef, useState, type ReactNode } from 'react';

import { buildMatcher, replaceInText } from '../../../electron/searchCore.mjs';
import { useT } from '../../lib/i18n';
import type { IconTheme } from '../../lib/iconTheme';
import { baseName, dirName } from '../../lib/paths';
import { languageForFile } from '../../lib/textmate';
import type { FileSearchOptions, FileSearchResult } from '../../types';
import { FileIconView } from './FileIconView';
import { MatchPreview, ResultTree, type ResultGroup } from './ResultTree';

const SEARCH_DELAY_MS = 300;
const RESEARCH_DELAY_MS = 800;

export type SearchRequest = { query?: string; include?: string; replace?: boolean; serial: number };
export type SearchHost = {
  iconTheme: IconTheme | null;
  /** Caminho mostrado ("pasta • src/lib") a partir do absoluto. */
  displayPath(path: string): string;
  open(path: string, line: number, column: number, length: number): void;
  /** Substitui nos arquivos abertos no editor (no modelo, com desfazer) e devolve quais tratou. */
  replaceOpen(paths: string[], options: FileSearchOptions, replacement: string): { handled: string[]; count: number };
  notify(text: string, error?: boolean): void;
};

type State = {
  query: string;
  replacement: string;
  include: string;
  exclude: string;
  matchCase: boolean;
  wholeWord: boolean;
  isRegex: boolean;
  showReplace: boolean;
  showDetails: boolean;
};

// O que foi digitado e o último resultado sobrevivem à troca de aba e de vista.
const memory: { state: State; result: FileSearchResult | null } = {
  state: { query: '', replacement: '', include: '', exclude: '', matchCase: false, wholeWord: false, isRegex: false, showReplace: false, showDetails: false },
  result: null,
};

function Toggle({ on, label, keys, onClick, children }: { on: boolean; label: string; keys: string; onClick(): void; children: ReactNode }) {
  return (
    <button type="button" className="wb-toggle" aria-pressed={on} data-on={on} title={`${label} (${keys})`} aria-label={label} onClick={onClick}>
      {children}
    </button>
  );
}

export function SearchView({ host, request, rootsKey }: { host: SearchHost; request: SearchRequest | null; rootsKey: string }) {
  const t = useT();
  const [state, setStateRaw] = useState<State>(memory.state);
  const [result, setResult] = useState<FileSearchResult | null>(memory.result);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const serial = useRef(0);
  const hostRef = useRef(host);
  hostRef.current = host;

  const setState = (patch: Partial<State>) =>
    setStateRaw((current) => {
      const next = { ...current, ...patch };
      memory.state = next;
      return next;
    });

  const options = (): FileSearchOptions => ({ query: state.query, isRegex: state.isRegex, matchCase: state.matchCase, wholeWord: state.wholeWord, include: state.include, exclude: state.exclude });

  const run = async (opts: FileSearchOptions) => {
    const mine = ++serial.current;
    if (!opts.query) {
      setBusy(false);
      setError(null);
      setResult(null);
      memory.result = null;
      return;
    }
    // Expressão inválida aparece na hora, sem ir ao disco.
    try {
      buildMatcher(opts);
    } catch (err) {
      setBusy(false);
      setResult(null);
      setError(t('code.search.invalidRegex', { reason: err instanceof Error ? err.message : String(err) }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await window.api.ws.search(opts);
      if (mine !== serial.current || next.cancelled) return;
      setResult(next);
      memory.result = next;
    } catch (err) {
      if (mine !== serial.current) return;
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err));
      setResult(null);
    } finally {
      if (mine === serial.current) setBusy(false);
    }
  };
  const runRef = useRef(run);
  runRef.current = run;

  // Busca enquanto digita, com uma pequena espera.
  const optionsKey = JSON.stringify([state.query, state.isRegex, state.matchCase, state.wholeWord, state.include, state.exclude, rootsKey]);
  const firstRun = useRef(true);
  useEffect(() => {
    // Ao voltar para a vista, o resultado guardado vale; só busca de novo se nada foi guardado.
    if (firstRun.current) {
      firstRun.current = false;
      if (memory.result || !state.query) return;
    }
    const timer = window.setTimeout(() => void runRef.current(options()), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsKey]);

  // Arquivos mudaram no disco: refaz a busca (sem pressa), para os resultados não mentirem.
  useEffect(() => {
    let timer = 0;
    const off = window.api.ws.onChanged(() => {
      if (!memory.state.query) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void runRef.current({ ...options(), query: memory.state.query }), RESEARCH_DELAY_MS);
    });
    return () => {
      off();
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pedido de fora (Ctrl+Shift+F com seleção, "Localizar na pasta", Ctrl+Shift+H).
  useEffect(() => {
    if (!request) return;
    const patch: Partial<State> = {};
    if (request.query !== undefined) patch.query = request.query;
    if (request.include !== undefined) {
      patch.include = request.include;
      patch.showDetails = true;
    }
    if (request.replace) patch.showReplace = true;
    setState(patch);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.serial]);

  const replacementFor = (matched: string) => {
    if (!state.showReplace) return undefined;
    if (!state.isRegex) return state.replacement;
    try {
      return replaceInText(matched, buildMatcher(options()), state.replacement, true).text;
    } catch {
      return state.replacement;
    }
  };

  const replaceIn = async (paths: string[]) => {
    const opts = options();
    if (!opts.query || !paths.length) return;
    const local = hostRef.current.replaceOpen(paths, opts, state.replacement);
    const rest = paths.filter((path) => !local.handled.includes(path));
    let count = local.count;
    try {
      if (rest.length) {
        const remote = await window.api.ws.replace(opts, state.replacement, rest);
        count += remote.count;
        if (remote.failed.length) hostRef.current.notify(t('code.search.replaceFailed', { count: remote.failed.length, reason: remote.failed[0].reason }), true);
      }
      hostRef.current.notify(t('code.search.replaced', { count }));
    } catch (err) {
      hostRef.current.notify(err instanceof Error ? err.message : String(err), true);
    }
    await run(opts);
  };

  const onFieldKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // Alt+C / Alt+W / Alt+R alternam caixa, palavra inteira e expressão regular, como no VS Code.
    if (event.altKey && !event.ctrlKey) {
      const key = event.key.toLowerCase();
      if (key === 'c') setState({ matchCase: !state.matchCase });
      else if (key === 'w') setState({ wholeWord: !state.wholeWord });
      else if (key === 'r') setState({ isRegex: !state.isRegex });
      else return;
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      void run(options());
    } else if (event.key === 'ArrowDown' && result?.results.length) {
      event.preventDefault();
      event.currentTarget.closest('.wb-search')?.querySelector<HTMLElement>('[role="tree"]')?.focus();
    }
  };

  const groups: ResultGroup[] = (result?.results ?? []).map(({ path, matches }) => ({
    id: path,
    label: baseName(path),
    description: host.displayPath(dirName(path)),
    icon: <FileIconView icon={host.iconTheme?.forFile(path, languageForFile(path)) ?? null} />,
    count: matches.length,
    actions: state.showReplace ? (
      <button type="button" className="wb-icon-btn !h-5 !w-5" title={t('code.search.replaceInFile')} aria-label={`${t('code.search.replaceInFile')}: ${baseName(path)}`} onClick={() => void replaceIn([path])}>
        <ReplaceAllIcon />
      </button>
    ) : undefined,
    items: matches.map((match, index) => ({
      id: String(index),
      title: `${match.line}:${match.column}`,
      onOpen: () => host.open(path, match.line, match.column, match.length),
      content: (
        <>
          <span className="wb-result-line-no">{match.line}</span>
          <MatchPreview text={match.preview} start={match.previewStart} length={match.previewLength} replacement={replacementFor(match.preview.slice(match.previewStart, match.previewStart + match.previewLength))} />
        </>
      ),
    })),
  }));

  let summary: ReactNode = null;
  if (error) summary = <p className="wb-search-msg" data-error role="alert">{error}</p>;
  else if (busy && !result) summary = <p className="wb-search-msg" role="status">{t('code.search.searching')}</p>;
  else if (!state.query) summary = <p className="wb-search-msg">{t('code.search.hint')}</p>;
  else if (result && !result.total) summary = <p className="wb-search-msg" role="status">{t('code.search.noResults', { count: result.files })}</p>;
  else if (result)
    summary = (
      <div className="wb-search-msg flex items-center gap-2" role="status">
        <span className="min-w-0 flex-1">
          {t('code.search.summary', { count: result.total })} {t('code.search.inFiles', { count: result.results.length })}
          {result.truncated && <span className="block opacity-80">{t('code.search.truncated')}</span>}
        </span>
        {busy && <span className="wb-spinner" aria-hidden />}
      </div>
    );

  return (
    <div className="wb-search flex min-h-0 flex-1 flex-col">
      <div className="wb-search-form">
        <button
          type="button"
          className="wb-icon-btn wb-search-expand"
          aria-expanded={state.showReplace}
          title={t('code.search.toggleReplace')}
          aria-label={t('code.search.toggleReplace')}
          onClick={() => setState({ showReplace: !state.showReplace })}
        >
          <span className="wb-chevron" data-open={state.showReplace} aria-hidden>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="m3.5 2 3 3-3 3" /></svg>
          </span>
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="wb-field">
            <input
              ref={input}
              className="wb-field-input"
              value={state.query}
              placeholder={t('code.search.placeholder')}
              aria-label={t('code.search.placeholder')}
              spellCheck={false}
              onChange={(event) => setState({ query: event.target.value })}
              onKeyDown={onFieldKey}
            />
            <Toggle on={state.matchCase} label={t('code.search.matchCase')} keys="Alt+C" onClick={() => setState({ matchCase: !state.matchCase })}>
              <span className="text-[11px] font-semibold">Aa</span>
            </Toggle>
            <Toggle on={state.wholeWord} label={t('code.search.wholeWord')} keys="Alt+W" onClick={() => setState({ wholeWord: !state.wholeWord })}>
              <span className="text-[11px] font-semibold underline decoration-1 underline-offset-2">ab</span>
            </Toggle>
            <Toggle on={state.isRegex} label={t('code.search.regex')} keys="Alt+R" onClick={() => setState({ isRegex: !state.isRegex })}>
              <span className="font-mono text-[11px] font-semibold">.*</span>
            </Toggle>
          </div>
          {state.showReplace && (
            <div className="flex items-center gap-1">
              <div className="wb-field flex-1">
                <input
                  className="wb-field-input"
                  value={state.replacement}
                  placeholder={t('code.search.replacePlaceholder')}
                  aria-label={t('code.search.replacePlaceholder')}
                  spellCheck={false}
                  onChange={(event) => setState({ replacement: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && event.ctrlKey && event.altKey) {
                      event.preventDefault();
                      void replaceIn((result?.results ?? []).map((item) => item.path));
                    } else onFieldKey(event);
                  }}
                />
              </div>
              <button
                type="button"
                className="wb-icon-btn"
                disabled={!result?.total}
                title={`${t('code.search.replaceAll')} (Ctrl+Alt+Enter)`}
                aria-label={t('code.search.replaceAll')}
                onClick={() => void replaceIn((result?.results ?? []).map((item) => item.path))}
              >
                <ReplaceAllIcon />
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="px-3 pb-1">
        <button type="button" className="wb-link-btn" aria-expanded={state.showDetails} onClick={() => setState({ showDetails: !state.showDetails })}>
          {t('code.search.details')}
        </button>
        {state.showDetails && (
          <div className="mt-1.5 flex flex-col gap-1.5">
            <label className="wb-search-label">
              {t('code.search.include')}
              <span className="wb-field">
                <input className="wb-field-input" value={state.include} placeholder="src, *.ts" spellCheck={false} onChange={(event) => setState({ include: event.target.value })} onKeyDown={onFieldKey} />
              </span>
            </label>
            <label className="wb-search-label">
              {t('code.search.exclude')}
              <span className="wb-field">
                <input className="wb-field-input" value={state.exclude} placeholder="dist, *.min.js" spellCheck={false} onChange={(event) => setState({ exclude: event.target.value })} onKeyDown={onFieldKey} />
              </span>
            </label>
          </div>
        )}
      </div>
      {summary}
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">{groups.length > 0 && <ResultTree groups={groups} label={t('code.search.results')} />}</div>
    </div>
  );
}

function ReplaceAllIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 4.5h6M2 7.5h4M9.5 3l2 2-2 2M11.5 5H8.5M2.5 10.5h3v3h-3zM8 12h6" />
    </svg>
  );
}
