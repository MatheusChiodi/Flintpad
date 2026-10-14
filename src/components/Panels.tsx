import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

import { Trans, useT, type Translate } from '../lib/i18n';
import { baseName } from '../lib/links';
import { CODE, GRAPH, isSpecialPath, REQUESTS, TASKS, WHITEBOARDS, type Note, type Tab } from '../types';
import { BacklinkIcon, CloseIcon, GraphIcon, Kbd, SidebarIcon, OutlinkIcon, PageIcon, PlusIcon, SearchIcon, RequestIcon, CodeIcon, StarIcon, TasksIcon, WhiteboardIcon } from './Icons';

const currentPath = (tab: Tab) => tab.stack[tab.idx] ?? '';

export function tabTitle(tab: Tab, t: Translate) {
  const path = currentPath(tab);
  if (path === GRAPH) return t('nav.graph');
  if (path === REQUESTS) return t('nav.requests');
  if (path === CODE) return t('nav.code');
  if (path === TASKS) return t('nav.tasks');
  if (path === WHITEBOARDS) return t('nav.whiteboards');
  return path ? baseName(path) : t('tabs.new');
}

type TabBarProps = {
  tabs: Tab[];
  activeId: number;
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
  onNew: () => void;
  /** Só com a barra lateral oculta: o botão que a traz de volta. */
  onShowSidebar?: () => void;
};

export function TabBar({ tabs, activeId, onSelect, onClose, onNew, onShowSidebar }: TabBarProps) {
  const t = useT();
  return (
    <div className="flex h-11 shrink-0 items-end gap-1 pl-[18px] pr-3" role="tablist" aria-label={t('tabs.label')}>
      {onShowSidebar && (
        <button className="icon-button mb-1.5 mr-1 h-7 w-7 shrink-0" title={`${t('sidebar.show')} (Ctrl+\\)`} aria-label={t('sidebar.show')} onClick={onShowSidebar}>
          <SidebarIcon size={16} />
        </button>
      )}
      {tabs.map((tab) => {
        const path = currentPath(tab);
        const TabIcon = path === GRAPH ? GraphIcon : path === REQUESTS ? RequestIcon : path === CODE ? CodeIcon : path === TASKS ? TasksIcon : path === WHITEBOARDS ? WhiteboardIcon : path ? PageIcon : PlusIcon;
        return (
          <div
            key={tab.id}
            className="tab group flex h-[34px] min-w-0 max-w-52 flex-1 cursor-pointer items-center gap-2 rounded-t-lg pl-3 pr-1.5 text-[13px]"
            data-active={tab.id === activeId}
            data-sheet={Boolean(path) && !isSpecialPath(path)}
            role="tab"
            tabIndex={tab.id === activeId ? 0 : -1}
            aria-selected={tab.id === activeId}
            title={path && !isSpecialPath(path) ? path : undefined}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              // Setas andam entre as guias, como num tablist; Delete fecha.
              const index = tabs.findIndex((item) => item.id === tab.id);
              const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
              if (step) {
                const next = tabs[(index + step + tabs.length) % tabs.length];
                onSelect(next.id);
                (event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]')[tabs.indexOf(next)])?.focus();
              } else if (event.key === 'Delete') onClose(tab.id);
              else if (event.key === 'Enter' || event.key === ' ') onSelect(tab.id);
              else return;
              event.preventDefault();
            }}
            onAuxClick={(event) => event.button === 1 && onClose(tab.id)}
          >
            <TabIcon size={14} className="row-icon" />
            <span className="flex-1 truncate">{tabTitle(tab, t)}</span>
            <button
              className="icon-button reveal"
              title={t('tabs.close')}
              aria-label={t('tabs.closeNamed', { name: tabTitle(tab, t) })}
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab.id);
              }}
            >
              <CloseIcon size={13} />
            </button>
          </div>
        );
      })}
      <button className="icon-button mb-1.5 ml-1 h-6 w-6" title={t('tabs.new')} aria-label={t('tabs.new')} onClick={onNew}>
        <PlusIcon size={15} />
      </button>
    </div>
  );
}

type LinksPanelProps = {
  backlinks: Note[];
  outgoing: { target: string; path?: string; label?: string }[];
  favorite: boolean;
  onToggleFavorite: () => void;
  onOpen: (path: string) => void;
  onOpenTarget: (target: string) => void;
};

export function LinksPanel({ backlinks, outgoing, favorite, onToggleFavorite, onOpen, onOpenTarget }: LinksPanelProps) {
  const t = useT();
  const heading = 'section-label flex items-center justify-between px-4 pb-2 pt-4';
  const row = 'row w-full px-2 text-left text-[13px]';
  const empty = 'px-4 pb-1 text-[13px] leading-relaxed text-frost-500';

  return (
    <aside className="pane hidden w-60 shrink-0 overflow-y-auto pb-4 lg:block" aria-label={t('links.panel')}>
      <div className="px-2 pt-3">
        <button
          className={row}
          title={t(favorite ? 'favorites.remove' : 'favorites.add')}
          aria-pressed={favorite}
          onClick={onToggleFavorite}
        >
          <StarIcon size={14} filled={favorite} className={favorite ? 'shrink-0 text-sheen-400' : 'row-icon'} />
          <span className="flex-1 truncate">{t(favorite ? 'favorites.on' : 'favorites.off')}</span>
          <Kbd>Ctrl Shift F</Kbd>
        </button>
      </div>
      <div className={`${heading} mt-3 border-t border-(--hairline)`}>
        <span>{t('links.backlinks')}</span>
        <span className="tabular-nums">{backlinks.length}</span>
      </div>
      <div className="px-2">
        {backlinks.map((note) => (
          <button key={note.path} className={row} title={note.path} onClick={() => onOpen(note.path)}>
            <BacklinkIcon size={14} className="row-icon" />
            <span className="truncate">{note.name}</span>
          </button>
        ))}
      </div>
      {!backlinks.length && <p className={empty}>{t('links.noBacklinks')}</p>}

      <div className={`${heading} mt-3 border-t border-(--hairline)`}>
        <span>{t('links.outgoing')}</span>
        <span className="tabular-nums">{outgoing.length}</span>
      </div>
      <div className="px-2">
        {outgoing.map((link) => (
          <button
            key={link.target}
            className={`${row} ${link.path ? '' : 'italic text-frost-500'}`}
            title={link.path ?? t('links.missing')}
            onClick={() => onOpenTarget(link.target)}
          >
            {link.path ? (
              <OutlinkIcon size={14} className="row-icon" />
            ) : (
              <PlusIcon size={14} className="row-icon" />
            )}
            <span className="truncate">{link.label ?? link.target}</span>
          </button>
        ))}
      </div>
      {!outgoing.length && (
        <p className={empty}>
          <Trans k="links.hint" values={{ key: <Kbd>[</Kbd> }} />
        </p>
      )}
    </aside>
  );
}

type SwitcherProps = {
  notes: Note[];
  contents: Record<string, string>;
  // Páginas abertas por último, da mais recente para a mais antiga.
  recents: Note[];
  onOpen: (path: string) => void;
  onCreate: (name: string) => void;
  onClose: () => void;
};

const MAX_RESULTS = 40;
const MIN_CONTENT_QUERY = 2;
const EXCERPT_BEFORE = 36;
const EXCERPT_AFTER = 90;

type Excerpt = { before: string; match: string; after: string };
type SearchResult = { note: Note; excerpt?: Excerpt };

// Trecho do texto em volta da ocorrência, numa linha só.
function excerptAround(text: string, at: number, length: number): Excerpt {
  const start = Math.max(0, at - EXCERPT_BEFORE);
  const end = Math.min(text.length, at + length + EXCERPT_AFTER);
  const flat = (part: string) => part.replace(/\s+/g, ' ');
  return {
    before: (start > 0 ? '…' : '') + flat(text.slice(start, at)).trimStart(),
    match: flat(text.slice(at, at + length)),
    after: flat(text.slice(at + length, end)).trimEnd() + (end < text.length ? '…' : ''),
  };
}

export function QuickSwitcher({ notes, contents, recents, onOpen, onCreate, onClose }: SwitcherProps) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  // Primeiro as páginas cujo nome casa; depois as que têm o termo no texto.
  const results = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    // Sem nada digitado: as recentes primeiro, depois o resto na ordem de sempre.
    if (!wanted) {
      const recent = new Set(recents.map((note) => note.path));
      const rest = notes.filter((note) => !recent.has(note.path));
      return [...recents, ...rest].slice(0, MAX_RESULTS).map((note): SearchResult => ({ note }));
    }
    const byName: SearchResult[] = notes.filter((n) => n.path.toLowerCase().includes(wanted)).map((note) => ({ note }));
    if (wanted.length < MIN_CONTENT_QUERY) return byName.slice(0, MAX_RESULTS);
    const named = new Set(byName.map((result) => result.note.path));
    const byContent: SearchResult[] = [];
    for (const note of notes) {
      if (byName.length + byContent.length >= MAX_RESULTS) break;
      if (named.has(note.path)) continue;
      const text = contents[note.path] ?? '';
      const at = text.toLowerCase().indexOf(wanted);
      if (at >= 0) byContent.push({ note, excerpt: excerptAround(text, at, wanted.length) });
    }
    return [...byName, ...byContent].slice(0, MAX_RESULTS);
  }, [notes, contents, recents, query]);
  const recentCount = query.trim() ? 0 : recents.length;
  const sectionLabel = 'section-label px-2.5 pb-1.5 pt-2';

  const list = useRef<HTMLDivElement>(null);

  useEffect(() => input.current?.focus(), []);

  // A seleção pelas setas acompanha a rolagem da lista.
  useEffect(() => {
    list.current?.querySelector(`#switcher-option-${index}`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const confirm = () => {
    const picked = results[index]?.note;
    if (picked) onOpen(picked.path);
    else if (query.trim()) onCreate(query.trim());
    onClose();
  };

  return (
    <div className="scrim fixed inset-0 z-50 flex items-start justify-center pt-24" onMouseDown={onClose}>
      <div
        className="palette w-[560px] max-w-[90vw] overflow-hidden rounded-xl"
        role="dialog"
        aria-modal="true"
        aria-label={t('switcher.label')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-(--hairline) px-4">
          <SearchIcon size={18} className="shrink-0 text-frost-500" />
          <input
            ref={input}
            className="w-full bg-transparent py-3.5 text-[15px] text-frost-100 caret-sheen-400 outline-none placeholder:text-frost-500"
            placeholder={t('switcher.placeholder')}
            aria-label={t('switcher.label')}
            role="combobox"
            aria-expanded="true"
            aria-controls="switcher-list"
            aria-activedescendant={results[index] ? `switcher-option-${index}` : undefined}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose();
              else if (event.key === 'Enter') confirm();
              else if (event.key === 'ArrowDown') setIndex((i) => Math.min(i + 1, results.length - 1));
              else if (event.key === 'ArrowUp') setIndex((i) => Math.max(i - 1, 0));
              else return;
              event.preventDefault();
            }}
          />
        </div>
        <div ref={list} id="switcher-list" className="max-h-80 overflow-y-auto p-1.5" role="listbox" aria-label={t('switcher.results')}>
          {results.map(({ note, excerpt }, i) => (
            <Fragment key={note.path}>
              {recentCount > 0 && i === 0 && <p className={sectionLabel}>{t('recents.title')}</p>}
              {recentCount > 0 && i === recentCount && <p className={`${sectionLabel} mt-1`}>{t('sidebar.pages')}</p>}
              <div
                id={`switcher-option-${i}`}
                role="option"
                aria-selected={i === index}
                className="row cursor-pointer px-2.5 py-1 text-[13px]"
                data-active={i === index}
                onMouseEnter={() => setIndex(i)}
                onClick={() => {
                  onOpen(note.path);
                  onClose();
                }}
              >
                <PageIcon size={14} className="row-icon" />
                <span className="shrink-0 truncate">{note.name}</span>
                {excerpt ? (
                  <span className="min-w-0 flex-1 truncate pl-3 text-[12px] text-frost-500">
                    {excerpt.before}
                    <mark className="rounded-sm bg-sheen-400/25 px-0.5 text-frost-100">{excerpt.match}</mark>
                    {excerpt.after}
                  </span>
                ) : (
                  <span className="ml-auto truncate pl-4 font-mono text-[11px] text-frost-500">{note.path}</span>
                )}
              </div>
            </Fragment>
          ))}
          {!results.length && (
            <p className="flex items-center gap-2 px-2.5 py-2 text-[13px] text-frost-300">
              {query.trim() ? (
                <Trans k="switcher.create" values={{ key: <Kbd>Enter</Kbd>, name: query.trim() }} />
              ) : (
                t('switcher.empty')
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-4 border-t border-(--hairline) px-4 py-2 text-[11px] text-frost-500">
          <span className="flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> {t('switcher.navigate')}
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>Enter</Kbd> {t('switcher.open')}
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>Esc</Kbd> {t('switcher.close')}
          </span>
        </div>
      </div>
    </div>
  );
}
