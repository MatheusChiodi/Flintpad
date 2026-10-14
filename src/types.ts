import type { Language } from './lib/i18n';
import type { VsExtension, VsSnippet, VsTheme } from './lib/vscode';
import type { BruRequest, Environment, EnvVar, HttpResult, OutgoingRequest, RequestSummary } from './lib/request';

export type Note = { path: string; name: string };

export type Tab = { id: number; stack: string[]; idx: number };

// Preferências guardadas pelo processo principal em config.json.
export type Settings = { language: Language };

export const GRAPH = '::graph';
export const REQUESTS = '::requests';
export const CODE = '::code';

// Guias que não são notas.
export const isSpecialPath = (path: string) => path === GRAPH || path === REQUESTS || path === CODE;

export type MenuAction =
  | 'new-note'
  | 'new-tab'
  | 'reopen-tab'
  | 'close-tab'
  | 'choose-vault'
  | 'settings'
  | 'copy-link'
  | 'copy-name'
  | 'quick-switcher'
  | 'graph'
  | 'requests'
  | 'code'
  | 'toggle-sidebar'
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
      bruList(): Promise<{ requests: RequestSummary[]; environments: Environment[] }>;
      bruRead(rel: string): Promise<BruRequest>;
      bruWrite(rel: string, json: BruRequest): Promise<void>;
      bruCreate(folder: string, name: string): Promise<string>;
      envWrite(rel: string, variables: EnvVar[]): Promise<void>;
      httpSend(request: OutgoingRequest): Promise<HttpResult>;
      httpCancel(id: string): Promise<void>;
      filesList(): Promise<string[]>;
      extList(): Promise<VsExtension[]>;
      extTheme(file: string): Promise<VsTheme>;
      extSnippets(file: string): Promise<Record<string, VsSnippet>>;
      onMenu(callback: (action: MenuAction) => void): () => void;
    };
  }
}
