import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Kbd } from './Icons';

// Menu de contexto da moldura (árvore de páginas, guias). Abre no ponto do clique ou no elemento
// focado (tecla de menu / Shift+F10), anda com as setas, fecha com Esc ou clicando fora, e devolve o foco.

export type MenuItem =
  | { kind?: 'item'; label: string; keys?: string; danger?: boolean; disabled?: boolean; run: () => void }
  | { kind: 'separator' };

export type MenuRequest = { x: number; y: number; items: MenuItem[]; label: string };

const EDGE = 8;

/** Posição do menu para o evento: no clique, onde o mouse está; pelo teclado, sob o elemento. */
export function menuPosition(event: { clientX?: number; clientY?: number; currentTarget: EventTarget }): { x: number; y: number } {
  if (event.clientX || event.clientY) return { x: event.clientX ?? 0, y: event.clientY ?? 0 };
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  return { x: rect.left + 16, y: rect.bottom };
}

/** Teclas que abrem o menu de contexto pelo teclado. */
export const isMenuKey = (event: { key: string; shiftKey: boolean }) => event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');

export function ContextMenu({ request, onClose }: { request: MenuRequest; onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: request.x, top: request.y });
  const returnFocus = useRef(document.activeElement as HTMLElement | null);

  // Cabe na janela: se passar da borda, abre para o outro lado.
  useLayoutEffect(() => {
    const box = menu.current?.getBoundingClientRect();
    if (!box) return;
    setPosition({
      left: Math.max(EDGE, Math.min(request.x, window.innerWidth - box.width - EDGE)),
      top: request.y + box.height > window.innerHeight - EDGE ? Math.max(EDGE, request.y - box.height) : request.y,
    });
  }, [request]);

  useEffect(() => {
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    const close = (event: Event) => {
      if (menu.current?.contains(event.target as Node)) return;
      onClose();
    };
    window.addEventListener('mousedown', close, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('mousedown', close, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  // O foco volta antes de quem abriu algo pelo menu (campo de renomear) montar e pegar o foco.
  useLayoutEffect(() => () => returnFocus.current?.focus?.(), []);

  const move = (delta: number) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    items[(index + delta + items.length) % items.length].focus();
  };

  return (
    <div
      ref={menu}
      className="context-menu"
      role="menu"
      aria-label={request.label}
      style={{ left: position.left, top: position.top }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') move(1);
        else if (event.key === 'ArrowUp') move(-1);
        else if (event.key === 'Home') move(-1000);
        else if (event.key === 'Escape' || event.key === 'Tab') onClose();
        else return;
        event.preventDefault();
      }}
    >
      {request.items.map((item, index) =>
        item.kind === 'separator' ? (
          <div key={index} className="context-menu-separator" role="separator" />
        ) : (
          <button
            key={index}
            role="menuitem"
            className="context-menu-item"
            data-danger={item.danger}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.run();
            }}
          >
            <span className="flex-1 truncate">{item.label}</span>
            {item.keys && <Kbd>{item.keys}</Kbd>}
          </button>
        ),
      )}
    </div>
  );
}
