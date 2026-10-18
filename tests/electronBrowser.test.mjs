// Processo principal do navegador embutido (electron/browser.cjs): histórico, favoritos, permissões,
// downloads, segurança das guias, atalhos e menu de contexto. 'electron' é trocado por um stub.
// Rodar com `npm test`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';

import { BROWSER_SHORTCUTS } from '../src/lib/browser.ts';

const require = createRequire(import.meta.url);
const { translator } = require('../electron/i18n.cjs');

// Estado trocado a cada setup(): o módulo desestrutura o stub uma vez só, no carregamento.
let ctx;
const fakeElectron = {
  app: {
    getPath: (name) => path.join(ctx.base, name),
    on: (event, fn) => ctx.appEvents.set(event, fn),
  },
  clipboard: { writeText: (text) => ctx.clipboard.push(text) },
  desktopCapturer: { getSources: async () => [{ id: 'screen:1' }] },
  dialog: {
    showSaveDialog: (...args) => ctx.dialog.showSaveDialog(...args),
    showOpenDialog: (...args) => ctx.dialog.showOpenDialog(...args),
  },
  ipcMain: { handle: (channel, fn) => ctx.handlers.set(channel, fn) },
  Menu: { buildFromTemplate: (template) => (ctx.menus.push(template), { popup: () => {} }) },
  session: { fromPartition: (name) => ctx.sessions.get(name) ?? ctx.sessions.set(name, fakeSession(name)).get(name) },
  shell: { openPath: async (p) => (ctx.opened.push(p), ''), showItemInFolder: (p) => ctx.shown.push(p) },
  webContents: { fromId: (id) => ctx.guests.get(id) },
};

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return fakeElectron;
  return originalLoad.call(this, request, ...rest);
};
const browserMain = require('../electron/browser.cjs');
Module._load = originalLoad;
const { registerBrowserIpc, NORMAL_PARTITION, INCOGNITO_PARTITION } = browserMain;

function fakeSession(name) {
  const events = new Map();
  return {
    name,
    userAgent: null,
    spell: null,
    cleared: [],
    downloads: [],
    availableSpellCheckerLanguages: ['en-US', 'fr', 'pt-BR'],
    getUserAgent: () => 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) flintpad/0.2.0 Chrome/130.0.0.0 Electron/33.2.0 Safari/537.36',
    setUserAgent(ua) {
      this.userAgent = ua;
    },
    setSpellCheckerLanguages(list) {
      this.spell = list;
    },
    setPermissionRequestHandler(fn) {
      this.requestHandler = fn;
    },
    setPermissionCheckHandler(fn) {
      this.checkHandler = fn;
    },
    setDisplayMediaRequestHandler(fn) {
      this.displayHandler = fn;
    },
    on: (event, fn) => events.set(event, fn),
    emit: (event, ...args) => events.get(event)(...args),
    async clearStorageData() {
      this.cleared.push('storage');
    },
    async clearCache() {
      this.cleared.push('cache');
    },
    downloadURL(url) {
      this.downloads.push(url);
    },
  };
}

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

function setup({ base } = {}) {
  const dir = base ?? fs.mkdtempSync(path.join(os.tmpdir(), 'flintpad-br-'));
  ctx = {
    base: dir,
    appEvents: new Map(),
    handlers: new Map(),
    sessions: new Map(),
    menus: [],
    clipboard: [],
    opened: [],
    shown: [],
    guests: new Map(),
    sent: [],
    dialog: { showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  };
  const win = { isDestroyed: () => false, webContents: { send: (channel, ...args) => ctx.sent.push([channel, ...args]) } };
  const api = registerBrowserIpc({ getWin: () => win, getT: () => translator('pt-BR') });
  const local = ctx;
  if (!base) cleanups.push(async () => {
    await api.flush();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const call = (channel, ...args) => local.handlers.get(channel)({}, ...args);
  return { api, call, ctx: local, dir, normal: local.sessions.get(NORMAL_PARTITION), incognito: local.sessions.get(INCOGNITO_PARTITION) };
}

/** Guia <webview> falsa, criada pelo evento web-contents-created. */
function fakeGuest(env, { incognito = false, id = 7, url = 'https://exemplo.dev/pagina' } = {}) {
  const events = new Map();
  const calls = [];
  const contents = {
    id,
    session: incognito ? env.incognito : env.normal,
    getType: () => 'webview',
    getURL: () => url,
    getTitle: () => 'Título: com/barras?',
    isDestroyed: () => false,
    on: (event, fn) => events.set(event, fn),
    setWindowOpenHandler(fn) {
      this.openHandler = fn;
    },
    navigationHistory: { canGoBack: () => true, canGoForward: () => false, goBack: () => calls.push('back'), goForward: () => calls.push('forward') },
    reload: () => calls.push('reload'),
    print: () => calls.push('print'),
    downloadURL: (u) => calls.push(['download', u]),
    copyImageAt: () => calls.push('copyImage'),
    inspectElement: (x, y) => calls.push(['inspect', x, y]),
    replaceMisspelling: (w) => calls.push(['replace', w]),
    emit: (event, ...args) => events.get(event)(...args),
    calls,
  };
  env.ctx.appEvents.get('web-contents-created')({}, contents);
  env.ctx.guests.set(id, contents);
  return contents;
}

const pageParams = (extra = {}) => ({
  x: 10,
  y: 20,
  linkURL: '',
  srcURL: '',
  mediaType: 'none',
  isEditable: false,
  selectionText: '',
  misspelledWord: '',
  dictionarySuggestions: [],
  editFlags: { canUndo: true, canRedo: false, canCut: true, canCopy: true, canPaste: false },
  ...extra,
});
const labels = (template) => template.map((item) => (item.type === 'separator' ? '—' : item.label));

test('as duas sessões: agente sem Electron/flintpad e corretor só com línguas disponíveis', () => {
  const { normal, incognito } = setup();
  for (const ses of [normal, incognito]) {
    assert.equal(ses.userAgent, 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36');
    assert.deepEqual(ses.spell, ['pt-BR', 'en-US']);
    assert.equal(typeof ses.requestHandler, 'function');
  }
  assert.notEqual(NORMAL_PARTITION, INCOGNITO_PARTITION);
  assert.match(NORMAL_PARTITION, /^persist:/);
  assert.doesNotMatch(INCOGNITO_PARTITION, /^persist:/);
});

test('history:add aceita só http(s) e file, e põe a visita no topo', () => {
  const { call } = setup();
  call('browser:history:add', null);
  call('browser:history:add', { url: 'javascript:alert(1)', title: 'x', time: 1 });
  call('browser:history:add', { url: 'flintpad://newtab', title: 'x', time: 1 });
  call('browser:history:add', { url: 'https://a.dev/', title: 'A', time: 1 });
  call('browser:history:add', { url: 'file:///C:/x.pdf', time: 2 });
  call('browser:history:add', { url: 'http://b.dev/', title: 'B', time: 3 });
  assert.deepEqual(call('browser:history:list'), [
    { url: 'http://b.dev/', title: 'B', time: 3 },
    { url: 'file:///C:/x.pdf', title: '', time: 2 },
    { url: 'https://a.dev/', title: 'A', time: 1 },
  ]);
});

test('history:add: recarregar a mesma página só atualiza título e hora', () => {
  const { call } = setup();
  call('browser:history:add', { url: 'https://a.dev/', title: 'Carregando', time: 1 });
  call('browser:history:add', { url: 'https://a.dev/', title: 'A de verdade', time: 5 });
  call('browser:history:add', { url: 'https://a.dev/', title: '', time: 9 });
  assert.deepEqual(call('browser:history:list'), [{ url: 'https://a.dev/', title: 'A de verdade', time: 9 }]);
});

test('history:add sem hora usa a hora atual', () => {
  const { call } = setup();
  const before = Date.now();
  call('browser:history:add', { url: 'https://a.dev/', title: 'A' });
  const [visit] = call('browser:history:list');
  assert.ok(visit.time >= before && visit.time <= Date.now());
});

test(
  'history:add: recarregar sem hora também mantém uma hora numérica',
  { todo: 'BUG: electron/browser.cjs:328 copia visit.time cru ao recarregar a mesma URL (sem o `Number(...) || Date.now()` do ramo de visita nova); a visita fica com time undefined' },
  () => {
    const { call } = setup();
    call('browser:history:add', { url: 'https://a.dev/', title: 'A', time: 1 });
    call('browser:history:add', { url: 'https://a.dev/', title: 'A' });
    assert.equal(typeof call('browser:history:list')[0].time, 'number');
  },
);

test('history:add guarda no máximo 5000 visitas', () => {
  const { call } = setup();
  for (let i = 0; i < 5005; i++) call('browser:history:add', { url: `https://s${i}.dev/`, title: '', time: i });
  const list = call('browser:history:list');
  assert.equal(list.length, 5000);
  assert.equal(list[0].url, 'https://s5004.dev/');
});

test('history:remove tira uma visita (url + hora) ou todas da url; clear esvazia', () => {
  const { call } = setup();
  call('browser:history:add', { url: 'https://a.dev/', title: 'A', time: 1 });
  call('browser:history:add', { url: 'https://b.dev/', title: 'B', time: 2 });
  call('browser:history:add', { url: 'https://a.dev/', title: 'A', time: 3 });
  call('browser:history:remove', 'https://a.dev/', 1);
  assert.deepEqual(call('browser:history:list').map((v) => v.time), [3, 2]);
  call('browser:history:remove', 'https://a.dev/');
  assert.deepEqual(call('browser:history:list').map((v) => v.url), ['https://b.dev/']);
  call('browser:history:clear');
  assert.deepEqual(call('browser:history:list'), []);
});

test('bookmarks:save limpa a lista: sem url sai, campos extras somem, tudo vira texto', () => {
  const { call } = setup();
  call('browser:bookmarks:save', [{ id: 1, url: 'https://a.dev/', title: 'A', evil: true }, null, { id: '2', title: 'sem url' }, { id: '3', url: 'https://c.dev/' }]);
  assert.deepEqual(call('browser:bookmarks:list'), [
    { id: '1', url: 'https://a.dev/', title: 'A' },
    { id: '3', url: 'https://c.dev/', title: '' },
  ]);
  call('browser:bookmarks:save', 'nao-e-lista');
  assert.deepEqual(call('browser:bookmarks:list'), []);
});

test('flush grava os JSON em userData/browser e a próxima execução os lê', async () => {
  const first = setup();
  first.call('browser:history:add', { url: 'https://a.dev/', title: 'A', time: 1 });
  first.call('browser:bookmarks:save', [{ id: 'x', url: 'https://b.dev/', title: 'B' }]);
  first.call('browser:settings:set', { askWhereToSave: true });
  await first.api.flush();
  const dir = path.join(first.dir, 'userData', 'browser');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'history.json'), 'utf8')), [{ url: 'https://a.dev/', title: 'A', time: 1 }]);
  assert.equal(fs.existsSync(path.join(dir, 'history.json.tmp')), false);
  const second = setup({ base: first.dir });
  assert.deepEqual(second.call('browser:bookmarks:list'), [{ id: 'x', url: 'https://b.dev/', title: 'B' }]);
  assert.deepEqual(second.call('browser:settings:get'), { askWhereToSave: true });
  assert.equal(second.call('browser:history:list').length, 1);
});

test('JSON corrompido no disco volta ao padrão', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'flintpad-br-'));
  cleanups.push(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.mkdirSync(path.join(base, 'userData', 'browser'), { recursive: true });
  fs.writeFileSync(path.join(base, 'userData', 'browser', 'history.json'), '{quebrado');
  fs.writeFileSync(path.join(base, 'userData', 'browser', 'settings.json'), '');
  const { call } = setup({ base });
  assert.deepEqual(call('browser:history:list'), []);
  assert.deepEqual(call('browser:settings:get'), { askWhereToSave: false });
});

test('settings:set só aceita askWhereToSave, como booleano', () => {
  const { call } = setup();
  call('browser:settings:set', { askWhereToSave: 'sim', outro: 1 });
  assert.deepEqual(call('browser:settings:get'), { askWhereToSave: true });
  call('browser:settings:set', null);
  assert.deepEqual(call('browser:settings:get'), { askWhereToSave: false });
});

test('permissões: as do Chrome sem pergunta são liberadas na hora', () => {
  const { normal, ctx } = setup();
  const answers = [];
  for (const permission of ['fullscreen', 'clipboard-sanitized-write', 'pointerLock']) normal.requestHandler({ getURL: () => 'https://a.dev/' }, permission, (ok) => answers.push(ok), {});
  assert.deepEqual(answers, [true, true, true]);
  assert.equal(ctx.sent.length, 0);
  assert.equal(normal.checkHandler(null, 'fullscreen', 'https://a.dev'), true);
  assert.equal(normal.checkHandler(null, 'geolocation', 'https://a.dev'), false);
});

test('permissões: pergunta ao renderer com a origem e lembra a resposta', async () => {
  const { normal, call, ctx } = setup();
  const answers = [];
  normal.requestHandler({ id: 3, getURL: () => 'https://mapa.dev/x' }, 'geolocation', (ok) => answers.push(ok), { requestingUrl: 'https://mapa.dev/rota?a=1' });
  const [channel, ask] = ctx.sent.at(-1);
  assert.equal(channel, 'browser:permission');
  assert.deepEqual({ ...ask, id: undefined }, { id: undefined, webContentsId: 3, origin: 'https://mapa.dev', permission: 'geolocation' });
  call('browser:permission:reply', ask.id, true, true, ask.origin, ask.permission);
  assert.deepEqual(answers, [true]);
  assert.deepEqual(call('browser:permission:list'), { 'https://mapa.dev': { geolocation: 'allow' } });
  assert.equal(normal.checkHandler(null, 'geolocation', 'https://mapa.dev'), true);
  // Segunda vez: responde sozinho, sem perguntar.
  const sentBefore = ctx.sent.length;
  normal.requestHandler({ id: 3, getURL: () => 'https://mapa.dev/' }, 'geolocation', (ok) => answers.push(ok), {});
  assert.deepEqual(answers, [true, true]);
  assert.equal(ctx.sent.length, sentBefore);
});

test('permissões: negar e lembrar recusa da próxima vez; sem lembrar não grava', () => {
  const { normal, call, ctx } = setup();
  const answers = [];
  normal.requestHandler({ id: 1, getURL: () => 'https://a.dev/' }, 'notifications', (ok) => answers.push(ok), {});
  call('browser:permission:reply', ctx.sent.at(-1)[1].id, false, false, 'https://a.dev', 'notifications');
  assert.deepEqual(call('browser:permission:list'), {});
  normal.requestHandler({ id: 1, getURL: () => 'https://a.dev/' }, 'notifications', (ok) => answers.push(ok), {});
  call('browser:permission:reply', ctx.sent.at(-1)[1].id, false, true, 'https://a.dev', 'notifications');
  normal.requestHandler({ id: 1, getURL: () => 'https://a.dev/' }, 'notifications', (ok) => answers.push(ok), {});
  assert.deepEqual(answers, [false, false, false]);
  assert.doesNotThrow(() => call('browser:permission:reply', 999, true, false));
});

test('permissões: câmera/microfone viram "media:..." na pergunta e são lembrados como "media"', () => {
  const { normal, call, ctx } = setup();
  normal.requestHandler({ id: 1, getURL: () => 'https://meet.dev/' }, 'media', () => {}, { mediaTypes: ['audio', 'video'] });
  const ask = ctx.sent.at(-1)[1];
  assert.equal(ask.permission, 'media:audio+video');
  call('browser:permission:reply', ask.id, true, true, ask.origin, ask.permission);
  assert.deepEqual(call('browser:permission:list'), { 'https://meet.dev': { media: 'allow' } });
  const answers = [];
  normal.requestHandler({ id: 1, getURL: () => 'https://meet.dev/' }, 'media', (ok) => answers.push(ok), { mediaTypes: ['video'] });
  assert.deepEqual(answers, [true]);
});

test('permissões: URL inválida vira origem vazia', () => {
  const { normal, ctx } = setup();
  normal.requestHandler({ id: 1, getURL: () => 'nao é url' }, 'geolocation', () => {}, {});
  assert.equal(ctx.sent.at(-1)[1].origin, '');
});

test('permission:reset tira um site ou todos', () => {
  const { normal, call, ctx } = setup();
  for (const origin of ['https://a.dev', 'https://b.dev']) {
    normal.requestHandler({ id: 1, getURL: () => `${origin}/` }, 'geolocation', () => {}, {});
    call('browser:permission:reply', ctx.sent.at(-1)[1].id, true, true, origin, 'geolocation');
  }
  call('browser:permission:reset', 'https://a.dev');
  assert.deepEqual(Object.keys(call('browser:permission:list')), ['https://b.dev']);
  call('browser:permission:reset');
  assert.deepEqual(call('browser:permission:list'), {});
});

test('compartilhar tela pergunta como permissão e recusa devolve objeto vazio', async () => {
  const { normal, call, ctx } = setup();
  const results = [];
  normal.displayHandler({ securityOrigin: 'https://meet.dev', audioRequested: true }, (r) => results.push(r));
  const ask = ctx.sent.at(-1)[1];
  assert.equal(ask.permission, 'display-capture');
  assert.equal(ask.origin, 'https://meet.dev');
  await call('browser:permission:reply', ask.id, true, false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(results, [{ video: { id: 'screen:1' }, audio: 'loopback' }]);
  normal.displayHandler({ securityOrigin: 'https://meet.dev' }, (r) => results.push(r));
  call('browser:permission:reply', ctx.sent.at(-1)[1].id, false, false);
  assert.deepEqual(results[1], {});
});

test('will-attach-webview: só as partições do navegador, sem preload nem Node', () => {
  const env = setup();
  const events = new Map();
  env.ctx.appEvents.get('web-contents-created')({}, { on: (e, fn) => events.set(e, fn), getType: () => 'window' });
  let prevented = false;
  events.get('will-attach-webview')({ preventDefault: () => (prevented = true) }, {}, { partition: 'persist:outra', src: 'https://a.dev' });
  assert.equal(prevented, true);
  const prefs = { preload: 'x.js', nodeIntegration: true, contextIsolation: false, sandbox: false, webSecurity: false };
  const params = { partition: NORMAL_PARTITION, src: 'javascript:alert(1)' };
  events.get('will-attach-webview')({ preventDefault: () => assert.fail('não devia barrar') }, prefs, params);
  assert.deepEqual(prefs, { nodeIntegration: false, nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true, webSecurity: true });
  assert.equal(params.src, 'about:blank');
  const ok = { partition: INCOGNITO_PARTITION, src: 'https://a.dev/' };
  events.get('will-attach-webview')({ preventDefault: () => assert.fail() }, {}, ok);
  assert.equal(ok.src, 'https://a.dev/');
});

test('janelas novas: popup com tamanho é permitido na mesma partição; o resto vira guia', () => {
  const env = setup();
  const guest = fakeGuest(env, { incognito: true });
  const popup = guest.openHandler({ url: 'https://login.dev/', disposition: 'new-window', features: 'width=500' });
  assert.equal(popup.action, 'allow');
  assert.equal(popup.overrideBrowserWindowOptions.webPreferences.partition, INCOGNITO_PARTITION);
  assert.equal(popup.overrideBrowserWindowOptions.webPreferences.sandbox, true);
  const tab = guest.openHandler({ url: 'https://b.dev/', disposition: 'background-tab', features: '' });
  assert.deepEqual(tab, { action: 'deny' });
  assert.deepEqual(env.ctx.sent.at(-1), ['browser:open', { url: 'https://b.dev/', background: true, incognito: true, from: 7 }]);
});

test('teclas dentro da página: atalhos do navegador são tomados; Esc passa e também avisa', () => {
  const env = setup();
  const guest = fakeGuest(env);
  const press = (input) => {
    let prevented = false;
    guest.emit('before-input-event', { preventDefault: () => (prevented = true) }, { type: 'keyDown', ...input });
    return prevented;
  };
  assert.equal(press({ key: 't', control: true }), true);
  assert.deepEqual(env.ctx.sent.at(-1), ['browser:shortcut', { webContentsId: 7, combo: 'Ctrl+T' }]);
  assert.equal(press({ key: '+', meta: true }), true);
  assert.equal(env.ctx.sent.at(-1)[1].combo, 'Ctrl+=');
  assert.equal(press({ key: 'Escape' }), false);
  assert.equal(env.ctx.sent.at(-1)[1].combo, 'Escape');
  const before = env.ctx.sent.length;
  assert.equal(press({ key: 'a' }), false);
  assert.equal(press({ key: 'b', control: true }), false);
  guest.emit('before-input-event', { preventDefault: () => assert.fail() }, { type: 'keyUp', key: 't', control: true });
  assert.equal(env.ctx.sent.length, before);
});

test('todos os atalhos de src/lib/browser.ts são atendidos dentro da página', () => {
  const env = setup();
  const guest = fakeGuest(env);
  for (const combo of BROWSER_SHORTCUTS) {
    const parts = combo.split('+');
    const key = parts.pop() || '+';
    let prevented = false;
    guest.emit('before-input-event', { preventDefault: () => (prevented = true) }, { type: 'keyDown', key: key.length === 1 ? key.toLowerCase() : key, control: parts.includes('Ctrl'), shift: parts.includes('Shift'), alt: parts.includes('Alt') });
    assert.ok(prevented, combo);
  }
});

test('lista de atalhos do processo principal é a mesma de src/lib/browser.ts', () => {
  const text = fs.readFileSync(new URL('../electron/browser.cjs', import.meta.url), 'utf8');
  const block = /const SHORTCUTS = new Set\(\[([\s\S]*?)\]\);/.exec(text)[1];
  const main = new Set([...block.matchAll(/'([^']+)'/g)].map((m) => m[1]));
  assert.deepEqual([...main].sort(), [...BROWSER_SHORTCUTS].sort());
});

test('menu de contexto em página vazia: voltar, avançar, recarregar, salvar, imprimir, código-fonte, inspecionar', () => {
  const env = setup();
  const guest = fakeGuest(env);
  guest.emit('context-menu', {}, pageParams());
  const template = env.ctx.menus.at(-1);
  assert.deepEqual(labels(template), ['Voltar', 'Avançar', 'Recarregar', '—', 'Salvar como…', 'Imprimir…', 'Ver código-fonte da página', '—', 'Inspecionar']);
  assert.equal(template[0].enabled, true);
  assert.equal(template[1].enabled, false);
  template.find((i) => i.label === 'Ver código-fonte da página').click();
  assert.deepEqual(env.ctx.sent.at(-1), ['browser:open', { url: 'view-source:https://exemplo.dev/pagina', background: false, incognito: false, from: 7 }]);
  template.at(-1).click();
  assert.deepEqual(guest.calls.at(-1), ['inspect', 10, 20]);
});

test('menu de contexto em link: abrir em guia (em segundo plano), anônima, salvar e copiar', () => {
  const env = setup();
  const guest = fakeGuest(env);
  guest.emit('context-menu', {}, pageParams({ linkURL: 'https://link.dev/' }));
  const template = env.ctx.menus.at(-1);
  assert.equal(template[0].type, undefined);
  assert.equal(labels(template).filter((l) => l === '—').length, 1);
  template[0].click();
  assert.equal(env.ctx.sent.at(-1)[1].background, true);
  template[1].click();
  assert.equal(env.ctx.sent.at(-1)[1].incognito, true);
  template[2].click();
  assert.deepEqual(guest.calls.at(-1), ['download', 'https://link.dev/']);
  template[3].click();
  assert.deepEqual(env.ctx.clipboard, ['https://link.dev/']);
});

test('menu de contexto em imagem e em vídeo', () => {
  const env = setup();
  const guest = fakeGuest(env);
  guest.emit('context-menu', {}, pageParams({ mediaType: 'image', srcURL: 'https://img.dev/a.png' }));
  assert.equal(env.ctx.menus.at(-1).length, 6); // 4 de imagem + separador + inspecionar
  env.ctx.menus.at(-1)[2].click();
  assert.equal(guest.calls.at(-1), 'copyImage');
  guest.emit('context-menu', {}, pageParams({ mediaType: 'video', srcURL: 'https://v.dev/a.mp4' }));
  const video = env.ctx.menus.at(-1);
  assert.equal(video.length, 5);
  video[2].click();
  assert.equal(env.ctx.clipboard.at(-1), 'https://v.dev/a.mp4');
});

test('menu de contexto em campo editável com erro de ortografia', () => {
  const env = setup();
  const guest = fakeGuest(env);
  guest.emit('context-menu', {}, pageParams({ isEditable: true, misspelledWord: 'caza', dictionarySuggestions: ['casa', 'caça', 'cazá', 'caza1', 'caza2', 'caza3'] }));
  const template = env.ctx.menus.at(-1);
  assert.deepEqual(labels(template).slice(0, 6), ['casa', 'caça', 'cazá', 'caza1', 'caza2', 'Adicionar ao dicionário']);
  template[0].click();
  assert.deepEqual(guest.calls.at(-1), ['replace', 'casa']);
  const paste = template.find((i) => i.role === 'paste');
  assert.equal(paste.enabled, false);
  assert.equal(template.find((i) => i.role === 'undo').enabled, true);
  guest.emit('context-menu', {}, pageParams({ isEditable: true, misspelledWord: 'xyzw', dictionarySuggestions: [] }));
  const none = env.ctx.menus.at(-1);
  assert.equal(none[0].enabled, false);
  assert.equal(none[0].label, translator('pt-BR')('browser.ctx.noSuggestions'));
});

test('menu de contexto em texto selecionado: buscar com o texto encurtado a 30 caracteres', () => {
  const env = setup();
  const guest = fakeGuest(env, { incognito: true });
  const long = '   ' + 'a'.repeat(40) + '  ';
  guest.emit('context-menu', {}, pageParams({ selectionText: long }));
  const template = env.ctx.menus.at(-1);
  const search = template[1];
  assert.equal(search.label, translator('pt-BR')('browser.ctx.search', { text: `${'a'.repeat(30)}…` }));
  search.click();
  assert.deepEqual(env.ctx.sent.at(-1), ['browser:search', { text: 'a'.repeat(40), incognito: true, from: 7 }]);
});

test('download sem perguntar: salva em Downloads com nome único', () => {
  const env = setup();
  const downloads = path.join(env.dir, 'downloads');
  fs.mkdirSync(downloads, { recursive: true });
  fs.writeFileSync(path.join(downloads, 'relatorio.pdf'), 'x');
  fs.writeFileSync(path.join(downloads, 'relatorio (1).pdf'), 'x');
  const item = fakeDownload('relatorio.pdf');
  env.normal.emit('will-download', {}, item);
  assert.equal(item.savePath, path.join(downloads, 'relatorio (2).pdf'));
  assert.equal(env.ctx.sent.at(-1)[0], 'browser:download');
  assert.equal(env.ctx.sent.at(-1)[1].filename, 'relatorio (2).pdf');
});

test('download com "perguntar onde salvar" abre o diálogo com nome sugerido', () => {
  const env = setup();
  env.call('browser:settings:set', { askWhereToSave: true });
  const item = fakeDownload('foto.png');
  env.normal.emit('will-download', {}, item);
  assert.equal(item.savePath, '');
  assert.equal(item.dialogOptions.defaultPath, path.join(env.dir, 'downloads', 'foto.png'));
  assert.equal(item.dialogOptions.title, 'Salvar download');
});

test('download concluído entra no registro; o da janela anônima não', () => {
  const env = setup();
  const done = fakeDownload('a.zip');
  env.normal.emit('will-download', {}, done);
  done.state = 'completed';
  done.events.get('done')({}, 'completed');
  const secret = fakeDownload('b.zip');
  env.incognito.emit('will-download', {}, secret);
  secret.state = 'completed';
  secret.events.get('done')({}, 'completed');
  const log = env.call('browser:downloads:list');
  assert.ok(log.some((d) => d.filename === 'a.zip' && d.state === 'completed'));
  const logged = env.call('browser:downloads:list').filter((d) => d.finished);
  assert.deepEqual(logged.map((d) => d.filename), ['a.zip']);
});

test('downloads:action pausa, retoma, remove do registro e tenta de novo pela sessão normal', async () => {
  const env = setup();
  const item = fakeDownload('a.zip');
  env.normal.emit('will-download', {}, item);
  const { id } = env.ctx.sent.at(-1)[1];
  env.call('browser:downloads:action', id, 'pause');
  assert.equal(item.paused, true);
  assert.equal(env.ctx.sent.at(-1)[1].state, 'paused');
  env.call('browser:downloads:action', id, 'resume');
  assert.equal(item.paused, false);
  item.state = 'completed';
  item.events.get('done')({}, 'completed');
  env.call('browser:downloads:action', id, 'retry');
  assert.deepEqual(env.normal.downloads, ['https://arquivos.dev/a.zip']);
  await env.call('browser:downloads:action', id, 'open');
  assert.equal(env.ctx.opened.length, 1);
  env.call('browser:downloads:action', id, 'remove');
  assert.equal(env.call('browser:downloads:list').filter((d) => d.finished).length, 0);
});

test('clearData limpa só o que foi pedido; endIncognito limpa a sessão anônima', async () => {
  const env = setup();
  env.call('browser:history:add', { url: 'https://a.dev/', title: 'A', time: 1 });
  await env.call('browser:clearData', { cache: true });
  assert.deepEqual(env.normal.cleared, ['cache']);
  assert.equal(env.call('browser:history:list').length, 1);
  await env.call('browser:clearData', { history: true, cookies: true });
  assert.deepEqual(env.call('browser:history:list'), []);
  assert.deepEqual(env.normal.cleared, ['cache', 'storage']);
  await env.call('browser:clearData', undefined);
  await env.call('browser:endIncognito');
  assert.deepEqual(env.incognito.cleared, ['storage', 'cache']);
});

test('openFile devolve URL file:/// do arquivo escolhido, ou null', async () => {
  const env = setup();
  assert.equal(await env.call('browser:openFile'), null);
  env.ctx.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: ['C:\\Docs\\manual.pdf'] });
  assert.equal(await env.call('browser:openFile'), 'file:///C:/Docs/manual.pdf');
  env.ctx.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: ['/home/a/x.html'] });
  assert.equal(await env.call('browser:openFile'), 'file:///home/a/x.html');
});

test('savePdf/savePage: guia inexistente é erro; nome do arquivo sem caracteres proibidos', async () => {
  const env = setup();
  await assert.rejects(() => env.call('browser:savePdf', 404), /guia não encontrada/);
  assert.throws(() => env.call('browser:savePage', 404), /guia não encontrada/);
  fakeGuest(env, { id: 9 });
  let options;
  env.ctx.dialog.showSaveDialog = async (_win, opts) => ((options = opts), { canceled: true });
  assert.equal(await env.call('browser:savePdf', 9), null);
  assert.equal(path.basename(options.defaultPath), 'Título combarras.pdf');
});

function fakeDownload(filename) {
  const events = new Map();
  return {
    filename,
    savePath: '',
    state: 'progressing',
    paused: false,
    events,
    dialogOptions: null,
    getURL: () => `https://arquivos.dev/${filename}`,
    getFilename: () => filename,
    getSavePath() {
      return this.savePath;
    },
    setSavePath(p) {
      this.savePath = p;
    },
    setSaveDialogOptions(o) {
      this.dialogOptions = o;
    },
    getReceivedBytes: () => 10,
    getTotalBytes: () => 100,
    isPaused() {
      return this.paused;
    },
    getState() {
      return this.state;
    },
    getStartTime: () => 1700000000.5,
    pause() {
      this.paused = true;
    },
    resume() {
      this.paused = false;
    },
    canResume: () => true,
    cancel() {
      this.state = 'cancelled';
    },
    on: (event, fn) => events.set(event, fn),
    once: (event, fn) => events.set(event, fn),
  };
}
