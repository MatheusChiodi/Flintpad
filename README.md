# ObNotion

A desktop app that merges the Obsidian model (notes as local Markdown files, `[[wikilinks]]`, backlinks, graph) with the Notion experience (block editor, `/` menu, tabs and shortcuts). It also ships an API client and a code editor, so notes, requests and code live in the same folder.

Everything is original code. Nothing was copied from Obsidian, Notion, Bruno or VS Code; their behavior was studied and reimplemented with open-source libraries.

## Getting started

```bash
npm install
npm run dev     # app with hot reload
npm start       # production build + app
npm run dist    # portable Windows executable in release/
```

On Windows you can also double-click `gerar-exe.bat` to build the executable.

On first launch, pick the vault folder. It can be an existing Obsidian vault: files stay plain `.md` and YAML frontmatter is preserved.

## Features

### Block editor

<img src="docs/editor.svg" alt="Block editor with the slash menu open" width="640">

Each note is a light page set into the dark frame. Type `/` to insert headings, lists, to-dos, tables, quotes and code blocks, and drag blocks to reorder them. The big title renames the file.

### Wikilinks and backlinks

<img src="docs/links.svg" alt="Links inside a page and the backlinks panel" width="640">

Link pages with `[[Page]]`, `[[Page|alias]]` or `[[Page#section]]`; type `[` to get page suggestions. The side panel lists the pages that point to the current one and the links it contains. Clicking a link to a page that does not exist creates it, and renaming a page updates every link that points to it.

### Graph

<img src="docs/graph.svg" alt="Graph view with a highlighted node and its neighbours" width="640">

`Ctrl+G` opens the graph. It follows the same rules as the Obsidian graph: d3-force physics, node size by number of links, wheel zoom towards the cursor, draggable nodes, neighbours highlighted on hover, and labels that fade as you zoom out. The settings panel has filters, display options and the four force sliders.

### Tabs and shortcuts

<img src="docs/tabs.svg" alt="Tab bar, page tree and keyboard shortcuts" width="640">

Pages open in tabs with their own back/forward history, next to a collapsible page tree. Shortcuts match the Notion desktop app.

| Action | Shortcut |
|---|---|
| New page / New tab | `Ctrl+N` / `Ctrl+T` |
| Close tab / Reopen last closed | `Ctrl+W` / `Ctrl+Shift+T` |
| Next / previous tab | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| Back / Forward | `Ctrl+[` / `Ctrl+]` |
| Toggle sidebar | `Ctrl+\` |
| Copy page link / page name | `Ctrl+L` / `Ctrl+Alt+L` |
| Paste without formatting | `Ctrl+Shift+V` |
| Quick search (creates the page if missing) | `Ctrl+P` |
| Graph / Requests / Code | `Ctrl+G` / `Ctrl+Shift+E` / `Ctrl+Shift+K` |
| Open another vault | `Ctrl+O` |
| Quit | `Ctrl+Shift+Q` |

The menu bar is hidden; press `Alt` to show it.

### Requests

<img src="docs/requests.svg" alt="API client with a request list, URL bar and JSON response" width="640">

`Ctrl+Shift+E` opens an API client. Each request is a `.bru` file inside the vault, in the same format Bruno uses, so the `Requests` folder opens as a collection in Bruno and a Bruno collection copied into the vault shows up here.

- Method, URL, query parameters (kept in sync with the URL) and headers.
- Body as JSON, text, XML or URL-encoded form.
- Bearer, Basic and API key authentication.
- Environments with `{{variables}}`, and a warning when one has no value.
- Response status, time, size, formatted body and headers. `Ctrl+Enter` sends; a running request can be cancelled.
- Notes per request. Blocks the screen does not edit (scripts, tests, vars) are kept in the file.

Not there yet, compared to Bruno: scripts and tests, collection runner, GraphQL, gRPC, WebSocket, OAuth2/AWS/NTLM, multipart and file upload, cookies, proxy and certificates, Postman/OpenAPI import, auth inherited from the collection, Git integration, secret variables.

### Code

<img src="docs/code.svg" alt="Code editor with syntax highlighting, themes and snippets" width="640">

`Ctrl+Shift+K` opens a code editor built on Monaco, the editor inside VS Code. Create, read and edit any text file in the vault, with syntax highlighting for dozens of languages and IntelliSense for TypeScript, JavaScript, JSON, CSS and HTML. Changes save automatically; `Ctrl+S` saves right away.

ObNotion reads the extensions already installed in your VS Code:

- **Color themes** are applied to the editor (colors are mapped from TextMate scopes to Monaco tokens, so some details differ from VS Code).
- **Snippets** show up in the suggestions for their language.
- Extensions that run their own code (ESLint, Prettier, debuggers, assistants) and TextMate grammars are listed but do not run here.

### Languages

<img src="docs/languages.svg" alt="Settings with the language choice" width="640">

The interface is available in English and Brazilian Portuguese. Change it in Settings (`Ctrl+,`); it applies right away, including the menu.

## Known limits

- Converting between blocks and Markdown is lossy: when you edit a note its formatting is normalized (for example `-` lists become `*` and tables are realigned). Opening a note without editing does not touch the file.
- Obsidian-only syntax (callouts `> [!note]`, embeds `![[...]]`, Dataview, canvas) shows as plain text.
- No Notion databases, no sync, no plugins.
- Files and folders starting with `.` are ignored.

## Project layout

- `electron/main.cjs`: window, menu, disk access restricted to the vault, HTTP requests, VS Code extension reader.
- `electron/preload.cjs`: the `window.api` bridge.
- `src/App.tsx`: state (tabs, link index).
- `src/components/`: `Editor` (BlockNote + wikilinks), `Sidebar`, `Panels` (tabs, links, search), `Graph`, `Requests`, `Code`.
- `src/lib/`: link parsing, `.bru` request model, VS Code theme and snippet conversion.
- `docs/`: illustrations used in this file.

## Credits

Built on [Electron](https://www.electronjs.org/), [React](https://react.dev/), [BlockNote](https://www.blocknotejs.org/), [d3-force](https://d3js.org/d3-force), [Monaco Editor](https://microsoft.github.io/monaco-editor/) and [`@usebruno/lang`](https://www.npmjs.com/package/@usebruno/lang).
