---
title: Project Templates
description: Create reusable starter projects without secrets or credentials to share with others or bootstrap new projects.
---

# Project Templates

A project template is an export of a project designed to serve as a starter kit or foundation for new projects.

Unlike full project backups, templates are **not encrypted** and contain **no secret credentials or passwords**. Anyone can import a template on any Fluxify instance without needing the original master encryption key.

## What a template is

Templates package your project's logic, endpoints, workflows, custom blocks, schemas, tests, and configurations into a portable `.tar.gz` archive.

Because all credentials and secret values are stripped out, templates are safe to share with teammates, publish in public repositories, or distribute to other organizations.

## Make a template

To create a template:

1. Open **Project Settings → Backup**.
2. Under **Kind of archive**, select **Template**.
3. Under **What to include**, choose the project parts you want to package.
4. In the **README (optional)** section, write documentation describing what the template does and how to set it up.
5. Click **Download backup**.

The browser downloads a `.tar.gz` archive file that anyone with system administrator access can import.

## The README

When creating a template, the README section becomes highlighted. Adding clear documentation helps whoever creates a project from the template get up and running quickly.

- **Markdown formatting**: Write instructions in Markdown using the **Write** and **Preview** tabs.
- **Size limit**: Up to 64 KB of text.

::: warning Stored unencrypted. Don't put secrets here.
The README text is stored unencrypted inside the template archive. Never put passwords, API tokens, connection strings, or private keys into the README.
:::

### What to include in your README

A good template README should tell the recipient:

1. **What the project does**: An overview of the API routes, workflows, and business logic included.
2. **Required integrations**: Which databases, message brokers, or third-party APIs need to be configured (for example, "Connect a PostgreSQL database and an S3 bucket").
3. **Required App Config keys**: Which configuration keys must be supplied with secret values before running.
4. **Required plugins**: Any plugins included that need approval before production compilation.
5. **How to test**: Example payloads or instructions for running the included test suites.

## What a template leaves out

To guarantee that private credentials and live states are never exposed, templates strip out sensitive data:

| Resource | What happens in a template |
|---|---|
| **Encryption** | Unencrypted. Anyone can open and inspect the contents. |
| **Integration credentials** | All passwords, API keys, tokens, and secret strings are stripped and left blank (`""`). Names, types, and connection settings remain. |
| **App config values** | All values are omitted. Only the key names, descriptions, and structure are preserved. |
| **Plugin approvals** | Approvals are reset to `pending`. Whoever restores the template must review permissions and approve the plugins. |
| **Knowledge documents** | Uploaded Markdown documents are dropped. Online web documentation sources keep their URLs and are refetched during restore. |
| **Production switches** | All routes, workflows, and triggers start switched off in production. They run in development immediately. |

## Use a template

To create a new project from a template:

1. On the **Projects** page, click the arrow on the **New Project** button.
2. Select **From backup or template file**.
3. Choose the template `.tar.gz` file.
4. The preview dialog opens. Click the **README** tab to read the template's instructions.
5. Review the included resources in the overview.
6. Enter the new project's name and slug, then click **Create project**.

For detailed step-by-step instructions and troubleshooting, see [Restore and Roll Back](/concepts/restore).

### After-restore checklist for templates

Because templates leave out secrets and start switched off in production, complete these steps after creating the project:

- Open **Integrations** and supply credentials for any empty connections.
- Open **App Config** and enter values for any missing keys.
- Open **Project Settings → Plugins** to inspect requested permissions and approve installed plugins.
- Test your endpoints in development.
- When ready, toggle the production switches on for your routes, workflows, and triggers.
