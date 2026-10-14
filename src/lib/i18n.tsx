import { createContext, Fragment, useContext, useMemo, useState, type ReactNode } from 'react';

export type Language = 'pt-BR' | 'en';

// Nome de cada língua na própria língua: é assim que aparece no seletor.
export const LANGUAGES: readonly (readonly [Language, string])[] = [
  ['pt-BR', 'Português (Brasil)'],
  ['en', 'English'],
];

// Um texto simples ou as formas de plural, escolhidas pela variável `count`.
type Entry = string | { one: string; other: string };

// O português é a referência das chaves: `en` precisa ter exatamente as mesmas.
const ptBR = {
  'common.moveToTrash': 'Mover para a lixeira',
  'common.value': 'Valor',

  'nav.graph': 'Grafo',
  'nav.requests': 'Requests',
  'nav.code': 'Código',

  'note.untitled': 'Sem título',
  'editor.titleLabel': 'Título da página',

  'welcome.title': 'Suas notas, na sua pasta, em blocos.',
  'welcome.body':
    'Suas notas ficam em arquivos Markdown numa pasta do seu computador. Escolha a pasta para começar; pode ser um vault do Obsidian que você já usa.',
  'welcome.choose': 'Escolher pasta do vault',
  'welcome.feature.files': 'Arquivos .md comuns, sem conta e sem nuvem',
  'welcome.feature.links': 'Links entre páginas, backlinks e grafo',
  'welcome.feature.blocks': 'Editor de blocos com o menu {key}',
  'welcome.sample.path': 'Projetos/Casa nova.md',
  'welcome.sample.title': 'Casa nova',
  'welcome.sample.body': 'Mudança marcada para março. O orçamento está em {budget} e as medidas dos cômodos em {plan}.',
  'welcome.sample.budget': 'Finanças',
  'welcome.sample.plan': 'Planta',
  'welcome.sample.done': 'Fechar o contrato',
  'welcome.sample.todo': 'Pedir três orçamentos de frete',

  'empty.title': 'Nenhuma página aberta',
  'empty.hint': 'Escolha uma página na barra lateral ou use um atalho.',
  'empty.search': 'Buscar uma página',
  'empty.create': 'Criar uma página',
  'empty.graph': 'Abrir o grafo',

  'sidebar.search': 'Buscar',
  'sidebar.newPage': 'Nova página',
  'sidebar.pages': 'Páginas',
  'sidebar.newPageHere': 'Nova página nesta pasta',
  'sidebar.newPageIn': 'Nova página em {folder}',
  'sidebar.trashNote': 'Mover {name} para a lixeira',
  'sidebar.emptyTitle': 'Vault vazio',
  'sidebar.emptyHint': '{key} cria a primeira página.',
  'sidebar.settings': 'Configurações',

  'tabs.new': 'Nova guia',
  'tabs.close': 'Fechar guia',
  'tabs.closeNamed': 'Fechar guia {name}',

  'links.backlinks': 'Backlinks',
  'links.noBacklinks': 'Nenhuma página aponta para esta.',
  'links.outgoing': 'Links nesta página',
  'links.missing': 'Página ainda não existe: clique para criar',
  'links.hint': 'Digite {key} para ligar a outra página.',

  'switcher.placeholder': 'Buscar ou criar página…',
  'switcher.label': 'Buscar ou criar página',
  'switcher.create': '{key} cria a página “{name}”',
  'switcher.empty': 'Nenhuma página.',
  'switcher.navigate': 'navegar',
  'switcher.open': 'abrir',
  'switcher.close': 'fechar',

  'settings.title': 'Configurações',
  'settings.language': 'Idioma',
  'settings.vault': 'Vault',
  'settings.noVault': 'Nenhum vault escolhido',
  'settings.changeVault': 'Trocar de vault',

  'graph.pages': { one: '{count} página', other: '{count} páginas' },
  'graph.links': { one: '{count} link', other: '{count} links' },
  'graph.openSettings': 'Ajustes do grafo',
  'graph.closeSettings': 'Fechar ajustes',
  'graph.filters': 'Filtros',
  'graph.filterPlaceholder': 'Filtrar páginas…',
  'graph.orphans': 'Páginas sem links',
  'graph.display': 'Exibição',
  'graph.arrows': 'Setas',
  'graph.textFade': 'Sumir texto ao afastar',
  'graph.nodeSize': 'Tamanho dos nós',
  'graph.lineSize': 'Espessura dos links',
  'graph.forces': 'Forças',
  'graph.center': 'Força do centro',
  'graph.repel': 'Força de repulsão',
  'graph.link': 'Força dos links',
  'graph.linkDistance': 'Distância dos links',
  'graph.reset': 'Restaurar padrões',

  'requests.new': 'Nova request',
  'requests.activeEnvironment': 'Ambiente ativo',
  'requests.noEnvironment': 'Sem ambiente',
  'requests.variables': 'Variáveis',
  'requests.empty': 'Nenhuma request ainda. Crie a primeira ou copie uma coleção do Bruno para o vault.',
  'requests.noneSelected': 'Nenhuma request selecionada',
  'requests.namePlaceholder': 'Nome da request',
  'requests.urlPlaceholder': 'https://api.exemplo.com/recurso ou {{baseUrl}}/recurso',
  'requests.send': 'Enviar',
  'requests.cancel': 'Cancelar',
  'requests.missingVariables': 'Variáveis sem valor no ambiente ativo: {names}',
  'requests.tab.params': 'Parâmetros',
  'requests.tab.headers': 'Headers',
  'requests.tab.body': 'Corpo',
  'requests.tab.auth': 'Autenticação',
  'requests.tab.docs': 'Anotações',
  'requests.tabCount': '{label} ({count})',
  'requests.param': 'Parâmetro',
  'requests.header': 'Header',
  'requests.field': 'Campo',
  'requests.body.none': 'Sem corpo',
  'requests.body.text': 'Texto',
  'requests.body.jsonPlaceholder': '{\n  "chave": "valor"\n}',
  'requests.body.placeholder': 'Conteúdo do corpo',
  'requests.body.multipart': 'Corpo multipart é preservado no arquivo, mas ainda não é editado nem enviado aqui.',
  'requests.auth.none': 'Sem autenticação',
  'requests.auth.user': 'Usuário',
  'requests.auth.password': 'Senha',
  'requests.auth.keyName': 'Nome da chave (ex.: X-API-Key)',
  'requests.auth.inHeader': 'Enviar no header',
  'requests.auth.inQuery': 'Enviar na query',
  'requests.auth.inherit': 'No Bruno esta request herda a autenticação da coleção; aqui ela é enviada sem autenticação.',
  'requests.docsPlaceholder': 'Anotações sobre esta request (Markdown).',
  'requests.row.enable': 'Ativar',
  'requests.row.disable': 'Desativar',
  'requests.row.remove': 'Remover linha',
  'requests.row.add': 'Adicionar linha',
  'requests.env.title': 'Variáveis de ambiente',
  'requests.env.new': 'Novo ambiente',
  'requests.env.defaultName': 'Ambiente',
  'requests.env.help': 'Ambiente {name}. Use {variable} na URL, nos headers, no corpo e na autenticação.',
  'requests.env.example': '{{nome}}',
  'requests.env.variableName': 'Nome da variável',
  'requests.env.secret': 'Secreta: o valor fica só no Bruno',
  'requests.env.choose': 'Escolha um ambiente na lista ao lado ou crie um novo.',
  'requests.response.sending': 'Enviando…',
  'requests.response.idle': 'A resposta aparece aqui. Ctrl+Enter envia a request.',
  'requests.response.cancelled': 'Request cancelada.',
  'requests.response.failed': 'A request não foi concluída.',
  'requests.response.noBody': 'Resposta sem corpo.',
  'requests.response.truncated': 'Resposta grande: só o início é mostrado.',
  'requests.error.noUrl': 'Informe a URL.',
  'requests.error.invalidUrl': 'URL inválida: {url}',
  'requests.error.multipart': 'Corpo multipart ainda não é suportado no ObNotion.',

  'code.loading': 'Abrindo o editor…',
  'code.files': 'Arquivos · {count}',
  'code.newPlaceholder': 'pasta/arquivo.ts',
  'code.create': 'Criar',
  'code.filterPlaceholder': 'Filtrar arquivos…',
  'code.noMatch': 'Nenhum arquivo com esse filtro.',
  'code.noFiles': 'Vault sem arquivos. Crie o primeiro acima.',
  'code.noneOpen': 'Nenhum arquivo aberto',
  'code.noneOpenHint': 'Escolha um arquivo na lista ou crie um novo, com a extensão no nome (ex.: notas/script.py).',
  'code.saved': 'salvo',
  'code.saving': 'salvando…',
  'code.saveError': 'erro ao salvar',
  'code.theme': 'Tema do editor',
  'code.defaultTheme': 'Tema ObNotion',
  'code.readError': 'Não foi possível ler {path}.',
  'code.createError': 'Não foi possível criar {name}.',
  'code.extensions': 'Extensões',
  'code.extensionsCount': 'Extensões · {count}',
  'code.ext.title': 'Extensões do VS Code',
  'code.ext.body':
    'O ObNotion lê as extensões já instaladas no seu VS Code. Temas de cor e snippets funcionam aqui. Extensões que dependem de código próprio (ESLint, Prettier, depuradores, assistentes) continuam funcionando só no VS Code.',
  'code.ext.none': 'Nenhuma extensão encontrada. Instale o VS Code ou alguma extensão nele.',
  'code.ext.user': 'Instaladas por você',
  'code.ext.builtin': 'Do VS Code',
  'code.ext.themes': { one: '{count} tema', other: '{count} temas' },
  'code.ext.snippets': 'snippets',
  'code.ext.grammar': 'gramática não aplicada',
  'code.ext.codeOnly': 'código só no VS Code',
} satisfies Record<string, Entry>;

export type Key = keyof typeof ptBR;

const en: Record<Key, Entry> = {
  'common.moveToTrash': 'Move to trash',
  'common.value': 'Value',

  'nav.graph': 'Graph',
  'nav.requests': 'Requests',
  'nav.code': 'Code',

  'note.untitled': 'Untitled',
  'editor.titleLabel': 'Page title',

  'welcome.title': 'Your notes, in your folder, in blocks.',
  'welcome.body':
    'Your notes live as Markdown files in a folder on your computer. Choose a folder to get started; it can be an Obsidian vault you already use.',
  'welcome.choose': 'Choose vault folder',
  'welcome.feature.files': 'Plain .md files, no account, no cloud',
  'welcome.feature.links': 'Links between pages, backlinks, and a graph',
  'welcome.feature.blocks': 'Block editor with a {key} menu',
  'welcome.sample.path': 'Projects/New home.md',
  'welcome.sample.title': 'New home',
  'welcome.sample.body': 'Moving day is set for March. The budget is in {budget} and the room measurements are in {plan}.',
  'welcome.sample.budget': 'Finances',
  'welcome.sample.plan': 'Floor plan',
  'welcome.sample.done': 'Sign the contract',
  'welcome.sample.todo': 'Get three moving quotes',

  'empty.title': 'No page open',
  'empty.hint': 'Pick a page in the sidebar or use a shortcut.',
  'empty.search': 'Find a page',
  'empty.create': 'Create a page',
  'empty.graph': 'Open the graph',

  'sidebar.search': 'Search',
  'sidebar.newPage': 'New page',
  'sidebar.pages': 'Pages',
  'sidebar.newPageHere': 'New page in this folder',
  'sidebar.newPageIn': 'New page in {folder}',
  'sidebar.trashNote': 'Move {name} to trash',
  'sidebar.emptyTitle': 'Empty vault',
  'sidebar.emptyHint': '{key} creates your first page.',
  'sidebar.settings': 'Settings',

  'tabs.new': 'New tab',
  'tabs.close': 'Close tab',
  'tabs.closeNamed': 'Close tab {name}',

  'links.backlinks': 'Backlinks',
  'links.noBacklinks': 'No pages link here.',
  'links.outgoing': 'Links on this page',
  'links.missing': 'This page doesn’t exist yet: click to create it',
  'links.hint': 'Type {key} to link to another page.',

  'switcher.placeholder': 'Search or create a page…',
  'switcher.label': 'Search or create a page',
  'switcher.create': '{key} creates the page “{name}”',
  'switcher.empty': 'No pages.',
  'switcher.navigate': 'navigate',
  'switcher.open': 'open',
  'switcher.close': 'close',

  'settings.title': 'Settings',
  'settings.language': 'Language',
  'settings.vault': 'Vault',
  'settings.noVault': 'No vault selected',
  'settings.changeVault': 'Switch vault',

  'graph.pages': { one: '{count} page', other: '{count} pages' },
  'graph.links': { one: '{count} link', other: '{count} links' },
  'graph.openSettings': 'Graph settings',
  'graph.closeSettings': 'Close settings',
  'graph.filters': 'Filters',
  'graph.filterPlaceholder': 'Filter pages…',
  'graph.orphans': 'Unlinked pages',
  'graph.display': 'Display',
  'graph.arrows': 'Arrows',
  'graph.textFade': 'Hide labels when zoomed out',
  'graph.nodeSize': 'Node size',
  'graph.lineSize': 'Link thickness',
  'graph.forces': 'Forces',
  'graph.center': 'Center force',
  'graph.repel': 'Repel force',
  'graph.link': 'Link force',
  'graph.linkDistance': 'Link distance',
  'graph.reset': 'Restore defaults',

  'requests.new': 'New request',
  'requests.activeEnvironment': 'Active environment',
  'requests.noEnvironment': 'No environment',
  'requests.variables': 'Variables',
  'requests.empty': 'No requests yet. Create your first one or copy a Bruno collection into the vault.',
  'requests.noneSelected': 'No request selected',
  'requests.namePlaceholder': 'Request name',
  'requests.urlPlaceholder': 'https://api.example.com/resource or {{baseUrl}}/resource',
  'requests.send': 'Send',
  'requests.cancel': 'Cancel',
  'requests.missingVariables': 'Variables with no value in the active environment: {names}',
  'requests.tab.params': 'Params',
  'requests.tab.headers': 'Headers',
  'requests.tab.body': 'Body',
  'requests.tab.auth': 'Auth',
  'requests.tab.docs': 'Notes',
  'requests.tabCount': '{label} ({count})',
  'requests.param': 'Parameter',
  'requests.header': 'Header',
  'requests.field': 'Field',
  'requests.body.none': 'No body',
  'requests.body.text': 'Text',
  'requests.body.jsonPlaceholder': '{\n  "key": "value"\n}',
  'requests.body.placeholder': 'Body content',
  'requests.body.multipart': 'Multipart bodies are kept in the file, but can’t be edited or sent here yet.',
  'requests.auth.none': 'No auth',
  'requests.auth.user': 'Username',
  'requests.auth.password': 'Password',
  'requests.auth.keyName': 'Key name (e.g. X-API-Key)',
  'requests.auth.inHeader': 'Send in header',
  'requests.auth.inQuery': 'Send in query',
  'requests.auth.inherit': 'In Bruno this request inherits auth from its collection; here it’s sent without auth.',
  'requests.docsPlaceholder': 'Notes about this request (Markdown).',
  'requests.row.enable': 'Enable',
  'requests.row.disable': 'Disable',
  'requests.row.remove': 'Remove row',
  'requests.row.add': 'Add row',
  'requests.env.title': 'Environment variables',
  'requests.env.new': 'New environment',
  'requests.env.defaultName': 'Environment',
  'requests.env.help': 'Environment {name}. Use {variable} in the URL, headers, body, and auth.',
  'requests.env.example': '{{name}}',
  'requests.env.variableName': 'Variable name',
  'requests.env.secret': 'Secret: the value stays in Bruno only',
  'requests.env.choose': 'Pick an environment from the list or create a new one.',
  'requests.response.sending': 'Sending…',
  'requests.response.idle': 'The response shows up here. Ctrl+Enter sends the request.',
  'requests.response.cancelled': 'Request cancelled.',
  'requests.response.failed': 'The request didn’t complete.',
  'requests.response.noBody': 'Empty response body.',
  'requests.response.truncated': 'Large response: only the beginning is shown.',
  'requests.error.noUrl': 'Enter a URL.',
  'requests.error.invalidUrl': 'Invalid URL: {url}',
  'requests.error.multipart': 'Multipart bodies aren’t supported in ObNotion yet.',

  'code.loading': 'Opening the editor…',
  'code.files': 'Files · {count}',
  'code.newPlaceholder': 'folder/file.ts',
  'code.create': 'Create',
  'code.filterPlaceholder': 'Filter files…',
  'code.noMatch': 'No files match this filter.',
  'code.noFiles': 'No files in this vault. Create the first one above.',
  'code.noneOpen': 'No file open',
  'code.noneOpenHint': 'Pick a file from the list or create a new one, with the extension in its name (e.g. notes/script.py).',
  'code.saved': 'saved',
  'code.saving': 'saving…',
  'code.saveError': 'couldn’t save',
  'code.theme': 'Editor theme',
  'code.defaultTheme': 'ObNotion theme',
  'code.readError': 'Couldn’t read {path}.',
  'code.createError': 'Couldn’t create {name}.',
  'code.extensions': 'Extensions',
  'code.extensionsCount': 'Extensions · {count}',
  'code.ext.title': 'VS Code extensions',
  'code.ext.body':
    'ObNotion reads the extensions already installed in your VS Code. Color themes and snippets work here. Extensions that run their own code (ESLint, Prettier, debuggers, assistants) still only work in VS Code.',
  'code.ext.none': 'No extensions found. Install VS Code or add an extension to it.',
  'code.ext.user': 'Installed by you',
  'code.ext.builtin': 'Built into VS Code',
  'code.ext.themes': { one: '{count} theme', other: '{count} themes' },
  'code.ext.snippets': 'snippets',
  'code.ext.grammar': 'grammar not applied',
  'code.ext.codeOnly': 'code runs in VS Code only',
};

const dictionaries: Record<Language, Record<Key, Entry>> = { 'pt-BR': ptBR, en };

export type Vars = Record<string, string | number>;
export type Translate = (key: Key, vars?: Vars) => string;

// `{nome}` é variável; `{{nome}}` é texto literal (sintaxe de variável do Bruno).
const placeholder = () => /(?<!\{)\{(\w+)\}(?!\})/g;

function format(language: Language, key: Key, vars?: Vars): string {
  const entry = dictionaries[language][key];
  // Só 1 é singular nas duas línguas: a regra do Intl para português trataria 0 como "0 página".
  const text = typeof entry === 'string' ? entry : Number(vars?.count) === 1 ? entry.one : entry.other;
  return vars ? text.replace(placeholder(), (all, name: string) => (name in vars ? String(vars[name]) : all)) : text;
}

let current: Language = 'pt-BR';

// Para código fora de componentes React: usa a língua em vigor no momento da chamada.
export const translate: Translate = (key, vars) => format(current, key, vars);

const I18nContext = createContext<{ language: Language; setLanguage: (language: Language) => void }>({
  language: current,
  setLanguage: () => {},
});

export function I18nProvider({ initial, children }: { initial: Language; children: ReactNode }) {
  const [language, setState] = useState(initial);
  current = language;
  document.documentElement.lang = language;

  const value = useMemo(
    () => ({
      language,
      setLanguage: (next: Language) => {
        setState(next);
        // O processo principal grava a escolha e refaz o menu nativo.
        // Se a gravação falhar a língua ainda vale nesta sessão; o erro fica no console.
        window.api.setSettings({ language: next }).catch((error) => console.error('settings:set', error));
      },
    }),
    [language],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useLanguage = () => useContext(I18nContext);

export function useT(): Translate {
  const { language } = useLanguage();
  return useMemo<Translate>(() => (key, vars) => format(language, key, vars), [language]);
}

// Texto com trechos que são elementos: <Trans k="links.hint" values={{ key: <Kbd>[</Kbd> }} />.
export function Trans({ k, values }: { k: Key; values: Record<string, ReactNode> }) {
  const t = useT();
  return (
    <>
      {t(k)
        .split(placeholder())
        .map((part, index) => (index % 2 ? <Fragment key={index}>{values[part]}</Fragment> : part))}
    </>
  );
}
