import {
	Button,
	CloseButton,
	cn,
	Description,
	Input,
	Label,
	Modal,
	TextField,
} from "@fluxify/components";
import { useState } from "react";
import { restoredName } from "@/components/settings/backup/RemoteBackups";
import { formatDateTime } from "@/lib/datetime";
import { parseApiError } from "@/lib/errorNotifier";
import type { GitCommit } from "@/services/backups";
import { type GitRepoInput, projectsService } from "@/services/projects";
import type { NewProjectSource } from "./useRestoreFlow";

/** the rules the server checks, so the fields can say so before asking */
const URL = /^https?:\/\/[^\s/@]+(\/\S*)?$/;
const SEGMENTS = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;

/** one commit of a typed-in repository as a restore source */
export function gitRepoSource(repo: GitRepoInput, commit: GitCommit): NewProjectSource {
	return {
		title: "New project from a git repository",
		subtitle: `${repo.url} @ ${commit.sha.slice(0, 10)}`,
		inspect: () => projectsService.inspectGit(repo, commit.sha),
		restore: (form) => projectsService.restoreGit(repo, commit.sha, form),
		prefill: (summary) => ({ name: restoredName(summary.source.name, commit.date) }),
	};
}

function Field({
	label,
	value,
	onChange,
	hint,
	invalid,
	type,
}: {
	label: string;
	value: string;
	onChange: (v: string) => void;
	hint: string;
	invalid?: boolean;
	type?: string;
}) {
	return (
		<TextField value={value} onChange={onChange} isInvalid={invalid} type={type}>
			<Label>{label}</Label>
			<Input className="font-mono text-xs" autoComplete="off" />
			<Description>{hint}</Description>
		</TextField>
	);
}

function Commits({
	commits,
	picked,
	onPick,
}: {
	commits: GitCommit[];
	picked: string;
	onPick: (sha: string) => void;
}) {
	return (
		<div
			role="radiogroup"
			aria-label="Commit"
			className="flex max-h-64 flex-col gap-1 overflow-y-auto"
		>
			{commits.map((c) => (
				<button
					key={c.sha}
					type="button"
					role="radio"
					aria-checked={c.sha === picked}
					onClick={() => onPick(c.sha)}
					className={cn(
						"flex flex-col rounded-md border px-3 py-2 text-left transition-colors",
						c.sha === picked
							? "border-accent bg-accent/10"
							: "border-border hover:bg-surface-secondary",
					)}
				>
					<span className="truncate text-sm text-foreground">{c.message.split("\n")[0]}</span>
					<span className="text-xs text-muted">
						<span className="font-mono">{c.sha.slice(0, 10)}</span> · {c.author} ·{" "}
						{formatDateTime(c.date)}
					</span>
				</button>
			))}
		</div>
	);
}

/**
 * "Restore from a git repository" (#1152): a repository, branch and folder,
 * with a username and token only for a private one (sent with each request,
 * never stored), then a commit (the tip by default). `onPick` hands the
 * commit to the restore flow's preview.
 */
export function GitRestoreDialog({
	onClose,
	onPick,
}: {
	onClose: () => void;
	onPick: (source: NewProjectSource) => void;
}) {
	const [url, setUrl] = useState("");
	const [branch, setBranch] = useState("main");
	const [path, setPath] = useState("");
	const [username, setUsername] = useState("");
	const [token, setToken] = useState("");
	const [commits, setCommits] = useState<GitCommit[] | null>(null);
	const [picked, setPicked] = useState("");
	const [error, setError] = useState<string>();
	const [loading, setLoading] = useState(false);

	const badUrl = !URL.test(url);
	const badBranch = !SEGMENTS.test(branch) || branch.includes("..");
	const badPath = path !== "" && !SEGMENTS.test(path);
	const repo: GitRepoInput = {
		url,
		branch,
		path,
		username: username.trim() || undefined,
		token: token.trim() || undefined,
	};
	// any change to the repository asks for its commits again
	const edit = (set: (v: string) => void) => (v: string) => {
		set(v);
		setCommits(null);
		setError(undefined);
	};

	const list = async () => {
		setLoading(true);
		setError(undefined);
		try {
			const found = await projectsService.gitCommits(repo);
			setCommits(found);
			setPicked(found[0]?.sha ?? "");
		} catch (e) {
			setError(parseApiError(e).message);
		} finally {
			setLoading(false);
		}
	};
	const commit = commits?.find((c) => c.sha === picked);

	return (
		<Modal isOpen onOpenChange={(open) => !open && onClose()}>
			<Modal.Backdrop>
				<Modal.Container placement="center" size="lg">
					<Modal.Dialog>
						<Modal.Header className="flex flex-row items-center justify-between">
							<Modal.Heading>Restore from a git repository</Modal.Heading>
							<CloseButton onPress={onClose} />
						</Modal.Header>
						<Modal.Body className="flex flex-col gap-4">
							<Field
								label="Repository URL"
								value={url}
								onChange={edit(setUrl)}
								invalid={Boolean(url) && badUrl}
								hint="http:// or https://, as you would clone it."
							/>
							<div className="grid gap-4 sm:grid-cols-2">
								<Field
									label="Branch"
									value={branch}
									onChange={edit(setBranch)}
									invalid={badBranch}
									hint="The branch the backups are on."
								/>
								<Field
									label="Folder"
									value={path}
									onChange={edit(setPath)}
									invalid={badPath}
									hint="Where the backup is; empty for the root."
								/>
								<Field
									label="Username"
									value={username}
									onChange={edit(setUsername)}
									hint="Private repositories only; optional with a token."
								/>
								<Field
									label="Token"
									type="password"
									value={token}
									onChange={edit(setToken)}
									hint="Read access is enough. Used for this restore only, never stored."
								/>
							</div>
							{url.startsWith("http://") && token && (
								<p role="note" className="text-sm text-warning">
									Over http:// the token is sent in cleartext.
								</p>
							)}
							{error && (
								<p role="alert" className="text-sm text-danger [overflow-wrap:anywhere]">
									{error}
								</p>
							)}
							{commits && <Commits commits={commits} picked={picked} onPick={setPicked} />}
						</Modal.Body>
						<Modal.Footer>
							<Button variant="secondary" onPress={onClose}>
								Cancel
							</Button>
							{commit ? (
								<Button variant="primary" onPress={() => onPick(gitRepoSource(repo, commit))}>
									Continue
								</Button>
							) : (
								<Button
									variant="primary"
									isDisabled={badUrl || badBranch || badPath}
									isPending={loading}
									onPress={() => void list()}
								>
									Find commits
								</Button>
							)}
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
