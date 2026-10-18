// Guias: operações puras sobre a lista (fixar, fechar outras, reordenar) e a sessão salva por vault.
// Toda função devolve a mesma lista quando nada muda.

import type { Tab } from '../types';

export const tabPath = (tab: Tab) => tab.stack[tab.idx] ?? '';

// Guias fixadas ficam sempre à esquerda, na ordem em que foram fixadas.
const pinnedFirst = (tabs: Tab[]) => [...tabs.filter((tab) => tab.pinned), ...tabs.filter((tab) => !tab.pinned)];

export function togglePin(tabs: Tab[], id: number): Tab[] {
  if (!tabs.some((tab) => tab.id === id)) return tabs;
  return pinnedFirst(tabs.map((tab) => (tab.id === id ? { ...tab, pinned: !tab.pinned } : tab)));
}

/** Fecha as outras guias, menos as fixadas. */
export function closeOthers(tabs: Tab[], id: number): Tab[] {
  const rest = tabs.filter((tab) => tab.id === id || tab.pinned);
  return rest.length === tabs.length ? tabs : rest;
}

/** Fecha as guias à direita, menos as fixadas. */
export function closeToRight(tabs: Tab[], id: number): Tab[] {
  const index = tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return tabs;
  const rest = tabs.filter((tab, i) => i <= index || tab.pinned);
  return rest.length === tabs.length ? tabs : rest;
}

/** Leva a guia para a posição `to`, sem atravessar a fronteira entre fixadas e soltas. */
export function moveTab(tabs: Tab[], id: number, to: number): Tab[] {
  const from = tabs.findIndex((tab) => tab.id === id);
  if (from < 0) return tabs;
  const pinnedCount = tabs.filter((tab) => tab.pinned).length;
  const [low, high] = tabs[from].pinned ? [0, pinnedCount - 1] : [pinnedCount, tabs.length - 1];
  const target = Math.max(low, Math.min(high, to));
  if (target === from) return tabs;
  const next = [...tabs];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}

// ---------------------------------------------------------------------------------------------
// Sessão: as guias abertas voltam na próxima vez que o vault é aberto.

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export type Session = { tabs: { stack: string[]; idx: number; pinned?: boolean }[]; active: number };

export const MAX_SESSION_TABS = 30;
const MAX_STACK = 50;

export const sessionKey = (vault: string) => `obnotion:session:${vault}`;

export function serializeSession(tabs: Tab[], activeId: number): Session {
  const kept = tabs.filter((tab) => tabPath(tab)).slice(0, MAX_SESSION_TABS);
  return {
    // O histórico de cada guia guarda só os últimos passos.
    tabs: kept.map((tab) => {
      const start = Math.max(0, tab.stack.length - MAX_STACK);
      return { stack: tab.stack.slice(start), idx: Math.max(0, tab.idx - start), ...(tab.pinned ? { pinned: true } : {}) };
    }),
    active: Math.max(0, kept.findIndex((tab) => tab.id === activeId)),
  };
}

/**
 * Guias da sessão salva que ainda fazem sentido: caminhos que não existem mais saem do histórico
 * de cada guia, e guias que ficam vazias somem. `exists` diz se um caminho ainda pode ser aberto.
 */
export function restoreSession(raw: string | null | undefined, exists: (path: string) => boolean, firstId: number): { tabs: Tab[]; activeId: number } {
  const empty = { tabs: [], activeId: 0 };
  if (!raw) return empty;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return empty;
  }
  const saved = (data as Partial<Session> | null)?.tabs;
  if (!Array.isArray(saved)) return empty;
  const tabs: Tab[] = [];
  let activeId: number | undefined;
  const wanted = Number((data as Partial<Session>).active) || 0;
  saved.slice(0, MAX_SESSION_TABS).forEach((entry, position) => {
    if (!entry || !Array.isArray(entry.stack)) return;
    const current = entry.stack[Number(entry.idx) || 0];
    const stack = entry.stack.filter((path: unknown): path is string => typeof path === 'string' && path !== '' && exists(path));
    if (!stack.length) return;
    const idx = Math.max(0, stack.lastIndexOf(current) >= 0 ? stack.lastIndexOf(current) : stack.length - 1);
    const tab: Tab = { id: firstId + tabs.length, stack, idx, ...(entry.pinned === true ? { pinned: true } : {}) };
    tabs.push(tab);
    if (position === wanted) activeId = tab.id;
  });
  const ordered = pinnedFirst(tabs);
  // "??" e não "||": o id 0 (firstId 0) é uma guia ativa válida.
  return { tabs: ordered, activeId: activeId ?? ordered[0]?.id ?? 0 };
}

export function loadSession(vault: string, store: Store = localStorage): string | null {
  try {
    return store.getItem(sessionKey(vault));
  } catch {
    return null;
  }
}

export function saveSession(vault: string, tabs: Tab[], activeId: number, store: Store = localStorage) {
  try {
    store.setItem(sessionKey(vault), JSON.stringify(serializeSession(tabs, activeId)));
  } catch {
    // armazenamento indisponível: a sessão não volta na próxima vez
  }
}
