import {
	Button,
	DeleteIconButton,
	Input,
	Label,
	Modal,
	Table,
	Tabs,
	TextField,
	toast,
} from "@fluxify/components";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FiCopy, FiPlus, FiXCircle } from "react-icons/fi";
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

export function AccessTokens() {
	const qc = useQueryClient();
	const [open, setOpen] = useState(false);
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
	const close = () => {
		setOpen(false);
		setCreated(null);
	};

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center justify-between gap-3">
				<p className="text-sm text-muted">Tokens let AI agents and scripts act as you.</p>
				<Button size="sm" variant="primary" onPress={() => setOpen(true)}>
					<FiPlus /> New token
				</Button>
			</div>
			{keys.length === 0 ? (
				<p className="py-6 text-center text-sm text-muted">No tokens yet.</p>
			) : (
				<Table>
					<Table.Content aria-label="Access tokens">
						<Table.Header>
							<Table.Column id="name" isRowHeader>
								Name
							</Table.Column>
							<Table.Column id="prefix">Prefix</Table.Column>
							<Table.Column id="created">Created</Table.Column>
							<Table.Column id="expires">Expires</Table.Column>
							<Table.Column id="actions" aria-label="Actions">
								{""}
							</Table.Column>
						</Table.Header>
						<Table.Body items={keys}>
							{(k: ApiKey) => (
								<Table.Row id={k.id}>
									<Table.Cell>
										<span className="font-medium text-foreground">{k.name ?? "Unnamed"}</span>
									</Table.Cell>
									<Table.Cell>
										<span className="font-mono text-xs text-muted">
											{k.start ?? k.prefix ?? ""}
										</span>
									</Table.Cell>
									<Table.Cell>
										<span className="text-xs text-muted">{date(k.createdAt)}</span>
									</Table.Cell>
									<Table.Cell>
										<span className="text-xs text-muted">{date(k.expiresAt)}</span>
									</Table.Cell>
									<Table.Cell>
										<div className="flex justify-end">
											<DeleteIconButton
												size="sm"
												aria-label={`Delete ${k.name ?? "token"}`}
												onPress={() => setToDelete(k)}
											/>
										</div>
									</Table.Cell>
								</Table.Row>
							)}
						</Table.Body>
					</Table.Content>
				</Table>
			)}
			<Modal isOpen={open} onOpenChange={(o) => !o && close()}>
				<Modal.Backdrop>
					<Modal.Container placement="center" size="sm">
						<Modal.Dialog>
							<Modal.Header>
								<Modal.Heading>{created ? "Token created" : "New token"}</Modal.Heading>
							</Modal.Header>
							<Modal.Body>
								{created ? (
									<div className="flex flex-col gap-2">
										<p className="text-sm text-foreground">
											Copy your new token now. You won't see this again.
										</p>
										<div className="flex items-center gap-2 rounded-lg border border-accent bg-background-secondary p-3">
											<code className="min-w-0 flex-1 break-all text-xs text-foreground">
												{created}
											</code>
											<Button size="sm" variant="secondary" onPress={() => copy(created)}>
												<FiCopy /> Copy
											</Button>
										</div>
									</div>
								) : (
									<div className="flex flex-col gap-3">
										<TextField value={name} onChange={setName}>
											<Label>Name</Label>
											<Input placeholder="e.g. Claude Code laptop" />
										</TextField>
										<TextField value={days} onChange={setDays} isInvalid={!validDays}>
											<Label>Expires in (days)</Label>
											<Input type="number" min={1} max={365} />
										</TextField>
									</div>
								)}
							</Modal.Body>
							<Modal.Footer>
								{created ? (
									<Button variant="primary" onPress={close}>
										Done
									</Button>
								) : (
									<>
										<Button variant="ghost" onPress={close}>
											Cancel
										</Button>
										<Button
											variant="primary"
											isPending={create.isPending}
											isDisabled={!name.trim() || !validDays}
											onPress={() => create.mutate()}
										>
											Create token
										</Button>
									</>
								)}
							</Modal.Footer>
						</Modal.Dialog>
					</Modal.Container>
				</Modal.Backdrop>
			</Modal>
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
		</div>
	);
}

function ClientName({ clientId }: { clientId: string }) {
	// Public endpoint, the same one the consent page uses; the name is optional.
	const { data } = useQuery({
		queryKey: ["oauth-public-client", clientId],
		queryFn: async () =>
			(
				await httpClient.get<{ client_name?: string }>("/auth/oauth2/public-client", {
					params: { client_id: clientId },
				})
			).data,
		retry: false,
	});
	return <span className="font-medium text-foreground">{data?.client_name ?? clientId}</span>;
}

export function ConnectedApps() {
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
		<div className="flex flex-col gap-3">
			<p className="text-sm text-muted">Apps you signed in to with OAuth.</p>
			{consents.length === 0 ? (
				<p className="py-6 text-center text-sm text-muted">No connected apps.</p>
			) : (
				<Table>
					<Table.Content aria-label="Connected apps">
						<Table.Header>
							<Table.Column id="app" isRowHeader>
								App
							</Table.Column>
							<Table.Column id="scopes">Scopes</Table.Column>
							<Table.Column id="actions" aria-label="Actions">
								{""}
							</Table.Column>
						</Table.Header>
						<Table.Body items={consents}>
							{(c: Consent) => (
								<Table.Row id={c.id}>
									<Table.Cell>
										<ClientName clientId={c.clientId} />
									</Table.Cell>
									<Table.Cell>
										<span className="text-xs text-muted">{c.scopes.join(", ")}</span>
									</Table.Cell>
									<Table.Cell>
										<div className="flex justify-end">
											<Button
												size="sm"
												variant="danger-soft"
												isIconOnly
												aria-label="Revoke access"
												onPress={() => setToRevoke(c)}
											>
												<FiXCircle />
											</Button>
										</div>
									</Table.Cell>
								</Table.Row>
							)}
						</Table.Body>
					</Table.Content>
				</Table>
			)}
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
		</div>
	);
}

export function ConnectAgent() {
	const url = `${window.location.origin}/_/admin/mcp`;
	const clients = [
		{ id: "claude", label: "Claude Code", text: `claude mcp add --transport http fluxify ${url}` },
		{
			id: "cursor",
			label: "Cursor",
			text: JSON.stringify({ mcpServers: { fluxify: { url } } }, null, 2),
		},
		{
			id: "vscode",
			label: "VS Code",
			text: JSON.stringify({ servers: { fluxify: { type: "http", url } } }, null, 2),
		},
	];
	return (
		<div className="flex flex-col gap-3">
			<p className="text-sm text-muted">
				OAuth sign-in happens automatically on first connect. Clients without OAuth can send
				Authorization: Bearer &lt;access token&gt;.
			</p>
			<Tabs defaultSelectedKey="claude" className="flex flex-col gap-3">
				<Tabs.List aria-label="AI client">
					{clients.map((c) => (
						<Tabs.Tab key={c.id} id={c.id}>
							{c.label}
						</Tabs.Tab>
					))}
				</Tabs.List>
				{clients.map((c) => (
					<Tabs.Panel key={c.id} id={c.id}>
						<div className="relative">
							<pre className="overflow-x-auto rounded-lg border border-border bg-background-secondary p-3 pr-20 text-xs text-foreground">
								{c.text}
							</pre>
							<Button
								size="sm"
								variant="ghost"
								className="absolute right-2 top-2"
								onPress={() => copy(c.text)}
							>
								<FiCopy /> Copy
							</Button>
						</div>
					</Tabs.Panel>
				))}
			</Tabs>
		</div>
	);
}
