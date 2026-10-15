// Lógica pura da tela inicial (nenhuma página aberta): saudação, números do vault e dica do dia.
// Os testes (tests/home.test.mjs) importam este arquivo direto.

import { folderList, textStats } from './notes.ts';
import { extractTasks } from './tasks.ts';
import type { Note } from '../types';

export type Greeting = 'morning' | 'afternoon' | 'evening' | 'night';

// Madrugada (0–4h) é "noite"; manhã até 11h59, tarde até 17h59.
export function greetingFor(hour: number): Greeting {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  if (hour >= 18) return 'evening';
  return 'night';
}

export type VaultStats = { pages: number; folders: number; openTasks: number; doneTasks: number; words: number; tags: number };

// Números do vault a partir do que já está carregado (notas grandes demais chegam vazias e não contam palavras).
export function vaultStats(notes: Note[], contents: Record<string, string>, tags = 0): VaultStats {
  let openTasks = 0;
  let doneTasks = 0;
  let words = 0;
  for (const note of notes) {
    const content = contents[note.path] ?? '';
    if (!content) continue;
    for (const task of extractTasks(note.path, content)) {
      if (task.done) doneTasks++;
      else openTasks++;
    }
    words += textStats(content).words;
  }
  // A raiz não conta como pasta.
  return { pages: notes.length, folders: folderList(notes).length - 1, openTasks, doneTasks, words, tags };
}

// A dica muda uma vez por dia (mesma dica o dia todo); `offset` avança pelo botão "Outra dica".
export function tipIndex(date: Date, count: number, offset = 0): number {
  if (count <= 0) return 0;
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
  return (((day + offset) % count) + count) % count;
}
