import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useT } from '../lib/i18n';
import type { TextStats } from '../lib/notes';
import { ChevronIcon, CloseIcon } from './Icons';

// Ferramentas da folha: busca na página (Ctrl+F) e barra de status (gravação e contagem de palavras).

const FIND_HIGHLIGHT = 'obnotion-find';
const FIND_CURRENT = 'obnotion-find-current';
const MAX_MATCHES = 2000;

// Os destaques usam a CSS Custom Highlight API: nada é inserido no DOM do editor,
// então o ProseMirror não percebe a busca e o texto da nota nunca muda por causa dela.
const highlights = () => (typeof CSS !== 'undefined' && 'highlights' in CSS ? CSS.highlights : null);

function findRanges(root: HTMLElement, query: string, matchCase: boolean): Range[] {
  const wanted = matchCase ? query : query.toLowerCase();
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node && ranges.length < MAX_MATCHES; node = walker.nextNode()) {
    const text = matchCase ? node.nodeValue ?? '' : (node.nodeValue ?? '').toLowerCase();
    for (let at = text.indexOf(wanted); at >= 0 && ranges.length < MAX_MATCHES; at = text.indexOf(wanted, at + wanted.length)) {
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + wanted.length);
      ranges.push(range);
    }
  }
  return ranges;
}

type FindBarProps = {
  /** Onde procurar (o conteúdo do editor). */
  root: () => HTMLElement | null;
  /** Muda a cada edição: a busca refaz os destaques. */
  version: number;
  onClose: () => void;
};

export function FindBar({ root, version, onClose }: FindBarProps) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [current, setCurrent] = useState(0);
  const [count, setCount] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const ranges = useRef<Range[]>([]);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
    return () => {
      highlights()?.delete(FIND_HIGHLIGHT);
      highlights()?.delete(FIND_CURRENT);
    };
  }, []);

  // Ctrl+F com a barra já aberta volta o foco ao campo.
  useEffect(() => {
    const refocus = () => {
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener('obnotion:find-focus', refocus);
    return () => window.removeEventListener('obnotion:find-focus', refocus);
  }, []);

  useLayoutEffect(() => {
    const element = root();
    const found = element && query ? findRanges(element, query, matchCase) : [];
    ranges.current = found;
    setCount(found.length);
    setCurrent((index) => (found.length ? Math.min(index, found.length - 1) : 0));
    const registry = highlights();
    if (registry) {
      if (found.length) registry.set(FIND_HIGHLIGHT, new Highlight(...found));
      else registry.delete(FIND_HIGHLIGHT);
    }
  }, [query, matchCase, version, root]);

  useLayoutEffect(() => {
    const range = ranges.current[current];
    const registry = highlights();
    if (!range) {
      registry?.delete(FIND_CURRENT);
      return;
    }
    registry?.set(FIND_CURRENT, new Highlight(range));
    range.startContainer.parentElement?.scrollIntoView({ block: 'center' });
  }, [current, count, query, matchCase]);

  const step = (delta: number) => count && setCurrent((index) => (index + delta + count) % count);

  return (
    <div className="find-bar" role="search" aria-label={t('find.label')}>
      <input
        ref={input}
        className="find-input"
        value={query}
        placeholder={t('find.placeholder')}
        aria-label={t('find.label')}
        spellCheck={false}
        onChange={(event) => {
          setQuery(event.target.value);
          setCurrent(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') step(event.shiftKey ? -1 : 1);
          else if (event.key === 'Escape') onClose();
          else if (event.key === 'F3') step(event.shiftKey ? -1 : 1);
          else return;
          event.preventDefault();
        }}
      />
      <span className="find-count" aria-live="polite">
        {query ? (count ? t('find.count', { current: current + 1, count }) : t('find.none')) : ''}
      </span>
      <button
        className="icon-button sheet-button find-case"
        data-on={matchCase}
        aria-pressed={matchCase}
        title={t('find.matchCase')}
        aria-label={t('find.matchCase')}
        onClick={() => setMatchCase((on) => !on)}
      >
        Aa
      </button>
      <button className="icon-button sheet-button" title={t('find.previous')} aria-label={t('find.previous')} disabled={!count} onClick={() => step(-1)}>
        <ChevronIcon size={13} className="-rotate-90" />
      </button>
      <button className="icon-button sheet-button" title={t('find.next')} aria-label={t('find.next')} disabled={!count} onClick={() => step(1)}>
        <ChevronIcon size={13} className="rotate-90" />
      </button>
      <button className="icon-button sheet-button" title={t('find.close')} aria-label={t('find.close')} onClick={onClose}>
        <CloseIcon size={13} />
      </button>
    </div>
  );
}

export type SaveState = 'saved' | 'saving' | 'error';

export function StatusBar({ state, stats, onRetry }: { state: SaveState; stats: TextStats; onRetry: () => void }) {
  const t = useT();
  return (
    <div className="note-status" data-state={state}>
      <span className="note-status-save" aria-live="polite">
        <span className="note-status-dot" aria-hidden="true" />
        {state === 'error' ? (
          <button className="note-status-retry" onClick={onRetry}>
            {t('status.error')}
          </button>
        ) : (
          t(state === 'saving' ? 'status.saving' : 'status.saved')
        )}
      </span>
      <span>{t('status.words', { count: stats.words })}</span>
      <span>{t('status.characters', { count: stats.characters })}</span>
      {stats.minutes > 0 && <span>{t('status.reading', { count: stats.minutes })}</span>}
    </div>
  );
}
