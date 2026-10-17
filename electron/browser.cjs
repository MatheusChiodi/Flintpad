'use strict';

// Navegador embutido: as páginas rodam em <webview> (o mesmo Chromium do Electron) e este módulo cuida
// do que só o processo principal faz: sessões (normal e anônima), downloads, permissões de site,
// menu de contexto, atalhos digitados dentro da página, popups, histórico e favoritos em disco.

const { app, clipboard, desktopCapturer, dialog, ipcMain, Menu, session, shell, webContents } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const NORMAL_PARTITION = 'persist:flintpad-browser';
const INCOGNITO_PARTITION = 'flintpad-incognito';
const MAX_HISTORY = 5000;
const SAVE_DELAY_MS = 800;
const PROGRESS_INTERVAL_MS = 250;

// Permissões que o Chrome concede sem perguntar.
const ALWAYS_ALLOWED = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'keyboardLock', 'window-management', 'speaker-selection']);

// Atalhos do Chrome atendidos pelo navegador quando o foco está dentro da página (mesma lista de src/lib/browser.ts).
const SHORTCUTS = new Set([
  'Ctrl+T', 'Ctrl+N', 'Ctrl+Shift+N', 'Ctrl+Shift+T', 'Ctrl+W', 'Ctrl+F4', 'Ctrl+Shift+W',
  'Ctrl+Tab', 'Ctrl+Shift+Tab', 'Ctrl+PageDown', 'Ctrl+PageUp',
  'Ctrl+1', 'Ctrl+2', 'Ctrl+3', 'Ctrl+4', 'Ctrl+5', 'Ctrl+6', 'Ctrl+7', 'Ctrl+8', 'Ctrl+9',
  'Ctrl+L', 'Alt+D', 'F6', 'Ctrl+K', 'Ctrl+E',
  'Ctrl+F', 'F3', 'Shift+F3', 'Ctrl+G', 'Ctrl+Shift+G',
  'Ctrl+R', 'F5', 'Ctrl+F5', 'Shift+F5', 'Ctrl+Shift+R',
  'Alt+ArrowLeft', 'Alt+ArrowRight', 'Alt+Home', 'BrowserBack', 'BrowserForward',
  'Ctrl+D', 'Ctrl+Shift+B', 'Ctrl+Shift+O', 'Ctrl+H', 'Ctrl+J', 'Ctrl+Shift+Delete',
  'Ctrl+P', 'Ctrl+S', 'Ctrl+U', 'Ctrl+O',
  'F12', 'Ctrl+Shift+I', 'Ctrl+Shift+J', 'Ctrl+Shift+C',
  'Ctrl+=', 'Ctrl+-', 'Ctrl+0', 'Ctrl+Shift+=',
]);

function comboOf(input) {
  const parts = [];
  if (input.control || input.meta) parts.push('Ctrl');
  if (input.shift) parts.push('Shift');
  if (input.alt) parts.push('Alt');
  let key = input.key;
  if (key.length === 1) key = key.toUpperCase();
  if (key === '+') key = '=';
  parts.push(key);
  return parts.join('+');
}

// Arquivo JSON com gravação atrasada e atômica (escreve ao lado e renomeia).
function jsonStore(file, fallback) {
  let data = fallback;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // ainda não existe
  }
  let timer = null;
  const flush = async () => {
    timer = null;
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(`${file}.tmp`, JSON.stringify(data));
    await fsp.rename(`${file}.tmp`, file);
  };
  return {
    get: () => data,
    set(next) {
      data = next;
      clearTimeout(timer);
      timer = setTimeout(() => void flush().catch((error) => console.error('browser:store', error.message)), SAVE_DELAY_MS);
    },
    flushNow: () => (timer ? (clearTimeout(timer), flush()) : Promise.resolve()),
  };
}

function uniquePath(dir, name) {
  const ext = path.extname(name);
  const stem = path.basename(name, ext) || 'download';
  let candidate = path.join(dir, `${stem}${ext}`);
  for (let n = 1; fs.existsSync(candidate); n++) candidate = path.join(dir, `${stem} (${n})${ext}`);
  return candidate;
}

const safeName = (name, fallback) => String(name ?? '').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 120) || fallback;

function registerBrowserIpc({ getWin, getT }) {
  const dir = path.join(app.getPath('userData'), 'browser');
  const history = jsonStore(path.join(dir, 'history.json'), []);
  const bookmarks = jsonStore(path.join(dir, 'bookmarks.json'), []);
  const downloadLog = jsonStore(path.join(dir, 'downloads.json'), []);
  const sitePermissions = jsonStore(path.join(dir, 'permissions.json'), {});
  const settings = jsonStore(path.join(dir, 'settings.json'), { askWhereToSave: false });

  const send = (channel, ...args) => {
    const win = getWin();
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
  };
  const t = (key, vars) => getT()(key, vars);

  // ---------- Downloads ----------

  const items = new Map(); // id → DownloadItem (só os desta execução)
  let nextDownload = Date.now();
  const describe = (id, item, extra = {}) => ({
    id,
    url: item.getURL(),
    filename: path.basename(item.getSavePath() || item.getFilename()),
    path: item.getSavePath(),
    received: item.getReceivedBytes(),
    total: item.getTotalBytes(),
    state: item.isPaused() && item.getState() === 'progressing' ? 'paused' : item.getState(),
    started: Math.round(item.getStartTime() * 1000),
    ...extra,
  });
  const logDownload = (entry) => {
    if (entry.incognito) return;
    const list = downloadLog.get().filter((item) => item.id !== entry.id);
    downloadLog.set([entry, ...list].slice(0, 300));
  };

  // ---------- Permissões ----------

  const pending = new Map(); // id → callback
  let nextPermission = 1;
  const decisionFor = (origin, permission) => sitePermissions.get()[origin]?.[permission];
  const askRenderer = (contents, origin, permission, callback) => {
    const id = nextPermission++;
    pending.set(id, callback);
    send('browser:permission', { id, webContentsId: contents.id, origin, permission });
  };

  function configure(ses, incognito) {
    if (ses.__flintpad) return ses;
    ses.__flintpad = true;
    // Sites como o Google recusam navegadores que se identificam como Electron: o agente fica igual ao do Chrome.
    ses.setUserAgent(ses.getUserAgent().replace(/\s(flintpad|Electron)\/\S+/gi, ''));
    ses.setSpellCheckerLanguages(['pt-BR', 'en-US'].filter((lang) => ses.availableSpellCheckerLanguages.includes(lang)));

    ses.setPermissionRequestHandler((contents, permission, callback, details) => {
      if (ALWAYS_ALLOWED.has(permission)) return callback(true);
      const origin = (() => {
        try {
          return new URL(details.requestingUrl || contents.getURL()).origin;
        } catch {
          return '';
        }
      })();
      const saved = decisionFor(origin, permission);
      if (saved) return callback(saved === 'allow');
      askRenderer(contents, origin, permission === 'media' && details.mediaTypes?.length ? `media:${details.mediaTypes.join('+')}` : permission, callback);
    });
    ses.setPermissionCheckHandler((_contents, permission, origin) => ALWAYS_ALLOWED.has(permission) || decisionFor(origin, permission) === 'allow');

    // Compartilhar tela (getDisplayMedia): pergunta como as outras permissões e entrega a tela principal.
    ses.setDisplayMediaRequestHandler((request, callback) => {
      const origin = request.securityOrigin || '';
      askRenderer({ id: 0 }, origin, 'display-capture', async (allowed) => {
        if (!allowed) return callback({});
        const [screen] = await desktopCapturer.getSources({ types: ['screen'] });
        callback(screen ? { video: screen, audio: request.audioRequested ? 'loopback' : undefined } : {});
      });
    });

    ses.on('will-download', async (_event, item) => {
      const id = String(nextDownload++);
      items.set(id, item);
      const downloads = app.getPath('downloads');
      if (settings.get().askWhereToSave) {
        item.setSaveDialogOptions({ title: t('browser.saveDownload'), defaultPath: path.join(downloads, item.getFilename()) });
      } else item.setSavePath(uniquePath(downloads, item.getFilename()));
      let last = 0;
      item.on('updated', () => {
        if (Date.now() - last < PROGRESS_INTERVAL_MS) return;
        last = Date.now();
        send('browser:download', describe(id, item, { incognito }));
      });
      item.once('done', (_e, state) => {
        const entry = describe(id, item, { incognito, state, finished: Date.now() });
        logDownload(entry);
        send('browser:download', entry);
      });
      send('browser:download', describe(id, item, { incognito }));
    });
    return ses;
  }

  configure(session.fromPartition(NORMAL_PARTITION), false);
  configure(session.fromPartition(INCOGNITO_PARTITION), true);

  // ---------- Guias (webview): segurança, popups, menu de contexto e atalhos ----------

  app.on('web-contents-created', (_event, contents) => {
    // A janela do app só aceita <webview> nas sessões do navegador, sem preload nem Node.
    contents.on('will-attach-webview', (event, prefs, params) => {
      if (params.partition !== NORMAL_PARTITION && params.partition !== INCOGNITO_PARTITION) return event.preventDefault();
      delete prefs.preload;
      prefs.nodeIntegration = false;
      prefs.nodeIntegrationInSubFrames = false;
      prefs.contextIsolation = true;
      prefs.sandbox = true;
      prefs.webSecurity = true;
      if (!/^(https?|file|about|data|view-source|blob):/i.test(params.src || 'about:blank')) params.src = 'about:blank';
    });

    if (contents.getType() !== 'webview') return;
    const incognito = contents.session === session.fromPartition(INCOGNITO_PARTITION);

    contents.setWindowOpenHandler(({ url, disposition, features }) => {
      // Janela com tamanho pedido (login do Google, pagamento): popup de verdade, para window.opener funcionar.
      if (disposition === 'new-window' && features) {
        return { action: 'allow', overrideBrowserWindowOptions: { parent: getWin() ?? undefined, autoHideMenuBar: true, webPreferences: { partition: incognito ? INCOGNITO_PARTITION : NORMAL_PARTITION, sandbox: true, contextIsolation: true } } };
      }
      send('browser:open', { url, background: disposition === 'background-tab', incognito, from: contents.id });
      return { action: 'deny' };
    });

    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const combo = comboOf(input);
      if (!SHORTCUTS.has(combo) && combo !== 'Escape') return;
      // Esc só interessa ao navegador para fechar a busca na página; a página também o recebe.
      if (combo !== 'Escape') event.preventDefault();
      send('browser:shortcut', { webContentsId: contents.id, combo });
    });

    contents.on('context-menu', (_e, params) => {
      const template = buildContextMenu(contents, params, incognito);
      if (template.length) Menu.buildFromTemplate(template).popup({ window: getWin() ?? undefined });
    });
  });

  function buildContextMenu(contents, params, incognito) {
    const nav = contents.navigationHistory;
    const sep = { type: 'separator' };
    const groups = [];
    const open = (url, extra = {}) => send('browser:open', { url, background: false, incognito, from: contents.id, ...extra });
    if (params.linkURL) {
      groups.push([
        { label: t('browser.ctx.openLinkTab'), click: () => open(params.linkURL, { background: true }) },
        { label: t('browser.ctx.openLinkIncognito'), click: () => open(params.linkURL, { incognito: true }) },
        { label: t('browser.ctx.saveLink'), click: () => contents.downloadURL(params.linkURL) },
        { label: t('browser.ctx.copyLink'), click: () => clipboard.writeText(params.linkURL) },
      ]);
    }
    if (params.mediaType === 'image' && params.srcURL) {
      groups.push([
        { label: t('browser.ctx.openImageTab'), click: () => open(params.srcURL, { background: true }) },
        { label: t('browser.ctx.saveImage'), click: () => contents.downloadURL(params.srcURL) },
        { label: t('browser.ctx.copyImage'), click: () => contents.copyImageAt(params.x, params.y) },
        { label: t('browser.ctx.copyImageUrl'), click: () => clipboard.writeText(params.srcURL) },
      ]);
    } else if ((params.mediaType === 'video' || params.mediaType === 'audio') && params.srcURL) {
      groups.push([
        { label: t('browser.ctx.openMediaTab'), click: () => open(params.srcURL, { background: true }) },
        { label: t('browser.ctx.saveMedia'), click: () => contents.downloadURL(params.srcURL) },
        { label: t('browser.ctx.copyMediaUrl'), click: () => clipboard.writeText(params.srcURL) },
      ]);
    }
    if (params.isEditable) {
      const spelling = params.misspelledWord
        ? [
            ...params.dictionarySuggestions.slice(0, 5).map((word) => ({ label: word, click: () => contents.replaceMisspelling(word) })),
            ...(params.dictionarySuggestions.length ? [] : [{ label: t('browser.ctx.noSuggestions'), enabled: false }]),
            { label: t('browser.ctx.addToDictionary'), click: () => contents.session.addWordToSpellCheckerDictionary(params.misspelledWord) },
          ]
        : [];
      if (spelling.length) groups.push(spelling);
      groups.push([
        { label: t('browser.ctx.undo'), role: 'undo', enabled: params.editFlags.canUndo },
        { label: t('browser.ctx.redo'), role: 'redo', enabled: params.editFlags.canRedo },
      ]);
      groups.push([
        { label: t('browser.ctx.cut'), role: 'cut', enabled: params.editFlags.canCut },
        { label: t('browser.ctx.copy'), role: 'copy', enabled: params.editFlags.canCopy },
        { label: t('browser.ctx.paste'), role: 'paste', enabled: params.editFlags.canPaste },
        { label: t('browser.ctx.pastePlain'), role: 'pasteAndMatchStyle', enabled: params.editFlags.canPaste },
        { label: t('browser.ctx.selectAll'), role: 'selectAll' },
      ]);
    } else if (params.selectionText.trim()) {
      const text = params.selectionText.trim();
      groups.push([
        { label: t('browser.ctx.copy'), role: 'copy' },
        { label: t('browser.ctx.search', { text: text.length > 30 ? `${text.slice(0, 30)}…` : text }), click: () => send('browser:search', { text, incognito, from: contents.id }) },
      ]);
    }
    if (!params.linkURL && params.mediaType === 'none' && !params.isEditable && !params.selectionText.trim()) {
      groups.push([
        { label: t('browser.ctx.back'), enabled: nav.canGoBack(), click: () => nav.goBack() },
        { label: t('browser.ctx.forward'), enabled: nav.canGoForward(), click: () => nav.goForward() },
        { label: t('browser.ctx.reload'), click: () => contents.reload() },
      ]);
      groups.push([
        { label: t('browser.ctx.savePage'), click: () => void savePage(contents) },
        { label: t('browser.ctx.print'), click: () => contents.print() },
        { label: t('browser.ctx.viewSource'), click: () => open(`view-source:${contents.getURL()}`) },
      ]);
    }
    groups.push([{ label: t('browser.ctx.inspect'), click: () => contents.inspectElement(params.x, params.y) }]);
    return groups.flatMap((group, index) => (index ? [sep, ...group] : group));
  }

  async function savePage(contents) {
    const result = await dialog.showSaveDialog(getWin(), {
      title: t('browser.savePage'),
      defaultPath: path.join(app.getPath('downloads'), `${safeName(contents.getTitle(), 'pagina')}.html`),
      filters: [
        { name: t('browser.pageComplete'), extensions: ['html', 'htm'] },
        { name: t('browser.pageSingle'), extensions: ['mhtml'] },
      ],
    });
    if (result.canceled || !result.filePath) return null;
    const type = /\.mhtml$/i.test(result.filePath) ? 'MHTML' : 'HTMLComplete';
    await contents.savePage(result.filePath, type);
    return result.filePath;
  }

  const guest = (id) => {
    const contents = webContents.fromId(id);
    if (!contents || contents.isDestroyed() || contents.getType() !== 'webview') throw new Error('guia não encontrada');
    return contents;
  };

  // ---------- IPC ----------

  ipcMain.handle('browser:history:list', () => history.get());
  ipcMain.handle('browser:history:add', (_e, visit) => {
    if (!visit || !/^(https?|file):/i.test(visit.url)) return;
    const list = history.get();
    // Recarregar a mesma página não cria outra visita: só atualiza o título e a hora.
    if (list[0]?.url === visit.url) list[0] = { ...list[0], title: visit.title || list[0].title, time: visit.time };
    else list.unshift({ url: String(visit.url), title: String(visit.title ?? ''), time: Number(visit.time) || Date.now() });
    history.set(list.slice(0, MAX_HISTORY));
  });
  ipcMain.handle('browser:history:remove', (_e, url, time) => history.set(history.get().filter((visit) => !(visit.url === url && (time === undefined || visit.time === time)))));
  ipcMain.handle('browser:history:clear', () => history.set([]));

  ipcMain.handle('browser:bookmarks:list', () => bookmarks.get());
  ipcMain.handle('browser:bookmarks:save', (_e, list) => bookmarks.set(Array.isArray(list) ? list.filter((item) => item && item.url).map(({ id, url, title }) => ({ id: String(id), url: String(url), title: String(title ?? '') })) : []));

  ipcMain.handle('browser:downloads:list', () => {
    const live = [...items.entries()].map(([id, item]) => describe(id, item));
    const liveIds = new Set(live.map((item) => item.id));
    return [...live.filter((item) => item.state === 'progressing' || item.state === 'paused'), ...downloadLog.get().filter((item) => !liveIds.has(item.id) || items.get(item.id)?.getState() !== 'progressing')].sort((a, b) => b.started - a.started);
  });
  ipcMain.handle('browser:downloads:action', (_e, id, action) => {
    const item = items.get(id);
    const entry = downloadLog.get().find((d) => d.id === id) ?? (item ? describe(id, item) : null);
    if (action === 'pause') item?.pause();
    else if (action === 'resume') item?.canResume() && item.resume();
    else if (action === 'cancel') item?.cancel();
    else if (action === 'open' && entry?.path) return shell.openPath(entry.path);
    else if (action === 'show' && entry?.path) shell.showItemInFolder(entry.path);
    else if (action === 'remove') downloadLog.set(downloadLog.get().filter((d) => d.id !== id));
    else if (action === 'retry' && entry?.url) session.fromPartition(NORMAL_PARTITION).downloadURL(entry.url);
    if (item) send('browser:download', describe(id, item));
    return null;
  });
  ipcMain.handle('browser:downloads:clear', () => downloadLog.set(downloadLog.get().filter((d) => items.get(d.id)?.getState() === 'progressing')));

  ipcMain.handle('browser:permission:reply', (_e, id, allow, remember, origin, permission) => {
    const callback = pending.get(id);
    pending.delete(id);
    if (remember && origin && permission) {
      const all = { ...sitePermissions.get() };
      all[origin] = { ...all[origin], [permission.split(':')[0]]: allow ? 'allow' : 'deny' };
      sitePermissions.set(all);
    }
    callback?.(Boolean(allow));
  });
  ipcMain.handle('browser:permission:list', () => sitePermissions.get());
  ipcMain.handle('browser:permission:reset', (_e, origin) => {
    const all = { ...sitePermissions.get() };
    if (origin) delete all[origin];
    sitePermissions.set(origin ? all : {});
  });

  ipcMain.handle('browser:settings:get', () => settings.get());
  ipcMain.handle('browser:settings:set', (_e, patch) => settings.set({ ...settings.get(), askWhereToSave: Boolean(patch?.askWhereToSave) }));

  ipcMain.handle('browser:savePdf', async (_e, id) => {
    const contents = guest(id);
    const result = await dialog.showSaveDialog(getWin(), {
      title: t('browser.savePdf'),
      defaultPath: path.join(app.getPath('downloads'), `${safeName(contents.getTitle(), 'pagina')}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePath) return null;
    await fsp.writeFile(result.filePath, await contents.printToPDF({ printBackground: true }));
    shell.showItemInFolder(result.filePath);
    return result.filePath;
  });
  ipcMain.handle('browser:savePage', (_e, id) => savePage(guest(id)));
  ipcMain.handle('browser:openFile', async () => {
    const result = await dialog.showOpenDialog(getWin(), { title: t('browser.openFile'), properties: ['openFile'] });
    return result.canceled || !result.filePaths[0] ? null : `file:///${result.filePaths[0].replace(/\\/g, '/').replace(/^\/+/, '')}`;
  });

  // Limpar dados de navegação: histórico, downloads, cookies/armazenamento e cache, cada um opcional.
  ipcMain.handle('browser:clearData', async (_e, what) => {
    const ses = session.fromPartition(NORMAL_PARTITION);
    if (what?.history) history.set([]);
    if (what?.downloads) downloadLog.set([]);
    if (what?.cookies) await ses.clearStorageData();
    if (what?.cache) await ses.clearCache();
    if (what?.permissions) sitePermissions.set({});
  });
  // Última guia anônima fechada: nada da sessão anônima sobrevive.
  ipcMain.handle('browser:endIncognito', async () => {
    const ses = session.fromPartition(INCOGNITO_PARTITION);
    await ses.clearStorageData();
    await ses.clearCache();
  });

  return {
    flush: () => Promise.all([history.flushNow(), bookmarks.flushNow(), downloadLog.flushNow(), sitePermissions.flushNow(), settings.flushNow()]),
  };
}

module.exports = { registerBrowserIpc, NORMAL_PARTITION, INCOGNITO_PARTITION };
