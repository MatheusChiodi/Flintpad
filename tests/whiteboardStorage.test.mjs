// Quadro branco (src/whiteboard/storage.ts): lista, leitura, criação, renomear, lixeira, gravação automática,
// exportação PNG, leitura de imagens e medida de texto. window.api, document, Image, FileReader e a área
// de transferência são simulados em globalThis. Rodar com `npm test`.
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

import * as f from '../src/whiteboard/files.ts';
import * as m from '../src/whiteboard/model.ts';
import * as s from '../src/whiteboard/storage.ts';

const tick = () => new Promise((resolve) => setImmediate(resolve));

/** Ponte falsa: grava num Map e registra as chamadas. */
function fakeApi(initial = {}) {
  const files = new Map(Object.entries(initial));
  const calls = [];
  const api = {
    files,
    calls,
    failWrites: 0,
    async filesList() {
      calls.push(['filesList']);
      return [...files.keys()];
    },
    async read(path) {
      calls.push(['read', path]);
      if (!files.has(path)) throw new Error('missing');
      return files.get(path);
    },
    async create(path) {
      calls.push(['create', path]);
      files.set(path, '');
      return path;
    },
    async write(path, text) {
      calls.push(['write', path, text]);
      if (api.failWrites > 0) {
        api.failWrites--;
        throw new Error('disk');
      }
      files.set(path, text);
    },
    async rename(from, to) {
      calls.push(['rename', from, to]);
      files.set(to, files.get(from));
      files.delete(from);
      return to;
    },
    async remove(path) {
      calls.push(['remove', path]);
      files.delete(path);
    },
  };
  globalThis.window = { api };
  return api;
}

const entry = (path) => ({ path, name: f.boardName(path) });
const boardWith = (text) => m.addShape(m.emptyBoard(), 'rectangle', { x: 0, y: 0, w: 100, h: 60 }, { text }).board;

// ---------------------------------------------------------------- lista e leitura

test('listBoards: só arquivos de quadro (qualquer caixa da extensão), ordenados pelo nome', async () => {
  fakeApi({
    'Notas/a.md': '',
    'Whiteboards/zeta.whiteboard.json': '',
    'Whiteboards/Alfa.WHITEBOARD.JSON': '',
    'Projeto/beta.whiteboard.json': '',
    'dados.json': '',
  });
  const list = await s.listBoards();
  assert.deepEqual(
    list.map((e) => e.name),
    ['Alfa', 'beta', 'zeta'],
  );
  assert.ok(list.every((e) => f.isBoardPath(e.path)));
});

test('listBoards: vault sem quadros devolve lista vazia', async () => {
  fakeApi({ 'a.md': '' });
  assert.deepEqual(await s.listBoards(), []);
});

test('readBoard: arquivo vazio vira quadro vazio; JSON quebrado dá erro com motivo', async () => {
  fakeApi({ 'Whiteboards/a.whiteboard.json': '', 'Whiteboards/b.whiteboard.json': '{oops' });
  const empty = await s.readBoard('Whiteboards/a.whiteboard.json');
  assert.equal(empty.ok, true);
  assert.deepEqual(empty.board.elements, []);
  assert.deepEqual(await s.readBoard('Whiteboards/b.whiteboard.json'), { ok: false, error: 'invalid-json' });
});

test('readBoard: erro da ponte (arquivo sumiu) propaga como rejeição', async () => {
  fakeApi();
  await assert.rejects(s.readBoard('nada.whiteboard.json'), /missing/);
});

// ---------------------------------------------------------------- criar, renomear, apagar

test('createBoard: grava na pasta de quadros com nome limpo e conteúdo serializado (ida e volta)', async () => {
  const api = fakeApi();
  const board = boardWith('Olá');
  const path = await s.createBoard('  Meu: quadro?  ', board, []);
  assert.equal(path, `${f.BOARD_FOLDER}/Meu quadro${f.BOARD_EXT}`);
  const parsed = m.parseBoard(api.files.get(path));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.board, board);
});

test('createBoard: nome vazio ou só caracteres proibidos vira "Whiteboard"', async () => {
  fakeApi();
  assert.equal(await s.createBoard('', m.emptyBoard(), []), `Whiteboards/Whiteboard${f.BOARD_EXT}`);
  assert.equal(await s.createBoard('<>:"/\\|?*', m.emptyBoard(), []), `Whiteboards/Whiteboard${f.BOARD_EXT}`);
});

test('createBoard: nome repetido na pasta de quadros ganha sufixo (sem diferenciar caixa)', async () => {
  fakeApi();
  const existing = [entry('Whiteboards/Plano.whiteboard.json'), entry('Whiteboards/plano 2.whiteboard.json')];
  assert.equal(await s.createBoard('PLANO', m.emptyBoard(), existing), `Whiteboards/PLANO 3${f.BOARD_EXT}`);
});

test('createBoard: quadro com o mesmo nome em outra pasta (ou em subpasta) não conta', async () => {
  fakeApi();
  const existing = [entry('Outra/Plano.whiteboard.json'), entry('Whiteboards/sub/Plano.whiteboard.json'), entry('Plano.whiteboard.json')];
  assert.equal(await s.createBoard('Plano', m.emptyBoard(), existing), `Whiteboards/Plano${f.BOARD_EXT}`);
});

test('createBoard: usa o caminho devolvido pela ponte (que pode ajustar o nome)', async () => {
  const api = fakeApi();
  api.create = async (path) => {
    const real = path.replace('.whiteboard.json', ' (1).whiteboard.json');
    api.files.set(real, '');
    return real;
  };
  const path = await s.createBoard('X', m.emptyBoard(), []);
  assert.equal(path, 'Whiteboards/X (1).whiteboard.json');
  assert.ok(api.files.get(path).includes(m.BOARD_FORMAT));
});

test('renameBoard: mesmo nome ou nome inválido não chama a ponte', async () => {
  const api = fakeApi({ 'Whiteboards/A.whiteboard.json': '' });
  const path = 'Whiteboards/A.whiteboard.json';
  assert.equal(await s.renameBoard(path, 'A', [entry(path)]), path);
  assert.equal(await s.renameBoard(path, '  A  ', [entry(path)]), path);
  assert.equal(await s.renameBoard(path, '???', [entry(path)]), path);
  assert.equal(await s.renameBoard(path, '', [entry(path)]), path);
  assert.equal(api.calls.filter((c) => c[0] === 'rename').length, 0);
});

test('renameBoard: fica na mesma pasta e evita só os irmãos (não a si mesmo nem outras pastas)', async () => {
  fakeApi({ 'Proj/A.whiteboard.json': '', 'Proj/B.whiteboard.json': '', 'Outra/C.whiteboard.json': '' });
  const existing = ['Proj/A.whiteboard.json', 'Proj/B.whiteboard.json', 'Outra/C.whiteboard.json'].map(entry);
  assert.equal(await s.renameBoard('Proj/A.whiteboard.json', 'b', existing), 'Proj/b 2.whiteboard.json');
  assert.equal(await s.renameBoard('Proj/B.whiteboard.json', 'C', existing), 'Proj/C.whiteboard.json');
});

test('renameBoard: trocar só a caixa do nome renomeia (não é "o mesmo nome")', async () => {
  const api = fakeApi({ 'Whiteboards/plano.whiteboard.json': '' });
  const path = 'Whiteboards/plano.whiteboard.json';
  assert.equal(await s.renameBoard(path, 'Plano', [entry(path)]), 'Whiteboards/Plano.whiteboard.json');
  assert.equal(api.calls.at(-1)[0], 'rename');
});

test('renameBoard: quadro na raiz do vault continua na raiz', async () => {
  fakeApi({ 'A.whiteboard.json': '' });
  assert.equal(await s.renameBoard('A.whiteboard.json', 'Novo', [entry('A.whiteboard.json')]), 'Novo.whiteboard.json');
});

test('deleteBoard: delega para remove da ponte (lixeira)', async () => {
  const api = fakeApi({ 'Whiteboards/A.whiteboard.json': '' });
  await s.deleteBoard('Whiteboards/A.whiteboard.json');
  assert.deepEqual(api.calls, [['remove', 'Whiteboards/A.whiteboard.json']]);
  assert.equal(api.files.size, 0);
});

// ---------------------------------------------------------------- gravação automática

test('autosave: agrupa alterações seguidas e grava só a última depois da pausa', async () => {
  const api = fakeApi();
  const statuses = [];
  const save = s.createAutosave('q.whiteboard.json', (st) => statuses.push(st), 5);
  save.schedule(boardWith('1'));
  save.schedule(boardWith('2'));
  save.schedule(boardWith('3'));
  assert.equal(save.dirty, true);
  await new Promise((r) => setTimeout(r, 30));
  await save.flush();
  const writes = api.calls.filter((c) => c[0] === 'write');
  assert.equal(writes.length, 1);
  assert.equal(m.parseBoard(writes[0][2]).board.elements[0].text, '3');
  assert.deepEqual(statuses, ['saving', 'saved']);
  assert.equal(save.dirty, false);
});

test('autosave: flush grava na hora, sem esperar a pausa; flush sem pendência não grava', async () => {
  const api = fakeApi();
  const save = s.createAutosave('q.whiteboard.json', () => {}, 60_000);
  await save.flush();
  assert.equal(api.calls.length, 0);
  save.schedule(boardWith('a'));
  await save.flush();
  assert.equal(api.calls.filter((c) => c[0] === 'write').length, 1);
  assert.equal(save.dirty, false);
  await save.flush();
  assert.equal(api.calls.filter((c) => c[0] === 'write').length, 1);
});

test('autosave: falha mantém o pendente, avisa erro e a próxima tentativa grava', async () => {
  const api = fakeApi();
  api.failWrites = 1;
  const statuses = [];
  const errors = mock.method(console, 'error', () => {});
  try {
    const save = s.createAutosave('q.whiteboard.json', (st) => statuses.push(st), 60_000);
    save.schedule(boardWith('x'));
    await save.flush();
    assert.deepEqual(statuses, ['saving', 'error']);
    assert.equal(save.dirty, true);
    assert.equal(errors.mock.callCount(), 1);
    assert.equal(errors.mock.calls[0].arguments[0], 'whiteboard:save');
    await save.flush();
    assert.deepEqual(statuses, ['saving', 'error', 'saving', 'saved']);
    assert.equal(save.dirty, false);
    assert.equal(m.parseBoard(api.files.get('q.whiteboard.json')).board.elements[0].text, 'x');
  } finally {
    errors.mock.restore();
  }
});

test('autosave: falha não sobrescreve uma alteração mais nova feita durante a gravação', async () => {
  const api = fakeApi();
  let release;
  api.write = async (path, text) => {
    api.calls.push(['write', path, text]);
    await new Promise((r) => (release = r));
    throw new Error('disk');
  };
  const errors = mock.method(console, 'error', () => {});
  try {
    const save = s.createAutosave('q.whiteboard.json', () => {}, 60_000);
    save.schedule(boardWith('velho'));
    const first = save.flush();
    await tick();
    save.schedule(boardWith('novo'));
    release();
    await first;
    api.write = async (path, text) => api.files.set(path, text);
    await save.flush();
    assert.equal(m.parseBoard(api.files.get('q.whiteboard.json')).board.elements[0].text, 'novo');
  } finally {
    errors.mock.restore();
  }
});

test('autosave: gravações não se sobrepõem e uma alteração durante a gravação adia o "saved"', async () => {
  const api = fakeApi();
  let active = 0;
  let maxActive = 0;
  const releases = [];
  api.write = async (path, text) => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => releases.push(r));
    api.files.set(path, text);
    active--;
  };
  const statuses = [];
  const save = s.createAutosave('q.whiteboard.json', (st) => statuses.push(st), 60_000);
  save.schedule(boardWith('1'));
  const a = save.flush();
  await tick();
  save.schedule(boardWith('2'));
  releases.shift()();
  await a;
  // A primeira terminou com outra alteração pendente: não diz "saved" ainda.
  assert.deepEqual(statuses, ['saving']);
  assert.equal(save.dirty, true);
  const b = save.flush();
  await tick();
  // Duas gravações pedidas em seguida ficam na fila, uma de cada vez.
  save.schedule(boardWith('3'));
  const c = save.flush();
  await tick();
  releases.shift()();
  await b;
  await tick();
  releases.shift()();
  await c;
  assert.equal(maxActive, 1);
  assert.equal(statuses.at(-1), 'saved');
  assert.equal(statuses.filter((st) => st === 'saving').length, 3);
  assert.equal(m.parseBoard(api.files.get('q.whiteboard.json')).board.elements[0].text, '3');
});

test('autosave: depois de dispose nada é agendado nem gravado', async () => {
  const api = fakeApi();
  const save = s.createAutosave('q.whiteboard.json', () => {}, 5);
  save.schedule(boardWith('a'));
  save.dispose();
  assert.equal(save.dirty, false);
  save.schedule(boardWith('b'));
  assert.equal(save.dirty, false);
  await new Promise((r) => setTimeout(r, 20));
  await save.flush();
  assert.equal(api.calls.length, 0);
});

test(
  'autosave: falha de uma gravação em andamento não ressuscita o pendente depois de dispose',
  async () => {
    const api = fakeApi();
    let release;
    api.write = async (path, text) => {
      api.calls.push(['write', path, text]);
      await new Promise((r) => (release = r));
      throw new Error('disk');
    };
    const errors = mock.method(console, 'error', () => {});
    try {
      const save = s.createAutosave('q.whiteboard.json', () => {}, 60_000);
      save.schedule(boardWith('a'));
      const running = save.flush();
      await tick();
      save.dispose();
      release();
      await running;
      assert.equal(save.dirty, false);
      await save.flush();
      assert.equal(api.calls.filter((c) => c[0] === 'write').length, 1);
    } finally {
      errors.mock.restore();
    }
  },
);

// ---------------------------------------------------------------- DOM simulado

function fakeDom({ context = true, decodeFails = false, blob = true } = {}) {
  const created = [];
  const revoked = [];
  const canvases = [];
  const appended = [];
  let nextUrl = 0;
  const saved = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
  URL.createObjectURL = (b) => {
    created.push(b);
    return `blob:fake/${nextUrl++}`;
  };
  URL.revokeObjectURL = (u) => revoked.push(u);
  globalThis.Image = class {
    set src(value) {
      this._src = value;
      setImmediate(() => (decodeFails ? this.onerror?.() : this.onload?.()));
    }
    get src() {
      return this._src;
    }
    naturalWidth = globalThis.__imageSize?.[0] ?? 100;
    naturalHeight = globalThis.__imageSize?.[1] ?? 50;
  };
  globalThis.document = {
    body: { append: (el) => appended.push(el) },
    createElement(tag) {
      if (tag === 'canvas') {
        const canvas = {
          width: 0,
          height: 0,
          ops: [],
          getContext: () =>
            context
              ? {
                  font: '',
                  scale: (...a) => canvas.ops.push(['scale', ...a]),
                  drawImage: (...a) => canvas.ops.push(['drawImage', ...a.slice(1)]),
                  measureText: (t) => ({ width: t.length * 10 }),
                }
              : null,
          toBlob: (cb, type) => cb(blob ? new Blob(['png'], { type }) : null),
          toDataURL: (type, quality) => `data:${type};base64,AAAA#${quality}`,
        };
        canvases.push(canvas);
        return canvas;
      }
      const el = { tag, clicked: 0, removed: 0, click() {
        this.clicked++;
      }, remove() {
        this.removed++;
      } };
      return el;
    },
  };
  return {
    created,
    revoked,
    canvases,
    appended,
    restore() {
      Object.assign(URL, saved);
      delete globalThis.document;
      delete globalThis.Image;
      delete globalThis.__imageSize;
    },
  };
}

test('downloadBlob: cria o link com nome, clica, remove e libera a URL depois', () => {
  const dom = fakeDom();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    s.downloadBlob(new Blob(['x']), 'quadro.svg');
    const [link] = dom.appended;
    assert.equal(link.download, 'quadro.svg');
    assert.equal(link.rel, 'noopener');
    assert.equal(link.href, 'blob:fake/0');
    assert.equal(link.clicked, 1);
    assert.equal(link.removed, 1);
    assert.deepEqual(dom.revoked, []);
    mock.timers.tick(10_000);
    assert.deepEqual(dom.revoked, ['blob:fake/0']);
  } finally {
    mock.timers.reset();
    dom.restore();
  }
});

test('svgToPng: escala 2 por padrão, devolve PNG e libera a URL', async () => {
  const dom = fakeDom();
  try {
    const png = await s.svgToPng('<svg/>', 300, 200);
    assert.equal(png.type, 'image/png');
    const [canvas] = dom.canvases;
    assert.deepEqual([canvas.width, canvas.height], [600, 400]);
    assert.deepEqual(canvas.ops[0], ['scale', 2, 2]);
    assert.deepEqual(canvas.ops[1], ['drawImage', 0, 0, 300, 200]);
    assert.equal(dom.created[0].type, 'image/svg+xml');
    assert.deepEqual(dom.revoked, ['blob:fake/0']);
  } finally {
    dom.restore();
  }
});

test('svgToPng: quadro enorme reduz a escala para caber no limite de 16384 px do canvas', async () => {
  const dom = fakeDom();
  try {
    await s.svgToPng('<svg/>', 20_000, 100, 2);
    const [canvas] = dom.canvases;
    assert.equal(canvas.width, 16384);
    assert.ok(canvas.height <= 16384 && canvas.height >= 1);
    await s.svgToPng('<svg/>', 0, 0, 2);
    assert.deepEqual([dom.canvases[1].width, dom.canvases[1].height], [1, 1]);
  } finally {
    dom.restore();
  }
});

test('svgToPng: SVG que não decodifica, canvas sem contexto ou toBlob nulo rejeitam e liberam a URL', async () => {
  let dom = fakeDom({ decodeFails: true });
  try {
    await assert.rejects(s.svgToPng('<svg/>', 10, 10), /svg-decode/);
    assert.equal(dom.revoked.length, 1);
  } finally {
    dom.restore();
  }
  dom = fakeDom({ context: false });
  try {
    await assert.rejects(s.svgToPng('<svg/>', 10, 10), /canvas/);
    assert.equal(dom.revoked.length, 1);
  } finally {
    dom.restore();
  }
  dom = fakeDom({ blob: false });
  try {
    await assert.rejects(s.svgToPng('<svg/>', 10, 10), /png/);
    assert.equal(dom.revoked.length, 1);
  } finally {
    dom.restore();
  }
});

test('IMAGE_TYPES: só raster; SVG fica de fora (pode ter script)', () => {
  assert.deepEqual([...s.IMAGE_TYPES].sort(), ['image/gif', 'image/jpeg', 'image/png', 'image/webp']);
  assert.ok(!s.IMAGE_TYPES.includes('image/svg+xml'));
});

test('readImage: formato não aceito rejeita "unsupported" sem criar URL', async () => {
  const dom = fakeDom();
  try {
    await assert.rejects(s.readImage(new Blob(['<svg/>'], { type: 'image/svg+xml' })), /unsupported/);
    await assert.rejects(s.readImage(new Blob(['x'])), /unsupported/);
    assert.equal(dom.created.length, 0);
  } finally {
    dom.restore();
  }
});

test('readImage: imagem pequena e leve é mantida como está (FileReader)', async () => {
  const dom = fakeDom();
  globalThis.FileReader = class {
    readAsDataURL(blob) {
      this.result = `data:${blob.type};base64,ORIGINAL`;
      setImmediate(() => this.onload());
    }
  };
  try {
    const result = await s.readImage(new Blob(['abc'], { type: 'image/png' }));
    assert.deepEqual(result, { src: 'data:image/png;base64,ORIGINAL', w: 100, h: 50 });
    assert.equal(dom.canvases.length, 0);
    assert.equal(dom.revoked.length, 1);
  } finally {
    delete globalThis.FileReader;
    dom.restore();
  }
});

test('readImage: imagem grande é reduzida a 1600 px no lado maior; PNG vira WebP, JPEG continua JPEG', async () => {
  const dom = fakeDom();
  globalThis.__imageSize = [3200, 1000];
  try {
    const png = await s.readImage(new Blob(['x'], { type: 'image/png' }));
    assert.deepEqual([png.w, png.h], [1600, 500]);
    assert.ok(png.src.startsWith('data:image/webp'));
    assert.ok(png.src.endsWith('#0.86'));
    const jpeg = await s.readImage(new Blob(['x'], { type: 'image/jpeg' }));
    assert.ok(jpeg.src.startsWith('data:image/jpeg'));
    assert.deepEqual(dom.canvases.map((c) => [c.width, c.height]), [
      [1600, 500],
      [1600, 500],
    ]);
  } finally {
    dom.restore();
  }
});

test('readImage: arquivo pesado mesmo pequeno em pixels é recomprimido; dimensão 0 vira 1', async () => {
  const dom = fakeDom();
  globalThis.__imageSize = [0, 0];
  try {
    const heavy = new Blob([new Uint8Array(1_200_001)], { type: 'image/gif' });
    const result = await s.readImage(heavy);
    assert.deepEqual([result.w, result.h], [1, 1]);
    assert.ok(result.src.startsWith('data:image/webp'));
  } finally {
    dom.restore();
  }
});

test('readImage: erro de decodificação rejeita e libera a URL', async () => {
  const dom = fakeDom({ decodeFails: true });
  try {
    await assert.rejects(s.readImage(new Blob(['x'], { type: 'image/png' })), /decode/);
    assert.equal(dom.revoked.length, 1);
  } finally {
    dom.restore();
  }
});

test('copyPng: escreve um ClipboardItem image/png na área de transferência', async () => {
  const written = [];
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { write: async (items) => written.push(...items) } } });
  globalThis.ClipboardItem = class {
    constructor(data) {
      this.data = data;
    }
  };
  try {
    const blob = new Blob(['p'], { type: 'image/png' });
    await s.copyPng(blob);
    assert.equal(written.length, 1);
    assert.equal(written[0].data['image/png'], blob);
  } finally {
    delete globalThis.ClipboardItem;
    if (saved) Object.defineProperty(globalThis, 'navigator', saved);
    else delete globalThis.navigator;
  }
});

test('measureText: usa a medida do canvas (linha mais larga) e a altura das linhas, com folga de 4 px', () => {
  const dom = fakeDom();
  try {
    const size = s.measureText('ab\nabcd', 20, 'sans', 1.25);
    // measureText falso: 10 px por caractere → 40; altura 2 × 20 × 1.25 = 50.
    assert.deepEqual(size, { w: 44, h: 54 });
    assert.deepEqual(s.measureText('', 16, 'sans', 1.25), { w: 4, h: 24 });
  } finally {
    dom.restore();
  }
});

test('measureText: sem contexto 2D, estima pela quantidade de caracteres', async () => {
  const dom = fakeDom({ context: false });
  try {
    // Instância nova do módulo: o medidor é guardado na primeira chamada.
    const fresh = await import('../src/whiteboard/storage.ts?sem-canvas');
    assert.deepEqual(fresh.measureText('abc\na', 10, 'sans', 1.5), { w: Math.ceil(3 * 10 * 0.6) + 4, h: Math.ceil(2 * 10 * 1.5) + 4 });
  } finally {
    dom.restore();
  }
});
