import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import cssWorker from 'monaco-editor/language/css/css.worker.js?worker';
import htmlWorker from 'monaco-editor/language/html/html.worker.js?worker';
import jsonWorker from 'monaco-editor/language/json/json.worker.js?worker';
import tsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker';
import { useEffect, useMemo, useRef, useState } from 'react';

import { dirName } from '../lib/links';
import { monacoLanguage, toMonacoTheme, toSnippetEntries, type SnippetEntry, type VsExtension } from '../lib/vscode';

const SAVE_DELAY_MS = 600;
const THEME_STORAGE_KEY = 'obnotion:code-theme';
const DEFAULT_THEME = 'obnotion';
const EXTENSION_THEME = 'obnotion-extension';

self.MonacoEnvironment = {
  getWorker(_id, label) {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  },
};

// Cada arquivo é analisado sozinho, sem o projeto em volta: erros de importação seriam falsos.
for (const defaults of [monaco.typescript.typescriptDefaults, monaco.typescript.javascriptDefaults]) {
  defaults.setDiagnosticsOptions({ noSemanticValidation: true });
}

// Tema da casa: o editor assentado na obsidiana.
monaco.editor.defineTheme(DEFAULT_THEME, {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '7f8a9b', fontStyle: 'italic' },
    { token: 'keyword', foreground: '86d9cd' },
    { token: 'string', foreground: 'e6c07b' },
    { token: 'number', foreground: 'c8a6f2' },
    { token: 'type', foreground: '8fb4ff' },
  ],
  colors: {
    'editor.background': '#0a0d13',
    'editor.foreground': '#e7ecf3',
    'editorLineNumber.foreground': '#2d3648',
    'editorLineNumber.activeForeground': '#aeb8c7',
    'editor.lineHighlightBackground': '#10141c',
    'editor.selectionBackground': '#4fbfb455',
    'editorCursor.foreground': '#4fbfb4',
    'editorWidget.background': '#10141c',
    'editorSuggestWidget.background': '#10141c',
  },
});

const field =
  'min-w-0 rounded-md bg-obsidian-950/60 px-2.5 py-1.5 text-[12.5px] text-frost-100 outline-none ring-1 ring-[var(--hairline-strong)] placeholder:text-frost-500 focus:ring-sheen-400';
const ghostButton =
  'rounded-md px-2.5 py-1.5 text-[12.5px] text-frost-300 ring-1 ring-[var(--hairline-strong)] hover:bg-[var(--hover)] hover:text-frost-100';

type SaveState = 'saved' | 'pending' | 'error';

function ExtensionList({ extensions }: { extensions: VsExtension[] }) {
  const groups: [title: string, items: VsExtension[]][] = [
    ['Instaladas por você', extensions.filter((e) => !e.builtin)],
    ['Do VS Code', extensions.filter((e) => e.builtin)],
  ];
  const chip = 'rounded px-1.5 py-0.5 font-mono text-[10.5px] ring-1 ring-[var(--hairline-strong)]';

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <h2 className="font-display text-xl font-semibold text-frost-100">Extensões do VS Code</h2>
      <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-frost-500">
        O ObNotion lê as extensões já instaladas no seu VS Code. Temas de cor e snippets funcionam aqui. Extensões que
        dependem de código próprio (ESLint, Prettier, depuradores, assistentes) continuam funcionando só no VS Code.
      </p>
      {!extensions.length && <p className="mt-6 text-frost-500">Nenhuma extensão encontrada. Instale o VS Code ou alguma extensão nele.</p>}
      {groups.map(
        ([title, items]) =>
          items.length > 0 && (
            <section key={title} className="mt-6">
              <div className="section-label mb-2">
                {title} · {items.length}
              </div>
              <ul className="grid gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
                {items.map((extension) => {
                  const applied = extension.themes.length + extension.snippets.length > 0;
                  return (
                    <li key={`${extension.id}@${extension.version}`} className="rounded-md px-3 py-2 ring-1 ring-[var(--hairline)]">
                      <div className="flex items-baseline gap-2">
                        <span className={`truncate text-[13px] ${applied ? 'text-frost-100' : 'text-frost-500'}`}>{extension.name}</span>
                        <span className="shrink-0 font-mono text-[10.5px] text-frost-500">{extension.version}</span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5 text-frost-300">
                        {extension.themes.length > 0 && <span className={`${chip} text-sheen-300`}>{extension.themes.length} tema(s)</span>}
                        {extension.snippets.length > 0 && <span className={`${chip} text-sheen-300`}>snippets</span>}
                        {extension.grammars > 0 && <span className={`${chip} text-frost-500`}>gramática não aplicada</span>}
                        {extension.hasCode && <span className={`${chip} text-frost-500`}>código só no VS Code</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ),
      )}
    </div>
  );
}

export default function Code() {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const session = useRef<{ path: string | null; timer: number; dirty: boolean }>({ path: null, timer: 0, dirty: false });
  const [files, setFiles] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [newName, setNewName] = useState('');
  const [view, setView] = useState<'editor' | 'extensions'>('editor');
  const [extensions, setExtensions] = useState<VsExtension[]>([]);
  const [themePath, setThemePath] = useState(() => localStorage.getItem(THEME_STORAGE_KEY) ?? '');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [problem, setProblem] = useState('');

  const refresh = async () => {
    const list = await window.api.filesList();
    setFiles(list);
    return list;
  };

  const flush = async () => {
    const s = session.current;
    window.clearTimeout(s.timer);
    if (!s.dirty || !s.path || !editor.current) return;
    s.dirty = false;
    try {
      await window.api.write(s.path, editor.current.getValue());
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;

  useEffect(() => {
    const instance = monaco.editor.create(host.current!, {
      theme: DEFAULT_THEME,
      automaticLayout: true,
      fontFamily: getComputedStyle(document.body).getPropertyValue('--font-mono'),
      fontSize: 13,
      lineHeight: 21,
      minimap: { enabled: false },
      padding: { top: 14 },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      tabSize: 2,
    });
    editor.current = instance;
    instance.onDidChangeModelContent(() => {
      const s = session.current;
      if (!s.path) return;
      s.dirty = true;
      setSaveState('pending');
      window.clearTimeout(s.timer);
      s.timer = window.setTimeout(() => void flushRef.current(), SAVE_DELAY_MS);
    });
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void flushRef.current());

    void refresh();
    void window.api.extList().then(setExtensions);

    return () => {
      void flushRef.current();
      instance.getModel()?.dispose();
      instance.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Snippets das extensões: um provedor por linguagem, carregado só quando o editor pede sugestões.
  useEffect(() => {
    const byLanguage = new Map<string, Set<string>>();
    for (const extension of extensions) {
      for (const snippet of extension.snippets) {
        // Snippets sem linguagem valem para tudo no VS Code; aqui ficam de fora.
        if (!snippet.language) continue;
        const language = monacoLanguage(snippet.language);
        byLanguage.set(language, (byLanguage.get(language) ?? new Set()).add(snippet.path));
      }
    }
    const disposables = [...byLanguage.entries()].map(([language, paths]) => {
      let loaded: Promise<SnippetEntry[]> | null = null;
      const load = () =>
        (loaded ??= Promise.all([...paths].map((path) => window.api.extSnippets(path).then(toSnippetEntries, () => []))).then((lists) => lists.flat()));
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

  const themes = useMemo(() => extensions.flatMap((extension) => extension.themes.map((theme) => ({ ...theme, extension: extension.name }))), [extensions]);

  useEffect(() => {
    const theme = themes.find((t) => t.path === themePath);
    if (!theme) {
      monaco.editor.setTheme(DEFAULT_THEME);
      return;
    }
    let alive = true;
    void window.api.extTheme(theme.path).then(
      (data) => {
        if (!alive) return;
        monaco.editor.defineTheme(EXTENSION_THEME, toMonacoTheme(data, theme.uiTheme));
        monaco.editor.setTheme(EXTENSION_THEME);
      },
      () => monaco.editor.setTheme(DEFAULT_THEME),
    );
    return () => {
      alive = false;
    };
  }, [themePath, themes]);

  const chooseTheme = (path: string) => {
    setThemePath(path);
    localStorage.setItem(THEME_STORAGE_KEY, path);
  };

  const select = async (path: string) => {
    await flush();
    setProblem('');
    let content: string;
    try {
      content = await window.api.read(path);
    } catch {
      return setProblem(`Não foi possível ler ${path}.`);
    }
    const instance = editor.current!;
    const previous = instance.getModel();
    session.current.path = null;
    // A linguagem sai da extensão do arquivo, como no VS Code.
    instance.setModel(monaco.editor.createModel(content, undefined, monaco.Uri.file(`/${path}`)));
    previous?.dispose();
    session.current.path = path;
    setSelected(path);
    setSaveState('saved');
    setView('editor');
  };

  const createFile = async () => {
    const name = newName.trim().replace(/\\/g, '/').replace(/^\/+/, '');
    if (!name) return;
    setProblem('');
    try {
      const path = await window.api.create(name);
      setNewName('');
      await refresh();
      await select(path);
    } catch {
      setProblem(`Não foi possível criar ${name}.`);
    }
  };

  const deleteFile = async (path: string) => {
    if (path === selected) {
      session.current = { path: null, timer: 0, dirty: false };
      editor.current?.getModel()?.dispose();
      setSelected(null);
    }
    await window.api.remove(path);
    await refresh();
  };

  const groups = useMemo(() => {
    const wanted = filter.trim().toLowerCase();
    const byFolder = new Map<string, string[]>();
    for (const path of files) {
      if (wanted && !path.toLowerCase().includes(wanted)) continue;
      const folder = dirName(path).replace(/\/$/, '');
      byFolder.set(folder, [...(byFolder.get(folder) ?? []), path]);
    }
    return [...byFolder.entries()];
  }, [files, filter]);

  const language = selected ? editor.current?.getModel()?.getLanguageId() : undefined;

  return (
    <div className="flex h-full min-h-0 text-[13px]">
      <aside className="flex w-64 shrink-0 flex-col border-r border-[var(--hairline)] max-[860px]:w-48">
        <div className="section-label px-3 pb-2 pt-3">Arquivos · {files.length}</div>
        <form
          className="flex gap-2 px-3 pb-2"
          onSubmit={(event) => {
            event.preventDefault();
            void createFile();
          }}
        >
          <input className={`${field} flex-1 font-mono`} placeholder="pasta/arquivo.ts" value={newName} spellCheck={false} onChange={(event) => setNewName(event.target.value)} />
          <button className={`${ghostButton} shrink-0`} type="submit">
            Criar
          </button>
        </form>
        <div className="px-3 pb-3">
          <input className={`${field} w-full`} placeholder="Filtrar arquivos…" value={filter} spellCheck={false} onChange={(event) => setFilter(event.target.value)} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {groups.map(([folder, paths]) => (
            <div key={folder} className="mb-2">
              <div className="truncate px-2 py-1 font-mono text-[11px] text-frost-500" title={folder}>
                {folder || '/'}
              </div>
              {paths.map((path) => (
                <div
                  key={path}
                  className={`row group cursor-pointer px-2 ${path === selected && view === 'editor' ? 'bg-[var(--hover-strong)] text-frost-100' : 'hover:bg-[var(--hover)]'}`}
                  title={path}
                  onClick={() => void select(path)}
                >
                  <span className="flex-1 truncate font-mono text-[12.5px]">{path.split('/').pop()}</span>
                  <button
                    className="rounded px-1 text-frost-500 opacity-0 hover:text-danger group-hover:opacity-100"
                    title="Mover para a lixeira"
                    onClick={(event) => {
                      event.stopPropagation();
                      void deleteFile(path);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ))}
          {!groups.length && <p className="px-2 py-1 text-frost-500">{files.length ? 'Nenhum arquivo com esse filtro.' : 'Vault sem arquivos. Crie o primeiro acima.'}</p>}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--hairline)] px-4 py-2">
          <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-frost-100">{view === 'extensions' ? 'Extensões' : selected ?? 'Nenhum arquivo aberto'}</span>
          {view === 'editor' && selected && (
            <span className="font-mono text-[11px] text-frost-500">
              {language} · {saveState === 'saved' ? 'salvo' : saveState === 'pending' ? 'salvando…' : 'erro ao salvar'}
            </span>
          )}
          <select className={`${field} max-w-56`} value={themes.some((t) => t.path === themePath) ? themePath : ''} title="Tema do editor" onChange={(event) => chooseTheme(event.target.value)}>
            <option value="">Tema ObNotion</option>
            {themes.map((theme) => (
              <option key={theme.path} value={theme.path}>
                {theme.label}
              </option>
            ))}
          </select>
          <button className={`${ghostButton} ${view === 'extensions' ? 'bg-[var(--hover-strong)] text-frost-100' : ''}`} onClick={() => setView(view === 'extensions' ? 'editor' : 'extensions')}>
            Extensões · {extensions.length}
          </button>
        </div>
        {problem && <p className="px-4 py-2 text-[12.5px] text-danger">{problem}</p>}

        {view === 'extensions' && <ExtensionList extensions={extensions} />}
        <div className={`relative min-h-0 flex-1 ${view === 'extensions' ? 'hidden' : ''}`}>
          <div ref={host} className={`absolute inset-0 ${selected ? '' : 'invisible'}`} />
          {!selected && (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-frost-500">
              <p className="font-display text-lg text-frost-100">Nenhum arquivo aberto</p>
              <p>Escolha um arquivo na lista ou crie um novo, com a extensão no nome (ex.: notas/script.py).</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
