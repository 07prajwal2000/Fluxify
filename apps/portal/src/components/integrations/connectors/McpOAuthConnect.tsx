import { Button, toast } from "@fluxify/components";
import { useState } from "react";
import { TbPlugConnected, TbPlugConnectedX } from "react-icons/tb";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { showErrorNotification } from "@/lib/errorNotifier";
import { integrationsQuery } from "@/query/integrationsQuery";
import type { McpOAuthTarget } from "./types";

/** What the API returns in place of the tokens. */
export type McpOAuthStatus = { connected?: boolean; expiresAt?: number; scope?: string };

/**
 * Sign in to an MCP server with OAuth, for one environment. It is one shared account for the
 * integration, not one per person. Only admins connect; everyone else sees the status.
 */
export function McpOAuthConnect({
	projectId,
	target,
	status,
}: {
	projectId: string;
	target?: McpOAuthTarget;
	status?: McpOAuthStatus;
}) {
	const connect = integrationsQuery.connectMcpOAuth.mutation(projectId);
	const disconnect = integrationsQuery.disconnectMcpOAuth.mutation(projectId);
	const [confirming, setConfirming] = useState(false);
	const connected = status?.connected === true;

	function signIn() {
		if (!target) return;
		connect.mutate(
			{ id: target.integrationId, env: target.env },
			{
				// the MCP server's own sign in page; it sends the browser back to this integration
				onSuccess: ({ authorizationUrl }) => window.location.assign(authorizationUrl),
				onError: (e) => showErrorNotification(e as Error),
			},
		);
	}

	function signOut() {
		if (!target) return;
		disconnect.mutate(
			{ id: target.integrationId, env: target.env },
			{
				onSuccess: () => {
					setConfirming(false);
					toast.success("Disconnected");
				},
				onError: (e) => showErrorNotification(e as Error),
			},
		);
	}

	return (
		<div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-secondary/40 p-3">
			<div className="flex items-center justify-between gap-2">
				<span className="text-xs font-semibold text-foreground">Sign in with OAuth</span>
				<span
					className={`flex items-center gap-1 text-xs font-medium ${connected ? "text-success" : "text-muted"}`}
				>
					{connected ? <TbPlugConnected size={14} /> : <TbPlugConnectedX size={14} />}
					{connected ? "Connected" : "Not connected"}
				</span>
			</div>
			<p className="text-xs text-muted">
				One shared account for everyone who uses this integration. Connect a company or service
				account with only the access it needs, not a personal one.
			</p>
			{!target && <p className="text-xs text-muted">Save the integration first, then Connect.</p>}
			{target && !target.saved && (
				<p className="text-xs text-muted">Save the integration with OAuth first, then Connect.</p>
			)}
			{target?.saved && target.canConnect && (
				<div className="flex items-center gap-2">
					<Button size="sm" variant="primary" isPending={connect.isPending} onPress={signIn}>
						{connected ? "Reconnect" : "Connect"}
					</Button>
					{connected && (
						<Button size="sm" variant="outline" onPress={() => setConfirming(true)}>
							Disconnect
						</Button>
					)}
				</div>
			)}
			{target?.saved && !target.canConnect && (
				<p className="text-xs text-muted">Only project admins can connect or disconnect.</p>
			)}
			<ConfirmDialog
				open={confirming}
				onOpenChange={setConfirming}
				title="Disconnect?"
				danger
				confirmText="Disconnect"
				pending={disconnect.isPending}
				onConfirm={signOut}
			>
				The agent can no longer use this server in {target?.env ?? "production"} until someone
				connects it again.
			</ConfirmDialog>
		</div>
	);
}
