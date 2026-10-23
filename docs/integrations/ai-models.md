---
title: AI Integrations
description: Leverage the power of Large Language Models (LLMs).
---

# AI Integrations

Fluxify connects to leading AI providers to power its AI assistant, which builds routes on the canvas from a plain-English description.

## Supported Providers

### OpenAI
Connect to OpenAI's GPT models (e.g., GPT-4o, GPT-3.5-turbo).
- **Required**: API Key.

### Anthropic
Use Claude models for reasoning and text generation.
- **Required**: API Key.

### Google Gemini
Integrate with Google's Gemini models.
- **Required**: API Key.

### Mistral AI
Use Mistral's open-weights models.
- **Required**: API Key.

### OpenAI Compatible
Connect to any service that follows the OpenAI API format (e.g., local LLMs via Ollama, or other providers like Groq).
- **Required**: Base URL and API Key.

## Usage

These integrations power the AI assistant. There are no built-in AI blocks yet, but a [plugin block](/plugins/authoring/integrations#ai-variants) can call a model through any of them.

::: info Test connection
**Test connection** asks the provider for its list of models. It checks the key and the address without running the model, so it uses no tokens.
:::

## AI configuration

Project settings → **AI configuration** holds the AI connection the agent uses and the limits for one agent run. Only a project admin can change the limits; everyone else sees them read-only.

| Setting | Default | Allowed | What it does |
| :--- | :--- | :--- | :--- |
| Max steps per run | 40 | 1 to 200 | The agent stops and asks to continue after this many steps. |
| Max context length (tokens) | 128000 | 8000 to 2000000 | The model's context window. Set it to match your model. |
| Token budget per run | 1000000 | 10000 and up | The agent stops and asks to continue after this many input plus output tokens. |

### Ephemeral runs

The same page has an **Ephemeral runs** section for the agent's `run_blocks` tool, which tries a few blocks in one call and keeps nothing. A creator can change both settings.

| Setting | Default | Allowed | What it does |
| :--- | :--- | :--- | :--- |
| Run timeout (seconds) | 10 | 1 to 30 | How long one run may take. A call can ask for a different time inside the same range. |
| Ask before ephemeral runs | Off | On or off | The agent waits for your approval before every run, in auto mode too. |

See [Try blocks with an ephemeral run](/agents/recipes/ephemeral-run).

### Environments and approvals

The agent works in **development** by default. It reads development logs, development recordings, development values and development integration settings, and it reads KV keys with the development connection. It only goes to production when you explicitly ask it to.

When it does, it waits for your approval first, in auto mode too. The approval shows a red **Production** badge.

| What the agent does | Asks? |
| :--- | :--- |
| Reads production logs, recordings, KV keys, app config values or integration configs | Yes, unless you turn off **Ask before production reads** |
| Sets an app config **production value**, or an integration's production **config** | Yes, unless you turn off **Ask before production writes** |
| Saves a trigger (triggers are shared by development and production) | Yes, unless you turn off **Ask before production writes** |
| Sets only a development value or config, or turns "Same as production" on or off | No |
| Saves a route, workflow, custom block or middleware | No. Saves change development only. |

| Setting | Default | What it does |
| :--- | :--- | :--- |
| Ask before production reads | On | The agent waits for your approval before it reads anything from production. |
| Ask before production writes | On | The agent waits for your approval before it changes a production value, a production config or a trigger. |

::: warning
Turning **Ask before production writes** off lets the agent change production values and triggers without asking. Production logs and values can also hold secrets and customer data, so think before turning off the reads one.
:::

::: info
Until promoting a version is available, saving a route or workflow still goes live in production too.
:::

A setting you have not changed uses its default. The offline agent CLI reads `AGENT_MAX_STEPS`, `AGENT_MAX_CONTEXT_TOKENS` and `AGENT_TOKEN_BUDGET` from the environment, and those win over the project values.

## Plans and the todo list

For a big request the agent can suggest plan mode, and once you approve a plan it works through it with a todo list. See [Plans and the todo list](/getting-started/ai-agents#plans-and-the-todo-list).

## Long conversations

A long chat can outgrow the model's context window, so the agent shrinks it for you:

- Past 60% of the window, old tool results are shortened. The chat shows a quiet line such as "Trimmed 12 old tool results" while it happens.
- Past 80%, the earlier part of the chat is replaced by a short summary. The chat shows "Context compacted: 102k → 9k tokens" where it happened, and the line stays after a refresh. Click it to read the summary.

You can also compact on demand. Type `/` in the message box and pick **/compact**, or type it yourself:

| You type | What happens |
| :--- | :--- |
| `/compact` | The chat so far is summarized now. |
| `/compact keep the users table schema and the route ids` | Same, and the text tells the summary what it must keep. |

Compacting is its own step: the agent does not answer after it. You can only compact when no run is active and nothing waits for your approval; otherwise you get a message to wait. A chat that is still short says "Nothing to compact yet". The agent's terminal CLI takes the same `/compact [what to keep]`.

## Waiting and thinking time

A run that has nothing on screen yet says what it is actually doing, and for how long:

| What is happening | What the chat says |
| :--- | :--- |
| The run is in the queue; no worker has picked it up | `Queued…` |
| A worker has the run, the model call is out, nothing has come back | `Waiting for model…` |
| The model is reasoning | `Thinking…` |

While the model thinks, the chat shows how long the current model call has been going. Each call has its own timer, so a second think after a tool call starts again from 0. `Thinking…` appears only once the model actually starts reasoning: a model that answers without thinking of its own never shows it. A finished thought shows "Thought for 42s". After a refresh, thoughts that came before tool calls keep their time; a thought that was followed by a text answer shows no time.
