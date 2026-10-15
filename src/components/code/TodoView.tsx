import { useEffect, useMemo, useRef, useState } from 'react';

import { parseTodo, TODO_QUERY, TODO_TAGS } from '../../../electron/searchCore.mjs';
import { useT } from '../../lib/i18n';
import type { IconTheme } from '../../lib/iconTheme';
import { baseName, dirName } from '../../lib/paths';
import { languageForFile } from '../../lib/textmate';
import type { FileSearchResult } from '../../types';
import { FileIconView } from './FileIconView';
import { ResultTree, type ResultGroup } from './ResultTree';

const REFRESH_DELAY_MS = 1000;

// Último resultado: voltar para a vista não varre o disco de novo.
const memory: { result: FileSearchResult | null; hidden: string[]; key: string } = { result: null, hidden: [], key: '' };

// Marcas de tarefa no código (TODO, FIXME, HACK...), como as extensões de "árvore de TODOs".
export function TodoView({ iconTheme, displayPath, open, rootsKey }: { iconTheme: IconTheme | null; displayPath(path: string): string; open(path: string, line: number, column: number, length: number): void; rootsKey: string }) {
  const t = useT();
  const [result, setResult] = useState<FileSearchResult | null>(memory.key === rootsKey ? memory.result : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string[]>(memory.hidden);
  const serial = useRef(0);

  const scan = async () => {
    const mine = ++serial.current;
    setBusy(true);
    setError(null);
    try {
      const next = await window.api.ws.search({ query: TODO_QUERY, isRegex: true, matchCase: true });
      if (mine !== serial.current || next.cancelled) return;
      memory.result = next;
      memory.key = rootsKey;
      setResult(next);
    } catch (err) {
      if (mine === serial.current) setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err));
    } finally {
      if (mine === serial.current) setBusy(false);
    }
  };
  const scanRef = useRef(scan);
  scanRef.current = scan;

  useEffect(() => {
    if (memory.key !== rootsKey || !memory.result) void scanRef.current();
  }, [rootsKey]);

  useEffect(() => {
    let timer = 0;
    const off = window.api.ws.onChanged(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void scanRef.current(), REFRESH_DELAY_MS);
    });
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, []);

  const toggleTag = (tag: string) => {
    const next = hidden.includes(tag) ? hidden.filter((item) => item !== tag) : [...hidden, tag];
    memory.hidden = next;
    setHidden(next);
  };

  const { groups, counts, total } = useMemo(() => {
    const counts = new Map<string, number>();
    let total = 0;
    const groups: ResultGroup[] = [];
    for (const { path, matches } of result?.results ?? []) {
      const items = [];
      for (const [index, match] of matches.entries()) {
        const todo = parseTodo(match.preview.slice(match.previewStart));
        if (!todo) continue;
        counts.set(todo.tag, (counts.get(todo.tag) ?? 0) + 1);
        if (hidden.includes(todo.tag)) continue;
        total++;
        items.push({
          id: String(index),
          title: `${match.line}:${match.column}`,
          onOpen: () => open(path, match.line, match.column, match.length),
          content: (
            <>
              <span className="wb-todo-tag" data-tag={todo.tag}>
                {todo.tag}
              </span>
              <span className="min-w-0 flex-1 truncate">{todo.text || <span className="opacity-60">{t('code.todo.noText')}</span>}</span>
              <span className="wb-result-line-no">{match.line}</span>
            </>
          ),
        });
      }
      if (items.length) groups.push({ id: path, label: baseName(path), description: displayPath(dirName(path)), icon: <FileIconView icon={iconTheme?.forFile(path, languageForFile(path)) ?? null} />, count: items.length, items });
    }
    return { groups, counts, total };
  }, [result, hidden, iconTheme, displayPath, open, t]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-1 px-3 pb-2 pt-1" role="group" aria-label={t('code.todo.filter')}>
        {TODO_TAGS.filter((tag) => counts.has(tag)).map((tag) => (
          <button key={tag} type="button" className="wb-chip wb-todo-chip" data-tag={tag} data-on={!hidden.includes(tag)} aria-pressed={!hidden.includes(tag)} onClick={() => toggleTag(tag)}>
            {tag} <span className="opacity-60">{counts.get(tag)}</span>
          </button>
        ))}
        <span className="flex-1" />
        {busy && <span className="wb-spinner" aria-hidden />}
        <button type="button" className="wb-icon-btn" title={t('code.todo.refresh')} aria-label={t('code.todo.refresh')} onClick={() => void scan()}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><path d="M13.45 5.17A6 6 0 1 0 14 8h-1a5 5 0 1 1-.82-2.75H10v1h4v-4h-1v1.92Z" /></svg>
        </button>
      </div>
      {error && <p className="wb-search-msg" data-error role="alert">{error}</p>}
      {!error && !result && busy && <p className="wb-search-msg" role="status">{t('code.todo.scanning')}</p>}
      {!error && result && total === 0 && <p className="wb-search-msg" role="status">{counts.size ? t('code.todo.allHidden') : t('code.todo.empty')}</p>}
      {!error && result?.truncated && <p className="wb-search-msg">{t('code.search.truncated')}</p>}
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">{groups.length > 0 && <ResultTree groups={groups} label={t('code.todo.title')} />}</div>
    </div>
  );
}
