import { useMemo, useState } from 'react';

import { Trans, useT } from '../lib/i18n';
import type { Note } from '../types';
import { ChevronIcon, FolderIcon, GraphIcon, CalendarIcon, Kbd, RequestIcon, CodeIcon, Mark, NewPageIcon, PageIcon, PlusIcon, SearchIcon, SettingsIcon, StarIcon, TasksIcon, TrashIcon } from './Icons';

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
  onGraph: () => void;
  onDaily: () => void;
  onTasks: () => void;
  onRequests: () => void;
  onCode: () => void;
  onSearch: () => void;
  onSettings: () => void;
};

export function Sidebar({ vault, notes, activePath, favorites, onToggleFavorite, onOpen, onNew, onDelete, onGraph, onDaily, onTasks, onRequests, onCode, onSearch, onSettings }: Props) {
  const t = useT();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const tree = useMemo(() => buildTree(notes), [notes]);
  // Só entram os favoritos que ainda existem no vault.
  const favoriteNotes = useMemo(
    () => favorites.flatMap((path) => notes.find((n) => n.path === path) ?? []),
    [favorites, notes],
  );

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(path)) next.add(path);
      return next;
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

  const renderFolder = (folder: Folder, depth: number) => (
    <div key={folder.path} className={depth ? 'tree-group' : undefined}>
      {folder.folders.map((child) => (
        <div key={child.path}>
          <div
            className="row group cursor-pointer pr-1 text-[13px]"
            style={{ paddingLeft: 6 + depth * 14 }}
            onClick={() => toggle(child.path)}
          >
            <ChevronIcon
              size={12}
              className={`chevron row-icon ${collapsed.has(child.path) ? '' : 'rotate-90'}`}
            />
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
      {folder.notes.map((note) => (
        <div
          key={note.path}
          className="row group cursor-pointer pr-1 text-[13px]"
          data-active={note.path === activePath}
          style={{ paddingLeft: 26 + depth * 14 }}
          title={note.path}
          onClick={(event) => onOpen(note.path, event.ctrlKey || event.metaKey)}
          onAuxClick={(event) => event.button === 1 && onOpen(note.path, true)}
        >
          <PageIcon size={14} className="row-icon" />
          <span className="flex-1 truncate">{note.name}</span>
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
      ))}
    </div>
  );

  return (
    <aside className="sidebar pane flex w-64 shrink-0 flex-col border-r border-(--hairline)">
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-4" title={vault}>
        <Mark size={22} className="shrink-0" />
        <span className="rail-hide truncate font-display text-[17px] font-semibold tracking-tight text-frost-100">
          {vault.split(/[\\/]/).pop()}
        </span>
      </div>
      <nav className="flex flex-col gap-px px-2 pb-3">
        <button className="row w-full px-2 text-[13px]" title={t('sidebar.search')} onClick={onSearch}>
          <SearchIcon className="row-icon" />
          <span className="rail-hide flex-1 text-left">{t('sidebar.search')}</span>
          <Kbd>Ctrl P</Kbd>
        </button>
        <button className="row w-full px-2 text-[13px]" title={t('sidebar.newPage')} onClick={() => onNew('')}>
          <NewPageIcon className="row-icon" />
          <span className="rail-hide flex-1 text-left">{t('sidebar.newPage')}</span>
          <Kbd>Ctrl N</Kbd>
        </button>
        <button className="row w-full px-2 text-[13px]" title={t('nav.daily')} onClick={onDaily}>
          <CalendarIcon className="row-icon" />
          <span className="rail-hide flex-1 text-left">{t('nav.daily')}</span>
          <Kbd>Ctrl D</Kbd>
        </button>
        <button className="row w-full px-2 text-[13px]" title={t('nav.tasks')} onClick={onTasks}>
          <TasksIcon className="row-icon" />
          <span className="rail-hide flex-1 text-left">{t('nav.tasks')}</span>
          <Kbd>Ctrl Shift J</Kbd>
        </button>
        <button className="row w-full px-2 text-[13px]" title={t('nav.graph')} onClick={onGraph}>
          <GraphIcon className="row-icon" />
          <span className="rail-hide flex-1 text-left">{t('nav.graph')}</span>
          <Kbd>Ctrl G</Kbd>
        </button>
        <button className="row w-full px-2 text-[13px]" title={t('nav.requests')} onClick={onRequests}>
          <RequestIcon className="row-icon" />
          <span className="rail-hide flex-1 text-left">{t('nav.requests')}</span>
          <Kbd>Ctrl Shift E</Kbd>
        </button>
        <button className="row w-full px-2 text-[13px]" title={t('nav.code')} onClick={onCode}>
          <CodeIcon className="row-icon" />
          <span className="rail-hide flex-1 text-left">{t('nav.code')}</span>
          <Kbd>Ctrl Shift K</Kbd>
        </button>
      </nav>
      {favoriteNotes.length > 0 && (
        <>
          <div className="rail-hide section-label flex items-center justify-between border-t border-(--hairline) px-4 pb-2 pt-3.5">
            <span>{t('favorites.title')}</span>
            <span className="tabular-nums">{favoriteNotes.length}</span>
          </div>
          <div className="rail-tree max-h-[30%] shrink-0 overflow-y-auto px-2">
            <div className="pb-3">
              {favoriteNotes.map((note) => (
                <div
                  key={note.path}
                  className="row group cursor-pointer pl-2 pr-1 text-[13px]"
                  data-active={note.path === activePath}
                  title={note.path}
                  onClick={(event) => onOpen(note.path, event.ctrlKey || event.metaKey)}
                  onAuxClick={(event) => event.button === 1 && onOpen(note.path, true)}
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
      <div className="rail-hide section-label flex items-center justify-between border-t border-(--hairline) px-4 pb-2 pt-3.5">
        <span>{t('sidebar.pages')}</span>
        {notes.length > 0 && <span className="tabular-nums">{notes.length}</span>}
      </div>
      <div className="rail-tree flex-1 overflow-y-auto px-2 pb-4">
        {notes.length ? (
          renderFolder(tree, 0)
        ) : (
          <div className="mx-2 mt-2 rounded-lg border border-dashed border-(--hairline-strong) px-3 py-4 text-[13px] leading-relaxed">
            <p className="font-medium text-frost-100">{t('sidebar.emptyTitle')}</p>
            <p className="mt-1 text-frost-500">
              <Trans k="sidebar.emptyHint" values={{ key: <Kbd>Ctrl N</Kbd> }} />
            </p>
          </div>
        )}
      </div>
      <div className="border-t border-(--hairline) p-2">
        <button className="row w-full px-2 text-[13px]" title={t('sidebar.settings')} onClick={onSettings}>
          <SettingsIcon className="row-icon" />
          <span className="rail-hide flex-1 text-left">{t('sidebar.settings')}</span>
          <Kbd>Ctrl ,</Kbd>
        </button>
      </div>
    </aside>
  );
}
