import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import cssWorker from 'monaco-editor/language/css/css.worker.js?worker';
import htmlWorker from 'monaco-editor/language/html/html.worker.js?worker';
import jsonWorker from 'monaco-editor/language/json/json.worker.js?worker';
import tsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { buildMatcher, replaceInText } from '../../electron/searchCore.mjs';
import { setCodeMenuHandler } from '../lib/codeBridge';
import { duplicateName, markdownSnippet, runCommandFor, NavHistory, type Location, needsFinalNewline, parseQuickOpen, parseSavedEditors, trailingWhitespace, pushClosed, sortPinned, tabsToClose, workspaceKey, type CloseKind } from '../lib/codeTools';
import { fuzzyFilter, fuzzyMatch } from '../lib/fuzzy';
import { useT, type Key } from '../lib/i18n';
import { loadIconTheme, type IconTheme } from '../lib/iconTheme';
import { configureServers, ensureServer, onServerStatus, restartServers, SERVER_LABELS, SERVER_LANGUAGES, serverForLanguage, serverStatus, setModelOpener, type ServerKind } from '../lib/lsp';
import { baseName, dirName, isInside, joinPath, relativePath, samePath } from '../lib/paths';
import { allLanguages, applyTokenTheme, fileLanguage, installExtensions, languageForFile } from '../lib/textmate';
import { toMonacoTheme, toSnippetEntries, type SnippetEntry, type VsExtension, type VsTheme } from '../lib/vscode';
import { cssVariables, FLINTPAD_THEME, themeKind, workbenchColors, type ThemeKind, type WorkbenchColors } from '../lib/workbenchTheme';
import type { DirEntry, FileSearchOptions, MenuAction, WorkspaceState } from '../types';
import { Explorer } from './code/Explorer';
import { FileIconView } from './code/FileIconView';
import { QuickInput, type QuickItem } from './code/QuickInput';
import { SearchView, type SearchHost, type SearchRequest } from './code/SearchView';
import { TerminalPanel, type TerminalCommand } from './code/TerminalPanel';
import { TodoView } from './code/TodoView';
import { DiffView } from './code/DiffView';
import { MarkdownPreview } from './code/MarkdownPreview';
import { problemCounts, ProblemsPanel } from './code/ProblemsPanel';
import { ContextMenu, isMenuKey, menuPosition, type MenuItem, type MenuRequest } from './ContextMenu';
import { Vein } from './code/Vein';

self.MonacoEnvironment = {
  getWorker(_id, label) {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  },
};

// Sem language server, cada arquivo é analisado sozinho: erros de importação seriam falsos.
for (const defaults of [monaco.typescript.typescriptDefaults, monaco.typescript.javascriptDefaults]) {
  defaults.setDiagnosticsOptions({ noSemanticValidation: true });
}

// Modo de captura (testes): o Monaco fica acessível ao script de avaliação.
if (window.api.debug) (window as unknown as { __monaco: typeof monaco }).__monaco = monaco;

const AUTO_SAVE_DELAY_MS = 1000;
const NAV_SETTLE_MS = 180;
const STORAGE = {
  colorTheme: 'obnotion:code-theme',
  iconTheme: 'obnotion:code-icon-theme',
  layout: 'obnotion:code-layout',
  editor: 'obnotion:code-editor',
  recentCommands: 'obnotion:code-recent-commands',
  editors: 'obnotion:code-editors:',
};
// Tema de ícones padrão do VS Code.
const DEFAULT_ICON_THEME_ID = 'vs-seti';
const MAX_RECENT_COMMANDS = 8;

const readStorage = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : ({ ...fallback, ...JSON.parse(raw) } as T);
  } catch {
    return fallback;
  }
};
const writeStorage = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  } catch {
    // armazenamento indisponível: a preferência vale só nesta sessão
  }
};

type EditorTab = { path: string; preview: boolean; pinned?: boolean };
type SideView = 'explorer' | 'search' | 'todo';
type PanelView = 'terminal' | 'problems';
type Layout = { sidebar: boolean; sidebarWidth: number; panel: boolean; panelHeight: number; panelMax: boolean; view: SideView; panelView: PanelView; preview: boolean; previewWidth: number; zen: boolean };
type LineNumbers = 'on' | 'relative' | 'off';
type EditorPrefs = {
  minimap: boolean;
  wordWrap: boolean;
  fontSize: number;
  autoSave: boolean;
  formatOnSave: boolean;
  trimWhitespace: boolean;
  finalNewline: boolean;
  renderWhitespace: boolean;
  lineNumbers: LineNumbers;
  stickyScroll: boolean;
};

const DEFAULT_LAYOUT: Layout = { sidebar: true, sidebarWidth: 260, panel: false, panelHeight: 260, panelMax: false, view: 'explorer', panelView: 'terminal', preview: false, previewWidth: 520, zen: false };
const SIDE_VIEWS: SideView[] = ['explorer', 'search', 'todo'];
const DEFAULT_PREFS: EditorPrefs = { minimap: true, wordWrap: false, fontSize: 13, autoSave: true, formatOnSave: false, trimWhitespace: false, finalNewline: false, renderWhitespace: false, lineNumbers: 'on', stickyScroll: true };

// O que sobrevive à troca de aba: abas do editor, posição de cada arquivo e versão salva de cada modelo.
const session = {
  tabs: [] as EditorTab[],
  active: null as string | null,
  viewStates: new Map<string, monaco.editor.ICodeEditorViewState | null>(),
  saved: new Map<string, number>(),
  installed: null as Promise<VsExtension[]> | null,
  files: null as { root: string; list: Promise<string[]> } | null,
  recentFiles: [] as string[],
  // Guias fechadas (Reabrir editor fechado) e se as guias salvas do workspace já foram restauradas.
  closed: [] as string[],
  restored: false,
  // Voltar/avançar (Alt+← / Alt+→) entre posições do editor.
  nav: new NavHistory(),
};

// Mensagem do erro sem o prefixo que o IPC do Electron acrescenta.
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const keyOf = (path: string) => path.replace(/\\/g, '/').toLowerCase();
const modelFor = (path: string) => monaco.editor.getModels().find((model) => model.uri.scheme === 'file' && samePath(model.uri.fsPath, path)) ?? null;
const isDirty = (path: string) => {
  const model = modelFor(path);
  return Boolean(model && session.saved.get(keyOf(path)) !== model.getAlternativeVersionId());
};

/** Abre o arquivo como modelo do Monaco (se ainda não for), com a linguagem pelas regras do VS Code. */
async function ensureModel(path: string) {
  const existing = modelFor(path);
  if (existing) return existing;
  const content = await window.api.ws.read(path);
  const again = modelFor(path);
  if (again) return again;
  const model = monaco.editor.createModel(content, fileLanguage(path, content), monaco.Uri.file(path));
  session.saved.set(keyOf(path), model.getAlternativeVersionId());
  ensureServer(model.getLanguageId());
  return model;
}
setModelOpener((path) => ensureModel(path).catch(() => null));

async function loadExtensions() {
  session.installed ??= window.api.extList().then(async (extensions) => {
    await installExtensions(extensions);
    return extensions;
  });
  return session.installed;
}

type ThemeChoice = { path: string; label: string; uiTheme: string; extension: string };

async function readTheme(choice: ThemeChoice | null): Promise<{ theme: VsTheme; uiTheme: string }> {
  if (!choice) return { theme: FLINTPAD_THEME, uiTheme: 'vs-dark' };
  return { theme: await window.api.extTheme(choice.path), uiTheme: choice.uiTheme };
}

let themeSerial = 0;
function applyEditorTheme(theme: VsTheme, uiTheme: string) {
  const tokenRules = applyTokenTheme(theme);
  const base = toMonacoTheme(theme, uiTheme);
  const name = `obnotion-theme-${++themeSerial}`;
  monaco.editor.defineTheme(name, { ...base, rules: [...base.rules, ...tokenRules] });
  monaco.editor.setTheme(name);
}

type Quick =
  | { kind: 'main'; value: string }
  | { kind: 'pick'; placeholder: string; items: QuickItem[]; activeId?: string; onPick(item: QuickItem): void; onActive?(item: QuickItem | null): void; onCancel?(): void }
  | { kind: 'prompt'; placeholder: string; message: string; value: string; validate?(value: string): string | null; onSubmit(value: string): void };

type Command = { id: string; label: string; keybinding?: string; group?: string; run(): void };

function useForceUpdate() {
  const [, set] = useState(0);
  return useCallback(() => set((n) => n + 1), []);
}

export default function Code() {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const autoSaveTimers = useRef(new Map<string, number>());
  const forceUpdate = useForceUpdate();

  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [extensions, setExtensions] = useState<VsExtension[]>([]);
  const [ready, setReady] = useState(false);
  const [tabs, setTabsState] = useState<EditorTab[]>(session.tabs);
  const [active, setActiveState] = useState<string | null>(session.active);
  const [layout, setLayoutState] = useState<Layout>(() => {
    const stored = readStorage(STORAGE.layout, DEFAULT_LAYOUT);
    return { ...stored, view: SIDE_VIEWS.includes(stored.view) ? stored.view : DEFAULT_LAYOUT.view, panelView: stored.panelView === 'problems' ? 'problems' : 'terminal', previewWidth: Number(stored.previewWidth) || DEFAULT_LAYOUT.previewWidth, zen: false };
  });
  const [prefs, setPrefsState] = useState<EditorPrefs>(() => {
    const stored = readStorage(STORAGE.editor, DEFAULT_PREFS);
    return { ...stored, lineNumbers: (['on', 'relative', 'off'] as const).includes(stored.lineNumbers) ? stored.lineNumbers : 'on' };
  });
  const [themePath, setThemePath] = useState(() => localStorage.getItem(STORAGE.colorTheme) ?? '');
  const [iconThemePath, setIconThemePath] = useState<string | null>(() => localStorage.getItem(STORAGE.iconTheme));
  const [colors, setColors] = useState<WorkbenchColors>(() => workbenchColors(FLINTPAD_THEME, 'dark'));
  const [kind, setKind] = useState<ThemeKind>('dark');
  const [iconTheme, setIconTheme] = useState<IconTheme | null>(null);
  const [quick, setQuick] = useState<Quick | null>(null);
  const [cursor, setCursor] = useState({ line: 1, column: 1, selected: 0, lines: 1 });
  const navTimer = useRef(0);
  const pendingNav = useRef<Location | null>(null);
  const flushNav = () => {
    window.clearTimeout(navTimer.current);
    if (pendingNav.current) session.nav.record(pendingNav.current);
    pendingNav.current = null;
  };
  const [markers, setMarkers] = useState(() => problemCounts());
  const [markerVersion, setMarkerVersion] = useState(0);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [terminalCommand, setTerminalCommand] = useState<TerminalCommand | null>(null);
  const [collapseSignal, setCollapseSignal] = useState(0);
  const [searchRequest, setSearchRequest] = useState<SearchRequest | null>(null);
  const [diff, setDiff] = useState<{ path: string; saved: string } | null>(null);
  const [, setLspVersion] = useState(0);

  const root = workspace?.root ?? null;
  const roots = useMemo(() => workspace?.roots ?? (root ? [root] : []), [workspace, root]);
  // Pasta do workspace que contém o arquivo (para caminhos relativos e o Quick Open).
  const rootOf = (path: string) => roots.find((dir) => isInside(path, dir)) ?? root;
  // Com várias pastas, o caminho mostrado leva o nome da pasta na frente, como no VS Code.
  const displayPath = (path: string) => {
    const base = rootOf(path);
    const rel = relativePath(base, path);
    return roots.length > 1 && base ? (rel ? `${baseName(base)} • ${rel}` : baseName(base)) : rel;
  };

  const setTabs = (next: EditorTab[]) => {
    session.tabs = next;
    setTabsState(next);
  };
  const setLayout = (patch: Partial<Layout>) =>
    setLayoutState((current) => {
      const next = { ...current, ...patch };
      writeStorage(STORAGE.layout, next);
      return next;
    });
  const setPrefs = (patch: Partial<EditorPrefs>) =>
    setPrefsState((current) => {
      const next = { ...current, ...patch };
      writeStorage(STORAGE.editor, next);
      return next;
    });

  const flash = (text: string, error = false) => {
    setNotice({ text, error });
    window.setTimeout(() => setNotice((current) => (current?.text === text ? null : current)), 4000);
  };

  // ---------- Temas ----------

  const themes = useMemo<ThemeChoice[]>(() => extensions.flatMap((extension) => extension.themes.map((theme) => ({ ...theme, extension: extension.name }))), [extensions]);
  const iconThemes = useMemo(() => extensions.flatMap((extension) => extension.iconThemes.map((theme) => ({ ...theme, extension: extension.name }))), [extensions]);

  const showTheme = useCallback(
    async (path: string) => {
      const choice = themes.find((theme) => theme.path === path) ?? null;
      try {
        const { theme, uiTheme } = await readTheme(choice);
        applyEditorTheme(theme, uiTheme);
        const nextKind = themeKind(uiTheme);
        setKind(nextKind);
        setColors(workbenchColors(theme, nextKind));
      } catch {
        applyEditorTheme(FLINTPAD_THEME, 'vs-dark');
        setColors(workbenchColors(FLINTPAD_THEME, 'dark'));
      }
    },
    [themes],
  );

  useEffect(() => {
    if (ready) void showTheme(themePath);
  }, [ready, themePath, showTheme]);

  const chooseTheme = (path: string) => {
    writeStorage(STORAGE.colorTheme, path);
    setThemePath(path);
  };

  // Tema de ícones: o escolhido, ou o Seti (padrão do VS Code) quando nada foi escolhido.
  const effectiveIconTheme = iconThemePath ?? iconThemes.find((theme) => theme.id === DEFAULT_ICON_THEME_ID)?.path ?? '';
  useEffect(() => {
    if (!effectiveIconTheme) {
      setIconTheme(null);
      return;
    }
    let alive = true;
    void loadIconTheme(effectiveIconTheme, kind === 'light' || kind === 'hc-light').then(
      (loaded) => alive && setIconTheme(loaded),
      () => alive && setIconTheme(null),
    );
    return () => {
      alive = false;
    };
  }, [effectiveIconTheme, kind]);

  const chooseIconTheme = (path: string) => {
    writeStorage(STORAGE.iconTheme, path);
    setIconThemePath(path);
  };

  // ---------- Editor ----------

  const scheduleAutoSave = (path: string) => {
    const timers = autoSaveTimers.current;
    window.clearTimeout(timers.get(keyOf(path)));
    timers.set(
      keyOf(path),
      window.setTimeout(() => void saveRef.current(path), AUTO_SAVE_DELAY_MS),
    );
  };

  // Ao salvar pelo usuário (Ctrl+S, Salvar tudo): formatar, tirar espaços do fim das linhas e garantir a quebra
  // final, conforme as preferências. O salvamento automático não mexe no texto (apagaria o espaço recém-digitado).
  const runSaveParticipants = async (model: monaco.editor.ITextModel, path: string) => {
    const options = prefsRef.current;
    const editor = editorRef.current;
    if (options.formatOnSave && editor?.getModel() === model) {
      try {
        await editor.getAction('editor.action.formatDocument')?.run();
      } catch {
        // sem formatador para a linguagem: salva como está
      }
    }
    if (model.isDisposed()) return;
    const markdown = /^(markdown|mdx)$/.test(model.getLanguageId()) || /\.mdx?$/i.test(path);
    const edits: monaco.editor.IIdentifiedSingleEditOperation[] = [];
    // Em Markdown, dois espaços no fim são quebra de linha: ficam.
    if (options.trimWhitespace && !markdown) {
      for (const range of trailingWhitespace(model.getLinesContent())) edits.push({ range: new monaco.Range(range.line, range.startColumn, range.line, range.endColumn), text: '' });
    }
    if (options.finalNewline && needsFinalNewline(model.getValue())) {
      const last = model.getLineCount();
      const column = model.getLineMaxColumn(last);
      edits.push({ range: new monaco.Range(last, column, last, column), text: model.getEOL() });
    }
    if (edits.length) model.pushEditOperations(editor?.getModel() === model ? editor.getSelections() : [], edits, (inverse) => (editor?.getModel() === model ? editor.getSelections() : null) ?? inverse.map((edit) => new monaco.Selection(edit.range.startLineNumber, edit.range.startColumn, edit.range.startLineNumber, edit.range.startColumn)));
  };

  const save = async (path: string | null = session.active, options: { participants?: boolean } = {}) => {
    if (!path) return;
    const model = modelFor(path);
    if (!model) return;
    window.clearTimeout(autoSaveTimers.current.get(keyOf(path)));
    if (options.participants) await runSaveParticipants(model, path);
    if (model.isDisposed()) return;
    const version = model.getAlternativeVersionId();
    try {
      await window.api.ws.write(path, model.getValue());
      session.saved.set(keyOf(path), version);
      forceUpdate();
    } catch (error) {
      flash(t('code.saveFailed', { name: baseName(path), reason: error instanceof Error ? error.message : String(error) }), true);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const activate = (path: string | null, focusEditor = true) => {
    const editor = editorRef.current;
    const previous = session.active;
    if (editor && previous) session.viewStates.set(keyOf(previous), editor.saveViewState());
    session.active = path;
    setActiveState(path);
    if (path) session.recentFiles = [path, ...session.recentFiles.filter((item) => !samePath(item, path))].slice(0, 50);
    if (!editor) return;
    const model = path ? modelFor(path) : null;
    editor.setModel(model);
    if (model) {
      const state = session.viewStates.get(keyOf(path!));
      if (state) editor.restoreViewState(state);
      if (focusEditor) requestAnimationFrame(() => editor.focus());
    }
  };

  const openPath = async (path: string, options: { pinned?: boolean; selection?: monaco.IRange | monaco.IPosition } = {}) => {
    try {
      await ensureModel(path);
    } catch (error) {
      flash(t('code.readError', { path: baseName(path) }) + (error instanceof Error ? ` ${error.message}` : ''), true);
      return;
    }
    const pinned = options.pinned ?? false;
    const current = session.tabs;
    const existing = current.find((tab) => samePath(tab.path, path));
    let next: EditorTab[];
    if (existing) next = current.map((tab) => (tab === existing && pinned ? { ...tab, preview: false } : tab));
    else {
      // A aba de visualização (itálico) é reaproveitada pelo próximo arquivo aberto com um clique.
      const preview = current.findIndex((tab) => tab.preview);
      const tab = { path, preview: !pinned };
      if (!pinned && preview >= 0) {
        next = [...current];
        next[preview] = tab;
        disposeIfUnused(current[preview].path, next);
      } else {
        const at = current.findIndex((t) => session.active && samePath(t.path, session.active));
        next = [...current];
        next.splice(at + 1, 0, tab);
      }
    }
    setTabs(sortPinned(next));
    activate(path);
    const editor = editorRef.current;
    if (editor && options.selection) {
      if ('startLineNumber' in options.selection) {
        editor.setSelection(options.selection);
        editor.revealRangeInCenterIfOutsideViewport(options.selection);
      } else {
        editor.setPosition(options.selection);
        editor.revealPositionInCenterIfOutsideViewport(options.selection);
      }
    }
  };
  const openPathRef = useRef(openPath);
  openPathRef.current = openPath;

  // Modelo sem aba e sem alteração não precisa ficar na memória.
  const disposeIfUnused = (path: string, remaining: EditorTab[]) => {
    if (remaining.some((tab) => samePath(tab.path, path)) || isDirty(path)) return;
    modelFor(path)?.dispose();
    session.viewStates.delete(keyOf(path));
  };

  const closeTabNow = (path: string) => {
    const current = session.tabs;
    const index = current.findIndex((tab) => samePath(tab.path, path));
    if (index < 0) return;
    const next = current.filter((_, i) => i !== index);
    session.closed = pushClosed(session.closed, path);
    setTabs(next);
    if (session.active && samePath(session.active, path)) activate(next[Math.min(index, next.length - 1)]?.path ?? null);
    session.viewStates.delete(keyOf(path));
    disposeIfUnused(path, next);
  };

  const revert = async (path: string) => {
    const model = modelFor(path);
    if (!model) return;
    let content: string;
    try {
      content = await window.api.ws.read(path);
    } catch (error) {
      flash(`${t('code.readError', { path: baseName(path) })} ${errorText(error)}`, true);
      return;
    }
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text: content }], () => null);
    session.saved.set(keyOf(path), model.getAlternativeVersionId());
    forceUpdate();
  };

  const closeTab = (path: string) => {
    if (!isDirty(path)) return closeTabNow(path);
    if (prefsRef.current.autoSave) {
      void save(path).then(() => closeTabNow(path));
      return;
    }
    setQuick({
      kind: 'pick',
      placeholder: t('code.confirmClose', { name: baseName(path) }),
      items: [
        { id: 'save', label: t('code.save') },
        { id: 'discard', label: t('code.dontSave') },
        { id: 'cancel', label: t('code.cancel') },
      ],
      onPick: (item) => {
        if (item.id === 'save') void save(path).then(() => closeTabNow(path));
        else if (item.id === 'discard') {
          session.saved.delete(keyOf(path));
          modelFor(path)?.dispose();
          closeTabNow(path);
        }
      },
    });
  };

  // Fechar vários de uma vez: os sem alteração saem já; os alterados pedem uma resposta só.
  const closeMany = (paths: string[]) => {
    const dirty = paths.filter((path) => isDirty(path));
    paths.filter((path) => !isDirty(path)).forEach(closeTabNow);
    if (!dirty.length) return;
    if (dirty.length === 1 || prefsRef.current.autoSave) return dirty.forEach(closeTab);
    setQuick({
      kind: 'pick',
      placeholder: t('code.confirmCloseMany', { count: dirty.length }),
      items: [
        { id: 'save', label: t('code.saveAllAndClose') },
        { id: 'discard', label: t('code.discardAll') },
        { id: 'cancel', label: t('code.cancel') },
      ],
      onPick: (item) => {
        if (item.id === 'save') void Promise.all(dirty.map((path) => save(path))).then(() => dirty.filter((path) => !isDirty(path)).forEach(closeTabNow));
        else if (item.id === 'discard')
          for (const path of dirty) {
            session.saved.delete(keyOf(path));
            modelFor(path)?.dispose();
            closeTabNow(path);
          }
      },
    });
  };

  const closeTabs = (kind: CloseKind, path: string | null = session.active) => {
    if (!path && kind !== 'all') return;
    closeMany(tabsToClose(session.tabs, kind, path ?? '', isDirty));
  };

  // Guia fixada: fica à esquerda, não é reaproveitada como visualização e sobrevive a "Fechar os outros".
  const togglePin = (path: string | null = session.active) => {
    if (!path) return;
    setTabs(sortPinned(session.tabs.map((tab) => (samePath(tab.path, path) ? { ...tab, pinned: !tab.pinned, preview: false } : tab))));
  };

  const reopenClosed = () => {
    const [path, ...rest] = session.closed;
    if (!path) return false;
    session.closed = rest;
    void openPath(path, { pinned: true });
    return true;
  };

  const [tabMenu, setTabMenu] = useState<MenuRequest | null>(null);
  const closeTabMenu = useCallback(() => setTabMenu(null), []);
  const openTabMenu = (position: { x: number; y: number }, tab: EditorTab) => {
    const index = session.tabs.findIndex((item) => samePath(item.path, tab.path));
    const items: MenuItem[] = [
      { label: t('code.cmd.closeEditor'), keys: 'Ctrl+W', run: () => closeTab(tab.path) },
      { label: t('code.tabs.closeOthers'), disabled: session.tabs.length < 2, run: () => closeTabs('others', tab.path) },
      { label: t('code.tabs.closeRight'), disabled: index >= session.tabs.length - 1, run: () => closeTabs('right', tab.path) },
      { label: t('code.tabs.closeSaved'), run: () => closeTabs('saved', tab.path) },
      { label: t('code.cmd.closeAll'), run: () => closeTabs('all') },
      { kind: 'separator' },
      { label: tab.pinned ? t('code.tabs.unpin') : t('code.tabs.pin'), run: () => togglePin(tab.path) },
      {
        label: t('code.cmd.compareWithSaved'),
        keys: 'Ctrl+K D',
        disabled: !isDirty(tab.path),
        run: () => {
          activate(tab.path);
          // Depois da troca de guia (que fecha comparações abertas).
          requestAnimationFrame(() => void compareWithSaved(tab.path));
        },
      },
      { kind: 'separator' },
      { label: t('code.explorer.copyPath'), run: () => void navigator.clipboard.writeText(tab.path) },
      { label: t('code.explorer.copyRelativePath'), run: () => void navigator.clipboard.writeText(relativePath(rootOf(tab.path), tab.path)) },
      { label: t('code.tabs.revealInSide'), run: () => revealInExplorer(tab.path) },
      { label: t('code.explorer.reveal'), run: () => void window.api.ws.reveal(tab.path) },
    ];
    setTabMenu({ ...position, items, label: baseName(tab.path) });
  };

  // Mostra o arquivo no explorador (abre a vista; o explorador abre as pastas até ele).
  const revealInExplorer = (path: string) => {
    showView('explorer');
    if (!session.active || !samePath(session.active, path)) activate(path);
  };

  // ---------- Guias entre sessões ----------

  const restoreEditors = async (workspaceRoots: string[]) => {
    let saved;
    try {
      saved = parseSavedEditors(JSON.parse(localStorage.getItem(STORAGE.editors + workspaceKey(workspaceRoots)) ?? 'null'));
    } catch {
      return;
    }
    const restored: EditorTab[] = [];
    for (const tab of saved.tabs) {
      try {
        await ensureModel(tab.path);
        restored.push({ path: tab.path, preview: false, pinned: tab.pinned });
      } catch {
        // arquivo apagado ou fora das pastas abertas: a guia não volta
      }
    }
    // O usuário pode ter aberto algo enquanto os arquivos eram lidos: isso vence.
    if (!restored.length || session.tabs.length) return;
    setTabs(sortPinned(restored));
    activate(restored.find((tab) => saved.active && samePath(tab.path, saved.active))?.path ?? restored[0].path);
  };

  useEffect(() => {
    if (!ready || !session.restored || !roots.length) return;
    writeStorage(STORAGE.editors + workspaceKey(roots), { tabs: tabs.map((tab) => ({ path: tab.path, pinned: Boolean(tab.pinned) })), active });
  }, [ready, tabs, active, roots]);

  // ---------- Inicialização ----------

  useEffect(() => {
    const editor = monaco.editor.create(host.current!, {
      automaticLayout: true,
      fontFamily: getComputedStyle(document.body).getPropertyValue('--font-mono'),
      fontSize: prefsRef.current.fontSize,
      lineHeight: Math.round(prefsRef.current.fontSize * 1.6),
      minimap: { enabled: prefsRef.current.minimap },
      wordWrap: prefsRef.current.wordWrap ? 'on' : 'off',
      padding: { top: 6 },
      smoothScrolling: true,
      tabSize: 2,
      bracketPairColorization: { enabled: true },
      stickyScroll: { enabled: prefsRef.current.stickyScroll },
      renderWhitespace: prefsRef.current.renderWhitespace ? 'all' : 'selection',
      lineNumbers: prefsRef.current.lineNumbers,
      // O realce semântico do servidor repintaria por cima das cores TextMate do tema.
      'semanticHighlighting.enabled': false,
      fixedOverflowWidgets: true,
      model: null,
    });
    editorRef.current = editor;

    const subscriptions: monaco.IDisposable[] = [
      editor.onDidChangeCursorSelection((event) => {
        const model = editor.getModel();
        setCursor({ line: event.selection.positionLineNumber, column: event.selection.positionColumn, selected: model ? model.getValueInRange(event.selection).length : 0, lines: event.selection.endLineNumber - event.selection.startLineNumber + 1 });
        // A posição entra no histórico quando o cursor para (trocar de arquivo passa por posições intermediárias).
        const path = session.active;
        if (!path || !model) return;
        const location = { path, line: event.selection.positionLineNumber, column: event.selection.positionColumn };
        window.clearTimeout(navTimer.current);
        pendingNav.current = location;
        navTimer.current = window.setTimeout(flushNav, NAV_SETTLE_MS);
      }),
      editor.onDidChangeModelContent(() => {
        const path = session.active;
        if (!path) return;
        // Editar fixa a aba de visualização.
        if (session.tabs.some((tab) => tab.preview && samePath(tab.path, path))) setTabs(session.tabs.map((tab) => (samePath(tab.path, path) ? { ...tab, preview: false } : tab)));
        if (prefsRef.current.autoSave) scheduleAutoSave(path);
        forceUpdate();
      }),
      editor.onDidChangeModel(() => forceUpdate()),
      monaco.editor.onDidChangeMarkers(() => {
        setMarkers(problemCounts());
        setMarkerVersion((n) => n + 1);
      }),
      // "Ir para definição" em outro arquivo abre uma aba, como no VS Code.
      monaco.editor.registerEditorOpener({
        openCodeEditor: (_source, resource, selectionOrPosition) => {
          if (resource.scheme !== 'file') return false;
          void openPathRef.current(resource.fsPath, { pinned: true, selection: selectionOrPosition });
          return true;
        },
      }),
    ];
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void saveRef.current(session.active, { participants: true }));
    const chord = (second: monaco.KeyCode, id: string) =>
      editor.addCommand(monaco.KeyMod.chord(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, monaco.KeyMod.CtrlCmd | second), () => runCommandRef.current(id));
    chord(monaco.KeyCode.KeyT, 'workbench.action.selectTheme');
    chord(monaco.KeyCode.KeyO, 'workbench.action.files.openFolder');
    const plainChord = (second: monaco.KeyCode, id: string) => editor.addCommand(monaco.KeyMod.chord(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, second), () => runCommandRef.current(id));
    plainChord(monaco.KeyCode.KeyM, 'workbench.action.editor.changeLanguageMode');
    plainChord(monaco.KeyCode.KeyD, 'workbench.files.action.compareWithSaved');
    plainChord(monaco.KeyCode.KeyV, 'markdown.showPreviewToSide');
    plainChord(monaco.KeyCode.KeyZ, 'workbench.action.toggleZenMode');

    let alive = true;
    void (async () => {
      const [state, list] = await Promise.all([window.api.ws.get(), loadExtensions()]);
      if (!alive) return;
      setWorkspace(state);
      setExtensions(list);
      configureServers(state.root, list.flatMap((extension) => extension.jsonValidation));
      setReady(true);
      if (session.active) activate(session.active);
      if (!session.restored) {
        // Primeira abertura da aba nesta sessão do app: volta com as guias da última vez neste workspace.
        if (!session.tabs.length) await restoreEditors(state.roots);
        session.restored = true;
        forceUpdate();
      }
    })();

    const offStatus = onServerStatus(() => setLspVersion((n) => n + 1));

    return () => {
      alive = false;
      offStatus();
      if (session.active) session.viewStates.set(keyOf(session.active), editor.saveViewState());
      // Pendências de salvamento automático saem antes de a aba sumir.
      for (const [key, timer] of autoSaveTimers.current) {
        window.clearTimeout(timer);
        const tab = session.tabs.find((item) => keyOf(item.path) === key);
        if (tab) void saveRef.current(tab.path);
      }
      subscriptions.forEach((subscription) => subscription.dispose());
      editor.setModel(null);
      editor.dispose();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    editorRef.current?.updateOptions({
      minimap: { enabled: prefs.minimap },
      wordWrap: prefs.wordWrap ? 'on' : 'off',
      fontSize: prefs.fontSize,
      lineHeight: Math.round(prefs.fontSize * 1.6),
      stickyScroll: { enabled: prefs.stickyScroll },
      renderWhitespace: prefs.renderWhitespace ? 'all' : 'selection',
      lineNumbers: prefs.lineNumbers,
    });
  }, [prefs]);

  // Arquivo alterado fora do editor (git, outro programa): recarrega se não houver edição pendente.
  useEffect(
    () =>
      window.api.ws.onChanged((paths) => {
        session.files = null;
        for (const changed of paths) {
          const model = modelFor(changed);
          if (!model || isDirty(changed)) continue;
          void window.api.ws.read(changed).then(
            (content) => {
              if (model.isDisposed() || content === model.getValue()) return;
              model.pushEditOperations([], [{ range: model.getFullModelRange(), text: content }], () => null);
              session.saved.set(keyOf(changed), model.getAlternativeVersionId());
              forceUpdate();
            },
            () => {},
          );
        }
      }),
    [forceUpdate],
  );

  // Snippets das extensões: um provedor por linguagem, carregado só quando o editor pede sugestões.
  useEffect(() => {
    const byLanguage = new Map<string, Set<string>>();
    for (const extension of extensions) {
      for (const snippet of extension.snippets) {
        if (!snippet.language) continue;
        byLanguage.set(snippet.language, (byLanguage.get(snippet.language) ?? new Set()).add(snippet.path));
      }
    }
    const disposables = [...byLanguage.entries()].map(([language, paths]) => {
      let loaded: Promise<SnippetEntry[]> | null = null;
      const load = () => (loaded ??= Promise.all([...paths].map((path) => window.api.extSnippets(path).then(toSnippetEntries, () => []))).then((lists) => lists.flat()));
      return monaco.languages.registerCompletionItemProvider(language, {
        async provideCompletionItems(model, position) {
          const word = model.getWordUntilPosition(position);
          const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
          return {
            suggestions: (await load()).map((entry) => ({
              label: entry.label,
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: entry.body,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: entry.description,
              range,
            })),
          };
        },
      });
    });
    return () => disposables.forEach((disposable) => disposable.dispose());
  }, [extensions]);

  // ---------- Pasta aberta ----------

  const changeRoot = (state: WorkspaceState | null) => {
    if (!state) return;
    setWorkspace(state);
    session.files = null;
    configureServers(state.root, extensions.flatMap((extension) => extension.jsonValidation));
    setLayout({ sidebar: true });
  };
  const openFolder = async () => changeRoot(await window.api.ws.openFolder());
  const addFolder = async () => changeRoot(await window.api.ws.addFolder());
  const removeRoot = (dir: string) => void window.api.ws.removeFolder(dir).then(changeRoot);
  const openFiles = async () => {
    for (const file of await window.api.ws.openFile()) await openPath(file, { pinned: true });
  };

  const listFiles = () => {
    if (!root) return Promise.resolve([] as string[]);
    const key = roots.join('|');
    if (!session.files || session.files.root !== key) session.files = { root: key, list: window.api.ws.listFiles() };
    return session.files.list;
  };

  // ---------- Vistas da barra lateral ----------

  const showView = (view: SideView) => setLayout({ sidebar: true, view });
  // Clicar na vista que já está aberta fecha a barra, como na barra de atividades do VS Code.
  const toggleView = (view: SideView) => (layout.sidebar && layout.view === view ? setLayout({ sidebar: false }) : showView(view));

  /** Abre a busca em arquivos; a seleção de uma linha do editor vira a consulta. */
  const showSearch = (patch: Omit<SearchRequest, 'serial'> = {}) => {
    const editor = editorRef.current;
    const selection = editor?.getSelection();
    const selected = selection && !selection.isEmpty() ? editor!.getModel()?.getValueInRange(selection) : undefined;
    showView('search');
    setSearchRequest({ query: selected && !/[\r\n]/.test(selected) ? selected : undefined, ...patch, serial: Date.now() });
  };

  const openAt = (path: string, line: number, column: number, length: number) =>
    void openPath(path, { pinned: true, selection: { startLineNumber: line, startColumn: column, endLineNumber: line, endColumn: column + length } });

  const searchHost: SearchHost = {
    iconTheme,
    displayPath,
    open: openAt,
    notify: flash,
    // Arquivo aberto troca no modelo (Ctrl+Z desfaz); se não tinha alteração pendente, já salva.
    replaceOpen: (paths: string[], options: FileSearchOptions, replacement: string) => {
      const handled: string[] = [];
      let count = 0;
      const matcher = buildMatcher(options);
      for (const path of paths) {
        const model = modelFor(path);
        if (!model) continue;
        handled.push(path);
        const wasDirty = isDirty(path);
        const result = replaceInText(model.getValue(), matcher, replacement, options.isRegex);
        if (!result.count) continue;
        count += result.count;
        model.pushEditOperations([], [{ range: model.getFullModelRange(), text: result.text }], () => null);
        if (!wasDirty) void save(path);
      }
      forceUpdate();
      return { handled, count };
    },
  };

  // ---------- Perguntas (nome de arquivo etc.) ----------

  const prompt = (placeholder: string, message: string, value: string, onSubmit: (value: string) => void, validate?: (value: string) => string | null) =>
    setQuick({ kind: 'prompt', placeholder, message, value, onSubmit, validate });

  const validName = (value: string) => (!value.trim() ? t('code.prompt.required') : /[<>:"|?*]/.test(value.replace(/^[a-z]:/i, '')) ? t('code.prompt.invalid') : null);

  // Renomear ou mover (arrastar no explorador): as guias de dentro passam a apontar para o novo caminho, com o conteúdo atual.
  const moveEntry = (entry: DirEntry, target: string) => {
    void window.api.ws.rename(entry.path, target).then(async (renamed) => {
      const affected = session.tabs.filter((tab) => isInside(tab.path, entry.path));
      for (const tab of affected) {
        const next = renamed + tab.path.slice(entry.path.length);
        const old = modelFor(tab.path);
        const value = old?.getValue();
        const wasDirty = isDirty(tab.path);
        old?.dispose();
        const model = await ensureModel(next);
        if (value !== undefined && wasDirty) model.setValue(value);
        session.tabs = session.tabs.map((item) => (item === tab ? { ...item, path: next } : item));
        if (session.active && samePath(session.active, tab.path)) session.active = next;
      }
      setTabs([...session.tabs]);
      activate(session.active);
    }, (error) => flash(errorText(error), true));
  };

  const explorerActions = {
    open: (path: string, pinned: boolean) => void openPath(path, { pinned }),
    newFile: (dir: string) =>
      prompt(t('code.explorer.newFile'), t('code.prompt.newFile', { dir: relativePath(rootOf(dir), dir) || baseName(dir) }), '', (name) => {
        void window.api.ws.create(joinPath(dir, name.trim()), false).then(
          (path) => openPath(path, { pinned: true }),
          (error) => flash(errorText(error), true),
        );
      }, validName),
    newFolder: (dir: string) =>
      prompt(t('code.explorer.newFolder'), t('code.prompt.newFolder', { dir: relativePath(rootOf(dir), dir) || baseName(dir) }), '', (name) => {
        void window.api.ws.create(joinPath(dir, name.trim()), true).catch((error) => flash(errorText(error), true));
      }, validName),
    rename: (entry: DirEntry) =>
      prompt(t('code.explorer.rename'), t('code.prompt.rename', { name: entry.name }), entry.name, (name) => {
        moveEntry(entry, joinPath(dirName(entry.path), name.trim()));
      }, validName),
    move: (entry: DirEntry, targetDir: string) => moveEntry(entry, joinPath(targetDir, entry.name)),
    duplicate: (entry: DirEntry) => {
      const dir = dirName(entry.path);
      void window.api.ws
        .readDir(dir)
        .then((siblings) => {
          const name = duplicateName(entry.name, (candidate) => siblings.some((item) => item.name.toLowerCase() === candidate.toLowerCase()));
          return window.api.ws.copy(entry.path, joinPath(dir, name));
        })
        .then((copy) => openPath(copy, { pinned: true }), (error) => flash(errorText(error), true));
    },
    copyRelativePath: (path: string) => void navigator.clipboard.writeText(relativePath(rootOf(path), path)),
    findInFolder: (dir: string) => {
      const base = rootOf(dir);
      const rel = base && !samePath(base, dir) ? relativePath(base, dir) : '';
      showSearch({ include: rel ? `./${rel}` : '' });
    },
    remove: (entry: DirEntry) =>
      setQuick({
        kind: 'pick',
        placeholder: t('code.confirmDelete', { name: entry.name }),
        items: [
          { id: 'yes', label: t('common.moveToTrash') },
          { id: 'no', label: t('code.cancel') },
        ],
        onPick: (item) => {
          if (item.id !== 'yes') return;
          void window.api.ws.remove(entry.path).then(() => {
            for (const tab of session.tabs.filter((tab) => isInside(tab.path, entry.path))) {
              session.saved.delete(keyOf(tab.path));
              modelFor(tab.path)?.dispose();
              closeTabNow(tab.path);
            }
            session.closed = session.closed.filter((path) => !isInside(path, entry.path));
          }, (error) => flash(errorText(error), true));
        },
      }),
  };

  // ---------- Comandos ----------

  const activeModel = () => (session.active ? modelFor(session.active) : null);
  const runEditorAction = (id: string) => {
    const editor = editorRef.current;
    if (!editor?.getModel()) return;
    editor.focus();
    // Parte dos comandos do Monaco (ir para definição, referências...) não é "action": vai por trigger.
    const action = editor.getAction(id);
    if (action) void action.run();
    else editor.trigger('flintpad', id, null);
  };

  const pickTheme = () => {
    const original = themePath;
    const items: QuickItem[] = [
      { id: '', label: t('code.defaultTheme'), description: 'Flintpad', group: t('code.theme.house') },
      ...themes.map((theme) => ({ id: theme.path, label: theme.label, description: theme.extension, group: themeKind(theme.uiTheme) === 'light' || themeKind(theme.uiTheme) === 'hc-light' ? t('code.theme.light') : t('code.theme.dark') })),
    ].sort((a, b) => (a.group === b.group ? 0 : a.group === t('code.theme.house') ? -1 : b.group === t('code.theme.house') ? 1 : a.group!.localeCompare(b.group!)));
    setQuick({
      kind: 'pick',
      placeholder: t('code.theme.pick'),
      items,
      activeId: original,
      // Pré-visualiza ao navegar, como no VS Code; Esc volta ao tema anterior.
      onActive: (item) => item && void showTheme(item.id),
      onPick: (item) => chooseTheme(item.id),
      onCancel: () => void showTheme(original),
    });
  };

  const pickIconTheme = () => {
    const original = effectiveIconTheme;
    setQuick({
      kind: 'pick',
      placeholder: t('code.iconTheme.pick'),
      items: [{ id: '', label: t('code.iconTheme.none') }, ...iconThemes.map((theme) => ({ id: theme.path, label: theme.label, description: theme.extension }))],
      activeId: original,
      onActive: (item) => item && setIconThemePath(item.id),
      onPick: (item) => chooseIconTheme(item.id),
      onCancel: () => setIconThemePath(localStorage.getItem(STORAGE.iconTheme)),
    });
  };

  const pickLanguage = () => {
    const model = activeModel();
    if (!model) return;
    setQuick({
      kind: 'pick',
      placeholder: t('code.language.pick'),
      activeId: model.getLanguageId(),
      items: allLanguages().map((language) => ({ id: language.id, label: language.label, description: `(${language.id})` })),
      onPick: (item) => {
        monaco.editor.setModelLanguage(model, item.id);
        ensureServer(item.id);
        forceUpdate();
      },
    });
  };

  const pickEol = () => {
    const model = activeModel();
    if (!model) return;
    setQuick({
      kind: 'pick',
      placeholder: t('code.eol.pick'),
      activeId: model.getEOL() === '\n' ? 'LF' : 'CRLF',
      items: [
        { id: 'LF', label: 'LF', description: '\\n' },
        { id: 'CRLF', label: 'CRLF', description: '\\r\\n' },
      ],
      onPick: (item) => {
        model.pushEOL(item.id === 'LF' ? monaco.editor.EndOfLineSequence.LF : monaco.editor.EndOfLineSequence.CRLF);
        forceUpdate();
      },
    });
  };

  const pickIndentation = () => {
    const model = activeModel();
    if (!model) return;
    const options = model.getOptions();
    setQuick({
      kind: 'pick',
      placeholder: t('code.indent.pick'),
      items: [
        { id: 'spaces', label: t('code.indent.spaces') },
        { id: 'tabs', label: t('code.indent.tabs') },
        ...[2, 4, 8].map((size) => ({ id: `size:${size}`, label: t('code.indent.size', { size }), description: options.tabSize === size ? '✓' : undefined })),
        { id: 'detect', label: t('code.indent.detect') },
      ],
      onPick: (item) => {
        if (item.id === 'spaces') model.updateOptions({ insertSpaces: true });
        else if (item.id === 'tabs') model.updateOptions({ insertSpaces: false });
        else if (item.id === 'detect') model.detectIndentation(true, 4);
        else model.updateOptions({ tabSize: Number(item.id.slice(5)), indentSize: Number(item.id.slice(5)) });
        forceUpdate();
      },
    });
  };

  const pickRecent = () =>
    setQuick({
      kind: 'pick',
      placeholder: t('code.recent.pick'),
      items: [
        ...(workspace?.recent ?? []).map((dir) => ({ id: dir, label: baseName(dir), description: dir })),
        ...(workspace?.vault && !(workspace.recent ?? []).some((dir) => samePath(dir, workspace.vault!)) ? [{ id: workspace.vault, label: baseName(workspace.vault), description: t('code.recent.vault') }] : []),
      ],
      onPick: (item) => void window.api.ws.setRoot(item.id).then(changeRoot, (error) => flash(errorText(error), true)),
    });

  // Terminal e Problemas dividem o painel: o atalho de um mostra a sua guia; se ela já está à vista, fecha o painel.
  const togglePanelView = (view: PanelView) => {
    if (layout.panel && layout.panelView === view) setLayout({ panel: false });
    else {
      setLayout({ panel: true, panelView: view });
      if (view === 'terminal') setTerminalCommand({ kind: 'focus', serial: Date.now() });
    }
  };
  const toggleTerminal = () => togglePanelView('terminal');
  const newTerminal = () => {
    setLayout({ panel: true, panelView: 'terminal' });
    setTerminalCommand({ kind: 'new', serial: Date.now() });
  };

  // ---------- Markdown, terminal e cópia ----------

  const togglePreview = () => {
    const model = activeModel();
    if (!layout.preview && !(model && /^(markdown|mdx)$/.test(model.getLanguageId()))) {
      flash(t('code.preview.onlyMarkdown'));
      return;
    }
    setLayout({ preview: !layout.preview });
  };

  // Link relativo da prévia: abre o arquivo ao lado do atual, se existir.
  const openFromPreview = async (href: string, _anchor: string) => {
    if (!session.active) return;
    const target = joinPath(dirName(session.active), href);
    const stat = await window.api.ws.stat(target).catch(() => null);
    if (!stat || stat.dir) {
      flash(t('code.preview.missing', { path: href }), true);
      return;
    }
    void openPath(target, { pinned: true });
  };

  const platform = navigator.userAgent.includes('Windows') ? 'win32' : 'posix';
  const sendToTerminal = (text: string) => {
    setLayout({ panel: true, panelView: 'terminal' });
    setTerminalCommand({ kind: 'run', text, serial: Date.now() });
  };

  // Rodar o arquivo ativo no terminal (salva antes), com o executor da linguagem.
  const runActiveFile = async () => {
    const path = session.active;
    if (!path) return;
    const command = runCommandFor(path, platform);
    if (!command) {
      flash(t('code.run.unsupported', { name: baseName(path) }), true);
      return;
    }
    if (isDirty(path)) await save(path);
    sendToTerminal(command);
  };

  // Seleção (ou a linha do cursor) vai para o terminal ativo e é executada.
  const runSelection = () => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    const selection = editor?.getSelection();
    if (!editor || !model || !selection) return;
    const text = selection.isEmpty() ? model.getLineContent(selection.positionLineNumber) : model.getValueInRange(selection);
    if (!text.trim()) return;
    sendToTerminal(text.replace(/\r?\n/g, '\r'));
  };

  // Seleção (ou o arquivo todo) como bloco Markdown com caminho e linhas: pronto para colar numa nota.
  const copyAsMarkdown = () => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    const path = session.active;
    if (!editor || !model || !path) return;
    const selection = editor.getSelection();
    const whole = !selection || selection.isEmpty();
    const range = whole ? model.getFullModelRange() : selection!;
    // Seleção que termina no início de uma linha não inclui essa linha.
    const endLine = !whole && range.endColumn === 1 && range.endLineNumber > range.startLineNumber ? range.endLineNumber - 1 : range.endLineNumber;
    const snippet = markdownSnippet({ code: model.getValueInRange(range), language: model.getLanguageId(), path: relativePath(rootOf(path), path).replace(/\\/g, '/'), startLine: range.startLineNumber, endLine });
    void navigator.clipboard.writeText(snippet).then(
      () => flash(t('code.copiedMarkdown')),
      () => flash(t('code.copyFailed'), true),
    );
  };

  const toggleZen = () => setLayout({ zen: !layout.zen });

  // Trilha: clicar numa pasta lista o que há nela (pastas entram, arquivos abrem).
  const pickInFolder = async (dir: string) => {
    let entries: DirEntry[];
    try {
      entries = await window.api.ws.readDir(dir);
    } catch (error) {
      flash(errorText(error), true);
      return;
    }
    setQuick({
      kind: 'pick',
      placeholder: t('code.crumbs.pick', { name: baseName(dir) }),
      activeId: session.active ?? undefined,
      items: entries.map((entry) => ({
        id: entry.path,
        label: entry.name,
        description: entry.dir ? '/' : undefined,
        icon: <FileIconView icon={iconTheme ? (entry.dir ? iconTheme.forFolder(entry.path, false) : iconTheme.forFile(entry.path, languageForFile(entry.path))) : null} dir={entry.dir} />,
      })),
      onPick: (item) => {
        const entry = entries.find((candidate) => candidate.path === item.id);
        if (entry?.dir) void pickInFolder(entry.path);
        else if (entry) void openPath(entry.path, { pinned: true });
      },
    });
  };

  const compareWithSaved = async (path = session.active) => {
    if (!path || !modelFor(path)) return;
    try {
      setDiff({ path, saved: await window.api.ws.read(path) });
    } catch (error) {
      flash(`${t('code.readError', { path: baseName(path) })} ${errorText(error)}`, true);
    }
  };
  const closeDiff = () => {
    setDiff(null);
    requestAnimationFrame(() => editorRef.current?.focus());
  };
  // Trocar de guia fecha a comparação.
  useEffect(() => {
    setDiff((current) => (current && (!active || !samePath(current.path, active)) ? null : current));
  }, [active]);

  const navigate = (direction: -1 | 1) => {
    flushNav();
    const target = direction < 0 ? session.nav.back() : session.nav.forward();
    if (!target) return;
    void openPath(target.path, { selection: { lineNumber: target.line, column: target.column } });
  };

  const pickLineNumbers = () =>
    setQuick({
      kind: 'pick',
      placeholder: t('code.lineNumbers.pick'),
      activeId: prefs.lineNumbers,
      items: (['on', 'relative', 'off'] as LineNumbers[]).map((value) => ({ id: value, label: t(`code.lineNumbers.${value}` as Key) })),
      onPick: (item) => setPrefs({ lineNumbers: item.id as LineNumbers }),
    });

  const cycleEditor = (delta: number) => {
    const index = tabs.findIndex((tab) => active && samePath(tab.path, active));
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    if (next) activate(next.path);
  };

  const commands: Command[] = [
    { id: 'workbench.action.quickOpen', label: t('code.cmd.quickOpen'), keybinding: 'Ctrl+P', run: () => setQuick({ kind: 'main', value: '' }) },
    { id: 'workbench.action.showCommands', label: t('code.cmd.showCommands'), keybinding: 'Ctrl+Shift+P', run: () => setQuick({ kind: 'main', value: '>' }) },
    { id: 'workbench.action.gotoLine', label: t('code.cmd.gotoLine'), keybinding: 'Ctrl+G', run: () => setQuick({ kind: 'main', value: ':' }) },
    { id: 'workbench.action.gotoSymbol', label: t('code.cmd.gotoSymbol'), keybinding: 'Ctrl+Shift+O', run: () => runEditorAction('editor.action.quickOutline') },
    { id: 'workbench.action.files.newUntitledFile', label: t('code.cmd.newFile'), keybinding: 'Ctrl+N', run: () => root && explorerActions.newFile(root) },
    { id: 'workbench.action.files.openFile', label: t('code.cmd.openFile'), run: () => void openFiles() },
    { id: 'workbench.action.files.openFolder', label: t('code.cmd.openFolder'), run: () => void openFolder() },
    { id: 'workbench.action.addRootFolder', label: t('code.cmd.addFolder'), run: () => void addFolder() },
    { id: 'workbench.action.openRecent', label: t('code.cmd.openRecent'), run: pickRecent },
    { id: 'workbench.action.files.save', label: t('code.cmd.save'), keybinding: 'Ctrl+S', run: () => void save(session.active, { participants: true }) },
    {
      id: 'workbench.action.files.saveAs',
      label: t('code.cmd.saveAs'),
      run: () => {
        const model = activeModel();
        if (!model) return;
        void window.api.ws
          .saveAs(session.active!)
          .then(async (target) => {
            if (!target) return;
            await window.api.ws.write(target, model.getValue());
            await openPath(target, { pinned: true });
          })
          .catch((error) => flash(t('code.writeFailed', { name: baseName(session.active ?? ''), reason: errorText(error) }), true));
      },
    },
    { id: 'workbench.action.files.saveAll', label: t('code.cmd.saveAll'), run: () => session.tabs.filter((tab) => isDirty(tab.path)).forEach((tab) => void save(tab.path, { participants: true })) },
    { id: 'workbench.action.files.revert', label: t('code.cmd.revert'), run: () => session.active && void revert(session.active) },
    { id: 'workbench.action.closeActiveEditor', label: t('code.cmd.closeEditor'), keybinding: 'Ctrl+W', run: () => session.active && closeTab(session.active) },
    { id: 'workbench.action.closeAllEditors', label: t('code.cmd.closeAll'), run: () => closeMany(session.tabs.map((tab) => tab.path)) },
    { id: 'workbench.action.closeOtherEditors', label: t('code.cmd.closeOthers'), run: () => closeTabs('others') },
    { id: 'workbench.action.closeEditorsToTheRight', label: t('code.tabs.closeRight'), run: () => closeTabs('right') },
    { id: 'workbench.action.closeUnmodifiedEditors', label: t('code.tabs.closeSaved'), run: () => closeTabs('saved') },
    { id: 'workbench.action.reopenClosedEditor', label: t('code.cmd.reopenClosed'), keybinding: 'Ctrl+Shift+T', run: () => void reopenClosed() },
    { id: 'workbench.action.pinEditor', label: t('code.cmd.togglePin'), run: () => togglePin() },
    { id: 'workbench.files.action.showActiveFileInExplorer', label: t('code.tabs.revealInSide'), run: () => session.active && revealInExplorer(session.active) },
    { id: 'workbench.actions.view.problems', label: t('code.cmd.showProblems'), keybinding: 'Ctrl+Shift+M', run: () => togglePanelView('problems') },
    { id: 'workbench.action.nextEditor', label: t('code.cmd.nextEditor'), keybinding: 'Ctrl+PageDown', run: () => cycleEditor(1) },
    { id: 'workbench.action.previousEditor', label: t('code.cmd.previousEditor'), keybinding: 'Ctrl+PageUp', run: () => cycleEditor(-1) },
    { id: 'workbench.action.toggleSidebarVisibility', label: t('code.cmd.toggleSidebar'), keybinding: 'Ctrl+B', run: () => setLayout({ sidebar: !layout.sidebar }) },
    { id: 'workbench.view.explorer', label: t('code.cmd.showExplorer'), run: () => showView('explorer') },
    { id: 'workbench.view.search', label: t('code.cmd.showSearch'), keybinding: 'Ctrl+Shift+F', run: () => showSearch() },
    { id: 'workbench.action.replaceInFiles', label: t('code.cmd.replaceInFiles'), keybinding: 'Ctrl+Shift+H', run: () => showSearch({ replace: true }) },
    { id: 'workbench.view.todo', label: t('code.cmd.showTodos'), run: () => showView('todo') },
    { id: 'workbench.files.action.collapseExplorerFolders', label: t('code.explorer.collapse'), run: () => setCollapseSignal(Date.now()) },
    { id: 'workbench.action.togglePanel', label: t('code.cmd.togglePanel'), keybinding: 'Ctrl+J', run: () => setLayout({ panel: !layout.panel }) },
    { id: 'workbench.action.toggleMaximizedPanel', label: t('code.cmd.maximizePanel'), run: () => setLayout({ panel: true, panelMax: !layout.panelMax }) },
    { id: 'workbench.action.terminal.toggleTerminal', label: t('code.cmd.toggleTerminal'), keybinding: 'Ctrl+`', run: toggleTerminal },
    { id: 'workbench.action.terminal.new', label: t('code.cmd.newTerminal'), keybinding: 'Ctrl+Shift+`', run: newTerminal },
    { id: 'workbench.action.terminal.kill', label: t('code.cmd.killTerminal'), run: () => setTerminalCommand({ kind: 'kill', serial: Date.now() }) },
    { id: 'workbench.action.selectTheme', label: t('code.cmd.selectTheme'), keybinding: 'Ctrl+K Ctrl+T', run: pickTheme },
    { id: 'workbench.action.selectIconTheme', label: t('code.cmd.selectIconTheme'), run: pickIconTheme },
    { id: 'workbench.action.editor.changeLanguageMode', label: t('code.cmd.changeLanguage'), keybinding: 'Ctrl+K M', run: pickLanguage },
    { id: 'workbench.action.editor.changeEOL', label: t('code.cmd.changeEol'), run: pickEol },
    { id: 'editor.action.changeIndentation', label: t('code.cmd.indentation'), run: pickIndentation },
    { id: 'editor.action.toggleMinimap', label: t('code.cmd.toggleMinimap'), run: () => setPrefs({ minimap: !prefs.minimap }) },
    { id: 'editor.action.toggleWordWrap', label: t('code.cmd.toggleWordWrap'), keybinding: 'Alt+Z', run: () => setPrefs({ wordWrap: !prefs.wordWrap }) },
    { id: 'workbench.action.files.toggleAutoSave', label: t(prefs.autoSave ? 'code.cmd.autoSaveOff' : 'code.cmd.autoSaveOn'), run: () => setPrefs({ autoSave: !prefs.autoSave }) },
    { id: 'editor.action.fontZoomIn', label: t('code.cmd.zoomIn'), run: () => setPrefs({ fontSize: Math.min(32, prefs.fontSize + 1) }) },
    { id: 'editor.action.fontZoomOut', label: t('code.cmd.zoomOut'), run: () => setPrefs({ fontSize: Math.max(8, prefs.fontSize - 1) }) },
    { id: 'editor.action.fontZoomReset', label: t('code.cmd.zoomReset'), run: () => setPrefs({ fontSize: DEFAULT_PREFS.fontSize }) },
    { id: 'markdown.showPreviewToSide', label: t('code.cmd.togglePreview'), keybinding: 'Ctrl+K V', run: togglePreview },
    { id: 'workbench.action.toggleZenMode', label: t('code.cmd.toggleZen'), keybinding: 'Ctrl+K Z', run: toggleZen },
    { id: 'workbench.action.terminal.runActiveFile', label: t('code.cmd.runFile'), keybinding: 'Ctrl+Alt+N', run: () => void runActiveFile() },
    { id: 'workbench.action.terminal.runSelectedText', label: t('code.cmd.runSelection'), run: runSelection },
    { id: 'editor.action.copyAsMarkdown', label: t('code.cmd.copyAsMarkdown'), run: copyAsMarkdown },
    { id: 'workbench.action.navigateBack', label: t('code.cmd.navigateBack'), keybinding: 'Alt+←', run: () => navigate(-1) },
    { id: 'workbench.action.navigateForward', label: t('code.cmd.navigateForward'), keybinding: 'Alt+→', run: () => navigate(1) },
    { id: 'workbench.files.action.compareWithSaved', label: t('code.cmd.compareWithSaved'), keybinding: 'Ctrl+K D', run: () => void compareWithSaved() },
    { id: 'editor.action.toggleFormatOnSave', label: t(prefs.formatOnSave ? 'code.cmd.formatOnSaveOff' : 'code.cmd.formatOnSaveOn'), run: () => setPrefs({ formatOnSave: !prefs.formatOnSave }) },
    { id: 'files.toggleTrimTrailingWhitespace', label: t(prefs.trimWhitespace ? 'code.cmd.trimOff' : 'code.cmd.trimOn'), run: () => setPrefs({ trimWhitespace: !prefs.trimWhitespace }) },
    { id: 'files.toggleInsertFinalNewline', label: t(prefs.finalNewline ? 'code.cmd.finalNewlineOff' : 'code.cmd.finalNewlineOn'), run: () => setPrefs({ finalNewline: !prefs.finalNewline }) },
    { id: 'editor.action.toggleRenderWhitespace', label: t('code.cmd.toggleWhitespace'), run: () => setPrefs({ renderWhitespace: !prefs.renderWhitespace }) },
    { id: 'editor.action.toggleStickyScroll', label: t('code.cmd.toggleStickyScroll'), run: () => setPrefs({ stickyScroll: !prefs.stickyScroll }) },
    { id: 'editor.action.lineNumbers', label: t('code.cmd.lineNumbers'), run: pickLineNumbers },
    { id: 'revealFileInOS', label: t('code.cmd.revealInOs'), run: () => session.active && void window.api.ws.reveal(session.active) },
    { id: 'copyFilePath', label: t('code.cmd.copyPath'), run: () => session.active && void navigator.clipboard.writeText(session.active) },
    { id: 'copyRelativeFilePath', label: t('code.cmd.copyRelativePath'), run: () => session.active && void navigator.clipboard.writeText(relativePath(rootOf(session.active), session.active)) },
    { id: 'workbench.action.restartLanguageServers', label: t('code.cmd.restartServers'), run: restartServers },
    // Navegação do Monaco registrada como comando (fica fora de getSupportedActions).
    { id: 'editor.action.revealDefinition', label: t('code.cmd.gotoDefinition'), keybinding: 'F12', run: () => runEditorAction('editor.action.revealDefinition') },
    { id: 'editor.action.peekDefinition', label: t('code.cmd.peekDefinition'), keybinding: 'Alt+F12', run: () => runEditorAction('editor.action.peekDefinition') },
    { id: 'editor.action.goToTypeDefinition', label: t('code.cmd.gotoTypeDefinition'), run: () => runEditorAction('editor.action.goToTypeDefinition') },
    { id: 'editor.action.goToImplementation', label: t('code.cmd.gotoImplementation'), keybinding: 'Ctrl+F12', run: () => runEditorAction('editor.action.goToImplementation') },
    { id: 'editor.action.goToReferences', label: t('code.cmd.gotoReferences'), keybinding: 'Shift+F12', run: () => runEditorAction('editor.action.goToReferences') },
  ];

  const commandsRef = useRef(commands);
  commandsRef.current = commands;
  const runCommand = (id: string) => {
    const command = commandsRef.current.find((item) => item.id === id);
    if (command) {
      writeStorage(STORAGE.recentCommands, JSON.stringify([id, ...recentCommands().filter((item) => item !== id)].slice(0, MAX_RECENT_COMMANDS)));
      command.run();
      return;
    }
    runEditorAction(id);
  };
  const reopenClosedRef = useRef(reopenClosed);
  reopenClosedRef.current = reopenClosed;
  const runCommandRef = useRef(runCommand);
  runCommandRef.current = runCommand;

  // Modo de captura (testes): comandos do workbench acessíveis ao script de avaliação.
  useEffect(() => {
    if (!window.api.debug) return;
    (window as unknown as { __code: unknown }).__code = { run: (id: string) => runCommandRef.current(id), open: (path: string) => openPathRef.current(path, { pinned: true }) };
  }, []);

  // ---------- Atalhos ----------

  // Atalhos do menu nativo que, na aba Código, valem como no VS Code.
  useEffect(
    () =>
      setCodeMenuHandler((action: MenuAction) => {
        const map: Partial<Record<MenuAction, string>> = {
          'quick-switcher': 'workbench.action.quickOpen',
          'export-pdf': 'workbench.action.showCommands',
          'new-note': 'workbench.action.files.newUntitledFile',
          graph: 'workbench.action.gotoLine',
          'toggle-favorite': 'workbench.view.search',
        };
        // Ctrl+Shift+T reabre o editor fechado; sem nenhum, segue para o App (reabrir guia do app).
        if (action === 'reopen-tab') return reopenClosedRef.current();
        if (action === 'close-tab') {
          if (!session.tabs.length) return false;
          runCommandRef.current('workbench.action.closeActiveEditor');
          return true;
        }
        const id = map[action];
        if (!id) return false;
        runCommandRef.current(id);
        return true;
      }),
    [],
  );

  useEffect(() => {
    let chord = false;
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      // Apertar só o modificador não conta como segunda tecla do acorde.
      if (['control', 'shift', 'alt', 'meta'].includes(key)) return;
      if (!event.ctrlKey && event.key !== 'F1' && !chord) return;
      // Dentro do editor, os acordes Ctrl+K ... são do Monaco (comentar, dobrar); os nossos estão registrados nele.
      const inEditor = event.target instanceof Element && Boolean(event.target.closest('.monaco-editor'));
      let id: string | null = null;
      if (inEditor && (chord || key === 'k')) {
        chord = false;
        return;
      }
      if (chord) {
        chord = false;
        if (key === 't') id = 'workbench.action.selectTheme';
        else if (key === 'm') id = 'workbench.action.editor.changeLanguageMode';
        else if (key === 'o') id = 'workbench.action.files.openFolder';
        else if (key === 'd') id = 'workbench.files.action.compareWithSaved';
        else if (key === 'v') id = 'markdown.showPreviewToSide';
        else if (key === 'z') id = 'workbench.action.toggleZenMode';
      } else if (event.key === 'F1') id = 'workbench.action.showCommands';
      else if (key === 'k' && !event.shiftKey && !event.altKey) {
        chord = true;
        event.preventDefault();
        event.stopPropagation();
        return;
      } else if (event.code === 'Backquote') id = event.shiftKey ? 'workbench.action.terminal.new' : 'workbench.action.terminal.toggleTerminal';
      else if (key === 'b' && !event.shiftKey) id = 'workbench.action.toggleSidebarVisibility';
      else if (key === 'j' && !event.shiftKey) id = 'workbench.action.togglePanel';
      else if (key === 'o' && event.shiftKey) id = 'workbench.action.gotoSymbol';
      else if (key === 'f' && event.shiftKey) id = 'workbench.view.search';
      else if (key === 'h' && event.shiftKey) id = 'workbench.action.replaceInFiles';
      else if (key === 'm' && event.shiftKey) id = 'workbench.actions.view.problems';
      else if (key === 's' && !event.shiftKey) id = 'workbench.action.files.save';
      else if (key === 'n' && event.altKey && !event.shiftKey) id = 'workbench.action.terminal.runActiveFile';
      else if (key === 'pagedown') id = 'workbench.action.nextEditor';
      else if (key === 'pageup') id = 'workbench.action.previousEditor';
      if (!id) return;
      event.preventDefault();
      event.stopPropagation();
      runCommandRef.current(id);
    };
    const onAltZ = (event: KeyboardEvent) => {
      if (event.altKey && !event.ctrlKey && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        runCommandRef.current('editor.action.toggleWordWrap');
      }
      // Alt+← / Alt+→: voltar e avançar entre posições (no terminal, as teclas são do shell).
      if (event.altKey && !event.ctrlKey && !event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        if (event.target instanceof Element && event.target.closest('.xterm')) return;
        event.preventDefault();
        runCommandRef.current(event.key === 'ArrowLeft' ? 'workbench.action.navigateBack' : 'workbench.action.navigateForward');
      }
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keydown', onAltZ, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keydown', onAltZ, true);
    };
  }, []);

  // ---------- Quick Input ----------

  const [files, setFiles] = useState<string[]>([]);
  const [quickValue, setQuickValue] = useState<string | null>(null);
  const quickMain = quick?.kind === 'main' ? quick : null;
  const needsFiles = quickMain !== null && !/^[>:@?]/.test(quickMain.value);
  useEffect(() => {
    if (!needsFiles) return;
    let alive = true;
    void listFiles().then((list) => alive && setFiles(list));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsFiles, roots]);

  const quickItems = useMemo((): { items: QuickItem[]; placeholder: string; message?: string; activeId?: string } => {
    if (!quick) return { items: [], placeholder: '' };
    if (quick.kind === 'pick') {
      const value = (quickValue ?? '').trim();
      const matched = fuzzyFilter(value, quick.items, (item) => item.label, 1000).map(({ item, positions }) => ({ ...item, positions, group: value ? undefined : item.group }));
      return { items: matched, placeholder: quick.placeholder, activeId: quick.activeId };
    }
    if (quick.kind === 'prompt') {
      const error = quick.validate?.(quickValue ?? '');
      return { items: [], placeholder: quick.placeholder, message: error ?? quick.message };
    }
    const value = quick.value;
    if (value.startsWith('>')) {
      const editor = editorRef.current;
      const recent = recentCommands();
      const own = commands.map((command) => ({ id: command.id, label: command.label, keybinding: command.keybinding, group: t('code.quick.workbench') }));
      const editorActions = editor?.getModel()
        ? editor
            .getSupportedActions()
            .filter((action) => action.label && !own.some((command) => command.id === action.id))
            .map((action) => ({ id: action.id, label: action.label, group: t('code.quick.editor') }))
        : [];
      const all = [...own, ...editorActions];
      const query = value.slice(1).trim();
      if (!query) {
        const recentItems = recent.map((id) => all.find((item) => item.id === id)).filter(Boolean).map((item) => ({ ...item!, group: t('code.quick.recent') }));
        return { items: [...recentItems, ...all.filter((item) => !recent.includes(item.id))], placeholder: t('code.quick.commandsPlaceholder') };
      }
      return { items: fuzzyFilter(query, all, (item) => item.label, 300).map(({ item, positions }) => ({ ...item, positions, group: undefined })), placeholder: t('code.quick.commandsPlaceholder') };
    }
    if (value.startsWith(':')) {
      const model = activeModel();
      if (!model) return { items: [], placeholder: '', message: t('code.quick.noEditor') };
      const [line, column] = value.slice(1).split(/[,:]/).map((part) => Number(part.trim()));
      return {
        items: [],
        placeholder: '',
        message: Number.isFinite(line) && line > 0 ? t('code.quick.gotoLineTo', { line, column: Number.isFinite(column) && column > 0 ? column : 1 }) : t('code.quick.gotoLineHint', { line: cursor.line, total: model.getLineCount() }),
      };
    }
    if (value.startsWith('?')) {
      return {
        placeholder: '',
        items: [
          { id: 'help:', label: '…', description: t('code.quick.helpFiles') },
          { id: 'help:>', label: '>', description: t('code.quick.helpCommands') },
          { id: 'help::', label: ':', description: t('code.quick.helpLine') },
          { id: 'help:@', label: '@', description: t('code.quick.helpSymbol') },
        ],
      };
    }
    // Quick Open: arquivos recentes primeiro (sem consulta) ou os que casam com a consulta; "nome:linha:coluna" vai direto à posição.
    const parsed = parseQuickOpen(value);
    const query = parsed.query;
    const lineMessage = parsed.line ? t('code.quick.openAtLine', { line: parsed.line }) : undefined;
    if (!root) return { items: [], placeholder: t('code.quick.filesPlaceholder'), message: t('code.quick.noFolder') };
    const toItem = (path: string, positions: number[] = []): QuickItem => ({
      id: `file:${path}`,
      label: baseName(path),
      description: displayPath(dirName(path)),
      positions,
      icon: <FileIconView icon={iconTheme?.forFile(path, languageForFile(path)) ?? null} />,
    });
    if (!query) {
      const recent = session.recentFiles.filter((path) => roots.some((dir) => isInside(path, dir))).slice(0, 20);
      return { items: [...recent.map((path) => ({ ...toItem(path), group: t('code.quick.recentlyOpened') })), ...files.filter((path) => !recent.some((r) => samePath(r, path))).slice(0, 100).map((path) => toItem(path))], placeholder: t('code.quick.filesPlaceholder') };
    }
    const scored = fuzzyFilter(query, files, (path) => displayPath(path), 100).map(({ item }) => {
      const nameMatch = fuzzyMatch(query, baseName(item));
      return toItem(item, nameMatch?.positions);
    });
    return { items: scored, placeholder: t('code.quick.filesPlaceholder'), message: lineMessage };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quick, quickValue, files, root, roots, iconTheme, t, cursor.line]);

  useEffect(() => {
    if (!quick) setQuickValue(null);
    else if (quick.kind === 'prompt') setQuickValue(quick.value);
    else if (quick.kind === 'pick') setQuickValue('');
  }, [quick]);

  const closeQuick = (cancelled: boolean) => {
    if (cancelled && quick?.kind === 'pick') quick.onCancel?.();
    setQuick(null);
    requestAnimationFrame(() => editorRef.current?.getModel() && editorRef.current.focus());
  };

  const pickQuick = (item: QuickItem | null, value: string) => {
    if (!quick) return;
    if (quick.kind === 'prompt') {
      if (quick.validate?.(value)) return;
      setQuick(null);
      quick.onSubmit(value);
      return;
    }
    if (quick.kind === 'pick') {
      if (!item) return;
      setQuick(null);
      quick.onPick(item);
      return;
    }
    if (value.startsWith(':')) {
      const editor = editorRef.current;
      const [line, column] = value.slice(1).split(/[,:]/).map((part) => Number(part.trim()));
      setQuick(null);
      if (editor && Number.isFinite(line) && line > 0) {
        const position = { lineNumber: line, column: Number.isFinite(column) && column > 0 ? column : 1 };
        editor.setPosition(position);
        editor.revealPositionInCenter(position);
        editor.focus();
      }
      return;
    }
    if (!item) return;
    if (item.id.startsWith('help:')) {
      setQuick({ kind: 'main', value: item.id.slice(5) });
      return;
    }
    setQuick(null);
    if (item.id.startsWith('file:')) {
      const { line, column } = parseQuickOpen(value);
      void openPath(item.id.slice(5), { pinned: true, selection: line ? { lineNumber: line, column: column ?? 1 } : undefined });
    }
    else runCommand(item.id);
  };

  // "@" abre a lista de símbolos do próprio editor (Ir para símbolo).
  useEffect(() => {
    if (quickMain?.value === '@') {
      setQuick(null);
      runEditorAction('editor.action.quickOutline');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickMain?.value]);

  // ---------- Arrastar divisórias ----------

  const startDrag = (axis: 'x' | 'y', event: React.PointerEvent, apply: (delta: number) => void) => {
    event.preventDefault();
    const origin = axis === 'x' ? event.clientX : event.clientY;
    const move = (e: PointerEvent) => apply((axis === 'x' ? e.clientX : e.clientY) - origin);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ---------- Render ----------

  const model = active ? modelFor(active) : null;
  const languageId = model?.getLanguageId();
  const languageLabel = languageId ? (allLanguages().find((language) => language.id === languageId)?.label ?? languageId) : null;
  const lspKind = languageId ? serverForLanguage(languageId) : undefined;
  const isMarkdown = languageId === 'markdown' || languageId === 'mdx';
  const showPreview = layout.preview && isMarkdown;
  const style = { ...cssVariables(colors), background: 'var(--vsc-editor-background)', color: 'var(--vsc-foreground)', colorScheme: kind.includes('light') ? 'light' : 'dark' } as CSSProperties;
  const titleButton = 'wb-icon-btn';

  const activityButton = (view: SideView, title: string, icon: ReactNode) => {
    const selected = layout.sidebar && layout.view === view;
    return (
      <button className="wb-activity-btn" data-on={selected} aria-pressed={selected} title={title} aria-label={title} onClick={() => toggleView(view)}>
        <span aria-hidden className="wb-vein" />
        {icon}
      </button>
    );
  };

  const noFolder = (
    <div className="px-4 py-3">
      <p className="opacity-80">{t('code.explorer.noFolder')}</p>
      <button className="mt-3 w-full rounded-lg py-1.5 font-medium transition-[filter] duration-150 hover:brightness-110" style={{ background: 'var(--vsc-button-background)', color: 'var(--vsc-button-foreground)' }} onClick={() => void openFolder()}>
        {t('code.cmd.openFolder')}
      </button>
    </div>
  );

  const sideTitle: Record<SideView, string> = { explorer: t('code.explorer.title'), search: t('code.search.title'), todo: t('code.todo.title') };

  // Guias do painel (Problemas / Terminal), no lugar do título.
  const problemTotal = markers.errors + markers.warnings;
  const panelTabs = (
    <div className="flex items-center gap-3" role="tablist" aria-label={t('code.panel.label')}>
      {(['problems', 'terminal'] as PanelView[]).map((view) => (
        <button
          key={view}
          role="tab"
          aria-selected={layout.panelView === view}
          className="wb-panel-title"
          data-on={layout.panelView === view}
          onClick={() => {
            setLayout({ panelView: view });
            if (view === 'terminal') setTerminalCommand({ kind: 'focus', serial: Date.now() });
          }}
        >
          {view === 'problems' ? t('code.problems.title') : t('code.terminal')}
          {view === 'problems' && problemTotal > 0 && <span className="wb-badge ml-1.5">{problemTotal}</span>}
        </button>
      ))}
    </div>
  );
  const panelActions = (
    <span className="flex items-center gap-0.5" style={{ color: 'var(--vsc-panelTitle-activeForeground)' }}>
      <button className="wb-icon-btn" title={t('code.cmd.maximizePanel')} aria-label={t('code.cmd.maximizePanel')} onClick={() => setLayout({ panelMax: !layout.panelMax })}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: layout.panelMax ? 'rotate(180deg)' : undefined, transition: 'transform var(--wb-glide) var(--wb-ease)' }}><path d="m4 10 4-4 4 4" /></svg>
      </button>
      <button className="wb-icon-btn" title={t('code.cmd.togglePanel')} aria-label={t('code.cmd.togglePanel')} onClick={() => setLayout({ panel: false, panelMax: false })}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="m4 4 8 8M12 4l-8 8" /></svg>
      </button>
    </span>
  );

  return (
    <div className="wb relative flex h-full min-h-0 flex-col" style={style}>
      <div className="flex min-h-0 flex-1">
        {/* Barra de atividades */}
        {!layout.zen && (
        <nav className="wb-activity" aria-label={t('code.activity.label')}>
          {activityButton(
            'explorer',
            t('code.cmd.showExplorer'),
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="M14.5 3H7.7A1.7 1.7 0 0 0 6 4.7v12.6C6 18.2 6.8 19 7.7 19h9.6c.9 0 1.7-.8 1.7-1.7V7.5L14.5 3Z" /><path d="M14 3v5h5M3 7v13.3c0 .9.8 1.7 1.7 1.7H15" /></svg>,
          )}
          {activityButton(
            'search',
            `${t('code.cmd.showSearch')} (Ctrl+Shift+F)`,
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></svg>,
          )}
          {activityButton(
            'todo',
            t('code.cmd.showTodos'),
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6.5 5.5 8 8 5M4 12.5 5.5 14 8 11M4 18.5 5.5 20 8 17M11 6.5h9M11 12.5h9M11 18.5h6" /></svg>,
          )}
          <span className="flex-1" />
          <button className="wb-activity-btn" title={`${t('code.cmd.showCommands')} (Ctrl+Shift+P)`} aria-label={t('code.cmd.showCommands')} onClick={() => setQuick({ kind: 'main', value: '>' })}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></svg>
          </button>
        </nav>
        )}

        {/* Barra lateral */}
        {layout.sidebar && !layout.zen && (
          <>
            <aside className="wb-side" style={{ width: `min(${layout.sidebarWidth}px, max(170px, 34%))` }} aria-label={sideTitle[layout.view]}>
              <div className="wb-side-title">
                <h2 className="flex-1 truncate">{sideTitle[layout.view]}</h2>
                {layout.view === 'explorer' && (
                  <>
                    <button className={titleButton} title={t('code.cmd.openFolder')} aria-label={t('code.cmd.openFolder')} onClick={() => void openFolder()}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"><path d="M1.5 3.5h4.5l1.5 1.5h7v7.5h-13z" /></svg>
                    </button>
                    <button className={titleButton} title={t('code.cmd.addFolder')} aria-label={t('code.cmd.addFolder')} onClick={() => void addFolder()}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"><path d="M1.5 3.5h4.5l1.5 1.5h7v3M8.5 12.5h-7v-9M12 9.5v5M9.5 12h5" /></svg>
                    </button>
                    <button className={titleButton} title={t('code.cmd.openRecent')} aria-label={t('code.cmd.openRecent')} onClick={pickRecent}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3l2 1.5" /></svg>
                    </button>
                  </>
                )}
              </div>
              {!roots.length ? (
                noFolder
              ) : layout.view === 'search' ? (
                <SearchView host={searchHost} request={searchRequest} rootsKey={roots.join('|')} />
              ) : layout.view === 'todo' ? (
                <TodoView iconTheme={iconTheme} displayPath={displayPath} open={openAt} rootsKey={roots.join('|')} />
              ) : (
                <div className={`flex min-h-0 flex-1 flex-col ${roots.length > 1 ? 'overflow-y-auto' : ''}`}>
                  {roots.map((dir) => (
                    <Explorer
                      key={dir}
                      root={dir}
                      fill={roots.length === 1}
                      iconTheme={iconTheme}
                      activePath={model ? active : null}
                      actions={roots.length > 1 ? { ...explorerActions, removeRoot } : explorerActions}
                      collapseSignal={collapseSignal}
                    />
                  ))}
                </div>
              )}
            </aside>
            <div
              className="wb-sash wb-sash-x"
              onPointerDown={(event) => {
                // Parte da largura que está na tela (pode estar limitada pela janela estreita).
                const width = (event.currentTarget.previousElementSibling as HTMLElement | null)?.offsetWidth ?? layout.sidebarWidth;
                startDrag('x', event, (delta) => setLayout({ sidebarWidth: Math.max(170, Math.min(640, width + delta)) }));
              }}
            />
          </>
        )}

        {/* Editor + painel */}
        <div className="wb-main flex min-w-0 flex-1 flex-col">
          <div className={`flex min-h-0 flex-col ${layout.panel && layout.panelMax ? 'hidden' : 'flex-1'}`}>
            {tabs.length > 0 && (
              <div
                className="wb-tabs"
                role="tablist"
                aria-label={t('code.tabs.label')}
                onKeyDown={(event) => {
                  // Setas andam entre as guias (como numa tablist); Delete fecha a guia focada.
                  const index = tabs.findIndex((tab) => active && samePath(tab.path, active));
                  let next = -1;
                  if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
                  else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
                  else if (event.key === 'Home') next = 0;
                  else if (event.key === 'End') next = tabs.length - 1;
                  else if (event.key === 'Delete' && index >= 0) {
                    event.preventDefault();
                    closeTab(tabs[index].path);
                    return;
                  } else return;
                  event.preventDefault();
                  const list = event.currentTarget;
                  const target = tabs[next];
                  if (!target) return;
                  activate(target.path, false);
                  requestAnimationFrame(() => list.querySelector<HTMLElement>(`[data-path="${CSS.escape(target.path)}"]`)?.focus());
                }}
              >
                {tabs.map((tab) => {
                  const isActive = active !== null && samePath(tab.path, active);
                  const dirty = isDirty(tab.path);
                  return (
                    <div
                      key={tab.path}
                      role="tab"
                      tabIndex={isActive ? 0 : -1}
                      data-path={tab.path}
                      aria-selected={isActive}
                      className="wb-tab"
                      data-active={isActive}
                      data-dirty={dirty}
                      data-preview={tab.preview}
                      title={tab.path}
                      data-pinned={Boolean(tab.pinned)}
                      onClick={() => activate(tab.path)}
                      onDoubleClick={() => setTabs(session.tabs.map((item) => (item === tab ? { ...item, preview: false } : item)))}
                      onAuxClick={(event) => event.button === 1 && closeTab(tab.path)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        openTabMenu(menuPosition(event), tab);
                      }}
                      onKeyDown={(event) => {
                        if (!isMenuKey(event)) return;
                        event.preventDefault();
                        event.stopPropagation();
                        openTabMenu(menuPosition(event), tab);
                      }}
                    >
                      <FileIconView icon={iconTheme?.forFile(tab.path, modelFor(tab.path)?.getLanguageId()) ?? null} />
                      <span className="wb-tab-name truncate">{baseName(tab.path)}</span>
                      {tab.pinned ? (
                        <button
                          className="wb-tab-close wb-tab-pin"
                          title={t('code.tabs.unpin')}
                          aria-label={`${t('code.tabs.unpin')}: ${baseName(tab.path)}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            togglePin(tab.path);
                          }}
                        >
                          <span className="wb-dot" />
                          <svg className="wb-x" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9.5 2.5 13.5 6.5 11 7.5 8.5 10l-.5 3L3 8l3-.5L8.5 5Z" /><path d="m5.5 10.5-3 3" /></svg>
                        </button>
                      ) : (
                        <button
                          className="wb-tab-close"
                          title={t('code.cmd.closeEditor')}
                          aria-label={`${t('code.cmd.closeEditor')}: ${baseName(tab.path)}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            closeTab(tab.path);
                          }}
                        >
                          <span className="wb-dot" />
                          <svg className="wb-x" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="m4.5 4.5 7 7M11.5 4.5l-7 7" /></svg>
                        </button>
                      )}
                    </div>
                  );
                })}
                <Vein axis="x" inset={12} />
              </div>
            )}
            {model && root && !layout.zen && (
              <nav className="wb-crumbs" aria-label={t('code.crumbs.label')}>
                {relativePath(rootOf(active!), active!)
                  .split(/[\\/]/)
                  .filter(Boolean)
                  .map((part, index, parts) => {
                    const last = index === parts.length - 1;
                    // Pasta do segmento: sobe do arquivo tantos níveis quantos faltam até o fim da trilha.
                    let dir = active!;
                    for (let up = parts.length - 1 - index; up > 0; up--) dir = dirName(dir);
                    return (
                      <span key={index} className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          className={`wb-crumb ${last ? 'wb-crumb-last' : ''}`}
                          title={last ? t('code.cmd.gotoSymbol') : t('code.crumbs.pick', { name: part })}
                          onClick={() => (last ? runEditorAction('editor.action.quickOutline') : pickInFolder(dir))}
                        >
                          {part}
                        </button>
                        {!last && <span className="wb-crumb-sep" aria-hidden>/</span>}
                      </span>
                    );
                  })}
              </nav>
            )}
            <div className="flex min-h-0 flex-1">
              <div className="relative min-h-0 min-w-0 flex-1">
                <div ref={host} className={`absolute inset-0 ${model ? '' : 'invisible'}`} />
                {diff && model && <DiffView key={diff.path} path={diff.path} saved={diff.saved} fontSize={prefs.fontSize} onClose={closeDiff} />}
                {!model && (
                  <Welcome
                    t={t}
                    root={root}
                    recent={workspace?.recent ?? []}
                    onCommand={runCommand}
                    onOpenRecent={(dir) => void window.api.ws.setRoot(dir).then(changeRoot, (error) => flash(errorText(error), true))}
                  />
                )}
              </div>
              {showPreview && model && (
                <>
                  <div
                    className="wb-sash wb-sash-x"
                    onPointerDown={(event) => {
                      const width = (event.currentTarget.nextElementSibling as HTMLElement | null)?.offsetWidth ?? layout.previewWidth;
                      startDrag('x', event, (delta) => setLayout({ previewWidth: Math.max(240, Math.min(window.innerWidth * 0.7, width - delta)) }));
                    }}
                  />
                  <div className="wb-md-pane shrink-0" style={{ width: `min(${layout.previewWidth}px, 50%)` }}>
                    <MarkdownPreview
                      model={model}
                      cursorLine={cursor.line}
                      onOpenFile={(href, anchor) => openFromPreview(href, anchor)}
                      onRevealLine={(line) => {
                        const editor = editorRef.current;
                        if (!editor) return;
                        editor.setPosition({ lineNumber: line, column: 1 });
                        editor.revealLineInCenterIfOutsideViewport(line);
                        editor.focus();
                      }}
                      onClose={() => setLayout({ preview: false })}
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          {layout.panel && !layout.zen && (
            <>
              {!layout.panelMax && (
                <div
                  className="wb-sash wb-sash-y"
                  onPointerDown={(event) => {
                    const height = (event.currentTarget.nextElementSibling as HTMLElement | null)?.offsetHeight ?? layout.panelHeight;
                    startDrag('y', event, (delta) => setLayout({ panelHeight: Math.max(100, Math.min(window.innerHeight - 200, height - delta)) }));
                  }}
                />
              )}
              <div className={`shrink-0 border-t ${layout.panelMax ? 'flex-1' : ''}`} style={{ height: layout.panelMax ? undefined : `min(${layout.panelHeight}px, max(100px, 100% - 150px))`, borderColor: 'var(--vsc-panel-border)' }}>
                {layout.panelView === 'problems' ? (
                  <ProblemsPanel
                    tabs={panelTabs}
                    actions={panelActions}
                    version={markerVersion}
                    iconTheme={iconTheme}
                    displayPath={displayPath}
                    open={(path, line, column, endLine, endColumn) => void openPath(path, { pinned: true, selection: { startLineNumber: line, startColumn: column, endLineNumber: endLine, endColumn } })}
                  />
                ) : (
                  <TerminalPanel
                    colors={colors}
                    command={terminalCommand}
                    maximized={layout.panelMax}
                    tabs={panelTabs}
                    onClose={() => setLayout({ panel: false, panelMax: false })}
                    onToggleMaximize={() => setLayout({ panelMax: !layout.panelMax })}
                    onEmpty={() => setLayout({ panel: false, panelMax: false })}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Barra de status */}
      {!layout.zen && (
      <footer className="wb-status" style={{ background: root ? 'var(--vsc-statusBar-background)' : 'var(--vsc-statusBar-noFolderBackground)', color: 'var(--vsc-statusBar-foreground)' }}>
        <button className="wb-status-item wb-status-root" title={root ?? ''} onClick={pickRecent}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"><path d="M1.5 3.5h4.5l1.5 1.5h7v7.5h-13z" /></svg>
          <span className="truncate">{root ? baseName(root) + (roots.length > 1 ? ` +${roots.length - 1}` : '') : t('code.explorer.noFolder')}</span>
        </button>
        <button className="wb-status-item" title={t('code.status.problems')} aria-label={`${t('code.status.problems')}: ${markers.errors} / ${markers.warnings}`} onClick={() => togglePanelView('problems')}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><circle cx="8" cy="8" r="6" /><path d="m5.8 5.8 4.4 4.4M10.2 5.8l-4.4 4.4" /></svg>
          {markers.errors}
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" className="ml-1"><path d="M8 2 14.5 13.5h-13z" /><path d="M8 6.5v3M8 11.6v.1" strokeLinecap="round" /></svg>
          {markers.warnings}
        </button>
        {(Object.keys(SERVER_LANGUAGES) as ServerKind[])
          .filter((serverKind) => serverStatus(serverKind) !== 'off' && !(model && serverKind === lspKind))
          .map((serverKind) => (
            <span key={serverKind} className="wb-status-item" data-prio="3" title={t(`code.lsp.${serverStatus(serverKind)}` as Key)}>
              <span className="wb-led" data-state={serverStatus(serverKind)} />
              {SERVER_LABELS[serverKind]}
            </span>
          ))}
        {notice && (
          <span className="wb-status-item min-w-0 truncate" role="status" style={notice.error ? { color: 'var(--vsc-errorForeground)' } : undefined}>
            {notice.text}
          </span>
        )}
        <span className="flex-1" />
        {model && (
          <>
            <button className="wb-status-item wb-status-mono" onClick={() => setQuick({ kind: 'main', value: ':' })}>
              {t('code.status.position', { line: cursor.line, column: cursor.column })}
              {cursor.selected > 0 && ` ${t('code.status.selected', { count: cursor.selected })}`}
            </button>
            <button className="wb-status-item" data-prio="2" onClick={pickIndentation}>
              {model.getOptions().insertSpaces ? t('code.status.spaces', { size: model.getOptions().tabSize }) : t('code.status.tabSize', { size: model.getOptions().tabSize })}
            </button>
            <span className="wb-status-item" data-prio="3">UTF-8</span>
            <button className="wb-status-item" data-prio="2" onClick={pickEol}>
              {model.getEOL() === '\n' ? 'LF' : 'CRLF'}
            </button>
            <button className="wb-status-item" onClick={pickLanguage} title={lspKind ? t(`code.lsp.${serverStatus(lspKind)}` as Key) : undefined}>
              {lspKind && <span className="wb-led" data-state={serverStatus(lspKind)} />}
              {languageLabel}
            </button>
          </>
        )}
        <button className="wb-status-item" data-prio="1" onClick={() => setPrefs({ autoSave: !prefs.autoSave })} title={t(prefs.autoSave ? 'code.cmd.autoSaveOff' : 'code.cmd.autoSaveOn')}>
          {prefs.autoSave ? t('code.status.autoSave') : t('code.status.manualSave')}
        </button>
      </footer>
      )}

      {tabMenu && <ContextMenu request={tabMenu} onClose={closeTabMenu} />}

      {layout.zen && (
        <button type="button" className="wb-zen-exit" onClick={toggleZen}>
          {t('code.zen.exit')} <kbd className="wb-kbd">Ctrl+K Z</kbd>
        </button>
      )}

      {quick && (
        <QuickInput
          value={quick.kind === 'main' ? quick.value : (quickValue ?? '')}
          placeholder={quickItems.placeholder}
          items={quickItems.items}
          message={quickItems.message}
          activeId={quickItems.activeId}
          onValueChange={(value) => (quick.kind === 'main' ? setQuick({ kind: 'main', value }) : setQuickValue(value))}
          onActive={quick.kind === 'pick' ? quick.onActive : undefined}
          onPick={pickQuick}
          onClose={() => closeQuick(true)}
        />
      )}
    </div>
  );
}

function recentCommands(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE.recentCommands) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

// Tela inicial sem arquivo aberto: cada ação mostra o próprio atalho, para ser aprendido de passagem.
const WELCOME_ACTIONS: [command: string, label: Key, keys: string, icon: ReactNode][] = [
  ['workbench.action.quickOpen', 'code.cmd.quickOpen', 'Ctrl+P', <path key="i" d="M7 12.5a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11ZM11 11l3.5 3.5" />],
  ['workbench.action.showCommands', 'code.cmd.showCommands', 'Ctrl+Shift+P', <path key="i" d="m3 4.5 3.5 3.5L3 11.5M8.5 12h5" />],
  ['workbench.view.search', 'code.cmd.showSearch', 'Ctrl+Shift+F', <path key="i" d="M2 4h7M2 7.5h5M2 11h4M11.5 13a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM13.3 12.8l1.7 1.7" />],
  ['workbench.action.files.newUntitledFile', 'code.cmd.newFile', 'Ctrl+N', <path key="i" d="M9.5 1.5h-6v13h9v-10zM9.5 1.5v3h3M8 7.5v5M5.5 10h5" />],
  ['workbench.action.files.openFolder', 'code.cmd.openFolder', 'Ctrl+K Ctrl+O', <path key="i" d="M1.5 3.5h4.5l1.5 1.5h7v7.5h-13z" />],
  ['workbench.action.addRootFolder', 'code.cmd.addFolder', '', <path key="i" d="M1.5 3.5h4.5l1.5 1.5h7v3M8.5 12.5h-7v-9M12 9.5v5M9.5 12h5" />],
  ['workbench.action.terminal.toggleTerminal', 'code.cmd.toggleTerminal', 'Ctrl+`', <path key="i" d="M1.5 2.5h13v11h-13zM4 6l2.5 2L4 10M8 10.5h4" />],
  ['workbench.action.selectTheme', 'code.cmd.selectTheme', 'Ctrl+K Ctrl+T', <path key="i" d="M8 1.5a6.5 6.5 0 1 0 0 13c1 0 1.3-.8.9-1.6-.5-1 .1-2.1 1.2-2.1h1.6a2.8 2.8 0 0 0 2.8-2.8c0-3.6-2.9-6.5-6.5-6.5ZM4.5 8h.01M6 5h.01M10 5h.01" />],
];

function Welcome({ t, root, recent, onCommand, onOpenRecent }: { t: ReturnType<typeof useT>; root: string | null; recent: string[]; onCommand(id: string): void; onOpenRecent(dir: string): void }) {
  const icon = (shape: ReactNode) => (
    <span className="wb-action-icon">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        {shape}
      </svg>
    </span>
  );
  const others = recent.filter((dir) => !root || !samePath(dir, root)).slice(0, 7);
  return (
    <div className="wb-welcome">
      <div className="wb-welcome-inner">
        {/* Caminho longo: corta o começo, para a pasta aberta continuar à vista. */}
        <p className="wb-eyebrow" title={root ?? undefined}>
          <bdi>{root ?? t('code.explorer.noFolder')}</bdi>
        </p>
        <h1>{t('code.welcome.title')}</h1>
        <div className="wb-welcome-vein" aria-hidden />
        <p className="wb-welcome-lede">{t('code.welcome.subtitle')}</p>
        <div className="wb-welcome-grid">
          <section>
            <h2>{t('code.welcome.start')}</h2>
            {WELCOME_ACTIONS.map(([command, label, keys, shape]) => (
              <button key={command} className="wb-action" onClick={() => onCommand(command)}>
                {icon(shape)}
                <span className="flex-1 truncate">{t(label)}</span>
                {keys && <kbd className="wb-kbd shrink-0">{keys}</kbd>}
              </button>
            ))}
          </section>
          <section>
            <h2>{t('code.welcome.recent')}</h2>
            {others.length === 0 && <p className="px-2.5 py-1.5 text-[13px] opacity-60">{t('code.welcome.noRecent')}</p>}
            {others.map((dir) => (
              <button key={dir} className="wb-action" title={dir} onClick={() => onOpenRecent(dir)}>
                {icon(<path d="M1.5 3.5h4.5l1.5 1.5h7v7.5h-13z" />)}
                <span className="shrink-0">{baseName(dir)}</span>
                <span className="wb-action-detail">{dirName(dir)}</span>
              </button>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
