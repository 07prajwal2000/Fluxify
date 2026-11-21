// A Gitea container serving git smart HTTP, for the git backup tests (#1150).
import { docker, pullImage, startContainerWithRandomPort } from "@fluxify/adapters/containerTestHelpers";

const IMAGE = "gitea/gitea:1.24.6";
export const GIT_USER = "fluxifytest";
const PASS = "fluxifytest-pass-1";

/** starts a fresh container named `name`, with one user and a token, and returns how to reach it */
export async function startGitea(name: string) {
	await docker
		.getContainer(name)
		.remove({ force: true })
		.catch(() => {});
	await pullImage(IMAGE);
	const { container, port } = await startContainerWithRandomPort((p) =>
		docker.createContainer({
			Image: IMAGE,
			name,
			Env: [
				"GITEA__security__INSTALL_LOCK=true",
				"GITEA__database__DB_TYPE=sqlite3",
				`GITEA__server__ROOT_URL=http://127.0.0.1:${p}/`,
				"GITEA__repository__DEFAULT_PUSH_CREATE_PRIVATE=true",
			],
			HostConfig: { PortBindings: { "3000/tcp": [{ HostPort: String(p) }] } },
		}),
	);
	const url = `http://127.0.0.1:${port}`;
	const exec = async (cmd: string[]) => {
		const run = await container.exec({ Cmd: cmd, User: "git", AttachStdout: true, AttachStderr: true });
		const stream = await run.start({});
		await new Promise((resolve) => stream.on("end", resolve).resume());
		return (await run.inspect()).ExitCode;
	};
	// ready once the web server answers and the CLI can write the database
	for (let i = 0; ; i++) {
		const up = await fetch(`${url}/api/healthz`).then((r) => r.ok, () => false);
		const created =
			up &&
			(await exec([
				"gitea", "admin", "user", "create", "--admin", "--username", GIT_USER,
				"--password", PASS, "--email", `${GIT_USER}@example.com`, "--must-change-password=false",
			])) === 0;
		if (created) break;
		if (i > 120) throw new Error("Gitea did not start");
		await Bun.sleep(500);
	}
	const basic = `Basic ${btoa(`${GIT_USER}:${PASS}`)}`;
	const api = async (path: string, body: unknown) => {
		const res = await fetch(`${url}/api/v1${path}`, {
			method: "POST",
			headers: { authorization: basic, "content-type": "application/json" },
			body: JSON.stringify(body),
		});
		if (!res.ok) throw new Error(`Gitea ${path}: ${res.status} ${await res.text()}`);
		return res.json() as Promise<Record<string, unknown>>;
	};
	const token = (await api(`/users/${GIT_USER}/tokens`, {
		name: "backups",
		scopes: ["write:repository"],
	})).sha1 as string;
	return {
		url,
		token,
		/** a new empty repository; returns its clone URL */
		async repo(repoName: string) {
			await api("/user/repos", { name: repoName, private: true, auto_init: false });
			return `${url}/${GIT_USER}/${repoName}.git`;
		},
		stop: () => container.remove({ force: true }).catch(() => {}),
	};
}
