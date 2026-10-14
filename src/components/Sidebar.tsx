import { useMemo, useState } from 'react';

import type { Note } from '../types';
import { ChevronIcon, FolderIcon, GraphIcon, Kbd, RequestIcon, CodeIcon, Mark, NewPageIcon, PageIcon, PlusIcon, SearchIcon, TrashIcon } from './Icons';

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
  onOpen: (path: string, newTab: boolean) => void;
  onNew: (folder: string) => void;
  onDelete: (path: string) => void;
  onGraph: () => void;
  onRequests: () => void;
  onCode: () => void;
  onSearch: () => void;
};

export function Sidebar({ vault, notes, activePath, onOpen, onNew, onDelete, onGraph, onRequests, onCode, onSearch }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const tree = useMemo(() => buildTree(notes), [notes]);

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(path)) next.add(path);
      return next;
    });

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
              title="Nova página nesta pasta"
              aria-label={`Nova página em ${child.name}`}
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
          <button
            className="icon-button reveal"
            data-danger="true"
            title="Mover para a lixeira"
            aria-label={`Mover ${note.name} para a lixeira`}
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
    <aside className="pane flex w-64 shrink-0 flex-col border-r border-(--hairline)">
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-4" title={vault}>
        <Mark size={22} className="shrink-0" />
        <span className="truncate font-display text-[17px] font-semibold tracking-tight text-frost-100">
          {vault.split(/[\\/]/).pop()}
        </span>
      </div>
      <nav className="flex flex-col gap-px px-2 pb-3">
        <button className="row w-full px-2 text-[13px]" onClick={onSearch}>
          <SearchIcon className="row-icon" />
          <span className="flex-1 text-left">Buscar</span>
          <Kbd>Ctrl P</Kbd>
        </button>
        <button className="row w-full px-2 text-[13px]" onClick={() => onNew('')}>
          <NewPageIcon className="row-icon" />
          <span className="flex-1 text-left">Nova página</span>
          <Kbd>Ctrl N</Kbd>
        </button>
        <button className="row w-full px-2 text-[13px]" onClick={onGraph}>
          <GraphIcon className="row-icon" />
          <span className="flex-1 text-left">Grafo</span>
          <Kbd>Ctrl G</Kbd>
        </button>
        <button className="row w-full px-2 text-[13px]" onClick={onRequests}>
          <RequestIcon className="row-icon" />
          <span className="flex-1 text-left">Requests</span>
          <Kbd>Ctrl Shift E</Kbd>
        </button>
        <button className="row w-full px-2 text-[13px]" onClick={onCode}>
          <CodeIcon className="row-icon" />
          <span className="flex-1 text-left">Código</span>
          <Kbd>Ctrl Shift K</Kbd>
        </button>
      </nav>
      <div className="section-label flex items-center justify-between border-t border-(--hairline) px-4 pb-2 pt-3.5">
        <span>Páginas</span>
        {notes.length > 0 && <span className="tabular-nums">{notes.length}</span>}
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {notes.length ? (
          renderFolder(tree, 0)
        ) : (
          <div className="mx-2 mt-2 rounded-lg border border-dashed border-(--hairline-strong) px-3 py-4 text-[13px] leading-relaxed">
            <p className="font-medium text-frost-100">Vault vazio</p>
            <p className="mt-1 text-frost-500">
              <Kbd>Ctrl N</Kbd> cria a primeira página.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
