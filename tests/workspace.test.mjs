// Pasta de trabalho da aba Código (electron/workspace.cjs): checagem de raízes, explorador, busca e substituição.
// O módulo importa 'electron' no topo; aqui ele recebe um stub com ipcMain, dialog e shell falsos.
// Rodar com `npm test`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';

let handlers = new Map();
const trashed = [];
const revealed = [];
const fakeElectron = {
  ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async () => ({ canceled: true }),
  },
  shell: {
    trashItem: async (target) => trashed.push(target),
    showItemInFolder: (target) => revealed.push(target),
  },
};

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return fakeElectron;
  return originalLoad.call(this, request, ...rest);
};
const { registerWorkspaceIpc } = createRequire(import.meta.url)('../electron/workspace.cjs');
Module._load = originalLoad;

const cleanups = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()();
  fakeElectron.dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  fakeElectron.dialog.showSaveDialog = async () => ({ canceled: true });
  trashed.length = 0;
  revealed.length = 0;
});

function tempDir(prefix = 'flintpad-ws-') {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(file, content = '') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** Registra os handlers com config falsa; `call(canal, ...args)` chama como o renderer. */
function setup({ config = {}, vault = null, readOnly = [], win = null } = {}) {
  handlers = new Map();
  const saves = [];
  const api = registerWorkspaceIpc({
    getWin: () => win,
    getVault: () => vault,
    readConfig: () => config,
    saveConfig: async (patch) => saves.push(patch),
    readOnlyRoots: () => readOnly,
    t: (key) => key,
  });
  cleanups.push(() => api.dispose());
  const call = (channel, ...args) => {
    const fn = handlers.get(channel);
    assert.ok(fn, `canal ${channel} registrado`);
    return fn({}, ...args);
  };
  return { api, call, saves };
}

test('registra todos os canais esperados do workspace', () => {
  const { call } = setup();
  for (const channel of ['ws:get', 'ws:addFolder', 'ws:removeFolder', 'ws:openFolder', 'ws:setRoot', 'ws:openFile', 'ws:saveAs', 'ws:readDir', 'ws:listFiles', 'ws:read', 'ws:write', 'ws:create', 'ws:rename', 'ws:copy', 'ws:delete', 'ws:reveal', 'ws:search', 'ws:replace', 'ws:realpath', 'ws:stat']) {
    assert.ok(handlers.has(channel), channel);
  }
  assert.equal(typeof call, 'function');
});

test('ws:get sem pastas usa o vault como raiz', () => {
  const vault = tempDir();
  const { call, api } = setup({ vault });
  const state = call('ws:get');
  assert.equal(state.root, vault);
  assert.deepEqual(state.roots, [vault]);
  assert.equal(state.vault, vault);
  assert.equal(api.currentRoot(), vault);
});

test('ws:get sem vault nem pastas devolve raiz nula', () => {
  const { call } = setup();
  const state = call('ws:get');
  assert.equal(state.root, null);
  assert.deepEqual(state.roots, []);
});

test('raízes salvas que não existem mais somem; codeRoot antigo ainda vale', () => {
  const a = tempDir();
  const gone = path.join(a, 'nao-existe');
  const { call } = setup({ config: { codeRoots: [a, gone, 42] } });
  assert.deepEqual(call('ws:get').roots, [a]);
  const legacy = setup({ config: { codeRoot: a } });
  assert.deepEqual(legacy.call('ws:get').roots, [a]);
});

test('recentes salvos: só strings', () => {
  const a = tempDir();
  const { call } = setup({ config: { codeRoots: [a], codeRecent: [a, null, 3, '/x'] } });
  assert.deepEqual(call('ws:get').recent, [a, '/x']);
});

test('guard: caminho relativo, fora da raiz ou em pasta "irmã" com mesmo prefixo é recusado', async () => {
  const base = tempDir();
  const root = path.join(base, 'proj');
  const sibling = path.join(base, 'proj-secreto');
  write(path.join(root, 'a.txt'), 'ok');
  write(path.join(sibling, 'b.txt'), 'segredo');
  const { call } = setup({ config: { codeRoots: [root] } });
  await assert.rejects(() => call('ws:read', 'a.txt'), /error.outsideWorkspace/);
  await assert.rejects(() => call('ws:read', path.join(sibling, 'b.txt')), /error.outsideWorkspace/);
  await assert.rejects(() => call('ws:read', path.join(root, '..', 'proj-secreto', 'b.txt')), /error.outsideWorkspace/);
  await assert.rejects(() => call('ws:read', 42), /error.outsideWorkspace/);
  assert.equal(await call('ws:read', path.join(root, 'a.txt')), 'ok');
});

test('a própria raiz é legível (readDir na raiz)', async () => {
  const root = tempDir();
  write(path.join(root, 'x.md'));
  const { call } = setup({ config: { codeRoots: [root] } });
  const list = await call('ws:readDir', root);
  assert.deepEqual(list.map((e) => e.name), ['x.md']);
});

test('vault continua gravável mesmo com outras pastas abertas', async () => {
  const vault = tempDir();
  const root = tempDir();
  const { call } = setup({ vault, config: { codeRoots: [root] } });
  const file = path.join(vault, 'nota.md');
  await call('ws:write', file, 'oi');
  assert.equal(fs.readFileSync(file, 'utf8'), 'oi');
});

test('raízes só de leitura: lê, mas não grava, cria, renomeia nem apaga', async () => {
  const root = tempDir();
  const ext = tempDir();
  const file = path.join(ext, 'pkg.json');
  write(file, '{}');
  const { call } = setup({ config: { codeRoots: [root] }, readOnly: [ext] });
  assert.equal(await call('ws:read', file), '{}');
  assert.throws(() => call('ws:write', file, 'x'), /error.outsideWorkspace/);
  await assert.rejects(() => call('ws:create', path.join(ext, 'novo.txt'), false), /error.outsideWorkspace/);
  await assert.rejects(() => call('ws:rename', file, path.join(ext, 'y.json')), /error.outsideWorkspace/);
  assert.throws(() => call('ws:delete', file), /error.outsideWorkspace/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{}');
  assert.equal(trashed.length, 0);
});

test('ws:readDir esconde .git e Thumbs.db e põe pastas antes, em ordem sem caixa', async () => {
  const root = tempDir();
  write(path.join(root, 'b.txt'));
  write(path.join(root, 'A.txt'));
  write(path.join(root, 'Thumbs.db'));
  write(path.join(root, '.git', 'HEAD'));
  write(path.join(root, 'zeta', 'x'));
  write(path.join(root, 'Alfa', 'y'));
  write(path.join(root, 'node_modules', 'z'));
  const { call } = setup({ config: { codeRoots: [root] } });
  const list = await call('ws:readDir', root);
  assert.deepEqual(list.map((e) => e.name), ['Alfa', 'node_modules', 'zeta', 'A.txt', 'b.txt']);
  assert.deepEqual(list.map((e) => e.dir), [true, true, true, false, false]);
  assert.equal(list[0].path, path.join(root, 'Alfa'));
});

test('ws:listFiles percorre todas as raízes e pula node_modules e .git', async () => {
  const a = tempDir();
  const b = tempDir();
  write(path.join(a, 'src', 'index.ts'));
  write(path.join(a, 'node_modules', 'lib', 'x.js'));
  write(path.join(a, '.git', 'config'));
  write(path.join(b, 'README.md'));
  write(path.join(b, 'bower_components', 'y.js'));
  const { call } = setup({ config: { codeRoots: [a, b] } });
  const files = (await call('ws:listFiles')).sort();
  assert.deepEqual(files, [path.join(a, 'src', 'index.ts'), path.join(b, 'README.md')].sort());
});

test('ws:read: texto em UTF-8 e arquivo binário recusado', async () => {
  const root = tempDir();
  write(path.join(root, 'acento.txt'), 'ação café');
  write(path.join(root, 'img.bin'), Buffer.from([0x89, 0x50, 0x00, 0x47]));
  const { call } = setup({ config: { codeRoots: [root] } });
  assert.equal(await call('ws:read', path.join(root, 'acento.txt')), 'ação café');
  await assert.rejects(() => call('ws:read', path.join(root, 'img.bin')), /error.binaryFile/);
});

test('ws:create cria arquivo vazio com as pastas do caminho, ou pasta, e não sobrescreve', async () => {
  const root = tempDir();
  const { call } = setup({ config: { codeRoots: [root] } });
  const file = path.join(root, 'a', 'b', 'novo.ts');
  assert.equal(await call('ws:create', file, false), file);
  assert.equal(fs.readFileSync(file, 'utf8'), '');
  const dir = path.join(root, 'pasta', 'funda');
  await call('ws:create', dir, true);
  assert.ok(fs.statSync(dir).isDirectory());
  await assert.rejects(() => call('ws:create', file, false), /error.exists/);
  await assert.rejects(() => call('ws:create', dir, true), /error.exists/);
});

test('ws:rename move, recusa destino existente e não sai da raiz', async () => {
  const root = tempDir();
  const other = tempDir();
  write(path.join(root, 'a.txt'), 'A');
  write(path.join(root, 'b.txt'), 'B');
  const { call } = setup({ config: { codeRoots: [root] } });
  await assert.rejects(() => call('ws:rename', path.join(root, 'a.txt'), path.join(root, 'b.txt')), /error.exists/);
  assert.equal(fs.readFileSync(path.join(root, 'b.txt'), 'utf8'), 'B');
  await assert.rejects(() => call('ws:rename', path.join(root, 'a.txt'), path.join(other, 'a.txt')), /error.outsideWorkspace/);
  const target = path.join(root, 'sub', '..', 'c.txt');
  assert.equal(await call('ws:rename', path.join(root, 'a.txt'), target), path.join(root, 'c.txt'));
  assert.equal(fs.readFileSync(path.join(root, 'c.txt'), 'utf8'), 'A');
  assert.equal(fs.existsSync(path.join(root, 'a.txt')), false);
});

test('ws:rename: trocar só a caixa do nome é permitido no Windows', { skip: process.platform !== 'win32' && 'só no Windows' }, async () => {
  const root = tempDir();
  write(path.join(root, 'nota.md'), 'x');
  const { call } = setup({ config: { codeRoots: [root] } });
  await call('ws:rename', path.join(root, 'nota.md'), path.join(root, 'Nota.md'));
  assert.deepEqual(fs.readdirSync(root), ['Nota.md']);
});

test('ws:copy copia bytes sem sobrescrever', async () => {
  const root = tempDir();
  const bytes = Buffer.from([0, 1, 2, 255]);
  write(path.join(root, 'img.png'), bytes);
  write(path.join(root, 'existe.png'), 'velho');
  const { call } = setup({ config: { codeRoots: [root] } });
  const target = path.join(root, 'img copy.png');
  assert.equal(await call('ws:copy', path.join(root, 'img.png'), target), target);
  assert.deepEqual(fs.readFileSync(target), bytes);
  await assert.rejects(() => call('ws:copy', path.join(root, 'img.png'), path.join(root, 'existe.png')), /error.exists/);
  assert.equal(fs.readFileSync(path.join(root, 'existe.png'), 'utf8'), 'velho');
});

test('ws:delete manda para a lixeira o caminho resolvido; ws:reveal mostra na pasta', async () => {
  const root = tempDir();
  write(path.join(root, 'x.txt'));
  const { call } = setup({ config: { codeRoots: [root] } });
  await call('ws:delete', path.join(root, 'sub', '..', 'x.txt'));
  assert.deepEqual(trashed, [path.join(root, 'x.txt')]);
  call('ws:reveal', path.join(root, 'x.txt'));
  assert.deepEqual(revealed, [path.join(root, 'x.txt')]);
  assert.throws(() => call('ws:reveal', path.join(os.tmpdir(), 'fora-xyz.txt')), /error.outsideWorkspace/);
});

test('ws:setRoot só aceita pasta recente ou o vault, e grava a configuração', async () => {
  const vault = tempDir();
  const recentDir = tempDir();
  const stranger = tempDir();
  const { call, saves } = setup({ vault, config: { codeRecent: [recentDir] } });
  await assert.rejects(() => call('ws:setRoot', stranger), /error.outsideWorkspace/);
  await assert.rejects(() => call('ws:setRoot', undefined), /error.outsideWorkspace/);
  const state = await call('ws:setRoot', recentDir);
  assert.deepEqual(state.roots, [recentDir]);
  assert.deepEqual(saves.at(-1), { codeRoots: [recentDir], codeRoot: recentDir, codeRecent: [recentDir] });
  const back = await call('ws:setRoot', vault);
  assert.deepEqual(back.roots, [vault]);
  assert.deepEqual(back.recent, [vault, recentDir]);
});

test('ws:setRoot recusa recente que foi apagado do disco', async () => {
  const base = tempDir();
  const gone = path.join(base, 'apagada');
  const { call } = setup({ config: { codeRecent: [gone] } });
  await assert.rejects(() => call('ws:setRoot', gone), /error.outsideWorkspace/);
});

test('ws:addFolder soma pastas sem repetir (caixa diferente conta como a mesma) e cancelar devolve null', async () => {
  const a = tempDir();
  const b = tempDir();
  const { call, saves } = setup({ config: { codeRoots: [a] } });
  assert.equal(await call('ws:addFolder'), null);
  assert.equal(saves.length, 0);
  fakeElectron.dialog.showOpenDialog = async (_win, options) => {
    assert.ok(options.properties.includes('multiSelections'));
    return { canceled: false, filePaths: [b, a.toUpperCase()] };
  };
  const state = await call('ws:addFolder');
  assert.deepEqual(state.roots, [a, b]);
  assert.equal(state.root, a);
});

test('ws:removeFolder tira a pasta; sem pastas volta a valer o vault', async () => {
  const vault = tempDir();
  const a = tempDir();
  const b = tempDir();
  const { call } = setup({ vault, config: { codeRoots: [a, b] } });
  assert.deepEqual((await call('ws:removeFolder', a)).roots, [b]);
  const last = await call('ws:removeFolder', b);
  assert.deepEqual(last.roots, [vault]);
  assert.equal(last.root, vault);
});

test('recentes ficam limitados a 10, o mais novo primeiro', async () => {
  const dirs = Array.from({ length: 12 }, () => tempDir());
  const { call } = setup({ config: { codeRecent: dirs } });
  const state = await call('ws:setRoot', dirs[11]);
  assert.equal(state.recent.length, 10);
  assert.equal(state.recent[0], dirs[11]);
  assert.deepEqual(state.recent.slice(1), dirs.slice(0, 9));
});

test('ws:openFolder troca a raiz pela pasta escolhida', async () => {
  const a = tempDir();
  const b = tempDir();
  const { call } = setup({ config: { codeRoots: [a] } });
  fakeElectron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [b] });
  assert.deepEqual((await call('ws:openFolder')).roots, [b]);
});

test('arquivo aberto pelo diálogo vira gravável só ele, não a pasta dele', async () => {
  const root = tempDir();
  const outside = tempDir();
  const file = path.join(outside, 'solto.txt');
  const neighbor = path.join(outside, 'vizinho.txt');
  write(file, 'a');
  write(neighbor, 'b');
  const { call } = setup({ config: { codeRoots: [root] } });
  assert.throws(() => call('ws:write', file, 'x'), /error.outsideWorkspace/);
  fakeElectron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  assert.deepEqual(await call('ws:openFile'), [file]);
  await call('ws:write', file, 'novo');
  assert.equal(fs.readFileSync(file, 'utf8'), 'novo');
  assert.throws(() => call('ws:write', neighbor, 'x'), /error.outsideWorkspace/);
});

test('ws:openFile cancelado devolve lista vazia', async () => {
  const { call } = setup();
  fakeElectron.dialog.showOpenDialog = async () => ({ canceled: true, filePaths: ['x'] });
  assert.deepEqual(await call('ws:openFile'), []);
});

test('ws:saveAs libera a gravação do destino escolhido; cancelado devolve null', async () => {
  const root = tempDir();
  const outside = tempDir();
  const target = path.join(outside, 'salvo.txt');
  const { call } = setup({ config: { codeRoots: [root] } });
  assert.equal(await call('ws:saveAs'), null);
  fakeElectron.dialog.showSaveDialog = async (_win, options) => {
    assert.equal(options.defaultPath, root);
    return { canceled: false, filePath: target };
  };
  assert.equal(await call('ws:saveAs'), target);
  await call('ws:write', target, 'ok');
  assert.equal(fs.readFileSync(target, 'utf8'), 'ok');
});

function searchFixture() {
  const root = tempDir();
  write(path.join(root, 'src', 'a.ts'), 'const foo = 1;\nfoo();\n');
  write(path.join(root, 'src', 'b.js'), 'let Foo = foo;\n');
  write(path.join(root, 'docs', 'leia.md'), 'nada aqui\n');
  write(path.join(root, 'node_modules', 'x', 'index.js'), 'foo foo foo\n');
  write(path.join(root, 'bin.dat'), Buffer.from([0x66, 0x6f, 0x6f, 0x00]));
  return root;
}

test('ws:search acha em todos os arquivos de texto, pula binário e node_modules', async () => {
  const root = searchFixture();
  const { call } = setup({ config: { codeRoots: [root] } });
  const result = await call('ws:search', { query: 'foo' });
  assert.equal(result.cancelled, false);
  assert.equal(result.truncated, false);
  assert.equal(result.total, 4);
  assert.equal(result.files, 3);
  const byFile = Object.fromEntries(result.results.map((r) => [path.relative(root, r.path).split(path.sep).join('/'), r.matches.length]));
  assert.deepEqual(byFile, { 'src/a.ts': 2, 'src/b.js': 2 });
});

test('ws:search respeita diferenciar caixa e palavra inteira', async () => {
  const root = searchFixture();
  const { call } = setup({ config: { codeRoots: [root] } });
  assert.equal((await call('ws:search', { query: 'Foo', matchCase: true })).total, 1);
  write(path.join(root, 'src', 'c.ts'), 'foobar barfoo\n');
  assert.equal((await call('ws:search', { query: 'foo', wholeWord: true })).total, 4);
});

test('ws:search com incluir/excluir por glob relativo à raiz', async () => {
  const root = searchFixture();
  const { call } = setup({ config: { codeRoots: [root] } });
  const onlyTs = await call('ws:search', { query: 'foo', include: '*.ts' });
  assert.deepEqual(onlyTs.results.map((r) => path.basename(r.path)), ['a.ts']);
  const noSrc = await call('ws:search', { query: 'foo', exclude: 'src' });
  assert.equal(noSrc.total, 0);
  const noJs = await call('ws:search', { query: 'foo', exclude: '*.js' });
  assert.deepEqual(noJs.results.map((r) => path.basename(r.path)), ['a.ts']);
});

test('ws:search limitado por maxResults marca truncated', async () => {
  const root = searchFixture();
  const { call } = setup({ config: { codeRoots: [root] } });
  const result = await call('ws:search', { query: 'foo', maxResults: 3 });
  assert.equal(result.total, 3);
  assert.equal(result.truncated, true);
});

test('ws:search em uma pasta: só dentro das raízes', async () => {
  const root = searchFixture();
  const outside = tempDir();
  write(path.join(outside, 'z.ts'), 'foo');
  const { call } = setup({ config: { codeRoots: [root] } });
  const inDocs = await call('ws:search', { query: 'foo', folder: path.join(root, 'src') });
  assert.equal(inDocs.total, 4);
  await assert.rejects(() => call('ws:search', { query: 'foo', folder: outside }), /error.outsideWorkspace/);
});

test('ws:search: pasta só de leitura não serve de base de busca', async () => {
  const root = searchFixture();
  const ext = tempDir();
  write(path.join(ext, 'z.ts'), 'foo');
  const { call } = setup({ config: { codeRoots: [root] }, readOnly: [ext] });
  await assert.rejects(() => call('ws:search', { query: 'foo', folder: ext }), /error.outsideWorkspace/);
});

test('ws:search com consulta vazia ou expressão inválida lança erro', async () => {
  const root = searchFixture();
  const { call } = setup({ config: { codeRoots: [root] } });
  await assert.rejects(() => call('ws:search', { query: '' }));
  await assert.rejects(() => call('ws:search', { query: '(', isRegex: true }));
});

test('ws:search: busca superada por outra não devolve resultados', async () => {
  const root = searchFixture();
  const { call } = setup({ config: { codeRoots: [root] } });
  const first = call('ws:search', { query: 'foo' });
  const second = call('ws:search', { query: 'foo' });
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a.results, []);
  assert.equal(b.total, 4);
});

test('ws:replace troca nos arquivos pedidos, conta e lista falhas fora da raiz', async () => {
  const root = searchFixture();
  const outside = tempDir();
  const foreign = path.join(outside, 'f.ts');
  write(foreign, 'foo');
  const { call } = setup({ config: { codeRoots: [root] } });
  const a = path.join(root, 'src', 'a.ts');
  const b = path.join(root, 'src', 'b.js');
  const docs = path.join(root, 'docs', 'leia.md');
  const result = await call('ws:replace', { query: 'foo' }, 'bar', [a, b, docs, foreign]);
  assert.equal(result.count, 4);
  assert.deepEqual(result.changed, [a, b]);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].path, foreign);
  assert.match(result.failed[0].reason, /error.outsideWorkspace/);
  assert.equal(fs.readFileSync(a, 'utf8'), 'const bar = 1;\nbar();\n');
  assert.equal(fs.readFileSync(b, 'utf8'), 'let bar = bar;\n');
  assert.equal(fs.readFileSync(foreign, 'utf8'), 'foo');
});

test('ws:replace com expressão regular usa grupos; sem lista não faz nada', async () => {
  const root = tempDir();
  const file = path.join(root, 'x.txt');
  write(file, 'nome: Ana\r\nnome: Bia\r\n');
  const { call } = setup({ config: { codeRoots: [root] } });
  const result = await call('ws:replace', { query: 'nome: (\\w+)', isRegex: true }, '$1 <- nome', [file]);
  assert.equal(result.count, 2);
  assert.equal(fs.readFileSync(file, 'utf8'), 'Ana <- nome\r\nBia <- nome\r\n');
  assert.deepEqual(await call('ws:replace', { query: 'x' }, 'y', 'nao-e-lista'), { count: 0, changed: [], failed: [] });
});

test('ws:replace não mexe em arquivo binário', async () => {
  const root = tempDir();
  const file = path.join(root, 'b.dat');
  const bytes = Buffer.from([0x66, 0x6f, 0x6f, 0x00]);
  write(file, bytes);
  const { call } = setup({ config: { codeRoots: [root] } });
  const result = await call('ws:replace', { query: 'foo' }, 'bar', [file]);
  assert.equal(result.count, 0);
  assert.deepEqual(fs.readFileSync(file), bytes);
});

test('ws:stat dá os dados do arquivo; ws:stat e ws:realpath devolvem null fora da raiz e quando não existe', async () => {
  const root = tempDir();
  write(path.join(root, 'a.txt'), '12345');
  write(path.join(root, 'dir', 'x'));
  const { call } = setup({ config: { codeRoots: [root] } });
  const stat = await call('ws:stat', path.join(root, 'a.txt'));
  assert.equal(stat.dir, false);
  assert.equal(stat.size, 5);
  assert.equal(typeof stat.mtime, 'number');
  assert.equal((await call('ws:stat', path.join(root, 'dir'))).dir, true);
  assert.equal(await call('ws:stat', path.join(root, 'nada.txt')), null);
  assert.equal(await call('ws:stat', path.join(os.tmpdir(), 'fora.txt')), null);
  assert.equal(await call('ws:realpath', path.join(root, 'nada.txt')), null);
  assert.equal(await call('ws:realpath', path.join(os.tmpdir(), 'fora.txt')), null);
});

test(
  'ws:realpath devolve a grafia real do disco',
  async () => {
    const root = tempDir();
    write(path.join(root, 'Arquivo.txt'), 'x');
    const { call } = setup({ config: { codeRoots: [root] } });
    const asked = process.platform === 'win32' ? path.join(root, 'arquivo.txt') : path.join(root, 'Arquivo.txt');
    assert.equal(await call('ws:realpath', asked), path.join(root, 'Arquivo.txt'));
  },
);

test('vigia avisa o renderer, em lote, das pastas que mudaram', async () => {
  const root = tempDir();
  const sent = [];
  const win = { webContents: { send: (channel, payload) => sent.push([channel, payload]) } };
  const { call } = setup({ config: { codeRoots: [root] }, win });
  call('ws:get');
  await new Promise((resolve) => setTimeout(resolve, 100));
  write(path.join(root, 'novo.txt'), 'x');
  const deadline = Date.now() + 4000;
  while (!sent.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(sent.length, 'ws:changed enviado');
  assert.equal(sent[0][0], 'ws:changed');
  assert.ok(sent[0][1].includes(path.join(root, 'novo.txt')));
});
