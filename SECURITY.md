# Security policy

## Supported versions

Only the latest release receives security fixes.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Use GitHub's private reporting instead: open the [Security tab](https://github.com/MatheusChiodi/Flintpad/security/advisories/new) and choose **Report a vulnerability**. Include the steps to reproduce, the affected version and, if possible, a minimal vault or file that triggers the problem.

You can expect an acknowledgement within 7 days. Once a fix is released, the advisory is published and you are credited, unless you prefer to stay anonymous.

## Scope

Flintpad is a desktop app that reads untrusted files (notes, whiteboards, `.bru` requests, VS Code extensions). Issues of particular interest:

- Escaping the vault or workspace folder through the `window.api` bridge.
- Script injection from file content (Markdown, whiteboard SVG export, Markdown preview, link previews).
- Remote content reaching the renderer with Node.js access.
- Command execution without an explicit user action.
