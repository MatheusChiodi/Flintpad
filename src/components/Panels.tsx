import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';

import { Trans, useT, type Translate } from '../lib/i18n';
import { baseName } from '../lib/links';
import { fuzzyFilter } from '../lib/fuzzy';
import { parseSearchQuery, searchNotes, type Excerpt, type Heading, type Mention } from '../lib/notes';
import { CODE, GRAPH, isSpecialPath, REQUESTS, TASKS, WHITEBOARDS, type Note, type Tab } from '../types';
import { ContextMenu, isMenuKey, menuPosition, type MenuItem, type MenuRequest } from './ContextMenu';
import { BacklinkIcon, ChevronIcon, CloseIcon, PinIcon, GraphIcon, Kbd, SidebarIcon, OutlinkIcon, PageIcon, PlusIcon, SearchIcon, RequestIcon, CodeIcon, StarIcon, TasksIcon, WhiteboardIcon } from './Icons';

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
  /** force: fecha mesmo fixada (pedido explícito, como o X ou o menu). */
  onClose: (id: number, force?: boolean) => void;
  onNew: () => void;
  onPin: (id: number) => void;
  onCloseOthers: (id: number) => void;
  onCloseRight: (id: number) => void;
  onMove: (id: number, to: number) => void;
  onDuplicate: (id: number) => void;
  onCopyLink: (id: number) => void;
  /** Só com a barra lateral oculta: o botão que a traz de volta. */
  onShowSidebar?: () => void;
};

const TAB_DRAG_TYPE = 'application/x-obnotion-tab';

export function TabBar({ tabs, activeId, onSelect, onClose, onNew, onPin, onCloseOthers, onCloseRight, onMove, onDuplicate, onCopyLink, onShowSidebar }: TabBarProps) {
  const t = useT();
  const [menu, setMenu] = useState<MenuRequest | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const openMenu = (tab: Tab, event: ReactMouseEvent<HTMLElement> | ReactKeyboardEvent<HTMLElement>) => {
    event.preventDefault();
    const path = currentPath(tab);
    const isPage = Boolean(path) && !isSpecialPath(path);
    const index = tabs.indexOf(tab);
    const items: MenuItem[] = [
      { label: t(tab.pinned ? 'tabs.unpin' : 'tabs.pin'), run: () => onPin(tab.id) },
      { label: t('tabs.duplicate'), disabled: !path, run: () => onDuplicate(tab.id) },
      { label: t('sidebar.menu.copyLink'), disabled: !isPage, run: () => onCopyLink(tab.id) },
      { kind: 'separator' },
      { label: t('tabs.close'), keys: 'Ctrl W', run: () => onClose(tab.id, true) },
      { label: t('tabs.closeOthers'), disabled: tabs.every((other) => other.id === tab.id || other.pinned), run: () => onCloseOthers(tab.id) },
      { label: t('tabs.closeRight'), disabled: tabs.slice(index + 1).every((other) => other.pinned), run: () => onCloseRight(tab.id) },
    ];
    setMenu({ ...menuPosition(event as ReactMouseEvent<HTMLElement>), items, label: tabTitle(tab, t) });
  };

  return (
    <div className="flex h-11 shrink-0 items-end gap-1 pl-[18px] pr-3" role="tablist" aria-label={t('tabs.label')}>
      {onShowSidebar && (
        <button className="icon-button mb-1.5 mr-1 h-7 w-7 shrink-0" title={`${t('sidebar.show')} (Ctrl+\\)`} aria-label={t('sidebar.show')} onClick={onShowSidebar}>
          <SidebarIcon size={16} />
        </button>
      )}
      {tabs.map((tab, index) => {
        const path = currentPath(tab);
        const TabIcon = path === GRAPH ? GraphIcon : path === REQUESTS ? RequestIcon : path === CODE ? CodeIcon : path === TASKS ? TasksIcon : path === WHITEBOARDS ? WhiteboardIcon : path ? PageIcon : PlusIcon;
        return (
          <div
            key={tab.id}
            className={`tab group flex h-[34px] min-w-0 cursor-pointer items-center gap-2 rounded-t-lg pl-3 pr-1.5 text-[13px] ${tab.pinned ? 'max-w-40 shrink-0' : 'max-w-52 flex-1'}`}
            data-active={tab.id === activeId}
            data-sheet={Boolean(path) && !isSpecialPath(path)}
            data-pinned={tab.pinned ?? false}
            data-drop={dropAt === index}
            role="tab"
            tabIndex={tab.id === activeId ? 0 : -1}
            aria-selected={tab.id === activeId}
            title={path && !isSpecialPath(path) ? path : undefined}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(TAB_DRAG_TYPE, String(tab.id));
              event.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes(TAB_DRAG_TYPE)) return;
              event.preventDefault();
              setDropAt(index);
            }}
            onDragLeave={() => setDropAt((current) => (current === index ? null : current))}
            onDrop={(event) => {
              const id = Number(event.dataTransfer.getData(TAB_DRAG_TYPE));
              setDropAt(null);
              if (!id) return;
              event.preventDefault();
              onMove(id, index);
            }}
            onDragEnd={() => setDropAt(null)}
            onClick={() => onSelect(tab.id)}
            onContextMenu={(event) => openMenu(tab, event)}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (isMenuKey(event)) return openMenu(tab, event);
              // Setas andam entre as guias, como num tablist; com Shift, levam a guia junto. Delete fecha.
              const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
              const bar = event.currentTarget.parentElement;
              const focusAt = (position: number) => requestAnimationFrame(() => bar?.querySelectorAll<HTMLElement>('[role="tab"]')[position]?.focus());
              if (step && event.shiftKey) {
                onMove(tab.id, index + step);
                focusAt(Math.max(0, Math.min(tabs.length - 1, index + step)));
              } else if (step) {
                const next = (index + step + tabs.length) % tabs.length;
                onSelect(tabs[next].id);
                bar?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
              } else if (event.key === 'Delete') onClose(tab.id, true);
              else if (event.key === 'Enter' || event.key === ' ') onSelect(tab.id);
              else return;
              event.preventDefault();
            }}
            onAuxClick={(event) => event.button === 1 && onClose(tab.id, true)}
          >
            <TabIcon size={14} className="row-icon" />
            <span className="flex-1 truncate">{tabTitle(tab, t)}</span>
            {tab.pinned ? (
              <button
                className="icon-button tab-pin"
                title={t('tabs.unpin')}
                aria-label={t('tabs.unpinNamed', { name: tabTitle(tab, t) })}
                onClick={(event) => {
                  event.stopPropagation();
                  onPin(tab.id);
                }}
              >
                <PinIcon size={13} />
              </button>
            ) : (
              <button
                className="icon-button reveal"
                title={t('tabs.close')}
                aria-label={t('tabs.closeNamed', { name: tabTitle(tab, t) })}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(tab.id, true);
                }}
              >
                <CloseIcon size={13} />
              </button>
            )}
          </div>
        );
      })}
      <button className="icon-button mb-1.5 ml-1 h-6 w-6" title={t('tabs.new')} aria-label={t('tabs.new')} onClick={onNew}>
        <PlusIcon size={15} />
      </button>
      {menu && <ContextMenu request={menu} onClose={closeMenu} />}
    </div>
  );
}

export type BacklinkItem = { note: Note; contexts: Excerpt[] };

type LinksPanelProps = {
  backlinks: BacklinkItem[];
  outgoing: { target: string; path?: string; label?: string }[];
  headings: Heading[];
  onHeading: (index: number) => void;
  /** Menções sem link: só calculadas quando a seção está aberta (varre o vault). */
  findMentions: () => Mention[];
  onLinkMention: (path: string) => void;
  favorite: boolean;
  onToggleFavorite: () => void;
  onOpen: (path: string) => void;
  onOpenTarget: (target: string) => void;
};

const MENTIONS_STORAGE_KEY = 'obnotion:mentions-open';

function Snippet({ excerpt }: { excerpt: Excerpt }) {
  return (
    <span className="snippet">
      {excerpt.before}
      <mark>{excerpt.match}</mark>
      {excerpt.after}
    </span>
  );
}

export function LinksPanel({ backlinks, outgoing, headings, onHeading, findMentions, onLinkMention, favorite, onToggleFavorite, onOpen, onOpenTarget }: LinksPanelProps) {
  const t = useT();
  const [mentionsOpen, setMentionsOpen] = useState(() => {
    try {
      return localStorage.getItem(MENTIONS_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const mentions = useMemo(() => (mentionsOpen ? findMentions() : []), [mentionsOpen, findMentions]);
  const heading = 'section-label flex items-center justify-between px-4 pb-2 pt-4';
  const row = 'row w-full px-2 text-left text-[13px]';
  const empty = 'px-4 pb-1 text-[13px] leading-relaxed text-frost-500';
  const minLevel = Math.min(...headings.map((item) => item.level));

  const toggleMentions = () =>
    setMentionsOpen((open) => {
      try {
        localStorage.setItem(MENTIONS_STORAGE_KEY, open ? '0' : '1');
      } catch {
        // armazenamento indisponível: vale só nesta sessão
      }
      return !open;
    });

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

      {headings.length > 0 && (
        <nav aria-label={t('outline.title')}>
          <div className={`${heading} mt-3 border-t border-(--hairline)`}>
            <span>{t('outline.title')}</span>
            <span className="tabular-nums">{headings.length}</span>
          </div>
          <ol className="px-2">
            {headings.map((item, index) => (
              <li key={`${index}:${item.text}`}>
                <button
                  className={`${row} outline-row`}
                  style={{ paddingLeft: 8 + (item.level - minLevel) * 12 }}
                  data-level={item.level - minLevel + 1}
                  title={item.text}
                  onClick={() => onHeading(index)}
                >
                  <span className="truncate">{item.text}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
      )}

      <div className={`${heading} mt-3 border-t border-(--hairline)`}>
        <span>{t('links.backlinks')}</span>
        <span className="tabular-nums">{backlinks.length}</span>
      </div>
      <ul className="px-2">
        {backlinks.map(({ note, contexts }) => (
          <li key={note.path}>
            <button className={`${row} backlink-row`} title={note.path} onClick={() => onOpen(note.path)}>
              <span className="flex items-center gap-2">
                <BacklinkIcon size={14} className="row-icon" />
                <span className="truncate">{note.name}</span>
              </span>
              {contexts.map((excerpt, index) => (
                <Snippet key={index} excerpt={excerpt} />
              ))}
            </button>
          </li>
        ))}
      </ul>
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
            {link.path ? <OutlinkIcon size={14} className="row-icon" /> : <PlusIcon size={14} className="row-icon" />}
            <span className="truncate">{link.label ?? link.target}</span>
          </button>
        ))}
      </div>
      {!outgoing.length && (
        <p className={empty}>
          <Trans k="links.hint" values={{ key: <Kbd>[</Kbd> }} />
        </p>
      )}

      <div className="mt-3 border-t border-(--hairline) px-2 pt-2">
        <button className={`${row} section-label`} aria-expanded={mentionsOpen} aria-controls="unlinked-mentions" onClick={toggleMentions}>
          <ChevronIcon size={12} className={`chevron row-icon ${mentionsOpen ? 'rotate-90' : ''}`} />
          <span className="flex-1">{t('mentions.title')}</span>
          {mentionsOpen && <span className="tabular-nums">{mentions.length}</span>}
        </button>
      </div>
      {mentionsOpen && (
        <div id="unlinked-mentions">
          <ul className="px-2">
            {mentions.map((mention) => (
              <li key={mention.path} className="group relative">
                <button className={`${row} backlink-row pr-14`} title={mention.path} onClick={() => onOpen(mention.path)}>
                  <span className="flex items-center gap-2">
                    <PageIcon size={14} className="row-icon" />
                    <span className="truncate">{mention.name}</span>
                    {mention.count > 1 && <span className="text-[11px] tabular-nums text-frost-500">×{mention.count}</span>}
                  </span>
                  <Snippet excerpt={mention.excerpt} />
                </button>
                <button
                  className="mention-link reveal"
                  title={t('mentions.linkHint')}
                  aria-label={t('mentions.linkNamed', { name: mention.name })}
                  onClick={() => onLinkMention(mention.path)}
                >
                  {t('mentions.link')}
                </button>
              </li>
            ))}
          </ul>
          {!mentions.length && <p className={empty}>{t('mentions.none')}</p>}
        </div>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------------------------
// Busca rápida e paleta de comandos

export type Command = { id: string; label: string; keys?: string; run: () => void };
export type PickerItem = { id: string; label: string; detail?: string };
/** Lista de escolha avulsa (pasta de destino, modelo): usa a mesma janela da busca. */
export type Picker = { placeholder: string; items: PickerItem[]; empty: string; onPick: (id: string) => void };

type SwitcherProps = {
  notes: Note[];
  contents: Record<string, string>;
  // Páginas abertas por último, da mais recente para a mais antiga.
  recents: Note[];
  commands: Command[];
  initialQuery?: string;
  picker?: Picker;
  onOpen: (path: string, newTab: boolean) => void;
  onCreate: (name: string) => void;
  onClose: () => void;
};

const MAX_RESULTS = 40;
const COMMAND_PREFIX = '>';

type Row =
  | { kind: 'note'; key: string; note: Note; positions: number[]; excerpt?: Excerpt }
  | { kind: 'command'; key: string; command: Command; positions: number[] }
  | { kind: 'pick'; key: string; item: PickerItem; positions: number[] };

// Letras que casaram com a busca, destacadas.
function Highlighted({ text, positions }: { text: string; positions: number[] }) {
  if (!positions.length) return <>{text}</>;
  const marked = new Set(positions);
  return (
    <>
      {[...text].map((char, i) =>
        marked.has(i) ? (
          <mark key={i} className="fuzzy-hit">
            {char}
          </mark>
        ) : (
          <Fragment key={i}>{char}</Fragment>
        ),
      )}
    </>
  );
}

export function QuickSwitcher({ notes, contents, recents, commands, initialQuery = '', picker, onOpen, onCreate, onClose }: SwitcherProps) {
  const t = useT();
  const [query, setQuery] = useState(initialQuery);
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const commandMode = !picker && query.startsWith(COMMAND_PREFIX);

  const rows = useMemo((): Row[] => {
    if (picker) {
      return fuzzyFilter(query, picker.items, (item) => `${item.label} ${item.detail ?? ''}`, MAX_RESULTS).map(({ item, positions }) => ({
        kind: 'pick',
        key: item.id,
        item,
        positions: positions.filter((p) => p < item.label.length),
      }));
    }
    if (commandMode) {
      return fuzzyFilter(query.slice(COMMAND_PREFIX.length), commands, (command) => command.label, MAX_RESULTS).map(({ item, positions }) => ({
        kind: 'command',
        key: item.id,
        command: item,
        positions,
      }));
    }
    // Sem nada digitado: as recentes primeiro, depois o resto na ordem de sempre.
    if (!query.trim()) {
      const recent = new Set(recents.map((note) => note.path));
      return [...recents, ...notes.filter((note) => !recent.has(note.path))]
        .slice(0, MAX_RESULTS)
        .map((note) => ({ kind: 'note', key: note.path, note, positions: [] }));
    }
    return searchNotes(query, notes, contents, MAX_RESULTS).map((hit) => ({ kind: 'note', key: hit.note.path, ...hit }));
  }, [picker, commandMode, query, commands, notes, contents, recents]);

  const recentCount = picker || commandMode || query.trim() ? 0 : recents.length;
  const parsed = parseSearchQuery(query);
  // Criar só quando há um nome de verdade (filtros como tag: não viram página).
  const creatable = !picker && !commandMode && parsed.text.trim() && !parsed.tags.length && !parsed.paths.length;
  const sectionLabel = 'section-label px-2.5 pb-1.5 pt-2';

  useEffect(() => {
    input.current?.focus();
    // A busca aberta com um filtro (tag:x) deixa o cursor no fim, pronto para refinar.
    const length = input.current?.value.length ?? 0;
    input.current?.setSelectionRange(length, length);
  }, []);

  // A seleção pelas setas acompanha a rolagem da lista.
  useEffect(() => {
    list.current?.querySelector(`#switcher-option-${index}`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const choose = (row: Row | undefined, newTab: boolean) => {
    onClose();
    if (!row) {
      if (creatable) onCreate(parsed.text.trim());
      return;
    }
    if (row.kind === 'note') onOpen(row.note.path, newTab);
    else if (row.kind === 'command') row.command.run();
    else picker?.onPick(row.item.id);
  };

  const placeholder = picker ? picker.placeholder : commandMode ? t('switcher.commandsPlaceholder') : t('switcher.placeholder');

  return (
    <div className="scrim fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]" onMouseDown={onClose}>
      <div
        className="palette w-[580px] max-w-full overflow-hidden rounded-xl"
        role="dialog"
        aria-modal="true"
        aria-label={placeholder}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-(--hairline) px-4">
          {commandMode ? (
            <span className="w-[18px] shrink-0 text-center font-mono text-[15px] text-sheen-400" aria-hidden="true">
              ›
            </span>
          ) : (
            <SearchIcon size={18} className="shrink-0 text-frost-500" />
          )}
          <input
            ref={input}
            className="w-full bg-transparent py-3.5 text-[15px] text-frost-100 caret-sheen-400 outline-none placeholder:text-frost-500"
            placeholder={placeholder}
            aria-label={placeholder}
            role="combobox"
            aria-expanded="true"
            aria-controls="switcher-list"
            aria-activedescendant={rows[index] ? `switcher-option-${index}` : undefined}
            value={query}
            spellCheck={false}
            onChange={(event) => {
              setQuery(event.target.value);
              setIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose();
              else if (event.key === 'Enter') choose(rows[index], event.ctrlKey || event.metaKey);
              else if (event.key === 'ArrowDown') setIndex((i) => Math.min(i + 1, rows.length - 1));
              else if (event.key === 'ArrowUp') setIndex((i) => Math.max(i - 1, 0));
              else if (event.key === 'PageDown') setIndex((i) => Math.min(i + 8, rows.length - 1));
              else if (event.key === 'PageUp') setIndex((i) => Math.max(i - 8, 0));
              else return;
              event.preventDefault();
            }}
          />
        </div>
        <div ref={list} id="switcher-list" className="max-h-[min(22rem,55vh)] overflow-y-auto p-1.5" role="listbox" aria-label={t('switcher.results')}>
          {rows.map((row, i) => (
            <Fragment key={row.key}>
              {recentCount > 0 && i === 0 && <p className={sectionLabel}>{t('recents.title')}</p>}
              {recentCount > 0 && i === recentCount && <p className={`${sectionLabel} mt-1`}>{t('sidebar.pages')}</p>}
              <div
                id={`switcher-option-${i}`}
                role="option"
                aria-selected={i === index}
                className="row cursor-pointer px-2.5 py-1 text-[13px]"
                data-active={i === index}
                onMouseEnter={() => setIndex(i)}
                onClick={(event) => choose(row, event.ctrlKey || event.metaKey)}
              >
                {row.kind === 'note' && (
                  <>
                    <PageIcon size={14} className="row-icon" />
                    <span className="shrink-0 truncate">
                      <Highlighted text={row.note.name} positions={row.positions} />
                    </span>
                    {row.excerpt ? (
                      <span className="min-w-0 flex-1 truncate pl-3 text-[12px] text-frost-500">
                        {row.excerpt.before}
                        <mark className="rounded-sm bg-sheen-400/25 px-0.5 text-frost-100">{row.excerpt.match}</mark>
                        {row.excerpt.after}
                      </span>
                    ) : (
                      <span className="ml-auto truncate pl-4 font-mono text-[11px] text-frost-500">{row.note.path}</span>
                    )}
                  </>
                )}
                {row.kind === 'command' && (
                  <>
                    <span className="min-w-0 flex-1 truncate">
                      <Highlighted text={row.command.label} positions={row.positions} />
                    </span>
                    {row.command.keys && <Kbd>{row.command.keys}</Kbd>}
                  </>
                )}
                {row.kind === 'pick' && (
                  <>
                    <span className="shrink-0 truncate">
                      <Highlighted text={row.item.label} positions={row.positions} />
                    </span>
                    {row.item.detail && <span className="ml-auto truncate pl-4 font-mono text-[11px] text-frost-500">{row.item.detail}</span>}
                  </>
                )}
              </div>
            </Fragment>
          ))}
          {!rows.length && (
            <p className="flex items-center gap-2 px-2.5 py-2 text-[13px] text-frost-300">
              {picker ? (
                picker.empty
              ) : commandMode ? (
                t('switcher.noCommands')
              ) : creatable ? (
                <Trans k="switcher.create" values={{ key: <Kbd>Enter</Kbd>, name: parsed.text.trim() }} />
              ) : query.trim() ? (
                t('switcher.noMatch')
              ) : (
                t('switcher.empty')
              )}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-(--hairline) px-4 py-2 text-[11px] text-frost-500">
          <span className="flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> {t('switcher.navigate')}
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>Enter</Kbd> {commandMode ? t('switcher.run') : t('switcher.open')}
          </span>
          {!picker && !commandMode && (
            <>
              <span className="flex items-center gap-1.5">
                <Kbd>Ctrl Enter</Kbd> {t('switcher.openTab')}
              </span>
              <span className="flex items-center gap-1.5">
                <Kbd>&gt;</Kbd> {t('switcher.commands')}
              </span>
              <span className="flex items-center gap-1.5">
                <Kbd>tag:</Kbd>
                <Kbd>path:</Kbd> {t('switcher.filters')}
              </span>
            </>
          )}
          <span className="ml-auto flex items-center gap-1.5">
            <Kbd>Esc</Kbd> {t('switcher.close')}
          </span>
        </div>
      </div>
    </div>
  );
}
