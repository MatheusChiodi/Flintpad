import { useSyncExternalStore } from 'react';

import { resolveLink } from './links';
import type { Note } from '../types';

// Ponte entre o App e o editor de blocos: os nós de wikilink são criados pelo BlockNote,
// longe das props do React, então leem daqui a lista de páginas e mandam eventos por aqui.

let notes: Note[] = [];
const listeners = new Set<() => void>();

export function setNoteIndex(next: Note[]) {
  if (next === notes) return;
  notes = next;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Caminho da página a que o link aponta, ou undefined se ela ainda não existe. */
export function useResolvedLink(target: string) {
  const list = useSyncExternalStore(subscribe, () => notes);
  return resolveLink(target, list);
}

// Ir para um título: quem pede (link com #seção, Sumário) grava o pedido; o editor da página
// o atende ao terminar de carregar ou, se já estiver aberto, pelo evento.
export const gotoHeadingEvent = 'obnotion:goto-heading';
// Com `task`, o alvo é a tarefa de posição `index` entre as caixas de seleção da página (tela de Tarefas).
export type HeadingRequest = { path: string; text: string; index?: number; task?: boolean };
let pendingHeading: HeadingRequest | null = null;

export function gotoHeading(request: HeadingRequest) {
  pendingHeading = request;
  window.dispatchEvent(new CustomEvent(gotoHeadingEvent, { detail: request }));
}

export function takeHeading(path: string): HeadingRequest | null {
  if (pendingHeading?.path !== path) return null;
  const request = pendingHeading;
  pendingHeading = null;
  return request;
}

// Prévia ao passar o mouse num link: o App mostra o cartão perto do retângulo do link.
export const previewLinkEvent = 'obnotion:preview-link';
export type PreviewRequest = { target: string; rect: { left: number; top: number; bottom: number; width: number } } | null;

export const previewLink = (request: PreviewRequest) =>
  window.dispatchEvent(new CustomEvent<PreviewRequest>(previewLinkEvent, { detail: request }));
