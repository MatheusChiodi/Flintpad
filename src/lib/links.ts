import type { Note } from '../types';

// [[Alvo]], [[Alvo|apelido]] e [[Alvo#seção]], como no Obsidian.
const LINK_SOURCE = String.raw`\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]`;

export const linkRegex = () => new RegExp(LINK_SOURCE, 'g');

export const baseName = (path: string) => path.split('/').pop()!.replace(/\.md$/i, '');

export const dirName = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '');

export function outgoingTargets(content: string): string[] {
  const targets = new Set<string>();
  for (const match of content.matchAll(linkRegex())) targets.add(match[1].trim());
  return [...targets];
}

export function resolveLink(target: string, notes: Note[]): string | undefined {
  const wanted = target.trim().toLowerCase();
  return notes.find((n) => n.name.toLowerCase() === wanted || n.path.toLowerCase() === `${wanted}.md`)?.path;
}

// Troca o alvo dos links que apontam para uma página renomeada, mantendo seção e apelido.
export function retargetLinks(content: string, oldPath: string, newName: string): string {
  const targets = [baseName(oldPath).toLowerCase(), oldPath.replace(/\.md$/i, '').toLowerCase()];
  const detailed = new RegExp(String.raw`\[\[([^\]|#]+)(#[^\]|]*)?(\|[^\]]+)?\]\]`, 'g');
  return content.replace(detailed, (all, target: string, section = '', alias = '') =>
    targets.includes(target.trim().toLowerCase()) ? `[[${newName}${section}${alias}]]` : all,
  );
}

export function splitFrontmatter(text: string): [front: string, body: string] {
  // O conteúdo é opcional: "---\n---\n" (frontmatter vazio) também vale, como no Obsidian.
  const match = /^---\r?\n(?:[\s\S]*?\r?\n)?---\r?\n?/.exec(text);
  return match ? [match[0], text.slice(match[0].length)] : ['', text];
}

// O serializador de Markdown escapa colchetes; devolve os wikilinks ao formato do Obsidian.
export function restoreWikilinks(markdown: string): string {
  const escapedLink = new RegExp(String.raw`\\\[\\\[(.*?)\\\]\\\]`, 'g');
  const escapedChar = new RegExp(String.raw`\\(.)`, 'g');
  return markdown.replace(escapedLink, (_all, inner: string) => '[[' + inner.replace(escapedChar, '$1') + ']]');
}

// Links para requests: o alvo é o caminho do arquivo .bru no vault ([[Requests/Listar.bru|Listar]]),
// o mesmo formato que o Obsidian usa para ligar arquivos que não são notas.
export const isRequestTarget = (target: string) => /\.bru$/i.test(target.trim());

const requestKey = (path: string) => path.trim().replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();

export function resolveRequestTarget(target: string, requests: { path: string }[]): string | undefined {
  const wanted = requestKey(target);
  return requests.find((r) => requestKey(r.path) === wanted)?.path;
}

/** Notas que citam a request, pela ordem em que aparecem na lista. */
export function requestMentions(path: string, notes: Note[], contents: Record<string, string>): Note[] {
  const wanted = requestKey(path);
  return notes.filter((note) => outgoingTargets(contents[note.path] ?? '').some((target) => requestKey(target) === wanted));
}

export const requestLinkMarkdown = (path: string, name: string) => `[[${path}|${name.replace(/[\]|]/g, '')}]]`;
