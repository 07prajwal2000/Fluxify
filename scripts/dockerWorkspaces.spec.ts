import { describe, expect, it } from "bun:test";
import { checkDockerfiles, type DockerWorkspace } from "./dockerWorkspaces";

const workspaces: DockerWorkspace[] = [
	{ dir: "apps/server", name: "@fluxify/server", runtime: ["@fluxify/blocks"] },
	{ dir: "packages/blocks", name: "@fluxify/blocks", runtime: ["@fluxify/sdk"] },
	{ dir: "packages/sdk", name: "@fluxify/sdk", runtime: [] },
	{ dir: "packages/cli", name: "@fluxify/cli", runtime: ["@fluxify/sdk"] },
];

const deps = (dirs: string[]) =>
	[
		"FROM oven/bun AS deps",
		...dirs.map((d) => `COPY ${d}/package.json ${d}/package.json`),
		"RUN bun install --frozen-lockfile",
	].join("\n");
const build = (dirs: string[]) =>
	["FROM deps AS build", ...dirs.map((d) => `COPY ${d} ${d}`), "RUN bun run build"].join("\n");
const ALL = ["apps/server", "packages/blocks", "packages/sdk", "packages/cli"];
const IMPORTED = ["apps/server", "packages/blocks", "packages/sdk"];

describe("checkDockerfiles", () => {
	it("passes when every manifest is copied and the build stage has what the server imports", () => {
		const file = `${deps(ALL)}\n${build(IMPORTED)}\nFROM scratch AS production`;
		expect(checkDockerfiles(workspaces, { "docker/worker/Dockerfile": file })).toEqual([]);
	});

	it("fails for a workspace whose package.json the deps stage does not copy", () => {
		const file = `${deps(ALL.filter((d) => d !== "packages/cli"))}\n${build(IMPORTED)}`;
		expect(checkDockerfiles(workspaces, { "docker/worker/Dockerfile": file })).toEqual([
			"docker/worker/Dockerfile: deps stage does not COPY packages/cli/package.json",
		]);
	});

	it("fails for a package the server depends on, even through another, that the build stage lacks", () => {
		const file = `${deps(ALL)}\n${build(["apps/server", "packages/blocks"])}`;
		expect(checkDockerfiles(workspaces, { "docker/worker/Dockerfile": file })).toEqual([
			"docker/worker/Dockerfile: build stage does not COPY packages/sdk, which @fluxify/server depends on",
		]);
	});

	it("does not ask for packages/cli in the build stage: it is a dev tool", () => {
		const file = `${deps(ALL)}\n${build(IMPORTED)}`;
		expect(checkDockerfiles(workspaces, { a: file })).toEqual([]);
	});

	it("leaves a build stage that copies the whole repo alone", () => {
		const file = `${deps(ALL)}\nFROM deps AS build\nCOPY . .\nRUN bun run build`;
		expect(checkDockerfiles(workspaces, { a: file })).toEqual([]);
	});

	it("fails on a Dockerfile with no deps stage", () => {
		expect(checkDockerfiles(workspaces, { a: "FROM oven/bun\nRUN true" })).toEqual([
			"a: no deps stage (FROM ... AS deps)",
		]);
	});
});
