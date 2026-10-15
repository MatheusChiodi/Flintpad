import { useCallback, useEffect, useId, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';

import { useT } from '../../lib/i18n';
import type { IconTheme } from '../../lib/iconTheme';
import { baseName, dirName, isInside, samePath } from '../../lib/paths';
import { languageForFile } from '../../lib/textmate';
import type { DirEntry } from '../../types';
import { ContextMenu, isMenuKey, type MenuItem, type MenuRequest } from '../ContextMenu';
import { FileIconView } from './FileIconView';
import { Vein } from './Vein';

export type ExplorerActions = {
  open(path: string, pinned: boolean): void;
  newFile(dir: string): void;
  newFolder(dir: string): void;
  rename(entry: DirEntry): void;
  remove(entry: DirEntry): void;
  /** Copia o caminho relativo à pasta do workspace. */
  copyRelativePath?(path: string): void;
  /** Busca nos arquivos só dentro desta pasta. */
  findInFolder?(dir: string): void;
  /** Cria uma cópia ao lado ("arquivo copy.ts"). */
  duplicate?(entry: DirEntry): void;
  /** Move o item para outra pasta (arrastar e soltar). */
  move?(entry: DirEntry, targetDir: string): void;
  /** Só com mais de uma pasta no workspace. */
  removeRoot?(root: string): void;
};

// Pastas abertas e conteúdo já lido sobrevivem à troca de aba (o componente é desmontado); um registro por raiz.
type Memory = { expanded: Set<string>; children: Map<string, DirEntry[]>; loading: Set<string>; errors: Map<string, string> };
const memories = new Map<string, Memory>();
const memoryFor = (root: string) => {
  let memory = memories.get(root);
  if (!memory) {
    memory = { expanded: new Set([root]), children: new Map(), loading: new Set(), errors: new Map() };
    memories.set(root, memory);
  }
  return memory;
};

const INDENT_BASE = 8;
const INDENT_STEP = 12;
const DRAG_TYPE = 'application/x-obnotion-path';

function Chevron({ open }: { open: boolean }) {
  return (
    <span className="wb-chevron" data-open={open} aria-hidden>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="m3.5 2 3 3-3 3" />
      </svg>
    </span>
  );
}

// Uma seção do explorador por pasta do workspace. Com uma pasta só, ela ocupa a barra toda (fill).
export function Explorer({ root, iconTheme, activePath, actions, collapseSignal, fill }: { root: string; iconTheme: IconTheme | null; activePath: string | null; actions: ExplorerActions; collapseSignal: number; fill: boolean }) {
  const t = useT();
  const uid = useId();
  const memory = memoryFor(root);
  const [, setVersion] = useState(0);
  const rerender = () => setVersion((v) => v + 1);
  const [focused, setFocused] = useState<string | null>(activePath);
  const [menu, setMenu] = useState<MenuRequest | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const tree = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const load = useCallback(async (dir: string) => {
    memory.loading.add(dir);
    rerender();
    try {
      memory.children.set(dir, await window.api.ws.readDir(dir));
      memory.errors.delete(dir);
    } catch (error) {
      // Sem permissão ou pasta removida: mostra o motivo em vez de "pasta vazia".
      memory.children.set(dir, []);
      memory.errors.set(dir, error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(error));
    }
    memory.loading.delete(dir);
    rerender();
  }, [memory]);

  useEffect(() => {
    for (const dir of memory.expanded) if (!memory.children.has(dir)) void load(dir);
  }, [root, load]);

  // O vigia do processo principal avisa o que mudou; só pastas abertas são relidas.
  useEffect(
    () =>
      window.api.ws.onChanged((paths) => {
        const dirs = new Set<string>();
        for (const changed of paths) {
          for (const dir of memory.expanded) if (samePath(dir, changed) || samePath(dir, dirName(changed))) dirs.add(dir);
        }
        dirs.forEach((dir) => void load(dir));
      }),
    [load],
  );

  useEffect(() => {
    if (!collapseSignal) return;
    memory.expanded = new Set([root]);
    rerender();
  }, [collapseSignal, root]);

  // Revela o arquivo ativo: abre as pastas acima dele.
  useEffect(() => {
    if (!activePath || !isInside(activePath, root)) return;
    setFocused(activePath);
    let dir = dirName(activePath);
    const toOpen: string[] = [];
    while (dir && isInside(dir, root) && !samePath(dir, root)) {
      toOpen.push(dir);
      dir = dirName(dir);
    }
    let changed = false;
    for (const folder of [...toOpen, root]) {
      if (!memory.expanded.has(folder)) {
        memory.expanded.add(folder);
        changed = true;
        if (!memory.children.has(folder)) void load(folder);
      }
    }
    if (changed) rerender();
    requestAnimationFrame(() => tree.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }));
  }, [activePath, root, load]);

  const toggle = (dir: string) => {
    if (memory.expanded.has(dir)) memory.expanded.delete(dir);
    else {
      memory.expanded.add(dir);
      if (!memory.children.has(dir)) void load(dir);
    }
    rerender();
  };

  // Linhas visíveis, na ordem da tela: base da navegação por teclado.
  type Row = { kind: 'entry'; entry: DirEntry; depth: number } | { kind: 'status'; dir: string; depth: number; text: string; error: boolean };
  const rows: Row[] = [];
  const walk = (dir: string, depth: number) => {
    const children = memory.children.get(dir);
    const error = memory.errors.get(dir);
    if (!children && memory.loading.has(dir)) rows.push({ kind: 'status', dir, depth, text: t('code.explorer.loading'), error: false });
    if (error) rows.push({ kind: 'status', dir, depth, text: t('code.explorer.readError', { reason: error }), error: true });
    for (const entry of children ?? []) {
      rows.push({ kind: 'entry', entry, depth });
      if (entry.dir && memory.expanded.has(entry.path)) walk(entry.path, depth + 1);
    }
  };
  if (memory.expanded.has(root)) walk(root, 0);
  const entries = rows.filter((row): row is Extract<Row, { kind: 'entry' }> => row.kind === 'entry');

  const rowId = (index: number) => `${uid}-row-${index}`;
  const focusedIndex = entries.findIndex((row) => focused && samePath(row.entry.path, focused));

  const targetDir = (entry: DirEntry | null) => (!entry ? root : entry.dir ? entry.path : dirName(entry.path));

  const menuItems = (entry: DirEntry | null): MenuItem[] => {
    const items: MenuItem[] = [
      { label: t('code.explorer.newFile'), run: () => actions.newFile(targetDir(entry)) },
      { label: t('code.explorer.newFolder'), run: () => actions.newFolder(targetDir(entry)) },
    ];
    if (actions.findInFolder && (!entry || entry.dir)) items.push({ label: t('code.explorer.findInFolder'), keys: entry ? undefined : 'Ctrl+Shift+F', run: () => actions.findInFolder!(targetDir(entry)) });
    items.push({ kind: 'separator' });
    const path = entry?.path ?? root;
    items.push({ label: t('code.explorer.reveal'), run: () => void window.api.ws.reveal(path) });
    items.push({ label: t('code.explorer.copyPath'), run: () => void navigator.clipboard.writeText(path) });
    if (entry && actions.copyRelativePath) items.push({ label: t('code.explorer.copyRelativePath'), run: () => actions.copyRelativePath!(path) });
    if (entry) {
      items.push({ kind: 'separator' });
      if (!entry.dir && actions.duplicate) items.push({ label: t('code.explorer.duplicate'), run: () => actions.duplicate!(entry) });
      items.push({ label: t('code.explorer.rename'), keys: 'F2', run: () => actions.rename(entry) });
      items.push({ label: t('code.explorer.delete'), keys: 'Delete', danger: true, run: () => actions.remove(entry) });
    } else if (actions.removeRoot) {
      items.push({ kind: 'separator' });
      items.push({ label: t('code.explorer.removeRoot'), run: () => actions.removeRoot!(root) });
    }
    return items;
  };

  const openMenuAt = (x: number, y: number, entry: DirEntry | null) => setMenu({ x, y, items: menuItems(entry), label: entry?.name ?? baseName(root) });

  const onKeyDown = (event: React.KeyboardEvent) => {
    const index = focusedIndex;
    const current = entries[index]?.entry;
    const go = (next: number) => {
      const row = entries[Math.max(0, Math.min(entries.length - 1, next))];
      if (!row) return;
      setFocused(row.entry.path);
      requestAnimationFrame(() => tree.current?.querySelector(`[data-path="${CSS.escape(row.entry.path)}"]`)?.scrollIntoView({ block: 'nearest' }));
    };
    if (isMenuKey(event)) {
      const element = current ? tree.current?.querySelector(`[data-path="${CSS.escape(current.path)}"]`) : null;
      const rect = (element ?? tree.current)?.getBoundingClientRect();
      if (rect) openMenuAt(rect.left + 24, element ? rect.bottom : rect.top + 8, current ?? null);
    } else if (event.key === 'ArrowDown') go(index + 1);
    else if (event.key === 'ArrowUp') go(index < 0 ? 0 : index - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(entries.length - 1);
    else if (event.key === 'ArrowRight' && current?.dir) {
      if (!memory.expanded.has(current.path)) toggle(current.path);
      else go(index + 1);
    } else if (event.key === 'ArrowLeft' && current) {
      if (current.dir && memory.expanded.has(current.path)) toggle(current.path);
      else if (!samePath(dirName(current.path), root)) setFocused(dirName(current.path));
    } else if ((event.key === 'Enter' || event.key === ' ') && current) {
      if (current.dir) toggle(current.path);
      else actions.open(current.path, event.key === 'Enter');
    } else if (event.key === 'F2' && current) actions.rename(current);
    else if (event.key === 'Delete' && current) actions.remove(current);
    else return;
    event.preventDefault();
  };

  const openMenu = (event: ReactMouseEvent, entry: DirEntry | null) => {
    event.preventDefault();
    event.stopPropagation();
    if (entry) setFocused(entry.path);
    openMenuAt(event.clientX, event.clientY, entry);
  };

  // Arrastar e soltar: o item vai para a pasta sob o mouse (ou para a pasta do arquivo sob o mouse).
  const dragProps = (entry: DirEntry | null) =>
    actions.move
      ? {
          onDragOver: (event: React.DragEvent) => {
            if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = 'move';
            setDropTarget(targetDir(entry));
          },
          onDragLeave: (event: React.DragEvent) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTarget(null);
          },
          onDrop: (event: React.DragEvent) => {
            const from = event.dataTransfer.getData(DRAG_TYPE);
            setDropTarget(null);
            if (!from) return;
            event.preventDefault();
            event.stopPropagation();
            const dir = targetDir(entry);
            // Não move para a própria pasta nem para dentro de si mesmo.
            if (samePath(dirName(from), dir) || isInside(dir, from)) return;
            const source = entries.find((row) => samePath(row.entry.path, from))?.entry ?? { name: baseName(from), path: from, dir: false };
            actions.move!(source, dir);
          },
        }
      : {};

  const iconButton = 'wb-icon-btn !h-[22px] !w-[22px]';
  const focusedEntry = entries[focusedIndex]?.entry ?? null;
  const rootOpen = memory.expanded.has(root);
  let entryIndex = -1;

  return (
    <div className={`flex flex-col ${fill ? 'min-h-0 flex-1' : 'shrink-0'}`}>
      <div className="wb-root-head group">
        <button className="flex min-w-0 flex-1 items-center gap-1.5 text-left" aria-expanded={rootOpen} onClick={() => toggle(root)} onContextMenu={(event) => openMenu(event, null)}>
          <Chevron open={rootOpen} />
          <span className="truncate" title={root}>
            {baseName(root)}
          </span>
        </button>
        <span className="flex opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
          <button className={iconButton} title={t('code.explorer.newFile')} aria-label={t('code.explorer.newFile')} onClick={() => actions.newFile(targetDir(focusedEntry))}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M9.5 1.1 13 4.6V9h-1V6H9V2H4v12h5v1H3V1h6.5ZM10 2.4V5h2.6L10 2.4ZM13 11h2v1h-2v2h-1v-2h-2v-1h2V9h1v2Z" /></svg>
          </button>
          <button className={iconButton} title={t('code.explorer.newFolder')} aria-label={t('code.explorer.newFolder')} onClick={() => actions.newFolder(targetDir(focusedEntry))}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M14 4H8.4L7 2.6 6.6 2.5H1.5l-.5.5v10l.5.5H9v-1H2V3.5h4.4L7.8 5l.3.1H14V8h1V4.5l-1-.5ZM13 10h2v1h-2v2h-1v-2h-2v-1h2V8h1v2Z" /></svg>
          </button>
          <button className={iconButton} title={t('code.explorer.refresh')} aria-label={t('code.explorer.refresh')} onClick={() => [...memory.expanded].forEach((dir) => void load(dir))}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M13.45 5.17A6 6 0 1 0 14 8h-1a5 5 0 1 1-.82-2.75H10v1h4v-4h-1v1.92Z" /></svg>
          </button>
          <button className={iconButton} title={t('code.explorer.collapse')} aria-label={t('code.explorer.collapse')} onClick={() => { memory.expanded = new Set([root]); rerender(); }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M9 9H4V8h5v1Z" /><path d="m5 3 1-1h7l1 1v7l-1 1h-2v2l-1 1H3l-1-1V6l1-1h2V3Zm1 2h4l1 1v4h2V3H6v2Zm4 1H3v7h7V6Z" /></svg>
          </button>
        </span>
      </div>

      <div
        ref={tree}
        tabIndex={0}
        role="tree"
        aria-label={baseName(root)}
        aria-activedescendant={focusedIndex >= 0 ? rowId(focusedIndex) : undefined}
        className={`wb-tree outline-none ${fill ? 'min-h-0 flex-1 overflow-y-auto pb-6 pt-1' : 'pb-1 pt-1'}`}
        data-drop={dropTarget !== null && samePath(dropTarget, root)}
        onKeyDown={onKeyDown}
        onContextMenu={(event) => openMenu(event, null)}
        {...dragProps(null)}
      >
        {rows.map((row) => {
          if (row.kind === 'status') {
            return (
              <p key={`status:${row.dir}`} className="wb-tree-status" data-error={row.error} role={row.error ? 'alert' : 'status'} style={{ paddingLeft: INDENT_BASE + row.depth * INDENT_STEP + 18 }}>
                {row.text}
              </p>
            );
          }
          const { entry, depth } = row;
          entryIndex++;
          const expanded = entry.dir && memory.expanded.has(entry.path);
          const isActive = !entry.dir && activePath !== null && samePath(entry.path, activePath);
          const isFocused = focused !== null && samePath(entry.path, focused);
          const icon = iconTheme ? (entry.dir ? iconTheme.forFolder(entry.path, Boolean(expanded)) : iconTheme.forFile(entry.path, languageForFile(entry.path))) : null;
          return (
            <div
              key={entry.path}
              id={rowId(entryIndex)}
              role="treeitem"
              aria-level={depth + 1}
              aria-expanded={entry.dir ? Boolean(expanded) : undefined}
              aria-selected={isFocused}
              data-path={entry.path}
              data-active={isActive}
              data-selected={isFocused && !isActive}
              data-drop={entry.dir && dropTarget !== null && samePath(dropTarget, entry.path)}
              className="wb-row"
              style={{ paddingLeft: INDENT_BASE + depth * INDENT_STEP }}
              title={entry.path}
              draggable={Boolean(actions.move)}
              onDragStart={(event) => {
                event.dataTransfer.setData(DRAG_TYPE, entry.path);
                event.dataTransfer.setData('text/plain', entry.path);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onClick={() => {
                setFocused(entry.path);
                if (entry.dir) toggle(entry.path);
                else actions.open(entry.path, false);
              }}
              onDoubleClick={() => !entry.dir && actions.open(entry.path, true)}
              onContextMenu={(event) => openMenu(event, entry)}
              {...dragProps(entry)}
            >
              {Array.from({ length: depth }, (_, level) => (
                <span key={level} aria-hidden className="wb-guide" style={{ left: INDENT_BASE + level * INDENT_STEP + 5 }} />
              ))}
              {!iconTheme?.hidesExplorerArrows && (entry.dir ? <Chevron open={Boolean(expanded)} /> : <span className="w-3 shrink-0" />)}
              <FileIconView icon={icon} dir={entry.dir} expanded={Boolean(expanded)} />
              <span className="wb-row-name truncate">{entry.name}</span>
            </div>
          );
        })}
        {rootOpen && memory.children.get(root)?.length === 0 && !memory.errors.has(root) && <p className="wb-tree-status">{t('code.explorer.empty')}</p>}
        <Vein axis="y" inset={5} />
      </div>

      {menu && <ContextMenu request={menu} onClose={closeMenu} />}
    </div>
  );
}
