import { splitFrontmatter } from './links';

// `line` é o índice (base 0) da linha no arquivo inteiro, contando o frontmatter.
export type Task = { path: string; line: number; text: string; done: boolean };

// Item de lista (`-`, `*`, `+` ou numerado) seguido da caixa: `- [ ] texto`, `  * [x] feito`.
const taskLine = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\](?:\s+(.*))?)$/;
const fence = /^\s*(`{3,}|~{3,})/;

const withoutCr = (line: string) => (line.endsWith('\r') ? line.slice(0, -1) : line);

// Tarefas de uma nota, na ordem do arquivo. Frontmatter YAML e blocos de código cercados ficam de fora.
export function extractTasks(path: string, content: string): Task[] {
  const [front] = splitFrontmatter(content);
  const lines = content.split('\n');
  const tasks: Task[] = [];
  let open = '';
  for (let line = front ? front.split('\n').length - (front.endsWith('\n') ? 1 : 0) : 0; line < lines.length; line++) {
    const text = withoutCr(lines[line]);
    const marker = fence.exec(text)?.[1];
    if (open) {
      // Só fecha com a mesma marca, em quantidade igual ou maior, sozinha na linha.
      if (marker && marker[0] === open[0] && marker.length >= open.length && text.trim() === marker) open = '';
      continue;
    }
    if (marker) {
      open = marker;
      continue;
    }
    const match = taskLine.exec(text);
    const label = match?.[4]?.trim();
    if (match && label) tasks.push({ path, line, text: label, done: match[2] !== ' ' });
  }
  return tasks;
}

// Alterna `[ ]` e `[x]` na linha indicada; todo o resto do arquivo volta igual, byte a byte.
export function toggleTaskLine(content: string, line: number): string {
  const lines = content.split('\n');
  const target = lines[line];
  if (target === undefined) return content;
  const cr = target.endsWith('\r') ? '\r' : '';
  const match = taskLine.exec(withoutCr(target));
  if (!match) return content;
  lines[line] = `${match[1]}${match[2] === ' ' ? 'x' : ' '}${match[3]}${cr}`;
  return lines.join('\n');
}
