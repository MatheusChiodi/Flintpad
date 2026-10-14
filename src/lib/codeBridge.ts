import type { MenuAction } from '../types';

// A aba Código é carregada sob demanda; enquanto aberta, ela pode ficar com atalhos do menu nativo.
type Handler = (action: MenuAction) => boolean;

let handler: Handler | null = null;

export function setCodeMenuHandler(next: Handler) {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

/** true quando a aba Código tratou a ação e o App não deve seguir com ela. */
export const handleCodeMenu = (action: MenuAction) => handler?.(action) ?? false;
