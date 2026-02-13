---
title: App Config
description: Managing application-level configuration.
---

# App Config

**App Config** allows you to manage environment variables and secrets for your application securely. Instead of hardcoding sensitive values like API keys or database passwords directly into your blocks, you should use the App Config.

## How it Works

1.  **Define Keys**: In the settings, you can define keys (e.g., `OPENAI_API_KEY`, `DB_PASSWORD`).
2.  **Reference**: In any block that supports dynamic input (prefixed with `cfg:`), you can reference these values.
    - Example: `cfg:OPENAI_API_KEY`

This promotes security and makes it easier to change credentials without modifying every single workflow.
