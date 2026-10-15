// Menu de contexto do quadro (botão direito, Shift+F10 ou tecla de menu). Navegável pelo teclado:
// setas, Home/End, Enter/Espaço para escolher, Esc ou Tab para fechar.
import { useLayoutEffect, useRef, useState } from 'react';

export type MenuEntry = { id: string; label: string; shortcut?: string; onSelect: () => void; danger?: boolean } | 'separator';

type Props = {
  x: number;
  y: number;
  /** Área disponível (o quadro): o menu não sai dela. */
  bounds: { w: number; h: number };
  label: string;
  entries: MenuEntry[];
  onClose: (refocus: boolean) => void;
};

export function ContextMenu({ x, y, bounds, label, entries, onClose }: Props) {
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    setPosition({ left: Math.max(4, Math.min(x, bounds.w - width - 4)), top: Math.max(4, Math.min(y, bounds.h - height - 4)) });
    element.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus({ preventScroll: true });
  }, [x, y, bounds.w, bounds.h]);

  const move = (step: number | 'first' | 'last') => {
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]') ?? [])];
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = step === 'first' ? 0 : step === 'last' ? items.length - 1 : (index + step + items.length) % items.length;
    items[next].focus({ preventScroll: true });
  };

  return (
    <div
      ref={menu}
      data-ui="menu"
      role="menu"
      aria-label={label}
      className="absolute z-20 min-w-[220px] rounded-lg bg-obsidian-700 py-1 text-[12.5px] text-frost-300 shadow-[0_0_0_1px_var(--hairline-strong),0_12px_30px_-10px_rgb(0_0_0_/_0.7)]"
      style={position}
      data-testid="wb-menu"
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'ArrowDown') move(1);
        else if (event.key === 'ArrowUp') move(-1);
        else if (event.key === 'Home') move('first');
        else if (event.key === 'End') move('last');
        else if (event.key === 'Escape' || event.key === 'Tab') onClose(true);
        else return;
        event.preventDefault();
      }}
    >
      {entries.map((entry, index) =>
        entry === 'separator' ? (
          <div key={`sep-${index}`} role="separator" className="my-1 h-px bg-[var(--hairline)]" />
        ) : (
          <button
            key={entry.id}
            role="menuitem"
            tabIndex={-1}
            className={`flex w-full items-center gap-4 px-3 py-1.5 text-left outline-none hover:bg-[var(--hover)] focus:bg-[var(--hover)] ${entry.danger ? 'hover:text-danger focus:text-danger' : 'hover:text-frost-100 focus:text-frost-100'}`}
            data-testid={`wb-menu-${entry.id}`}
            onClick={() => {
              onClose(true);
              entry.onSelect();
            }}
          >
            <span className="flex-1">{entry.label}</span>
            {entry.shortcut && <span className="font-mono text-[10.5px] text-frost-500">{entry.shortcut}</span>}
          </button>
        ),
      )}
    </div>
  );
}
