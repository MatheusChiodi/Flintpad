import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';

import { Trans, useT } from '../lib/i18n';
import { dirName } from '../lib/links';
import { ancestorFolders, filterNotes, folderList, sanitizeNoteName } from '../lib/notes';
import type { Note } from '../types';
import { ContextMenu, isMenuKey, menuPosition, type MenuItem, type MenuRequest } from './ContextMenu';
import {
  CalendarIcon,
  ChevronIcon,
  CloseIcon,
  BrowserIcon,
  CodeIcon,
  CollapseAllIcon,
  ExpandAllIcon,
  FolderIcon,
  GraphIcon,
  Kbd,
  LocateIcon,
  Mark,
  NewPageIcon,
  PageIcon,
  PlusIcon,
  RequestIcon,
  SearchIcon,
  SettingsIcon,
  SidebarIcon,
  StarIcon,
  TasksIcon,
  TrashIcon,
  WhiteboardIcon,
} from './Icons';

// Linhas que não são <button> (têm botões dentro) respondem a Enter e Espaço como um botão.
export const onActivateKey =
  (action: (event: KeyboardEvent<HTMLElement>) => void) => (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    action(event);
  };

const TAGS_STORAGE_KEY = 'obnotion:sidebar-tags';
// Arrastar uma página da árvore para uma pasta a move para lá.
const DRAG_TYPE = 'application/x-obnotion-note';

// Preferências de exibição só deste computador: sem armazenamento, valem até fechar o app.
function readFlag(key: string) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // armazenamento indisponível
  }
}

type Folder = { name: string; path: string; folders: Folder[]; notes: Note[] };

function buildTree(notes: Note[]): Folder {
  const root: Folder = { name: '', path: '', folders: [], notes: [] };
  for (const note of notes) {
    const parts = note.path.split('/').slice(0, -1);
    let node = root;
    for (const part of parts) {
      let next = node.folders.find((f) => f.name === part);
      if (!next) {
        next = { name: part, path: `${node.path}${part}/`, folders: [], notes: [] };
        node.folders.push(next);
      }
      node = next;
    }
    node.notes.push(note);
  }
  return root;
}

type Props = {
  vault: string;
  notes: Note[];
  activePath: string;
  favorites: string[];
  onToggleFavorite: (path: string) => void;
  onOpen: (path: string, newTab: boolean) => void;
  onNew: (folder: string) => void;
  onDelete: (path: string) => void;
  /** Ações do menu de contexto de uma página. */
  onRename: (path: string, name: string) => void;
  onDuplicate: (path: string) => void;
  onMove: (path: string) => void;
  onMoveTo: (path: string, folder: string) => void;
  onCopyLink: (path: string) => void;
  onGraph: () => void;
  onDaily: () => void;
  onTasks: () => void;
  onWhiteboards: () => void;
  onRequests: () => void;
  onCode: () => void;
  onBrowser: () => void;
  onSearch: () => void;
  onSettings: () => void;
  /** Tags do vault (com as páginas de cada uma) e o que fazer ao escolher uma. */
  tags: { tag: string; paths: string[] }[];
  onTag: (tag: string) => void;
  /** Trilho de ícones: a barra encolhe e o conteúdo ganha a largura. */
  rail: boolean;
  onToggleRail: () => void;
};

export function Sidebar(props: Props) {
  const { vault, notes, activePath, favorites, onToggleFavorite, onOpen, onNew, onDelete, onRename, onDuplicate, onMove, onMoveTo, onCopyLink } = props;
  const { onGraph, onDaily, onTasks, onWhiteboards, onRequests, onCode, onBrowser, onSearch, onSettings, tags, onTag, rail, onToggleRail } = props;
  const t = useT();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuRequest | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const tree = useMemo(() => buildTree(notes), [notes]);
  const folders = useMemo(() => folderList(notes).filter(Boolean), [notes]);
  const filtered = useMemo(() => (filter.trim() ? filterNotes(notes, filter) : null), [notes, filter]);
  // Só entram os favoritos que ainda existem no vault.
  const favoriteNotes = useMemo(
    () => favorites.flatMap((path) => notes.find((n) => n.path === path) ?? []),
    [favorites, notes],
  );

  const [tagsOpen, setTagsOpen] = useState(() => readFlag(TAGS_STORAGE_KEY));
  // Árvore de tags em ordem alfabética: "obra/casa" aparece recuada sob "obra".
  const tagRows = useMemo(() => [...tags].sort((a, b) => a.tag.localeCompare(b.tag)), [tags]);
  const toggleTags = () =>
    setTagsOpen((open) => {
      writeFlag(TAGS_STORAGE_KEY, !open);
      return !open;
    });

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  // A página aberta fica visível na árvore: as pastas acima dela se abrem e a linha entra na tela.
  const reveal = useCallback((path: string, focus = false) => {
    setCollapsed((prev) => {
      const ancestors = ancestorFolders(path);
      if (!ancestors.some((folder) => prev.has(folder))) return prev;
      return new Set([...prev].filter((folder) => !ancestors.includes(folder)));
    });
    requestAnimationFrame(() => {
      const row = treeRef.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`);
      row?.scrollIntoView({ block: 'nearest' });
      if (focus) row?.focus();
    });
  }, []);

  useEffect(() => {
    if (activePath && notes.some((note) => note.path === activePath)) reveal(activePath);
  }, [activePath, notes, reveal]);

  const allCollapsed = folders.length > 0 && folders.every((folder) => collapsed.has(folder));
  const closeMenu = useCallback(() => setMenu(null), []);

  const noteMenu = (note: Note, event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => {
    event.preventDefault();
    const favorite = favorites.includes(note.path);
    const items: MenuItem[] = [
      { label: t('sidebar.menu.openTab'), keys: 'Ctrl Click', run: () => onOpen(note.path, true) },
      { kind: 'separator' },
      { label: t('sidebar.menu.rename'), keys: 'F2', run: () => setRenaming(note.path) },
      { label: t('sidebar.menu.duplicate'), run: () => onDuplicate(note.path) },
      { label: t('sidebar.menu.move'), run: () => onMove(note.path) },
      { kind: 'separator' },
      { label: t(favorite ? 'favorites.remove' : 'favorites.add'), run: () => onToggleFavorite(note.path) },
      { label: t('sidebar.menu.copyLink'), run: () => onCopyLink(note.path) },
      { kind: 'separator' },
      { label: t('common.moveToTrash'), keys: 'Del', danger: true, run: () => onDelete(note.path) },
    ];
    setMenu({ ...menuPosition(event as MouseEvent<HTMLElement>), items, label: note.name });
  };

  const folderMenu = (folder: Folder, event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => {
    event.preventDefault();
    const items: MenuItem[] = [
      { label: t('sidebar.newPageHere'), run: () => onNew(folder.path) },
      { label: t(collapsed.has(folder.path) ? 'sidebar.menu.expand' : 'sidebar.menu.collapse'), run: () => toggle(folder.path) },
    ];
    setMenu({ ...menuPosition(event as MouseEvent<HTMLElement>), items, label: folder.name });
  };

  // Teclado numa página da árvore: F2 renomeia, Delete manda para a lixeira, tecla de menu abre o menu.
  const noteKeys = (note: Note) => (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (isMenuKey(event)) return noteMenu(note, event);
    if (event.key === 'F2') {
      event.preventDefault();
      setRenaming(note.path);
    } else if (event.key === 'Delete') {
      event.preventDefault();
      onDelete(note.path);
    } else onActivateKey((e) => onOpen(note.path, e.ctrlKey || e.metaKey))(event);
  };

  const dragProps = (note: Note) => ({
    draggable: renaming !== note.path,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      event.dataTransfer.setData(DRAG_TYPE, note.path);
      // Soltar num editor de texto vira um wikilink.
      event.dataTransfer.setData('text/plain', `[[${note.name}]]`);
      event.dataTransfer.effectAllowed = 'move';
    },
    onDragEnd: () => setDropTarget(null),
  });

  const dropProps = (folder: string) => ({
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      setDropTarget(folder);
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTarget((current) => (current === folder ? null : current));
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      const path = event.dataTransfer.getData(DRAG_TYPE);
      setDropTarget(null);
      if (!path) return;
      event.preventDefault();
      event.stopPropagation();
      if (dirName(path) !== folder) onMoveTo(path, folder);
    },
  });

  const favoriteButton = (note: Note) => {
    const on = favorites.includes(note.path);
    return (
      <button
        className="icon-button reveal"
        data-on={on}
        title={t(on ? 'favorites.remove' : 'favorites.add')}
        aria-label={t(on ? 'favorites.removeNamed' : 'favorites.addNamed', { name: note.name })}
        aria-pressed={on}
        onClick={(event) => {
          event.stopPropagation();
          onToggleFavorite(note.path);
        }}
      >
        <StarIcon size={14} filled={on} />
      </button>
    );
  };

  const noteRow = (note: Note, indent: number, detail?: string) =>
    renaming === note.path ? (
      <RenameRow
        key={note.path}
        note={note}
        indent={indent}
        onDone={() => {
          setRenaming(null);
          reveal(note.path, true);
        }}
        onRename={onRename}
      />
    ) : (
      <div
        key={note.path}
        className="row group cursor-pointer pr-1 text-[13px]"
        data-active={note.path === activePath}
        data-path={note.path}
        style={{ paddingLeft: indent }}
        title={note.path}
        role="treeitem"
        tabIndex={0}
        aria-current={note.path === activePath ? 'page' : undefined}
        onClick={(event) => onOpen(note.path, event.ctrlKey || event.metaKey)}
        onKeyDown={noteKeys(note)}
        onAuxClick={(event) => event.button === 1 && onOpen(note.path, true)}
        onContextMenu={(event) => noteMenu(note, event)}
        {...dragProps(note)}
      >
        <PageIcon size={14} className="row-icon" />
        <span className="min-w-0 flex-1 truncate">
          {note.name}
          {detail && <span className="ml-2 text-[11px] text-frost-500">{detail}</span>}
        </span>
        {favoriteButton(note)}
        <button
          className="icon-button reveal"
          data-danger="true"
          title={t('common.moveToTrash')}
          aria-label={t('sidebar.trashNote', { name: note.name })}
          onClick={(event) => {
            event.stopPropagation();
            onDelete(note.path);
          }}
        >
          <TrashIcon size={14} />
        </button>
      </div>
    );

  const renderFolder = (folder: Folder, depth: number) => (
    <div key={folder.path} className={depth ? 'tree-group' : undefined} role={depth ? 'group' : undefined}>
      {folder.folders.map((child) => (
        <div key={child.path} className="tree-folder" data-drop={dropTarget === child.path} {...dropProps(child.path)}>
          <div
            className="row group cursor-pointer pr-1 text-[13px]"
            style={{ paddingLeft: 6 + depth * 14 }}
            role="treeitem"
            tabIndex={0}
            aria-expanded={!collapsed.has(child.path)}
            onClick={() => toggle(child.path)}
            onContextMenu={(event) => folderMenu(child, event)}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (isMenuKey(event)) return folderMenu(child, event);
              if (event.key === 'ArrowRight' && collapsed.has(child.path)) toggle(child.path);
              else if (event.key === 'ArrowLeft' && !collapsed.has(child.path)) toggle(child.path);
              else return onActivateKey(() => toggle(child.path))(event);
              event.preventDefault();
            }}
          >
            <ChevronIcon size={12} className={`chevron row-icon ${collapsed.has(child.path) ? '' : 'rotate-90'}`} />
            <FolderIcon size={14} className="row-icon" />
            <span className="flex-1 truncate font-medium">{child.name}</span>
            <button
              className="icon-button reveal"
              title={t('sidebar.newPageHere')}
              aria-label={t('sidebar.newPageIn', { folder: child.name })}
              onClick={(event) => {
                event.stopPropagation();
                onNew(child.path);
              }}
            >
              <PlusIcon size={14} />
            </button>
          </div>
          {!collapsed.has(child.path) && renderFolder(child, depth + 1)}
        </div>
      ))}
      {folder.notes.map((note) => noteRow(note, 26 + depth * 14))}
    </div>
  );

  const navButton = (label: string, keys: string, Icon: typeof SearchIcon, action: () => void) => (
    <button className="row w-full px-2 text-[13px]" title={`${label} (${keys.replace(/ /g, '+')})`} aria-label={label} onClick={action}>
      <Icon className="row-icon" />
      <span className="rail-hide flex-1 text-left">{label}</span>
      <Kbd>{keys}</Kbd>
    </button>
  );

  return (
    <aside className="sidebar pane flex w-64 shrink-0 flex-col border-r border-(--hairline)" data-rail={rail}>
      <div className="sidebar-head flex items-center gap-2.5 px-4 pb-3 pt-4" title={vault}>
        <Mark size={22} className="rail-mark shrink-0" />
        <span className="rail-hide flex-1 truncate font-display text-[17px] font-semibold tracking-tight text-frost-100">
          {vault.split(/[\\/]/).pop()}
        </span>
        <button
          className="rail-toggle icon-button h-7 w-7 shrink-0"
          title={`${t(rail ? 'sidebar.expand' : 'sidebar.collapse')} (Ctrl+Shift+\\)`}
          aria-label={t(rail ? 'sidebar.expand' : 'sidebar.collapse')}
          aria-pressed={rail}
          onClick={onToggleRail}
        >
          <SidebarIcon size={16} />
        </button>
      </div>
      <nav className="sidebar-nav flex flex-col gap-px px-2 pb-3">
        {navButton(t('sidebar.search'), 'Ctrl P', SearchIcon, onSearch)}
        {navButton(t('sidebar.newPage'), 'Ctrl N', NewPageIcon, () => onNew(''))}
        {navButton(t('nav.daily'), 'Ctrl D', CalendarIcon, onDaily)}
        {navButton(t('nav.tasks'), 'Ctrl Shift J', TasksIcon, onTasks)}
        {navButton(t('nav.whiteboards'), 'Ctrl Shift B', WhiteboardIcon, onWhiteboards)}
        {navButton(t('nav.graph'), 'Ctrl G', GraphIcon, onGraph)}
        {navButton(t('nav.requests'), 'Ctrl Shift E', RequestIcon, onRequests)}
        {navButton(t('nav.code'), 'Ctrl Shift K', CodeIcon, onCode)}
        {navButton(t('nav.browser'), 'Ctrl Shift Y', BrowserIcon, onBrowser)}
      </nav>
      {favoriteNotes.length > 0 && (
        <>
          <div className="rail-hide section-label flex items-center justify-between border-t border-(--hairline) px-4 pb-2 pt-3.5">
            <span>{t('favorites.title')}</span>
            <span className="tabular-nums">{favoriteNotes.length}</span>
          </div>
          <div className="rail-tree max-h-[30%] shrink-0 overflow-y-auto px-2">
            <div className="pb-3" role="list" aria-label={t('favorites.title')}>
              {favoriteNotes.map((note) => (
                <div
                  key={note.path}
                  className="row group cursor-pointer pl-2 pr-1 text-[13px]"
                  data-active={note.path === activePath}
                  title={note.path}
                  role="listitem"
                  tabIndex={0}
                  onClick={(event) => onOpen(note.path, event.ctrlKey || event.metaKey)}
                  onKeyDown={(event) => (isMenuKey(event) ? noteMenu(note, event) : onActivateKey((e) => onOpen(note.path, e.ctrlKey || e.metaKey))(event))}
                  onAuxClick={(event) => event.button === 1 && onOpen(note.path, true)}
                  onContextMenu={(event) => noteMenu(note, event)}
                  {...dragProps(note)}
                >
                  <PageIcon size={14} className="row-icon" />
                  <span className="flex-1 truncate">{note.name}</span>
                  {favoriteButton(note)}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
      {tagRows.length > 0 && (
        <div className="rail-hide border-t border-(--hairline) px-2 pt-1.5">
          <button className="row section-label w-full px-2" aria-expanded={tagsOpen} aria-controls="sidebar-tags" onClick={toggleTags}>
            <ChevronIcon size={12} className={`chevron row-icon ${tagsOpen ? 'rotate-90' : ''}`} />
            <span className="flex-1 text-left">{t('tags.title')}</span>
            <span className="tabular-nums">{tags.filter((entry) => !entry.tag.includes('/')).length}</span>
          </button>
          {tagsOpen && (
            <ul id="sidebar-tags" className="max-h-44 overflow-y-auto pb-2" aria-label={t('tags.title')}>
              {tagRows.map(({ tag, paths }) => {
                const depth = tag.split('/').length - 1;
                return (
                  <li key={tag}>
                    <button
                      className="row w-full pr-2 text-left text-[13px]"
                      style={{ paddingLeft: 10 + depth * 12 }}
                      title={t('tags.search', { tag })}
                      onClick={() => onTag(tag)}
                    >
                      <span className="tag-hash" aria-hidden="true">
                        #
                      </span>
                      <span className="flex-1 truncate">{tag.split('/').pop()}</span>
                      <span className="text-[11px] tabular-nums text-frost-500">{paths.length}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      <div
        className="rail-hide section-label flex items-center gap-1 border-t border-(--hairline) pb-1.5 pl-4 pr-2 pt-2.5"
        data-drop={dropTarget === ''}
        {...dropProps('')}
      >
        <span className="flex-1">{t('sidebar.pages')}</span>
        {notes.length > 0 && <span className="mr-1 tabular-nums">{notes.length}</span>}
        {activePath && notes.some((note) => note.path === activePath) && (
          <button className="icon-button" title={t('sidebar.reveal')} aria-label={t('sidebar.reveal')} onClick={() => {
              setFilter('');
              reveal(activePath, true);
            }}>
            <LocateIcon size={13} />
          </button>
        )}
        {folders.length > 0 && (
          <button
            className="icon-button"
            title={t(allCollapsed ? 'sidebar.expandAll' : 'sidebar.collapseAll')}
            aria-label={t(allCollapsed ? 'sidebar.expandAll' : 'sidebar.collapseAll')}
            onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(folders))}
          >
            {allCollapsed ? <ExpandAllIcon size={13} /> : <CollapseAllIcon size={13} />}
          </button>
        )}
      </div>
      {notes.length > 0 && (
        <div className="rail-hide px-2 pb-1.5">
          <label className="tree-filter">
            <SearchIcon size={13} className="shrink-0 text-frost-500" />
            <input
              value={filter}
              placeholder={t('sidebar.filter')}
              aria-label={t('sidebar.filter')}
              spellCheck={false}
              onChange={(event) => setFilter(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setFilter('');
                else if (event.key === 'ArrowDown') treeRef.current?.querySelector<HTMLElement>('[role="treeitem"]')?.focus();
                else return;
                event.preventDefault();
              }}
            />
            {filter && (
              <button className="icon-button h-5 w-5" title={t('sidebar.clearFilter')} aria-label={t('sidebar.clearFilter')} onClick={() => setFilter('')}>
                <CloseIcon size={12} />
              </button>
            )}
          </label>
        </div>
      )}
      <div
        ref={treeRef}
        className="rail-tree flex-1 overflow-y-auto px-2 pb-4"
        role="tree"
        aria-label={t('sidebar.pages')}
        onKeyDown={(event) => {
          // Setas para cima e para baixo andam entre as linhas visíveis da árvore.
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          const rows = [...(treeRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])];
          const index = rows.indexOf(document.activeElement as HTMLElement);
          if (index < 0) return;
          event.preventDefault();
          rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
        }}
      >
        {!notes.length ? (
          <div className="mx-2 mt-2 rounded-lg border border-dashed border-(--hairline-strong) px-3 py-4 text-[13px] leading-relaxed">
            <p className="font-medium text-frost-100">{t('sidebar.emptyTitle')}</p>
            <p className="mt-1 text-frost-500">
              <Trans k="sidebar.emptyHint" values={{ key: <Kbd>Ctrl N</Kbd> }} />
            </p>
          </div>
        ) : filtered ? (
          filtered.length ? (
            filtered.map((note) => noteRow(note, 8, dirName(note.path).replace(/\/$/, '')))
          ) : (
            <p className="px-2 py-2 text-[13px] text-frost-500">{t('sidebar.noFilterMatch')}</p>
          )
        ) : (
          renderFolder(tree, 0)
        )}
      </div>
      <div className="border-t border-(--hairline) p-2">
        <button className="row w-full px-2 text-[13px]" title={t('sidebar.settings')} onClick={onSettings}>
          <SettingsIcon className="row-icon" />
          <span className="rail-hide flex-1 text-left">{t('sidebar.settings')}</span>
          <Kbd>Ctrl ,</Kbd>
        </button>
      </div>
      {menu && <ContextMenu request={menu} onClose={closeMenu} />}
    </aside>
  );
}

// Renomear na própria árvore: Enter confirma, Esc ou sair do campo sem mudar desiste.
function RenameRow({ note, indent, onDone, onRename }: { note: Note; indent: number; onDone: () => void; onRename: (path: string, name: string) => void }) {
  const t = useT();
  const [value, setValue] = useState(note.name);
  const done = useRef(false);
  const commit = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const name = sanitizeNoteName(value);
    if (save && name && name !== note.name) onRename(note.path, name);
    onDone();
  };
  return (
    <div className="row pr-1 text-[13px]" style={{ paddingLeft: indent }} data-active="true">
      <PageIcon size={14} className="row-icon" />
      <input
        className="tree-rename"
        value={value}
        autoFocus
        aria-label={t('sidebar.renameLabel', { name: note.name })}
        spellCheck={false}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => commit(true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit(true);
          else if (event.key === 'Escape') commit(false);
          else return;
          event.preventDefault();
        }}
      />
    </div>
  );
}
