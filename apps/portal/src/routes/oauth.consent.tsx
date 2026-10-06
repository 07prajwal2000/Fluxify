import { Button, Card } from "@fluxify/components";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { BASE_PATH } from "@/constants/routes";
import { authClient } from "@/lib/auth";
import { showErrorNotification } from "@/lib/errorNotifier";
import { httpClient } from "@/lib/http";
import { createRouteHead } from "@/lib/seo";

type PublicClient = {
	client_name?: string;
	name?: string;
	client_uri?: string;
	logo_uri?: string;
	icon?: string;
};

export const Route = createFileRoute("/oauth/consent")({
	head: createRouteHead("Authorize app", "Allow an app to access your Fluxify workspace."),
	beforeLoad: async ({ location }) => {
		const session = await authClient.getSession();
		if (!session.data?.user) {
			// Full path with the OAuth query; the login page reads it from the URL.
			throw redirect({ href: `${BASE_PATH}/login${location.searchStr}` });
		}
	},
	component: ConsentPage,
});

export function ConsentPage() {
	const query = window.location.search.slice(1);
	const params = new URLSearchParams(query);
	const clientId = params.get("client_id") ?? "";
	const scopes = (params.get("scope") ?? "").split(" ").filter(Boolean);
	const [pending, setPending] = useState<boolean | null>(null);
	const { data: client, isError } = useQuery({
		queryKey: ["oauth-public-client", clientId],
		queryFn: async () =>
			(
				await httpClient.get<PublicClient>("/auth/oauth2/public-client", {
					params: { client_id: clientId },
				})
			).data,
		enabled: !!clientId,
	});
	const icon = client?.logo_uri ?? client?.icon;

	async function decide(accept: boolean) {
		setPending(accept);
		try {
			const { data } = await httpClient.post<{ redirect: boolean; url: string }>(
				"/auth/oauth2/consent",
				{ accept, oauth_query: query },
			);
			window.location.href = data.url;
		} catch (error) {
			showErrorNotification(error as Error, false);
			setPending(null);
		}
	}

	return (
		<div className="flex min-h-screen w-screen items-center justify-center bg-background p-4 text-foreground">
			<Card className="w-full max-w-105 border border-border p-8 shadow-2xl shadow-black/50">
				<div className="flex flex-col gap-6">
					<div className="flex flex-col items-center gap-2 text-center">
						{icon ? (
							<img src={icon} alt="" className="h-16 w-16 rounded-md object-contain" />
						) : null}
						<h1 className="text-xl font-semibold tracking-tight">
							{client?.client_name ?? client?.name ?? "An app"} wants access
						</h1>
						{client?.client_uri ? <p className="text-sm text-muted">{client.client_uri}</p> : null}
					</div>
					{!clientId || isError ? (
						<p role="alert" className="text-center text-sm text-danger">
							Invalid authorization request
						</p>
					) : null}
					{scopes.length ? (
						<div className="flex flex-col gap-2">
							<p className="text-sm text-muted">It will be able to:</p>
							<ul className="list-inside list-disc text-sm">
								{scopes.map((s) => (
									<li key={s}>{s}</li>
								))}
							</ul>
						</div>
					) : null}
					<div className="flex gap-3">
						<Button
							variant="outline"
							fullWidth
							isDisabled={pending !== null}
							isPending={pending === false}
							onPress={() => decide(false)}
						>
							Deny
						</Button>
						<Button
							variant="primary"
							fullWidth
							isDisabled={pending !== null}
							isPending={pending === true}
							onPress={() => decide(true)}
						>
							Allow
						</Button>
					</div>
				</div>
			</Card>
		</div>
	);
}
