import { useSyncExternalStore } from 'react';

import { resolveRequestTarget } from './links';
import type { RequestSummary } from './request';

// Lista das requests do vault, compartilhada entre a aba Requests, o editor de páginas
// (sugestões ao digitar "[" e o selo de método dos links) e o App (abrir um link).

let summaries: RequestSummary[] = [];
const listeners = new Set<() => void>();

export function setRequestIndex(next: RequestSummary[]) {
  summaries = next;
  listeners.forEach((listener) => listener());
}

export async function loadRequestIndex() {
  try {
    setRequestIndex((await window.api.bruList()).requests);
  } catch {
    setRequestIndex([]); // vault sem permissão de leitura: links de request ficam sem selo
  }
  return summaries;
}

export const getRequestIndex = () => summaries;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** A request a que um link aponta, ou undefined se ela não existe (mais). */
export function useRequestSummary(target: string) {
  const list = useSyncExternalStore(subscribe, getRequestIndex);
  const path = resolveRequestTarget(target, list);
  return list.find((request) => request.path === path);
}

// Pedido de foco vindo de fora da aba (link numa página): a aba lê ao montar ou ouve o evento.
export const focusRequestEvent = 'obnotion:focus-request';
let pendingFocus: string | null = null;

export function focusRequest(path: string) {
  pendingFocus = path;
  window.dispatchEvent(new CustomEvent(focusRequestEvent, { detail: path }));
}

export function takeFocusedRequest() {
  const path = pendingFocus;
  pendingFocus = null;
  return path;
}
