// Busca nas Configurações: todas as palavras digitadas precisam aparecer no título, na descrição
// ou no nome da seção, sem distinguir maiúsculas nem acentos.

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export function matchesSetting(query: string, texts: string[]): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = fold(texts.join(' '));
  return words.every((word) => haystack.includes(word));
}
