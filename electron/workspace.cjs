'use strict';

// Pasta de trabalho da aba Código: qualquer pasta do disco, como o "Abrir pasta" do VS Code.
// O renderer fala em caminhos absolutos; cada um passa pela checagem de raízes permitidas.

const { dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

const MAX_QUICK_OPEN_FILES = 20000;
const MAX_RECENT = 10;
const WATCH_DEBOUNCE_MS = 250;
// O que o VS Code esconde por padrão (files.exclude) e o que a busca de arquivos pula (search.exclude).
const HIDDEN = new Set(['.git', '.svn', '.hg', '.DS_Store', 'Thumbs.db']);
const NOT_SEARCHED = new Set([...HIDDEN, 'node_modules', 'bower_components']);
const BINARY_SNIFF_BYTES = 8000;

const norm = (p) => path.resolve(p).toLowerCase();
const isInside = (child, parent) => {
  const c = norm(child);
  const p = norm(parent);
  return c === p || c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
};

function registerWorkspaceIpc({ getWin, getVault, readConfig, saveConfig, readOnlyRoots, t }) {
  const saved = readConfig();
  // Várias pastas abertas ao mesmo tempo (workspace com várias raízes, como no VS Code); a primeira é a principal.
  let roots = (saved.codeRoots ?? (saved.codeRoot ? [saved.codeRoot] : [])).filter((dir) => typeof dir === 'string' && fs.existsSync(dir));
  let recent = (saved.codeRecent ?? []).filter((dir) => typeof dir === 'string');
  // Arquivos abertos avulsos pelo diálogo: valem só nesta sessão.
  const openedFiles = new Set();
  let watchers = [];
  let pending = new Set();
  let timer = null;

  const currentRoots = () => (roots.length ? roots : [getVault()].filter(Boolean));
  const currentRoot = () => currentRoots()[0] ?? null;

  const writable = (abs) => [...currentRoots(), getVault()].filter(Boolean).some((dir) => isInside(abs, dir)) || openedFiles.has(norm(abs));
  const readable = (abs) => writable(abs) || readOnlyRoots().some((dir) => isInside(abs, dir));

  const guard = (abs, write = false) => {
    if (typeof abs !== 'string' || !path.isAbsolute(abs)) throw new Error(t('error.outsideWorkspace'));
    const full = path.resolve(abs);
    if (!(write ? writable(full) : readable(full))) throw new Error(t('error.outsideWorkspace'));
    return full;
  };

  // Um vigia por pasta aberta: avisa o renderer quais pastas mudaram, em lotes.
  function watch() {
    for (const watcher of watchers) watcher.close();
    watchers = [];
    for (const dir of currentRoots()) watchRoot(dir);
  }

  function watchRoot(dir) {
    try {
      const watcher = fs.watch(dir, { recursive: true }, (_event, file) => {
        if (!file) return;
        const parts = String(file).split(/[\\/]/);
        if (parts.some((part) => part === '.git' || part === 'node_modules')) return;
        pending.add(path.join(dir, path.dirname(String(file))));
        pending.add(path.join(dir, String(file)));
        clearTimeout(timer);
        timer = setTimeout(() => {
          const changed = [...pending];
          pending = new Set();
          getWin()?.webContents.send('ws:changed', changed);
        }, WATCH_DEBOUNCE_MS);
      });
      watcher.on('error', () => {
        // pasta removida ou sem permissão: o explorador segue sem atualização automática
      });
      watchers.push(watcher);
    } catch {
      // sistema de arquivos sem suporte a vigia recursivo
    }
  }

  async function setRoots(next) {
    roots = next.filter((dir, index) => next.findIndex((other) => norm(other) === norm(dir)) === index);
    for (const dir of roots) recent = [dir, ...recent.filter((item) => norm(item) !== norm(dir))];
    recent = recent.slice(0, MAX_RECENT);
    await saveConfig({ codeRoots: roots, codeRoot: roots[0] ?? null, codeRecent: recent });
    watch();
    return state();
  }
  const setRoot = (dir) => setRoots([dir]);

  const state = () => ({ root: currentRoot(), roots: currentRoots(), recent, vault: getVault() });

  let watching = false;
  ipcMain.handle('ws:get', () => {
    if (!watching) {
      watching = true;
      watch();
    }
    return state();
  });

  // Adicionar pasta ao workspace: abre ao lado das que já estão no explorador.
  ipcMain.handle('ws:addFolder', async () => {
    const result = await dialog.showOpenDialog(getWin(), { title: t('dialog.addFolder'), properties: ['openDirectory', 'createDirectory', 'multiSelections'] });
    if (result.canceled || !result.filePaths.length) return null;
    return setRoots([...currentRoots(), ...result.filePaths]);
  });

  ipcMain.handle('ws:removeFolder', (_e, dir) => setRoots(currentRoots().filter((item) => norm(item) !== norm(dir ?? ''))));

  ipcMain.handle('ws:openFolder', async () => {
    const result = await dialog.showOpenDialog(getWin(), { title: t('dialog.openFolder'), properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    return setRoot(result.filePaths[0]);
  });

  // Só reabre pastas que o próprio usuário escolheu antes (recentes) ou o vault.
  ipcMain.handle('ws:setRoot', async (_e, dir) => {
    const known = [...recent, getVault()].filter(Boolean).some((item) => norm(item) === norm(dir ?? ''));
    if (!known || !fs.existsSync(dir)) throw new Error(t('error.outsideWorkspace'));
    return setRoot(dir);
  });

  ipcMain.handle('ws:openFile', async () => {
    const result = await dialog.showOpenDialog(getWin(), { title: t('dialog.openFile'), properties: ['openFile', 'multiSelections'] });
    if (result.canceled) return [];
    for (const file of result.filePaths) openedFiles.add(norm(file));
    return result.filePaths;
  });

  ipcMain.handle('ws:saveAs', async (_e, suggested) => {
    const result = await dialog.showSaveDialog(getWin(), { title: t('dialog.saveAs'), defaultPath: suggested ? path.resolve(suggested) : currentRoot() ?? undefined });
    if (result.canceled || !result.filePath) return null;
    openedFiles.add(norm(result.filePath));
    return result.filePath;
  });

  ipcMain.handle('ws:readDir', async (_e, dir) => {
    const full = guard(dir);
    const entries = await fsp.readdir(full, { withFileTypes: true });
    return entries
      .filter((entry) => !HIDDEN.has(entry.name))
      .map((entry) => ({ name: entry.name, path: path.join(full, entry.name), dir: entry.isDirectory() }))
      .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) : a.dir ? -1 : 1));
  });

  ipcMain.handle('ws:listFiles', async () => {
    const out = [];
    const visit = async (dir) => {
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return; // pasta sem permissão
      }
      for (const entry of entries) {
        if (out.length >= MAX_QUICK_OPEN_FILES) return;
        if (NOT_SEARCHED.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await visit(full);
        else out.push(full);
      }
    };
    for (const base of currentRoots()) await visit(base);
    return out;
  });

  ipcMain.handle('ws:read', async (_e, file) => {
    const full = guard(file);
    const buffer = await fsp.readFile(full);
    if (buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0)) throw new Error(t('error.binaryFile'));
    return buffer.toString('utf8');
  });

  ipcMain.handle('ws:write', (_e, file, content) => fsp.writeFile(guard(file, true), content, 'utf8'));

  ipcMain.handle('ws:create', async (_e, target, isDir) => {
    const full = guard(target, true);
    if (fs.existsSync(full)) throw new Error(t('error.exists'));
    if (isDir) await fsp.mkdir(full, { recursive: true });
    else {
      await fsp.mkdir(path.dirname(full), { recursive: true });
      await fsp.writeFile(full, '', 'utf8');
    }
    return full;
  });

  ipcMain.handle('ws:rename', async (_e, from, to) => {
    const source = guard(from, true);
    const target = guard(to, true);
    if (norm(source) !== norm(target) && fs.existsSync(target)) throw new Error(t('error.exists'));
    await fsp.rename(source, target);
    return target;
  });

  ipcMain.handle('ws:delete', (_e, target) => shell.trashItem(guard(target, true)));

  ipcMain.handle('ws:reveal', (_e, target) => shell.showItemInFolder(guard(target)));

  // O language server devolve caminhos em minúsculas; aqui volta a grafia real do disco.
  ipcMain.handle('ws:realpath', async (_e, target) => {
    try {
      return await fsp.realpath.native(guard(target));
    } catch {
      return null;
    }
  });

  ipcMain.handle('ws:stat', async (_e, target) => {
    try {
      const stat = await fsp.stat(guard(target));
      return { dir: stat.isDirectory(), size: stat.size, mtime: stat.mtimeMs };
    } catch {
      return null;
    }
  });

  return { currentRoot, dispose: () => watchers.forEach((watcher) => watcher.close()) };
}

module.exports = { registerWorkspaceIpc };
