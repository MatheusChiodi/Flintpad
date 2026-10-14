import type { Language } from './lib/i18n';
import type { VsExtension, VsSnippet, VsTheme } from './lib/vscode';
import type { BruRequest, Environment, EnvVar, HistoryEntry, HttpResult, OutgoingRequest, RequestSummary } from './lib/request';

export type Note = { path: string; name: string };

export type Tab = { id: number; stack: string[]; idx: number };

// Aba Código: pasta aberta, itens do explorador e terminais.
export type WorkspaceState = { root: string | null; roots: string[]; recent: string[]; vault: string | null };
export type DirEntry = { name: string; path: string; dir: boolean };
export type TerminalInfo = { id: number; title: string; cwd: string };

// Preferências guardadas pelo processo principal em config.json.
export type Settings = { language: Language };

export const GRAPH = '::graph';
export const REQUESTS = '::requests';
export const CODE = '::code';
export const TASKS = '::tasks';
export const WHITEBOARDS = '::whiteboards';

// Guias que não são notas.
export const isSpecialPath = (path: string) => path === GRAPH || path === REQUESTS || path === CODE || path === TASKS || path === WHITEBOARDS;

export type MenuAction =
  | 'new-note'
  | 'new-tab'
  | 'reopen-tab'
  | 'close-tab'
  | 'choose-vault'
  | 'settings'
  | 'export-pdf'
  | 'copy-link'
  | 'copy-name'
  | 'toggle-favorite'
  | 'quick-switcher'
  | 'graph'
  | 'daily-note'
  | 'requests'
  | 'code'
  | 'tasks'
  | 'whiteboards'
  | 'toggle-sidebar'
  | 'toggle-rail'
  | 'back'
  | 'forward'
  | 'next-tab'
  | 'prev-tab';

declare global {
  interface Window {
    api: {
      debug: boolean;
      startNote: string | null;
      getSettings(): Promise<Settings>;
      setSettings(settings: Partial<Settings>): Promise<Settings>;
      getVault(): Promise<string | null>;
      chooseVault(): Promise<string | null>;
      readAll(): Promise<{ path: string; content: string }[]>;
      read(rel: string): Promise<string>;
      write(rel: string, content: string): Promise<void>;
      create(rel: string): Promise<string>;
      rename(from: string, to: string): Promise<string>;
      remove(rel: string): Promise<void>;
      /** Devolve o caminho gravado, o motivo da falha ou null se o diálogo foi cancelado. */
      exportPdf(name: string): Promise<{ path?: string; error?: string } | null>;
      bruList(): Promise<{ requests: RequestSummary[]; environments: Environment[] }>;
      bruRead(rel: string): Promise<BruRequest>;
      bruWrite(rel: string, json: BruRequest): Promise<void>;
      bruCreate(folder: string, name: string): Promise<string>;
      envWrite(rel: string, variables: EnvVar[]): Promise<void>;
      httpSend(request: OutgoingRequest): Promise<HttpResult>;
      httpCancel(id: string): Promise<void>;
      historyList(): Promise<HistoryEntry[]>;
      historyAdd(entry: HistoryEntry): Promise<void>;
      historyRemove(id: string): Promise<void>;
      historyClear(): Promise<void>;
      filesList(): Promise<string[]>;
      extList(): Promise<VsExtension[]>;
      extTheme(file: string): Promise<VsTheme>;
      extSnippets(file: string): Promise<Record<string, VsSnippet>>;
      extReadText(file: string): Promise<string>;
      extReadJsonc<T = unknown>(file: string): Promise<T | null>;
      extReadBinary(file: string): Promise<Uint8Array>;
      tmWasm(): Promise<Uint8Array>;
      ws: {
        get(): Promise<WorkspaceState>;
        openFolder(): Promise<WorkspaceState | null>;
        addFolder(): Promise<WorkspaceState | null>;
        removeFolder(dir: string): Promise<WorkspaceState>;
        setRoot(dir: string): Promise<WorkspaceState>;
        openFile(): Promise<string[]>;
        saveAs(suggested?: string): Promise<string | null>;
        readDir(dir: string): Promise<DirEntry[]>;
        listFiles(): Promise<string[]>;
        read(file: string): Promise<string>;
        write(file: string, content: string): Promise<void>;
        create(target: string, isDir: boolean): Promise<string>;
        rename(from: string, to: string): Promise<string>;
        remove(target: string): Promise<void>;
        reveal(target: string): Promise<void>;
        realpath(target: string): Promise<string | null>;
        stat(target: string): Promise<{ dir: boolean; size: number; mtime: number } | null>;
        onChanged(callback: (paths: string[]) => void): () => void;
      };
      term: {
        create(size: { cols: number; rows: number }): Promise<TerminalInfo>;
        list(): Promise<(TerminalInfo & { buffer: string })[]>;
        write(id: number, data: string): Promise<void>;
        resize(id: number, cols: number, rows: number): Promise<void>;
        kill(id: number): Promise<void>;
        onData(callback: (id: number, data: string) => void): () => void;
        onExit(callback: (id: number, code: number) => void): () => void;
      };
      lsp: {
        start(kind: string, cwd: string | null): Promise<{ ok?: true; error?: string }>;
        send(kind: string, body: string): Promise<void>;
        stop(kind: string): Promise<void>;
        fetch(url: string): Promise<string>;
        onMessage(callback: (kind: string, body: string) => void): () => void;
        onExit(callback: (kind: string, reason: string) => void): () => void;
      };
      onMenu(callback: (action: MenuAction) => void): () => void;
    };
  }
}
