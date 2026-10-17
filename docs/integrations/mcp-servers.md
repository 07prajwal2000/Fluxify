---
title: MCP Servers
description: Connect an external MCP server so the in-app AI agent can use its tools.
---

# MCP Servers

An MCP server is a service that offers tools (like "search issues" or "add two numbers") that an AI agent can call. Add one as an integration and the in-app AI agent can use its tools in your project.

## Add a server

1. Open **Integrations** and add a new integration in the **MCP** group.
2. Fill in:

| Field | What to enter |
| --- | --- |
| **Name** | A short name. The agent and the `@` picker show it, so keep it simple, like `github`. |
| **URL** | The server's address, starting with `http://` or `https://`. |
| **Headers** | Optional. Usually an API key, like `Authorization` or `x-api-key`. |

3. Select **Test connection**. It connects to the server and lists the tools it offers. If the key is wrong or the server is down, the test tells you why.
4. In the project's **AI configuration**, add the server under **Allowed MCP Servers**. The agent only sees servers listed there.

## Keep secrets in App Config

Don't type an API key into a header. Save it in [App Config](/concepts/app-config) and refer to it as `cfg:` followed by the key name:

| Header | Value |
| --- | --- |
| `x-api-key` | `cfg:GITHUB_MCP_KEY` |

The key stays in App Config, and each environment reads its own value.

## Production and development values

Like other integrations, an MCP server has a production config and a development config. See [production and development values](/integrations/#production-and-development-values). **Test connection** uses the development config, so point it at a test server when you can.

## Who can add one

| Role | Can do |
| --- | --- |
| **Project Admin** | Add, change and delete MCP servers. |
| **Creator** | See them and test the connection. |

Only admins can add one because a server's tools run with whatever access its key gives.

## Good to know

- Only servers reached over HTTP (Streamable HTTP) work. Servers that run as a local program are not supported.
- Servers that need a sign-in page (OAuth) are not supported yet. OAuth is coming.
- The agent asks you before every call to an MCP server. See [Safety](/getting-started/ai-agents#safety).

Next: [use the server from the AI agent](/getting-started/ai-agents#use-other-mcp-servers).
