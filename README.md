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

`Ctrl+Shift+P` (File → Export as PDF…) saves the open page as an A4 PDF: title and content only, black on white, without the sidebar, tabs or links panel. The file is then shown in its folder.

### Wikilinks and backlinks

<img src="docs/links.svg" alt="Links inside a page and the backlinks panel" width="640">

Link pages with `[[Page]]`, `[[Page|alias]]` or `[[Page#section]]`; type `[` to get page suggestions. The side panel lists the pages that point to the current one and the links it contains. Clicking a link to a page that does not exist creates it, and renaming a page updates every link that points to it.

### Tasks

<img src="docs/tasks.svg" alt="Tasks tab listing to-do items grouped by page, with filters and search" width="640">

`Ctrl+Shift+J` opens the Tasks tab, which gathers the to-do items (`- [ ]` and `- [x]`) from every note in the vault, grouped by page. Filter by open, done or all, search by text, and click a page name to jump to it. Ticking a box rewrites only that line in the note's file.

### Graph

<img src="docs/graph.svg" alt="Graph view with a highlighted node and its neighbours" width="640">

`Ctrl+G` opens the graph. It follows the same rules as the Obsidian graph: d3-force physics, node size by number of links, wheel zoom towards the cursor, draggable nodes, neighbours highlighted on hover, and labels that fade as you zoom out. The settings panel has filters, display options and the four force sliders.

### Tabs and shortcuts

<img src="docs/tabs.svg" alt="Tab bar, page tree and keyboard shortcuts" width="640">

Pages open in tabs with their own back/forward history, next to a collapsible page tree. Quick search (`Ctrl+P`) matches page names first and then the text inside notes, showing the passage around each hit. Shortcuts match the Notion desktop app.

Star a page to pin it in a Favorites section above the page tree: from the links panel, the star beside the title in smaller windows, the page tree, or `Ctrl+Shift+F`. The last 20 pages you opened come first in quick search while the field is empty, and the five most recent are listed when no page is open. Both lists are kept per vault.

| Action | Shortcut |
|---|---|
| New page / New tab | `Ctrl+N` / `Ctrl+T` |
| Today's note (one page per day, in the `Daily` folder) | `Ctrl+D` |
| Close tab / Reopen last closed | `Ctrl+W` / `Ctrl+Shift+T` |
| Next / previous tab | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| Back / Forward | `Ctrl+[` / `Ctrl+]` |
| Toggle sidebar | `Ctrl+\` |
| Collapse sidebar into icons (focus mode) | `Ctrl+Shift+\` or the panel button next to the vault name |
| Copy page link / page name | `Ctrl+L` / `Ctrl+Alt+L` |
| Add / remove current page from favorites | `Ctrl+Shift+F` |
| Export page as PDF | `Ctrl+Shift+P` |
| Paste without formatting | `Ctrl+Shift+V` |
| Quick search (creates the page if missing) | `Ctrl+P` |
| Tasks | `Ctrl+Shift+J` |
| Graph / Requests / Code | `Ctrl+G` / `Ctrl+Shift+E` / `Ctrl+Shift+K` |
| Open another vault | `Ctrl+O` |
| Quit | `Ctrl+Shift+Q` |

The menu bar is hidden; press `Alt` to show it. In a narrow window (under 900 px) the sidebar collapses into an icon rail; use quick search to reach pages. With the sidebar hidden (`Ctrl+\`), a button at the left of the tabs brings it back.

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

`Ctrl+Shift+K` opens a workbench laid out like VS Code, built on Monaco (the editor inside VS Code):

- **Explorer** for any folder on disk (the vault by default; `Open folder…`, `Open file…` and recent folders from the buttons above it). `Add folder to workspace…` opens several projects side by side, as a VS Code multi-root workspace, with new file/folder, rename, delete to trash, reveal in File Explorer and live refresh when files change on disk.
- **Editor tabs** with preview tabs (single click, italic), dirty markers, breadcrumbs, auto save (toggle in the status bar) and `Ctrl+S`.
- **Quick Open** (`Ctrl+P`), **Command Palette** (`Ctrl+Shift+P` or `F1`, including every Monaco editor action), go to line (`Ctrl+G`) and go to symbol (`Ctrl+Shift+O`).
- **Integrated terminal** (`` Ctrl+` ``, new with `` Ctrl+Shift+` ``): real PowerShell sessions through a pseudo-terminal, several at once, kept alive when you switch tabs.
- **Language servers**: the native TypeScript 7 server (`tsc --lsp`) for TypeScript/JavaScript and the VS Code JSON, CSS/SCSS/Less and HTML servers. Project-aware completions, hover, diagnostics, go to definition/references across files (`F12`, `Shift+F12`), rename, formatting, and JSON validation with the schemas VS Code extensions declare (package.json, tsconfig.json…).
- **Status bar** with errors/warnings, cursor position, indentation, line endings and language mode, each clickable as in VS Code.

ObNotion reads the extensions already installed in your VS Code (the built-in ones and those in `~/.vscode/extensions`):

- **Color themes** recolor the whole workbench (side bar, tabs, status bar, terminal, pickers) and the code. `Preferences: Color theme` (`Ctrl+K Ctrl+T`) previews each theme as you move through the list.
- **TextMate grammars** do the syntax highlighting, through the same engine as VS Code (`vscode-textmate` + Oniguruma), so the colors match VS Code's.
- **File icon themes** (Seti by default, Minimal, Modern or any installed one) in the explorer, tabs and Quick Open.
- **Languages and language configuration** (file associations, comments, brackets, indentation rules) and **snippets**.
- There is no extensions view: what the installed extensions contribute just works. Extensions that run their own code in the VS Code extension host (ESLint, Prettier, debuggers, Git, assistants) do not run here.

### Languages

<img src="docs/languages.svg" alt="Settings with the language choice" width="640">

The interface is available in English and Brazilian Portuguese. Change it in Settings (`Ctrl+,`); it applies right away, including the menu.

## Known limits

- Converting between blocks and Markdown is lossy: when you edit a note its formatting is normalized (for example `-` lists become `*` and tables are realigned). Opening a note without editing does not touch the file.
- Obsidian-only syntax (callouts `> [!note]`, embeds `![[...]]`, Dataview, canvas) shows as plain text.
- No Notion databases, no sync, no plugins.
- Files and folders starting with `.` are ignored.
- Favorites and recent pages are stored in the app, keyed by the vault's folder path, not in the vault: moving or renaming the vault folder resets them.

## Project layout

- `electron/main.cjs`: window, menu, disk access restricted to the vault, HTTP requests, VS Code extension reader.
- `electron/workspace.cjs`: the Code tab's open folder (file access limited to it, the vault and files picked in a dialog) and its file watcher.
- `electron/terminal.cjs`, `electron/lsp.cjs`: terminal sessions and language server processes.
- `electron/preload.cjs`: the `window.api` bridge.
- `src/App.tsx`: state (tabs, link index).
- `src/components/`: `Editor` (BlockNote + wikilinks), `Sidebar`, `Panels` (tabs, links, search), `Graph`, `Tasks`, `Requests`, `Code` and its parts in `code/` (explorer, quick input, terminal, extensions).
- `src/lib/`: link parsing, task extraction, `.bru` request model, VS Code themes and snippets, TextMate grammars (`textmate.ts`), icon themes, workbench colors, the LSP bridge (`lsp.ts`).
- `tests/`: unit tests for `src/lib`, run with `npm test` (Node's built-in test runner).
- `docs/`: illustrations used in this file.

## Credits

Built on [Electron](https://www.electronjs.org/), [React](https://react.dev/), [BlockNote](https://www.blocknotejs.org/), [d3-force](https://d3js.org/d3-force), [Monaco Editor](https://microsoft.github.io/monaco-editor/), [vscode-textmate](https://github.com/microsoft/vscode-textmate), [xterm.js](https://xtermjs.org/), [node-pty](https://github.com/microsoft/node-pty), [vscode-langservers-extracted](https://github.com/hrsh7th/vscode-langservers-extracted) and [`@usebruno/lang`](https://www.npmjs.com/package/@usebruno/lang).
