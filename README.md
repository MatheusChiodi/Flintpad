# ObNotion

App desktop que junta o modelo do Obsidian (notas em arquivos Markdown locais, `[[wikilinks]]`, backlinks, grafo) com a experiência do Notion (editor de blocos, menu `/`, guias e atalhos).

Código próprio: nada foi copiado do Obsidian nem do Notion. Do Notion vieram só os nomes e atalhos dos comandos de menu, levantados com o REA.

## Usar

- Executável portátil: `release\ObNotion 0.1.0.exe`.
- Desenvolvimento: `npm run dev` (recarrega ao salvar) ou `npm start` (build + app).
- Gerar o executável de novo: `npm run dist`.

Na primeira abertura, escolha a pasta do vault. Pode ser um vault do Obsidian existente: os arquivos continuam `.md` e o frontmatter YAML é preservado.

## O que tem

| Do Obsidian | Do Notion |
|---|---|
| Vault = pasta de arquivos `.md` | Editor de blocos com arrastar e menu `/` |
| `[[Link]]`, `[[Link\|apelido]]`, digite `[` para sugerir páginas | Título grande editável (renomeia o arquivo) |
| Painel de backlinks e links da página | Guias, com reabrir guia fechada |
| Grafo (Ctrl+G) | Barra lateral com árvore de páginas |
| Busca rápida (Ctrl+P), cria a página se não existir | Histórico voltar/avançar por guia |

## Atalhos (os do Notion Desktop)

| Ação | Atalho |
|---|---|
| Nova página / Nova guia | Ctrl+N / Ctrl+T |
| Fechar guia / Reabrir a última | Ctrl+W / Ctrl+Shift+T |
| Próxima guia / anterior | Ctrl+Tab / Ctrl+Shift+Tab |
| Voltar / Avançar | Ctrl+[ / Ctrl+] |
| Mostrar/ocultar barra lateral | Ctrl+\ |
| Copiar link / nome da página | Ctrl+L / Ctrl+Alt+L |
| Colar sem formatação | Ctrl+Shift+V |
| Busca rápida / Grafo | Ctrl+P / Ctrl+G |
| Abrir outro vault | Ctrl+O |
| Sair | Ctrl+Shift+Q |

O menu fica oculto; `Alt` mostra.

## Requests (cliente de API)

Abra pela barra lateral ou com Ctrl+Shift+E. Cada request é um arquivo `.bru` dentro do vault, no mesmo formato do Bruno: a pasta `Requests` pode ser aberta como coleção no Bruno, e uma coleção do Bruno copiada para o vault aparece aqui.

- Método, URL, parâmetros de query (sincronizados com a URL), headers.
- Corpo: JSON, texto, XML e form URL-encoded.
- Autenticação: Bearer, Basic e API key (header ou query).
- Ambientes com variáveis `{{nome}}` (arquivos em `environments/`), com aviso de variável sem valor.
- Resposta: status, tempo, tamanho, corpo (JSON formatado) e headers. Ctrl+Enter envia; dá para cancelar.
- Anotações por request (bloco `docs` do Bruno).
- Blocos que a tela não edita (scripts, testes, vars) são preservados no arquivo.

Ainda não tem, em relação ao Bruno: scripts e testes, runner de coleção, GraphQL, gRPC, WebSocket, OAuth2/AWS/NTLM, multipart e upload de arquivo, cookies, proxy e certificados, importar/exportar Postman e OpenAPI, autenticação herdada da coleção, integração com Git, variáveis secretas.

## Limites conhecidos

- A conversão bloco ↔ Markdown tem perdas: ao editar uma nota, a formatação é normalizada (ex.: `-` vira `*` em listas, tabelas são realinhadas). Abrir sem editar não altera o arquivo.
- Sintaxe só do Obsidian (callouts `> [!note]`, embeds `![[...]]`, Dataview, canvas) aparece como texto comum.
- Renomear uma página não atualiza os `[[links]]` que apontam para ela.
- Sem bancos de dados do Notion, sem sincronização, sem plugins.
- Pastas e arquivos que começam com `.` são ignorados.

## Estrutura

- `electron/main.cjs`: janela, menu, acesso a disco restrito ao vault.
- `electron/preload.cjs`: ponte `window.api`.
- `src/App.tsx`: estado (guias, índice de links).
- `src/components/`: `Editor` (BlockNote + wikilinks), `Sidebar`, `Panels` (guias, links, busca), `Graph`.
