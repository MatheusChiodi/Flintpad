'use strict';

// Language servers: os mesmos que o VS Code usa (tsserver nativo do TypeScript 7 e os servidores
// de JSON, CSS e HTML extraídos do VS Code). Aqui só se lança o processo e se enquadra o JSON-RPC;
// o protocolo em si é falado pelo cliente LSP do Monaco, no renderer.

const { app, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const MAX_SCHEMA_BYTES = 5 * 1024 * 1024;

// Dentro do pacote, executáveis e scripts lançados como processo saem do app.asar.unpacked.
const unpacked = (file) => file.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

function nodeServer(script) {
  return () => ({
    command: process.execPath,
    args: [unpacked(require.resolve(script)), '--stdio'],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  });
}

const SERVERS = {
  typescript: () => {
    const pkg = require.resolve(`@typescript/typescript-${process.platform}-${process.arch}/package.json`);
    const exe = unpacked(path.join(path.dirname(pkg), 'lib', process.platform === 'win32' ? 'tsc.exe' : 'tsc'));
    return { command: exe, args: ['--lsp', '--stdio'], env: {} };
  },
  json: nodeServer('vscode-langservers-extracted/lib/json-language-server/node/jsonServerMain.js'),
  css: nodeServer('vscode-langservers-extracted/lib/css-language-server/node/cssServerMain.js'),
  html: nodeServer('vscode-langservers-extracted/lib/html-language-server/node/htmlServerMain.js'),
};

function registerLspIpc({ getWin }) {
  const running = new Map();

  const send = (channel, ...args) => {
    const win = getWin();
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
  };

  function stop(kind) {
    const server = running.get(kind);
    if (!server) return;
    running.delete(kind);
    server.proc.kill();
  }

  ipcMain.handle('lsp:start', (_e, kind, cwd) => {
    if (!SERVERS[kind]) return { error: `unknown server ${kind}` };
    stop(kind);
    let spec;
    try {
      spec = SERVERS[kind]();
      if (!fs.existsSync(spec.command) && path.isAbsolute(spec.command)) throw new Error(`not found: ${spec.command}`);
    } catch (error) {
      return { error: error.message };
    }
    const proc = spawn(spec.command, spec.args, {
      cwd: cwd && fs.existsSync(cwd) ? cwd : app.getPath('home'),
      env: { ...process.env, ...spec.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const server = { proc, buffer: Buffer.alloc(0) };
    running.set(kind, server);

    // Mensagens LSP: cabeçalho "Content-Length: N" + linha em branco + N bytes de JSON.
    proc.stdout.on('data', (chunk) => {
      server.buffer = Buffer.concat([server.buffer, chunk]);
      for (;;) {
        const headerEnd = server.buffer.indexOf('\r\n\r\n');
        if (headerEnd < 0) return;
        const length = Number(/Content-Length:\s*(\d+)/i.exec(server.buffer.subarray(0, headerEnd).toString('ascii'))?.[1]);
        const start = headerEnd + 4;
        if (!Number.isFinite(length)) {
          server.buffer = server.buffer.subarray(start);
          continue;
        }
        if (server.buffer.length < start + length) return;
        const body = server.buffer.subarray(start, start + length).toString('utf8');
        server.buffer = server.buffer.subarray(start + length);
        if (running.get(kind) === server) send('lsp:message', kind, body);
      }
    });
    proc.stderr.on('data', (chunk) => {
      if (process.env.FLINTPAD_LSP_LOG) console.log(`[lsp:${kind}]`, chunk.toString());
    });
    proc.on('error', (error) => {
      if (running.get(kind) === server) {
        running.delete(kind);
        send('lsp:exit', kind, error.message);
      }
    });
    proc.on('exit', (code) => {
      if (running.get(kind) === server) {
        running.delete(kind);
        send('lsp:exit', kind, `exit ${code}`);
      }
    });
    return { ok: true };
  });

  ipcMain.handle('lsp:send', (_e, kind, body) => {
    const server = running.get(kind);
    if (!server) return;
    const bytes = Buffer.from(body, 'utf8');
    server.proc.stdin.write(`Content-Length: ${bytes.length}\r\n\r\n`);
    server.proc.stdin.write(bytes);
  });

  ipcMain.handle('lsp:stop', (_e, kind) => stop(kind));

  // Esquemas JSON remotos (schemastore e afins), pedidos pelo servidor de JSON via "vscode/content".
  ipcMain.handle('lsp:fetch', async (_e, url) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('unsupported scheme');
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const text = await response.text();
    if (text.length > MAX_SCHEMA_BYTES) throw new Error('schema too large');
    return text;
  });

  return {
    disposeAll() {
      for (const kind of [...running.keys()]) stop(kind);
    },
  };
}

module.exports = { registerLspIpc };
