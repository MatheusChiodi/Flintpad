# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-10-17

### Added

- **Notes**: download button on every page, with PDF and plain text (`.txt`) export; also in the File menu and the command palette.
- **Code**: the Search view also finds files by name (accent and case insensitive).
- **Code**: SQL syntax validation for `.sql` files, live and on demand (`SQL: Validate script`, Ctrl+Shift+V), with a dialect picker in the status bar (MySQL, MariaDB, PostgreSQL, SQL Server, SQLite, BigQuery, Snowflake and more).
- **Code**: Claude Code integration: open it in its own terminal tab (status bar, terminal panel or palette) and mention the current file or selection as `@path#L10-20` (Ctrl+Alt+K).
- **Browser**: a built-in web browser tab (Ctrl+Shift+Y) on the same Chromium engine as Google Chrome: tabs (drag to reorder, mute, duplicate, reopen closed), address bar with search and suggestions from history and bookmarks, back/forward/reload/home, bookmarks bar and manager, history, downloads (pause, resume, cancel, show in folder), find in page, per-site zoom, print, save as PDF or HTML, view source, developer tools, incognito tabs, site permission prompts (camera, microphone, location, notifications, screen sharing…), right-click menu with spell check, and Chrome keyboard shortcuts. Not included: Google account sync, the Chrome Web Store/extensions, password manager, autofill and translation.

### Documentation

- README covers the Browser tab, SQL validation, Claude Code, file-name search and text export; new [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) with the licenses of every bundled component, shipped next to the executable with the MIT `LICENSE`; the usage policy explains what the Browser tab and Claude Code send over the network.

### Fixed

- **Browser**: switching to another app tab no longer leaves the open site drawn over it.
- **Code**: the terminal no longer fails silently. It skips the Microsoft Store `pwsh` alias, falls back to Windows PowerShell and then `cmd`, shows the reason with a retry button when a shell cannot start or exits right away, and no longer replays an old command when the panel reopens.

## [0.1.0] - 2026-10-15

First public release.

### Added

- **Notes**: block editor over plain Markdown files, `[[wikilinks]]` with sections, backlinks with context, unlinked mentions, tags, outline, find in page, templates, daily notes, favorites, recent pages and PDF export.
- **Tabs and search**: tabs with history, pinning and session restore; fuzzy quick search with filters and a command palette.
- **Graph**: force-directed graph with filter queries, color groups, local graph, saved views and PNG export.
- **Tasks**: every `- [ ]` in the vault, with due dates, priorities, recurrence, views, grouping, search and quick add.
- **Whiteboards**: shapes, connectors, pencil, images, styles, grouping, alignment, links to notes, autosave, and JSON/SVG/PNG import and export.
- **Requests**: API client on Bruno-compatible `.bru` files, with environments, assertions, cURL import, code generation, a collection runner and history.
- **Code**: VS Code-style workbench on Monaco with explorer, search and replace, terminal, language servers, Markdown preview, and your installed VS Code themes, grammars and icons.
- **Welcome, home and settings**: recent vaults, example pages, English and Brazilian Portuguese, accent colors, reduced motion.

[Unreleased]: https://github.com/MatheusChiodi/Flintpad/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/MatheusChiodi/Flintpad/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/MatheusChiodi/Flintpad/releases/tag/v0.1.0
