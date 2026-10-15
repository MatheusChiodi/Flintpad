// Language servers no editor: o cliente LSP do Monaco fala com processos lançados pelo processo
// principal. A camada de transporte daqui corrige o que o cliente embutido não faz sozinho:
// - informa a pasta aberta (rootUri/workspaceFolders) e responde workspace/configuration;
// - entrega a cada servidor só os arquivos das linguagens dele;
// - abre como modelo o arquivo de destino de "ir para definição" antes de a resposta chegar ao cliente.
import * as monaco from 'monaco-editor';

import { samePath } from './paths';
import type { VsJsonValidation } from './vscode';

export type ServerKind = 'typescript' | 'json' | 'css' | 'html';
export type ServerStatus = 'off' | 'starting' | 'ready' | 'error';

export const SERVER_LANGUAGES: Record<ServerKind, string[]> = {
  typescript: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
  json: ['json', 'jsonc'],
  css: ['css', 'scss', 'less'],
  html: ['html'],
};

export const SERVER_LABELS: Record<ServerKind, string> = { typescript: 'TypeScript', json: 'JSON', css: 'CSS', html: 'HTML' };

const serverFor = (languageId: string) => (Object.keys(SERVER_LANGUAGES) as ServerKind[]).find((kind) => SERVER_LANGUAGES[kind].includes(languageId));

type Transport = ConstructorParameters<typeof monaco.lsp.MonacoLspClient>[0];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Message = { jsonrpc: '2.0'; id?: any; method?: string; params?: any; result?: any; error?: any };
type Listener = (message: Message) => void;

// Capacidades do servidor que viram provedores no Monaco: recebem o seletor de linguagens do servidor.
const PROVIDER_CAPABILITIES = [
  'completionProvider', 'hoverProvider', 'signatureHelpProvider', 'definitionProvider', 'referencesProvider', 'documentHighlightProvider',
  'documentSymbolProvider', 'codeActionProvider', 'codeLensProvider', 'documentLinkProvider', 'documentFormattingProvider',
  'documentRangeFormattingProvider', 'documentOnTypeFormattingProvider', 'renameProvider', 'foldingRangeProvider', 'declarationProvider',
  'typeDefinitionProvider', 'implementationProvider', 'colorProvider', 'selectionRangeProvider', 'linkedEditingRangeProvider',
  'callHierarchyProvider', 'inlayHintProvider', 'inlineValueProvider', 'diagnosticProvider', 'monikerProvider', 'typeHierarchyProvider',
];
// O Monaco já tem cores, dobras e seleção por sintaxe; o realce semântico brigaria com o TextMate.
const SKIPPED_CAPABILITIES = ['semanticTokensProvider'];

// Configurações que o VS Code mandaria (as padrão de cada extensão de linguagem).
function settingsFor(kind: ServerKind, schemas: VsJsonValidation[]): Record<string, unknown> {
  const css = { validate: true, completion: { triggerPropertyValueCompletion: true, completePropertyWithSemicolon: true }, hover: { documentation: true, references: true }, format: { enable: true } };
  switch (kind) {
    case 'json':
      return {
        json: { schemas: jsonSchemaSettings(schemas), validate: { enable: true }, format: { enable: true }, resultLimit: 5000 },
        http: { proxyStrictSSL: true },
      };
    case 'css':
      return { css, scss: css, less: css };
    case 'html':
      return {
        html: { format: { enable: true, wrapLineLength: 120, wrapAttributes: 'auto' }, suggest: { html5: true }, validate: { scripts: true, styles: true }, autoClosingTags: true, hover: { documentation: true, references: true } },
        css,
        javascript: { validate: { enable: true } },
      };
    default:
      return { typescript: { preferences: { quoteStyle: 'auto' } }, javascript: { preferences: { quoteStyle: 'auto' } } };
  }
}

// Como o cliente JSON do VS Code: "package.json" vira "/package.json" (casa com o fim do caminho).
// Esquemas internos do VS Code (vscode://, settings do usuário) não existem aqui e ficam de fora.
function jsonSchemaSettings(schemas: VsJsonValidation[]) {
  return schemas
    .filter((schema) => /^(https?|file):/i.test(schema.url))
    .map((schema) => ({
      url: schema.url,
      fileMatch: schema.fileMatch.filter((pattern) => !pattern.includes('%') && !pattern.includes('://')).map((pattern) => (/^[/!]/.test(pattern) ? pattern : `/${pattern}`)),
    }))
    .filter((schema) => schema.fileMatch.length > 0);
}

const INITIALIZATION_OPTIONS: Partial<Record<ServerKind, unknown>> = {
  json: { provideFormatter: true, handledSchemaProtocols: ['file'] },
  css: { provideFormatter: true },
  html: { provideFormatter: true, embeddedLanguages: { css: true, javascript: true }, configurationSection: ['html', 'css', 'javascript'] },
};

const section = (settings: Record<string, unknown>, path?: string) => {
  if (!path) return settings;
  let value: unknown = settings;
  for (const part of path.split('.')) value = value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined;
  return value ?? null;
};

// ---------- Modelos ----------

type ModelOpener = (path: string) => Promise<monaco.editor.ITextModel | null>;
let openModel: ModelOpener = async () => null;

/** O workbench informa como abrir um arquivo como modelo (lendo do disco e escolhendo a linguagem). */
export const setModelOpener = (opener: ModelOpener) => {
  openModel = opener;
};

export const findModel = (uri: string | monaco.Uri) => {
  const target = typeof uri === 'string' ? monaco.Uri.parse(uri) : uri;
  return monaco.editor.getModels().find((model) => model.uri.scheme === target.scheme && samePath(model.uri.fsPath, target.fsPath)) ?? null;
};

// Os servidores devolvem URIs com %3A ou em minúsculas; o cliente compara em minúsculas sem codificação.
function normalizeUris(value: unknown, found: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeUris(item, found));
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if ((key === 'uri' || key === 'targetUri') && typeof item === 'string' && item.startsWith('file:')) {
      const uri = monaco.Uri.parse(item);
      found.add(uri.toString());
      out[key] = uri.toString(true);
    } else if (key === 'changes' && item && typeof item === 'object' && !Array.isArray(item)) {
      // WorkspaceEdit.changes: as chaves do objeto são URIs.
      out[key] = Object.fromEntries(Object.entries(item).map(([uri, edits]) => [monaco.Uri.parse(uri).toString(true), normalizeUris(edits, found)]));
    } else out[key] = normalizeUris(item, found);
  }
  return out;
}

// ---------- Transporte ----------

class IpcTransport implements Transport {
  readonly state = {
    value: { state: 'open' as const },
    onChange: () => ({ dispose() {} }),
  } as unknown as Transport['state'];
  private listener: Listener | undefined;
  private queue: Promise<void> = Promise.resolve();
  private initializeId: number | string | undefined;
  private readonly openUris = new Set<string>();
  private readonly offMessage: () => void;

  constructor(
    private readonly kind: ServerKind,
    private readonly root: string | null,
    private readonly schemas: VsJsonValidation[],
    private readonly onReady: () => void,
  ) {
    this.offMessage = window.api.lsp.onMessage((from, body) => {
      if (from !== kind) return;
      let message: Message;
      try {
        message = JSON.parse(body);
      } catch {
        return;
      }
      // Em fila: a resposta só segue depois de o arquivo de destino virar modelo.
      this.queue = this.queue.then(() => this.receive(message)).catch((error) => console.warn(`[lsp:${kind}]`, error));
    });
  }

  dispose() {
    this.offMessage();
    this.listener = undefined;
  }

  setListener(listener: Parameters<Transport['setListener']>[0]) {
    this.listener = listener as Listener | undefined;
  }

  toString() {
    return `ipc:${this.kind}`;
  }

  private post(message: Message) {
    void window.api.lsp.send(this.kind, JSON.stringify(message));
  }

  private get rootUri() {
    return this.root ? monaco.Uri.file(this.root).toString() : null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async send(input: any) {
    let message = input as Message;
    const { method, params } = message;
    if (method === 'initialize') {
      this.initializeId = message.id;
      const capabilities = { ...params.capabilities };
      // Sem diagnóstico "pull", os servidores de JSON/CSS/HTML enviam os erros sozinhos e reavaliam
      // quando o esquema chega (o cliente do Monaco não atende workspace/diagnostic/refresh).
      if (this.kind !== 'typescript' && capabilities.textDocument) {
        capabilities.textDocument = { ...capabilities.textDocument };
        delete capabilities.textDocument.diagnostic;
      }
      message = {
        ...message,
        params: {
          ...params,
          processId: null,
          clientInfo: { name: 'Flintpad' },
          rootUri: this.rootUri,
          rootPath: this.root,
          workspaceFolders: this.root ? [{ uri: this.rootUri, name: this.root.split(/[\\/]/).pop() }] : null,
          initializationOptions: INITIALIZATION_OPTIONS[this.kind],
          capabilities: { ...capabilities, workspace: { ...capabilities.workspace, configuration: true, workspaceFolders: true, didChangeConfiguration: { dynamicRegistration: false } } },
        },
      };
    } else if (method === 'textDocument/didOpen') {
      if (!SERVER_LANGUAGES[this.kind].includes(params.textDocument.languageId)) return;
      this.openUris.add(params.textDocument.uri);
    } else if (method?.startsWith('textDocument/did') || method === 'textDocument/willSave') {
      const uri = params?.textDocument?.uri;
      if (!this.openUris.has(uri)) return;
      if (method === 'textDocument/didClose') this.openUris.delete(uri);
    }
    this.post(message);
    if (method === 'initialized') {
      this.post({ jsonrpc: '2.0', method: 'workspace/didChangeConfiguration', params: { settings: settingsFor(this.kind, this.schemas) } });
      this.onReady();
    }
  }

  private reply(id: Message['id'], result: unknown, error?: { code: number; message: string }) {
    this.post(error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result });
  }

  private async receive(raw: Message) {
    // Pedidos do servidor que o cliente embutido não sabe atender.
    if (raw.method && raw.id !== undefined) {
      switch (raw.method) {
        case 'workspace/configuration':
          return this.reply(raw.id, (raw.params?.items ?? []).map((item: { section?: string }) => section(settingsFor(this.kind, this.schemas), item.section)));
        case 'workspace/workspaceFolders':
          return this.reply(raw.id, this.root ? [{ uri: this.rootUri, name: this.root.split(/[\\/]/).pop() }] : null);
        case 'window/workDoneProgress/create':
        case 'window/showMessageRequest':
        case 'workspace/diagnostic/refresh':
        case 'workspace/semanticTokens/refresh':
        case 'workspace/inlayHint/refresh':
        case 'workspace/codeLens/refresh':
          return this.reply(raw.id, null);
        case 'vscode/content':
          try {
            return this.reply(raw.id, await window.api.lsp.fetch(String(Array.isArray(raw.params) ? raw.params[0] : (raw.params?.uri ?? raw.params))));
          } catch (error) {
            return this.reply(raw.id, null, { code: -32603, message: error instanceof Error ? error.message : String(error) });
          }
        case 'workspace/applyEdit':
          return this.reply(raw.id, { applied: await applyWorkspaceEdit(raw.params?.edit) });
      }
    }

    const found = new Set<string>();
    let message = normalizeUris(raw, found) as Message;

    if (message.method === 'textDocument/publishDiagnostics' && !findModel(message.params.uri)) return;
    // Notificações que o cliente embutido não trata ficam por aqui.
    if (message.method && message.id === undefined && !message.method.startsWith('textDocument/') && !message.method.startsWith('$/')) return;
    if (message.method === '$/progress' || message.method === '$/logTrace') return;

    if (message.id !== undefined && message.id === this.initializeId && message.result?.capabilities) {
      const capabilities = { ...message.result.capabilities };
      const selector = SERVER_LANGUAGES[this.kind].map((language) => ({ language }));
      for (const key of SKIPPED_CAPABILITIES) delete capabilities[key];
      // Diagnóstico vem por push nesses servidores (ver initialize): sem pull, nada sai em dobro.
      if (this.kind !== 'typescript') delete capabilities.diagnosticProvider;
      for (const key of PROVIDER_CAPABILITIES) {
        if (!capabilities[key]) continue;
        capabilities[key] = { ...(typeof capabilities[key] === 'object' ? capabilities[key] : {}), documentSelector: selector };
      }
      message = { ...message, result: { ...message.result, capabilities } };    }

    // Respostas que apontam para arquivos ainda fechados (definição, referências...): abre antes.
    if (message.id !== undefined && !message.method) {
      for (const uri of found) {
        if (findModel(uri)) continue;
        const path = monaco.Uri.parse(uri).fsPath;
        await openModel((await window.api.ws.realpath(path)) ?? path).catch(() => null);
      }
    }
    this.listener?.(message as never);
  }
}

async function applyWorkspaceEdit(edit: { changes?: Record<string, { range: any; newText: string }[]>; documentChanges?: { textDocument?: { uri: string }; edits?: { range: any; newText: string }[] }[] } | undefined) {
  if (!edit) return false;
  const groups: [string, { range: any; newText: string }[]][] = [
    ...Object.entries(edit.changes ?? {}),
    ...(edit.documentChanges ?? []).filter((change) => change.textDocument && change.edits).map((change) => [change.textDocument!.uri, change.edits!] as [string, { range: any; newText: string }[]]),
  ];
  for (const [uri, edits] of groups) {
    const model = findModel(uri) ?? (await openModel(monaco.Uri.parse(uri).fsPath));
    if (!model) return false;
    model.pushEditOperations(
      [],
      edits.map((e) => ({ range: new monaco.Range(e.range.start.line + 1, e.range.start.character + 1, e.range.end.line + 1, e.range.end.character + 1), text: e.newText })),
      () => null,
    );
  }
  return true;
}

// ---------- Ciclo de vida ----------

type Running = { transport: IpcTransport; client: Client };

const running = new Map<ServerKind, Running>();
const status = new Map<ServerKind, ServerStatus>();
const statusListeners = new Set<() => void>();
let workspaceRoot: string | null = null;
let jsonSchemas: VsJsonValidation[] = [];

const setStatus = (kind: ServerKind, next: ServerStatus) => {
  status.set(kind, next);
  statusListeners.forEach((listener) => listener());
};

export const serverStatus = (kind: ServerKind) => status.get(kind) ?? 'off';
export const onServerStatus = (listener: () => void) => {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
};
export const serverForLanguage = serverFor;

// Guarda as features para poder desfazer os provedores ao parar o servidor.
class Client extends monaco.lsp.MonacoLspClient {
  declare features: monaco.IDisposable;
  protected createFeatures() {
    const features = super.createFeatures();
    this.features = features;
    return features;
  }
}

// Os workers internos do Monaco fariam sugestões e erros em dobro com o servidor ligado.
function setBuiltins(kind: ServerKind, enabled: boolean) {
  const all = { completionItems: enabled, hovers: enabled, documentSymbols: enabled, definitions: enabled, references: enabled, documentHighlights: enabled, rename: enabled, diagnostics: enabled, documentRangeFormattingEdits: enabled, signatureHelp: enabled, onTypeFormattingEdits: enabled, codeActions: enabled, inlayHints: enabled };
  if (kind === 'typescript') {
    for (const defaults of [monaco.typescript.typescriptDefaults, monaco.typescript.javascriptDefaults]) defaults.setModeConfiguration(all);
  } else if (kind === 'json') {
    const current = monaco.json.jsonDefaults.modeConfiguration;
    monaco.json.jsonDefaults.setModeConfiguration({ ...current, completionItems: enabled, hovers: enabled, documentSymbols: enabled, diagnostics: enabled, documentFormattingEdits: enabled, documentRangeFormattingEdits: enabled });
  } else if (kind === 'css') {
    for (const defaults of [monaco.css.cssDefaults, monaco.css.scssDefaults, monaco.css.lessDefaults]) {
      defaults.setModeConfiguration({ ...defaults.modeConfiguration, completionItems: enabled, hovers: enabled, documentSymbols: enabled, definitions: enabled, references: enabled, documentHighlights: enabled, rename: enabled, diagnostics: enabled, documentFormattingEdits: enabled, documentRangeFormattingEdits: enabled });
    }
  } else if (kind === 'html') {
    monaco.html.htmlDefaults.setModeConfiguration({ ...monaco.html.htmlDefaults.modeConfiguration, completionItems: enabled, hovers: enabled, documentSymbols: enabled, documentHighlights: enabled, rename: enabled, documentFormattingEdits: enabled, documentRangeFormattingEdits: enabled, links: enabled });
  }
}

function stop(kind: ServerKind) {
  const server = running.get(kind);
  if (!server) return;
  running.delete(kind);
  server.transport.dispose();
  server.client.features?.dispose();
  (server.client as unknown as { _bridge?: monaco.IDisposable })._bridge?.dispose();
  void window.api.lsp.stop(kind);
  setBuiltins(kind, true);
  setStatus(kind, 'off');
}

async function start(kind: ServerKind) {
  if (running.has(kind) || serverStatus(kind) === 'error') return;
  setStatus(kind, 'starting');
  const result = await window.api.lsp.start(kind, workspaceRoot);
  if (result.error) {
    console.warn(`[lsp:${kind}]`, result.error);
    setStatus(kind, 'error');
    return;
  }
  const transport = new IpcTransport(kind, workspaceRoot, jsonSchemas, () => {
    setBuiltins(kind, false);
    setStatus(kind, 'ready');
  });
  running.set(kind, { transport, client: new Client(transport) });
}

/** Liga o servidor da linguagem, se houver um e ainda não estiver rodando. */
export function ensureServer(languageId: string) {
  const kind = serverFor(languageId);
  if (kind) void start(kind);
}

/** Pasta aberta mudou (ou os esquemas): os servidores recomeçam do zero na próxima abertura. */
export function configureServers(root: string | null, schemas: VsJsonValidation[]) {
  const changed = root !== workspaceRoot;
  workspaceRoot = root;
  jsonSchemas = schemas;
  if (changed) restartServers();
}

export function restartServers() {
  for (const kind of [...running.keys()]) stop(kind);
  for (const kind of Object.keys(SERVER_LANGUAGES) as ServerKind[]) if (status.get(kind) === 'error') setStatus(kind, 'off');
  for (const model of monaco.editor.getModels()) ensureServer(model.getLanguageId());
}

// Servidor que caiu: volta aos workers do Monaco e marca o erro na barra de status.
window.api.lsp.onExit((kind, reason) => {
  if (!running.has(kind as ServerKind)) return;
  console.warn(`[lsp:${kind}] saiu: ${reason}`);
  stop(kind as ServerKind);
  setStatus(kind as ServerKind, 'error');
});
