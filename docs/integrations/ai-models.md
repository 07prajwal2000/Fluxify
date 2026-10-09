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

These integrations power the AI assistant. There are no AI blocks to call a model from inside a route yet.

## AI configuration

Project settings → **AI configuration** holds the AI connection the agent uses and the limits for one agent run. Only a project admin can change the limits; everyone else sees them read-only.

| Setting | Default | Allowed | What it does |
| :--- | :--- | :--- | :--- |
| Max steps per run | 40 | 1 to 200 | The agent stops and asks to continue after this many steps. |
| Max context length (tokens) | 128000 | 8000 to 2000000 | The model's context window. Set it to match your model. |
| Token budget per run | 1000000 | 10000 and up | The agent stops and asks to continue after this many input plus output tokens. |

A setting you have not changed uses its default. The offline agent CLI reads `AGENT_MAX_STEPS`, `AGENT_MAX_CONTEXT_TOKENS` and `AGENT_TOKEN_BUDGET` from the environment, and those win over the project values.

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

## Thinking time

While the model thinks, the chat shows how long the current model call has been going. Each call has its own timer, so a second think after a tool call starts again from 0. A finished thought shows "Thought for 42s". After a refresh, thoughts that came before tool calls keep their time; a thought that was followed by a text answer shows no time.
