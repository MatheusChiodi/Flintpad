// Quadros no disco: arquivos .whiteboard.json dentro do vault, lidos e gravados pela mesma ponte
// (window.api) das notas. Nenhum dado sai do computador.
import { BOARD_EXT, BOARD_FOLDER, boardFolder, boardName, isBoardPath, sanitizeName, uniqueName } from './files.ts';
import { parseBoard, serializeBoard, type Board, type ParseResult } from './model.ts';

export type BoardEntry = { path: string; name: string };

export async function listBoards(): Promise<BoardEntry[]> {
  const files = await window.api.filesList();
  return files
    .filter(isBoardPath)
    .map((path) => ({ path, name: boardName(path) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function readBoard(path: string): Promise<ParseResult> {
  return parseBoard(await window.api.read(path));
}

/** Cria o arquivo com um nome livre na pasta de quadros e devolve o caminho. */
export async function createBoard(name: string, board: Board, existing: BoardEntry[]): Promise<string> {
  const clean = uniqueName(sanitizeName(name) || 'Whiteboard', existing.filter((e) => boardFolder(e.path) === `${BOARD_FOLDER}/`).map((e) => e.name));
  const path = await window.api.create(`${BOARD_FOLDER}/${clean}${BOARD_EXT}`);
  await window.api.write(path, serializeBoard(board));
  return path;
}

/** Renomeia na mesma pasta. Devolve o caminho novo (ou o antigo, se o nome não mudou ou é inválido). */
export async function renameBoard(path: string, name: string, existing: BoardEntry[]): Promise<string> {
  const clean = sanitizeName(name);
  if (!clean || clean === boardName(path)) return path;
  const folder = boardFolder(path);
  const siblings = existing.filter((e) => e.path !== path && boardFolder(e.path) === folder).map((e) => e.name);
  return window.api.rename(path, `${folder}${uniqueName(clean, siblings)}${BOARD_EXT}`);
}

/** Vai para a lixeira do sistema, como as notas: dá para recuperar. */
export const deleteBoard = (path: string) => window.api.remove(path);

/**
 * Gravação automática: guarda o último estado pedido e grava um de cada vez, depois de uma pausa.
 * `flush` grava já o que estiver pendente (troca de quadro, renomear, fechar).
 */
export function createAutosave(path: string, onStatus: (status: 'saving' | 'saved' | 'error') => void, delay = 400) {
  let pending: Board | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> = Promise.resolve();
  let disposed = false;

  const write = () => {
    clearTimeout(timer);
    timer = undefined;
    const board = pending;
    if (!board) return running;
    pending = null;
    running = running.then(async () => {
      onStatus('saving');
      try {
        await window.api.write(path, serializeBoard(board));
        if (!pending) onStatus('saved');
      } catch (error) {
        // Mantém o estado para a próxima tentativa, sem sobrescrever uma alteração mais nova.
        pending ??= board;
        onStatus('error');
        console.error('whiteboard:save', path, error instanceof Error ? error.message : error);
      }
    });
    return running;
  };

  return {
    schedule(board: Board) {
      if (disposed) return;
      pending = board;
      clearTimeout(timer);
      timer = setTimeout(write, delay);
    },
    flush: () => write(),
    /** Depois de descartar, nada mais é gravado (o arquivo pode ter ido para a lixeira). */
    dispose() {
      disposed = true;
      clearTimeout(timer);
      pending = null;
    },
    get dirty() {
      return pending !== null;
    },
  };
}

// ---------------------------------------------------------------- exportação

/** Entrega um arquivo para o usuário salvar (o Electron abre o diálogo "Salvar como"). */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Rasteriza um SVG em PNG (escala 2 para telas de alta densidade). */
export async function svgToPng(svg: string, width: number, height: number, scale = 2): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('svg-decode'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    // O Chromium limita o tamanho do canvas: quadros enormes saem com escala menor.
    const fit = Math.min(scale, 16384 / Math.max(width, 1), 16384 / Math.max(height, 1));
    canvas.width = Math.max(1, Math.round(width * fit));
    canvas.height = Math.max(1, Math.round(height * fit));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas');
    context.scale(fit, fit);
    context.drawImage(image, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('png'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Medida real do texto na fonte do app (o modelo só conhece caracteres).
let measurer: CanvasRenderingContext2D | null = null;
export function measureText(text: string, size: number, family: string, lineHeight: number) {
  measurer ??= document.createElement('canvas').getContext('2d');
  const lines = text.split('\n');
  let width = 0;
  if (measurer) {
    measurer.font = `${size}px ${family}`;
    for (const line of lines) width = Math.max(width, measurer.measureText(line).width);
  } else {
    width = Math.max(...lines.map((l) => l.length)) * size * 0.6;
  }
  return { w: Math.ceil(width) + 4, h: Math.ceil(lines.length * size * lineHeight) + 4 };
}
