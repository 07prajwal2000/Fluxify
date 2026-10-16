---
title: Custom Knowledge Base
description: Give the AI agent your own docs - Markdown, web pages and llms.txt files - searched next to the Fluxify docs, with request headers filled in from app config so tokens stay secret.
---

# Custom Knowledge Base

Each project can have its own **knowledge base**: documentation the AI agent
searches alongside the Fluxify docs. Add your API reference, your team's
conventions or a vendor's docs, and the agent can look them up while it works.

## Sources

A knowledge base is a list of sources. Each source has a name (letters,
numbers, `-` and `_`) and one of these types:

| Type | What you give | What gets indexed |
| :--- | :--- | :--- |
| Markdown | The Markdown text (or an uploaded `.md` file) | That document |
| URL | One web address | That one page. HTML is converted to Markdown; Markdown is kept as is |
| llms.txt | The address of an `llms.txt` file | The linked pages you pick |
| llms-full.txt | The address of an `llms-full.txt` file | Every page in it, split at each top-level `#` heading |

::: info One page only
A URL source reads exactly the page you give it. Links on that page are not
followed, and sitemaps are not read. Add one source per page, or use an
`llms.txt` source to pick several pages at once.
:::

## When pages are fetched

Web sources are fetched with a plain `GET` request:

- when you save a source, and
- when you press **Refetch**.

The fetched text is stored, so the agent keeps working even if the site is down
later. Refetching replaces the source's pages; nothing is duplicated.

Each source shows when it was last fetched and whether that worked. If a fetch
fails, the source is still saved, the error is shown, and the pages from the
last good fetch stay in the knowledge base.

## Private docs: headers from app config

Docs behind a login usually need a token in a request header. You never type
the token into the source. Instead:

1. Store the token as an [app config](/concepts/app-config) key, for example
   `DOCS_TOKEN` (turn on encryption).
2. In the source, add a header and pick the key: `Authorization` → `DOCS_TOKEN`.

At fetch time the header is sent with the key's current value. The source only
remembers the key name, and the value is never shown back to anyone.

::: warning llms.txt and other sites
For an `llms.txt` source, headers are only sent to pages on the same site as the
`llms.txt` file. Linked pages on other sites are fetched without them.
:::

## How the agent sees it

The Fluxify agent searches your knowledge base automatically when it runs in
your project. Results look like any other docs page, with paths that start with
`kb/<source name>/`, for example `kb/handbook/guide/billing`.

Disable a source to hide it from the agent without deleting it.

A page without a title gets one from its first `#` heading, or from its address
or source name.

### Other MCP clients

An AI agent connected through the [MCP server](/getting-started/ai-agents) uses
the same `search_docs` and `read_doc` tools. Pass the project's id as
`projectId` to include that project's knowledge base. Without it, only the
Fluxify docs are searched. The caller needs at least the Viewer role in the
project.
