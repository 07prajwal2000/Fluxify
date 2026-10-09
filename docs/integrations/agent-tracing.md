---
title: Trace the AI Assistant with Phoenix
description: See every AI assistant run, model call and tool call, with timings and token counts, in Phoenix or any OpenInference viewer.
---

# Trace the AI Assistant with Phoenix

Turn on tracing to see what the AI assistant did on a run: which model calls it made, which tools it called, how long each took and how many tokens it used. It helps you tune prompts, spot slow steps and check how much the prompt cache saves.

Tracing is off by default.

## Start Phoenix

[Phoenix](https://phoenix.arize.com) is a free trace viewer you can run on your machine:

```bash
docker run -p 6006:6006 arizephoenix/phoenix
```

Open `http://localhost:6006` to see it.

## Turn tracing on

Add these to the `.env` the AI assistant reads, then restart it:

```env
LLM_TRACING_ENABLED=true
LLM_OTLP_TRACES_ENDPOINT=http://localhost:6006/v1/traces
```

Run the assistant as usual. Each run shows up in Phoenix a few seconds later.

| Setting | Default | What it does |
| :--- | :--- | :--- |
| `LLM_TRACING_ENABLED` | `false` | `true` turns tracing on. |
| `LLM_OTLP_TRACES_ENDPOINT` | none | Where traces are sent. Required when tracing is on. |
| `LLM_OTLP_TRACES_HEADERS` | none | Headers for that endpoint as `key:value` pairs split by `;`, for example `Authorization:Bearer abc`. Use it for a hosted viewer. |
| `LLM_TRACING_SAMPLE_RATE` | `1` | Share of runs traced, from `0` to `1`. `0.1` traces one run in ten. |
| `LLM_TRACING_RECORD_CONTENT` | `false` | `true` also sends prompts, messages and tool inputs and outputs. |

## What you see

Each run is one trace. Open it to see the steps in order:

| In Phoenix | What it is |
| :--- | :--- |
| `fluxify.agent.run` (Agent) | The whole run: your message, the mode, the model, and how it ended. |
| `step N` | One round of the assistant: a model call, then the tools it asked for. |
| `chat <model>` (LLM) | One model call: the messages sent, the reply, input and output tokens, cached tokens and why the model stopped. |
| `execute_tool <name>` (Tool) | One tool call: its name, input, output and error if it failed. Also whether you approved it. |
| `fluxify.compaction` | The assistant shortened a long conversation, with the token count before and after. |

A run that stopped early (step limit, token budget, or you pressed stop) says so on the run. All spans of a conversation share one session, so you can follow a chat across messages.

## Keep private data out

Prompts and tool results can hold user data and secrets, for example the password hashes in a recorded run. With `LLM_TRACING_RECORD_CONTENT=false` (the default) traces carry only names, timings, statuses and token counts. Set it to `true` only on your own machine while you tune the assistant.

::: warning
With content on, anyone who can open the viewer can read what the assistant read. Leave it `false` anywhere else.
:::

## Use another viewer

Any viewer that accepts OpenInference traces over OTLP works, for example Langfuse. Set `LLM_OTLP_TRACES_ENDPOINT` to its traces address and `LLM_OTLP_TRACES_HEADERS` to the key it needs.
