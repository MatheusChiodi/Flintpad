'use strict';

// Terminal integrado: um pseudo-terminal por guia, como o painel Terminal do VS Code.
// Os processos vivem aqui, não na aba: sair da aba Código e voltar não perde a sessão.

const { ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const MAX_SCROLLBACK_CHARS = 256 * 1024;

// O VS Code abre o PowerShell no Windows; o pwsh (PowerShell 7) vence quando está instalado.
function defaultShell() {
  if (process.platform !== 'win32') return process.env.SHELL || '/bin/bash';
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (dir && fs.existsSync(path.join(dir, 'pwsh.exe'))) return path.join(dir, 'pwsh.exe');
  }
  return 'powershell.exe';
}

function registerTerminalIpc({ getWin, getCwd }) {
  let pty = null;
  const terminals = new Map();
  let nextId = 1;

  const send = (channel, ...args) => {
    const win = getWin();
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
  };

  ipcMain.handle('term:create', (_e, { cols, rows }) => {
    pty ??= require('@lydell/node-pty');
    const shell = defaultShell();
    const cwd = getCwd() && fs.existsSync(getCwd()) ? getCwd() : process.env.USERPROFILE || process.cwd();
    const env = { ...process.env, TERM_PROGRAM: 'ObNotion', COLORTERM: 'truecolor' };
    delete env.ELECTRON_RUN_AS_NODE;
    const proc = pty.spawn(shell, [], { name: 'xterm-256color', cols: Math.max(2, cols | 0), rows: Math.max(1, rows | 0), cwd, env, useConpty: true });
    const id = nextId++;
    const terminal = { id, title: path.basename(shell, '.exe'), cwd, proc, buffer: '' };
    terminals.set(id, terminal);
    proc.onData((data) => {
      terminal.buffer = (terminal.buffer + data).slice(-MAX_SCROLLBACK_CHARS);
      send('term:data', id, data);
    });
    proc.onExit(({ exitCode }) => {
      terminals.delete(id);
      send('term:exit', id, exitCode);
    });
    return { id, title: terminal.title, cwd };
  });

  ipcMain.handle('term:list', () => [...terminals.values()].map(({ id, title, cwd, buffer }) => ({ id, title, cwd, buffer })));

  ipcMain.handle('term:write', (_e, id, data) => terminals.get(id)?.proc.write(data));

  ipcMain.handle('term:resize', (_e, id, cols, rows) => {
    try {
      terminals.get(id)?.proc.resize(Math.max(2, cols | 0), Math.max(1, rows | 0));
    } catch {
      // o processo acabou de sair
    }
  });

  ipcMain.handle('term:kill', (_e, id) => terminals.get(id)?.proc.kill());

  return {
    disposeAll() {
      for (const terminal of terminals.values()) terminal.proc.kill();
      terminals.clear();
    },
  };
}

module.exports = { registerTerminalIpc };
