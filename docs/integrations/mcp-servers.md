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
| **Authentication** | **Headers** if the server takes an API key. **OAuth** if it asks you to sign in. See [Sign in with OAuth](#sign-in-with-oauth). |
| **Headers** | Optional. Usually an API key, like `Authorization` or `x-api-key`. Only with **Headers** authentication. |

3. Select **Test connection**. It connects to the server and lists the tools it offers. If the key is wrong or the server is down, the test tells you why.
4. In the project's **AI configuration**, add the server under **Allowed MCP Servers**. The agent only sees servers listed there.

## Keep secrets in App Config

Don't type an API key into a header. Save it in [App Config](/concepts/app-config) and refer to it as `cfg:` followed by the key name:

| Header | Value |
| --- | --- |
| `x-api-key` | `cfg:GITHUB_MCP_KEY` |

The key stays in App Config, and each environment reads its own value.

## Sign in with OAuth

Many hosted servers (GitHub, Linear and others) don't use an API key. They ask you to sign in on their own page. For those, choose **OAuth** as the authentication.

1. Save the integration with **OAuth** selected. The **Connect** button appears once it is saved.
2. Select **Connect**. You go to the server's sign-in page. Sign in and allow access.
3. You come back to the integration, and it shows **Connected**.

That's it. The agent can now use the server's tools. The sign-in stays valid on its own: Fluxify renews it when it runs out, so you don't need to sign in again.

::: warning One shared account
The integration signs in as **one account for everyone**, not as each person who uses the agent. Connect a company or service account that has only the access the agent needs. Don't connect your personal account.
:::

| To do this | Do this |
| --- | --- |
| Check it works | Select **Test connection**. It uses the saved sign-in. |
| Stop the agent using the server | Select **Disconnect**. The agent gets a "Not connected" message until someone connects it again. |
| Switch accounts | Select **Reconnect** and sign in with the other account. |

Things to know:

- **Production and development connect separately.** Each has its own **Connect** and **Disconnect**. With **Same as production** on, development uses production's sign-in.
- **Editing the integration keeps the sign-in.** Renaming it or changing headers doesn't sign you out. Changing the server URL, or switching back to **Headers**, does.
- **Nobody can read the sign-in.** It is stored encrypted and never shown, not even to admins. The integration only shows whether it is **Connected**.
- **Only project admins can connect or disconnect.** Creators can see the status.
- The server must support signing in this way and registering Fluxify automatically. If **Connect** says "Failed to connect", the server may not support OAuth, or it could not be reached. Check the URL, or use **Headers** instead.

## Production and development values

Like other integrations, an MCP server has a production config and a development config. See [production and development values](/integrations/#production-and-development-values). **Test connection** uses the development config, so point it at a test server when you can.

## Who can add one

| Role | Can do |
| --- | --- |
| **Project Admin** | Add, change and delete MCP servers. |
| **Creator** | See them and test the connection. They can see whether an OAuth server is connected, but not connect or disconnect it. |

Only admins can add one because a server's tools run with whatever access its key or sign-in gives.

## Good to know

- Only servers reached over HTTP (Streamable HTTP) work. Servers that run as a local program are not supported.
- The agent asks you before every call to an MCP server. See [Safety](/getting-started/ai-agents#safety).

Next: [use the server from the AI agent](/getting-started/ai-agents#use-other-mcp-servers).
