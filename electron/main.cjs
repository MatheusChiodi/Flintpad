'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const { parse: parseJsonc } = require('jsonc-parser');
const { bruToJsonV2, jsonToBruV2, bruToEnvJsonV2, envJsonToBruV2 } = require('@usebruno/lang');
const { LANGUAGES, translator } = require('./i18n.cjs');
const { registerWorkspaceIpc } = require('./workspace.cjs');
const { registerTerminalIpc } = require('./terminal.cjs');
const { registerLspIpc } = require('./lsp.cjs');
const { pushRecentVault, forgetRecentVault, sanitizeStoredPrefs } = require('./vaults.cjs');

// Os ganchos de teste só existem em desenvolvimento: no app empacotado as variáveis são descartadas
// (o preload herda o ambiente já limpo).
if (app.isPackaged) {
  for (const hook of ['OBNOTION_SHOT', 'OBNOTION_EVAL', 'OBNOTION_TYPE', 'OBNOTION_EXPORT_TO', 'OBNOTION_DOWNLOAD_DIR']) delete process.env[hook];
}

const MAX_INDEXED_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const ENV_DIR = 'environments';
const HISTORY_DIR = '.obnotion';
const MAX_HISTORY = 200;
// Margens do PDF exportado, em polegadas (cerca de 18 mm).
const PDF_MARGINS_IN = { top: 0.7, bottom: 0.7, left: 0.7, right: 0.7 };
const PDF_PAPER = '#ffffff';
const WINDOW_BACKGROUND = '#0a0d13';
const MAX_LISTED_FILES = 5000;
// Arquivos que o editor de código não abre: binários, mídia e pacotes.
const BINARY_EXTENSIONS = new Set(
  'png jpg jpeg gif webp bmp ico icns avif mp3 wav ogg flac mp4 mkv mov avi webm pdf zip rar 7z gz tar exe dll so dylib bin node wasm woff woff2 ttf otf eot psd ai sketch fig db sqlite lock'.split(' '),
);
const inFlight = new Map();
const configFile = () => path.join(app.getPath('userData'), 'config.json');

let win = null;
let workspace = null;
let terminals = null;
let languageServers = null;
let vault = process.env.OBNOTION_VAULT || null;
let language = 'pt-BR';
let t = translator(language);
// Vault salvo que não foi encontrado ao abrir (pendrive fora, pasta apagada): a tela de boas-vindas avisa.
let missingVault = null;
// Preferências da interface (cor de destaque, fonte, corretor…): o renderer valida campo a campo.
let prefs = {};

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configFile(), 'utf8')) ?? {};
  } catch {
    // primeira execução: sem config
    return {};
  }
}

// Grava só as chaves informadas: o vault e a língua moram no mesmo arquivo.
// Escreve ao lado e renomeia: uma queda no meio da gravação não deixa o config pela metade.
async function saveConfig(patch) {
  const temp = `${configFile()}.tmp`;
  await fsp.writeFile(temp, JSON.stringify({ ...readConfig(), ...patch }));
  await fsp.rename(temp, configFile());
}

function setLanguage(next) {
  language = next;
  t = translator(language);
  Menu.setApplicationMenu(buildMenu(language));
}

function loadConfig() {
  const saved = readConfig();
  if (!vault && saved.vault) {
    if (fs.existsSync(saved.vault)) vault = saved.vault;
    else missingVault = saved.vault;
  }
  prefs = sanitizeStoredPrefs(saved.prefs);
  // OBNOTION_LANG é a língua inicial (testes); sem nada salvo, vale a língua do sistema.
  const wanted = [process.env.OBNOTION_LANG, saved.language].find((candidate) => LANGUAGES.includes(candidate));
  setLanguage(wanted ?? (app.getLocale().toLowerCase().startsWith('pt') ? 'pt-BR' : 'en'));
}

// Todo caminho vindo do renderer é relativo ao vault e não pode sair dele.
function resolveInVault(rel) {
  if (!vault) throw new Error(t('error.noVault'));
  const full = path.resolve(vault, rel);
  if (full !== vault && !full.startsWith(vault + path.sep)) throw new Error(t('error.outsideVault'));
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

// O corretor ortográfico do Chromium segue a preferência e a língua da interface.
function applySpellcheck() {
  const session = win?.webContents.session;
  if (!session) return;
  session.setSpellCheckerEnabled(prefs.spellcheck !== false);
  try {
    // No Windows e no macOS o corretor é o do sistema e ignora esta lista.
    if (process.platform !== 'win32' && process.platform !== 'darwin') session.setSpellCheckerLanguages([language === 'en' ? 'en-US' : 'pt-BR']);
  } catch {
    // dicionário indisponível: fica o padrão
  }
}

// Abre uma pasta como vault: grava como último aberto e põe no topo dos recentes.
async function openVault(folder) {
  vault = folder;
  missingVault = null;
  await saveConfig({ vault, recentVaults: pushRecentVault(readConfig().recentVaults, folder) });
  return vault;
}

async function isDirectory(folder) {
  try {
    return (await fsp.stat(folder)).isDirectory();
  } catch {
    return false;
  }
}

function registerIpc() {
  ipcMain.handle('vault:get', () => vault);

  ipcMain.handle('vault:choose', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: t('dialog.chooseVault'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return vault;
    return openVault(result.filePaths[0]);
  });

  // Abre um vault pelo caminho (recentes, pasta solta na janela). Só pastas que existem.
  ipcMain.handle('vault:open', async (_e, folder) => {
    if (typeof folder !== 'string' || !path.isAbsolute(folder)) throw new Error(t('error.notFolder'));
    const full = path.resolve(folder);
    if (!(await isDirectory(full))) throw new Error(t('error.notFolder'));
    return openVault(full);
  });

  // Vaults recentes, do mais novo ao mais antigo, com a marca de quem não existe mais.
  ipcMain.handle('vault:recent', async () => {
    const list = pushRecentVault(readConfig().recentVaults, vault ?? '');
    return Promise.all(list.map(async (folder) => ({ path: folder, name: path.basename(folder) || folder, exists: await isDirectory(folder) })));
  });

  ipcMain.handle('vault:forget', async (_e, folder) => {
    if (typeof folder !== 'string') return;
    if (missingVault === folder) missingVault = null;
    const config = readConfig();
    await saveConfig({ recentVaults: forgetRecentVault(config.recentVaults, folder), ...(config.vault === folder && folder !== vault ? { vault: null } : {}) });
  });

  ipcMain.handle('vault:missing', () => missingVault);

  // Mostra a pasta do vault (ou a de dados do app) no gerenciador de arquivos do sistema.
  ipcMain.handle('vault:reveal', async (_e, which) => {
    const target = which === 'data' ? app.getPath('userData') : vault;
    if (!target) return;
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
  });

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: `${process.platform} ${process.arch}`,
    dataPath: app.getPath('userData'),
  }));

  ipcMain.handle('settings:get', () => ({ language, prefs }));

  ipcMain.handle('settings:set', async (_e, settings) => {
    if (LANGUAGES.includes(settings?.language) && settings.language !== language) {
      setLanguage(settings.language);
      await saveConfig({ language });
      applySpellcheck();
    }
    if (settings && 'prefs' in settings) {
      prefs = sanitizeStoredPrefs(settings.prefs);
      await saveConfig({ prefs });
      applySpellcheck();
    }
    return { language, prefs };
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

  // Exporta a página aberta: o PDF sai do que está na janela, com o estilo de impressão (@media print).
  // Devolve { path } ao gravar, { error } se falhar e null se o diálogo for cancelado.
  ipcMain.handle('page:exportPdf', async (_e, name) => {
    // OBNOTION_EXPORT_TO=<arquivo.pdf> (testes): grava direto, sem diálogo e sem abrir a pasta.
    let target = process.env.OBNOTION_EXPORT_TO;
    try {
      if (!target) {
        const safeName = String(name ?? '').replace(/[\\/:*?"<>|]/g, '').trim() || 'ObNotion';
        const result = await dialog.showSaveDialog(win, {
          title: t('dialog.exportPdf'),
          defaultPath: path.join(app.getPath('documents'), `${safeName}.pdf`),
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        });
        if (result.canceled || !result.filePath) return null;
        target = result.filePath;
      }
      // As margens da folha são pintadas com a cor de fundo da janela: sem a troca, sairiam escuras.
      win.setBackgroundColor(PDF_PAPER);
      const pdf = await win.webContents
        .printToPDF({ printBackground: true, pageSize: 'A4', margins: PDF_MARGINS_IN })
        .finally(() => win.setBackgroundColor(WINDOW_BACKGROUND));
      await fsp.writeFile(target, pdf);
      if (!process.env.OBNOTION_EXPORT_TO) shell.showItemInFolder(target);
      return { path: target };
    } catch (error) {
      return { error: error.message };
    }
  });

  registerRequestIpc();
  registerCodeIpc();
}

// Onde o VS Code guarda extensões: as do usuário e as que vêm com o programa.
function extensionRoots() {
  const roots = [path.join(os.homedir(), '.vscode', 'extensions')];
  const install = path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code');
  try {
    for (const entry of fs.readdirSync(install, { withFileTypes: true })) {
      const builtin = path.join(install, entry.name, 'resources', 'app', 'extensions');
      if (entry.isDirectory() && fs.existsSync(builtin)) roots.push(builtin);
    }
    const legacy = path.join(install, 'resources', 'app', 'extensions');
    if (fs.existsSync(legacy)) roots.push(legacy);
  } catch {
    // VS Code não instalado no local padrão
  }
  return roots.filter((dir) => fs.existsSync(dir));
}

const readJsonc = async (file) => parseJsonc(await fsp.readFile(file, 'utf8'), [], { allowTrailingComma: true });

function resolveInExtensions(file) {
  const full = path.resolve(file);
  if (!extensionRoots().some((dir) => full.startsWith(dir + path.sep))) throw new Error(t('error.outsideExtensions'));
  return full;
}

// Temas podem herdar de outro arquivo com "include".
async function readTheme(file, depth = 0) {
  const theme = (await readJsonc(file)) ?? {};
  if (!theme.include || depth > 4) return theme;
  const base = await readTheme(resolveInExtensions(path.resolve(path.dirname(file), theme.include)), depth + 1);
  return { ...base, ...theme, colors: { ...base.colors, ...theme.colors }, tokenColors: [...(base.tokenColors ?? []), ...(theme.tokenColors ?? [])] };
}

function registerCodeIpc() {
  ipcMain.handle('files:list', async () => {
    const out = [];
    const visit = async (dir, rel) => {
      for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
        if (out.length >= MAX_LISTED_FILES) return;
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await visit(path.join(dir, entry.name), childRel);
        else if (!BINARY_EXTENSIONS.has(path.extname(entry.name).slice(1).toLowerCase())) out.push(childRel);
      }
    };
    await visit(vault, '');
    return out.sort((a, b) => a.localeCompare(b));
  });

  ipcMain.handle('ext:list', async () => {
    const extensions = [];
    for (const dir of extensionRoots()) {
      const builtin = !dir.startsWith(os.homedir() + path.sep + '.vscode');
      for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const folder = path.join(dir, entry.name);
        try {
          const pkg = JSON.parse(await fsp.readFile(path.join(folder, 'package.json'), 'utf8'));
          let nls = {};
          try {
            nls = JSON.parse(await fsp.readFile(path.join(folder, 'package.nls.json'), 'utf8'));
          } catch {
            // extensão sem arquivo de textos
          }
          const text = (value) => (typeof value === 'string' ? value.replace(/^%(.+)%$/, (all, key) => nls[key]?.message ?? nls[key] ?? all) : '');
          const contributes = pkg.contributes ?? {};
          const themes = (contributes.themes ?? []).map((theme) => ({ label: text(theme.label) || theme.id || path.basename(theme.path), uiTheme: theme.uiTheme ?? 'vs-dark', path: path.join(folder, theme.path) }));
          const snippets = (contributes.snippets ?? []).map((snippet) => ({ language: snippet.language, path: path.join(folder, snippet.path) }));
          const inFolder = (rel) => (typeof rel === 'string' ? path.join(folder, rel) : undefined);
          const iconThemes = (contributes.iconThemes ?? []).map((theme) => ({ id: theme.id, label: text(theme.label) || theme.id, path: path.join(folder, theme.path) }));
          const languages = (contributes.languages ?? []).map((lang) => ({
            id: lang.id,
            aliases: lang.aliases ?? [],
            extensions: lang.extensions ?? [],
            filenames: lang.filenames ?? [],
            filenamePatterns: lang.filenamePatterns ?? [],
            firstLine: lang.firstLine,
            mimetypes: lang.mimetypes ?? [],
            configuration: inFolder(lang.configuration),
          }));
          const grammars = (contributes.grammars ?? [])
            .filter((grammar) => grammar.scopeName && grammar.path)
            .map((grammar) => ({
              language: grammar.language,
              scopeName: grammar.scopeName,
              path: path.join(folder, grammar.path),
              embeddedLanguages: grammar.embeddedLanguages ?? {},
              tokenTypes: grammar.tokenTypes ?? {},
              injectTo: grammar.injectTo ?? [],
              balancedBracketScopes: grammar.balancedBracketScopes,
              unbalancedBracketScopes: grammar.unbalancedBracketScopes,
            }));
          // Esquemas de validação JSON; caminhos relativos apontam para dentro da extensão.
          const jsonValidation = (contributes.jsonValidation ?? [])
            .filter((entry) => entry.url && entry.fileMatch)
            .map((entry) => ({
              fileMatch: Array.isArray(entry.fileMatch) ? entry.fileMatch : [entry.fileMatch],
              url: /^[a-z][\w+.-]*:/i.test(entry.url) ? entry.url : require('node:url').pathToFileURL(path.join(folder, entry.url)).href,
            }));
          extensions.push({
            id: `${pkg.publisher ?? 'vscode'}.${pkg.name}`,
            name: text(pkg.displayName) || pkg.name,
            description: text(pkg.description),
            publisher: pkg.publisher ?? '',
            version: pkg.version ?? '',
            folder,
            builtin,
            hasCode: Boolean(pkg.main || pkg.browser),
            activationEvents: pkg.activationEvents ?? [],
            commands: (contributes.commands ?? []).length,
            grammars,
            languages,
            themes,
            iconThemes,
            snippets,
            jsonValidation,
          });
        } catch {
          // pasta que não é uma extensão válida
        }
      }
    }
    return extensions.sort((a, b) => a.name.localeCompare(b.name));
  });

  ipcMain.handle('ext:theme', (_e, file) => readTheme(resolveInExtensions(file)));

  ipcMain.handle('ext:snippets', async (_e, file) => (await readJsonc(resolveInExtensions(file))) ?? {});

  // Arquivos das extensões (gramáticas, temas de ícones, fontes, SVGs, language-configuration).
  ipcMain.handle('ext:readText', (_e, file) => fsp.readFile(resolveInExtensions(file), 'utf8'));
  ipcMain.handle('ext:readJsonc', async (_e, file) => (await readJsonc(resolveInExtensions(file))) ?? null);
  ipcMain.handle('ext:readBinary', async (_e, file) => new Uint8Array(await fsp.readFile(resolveInExtensions(file))));

  // Motor de expressões regulares das gramáticas TextMate (o mesmo Oniguruma do VS Code).
  ipcMain.handle('tm:wasm', async () => new Uint8Array(await fsp.readFile(require.resolve('vscode-oniguruma/release/onig.wasm'))));

  workspace = registerWorkspaceIpc({
    getWin: () => win,
    getVault: () => vault,
    readConfig,
    saveConfig,
    // Leitura sem escrita: extensões do VS Code e as definições de tipos do próprio TypeScript.
    readOnlyRoots: () => {
      const modules = path.join(__dirname, '..', 'node_modules');
      return [...extensionRoots(), modules, modules.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)];
    },
    t: (key) => t(key),
  });
  terminals = registerTerminalIpc({ getWin: () => win, getCwd: () => workspace.currentRoot() });
  languageServers = registerLspIpc({ getWin: () => win });
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

  // Histórico de envios: um arquivo por vault, numa pasta oculta (fica fora das notas e da busca).
  const historyFile = () => resolveInVault(path.join(HISTORY_DIR, 'request-history.json'));
  const readHistory = async () => {
    try {
      const list = JSON.parse(await fsp.readFile(historyFile(), 'utf8'));
      return Array.isArray(list) ? list : [];
    } catch {
      return []; // ainda sem histórico, ou arquivo ilegível
    }
  };
  const writeHistory = async (list) => {
    const file = historyFile();
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(`${file}.tmp`, JSON.stringify(list));
    await fsp.rename(`${file}.tmp`, file);
  };
  // Gravações em fila: dois envios seguidos não se atropelam no mesmo arquivo.
  let historyQueue = Promise.resolve();
  const updateHistory = (change) => {
    const next = historyQueue.then(async () => writeHistory(change(await readHistory())));
    historyQueue = next.catch(() => {});
    return next;
  };

  ipcMain.handle('history:list', () => readHistory());
  ipcMain.handle('history:add', (_e, entry) => updateHistory((list) => [entry, ...list.filter((item) => item.id !== entry.id)].slice(0, MAX_HISTORY)));
  ipcMain.handle('history:remove', (_e, id) => updateHistory((list) => list.filter((item) => item.id !== id)));
  ipcMain.handle('history:clear', () => updateHistory(() => []));
}

// Menu e atalhos espelhados do Notion Desktop; ações de página vão para o renderer.
function buildMenu(lang) {
  const t = translator(lang);
  const send = (action) => () => win?.webContents.send('menu', action);
  const item = (label, accelerator, action) => ({ label, accelerator, click: send(action) });

  return Menu.buildFromTemplate([
    {
      label: t('menu.file'),
      submenu: [
        item(t('menu.newPage'), 'CmdOrCtrl+N', 'new-note'),
        item(t('menu.newTab'), 'CmdOrCtrl+T', 'new-tab'),
        item(t('menu.reopenTab'), 'CmdOrCtrl+Shift+T', 'reopen-tab'),
        item(t('menu.closeTab'), 'CmdOrCtrl+W', 'close-tab'),
        { type: 'separator' },
        item(t('menu.openVault'), 'CmdOrCtrl+O', 'choose-vault'),
        item(t('menu.settings'), 'CmdOrCtrl+,', 'settings'),
        { type: 'separator' },
        item(t('menu.exportPdf'), 'CmdOrCtrl+Shift+P', 'export-pdf'),
        { type: 'separator' },
        { role: 'quit', label: t('menu.quit'), accelerator: 'CmdOrCtrl+Shift+Q' },
      ],
    },
    {
      label: t('menu.edit'),
      submenu: [
        { role: 'undo', label: t('menu.undo') },
        { role: 'redo', label: t('menu.redo'), accelerator: 'CmdOrCtrl+Shift+Z' },
        { type: 'separator' },
        { role: 'cut', label: t('menu.cut') },
        { role: 'copy', label: t('menu.copy') },
        { role: 'paste', label: t('menu.paste') },
        { role: 'pasteAndMatchStyle', label: t('menu.pasteMatchStyle'), accelerator: 'CmdOrCtrl+Shift+V' },
        { role: 'selectAll', label: t('menu.selectAll') },
        { type: 'separator' },
        item(t('menu.copyLink'), 'CmdOrCtrl+L', 'copy-link'),
        item(t('menu.copyName'), 'CmdOrCtrl+Alt+L', 'copy-name'),
        item(t('menu.toggleFavorite'), 'CmdOrCtrl+Shift+F', 'toggle-favorite'),
      ],
    },
    {
      label: t('menu.view'),
      submenu: [
        item(t('menu.quickSwitcher'), 'CmdOrCtrl+P', 'quick-switcher'),
        item(t('menu.dailyNote'), 'CmdOrCtrl+D', 'daily-note'),
        item(t('menu.tasks'), 'CmdOrCtrl+Shift+J', 'tasks'),
        item(t('menu.whiteboards'), 'CmdOrCtrl+Shift+B', 'whiteboards'),
        item(t('menu.graph'), 'CmdOrCtrl+G', 'graph'),
        item(t('menu.requests'), 'CmdOrCtrl+Shift+E', 'requests'),
        item(t('menu.code'), 'CmdOrCtrl+Shift+K', 'code'),
        item(t('menu.toggleSidebar'), 'CmdOrCtrl+\\', 'toggle-sidebar'),
        item(t('menu.toggleRail'), 'CmdOrCtrl+Shift+\\', 'toggle-rail'),
        { type: 'separator' },
        { role: 'reload', label: t('menu.reload') },
        { role: 'forceReload', label: t('menu.forceReload') },
        { role: 'toggleDevTools', label: t('menu.devTools') },
        { type: 'separator' },
        { role: 'zoomIn', label: t('menu.zoomIn'), accelerator: 'CmdOrCtrl+=' },
        { role: 'zoomOut', label: t('menu.zoomOut') },
        { role: 'resetZoom', label: t('menu.resetZoom') },
        { role: 'togglefullscreen', label: t('menu.fullscreen') },
      ],
    },
    {
      label: t('menu.history'),
      submenu: [item(t('menu.back'), 'CmdOrCtrl+[', 'back'), item(t('menu.forward'), 'CmdOrCtrl+]', 'forward')],
    },
    {
      label: t('menu.window'),
      submenu: [
        item(t('menu.nextTab'), 'Ctrl+Tab', 'next-tab'),
        item(t('menu.prevTab'), 'Ctrl+Shift+Tab', 'prev-tab'),
        { role: 'minimize', label: t('menu.minimize') },
      ],
    },
  ]);
}

function createWindow() {
  win = new BrowserWindow({
    // OBNOTION_SIZE=LARGURAxALTURA ajusta a janela nas capturas de teste.
    width: Number(process.env.OBNOTION_SIZE?.split('x')[0]) || 1280,
    height: Number(process.env.OBNOTION_SIZE?.split('x')[1]) || 820,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: WINDOW_BACKGROUND,
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

  applySpellcheck();

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });

  // OBNOTION_DOWNLOAD_DIR=<pasta> (testes): downloads (exportações do quadro) vão direto para lá, sem diálogo.
  // Sem a variável, o Electron pergunta onde salvar.
  if (process.env.OBNOTION_DOWNLOAD_DIR) {
    win.webContents.session.on('will-download', (_event, item) => item.setSavePath(path.join(process.env.OBNOTION_DOWNLOAD_DIR, path.basename(item.getFilename()))));
  }

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

// Em modo de captura o app usa uma pasta de dados própria: nenhum teste lê nem grava o config.json
// e o localStorage reais. OBNOTION_USER_DATA=<pasta> escolhe outra; --user-data-dir tem precedência.
if (process.env.OBNOTION_SHOT && !app.commandLine.hasSwitch('user-data-dir')) {
  const testData = process.env.OBNOTION_USER_DATA || path.join(os.tmpdir(), 'obnotion-test-userdata');
  fs.mkdirSync(testData, { recursive: true });
  app.setPath('userData', testData);
}

app.whenReady().then(() => {
  loadConfig();
  registerIpc();
  createWindow();
});

// Terminais e language servers são processos filhos: saem junto com o app.
app.on('will-quit', () => {
  terminals?.disposeAll();
  languageServers?.disposeAll();
  workspace?.dispose();
});

app.on('window-all-closed', () => app.quit());
