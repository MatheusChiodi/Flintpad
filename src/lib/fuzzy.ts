// Busca aproximada como a do Quick Open do VS Code: as letras da consulta aparecem em ordem,
// com bônus para início de palavra, letras seguidas e acerto no nome do arquivo.

export type FuzzyMatch = { score: number; positions: number[] };

const isWordStart = (text: string, index: number) => {
  if (index === 0) return true;
  const previous = text[index - 1];
  const current = text[index];
  return /[\\/\s_.\-()[\]]/.test(previous) || (previous === previous.toLowerCase() && current !== current.toLowerCase());
};

// Sem acento e em minúsculas, letra por letra: "titulo" acha "Título" e as posições continuam valendo.
const fold = (text: string) =>
  text
    .split('')
    .map((char) => char.normalize('NFD')[0].toLowerCase())
    .join('');

export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = fold(query.replace(/\s+/g, ''));
  if (!q) return { score: 0, positions: [] };
  const lower = fold(text);
  // Primeiro tenta preferindo inícios de palavra; se esse caminho se perder (pulou para uma
  // ocorrência adiante e as letras seguintes acabaram), volta ao casamento guloso simples.
  const match = matchFrom(q, text, lower, true) ?? matchFrom(q, text, lower, false);
  if (!match) return null;
  let { score } = match;
  const { positions } = match;
  const nameStart = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\')) + 1;
  if (positions[0] >= nameStart) score += 6;
  if (lower.slice(nameStart).startsWith(q)) score += 10;
  score -= text.length * 0.01;
  return { score, positions };
}

function matchFrom(q: string, text: string, lower: string, preferWordStart: boolean): FuzzyMatch | null {
  const positions: number[] = [];
  let score = 0;
  let from = 0;
  let streak = 0;
  for (const char of q) {
    // Prefere a próxima ocorrência que comece palavra (ou continue a sequência); senão, a primeira.
    let index = -1;
    for (let i = lower.indexOf(char, from); i >= 0; i = lower.indexOf(char, i + 1)) {
      if (index < 0) index = i;
      if (!preferWordStart || isWordStart(text, i) || (positions.length && i === positions[positions.length - 1] + 1)) {
        index = i;
        break;
      }
    }
    if (index < 0) return null;
    const contiguous = positions.length > 0 && index === positions[positions.length - 1] + 1;
    streak = contiguous ? streak + 1 : 0;
    score += 1 + streak * 2 + (isWordStart(text, index) ? 3 : 0) - Math.min(3, (index - from) * 0.05);
    positions.push(index);
    from = index + 1;
  }
  return { score, positions };
}

/** Ordena e limita: só os melhores entram na lista. */
export function fuzzyFilter<T>(query: string, items: T[], text: (item: T) => string, limit = 200) {
  if (!query.trim()) return items.slice(0, limit).map((item) => ({ item, positions: [] as number[] }));
  const scored: { item: T; score: number; positions: number[] }[] = [];
  for (const item of items) {
    const match = fuzzyMatch(query, text(item));
    if (match) scored.push({ item, ...match });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
