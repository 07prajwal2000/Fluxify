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
