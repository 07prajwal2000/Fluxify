import {
	Button,
	Checkbox,
	CloseButton,
	Description,
	Input,
	Label,
	Modal,
	Spinner,
	TextArea,
	TextField,
	toast,
} from "@fluxify/components";
import { useState } from "react";
import { TbGitCommit } from "react-icons/tb";
import { AppConfigField } from "@/components/appConfig/AppConfigField";
import { showErrorNotification } from "@/lib/errorNotifier";
import { backupsQuery } from "@/query/backupsQuery";
import type { BackupRow, GitSettingsView } from "@/services/backups";
import { GitCommits } from "./GitCommits";

/** the rules the server checks, so the fields can say so before saving */
const URL = /^https?:\/\/[^\s/@]+(\/\S*)?$/;
const SEGMENTS = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;

/** `cfg:KEY` ↔ the bare key the picker holds */
const keyOf = (ref: string) => (ref.startsWith("cfg:") ? ref.slice(4) : "");
const refOf = (key: string) => (key ? `cfg:${key}` : "");

function CommitDialog({
	isOpen,
	onClose,
	onCommit,
	pending,
}: {
	isOpen: boolean;
	onClose: () => void;
	onCommit: (message: string) => void;
	pending: boolean;
}) {
	const [message, setMessage] = useState("");
	return (
		<Modal isOpen={isOpen} onOpenChange={(open) => !open && onClose()}>
			<Modal.Backdrop>
				<Modal.Container placement="center" size="md">
					<Modal.Dialog>
						<Modal.Header className="flex flex-row items-center justify-between">
							<Modal.Heading>Commit to git</Modal.Heading>
							<CloseButton onPress={onClose} />
						</Modal.Header>
						<Modal.Body>
							<TextField fullWidth variant="secondary" value={message} onChange={setMessage}>
								<Label>Commit message</Label>
								<TextArea rows={4} placeholder="What changed since the last backup" />
							</TextField>
						</Modal.Body>
						<Modal.Footer>
							<Button variant="secondary" onPress={onClose}>
								Cancel
							</Button>
							<Button
								variant="primary"
								isDisabled={!message.trim()}
								isPending={pending}
								onPress={() => onCommit(message.trim())}
							>
								Commit
							</Button>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}

/** what the settings as typed would do that the user should know first */
function Warnings({ url, encrypt, saved }: { url: string; encrypt: boolean; saved: boolean }) {
	return (
		<>
			{url.startsWith("http://") && (
				<p role="note" className="text-sm text-warning">
					Over http:// the token is sent in cleartext. Use it only on a network you trust.
				</p>
			)}
			{!encrypt && (
				<p role="alert" className="text-sm text-danger">
					Credentials and app config values will be committed as plain text and stay in the
					repository's history.
				</p>
			)}
			{encrypt && !saved && (
				<p role="note" className="text-sm text-warning">
					Turning encryption on doesn't remove secrets from earlier commits. Rotate the credentials
					and app config values that were committed in plain text.
				</p>
			)}
		</>
	);
}

/**
 * Project settings > Backup > Git (#1150, every edition): where commits go,
 * "Commit to git" with a message, and the branch's commits to restore from.
 * Username and token are app config keys, read on the server when committing.
 */
export function GitBackup({ projectId, history }: { projectId: string; history: BackupRow[] }) {
	const { data: view } = backupsQuery.git.useQuery(projectId);
	if (!view) return <Spinner size="sm" />;
	return <GitForm projectId={projectId} view={view} history={history} />;
}

function GitForm({
	projectId,
	view,
	history,
}: {
	projectId: string;
	view: GitSettingsView;
	history: BackupRow[];
}) {
	const saved = view.settings;
	const save = backupsQuery.saveGit.useMutation(projectId);
	const commit = backupsQuery.gitCommit.useMutation(projectId);
	const [url, setUrl] = useState(saved.url);
	const [branch, setBranch] = useState(saved.branch);
	const [path, setPath] = useState(saved.url ? saved.path : view.defaultPath);
	const [username, setUsername] = useState(saved.username);
	const [token, setToken] = useState(saved.token);
	const [encryptSecrets, setEncrypt] = useState(saved.encryptSecrets);
	const [dialog, setDialog] = useState(false);

	const badUrl = !URL.test(url);
	const badBranch = !SEGMENTS.test(branch) || branch.includes("..");
	const badPath = path !== "" && !SEGMENTS.test(path);
	const canSave = !badUrl && !badBranch && !badPath && Boolean(username && token);
	const running = history.some((b) => b.status === "running");
	const lastGit = history.find((b) => b.type === "git");
	// the commit list follows the newest commit this page knows of
	const revision = history.find((b) => b.type === "git" && b.status === "succeeded")?.id ?? "";

	const submit = () =>
		save.mutate(
			{ url, branch, path, username, token, encryptSecrets },
			{
				onSuccess: () => toast.success("Git settings saved."),
				onError: (e) => showErrorNotification(e as Error),
			},
		);
	const run = (message: string) =>
		commit.mutate(message, {
			onSuccess: () => {
				setDialog(false);
				toast.success("Commit started. The History tab shows how it went.");
			},
			onError: (e) => showErrorNotification(e as Error),
		});

	return (
		<section aria-label="Git" className="flex flex-col gap-3">
			<div>
				<h2 className="text-sm font-semibold text-foreground">Git</h2>
				<p className="text-sm text-muted">
					Commits a full backup of the project to a branch of your git repository, one file per
					resource, so each commit shows what changed.
				</p>
			</div>
			<div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
				<div className="grid gap-4 sm:grid-cols-3">
					<TextField value={url} onChange={setUrl} isInvalid={Boolean(url) && badUrl}>
						<Label>Repository URL</Label>
						<Input
							className="font-mono text-xs"
							placeholder="https://git.example.com/team/backups.git"
						/>
						<Description>http:// or https://, without a username or password in it.</Description>
					</TextField>
					<TextField value={branch} onChange={setBranch} isInvalid={badBranch}>
						<Label>Branch</Label>
						<Input className="font-mono text-xs" />
						<Description>Created on the first commit if it doesn't exist.</Description>
					</TextField>
					<TextField value={path} onChange={setPath} isInvalid={badPath}>
						<Label>Folder</Label>
						<Input className="font-mono text-xs" />
						<Description>Where in the repository; empty for its root.</Description>
					</TextField>
				</div>
				<div className="grid gap-4 sm:grid-cols-2">
					<AppConfigField
						projectId={projectId}
						label="Username"
						description="The app config key holding the git username."
						value={keyOf(username)}
						onChange={(k) => setUsername(refOf(k))}
					/>
					<AppConfigField
						projectId={projectId}
						label="Token"
						description="The app config key holding the token or password."
						value={keyOf(token)}
						onChange={(k) => setToken(refOf(k))}
					/>
				</div>
				<Checkbox
					isSelected={encryptSecrets}
					onChange={(on: boolean) => setEncrypt(on)}
					label="Encrypt secrets"
					description="Seals credentials and app config values with this instance's encryption key. They restore only on an instance with the same key."
				/>
				<Warnings
					url={url}
					encrypt={encryptSecrets}
					saved={encryptSecrets === saved.encryptSecrets || !saved.url}
				/>
				<div className="flex flex-wrap items-center justify-end gap-3">
					<Button
						variant="secondary"
						onPress={submit}
						isDisabled={!canSave}
						isPending={save.isPending}
					>
						Save
					</Button>
					<Button
						variant="primary"
						onPress={() => setDialog(true)}
						isDisabled={!saved.url || running}
					>
						<TbGitCommit size={16} />
						Commit to git
					</Button>
				</div>
				{lastGit?.status === "failed" && (
					<p role="alert" className="text-sm text-danger [overflow-wrap:anywhere]">
						The last commit failed: {lastGit.error}
					</p>
				)}
			</div>
			{saved.url && <GitCommits projectId={projectId} revision={revision} />}
			{dialog && (
				<CommitDialog
					isOpen
					onClose={() => setDialog(false)}
					onCommit={run}
					pending={commit.isPending}
				/>
			)}
		</section>
	);
}
