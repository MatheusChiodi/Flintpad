import { useId, useRef, useState, type ReactNode } from 'react';

// Lista de resultados agrupada por arquivo (busca, TODOs, problemas), como as árvores de resultado do VS Code:
// cabeçalho do arquivo recolhível e uma linha por ocorrência. Anda pelo teclado como uma árvore
// (setas, Home/End, ← recolhe, → expande, Enter abre).

export type ResultItem = { id: string; content: ReactNode; title?: string; onOpen(): void };
export type ResultGroup = { id: string; label: string; description?: string; icon?: ReactNode; count?: number; actions?: ReactNode; items: ResultItem[] };

export function ResultTree({ groups, label, collapsedByDefault = false }: { groups: ResultGroup[]; label: string; collapsedByDefault?: boolean }) {
  const uid = useId();
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState<string | null>(null);
  const tree = useRef<HTMLDivElement>(null);
  const isOpen = (id: string) => toggled.has(id) === collapsedByDefault;
  const toggle = (id: string) =>
    setToggled((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  type Row = { key: string; group: ResultGroup; item?: ResultItem };
  const rows: Row[] = [];
  for (const group of groups) {
    rows.push({ key: `g:${group.id}`, group });
    if (isOpen(group.id)) for (const item of group.items) rows.push({ key: `i:${group.id}:${item.id}`, group, item });
  }
  const index = Math.max(0, rows.findIndex((row) => row.key === focused));
  const domId = (key: string) => `${uid}-${rows.findIndex((row) => row.key === key)}`;

  const onKeyDown = (event: React.KeyboardEvent) => {
    const row = rows[index];
    if (!row) return;
    const go = (next: number) => {
      const target = rows[Math.max(0, Math.min(rows.length - 1, next))];
      if (!target) return;
      setFocused(target.key);
      requestAnimationFrame(() => tree.current?.querySelector(`[data-key="${CSS.escape(target.key)}"]`)?.scrollIntoView({ block: 'nearest' }));
    };
    if (event.key === 'ArrowDown') go(index + 1);
    else if (event.key === 'ArrowUp') go(index - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(rows.length - 1);
    else if (event.key === 'ArrowLeft') {
      if (row.item) go(rows.findIndex((r) => r.key === `g:${row.group.id}`));
      else if (isOpen(row.group.id)) toggle(row.group.id);
    } else if (event.key === 'ArrowRight' && !row.item) {
      if (!isOpen(row.group.id)) toggle(row.group.id);
      else go(index + 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      if (row.item) row.item.onOpen();
      else toggle(row.group.id);
    } else return;
    event.preventDefault();
  };

  return (
    <div
      ref={tree}
      role="tree"
      aria-label={label}
      tabIndex={0}
      aria-activedescendant={rows[index] ? domId(rows[index].key) : undefined}
      className="wb-results outline-none"
      onKeyDown={onKeyDown}
    >
      {rows.map((row, rowIndex) => {
        const selected = rowIndex === index && focused !== null;
        if (!row.item) {
          const open = isOpen(row.group.id);
          return (
            <div
              key={row.key}
              id={`${uid}-${rowIndex}`}
              data-key={row.key}
              role="treeitem"
              aria-level={1}
              aria-expanded={open}
              aria-selected={selected}
              data-selected={selected}
              className="wb-result-file group"
              title={row.group.description ? `${row.group.description}/${row.group.label}` : row.group.label}
              onClick={() => {
                setFocused(row.key);
                toggle(row.group.id);
              }}
            >
              <span className="wb-chevron" data-open={open} aria-hidden>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="m3.5 2 3 3-3 3" /></svg>
              </span>
              {row.group.icon}
              <span className="shrink-0 truncate">{row.group.label}</span>
              {row.group.description && <span className="wb-result-dir">{row.group.description}</span>}
              {!row.group.description && <span className="flex-1" />}
              {row.group.actions && (
                <span className="flex opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100" onClick={(event) => event.stopPropagation()}>
                  {row.group.actions}
                </span>
              )}
              {row.group.count !== undefined && <span className="wb-badge">{row.group.count}</span>}
            </div>
          );
        }
        const item = row.item;
        return (
          <div
            key={row.key}
            id={`${uid}-${rowIndex}`}
            data-key={row.key}
            role="treeitem"
            aria-level={2}
            aria-selected={selected}
            data-selected={selected}
            className="wb-result-line"
            title={item.title}
            onClick={() => {
              setFocused(row.key);
              item.onOpen();
            }}
          >
            {item.content}
          </div>
        );
      })}
    </div>
  );
}

/** Trecho da linha com o achado destacado (e, na substituição, o texto novo ao lado). */
export function MatchPreview({ text, start, length, replacement }: { text: string; start: number; length: number; replacement?: string | null }) {
  const before = text.slice(0, start);
  const match = text.slice(start, start + length);
  const after = text.slice(start + length);
  return (
    <span className="wb-match-preview">
      {before}
      {replacement !== undefined && replacement !== null ? (
        <>
          <del className="wb-match-old">{match}</del>
          <ins className="wb-match-new">{replacement}</ins>
        </>
      ) : (
        <mark className="wb-match">{match}</mark>
      )}
      {after}
    </span>
  );
}
