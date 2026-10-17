'use strict';

// Terminal integrado: um pseudo-terminal por guia, como o painel Terminal do VS Code.
// Os processos vivem aqui, não na aba: sair da aba Código e voltar não perde a sessão.

const { ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const MAX_SCROLLBACK_CHARS = 256 * 1024;

// Procura um executável no PATH. Os "aliases de execução" da Microsoft Store (pasta WindowsApps) ficam de fora:
// existem no disco como arquivos vazios e, abertos pelo ConPTY, falham ou fecham na hora.
function findInPath(names) {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir || /[\/]WindowsApps[\/]?$/i.test(dir)) continue;
    for (const name of names) {
      const file = path.join(dir, name);
      try {
        if (fs.statSync(file).size > 0) return file;
      } catch {
        // não está nesta pasta
      }
    }
  }
  return null;
}

// O VS Code abre o PowerShell no Windows; o pwsh (PowerShell 7) vence quando está instalado.
// Devolve a lista em ordem de preferência: se um não abrir, tenta o próximo.
function shellCandidates() {
  if (process.platform !== 'win32') return [process.env.SHELL || '/bin/bash', '/bin/sh'];
  const system = process.env.SystemRoot || 'C:\Windows';
  return [
    findInPath(['pwsh.exe']),
    path.join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    process.env.ComSpec || path.join(system, 'System32', 'cmd.exe'),
  ].filter((shell, index, list) => shell && fs.existsSync(shell) && list.indexOf(shell) === index);
}

// Claude Code instalado? Procura no PATH o executável (instalador nativo) ou o atalho do npm.
function findClaude() {
  return findInPath(process.platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude']);
}

function registerTerminalIpc({ getWin, getCwd }) {
  let pty = null;
  const terminals = new Map();
  let nextId = 1;

  const send = (channel, ...args) => {
    const win = getWin();
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
  };

  // `run`: comando digitado no shell assim que ele mostra a primeira saída (o Claude Code, por exemplo).
  ipcMain.handle('term:create', (_e, { cols, rows, run, title }) => {
    pty ??= require('@lydell/node-pty');
    const cwd = getCwd() && fs.existsSync(getCwd()) ? getCwd() : process.env.USERPROFILE || process.env.HOME || process.cwd();
    const env = { ...process.env, TERM_PROGRAM: 'Flintpad', COLORTERM: 'truecolor' };
    delete env.ELECTRON_RUN_AS_NODE;
    // Flintpad aberto de dentro de uma sessão do Claude Code: as marcas dela não passam para o Claude daqui.
    for (const key of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_CHILD_SESSION']) delete env[key];
    const size = { cols: Math.max(2, cols | 0), rows: Math.max(1, rows | 0) };
    let proc = null;
    let shell = null;
    const failures = [];
    for (const candidate of shellCandidates()) {
      try {
        proc = pty.spawn(candidate, [], { name: 'xterm-256color', ...size, cwd, env, useConpty: true });
        shell = candidate;
        break;
      } catch (error) {
        failures.push(`${path.basename(candidate)}: ${error.message}`);
      }
    }
    if (!proc) throw new Error(failures.join(' · ') || 'nenhum shell encontrado');
    const id = nextId++;
    const terminal = { id, title: title || path.basename(shell, '.exe'), cwd, proc, buffer: '' };
    terminals.set(id, terminal);
    let pendingRun = typeof run === 'string' && run ? run : null;
    proc.onData((data) => {
      terminal.buffer = (terminal.buffer + data).slice(-MAX_SCROLLBACK_CHARS);
      send('term:data', id, data);
      if (pendingRun) {
        proc.write(`${pendingRun}\r`);
        pendingRun = null;
      }
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

  ipcMain.handle('term:claude', () => findClaude());

  return {
    disposeAll() {
      for (const terminal of terminals.values()) terminal.proc.kill();
      terminals.clear();
    },
  };
}

module.exports = { registerTerminalIpc };
