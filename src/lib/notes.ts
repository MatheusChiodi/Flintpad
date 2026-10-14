// Lógica pura da tela de notas: nomes, títulos, contagens, tags, menções e modelos.
// Nada aqui toca o DOM nem o disco; os testes (tests/notes.test.mjs) importam este arquivo direto.

import { linkRegex, splitFrontmatter } from './links.ts';

// Caracteres que o Windows recusa em nomes de arquivo e os que quebram um [[wikilink]].
const FORBIDDEN_NAME_CHARS = /[\\/:*?"<>|#^[\]\u0000-\u001f]/g;
const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** Nome de página seguro para arquivo e para link; vazio se não sobrar nada. */
export function sanitizeNoteName(raw: string): string {
  const name = raw.replace(FORBIDDEN_NAME_CHARS, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  return RESERVED_WINDOWS_NAMES.test(name) ? `${name}_` : name;
}

/** Como sanitizeNoteName, mas aceita subpastas ("Projetos/Casa"): cada parte é limpa e as vazias somem. */
export function sanitizeNotePath(raw: string): string {
  return raw
    .split(/[\\/]+/)
    .map((part) => (part === '..' || part === '.' ? '' : sanitizeNoteName(part)))
    .filter(Boolean)
    .join('/');
}
