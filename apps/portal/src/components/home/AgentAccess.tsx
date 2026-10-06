import { Button, Card, Input, Label, TextField, toast } from "@fluxify/components";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FiCopy, FiTrash2 } from "react-icons/fi";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { showErrorNotification } from "@/lib/errorNotifier";
import { httpClient } from "@/lib/http";

// Shapes from @better-auth/api-key and @better-auth/oauth-provider 1.6.23.
type ApiKey = {
	id: string;
	name: string | null;
	start: string | null;
	prefix: string | null;
	createdAt: string;
	expiresAt: string | null;
};
type Consent = { id: string; clientId: string; scopes: string[]; createdAt: string };

const DAY = 60 * 60 * 24;
const date = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : "Never");

async function copy(text: string) {
	try {
		await navigator.clipboard.writeText(text);
		toast.success("Copied");
	} catch {
		toast.danger("Couldn't copy, select the text instead");
	}
}

export function AgentAccess() {
	return (
		<>
			<AccessTokens />
			<ConnectedApps />
			<ConnectAgent />
		</>
	);
}

function AccessTokens() {
	const qc = useQueryClient();
	const [name, setName] = useState("");
	const [days, setDays] = useState("90");
	const [created, setCreated] = useState<string | null>(null);
	const [toDelete, setToDelete] = useState<ApiKey | null>(null);
	const { data: keys = [] } = useQuery({
		queryKey: ["api-keys"],
		queryFn: async () =>
			(await httpClient.get<{ apiKeys: ApiKey[] }>("/auth/api-key/list")).data.apiKeys,
	});
	const daysNum = Number(days);
	const validDays = Number.isInteger(daysNum) && daysNum >= 1 && daysNum <= 365;

	const create = useMutation({
		mutationFn: async () =>
			(
				await httpClient.post<{ key: string }>("/auth/api-key/create", {
					name: name.trim(),
					expiresIn: daysNum * DAY,
				})
			).data.key,
		onSuccess: (key) => {
			setCreated(key);
			setName("");
			qc.invalidateQueries({ queryKey: ["api-keys"] });
		},
		onError: (e) => showErrorNotification(e as Error, false),
	});
	const remove = useMutation({
		mutationFn: async (keyId: string) => httpClient.post("/auth/api-key/delete", { keyId }),
		onSuccess: () => {
			setToDelete(null);
			qc.invalidateQueries({ queryKey: ["api-keys"] });
		},
		onError: (e) => showErrorNotification(e as Error, false),
	});

	return (
		<Card>
			<Card.Header>
				<Card.Title>Access tokens</Card.Title>
				<Card.Description>
					Tokens let AI agents and scripts act as you. They expire after the chosen number of days.
				</Card.Description>
			</Card.Header>
			<Card.Content className="flex flex-col gap-4">
				<div className="grid gap-4 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
					<TextField value={name} onChange={setName}>
						<Label>Name</Label>
						<Input placeholder="e.g. Claude Code laptop" />
					</TextField>
					<TextField value={days} onChange={setDays} isInvalid={!validDays}>
						<Label>Expires in (days)</Label>
						<Input type="number" min={1} max={365} />
					</TextField>
					<Button
						variant="primary"
						isPending={create.isPending}
						isDisabled={!name.trim() || !validDays}
						onPress={() => create.mutate()}
					>
						Create token
					</Button>
				</div>
				{created && (
					<div className="rounded-lg border border-accent bg-background-secondary p-3">
						<p className="text-sm text-foreground">
							Copy your new token now. You won't see this again.
						</p>
						<div className="mt-2 flex items-center gap-2">
							<code className="min-w-0 flex-1 break-all text-xs text-foreground">{created}</code>
							<Button size="sm" variant="secondary" onPress={() => copy(created)}>
								<FiCopy /> Copy
							</Button>
						</div>
					</div>
				)}
				{keys.length === 0 ? (
					<p className="text-sm text-muted">No tokens yet.</p>
				) : (
					<ul className="divide-y divide-border">
						{keys.map((k) => (
							<li key={k.id} className="flex items-center justify-between gap-3 py-2">
								<div className="min-w-0 text-sm">
									<p className="truncate font-medium text-foreground">{k.name ?? "Unnamed"}</p>
									<p className="text-xs text-muted">
										{k.start ?? k.prefix ?? ""} · Created {date(k.createdAt)} · Expires{" "}
										{date(k.expiresAt)}
									</p>
								</div>
								<Button
									size="sm"
									variant="danger-soft"
									aria-label={`Delete ${k.name ?? "token"}`}
									onPress={() => setToDelete(k)}
								>
									<FiTrash2 />
								</Button>
							</li>
						))}
					</ul>
				)}
			</Card.Content>
			<ConfirmDialog
				open={!!toDelete}
				onOpenChange={(o) => !o && setToDelete(null)}
				title="Delete token"
				confirmText="Delete"
				danger
				pending={remove.isPending}
				onConfirm={() => toDelete && remove.mutate(toDelete.id)}
			>
				Anything using "{toDelete?.name ?? "this token"}" will stop working.
			</ConfirmDialog>
		</Card>
	);
}

function ConsentRow({ consent, onRevoke }: { consent: Consent; onRevoke: () => void }) {
	// Public endpoint, the same one the consent page uses; the name is optional.
	const { data } = useQuery({
		queryKey: ["oauth-public-client", consent.clientId],
		queryFn: async () =>
			(
				await httpClient.get<{ client_name?: string }>("/auth/oauth2/public-client", {
					params: { client_id: consent.clientId },
				})
			).data,
		retry: false,
	});
	return (
		<li className="flex items-center justify-between gap-3 py-2">
			<div className="min-w-0 text-sm">
				<p className="truncate font-medium text-foreground">
					{data?.client_name ?? consent.clientId}
				</p>
				<p className="text-xs text-muted">
					{consent.clientId} · {consent.scopes.join(", ")}
				</p>
			</div>
			<Button size="sm" variant="danger-soft" onPress={onRevoke}>
				Revoke
			</Button>
		</li>
	);
}

function ConnectedApps() {
	const qc = useQueryClient();
	const [toRevoke, setToRevoke] = useState<Consent | null>(null);
	const { data: consents = [] } = useQuery({
		queryKey: ["oauth-consents"],
		queryFn: async () => (await httpClient.get<Consent[]>("/auth/oauth2/get-consents")).data,
	});
	const revoke = useMutation({
		mutationFn: async (id: string) => httpClient.post("/auth/oauth2/delete-consent", { id }),
		onSuccess: () => {
			setToRevoke(null);
			qc.invalidateQueries({ queryKey: ["oauth-consents"] });
		},
		onError: (e) => showErrorNotification(e as Error, false),
	});

	return (
		<Card>
			<Card.Header>
				<Card.Title>Connected apps</Card.Title>
				<Card.Description>Apps you signed in to with OAuth.</Card.Description>
			</Card.Header>
			<Card.Content>
				{consents.length === 0 ? (
					<p className="text-sm text-muted">No connected apps.</p>
				) : (
					<ul className="divide-y divide-border">
						{consents.map((c) => (
							<ConsentRow key={c.id} consent={c} onRevoke={() => setToRevoke(c)} />
						))}
					</ul>
				)}
			</Card.Content>
			<ConfirmDialog
				open={!!toRevoke}
				onOpenChange={(o) => !o && setToRevoke(null)}
				title="Revoke access"
				confirmText="Revoke"
				danger
				pending={revoke.isPending}
				onConfirm={() => toRevoke && revoke.mutate(toRevoke.id)}
			>
				This app will have to ask for access again.
			</ConfirmDialog>
		</Card>
	);
}

function Snippet({ title, text }: { title: string; text: string }) {
	return (
		<div>
			<div className="mb-1 flex items-center justify-between">
				<p className="text-sm font-medium text-foreground">{title}</p>
				<Button size="sm" variant="ghost" onPress={() => copy(text)}>
					<FiCopy /> Copy
				</Button>
			</div>
			<pre className="overflow-x-auto rounded-lg border border-border bg-background-secondary p-3 text-xs text-foreground">
				{text}
			</pre>
		</div>
	);
}

function ConnectAgent() {
	const url = `${window.location.origin}/_/admin/mcp`;
	const cursor = JSON.stringify({ mcpServers: { fluxify: { url } } }, null, 2);
	const vscode = JSON.stringify({ servers: { fluxify: { type: "http", url } } }, null, 2);
	return (
		<Card>
			<Card.Header>
				<Card.Title>Connect an AI agent</Card.Title>
				<Card.Description>
					OAuth sign-in happens automatically the first time the agent connects. For clients without
					OAuth, send the header Authorization: Bearer &lt;access token&gt;.
				</Card.Description>
			</Card.Header>
			<Card.Content className="flex flex-col gap-4">
				<Snippet title="Claude Code" text={`claude mcp add --transport http fluxify ${url}`} />
				<Snippet title="Cursor (.cursor/mcp.json)" text={cursor} />
				<Snippet title="VS Code (.vscode/mcp.json)" text={vscode} />
			</Card.Content>
		</Card>
	);
}
