import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import cssWorker from 'monaco-editor/language/css/css.worker.js?worker';
import htmlWorker from 'monaco-editor/language/html/html.worker.js?worker';
import jsonWorker from 'monaco-editor/language/json/json.worker.js?worker';
import tsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { setCodeMenuHandler } from '../lib/codeBridge';
import { fuzzyFilter, fuzzyMatch } from '../lib/fuzzy';
import { useT, type Key } from '../lib/i18n';
import { loadIconTheme, type IconTheme } from '../lib/iconTheme';
import { configureServers, ensureServer, onServerStatus, restartServers, SERVER_LABELS, SERVER_LANGUAGES, serverForLanguage, serverStatus, setModelOpener, type ServerKind } from '../lib/lsp';
import { baseName, dirName, isInside, joinPath, relativePath, samePath } from '../lib/paths';
import { allLanguages, applyTokenTheme, fileLanguage, installExtensions, languageForFile } from '../lib/textmate';
import { toMonacoTheme, toSnippetEntries, type SnippetEntry, type VsExtension, type VsTheme } from '../lib/vscode';
import { cssVariables, OBNOTION_THEME, themeKind, workbenchColors, type ThemeKind, type WorkbenchColors } from '../lib/workbenchTheme';
import type { DirEntry, MenuAction, WorkspaceState } from '../types';
import { Explorer } from './code/Explorer';
import { FileIconView } from './code/FileIconView';
import { QuickInput, type QuickItem } from './code/QuickInput';
import { TerminalPanel, type TerminalCommand } from './code/TerminalPanel';

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
const STORAGE = {
  colorTheme: 'obnotion:code-theme',
  iconTheme: 'obnotion:code-icon-theme',
  layout: 'obnotion:code-layout',
  editor: 'obnotion:code-editor',
  recentCommands: 'obnotion:code-recent-commands',
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

type EditorTab = { path: string; preview: boolean };
type Layout = { sidebar: boolean; sidebarWidth: number; panel: boolean; panelHeight: number; panelMax: boolean };
type EditorPrefs = { minimap: boolean; wordWrap: boolean; fontSize: number; autoSave: boolean };

const DEFAULT_LAYOUT: Layout = { sidebar: true, sidebarWidth: 260, panel: false, panelHeight: 260, panelMax: false };
const DEFAULT_PREFS: EditorPrefs = { minimap: true, wordWrap: false, fontSize: 13, autoSave: true };

// O que sobrevive à troca de aba: abas do editor, posição de cada arquivo e versão salva de cada modelo.
const session = {
  tabs: [] as EditorTab[],
  active: null as string | null,
  viewStates: new Map<string, monaco.editor.ICodeEditorViewState | null>(),
  saved: new Map<string, number>(),
  installed: null as Promise<VsExtension[]> | null,
  files: null as { root: string; list: Promise<string[]> } | null,
  recentFiles: [] as string[],
};

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
  if (!choice) return { theme: OBNOTION_THEME, uiTheme: 'vs-dark' };
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
  const [layout, setLayoutState] = useState<Layout>(() => readStorage(STORAGE.layout, DEFAULT_LAYOUT));
  const [prefs, setPrefsState] = useState<EditorPrefs>(() => readStorage(STORAGE.editor, DEFAULT_PREFS));
  const [themePath, setThemePath] = useState(() => localStorage.getItem(STORAGE.colorTheme) ?? '');
  const [iconThemePath, setIconThemePath] = useState<string | null>(() => localStorage.getItem(STORAGE.iconTheme));
  const [colors, setColors] = useState<WorkbenchColors>(() => workbenchColors(OBNOTION_THEME, 'dark'));
  const [kind, setKind] = useState<ThemeKind>('dark');
  const [iconTheme, setIconTheme] = useState<IconTheme | null>(null);
  const [quick, setQuick] = useState<Quick | null>(null);
  const [cursor, setCursor] = useState({ line: 1, column: 1, selected: 0 });
  const [markers, setMarkers] = useState({ errors: 0, warnings: 0 });
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [terminalCommand, setTerminalCommand] = useState<TerminalCommand | null>(null);
  const [collapseSignal, setCollapseSignal] = useState(0);
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
        applyEditorTheme(OBNOTION_THEME, 'vs-dark');
        setColors(workbenchColors(OBNOTION_THEME, 'dark'));
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

  const save = async (path: string | null = session.active) => {
    if (!path) return;
    const model = modelFor(path);
    if (!model) return;
    window.clearTimeout(autoSaveTimers.current.get(keyOf(path)));
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

  const activate = (path: string | null) => {
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
      requestAnimationFrame(() => editor.focus());
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
    setTabs(next);
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
    setTabs(next);
    if (session.active && samePath(session.active, path)) activate(next[Math.min(index, next.length - 1)]?.path ?? null);
    session.viewStates.delete(keyOf(path));
    disposeIfUnused(path, next);
  };

  const revert = async (path: string) => {
    const model = modelFor(path);
    if (!model) return;
    const content = await window.api.ws.read(path);
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
      stickyScroll: { enabled: true },
      // O realce semântico do servidor repintaria por cima das cores TextMate do tema.
      'semanticHighlighting.enabled': false,
      fixedOverflowWidgets: true,
      model: null,
    });
    editorRef.current = editor;

    const subscriptions: monaco.IDisposable[] = [
      editor.onDidChangeCursorSelection((event) => {
        const model = editor.getModel();
        setCursor({ line: event.selection.positionLineNumber, column: event.selection.positionColumn, selected: model ? model.getValueInRange(event.selection).length : 0 });
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
        let errors = 0;
        let warnings = 0;
        for (const marker of monaco.editor.getModelMarkers({})) {
          if (marker.severity === monaco.MarkerSeverity.Error) errors++;
          else if (marker.severity === monaco.MarkerSeverity.Warning) warnings++;
        }
        setMarkers({ errors, warnings });
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
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void saveRef.current());
    const chord = (second: monaco.KeyCode, id: string) =>
      editor.addCommand(monaco.KeyMod.chord(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, monaco.KeyMod.CtrlCmd | second), () => runCommandRef.current(id));
    chord(monaco.KeyCode.KeyT, 'workbench.action.selectTheme');
    chord(monaco.KeyCode.KeyO, 'workbench.action.files.openFolder');
    editor.addCommand(monaco.KeyMod.chord(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, monaco.KeyCode.KeyM), () => runCommandRef.current('workbench.action.editor.changeLanguageMode'));

    let alive = true;
    void (async () => {
      const [state, list] = await Promise.all([window.api.ws.get(), loadExtensions()]);
      if (!alive) return;
      setWorkspace(state);
      setExtensions(list);
      configureServers(state.root, list.flatMap((extension) => extension.jsonValidation));
      setReady(true);
      if (session.active) activate(session.active);
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
    editorRef.current?.updateOptions({ minimap: { enabled: prefs.minimap }, wordWrap: prefs.wordWrap ? 'on' : 'off', fontSize: prefs.fontSize, lineHeight: Math.round(prefs.fontSize * 1.6) });
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

  // ---------- Perguntas (nome de arquivo etc.) ----------

  const prompt = (placeholder: string, message: string, value: string, onSubmit: (value: string) => void, validate?: (value: string) => string | null) =>
    setQuick({ kind: 'prompt', placeholder, message, value, onSubmit, validate });

  const validName = (value: string) => (!value.trim() ? t('code.prompt.required') : /[<>:"|?*]/.test(value.replace(/^[a-z]:/i, '')) ? t('code.prompt.invalid') : null);

  const explorerActions = {
    open: (path: string, pinned: boolean) => void openPath(path, { pinned }),
    newFile: (dir: string) =>
      prompt(t('code.explorer.newFile'), t('code.prompt.newFile', { dir: relativePath(rootOf(dir), dir) || baseName(dir) }), '', (name) => {
        void window.api.ws.create(joinPath(dir, name.trim()), false).then(
          (path) => openPath(path, { pinned: true }),
          (error) => flash(String(error.message ?? error), true),
        );
      }, validName),
    newFolder: (dir: string) =>
      prompt(t('code.explorer.newFolder'), t('code.prompt.newFolder', { dir: relativePath(rootOf(dir), dir) || baseName(dir) }), '', (name) => {
        void window.api.ws.create(joinPath(dir, name.trim()), true).catch((error) => flash(String(error.message ?? error), true));
      }, validName),
    rename: (entry: DirEntry) =>
      prompt(t('code.explorer.rename'), t('code.prompt.rename', { name: entry.name }), entry.name, (name) => {
        const target = joinPath(dirName(entry.path), name.trim());
        void window.api.ws.rename(entry.path, target).then(async (renamed) => {
          // Abas dentro do que foi renomeado passam a apontar para o novo caminho, com o conteúdo atual.
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
        }, (error) => flash(String(error.message ?? error), true));
      }, validName),
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
          }, (error) => flash(String(error.message ?? error), true));
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
    else editor.trigger('obnotion', id, null);
  };

  const pickTheme = () => {
    const original = themePath;
    const items: QuickItem[] = [
      { id: '', label: t('code.defaultTheme'), description: 'ObNotion', group: t('code.theme.house') },
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
      onPick: (item) => void window.api.ws.setRoot(item.id).then(changeRoot, (error) => flash(String(error.message ?? error), true)),
    });

  const toggleTerminal = () => {
    if (layout.panel) setLayout({ panel: false });
    else {
      setLayout({ panel: true });
      setTerminalCommand({ kind: 'focus', serial: Date.now() });
    }
  };
  const newTerminal = () => {
    setLayout({ panel: true });
    setTerminalCommand({ kind: 'new', serial: Date.now() });
  };

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
    { id: 'workbench.action.files.save', label: t('code.cmd.save'), keybinding: 'Ctrl+S', run: () => void save() },
    {
      id: 'workbench.action.files.saveAs',
      label: t('code.cmd.saveAs'),
      run: () => {
        const model = activeModel();
        if (!model) return;
        void window.api.ws.saveAs(session.active!).then(async (target) => {
          if (!target) return;
          await window.api.ws.write(target, model.getValue());
          await openPath(target, { pinned: true });
        });
      },
    },
    { id: 'workbench.action.files.saveAll', label: t('code.cmd.saveAll'), run: () => session.tabs.filter((tab) => isDirty(tab.path)).forEach((tab) => void save(tab.path)) },
    { id: 'workbench.action.files.revert', label: t('code.cmd.revert'), run: () => session.active && void revert(session.active) },
    { id: 'workbench.action.closeActiveEditor', label: t('code.cmd.closeEditor'), keybinding: 'Ctrl+W', run: () => session.active && closeTab(session.active) },
    { id: 'workbench.action.closeAllEditors', label: t('code.cmd.closeAll'), run: () => [...session.tabs].forEach((tab) => closeTab(tab.path)) },
    { id: 'workbench.action.closeOtherEditors', label: t('code.cmd.closeOthers'), run: () => session.tabs.filter((tab) => !session.active || !samePath(tab.path, session.active)).forEach((tab) => closeTab(tab.path)) },
    { id: 'workbench.action.nextEditor', label: t('code.cmd.nextEditor'), keybinding: 'Ctrl+PageDown', run: () => cycleEditor(1) },
    { id: 'workbench.action.previousEditor', label: t('code.cmd.previousEditor'), keybinding: 'Ctrl+PageUp', run: () => cycleEditor(-1) },
    { id: 'workbench.action.toggleSidebarVisibility', label: t('code.cmd.toggleSidebar'), keybinding: 'Ctrl+B', run: () => setLayout({ sidebar: !layout.sidebar }) },
    { id: 'workbench.view.explorer', label: t('code.cmd.showExplorer'), run: () => setLayout({ sidebar: true }) },
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
  const runCommandRef = useRef(runCommand);
  runCommandRef.current = runCommand;

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
        };
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
      else if (key === 's' && !event.shiftKey) id = 'workbench.action.files.save';
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
    // Quick Open: arquivos recentes primeiro (sem consulta) ou os que casam com a consulta.
    const query = value.trim();
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
    return { items: scored, placeholder: t('code.quick.filesPlaceholder') };
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
    if (item.id.startsWith('file:')) void openPath(item.id.slice(5), { pinned: true });
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
  const style = { ...cssVariables(colors), background: 'var(--vsc-editor-background)', color: 'var(--vsc-foreground)', colorScheme: kind.includes('light') ? 'light' : 'dark' } as CSSProperties;
  const titleButton = 'flex h-[22px] w-[22px] items-center justify-center rounded opacity-80 hover:bg-[var(--vsc-list-hoverBackground)] hover:opacity-100';
  const statusItem = 'flex h-full items-center gap-1 px-2 hover:bg-[var(--vsc-statusBarItem-hoverBackground)]';

  const activityButton = (title: string, icon: ReactNode) => {
    const selected = layout.sidebar;
    return (
      <button
        className="relative flex h-12 w-12 items-center justify-center"
        style={{ color: selected ? 'var(--vsc-activityBar-foreground)' : 'var(--vsc-activityBar-inactiveForeground)' }}
        title={title}
        onClick={() => setLayout({ sidebar: !selected })}
      >
        {selected && <span className="absolute inset-y-0 left-0 w-0.5" style={{ background: 'var(--vsc-activityBar-activeBorder)' }} />}
        {icon}
      </button>
    );
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col text-[13px]" style={style}>
      <div className="flex min-h-0 flex-1">
        {/* Barra de atividades */}
        <nav className="flex w-12 shrink-0 flex-col items-center border-r" style={{ background: 'var(--vsc-activityBar-background)', borderColor: 'var(--vsc-activityBar-border)' }}>
          {activityButton(
            t('code.cmd.showExplorer'),
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M14.5 3H7.7A1.7 1.7 0 0 0 6 4.7v12.6C6 18.2 6.8 19 7.7 19h9.6c.9 0 1.7-.8 1.7-1.7V7.5L14.5 3Z" /><path d="M14 3v5h5M3 7v13.3c0 .9.8 1.7 1.7 1.7H15" /></svg>,
          )}
          <span className="flex-1" />
          <button className="flex h-12 w-12 items-center justify-center" style={{ color: 'var(--vsc-activityBar-inactiveForeground)' }} title={t('code.cmd.showCommands')} onClick={() => setQuick({ kind: 'main', value: '>' })}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></svg>
          </button>
        </nav>

        {/* Barra lateral */}
        {layout.sidebar && (
          <>
            <aside className="flex shrink-0 flex-col border-r" style={{ width: layout.sidebarWidth, background: 'var(--vsc-sideBar-background)', color: 'var(--vsc-sideBar-foreground)', borderColor: 'var(--vsc-sideBar-border)' }}>
              <div className="group flex h-[35px] shrink-0 items-center pl-5 pr-2 text-[11px] uppercase tracking-wide" style={{ color: 'var(--vsc-sideBarTitle-foreground)' }}>
                <span className="flex-1 truncate">{t('code.explorer.title')}</span>
                <button className={titleButton} title={t('code.cmd.openFolder')} onClick={() => void openFolder()}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"><path d="M1.5 3.5h4.5l1.5 1.5h7v7.5h-13z" /></svg>
                </button>
                <button className={titleButton} title={t('code.cmd.addFolder')} onClick={() => void addFolder()}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"><path d="M1.5 3.5h4.5l1.5 1.5h7v3M8.5 12.5h-7v-9M12 9.5v5M9.5 12h5" /></svg>
                </button>
                <button className={titleButton} title={t('code.cmd.openRecent')} onClick={pickRecent}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3l2 1.5" /></svg>
                </button>
              </div>
              {roots.length ? (
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
              ) : (
                <div className="px-5 py-2">
                  <p className="opacity-80">{t('code.explorer.noFolder')}</p>
                  <button className="mt-3 w-full rounded-sm py-1" style={{ background: 'var(--vsc-button-background)', color: 'var(--vsc-button-foreground)' }} onClick={() => void openFolder()}>
                    {t('code.cmd.openFolder')}
                  </button>
                </div>
              )}
            </aside>
            <div
              className="-ml-[3px] w-[5px] shrink-0 cursor-col-resize hover:bg-[var(--vsc-focusBorder)]"
              style={{ zIndex: 5 }}
              onPointerDown={(event) => {
                const width = layout.sidebarWidth;
                startDrag('x', event, (delta) => setLayout({ sidebarWidth: Math.max(170, Math.min(640, width + delta)) }));
              }}
            />
          </>
        )}

        {/* Editor + painel */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className={`flex min-h-0 flex-col ${layout.panel && layout.panelMax ? 'hidden' : 'flex-1'}`}>
            {tabs.length > 0 && (
              <div className="flex h-[35px] shrink-0 overflow-x-auto overflow-y-hidden" style={{ background: 'var(--vsc-editorGroupHeader-tabsBackground)' }}>
                {tabs.map((tab) => {
                  const isActive = active !== null && samePath(tab.path, active);
                  const dirty = isDirty(tab.path);
                  return (
                    <div
                      key={tab.path}
                      className="group relative flex h-full min-w-0 max-w-[220px] shrink-0 cursor-pointer items-center gap-1.5 border-r pl-3 pr-1.5"
                      style={{
                        background: isActive ? 'var(--vsc-tab-activeBackground)' : 'var(--vsc-tab-inactiveBackground)',
                        color: isActive ? 'var(--vsc-tab-activeForeground)' : 'var(--vsc-tab-inactiveForeground)',
                        borderColor: 'var(--vsc-tab-border)',
                      }}
                      title={tab.path}
                      onClick={() => activate(tab.path)}
                      onDoubleClick={() => setTabs(session.tabs.map((item) => (item === tab ? { ...item, preview: false } : item)))}
                      onAuxClick={(event) => event.button === 1 && closeTab(tab.path)}
                    >
                      {isActive && <span className="absolute inset-x-0 top-0 h-px" style={{ background: 'var(--vsc-tab-activeBorderTop)' }} />}
                      {isActive && <span className="absolute inset-x-0 bottom-0 h-px" style={{ background: 'var(--vsc-tab-activeBorder)' }} />}
                      <FileIconView icon={iconTheme?.forFile(tab.path, modelFor(tab.path)?.getLanguageId()) ?? null} />
                      <span className={`truncate ${tab.preview ? 'italic' : ''}`}>{baseName(tab.path)}</span>
                      <button
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-[var(--vsc-list-hoverBackground)] ${dirty || isActive ? '' : 'opacity-0 group-hover:opacity-100'}`}
                        title={t('code.cmd.closeEditor')}
                        onClick={(event) => {
                          event.stopPropagation();
                          closeTab(tab.path);
                        }}
                      >
                        <span className={dirty ? 'group-hover:hidden' : 'hidden'}>●</span>
                        <span className={dirty ? 'hidden group-hover:inline' : ''}>×</span>
                      </button>
                    </div>
                  );
                })}
                <div className="flex-1" />
              </div>
            )}
            {model && root && (
              <div className="flex h-[22px] shrink-0 items-center gap-1 overflow-hidden px-3 text-[12px] opacity-80" style={{ background: 'var(--vsc-editor-background)' }}>
                {relativePath(rootOf(active!), active!)
                  .split(/[\\/]/)
                  .map((part, index, parts) => (
                    <span key={index} className="flex shrink-0 items-center gap-1">
                      {part}
                      {index < parts.length - 1 && <span className="opacity-60">›</span>}
                    </span>
                  ))}
              </div>
            )}
            <div className="relative min-h-0 flex-1">
              <div ref={host} className={`absolute inset-0 ${model ? '' : 'invisible'}`} />
              {!model && (
                <Welcome
                  t={t}
                  recent={workspace?.recent ?? []}
                  onCommand={runCommand}
                  onOpenRecent={(dir) => void window.api.ws.setRoot(dir).then(changeRoot, (error) => flash(String(error.message ?? error), true))}
                />
              )}
            </div>
          </div>

          {layout.panel && (
            <>
              {!layout.panelMax && (
                <div
                  className="-mt-[3px] h-[5px] shrink-0 cursor-row-resize hover:bg-[var(--vsc-focusBorder)]"
                  style={{ zIndex: 5 }}
                  onPointerDown={(event) => {
                    const height = layout.panelHeight;
                    startDrag('y', event, (delta) => setLayout({ panelHeight: Math.max(100, Math.min(window.innerHeight - 200, height - delta)) }));
                  }}
                />
              )}
              <div className={`shrink-0 border-t ${layout.panelMax ? 'flex-1' : ''}`} style={{ height: layout.panelMax ? undefined : layout.panelHeight, borderColor: 'var(--vsc-panel-border)' }}>
                <TerminalPanel
                  colors={colors}
                  command={terminalCommand}
                  maximized={layout.panelMax}
                  onClose={() => setLayout({ panel: false, panelMax: false })}
                  onToggleMaximize={() => setLayout({ panelMax: !layout.panelMax })}
                  onEmpty={() => setLayout({ panel: false, panelMax: false })}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Barra de status */}
      <footer
        className="flex h-[22px] shrink-0 items-stretch border-t text-[12px]"
        style={{ background: root ? 'var(--vsc-statusBar-background)' : 'var(--vsc-statusBar-noFolderBackground)', color: 'var(--vsc-statusBar-foreground)', borderColor: 'var(--vsc-statusBar-border)' }}
      >
        <button className={statusItem} title={root ?? ''} onClick={pickRecent}>
          {root ? baseName(root) + (roots.length > 1 ? ` +${roots.length - 1}` : '') : t('code.explorer.noFolder')}
        </button>
        <button className={statusItem} title={t('code.status.problems')} onClick={toggleTerminal}>
          ⊗ {markers.errors} ⚠ {markers.warnings}
        </button>
        {(Object.keys(SERVER_LANGUAGES) as ServerKind[])
          .filter((serverKind) => serverStatus(serverKind) !== 'off')
          .map((serverKind) => (
            <span key={serverKind} className={statusItem} title={t(`code.lsp.${serverStatus(serverKind)}` as Key)}>
              {serverStatus(serverKind) === 'starting' ? '◌' : serverStatus(serverKind) === 'error' ? '⚠' : '✓'} {SERVER_LABELS[serverKind]}
            </span>
          ))}
        {notice && <span className={`${statusItem} truncate`} style={notice.error ? { color: 'var(--vsc-errorForeground)' } : undefined}>{notice.text}</span>}
        <span className="flex-1" />
        {model && (
          <>
            <button className={statusItem} onClick={() => setQuick({ kind: 'main', value: ':' })}>
              {t('code.status.position', { line: cursor.line, column: cursor.column })}
              {cursor.selected > 0 && ` ${t('code.status.selected', { count: cursor.selected })}`}
            </button>
            <button className={statusItem} onClick={pickIndentation}>
              {model.getOptions().insertSpaces ? t('code.status.spaces', { size: model.getOptions().tabSize }) : t('code.status.tabSize', { size: model.getOptions().tabSize })}
            </button>
            <span className={statusItem}>UTF-8</span>
            <button className={statusItem} onClick={pickEol}>
              {model.getEOL() === '\n' ? 'LF' : 'CRLF'}
            </button>
            <button className={statusItem} onClick={pickLanguage} title={lspKind ? t(`code.lsp.${serverStatus(lspKind)}` as Key) : undefined}>
              {lspKind && serverStatus(lspKind) === 'ready' ? '{ } ' : ''}
              {languageLabel}
            </button>
          </>
        )}
        <button className={statusItem} onClick={() => setPrefs({ autoSave: !prefs.autoSave })} title={t(prefs.autoSave ? 'code.cmd.autoSaveOff' : 'code.cmd.autoSaveOn')}>
          {prefs.autoSave ? t('code.status.autoSave') : t('code.status.manualSave')}
        </button>
      </footer>

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

// Tela inicial sem arquivo aberto, como o "Get Started" do VS Code.
function Welcome({ t, recent, onCommand, onOpenRecent }: { t: ReturnType<typeof useT>; recent: string[]; onCommand(id: string): void; onOpenRecent(dir: string): void }) {
  const link = 'block py-0.5 text-left text-[var(--vsc-list-highlightForeground)] hover:underline';
  const shortcuts: [Key, string][] = [
    ['code.cmd.showCommands', 'Ctrl+Shift+P'],
    ['code.cmd.quickOpen', 'Ctrl+P'],
    ['code.cmd.toggleTerminal', 'Ctrl+`'],
    ['code.cmd.toggleSidebar', 'Ctrl+B'],
    ['code.cmd.selectTheme', 'Ctrl+K Ctrl+T'],
  ];
  return (
    <div className="absolute inset-0 overflow-y-auto px-10 py-12" style={{ background: 'var(--vsc-editor-background)' }}>
      <h1 className="text-3xl font-light" style={{ color: 'var(--vsc-editor-foreground)' }}>
        {t('code.welcome.title')}
      </h1>
      <p className="mt-1 opacity-70">{t('code.welcome.subtitle')}</p>
      <div className="mt-8 grid max-w-3xl gap-10 sm:grid-cols-2">
        <section>
          <h2 className="mb-2 text-[15px]" style={{ color: 'var(--vsc-editor-foreground)' }}>
            {t('code.welcome.start')}
          </h2>
          <button className={link} onClick={() => onCommand('workbench.action.files.newUntitledFile')}>
            {t('code.cmd.newFile')}
          </button>
          <button className={link} onClick={() => onCommand('workbench.action.files.openFile')}>
            {t('code.cmd.openFile')}
          </button>
          <button className={link} onClick={() => onCommand('workbench.action.files.openFolder')}>
            {t('code.cmd.openFolder')}
          </button>
          <button className={link} onClick={() => onCommand('workbench.action.selectTheme')}>
            {t('code.cmd.selectTheme')}
          </button>
          <h2 className="mb-2 mt-6 text-[15px]" style={{ color: 'var(--vsc-editor-foreground)' }}>
            {t('code.welcome.recent')}
          </h2>
          {recent.length === 0 && <p className="opacity-70">{t('code.welcome.noRecent')}</p>}
          {recent.slice(0, 6).map((dir) => (
            <div key={dir} className="flex gap-3">
              <button className={link} onClick={() => onOpenRecent(dir)}>
                {baseName(dir)}
              </button>
              <span className="truncate py-0.5 opacity-60">{dirName(dir)}</span>
            </div>
          ))}
        </section>
        <section>
          <h2 className="mb-2 text-[15px]" style={{ color: 'var(--vsc-editor-foreground)' }}>
            {t('code.welcome.shortcuts')}
          </h2>
          {shortcuts.map(([key, keys]) => (
            <div key={key} className="flex items-center justify-between gap-4 py-1">
              <span className="opacity-80">{t(key)}</span>
              <kbd className="rounded px-1.5 font-mono text-[11.5px] ring-1 ring-[var(--vsc-pickerGroup-border)]">{keys}</kbd>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
