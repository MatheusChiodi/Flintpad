// Nomes e caminhos dos arquivos de quadro dentro do vault. Funções puras.

export const BOARD_EXT = '.whiteboard.json';
/** Pasta onde os quadros novos são criados; quadros em qualquer pasta do vault aparecem na lista. */
export const BOARD_FOLDER = 'Whiteboards';
const MAX_NAME = 120;

export const isBoardPath = (path: string) => path.toLowerCase().endsWith(BOARD_EXT);

export const boardName = (path: string) => {
  const file = path.split('/').pop() ?? path;
  return isBoardPath(file) ? file.slice(0, -BOARD_EXT.length) : file;
};

export const boardFolder = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '');

/** Nome de arquivo válido no Windows: sem separadores nem caracteres reservados. Vazio se nada sobrar. */
export const sanitizeName = (name: string) =>
  name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .slice(0, MAX_NAME);

/** `name`, ou `name 2`, `name 3`… o primeiro que não estiver em `taken` (sem diferenciar caixa). */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  for (let i = 2; ; i++) if (!used.has(`${name} ${i}`.toLowerCase())) return `${name} ${i}`;
}

/** Nome do quadro a partir do arquivo importado: tira .whiteboard.json ou .json. */
export const importedName = (fileName: string) => sanitizeName(fileName.replace(/(\.whiteboard)?\.json$/i, ''));
