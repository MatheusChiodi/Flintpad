import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';

import { useT } from '../../lib/i18n';
import type { IconTheme } from '../../lib/iconTheme';
import { baseName, dirName, isInside, samePath } from '../../lib/paths';
import { languageForFile } from '../../lib/textmate';
import type { DirEntry } from '../../types';
import { FileIconView } from './FileIconView';
import { Vein } from './Vein';

export type ExplorerActions = {
  open(path: string, pinned: boolean): void;
  newFile(dir: string): void;
  newFolder(dir: string): void;
  rename(entry: DirEntry): void;
  remove(entry: DirEntry): void;
  /** Só com mais de uma pasta no workspace. */
  removeRoot?(root: string): void;
};

// Pastas abertas e conteúdo já lido sobrevivem à troca de aba (o componente é desmontado); um registro por raiz.
type Memory = { expanded: Set<string>; children: Map<string, DirEntry[]> };
const memories = new Map<string, Memory>();
const memoryFor = (root: string) => {
  let memory = memories.get(root);
  if (!memory) {
    memory = { expanded: new Set([root]), children: new Map() };
    memories.set(root, memory);
  }
  return memory;
};

const INDENT_BASE = 8;
const INDENT_STEP = 12;

function Chevron({ open }: { open: boolean }) {
  return (
    <span className="wb-chevron" data-open={open} aria-hidden>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="m3.5 2 3 3-3 3" />
      </svg>
    </span>
  );
}

type Menu = { x: number; y: number; entry: DirEntry | null };

// Uma seção do explorador por pasta do workspace. Com uma pasta só, ela ocupa a barra toda (fill).
export function Explorer({ root, iconTheme, activePath, actions, collapseSignal, fill }: { root: string; iconTheme: IconTheme | null; activePath: string | null; actions: ExplorerActions; collapseSignal: number; fill: boolean }) {
  const t = useT();
  const memory = memoryFor(root);
  const [, setVersion] = useState(0);
  const rerender = () => setVersion((v) => v + 1);
  const [focused, setFocused] = useState<string | null>(activePath);
  const [menu, setMenu] = useState<Menu | null>(null);
  const tree = useRef<HTMLDivElement>(null);

  const load = useCallback(async (dir: string) => {
    try {
      memory.children.set(dir, await window.api.ws.readDir(dir));
    } catch {
      memory.children.set(dir, []);
    }
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
    for (const folder of toOpen) {
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
  const rows: { entry: DirEntry; depth: number }[] = [];
  const walk = (dir: string, depth: number) => {
    for (const entry of memory.children.get(dir) ?? []) {
      rows.push({ entry, depth });
      if (entry.dir && memory.expanded.has(entry.path)) walk(entry.path, depth + 1);
    }
  };
  if (memory.expanded.has(root)) walk(root, 0);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const index = rows.findIndex((row) => focused && samePath(row.entry.path, focused));
    const current = rows[index]?.entry;
    const go = (next: number) => {
      const row = rows[Math.max(0, Math.min(rows.length - 1, next))];
      if (row) setFocused(row.entry.path);
    };
    if (event.key === 'ArrowDown') go(index + 1);
    else if (event.key === 'ArrowUp') go(index - 1);
    else if (event.key === 'ArrowRight' && current?.dir) {
      if (!memory.expanded.has(current.path)) toggle(current.path);
      else go(index + 1);
    } else if (event.key === 'ArrowLeft' && current) {
      if (current.dir && memory.expanded.has(current.path)) toggle(current.path);
      else if (!samePath(dirName(current.path), root)) setFocused(dirName(current.path));
    } else if (event.key === 'Enter' && current) {
      if (current.dir) toggle(current.path);
      else actions.open(current.path, true);
    } else if (event.key === 'F2' && current) actions.rename(current);
    else if (event.key === 'Delete' && current) actions.remove(current);
    else return;
    event.preventDefault();
  };

  const openMenu = (event: ReactMouseEvent, entry: DirEntry | null) => {
    event.preventDefault();
    event.stopPropagation();
    if (entry) setFocused(entry.path);
    setMenu({ x: event.clientX, y: event.clientY, entry });
  };

  const targetDir = (entry: DirEntry | null) => (!entry ? root : entry.dir ? entry.path : dirName(entry.path));
  const iconButton = 'wb-icon-btn !h-[22px] !w-[22px]';
  const focusedEntry = rows.find((row) => focused && samePath(row.entry.path, focused))?.entry ?? null;

  return (
    <div className={`flex flex-col ${fill ? 'min-h-0 flex-1' : 'shrink-0'}`} onClick={() => setMenu(null)}>
      <div className="wb-root-head group">
        <button className="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={() => toggle(root)}>
          <Chevron open={memory.expanded.has(root)} />
          <span className="truncate" title={root}>
            {baseName(root)}
          </span>
        </button>
        <span className="flex opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
          <button className={iconButton} title={t('code.explorer.newFile')} onClick={() => actions.newFile(targetDir(focusedEntry))}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M9.5 1.1 13 4.6V9h-1V6H9V2H4v12h5v1H3V1h6.5ZM10 2.4V5h2.6L10 2.4ZM13 11h2v1h-2v2h-1v-2h-2v-1h2V9h1v2Z" /></svg>
          </button>
          <button className={iconButton} title={t('code.explorer.newFolder')} onClick={() => actions.newFolder(targetDir(focusedEntry))}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M14 4H8.4L7 2.6 6.6 2.5H1.5l-.5.5v10l.5.5H9v-1H2V3.5h4.4L7.8 5l.3.1H14V8h1V4.5l-1-.5ZM13 10h2v1h-2v2h-1v-2h-2v-1h2V8h1v2Z" /></svg>
          </button>
          <button className={iconButton} title={t('code.explorer.refresh')} onClick={() => [...memory.expanded].forEach((dir) => void load(dir))}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M13.45 5.17A6 6 0 1 0 14 8h-1a5 5 0 1 1-.82-2.75H10v1h4v-4h-1v1.92Z" /></svg>
          </button>
          <button className={iconButton} title={t('code.explorer.collapse')} onClick={() => { memory.expanded = new Set([root]); rerender(); }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M9 9H4V8h5v1Z" /><path d="m5 3 1-1h7l1 1v7l-1 1h-2v2l-1 1H3l-1-1V6l1-1h2V3Zm1 2h4l1 1v4h2V3H6v2Zm4 1H3v7h7V6Z" /></svg>
          </button>
        </span>
      </div>

      <div
        ref={tree}
        tabIndex={0}
        className={`wb-tree outline-none ${fill ? 'min-h-0 flex-1 overflow-y-auto pb-6 pt-1' : 'pb-1 pt-1'}`}
        onKeyDown={onKeyDown}
        onContextMenu={(event) => openMenu(event, null)}
      >
        {rows.map(({ entry, depth }) => {
          const expanded = entry.dir && memory.expanded.has(entry.path);
          const isActive = !entry.dir && activePath !== null && samePath(entry.path, activePath);
          const isFocused = focused !== null && samePath(entry.path, focused);
          const icon = iconTheme ? (entry.dir ? iconTheme.forFolder(entry.path, Boolean(expanded)) : iconTheme.forFile(entry.path, languageForFile(entry.path))) : null;
          return (
            <div
              key={entry.path}
              data-active={isActive}
              data-selected={isFocused && !isActive}
              className="wb-row"
              style={{ paddingLeft: INDENT_BASE + depth * INDENT_STEP }}
              title={entry.path}
              onClick={() => {
                setFocused(entry.path);
                if (entry.dir) toggle(entry.path);
                else actions.open(entry.path, false);
              }}
              onDoubleClick={() => !entry.dir && actions.open(entry.path, true)}
              onContextMenu={(event) => openMenu(event, entry)}
            >
              {Array.from({ length: depth }, (_, level) => (
                <span key={level} aria-hidden className="wb-guide" style={{ left: INDENT_BASE + level * INDENT_STEP + 5 }} />
              ))}
              {!iconTheme?.hidesExplorerArrows && (entry.dir ? <Chevron open={Boolean(expanded)} /> : <span className="w-3 shrink-0" />)}
              <FileIconView icon={icon} dir={entry.dir} expanded={Boolean(expanded)} />
              <span className="truncate">{entry.name}</span>
            </div>
          );
        })}
        {memory.expanded.has(root) && memory.children.get(root)?.length === 0 && <p className="px-5 py-2 opacity-70">{t('code.explorer.empty')}</p>}
        <Vein axis="y" inset={5} />
      </div>

      {menu && (
        <div
          className="wb-quick fixed z-50 !m-0 !w-auto min-w-52 p-1 text-[13px]"
          style={{ left: menu.x, top: menu.y, background: 'var(--vsc-editorWidget-background)', color: 'var(--vsc-foreground)' }}
          onClick={(event) => event.stopPropagation()}
        >
          {(
            [
              [t('code.explorer.newFile'), () => actions.newFile(targetDir(menu.entry))],
              [t('code.explorer.newFolder'), () => actions.newFolder(targetDir(menu.entry))],
              ...(menu.entry
                ? ([
                    [t('code.explorer.reveal'), () => void window.api.ws.reveal(menu.entry!.path)],
                    [t('code.explorer.copyPath'), () => void navigator.clipboard.writeText(menu.entry!.path)],
                    [t('code.explorer.rename'), () => actions.rename(menu.entry!)],
                    [t('code.explorer.delete'), () => actions.remove(menu.entry!)],
                  ] as [string, () => void][])
                : ([
                    [t('code.explorer.reveal'), () => void window.api.ws.reveal(root)],
                    ...(actions.removeRoot ? [[t('code.explorer.removeRoot'), () => actions.removeRoot!(root)]] : []),
                  ] as [string, () => void][])),
            ] as [string, () => void][]
          ).map(([label, run]) => (
            <button
              key={label}
              className="block w-full rounded-md px-3 py-1.5 text-left transition-colors duration-100 hover:bg-[var(--vsc-quickInputList-focusBackground)] hover:text-[var(--vsc-quickInputList-focusForeground)]"
              onClick={() => {
                setMenu(null);
                run();
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
