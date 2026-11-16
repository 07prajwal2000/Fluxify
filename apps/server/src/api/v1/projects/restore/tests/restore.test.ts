// A new project from a backup or template file (#1104), over HTTP against a real
// Postgres and NATS with the real backup modules: inspect, restore, the rows a
// normal "create project" makes, production switched off for a template, and
// refusals that leave nothing behind.
import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { Hono } from "hono";
import { createStack, type Stack, short } from "../../../../../modules/deployments/tests/blockHarness";

let stack: Stack;
let app: Hono<any>;
let db: any;
let schema: typeof import("../../../../../db/schema");
let createBackup: typeof import("../../../../../modules/projectBackup/backup").createBackup;
let modules: typeof import("../../../../../modules/projectBackup/modules");
let publisher: typeof import("../../../../../modules/compiler/publisher");
let audit: typeof import("../../../../../modules/audit");
let compileProject: (projectId: string) => Promise<void>;
let restoreProject: typeof import("../../../../../modules/projectBackup/restoreProject");

beforeAll(async () => {
	stack = await createStack("restoreproject");
	db = (await import("../../../../../db")).db;
	schema = await import("../../../../../db/schema");
	createBackup = (await import("../../../../../modules/projectBackup/backup")).createBackup;
	modules = await import("../../../../../modules/projectBackup/modules");
	publisher = await import("../../../../../modules/compiler/publisher");
	audit = await import("../../../../../modules/audit");
	compileProject = (await import("../../../../../modules/compiler/project")).compileProject;
	restoreProject = await import("../../../../../modules/projectBackup/restoreProject");

	app = new Hono<any>();
	const { errorHandler } = await import("../../../../../middlewares/errorHandler");
	app.onError(errorHandler);
	app.use(async (ctx, next) => {
		ctx.set("user", { id: "admin", isSystemAdmin: ctx.req.header("X-Admin") !== "no" });
		ctx.set("acl", []);
		await next();
	});
	const router = app.basePath("/projects");
	(await import("../route")).default(router as any);
}, 240_000);

afterAll(async () => {
	await stack?.stop();
});

/** a source project: a released route that says hello, and a workflow, both live */
async function source() {
	const { project, as } = await stack.setup();
	stack.devWorker(project);
	const route = await stack.createRoute(as, true);
	await stack.setScript(as, "routes", route, "return 'hello';");
	await stack.release(as, "routes", route);
	await stack.createWorkflow(as);
	return { project, as };
}

const archive = async (projectId: string, mode: "backup" | "template", readme?: string) =>
	(
		await createBackup(
			{ projectId, source: { name: projectId.slice(0, 40), slug: projectId }, mode, readme },
			modules.BACKUP_MODULES,
		)
	).bytes;

function upload(path: string, bytes: Uint8Array, fields: Record<string, string> = {}, admin = true) {
	const form = new FormData();
	form.set("file", new File([bytes], "project.tar.gz"));
	for (const [k, v] of Object.entries(fields)) form.set(k, v);
	return app.request(`http://localhost/projects${path}`, {
		method: "POST",
		body: form,
		headers: admin ? {} : { "X-Admin": "no" },
	});
}

const projectsWith = async (slug: string) =>
	(await stack.sql`SELECT id FROM projects WHERE slug = ${slug}`) as { id: string }[];

describe("inspect", () => {
	it("summarises the archive, suggests a free name and slug, and writes nothing", async () => {
		const { project } = await source();
		const bytes = await archive(project, "template", "# Orders\nset the db");
		const before = (await stack.sql`SELECT count(*)::int AS n FROM projects`)[0].n;

		const res = await upload("/restore/inspect", bytes);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toMatchObject({
			mode: "template",
			encrypted: false,
			readme: "# Orders\nset the db",
			source: { slug: project },
		});
		expect(Object.keys(body.sections)).toContain("routes");
		// the source still holds its name and slug, so the suggestion moves on
		expect(body.suggested).toEqual({ name: `${project} (2)`, slug: `${project}-2` });

		// a read-only preview of each section: the route with its canvas, switched off as a template
		const routes = body.preview.find((p: { section: string }) => p.section === "routes");
		expect(routes.items).toHaveLength(1);
		expect(routes.items[0].summary).toMatch(/^GET \//);
		expect(routes.items[0].details.Production).toContain("Off");
		expect(routes.items[0].canvas.blocks.some((b: { type: string }) => b.type === "jsrunner")).toBe(true);
		expect(body.preview.find((p: { section: string }) => p.section === "workflows").items).toHaveLength(1);
		expect((await stack.sql`SELECT count(*)::int AS n FROM projects`)[0].n).toBe(before);
	});

	it("refuses what isn't a backup with the engine's message", async () => {
		const res = await upload("/restore/inspect", new TextEncoder().encode("not a tarball"));
		expect(res.status).toBe(400);
		expect(JSON.stringify(await res.json())).toContain("isn't a Fluxify project backup");
	});
});

describe("restore", () => {
	it("makes a working project from a template, switched off in production", async () => {
		const { project } = await source();
		const bytes = await archive(project, "template");
		const queued = spyOn(publisher, "requestProjectCompile").mockResolvedValue(true);
		const record = spyOn(audit.audit, "record");
		const slug = `t-${short()}`;

		const res = await upload("/restore", bytes, { name: `T ${short()}`, slug });
		expect(res.status).toBe(200);
		const { id, warnings } = await res.json();
		expect(queued).toHaveBeenCalledWith(id, "project restored");
		expect(warnings.some((w: { message: string }) => w.message.includes("Compilation"))).toBe(false);
		expect(record.mock.calls.map(([c]) => `${c.action}:${c.resourceType}`)).toContain("restore:project");
		queued.mockRestore();
		record.mockRestore();

		// the rows a normal "create project" makes
		expect((await projectsWith(slug)).map((p) => p.id)).toEqual([id]);
		expect(
			(await stack.sql`SELECT count(*)::int AS n FROM project_dev_tokens WHERE project_id = ${id}`)[0].n,
		).toBe(1);

		const routes = await stack.sql`SELECT id, active, dev_active FROM routes WHERE project_id = ${id}`;
		const workflows = await stack.sql`SELECT active, dev_active FROM workflows WHERE project_id = ${id}`;
		expect(routes).toHaveLength(1);
		expect(routes[0]).toMatchObject({ active: false, dev_active: true });
		expect(workflows[0]).toMatchObject({ active: false, dev_active: true });

		// what the compile request does: development serves it, production doesn't
		await compileProject(id);
		expect(await stack.routeArtifact(id, routes[0].id, "development")).not.toBeNull();
		expect(await stack.routeArtifact(id, routes[0].id, "production")).toBeNull();
	});

	it("gives the new project the description and subdomain from the form", async () => {
		const { project } = await source();
		const queued = spyOn(publisher, "requestProjectCompile").mockResolvedValue(true);
		const subdomain = `sd${short()}`.toLowerCase();
		const res = await upload("/restore", await archive(project, "backup"), {
			name: `F ${short()}`,
			slug: `f-${short()}`,
			description: "  A copy for the EU  ",
			subdomain,
		});
		queued.mockRestore();
		expect(res.status).toBe(200);
		const { id, warnings } = await res.json();
		const [row] = await stack.sql`SELECT description FROM projects WHERE id = ${id}`;
		expect(row.description).toBe("A copy for the EU");
		const [setting] =
			await stack.sql`SELECT value FROM project_settings WHERE project_id = ${id} AND key = 'settings.routing.subdomain'`;
		expect(setting.value).toBe(subdomain);
		expect(JSON.stringify(warnings)).not.toContain("subdomain");
	});

	it("leaves the subdomain and description empty when the form leaves them blank", async () => {
		const { project } = await source();
		const queued = spyOn(publisher, "requestProjectCompile").mockResolvedValue(true);
		const res = await upload("/restore", await archive(project, "template"), {
			name: `E ${short()}`,
			slug: `e-${short()}`,
			description: "",
			subdomain: "",
		});
		queued.mockRestore();
		expect(res.status).toBe(200);
		const { id } = await res.json();
		const settings =
			await stack.sql`SELECT value FROM project_settings WHERE project_id = ${id} AND key = 'settings.routing.subdomain' AND value <> ''`;
		expect(settings).toEqual([]);
	});

	it("keeps a backup's production switches", async () => {
		const { project } = await source();
		const bytes = await archive(project, "backup");
		const queued = spyOn(publisher, "requestProjectCompile").mockResolvedValue(true);
		const res = await upload("/restore", bytes, { name: `B ${short()}`, slug: `b-${short()}` });
		queued.mockRestore();
		expect(res.status).toBe(200);
		const { id } = await res.json();
		const [route] = await stack.sql`SELECT id, active FROM routes WHERE project_id = ${id}`;
		expect(route.active).toBe(true);
		await compileProject(id);
		expect(await stack.routeArtifact(id, route.id, "production")).not.toBeNull();
	});

	it("warns when the compile couldn't be queued, and the project still exists", async () => {
		const { project } = await source();
		const queued = spyOn(publisher, "requestProjectCompile").mockResolvedValue(false);
		const slug = `q-${short()}`;
		const res = await upload("/restore", await archive(project, "template"), { name: `Q ${short()}`, slug });
		queued.mockRestore();
		expect(res.status).toBe(200);
		const { warnings } = await res.json();
		expect(warnings).toContainEqual({ section: "project", message: restoreProject.COMPILE_NOT_QUEUED });
		expect(await projectsWith(slug)).toHaveLength(1);
	});

	it("drops an MCP sign-in restored next to its source, and says so", async () => {
		const { project } = await source();
		const oauth = { v: 1, tokens: "sealed" };
		await stack.sql`INSERT INTO integrations (id, project_id, name, "group", variant, config)
			VALUES (${Bun.randomUUIDv7()}, ${project}, 'docs-mcp', 'mcp', 'http',
				${JSON.stringify({ url: "https://mcp.example", auth: "oauth", oauth })}::text::jsonb)`;
		const bytes = await archive(project, "backup");
		// the preview names the integration, never its config
		const inspected = await (await upload("/restore/inspect", bytes)).json();
		const integrations = inspected.preview.find((p: { section: string }) => p.section === "integrations");
		expect(integrations.items[0]).toMatchObject({ name: "docs-mcp", summary: "mcp · http" });
		expect(JSON.stringify(inspected)).not.toContain("mcp.example");
		expect(JSON.stringify(inspected)).not.toContain("sealed");

		const queued = spyOn(publisher, "requestProjectCompile").mockResolvedValue(true);
		const res = await upload("/restore", bytes, { name: `M ${short()}`, slug: `m-${short()}` });
		queued.mockRestore();
		const { id, warnings } = await res.json();
		expect(warnings).toContainEqual({ section: "integrations", message: 'MCP server "docs-mcp" needs signing in again.' });
		const [row] = await stack.sql`SELECT config FROM integrations WHERE project_id = ${id}`;
		expect(row.config).toEqual({ url: "https://mcp.example", auth: "oauth" });
	});
});

describe("refusals create nothing", () => {
	it("a slug another project holds", async () => {
		const { project } = await source();
		const before = (await stack.sql`SELECT count(*)::int AS n FROM projects`)[0].n;
		const res = await upload("/restore", await archive(project, "template"), { name: `S ${short()}`, slug: project });
		expect(res.status).toBe(409);
		expect(JSON.stringify(await res.json())).toContain(`'${project}' slug`);
		expect((await stack.sql`SELECT count(*)::int AS n FROM projects`)[0].n).toBe(before);
	});

	it("a subdomain the API would refuse", async () => {
		const { project } = await source();
		const slug = `v-${short()}`;
		const res = await upload("/restore", await archive(project, "template"), {
			name: `V ${short()}`,
			slug,
			subdomain: "-Not Valid-",
		});
		expect(res.status).toBe(400);
		expect(await projectsWith(slug)).toEqual([]);
	});

	it("an archive that fails during the import rolls the whole project back", async () => {
		const { project } = await source();
		const bytes = await archive(project, "template");
		const routes = modules.BACKUP_MODULES.find((m) => m.name === "routes")!;
		const { BadRequestError } = await import("../../../../../errors/badRequestError");
		const boom = spyOn(routes, "import").mockRejectedValue(new BadRequestError("refused mid-way"));
		const slug = `r-${short()}`;
		const res = await upload("/restore", bytes, { name: `R ${short()}`, slug });
		boom.mockRestore();
		expect(res.status).toBe(400);
		expect(await projectsWith(slug)).toEqual([]);
	});

	it("a damaged archive, before any project is made", async () => {
		const { project } = await source();
		const bytes = await archive(project, "template");
		const slug = `d-${short()}`;
		const res = await upload("/restore", bytes.slice(0, bytes.length / 2), { name: `D ${short()}`, slug });
		expect(res.status).toBe(400);
		expect(await projectsWith(slug)).toEqual([]);
	});

	it("an archive over the upload limit", async () => {
		const res = await app.request("http://localhost/projects/restore/inspect", {
			method: "POST",
			body: "x",
			headers: {
				"content-type": "multipart/form-data; boundary=x",
				"content-length": String(restoreProject.MAX_ARCHIVE_UPLOAD_BYTES + 2 * 1024 * 1024),
			},
		});
		expect(res.status).toBe(413);
		expect(JSON.stringify(await res.json())).toContain("upload limit");
	});

	it("someone who can't create projects", async () => {
		const { project } = await source();
		const slug = `n-${short()}`;
		const res = await upload("/restore", await archive(project, "template"), { name: `N ${short()}`, slug }, false);
		expect(res.status).toBe(403);
		expect(await projectsWith(slug)).toEqual([]);
	});
});
