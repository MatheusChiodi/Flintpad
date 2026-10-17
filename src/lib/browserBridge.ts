import type { MenuAction } from '../types';

// A guia Navegador fica montada (escondida) enquanto existe; à vista, ela pode ficar com atalhos do menu nativo.
type Handler = (action: MenuAction) => boolean;

let handler: Handler | null = null;

export function setBrowserMenuHandler(next: Handler) {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

/** true quando a guia Navegador tratou a ação e o App não deve seguir com ela. */
export const handleBrowserMenu = (action: MenuAction) => handler?.(action) ?? false;
