---
title: Referring to resources in chat
description: How an agent points at an existing route, workflow, trigger or other resource in its reply so the chat shows a link.
---

# Referring to resources in chat

When your reply names a resource that already exists, write a reference instead of a bare name or path. The chat shows it as a small chip with an icon and the label. Clicking it opens that resource's page in a new tab.

```
:ref[Label]{type=<type> id=<id>}
```

Write "I updated :ref[GET /users]{type=route id=2f8c1a}", not "I updated the /users api".

## Types

| `type` | What it points at | Where the `id` comes from |
| :--- | :--- | :--- |
| `route` | An HTTP route | `list`, `get`, or the `id` `save_route` returned |
| `workflow` | A background workflow | `list`, `get`, or `save_workflow` |
| `trigger` | A trigger | `list`, `get`, or `save_trigger` |
| `custom_block` | A custom block | `list`, `get`, or `save_custom_block` |
| `middleware` | A middleware chain | `list`, `get`, or `save_middleware` |
| `integration` | A database, KV store, AI provider or queue connection | `list`, `get`, or `save_integration` |
| `app_config` | A config entry | `list`, `get`, or `save_app_config` |
| `test_suite` | A test suite | `list_test_suites` or `save_test_suite` |

## Rules

- Use the exact `id` a tool returned. Never invent one.
- The label is free text: a name, or `METHOD /path` for a route. Keep it on one line and leave out `[` and `]`.
- Refer to things that exist. For something you only plan to create, or a resource you just deleted, use plain text.
- A reference that is missing a part, or has an unknown type, shows as its plain label. It never breaks the reply.
- The user can write the same references in their own message by picking a resource with `@`.
