'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { bruToJsonV2, jsonToBruV2, bruToEnvJsonV2, envJsonToBruV2 } = require('@usebruno/lang');

const MAX_INDEXED_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const ENV_DIR = 'environments';
const inFlight = new Map();
const configFile = () => path.join(app.getPath('userData'), 'config.json');

let win = null;
let vault = process.env.OBNOTION_VAULT || null;

function loadConfig() {
  if (vault) return;
  try {
    const saved = JSON.parse(fs.readFileSync(configFile(), 'utf8')).vault;
    if (saved && fs.existsSync(saved)) vault = saved;
  } catch {
    // primeira execução: sem config
  }
}

// Todo caminho vindo do renderer é relativo ao vault e não pode sair dele.
function resolveInVault(rel) {
  if (!vault) throw new Error('Nenhum vault aberto');
  const full = path.resolve(vault, rel);
  if (full !== vault && !full.startsWith(vault + path.sep)) throw new Error('Caminho fora do vault');
  return full;
}

async function walk(dir, rel, out, ext = '.md') {
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await walk(path.join(dir, entry.name), childRel, out, ext);
    else if (entry.name.toLowerCase().endsWith(ext)) out.push(childRel);
  }
  return out;
}

async function uniquePath(rel) {
  const ext = path.extname(rel);
  const stem = rel.slice(0, rel.length - ext.length);
  for (let i = 0; ; i++) {
    const candidate = i === 0 ? rel : `${stem} ${i}${ext}`;
    if (!fs.existsSync(resolveInVault(candidate))) return candidate;
  }
}

function registerIpc() {
  ipcMain.handle('vault:get', () => vault);

  ipcMain.handle('vault:choose', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Escolher pasta do vault',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return vault;
    vault = result.filePaths[0];
    await fsp.writeFile(configFile(), JSON.stringify({ vault }));
    return vault;
  });

  ipcMain.handle('vault:readAll', async () => {
    const files = (await walk(vault, '', [])).sort((a, b) => a.localeCompare(b));
    return Promise.all(
      files.map(async (rel) => {
        const full = resolveInVault(rel);
        const { size } = await fsp.stat(full);
        return { path: rel, content: size > MAX_INDEXED_BYTES ? '' : await fsp.readFile(full, 'utf8') };
      }),
    );
  });

  ipcMain.handle('note:read', (_e, rel) => fsp.readFile(resolveInVault(rel), 'utf8'));

  ipcMain.handle('note:write', (_e, rel, content) => fsp.writeFile(resolveInVault(rel), content, 'utf8'));

  ipcMain.handle('note:create', async (_e, rel) => {
    const finalRel = await uniquePath(rel);
    const full = resolveInVault(finalRel);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, '', 'utf8');
    return finalRel;
  });

  ipcMain.handle('note:rename', async (_e, from, to) => {
    if (from === to) return from;
    const finalRel = await uniquePath(to);
    await fsp.rename(resolveInVault(from), resolveInVault(finalRel));
    return finalRel;
  });

  ipcMain.handle('note:delete', (_e, rel) => shell.trashItem(resolveInVault(rel)));

  registerRequestIpc();
}

const isEnvFile = (rel) => rel.split('/').slice(-2, -1)[0] === ENV_DIR;

// Requests e ambientes ficam em arquivos .bru no vault, no formato do Bruno.
function registerRequestIpc() {
  ipcMain.handle('bru:list', async () => {
    const files = (await walk(vault, '', [], '.bru')).sort((a, b) => a.localeCompare(b));
    const requests = [];
    const environments = [];
    for (const rel of files) {
      try {
        const text = await fsp.readFile(resolveInVault(rel), 'utf8');
        if (isEnvFile(rel)) {
          environments.push({ path: rel, name: path.basename(rel, '.bru'), variables: bruToEnvJsonV2(text).variables ?? [] });
        } else {
          const json = bruToJsonV2(text);
          if (!json.http) continue; // collection.bru, folder.bru e tipos que não são HTTP
          requests.push({ path: rel, name: json.meta?.name || path.basename(rel, '.bru'), method: json.http.method, url: json.http.url ?? '' });
        }
      } catch {
        // arquivo .bru inválido: fica fora da lista
      }
    }
    return { requests, environments };
  });

  ipcMain.handle('bru:read', async (_e, rel) => bruToJsonV2(await fsp.readFile(resolveInVault(rel), 'utf8')));

  ipcMain.handle('bru:write', (_e, rel, json) => fsp.writeFile(resolveInVault(rel), jsonToBruV2(json), 'utf8'));

  ipcMain.handle('bru:create', async (_e, folder, name) => {
    const dir = resolveInVault(folder);
    await fsp.mkdir(dir, { recursive: true });
    // bruno.json permite abrir a mesma pasta como coleção no Bruno.
    const manifest = path.join(dir, 'bruno.json');
    if (!fs.existsSync(manifest)) {
      await fsp.writeFile(manifest, JSON.stringify({ version: '1', name: path.basename(dir), type: 'collection' }, null, 2));
    }
    const rel = await uniquePath(`${folder}/${name}.bru`);
    const json = { meta: { name: path.basename(rel, '.bru'), type: 'http', seq: 1 }, http: { method: 'get', url: '', body: 'none', auth: 'none' } };
    await fsp.writeFile(resolveInVault(rel), jsonToBruV2(json), 'utf8');
    return rel;
  });

  ipcMain.handle('env:write', async (_e, rel, variables) => {
    const full = resolveInVault(rel);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, envJsonToBruV2({ variables }), 'utf8');
  });

  ipcMain.handle('http:send', async (_e, request) => {
    const controller = new AbortController();
    inFlight.set(request.id, controller);
    const started = performance.now();
    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body ?? undefined,
        redirect: 'follow',
        signal: controller.signal,
      });
      const buffer = Buffer.from(await response.arrayBuffer());
      return {
        ok: true,
        status: response.status,
        statusText: response.statusText,
        headers: [...response.headers.entries()],
        size: buffer.length,
        time: Math.round(performance.now() - started),
        truncated: buffer.length > MAX_RESPONSE_BYTES,
        body: buffer.subarray(0, MAX_RESPONSE_BYTES).toString('utf8'),
      };
    } catch (error) {
      const cause = error.cause?.code || error.cause?.message;
      return {
        ok: false,
        cancelled: controller.signal.aborted,
        error: cause ? `${error.message} (${cause})` : error.message,
        time: Math.round(performance.now() - started),
      };
    } finally {
      inFlight.delete(request.id);
    }
  });

  ipcMain.handle('http:cancel', (_e, id) => inFlight.get(id)?.abort());
}

// Menu e atalhos espelhados do Notion Desktop; ações de página vão para o renderer.
function buildMenu() {
  const send = (action) => () => win?.webContents.send('menu', action);
  const item = (label, accelerator, action) => ({ label, accelerator, click: send(action) });

  return Menu.buildFromTemplate([
    {
      label: 'Arquivo',
      submenu: [
        item('Nova página', 'CmdOrCtrl+N', 'new-note'),
        item('Nova guia', 'CmdOrCtrl+T', 'new-tab'),
        item('Reabrir a última guia fechada', 'CmdOrCtrl+Shift+T', 'reopen-tab'),
        item('Fechar guia', 'CmdOrCtrl+W', 'close-tab'),
        { type: 'separator' },
        item('Abrir outro vault…', 'CmdOrCtrl+O', 'choose-vault'),
        { type: 'separator' },
        { role: 'quit', label: 'Sair', accelerator: 'CmdOrCtrl+Shift+Q' },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Desfazer' },
        { role: 'redo', label: 'Refazer', accelerator: 'CmdOrCtrl+Shift+Z' },
        { type: 'separator' },
        { role: 'cut', label: 'Recortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' },
        { role: 'pasteAndMatchStyle', label: 'Colar e usar mesmo estilo', accelerator: 'CmdOrCtrl+Shift+V' },
        { role: 'selectAll', label: 'Selecionar tudo' },
        { type: 'separator' },
        item('Copiar link para página atual', 'CmdOrCtrl+L', 'copy-link'),
        item('Copiar nome da página atual', 'CmdOrCtrl+Alt+L', 'copy-name'),
      ],
    },
    {
      label: 'Visualizar',
      submenu: [
        item('Busca rápida', 'CmdOrCtrl+P', 'quick-switcher'),
        item('Visualização em grafo', 'CmdOrCtrl+G', 'graph'),
        item('Requests', 'CmdOrCtrl+Shift+E', 'requests'),
        item('Mostrar/ocultar barra lateral', 'CmdOrCtrl+\\', 'toggle-sidebar'),
        { type: 'separator' },
        { role: 'reload', label: 'Recarregar' },
        { role: 'forceReload', label: 'Forçar recarregar' },
        { role: 'toggleDevTools', label: 'Alternar Ferramentas do Desenvolvedor' },
        { type: 'separator' },
        { role: 'zoomIn', label: 'Mais zoom', accelerator: 'CmdOrCtrl+=' },
        { role: 'zoomOut', label: 'Menos zoom' },
        { role: 'resetZoom', label: 'Tamanho real' },
        { role: 'togglefullscreen', label: 'Alternar tela cheia' },
      ],
    },
    {
      label: 'Histórico',
      submenu: [item('Voltar', 'CmdOrCtrl+[', 'back'), item('Avançar', 'CmdOrCtrl+]', 'forward')],
    },
    {
      label: 'Janela',
      submenu: [
        item('Mostrar próxima guia', 'Ctrl+Tab', 'next-tab'),
        item('Mostrar guia anterior', 'Ctrl+Shift+Tab', 'prev-tab'),
        { role: 'minimize', label: 'Minimizar' },
      ],
    },
  ]);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#0a0d13',
    autoHideMenuBar: true,
    title: 'ObNotion',
    // Em modo de captura a janela não aparece: renderiza fora da tela, sem depender do foco.
    show: !process.env.OBNOTION_SHOT,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      offscreen: Boolean(process.env.OBNOTION_SHOT),
      nodeIntegration: false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });

  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  // Auxílio de teste: OBNOTION_SHOT=<arquivo.png> captura a janela e encerra.
  if (process.env.OBNOTION_SHOT) {
    win.webContents.on('console-message', (event) => console.log('[renderer]', event.message));
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        if (process.env.OBNOTION_TYPE) {
          await win.webContents.executeJavaScript("document.querySelector('.bn-editor')?.focus()");
          await win.webContents.insertText(process.env.OBNOTION_TYPE);
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
        if (process.env.OBNOTION_EVAL) {
          await win.webContents.executeJavaScript(process.env.OBNOTION_EVAL).catch((error) => console.log('[eval]', error.message));
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
        const image = await win.webContents.capturePage();
        await fsp.writeFile(process.env.OBNOTION_SHOT, image.toPNG());
        app.quit();
      }, Number(process.env.OBNOTION_SHOT_DELAY) || 5000);
    });
  }
}

app.whenReady().then(() => {
  loadConfig();
  registerIpc();
  Menu.setApplicationMenu(buildMenu());
  createWindow();
});

app.on('window-all-closed', () => app.quit());
