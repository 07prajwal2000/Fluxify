# Project backups: the engine

Builds and restores a whole project as one `.tar.gz`. Every resource type
(routes, workflows, plugins, …) is a **module**; this folder only knows how to
pack, check, upgrade and import modules. It owns no resource of its own.

| File | What it does |
| :--- | :--- |
| `types.ts` | The module contract (`BackupModule`) and the contexts it is handed |
| `modules.ts` | `BACKUP_MODULES`: every registered module, in dependency order |
| `registry.ts` | `orderModules`: checks the list and orders it by `dependsOn` |
| `backup.ts` | `createBackup(input, BACKUP_MODULES)` → `{ bytes, manifest }` |
| `restore.ts` | `readBackup(bytes, BACKUP_MODULES)` checks everything; `restoreBackup(plan, openProject)` writes |
| `archive.ts` | The tar layout, encryption, integrity hash, `readManifest` |
| `sections.ts` | Refuses too-old / too-new sections and walks the upgrade steps |
| `resources/` | The resource modules (`customBlocks`, `middlewares`, `routes`, …), their fixtures and Postgres tests |

Versioned resources capture and restore their versions with
`modules/versions/backup.ts` (`exportHistory`, `importHistory`,
`freshCanvasIds`).

## The archive

```
manifest.json          always readable: kind, format, mode, release, createdAt, source, sections, integrity
sections/<name>.json   one per module, at that module's format version
files/<name>/<path>    binary payloads a module returned (plugin tarballs)
```

In a **backup** the `sections/` and `files/` entries are a gzipped tar sealed
with `MASTER_ENCRYPTION_KEY` as `payload.enc`; it restores only on an instance
with the same key. A **template** keeps them as plain entries and carries no
secret values. `manifest.json` is never encrypted, so put nothing secret in it.

## Restoring

1. `readBackup` checks, before anything is written: it is an archive, its
   `kind`, the payload's hash, that it decrypts, and then every section: a
   section no module knows, newer than its module, or older than
   `minSupported` is refused. The rest are upgraded step by step and parsed
   with the module's `schema`.
2. A registered module whose section is absent imports **nothing**. That is
   how a backup taken before a resource existed still restores.
3. `restoreBackup(plan, openProject)`: the caller opens one transaction,
   creates the new project in it and calls `work(tx, projectId)`; the modules
   import in dependency order inside it. Any throw rolls the whole restore back.

```ts
const plan = await readBackup(bytes, BACKUP_MODULES);
const id = await restoreBackup(plan, (work) =>
	db.transaction(async (tx) => {
		const projectId = await createProject({ ... }, tx);
		await work(tx, projectId);
		return projectId;
	}),
);
// after the commit: the compiler reads Postgres, so it must not run inside the transaction
await requestProjectCompile(id, "project restored");
```

4. Modules write promoted versions and `prod_version_id` directly and run no
   promotion gates. Nothing reaches workers until the caller asks for the
   project compile above, which publishes custom blocks, then middlewares, then
   routes and workflows, in the order production needs them.

## Adding a resource module

1. Write a `BackupModule<T>` next to the resource's code:
   - `name`: the section key. **Never rename it**; old archives use it.
   - `version: 1`, `minSupported: 1`, `upgrades: {}`.
   - `dependsOn`: modules whose ids you need (e.g. routes depend on `customBlocks` and `middlewares`).
   - `schema`: a zod schema of `T`. It parses every section on export *and* on
     restore, so give optional fields a `.default()`.
   - `export(ctx)`: the project's rows as `T`. Refer to other resources **by
     name**, never by id. Check `ctx.mode`: in a `template`, blank every secret
     (credentials, app config values). `ctx.options` says whether version
     history and app config values were asked for (values are always off in a
     template). Binary payloads go in `files`, keyed by a relative path.
   - `import(ctx, data)`: insert with `ctx.tx` into `ctx.projectId`, and record
     each name's new id with `ctx.ids.set(this.name, name, id)` for the modules
     after you. `ctx.ids.get(...)` can return `undefined` when the section it
     belongs to was left out; blank the reference or refuse with a
     `BadRequestError`. `ctx.files` holds your files only and is untrusted:
     never write a path from it to disk unchecked.
2. Add it to the list in `modules.ts`. A cycle, an unknown dependency or a
   missing upgrade step fails at startup.
3. Add a fixture (below).

## Changing a module's format

Bump the version whenever the shape of `T` changes in a way an old section
would not parse:

1. `version: N + 1`, change `schema`.
2. Add `upgrades[N]`: a pure function from the v`N` shape to the v`N+1` shape.
   It gets plain JSON and returns plain JSON; no database, no clock, no env.
3. **Never edit an upgrade step once it has been released.** Archives made by
   that release depend on it exactly as it is. Fix a mistake with a new step.
4. Add a fixture at the new version.

## Fixtures

`fixtures/` holds committed archives, each with a `.expected.json` of the
project it must restore to. `tests/fixtures.spec.ts` restores every one on the
current code. **Every format bump adds a fixture, and a fixture is never
regenerated or edited**: if one stops restoring, the code broke real users'
backups. Stub-module fixtures are written by `fixtures/make.ts`, which skips
files that exist. A real module's fixture is a backup made with that version
(`createBackup`) and restored by a `*.test.ts` against Postgres.

## Deprecating an old format

1. Raise `minSupported` to the oldest version still restored, and set
   `lastReleaseFor[v]` for each dropped version to the last release that reads
   it. The refusal message names it, so users know where to restore first.
2. Announce it in the release notes.
3. In a later release, delete the upgrade steps and fixtures below
   `minSupported`.
