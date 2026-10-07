import { Button, Chip } from "@fluxify/components";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { isAxiosError } from "axios";
import { useState } from "react";
import { AuthCard, FluxifyBrand } from "@/components/common/AuthCard";
import { BASE_PATH } from "@/constants/routes";
import { authClient } from "@/lib/auth";
import { showErrorNotification } from "@/lib/errorNotifier";
import { httpClient } from "@/lib/http";
import { initialQuery } from "@/lib/oauthQuery";
import { createRouteHead } from "@/lib/seo";

type PublicClient = {
	client_name?: string;
	name?: string;
	client_uri?: string;
	logo_uri?: string;
	icon?: string;
};

/** What each scope lets the app do, in plain words. Unknown scopes show as-is. */
export const SCOPE_LABELS: Record<string, string> = {
	openid: "Know who you are",
	profile: "See your name",
	email: "See your email",
	offline_access: "Stay signed in",
};

/** The plugin signs the query with a short `exp` (unix seconds); past it, Allow and Deny 400. */
export function isExpired(query: string, now = Date.now()) {
	const exp = Number(new URLSearchParams(query).get("exp") || Number.NaN);
	return !Number.isFinite(exp) || exp * 1000 <= now;
}

const isInvalidSignature = (error: unknown) =>
	isAxiosError(error) &&
	error.response?.status === 400 &&
	error.response.data?.error === "invalid_signature";

export const Route = createFileRoute("/oauth/consent")({
	head: createRouteHead("Authorize app", "Allow an app to access your Fluxify workspace."),
	beforeLoad: async () => {
		const session = await authClient.getSession();
		if (!session.data?.user) {
			// Full path with the OAuth query; the login page reads it from the URL.
			throw redirect({ href: `${BASE_PATH}/login?${initialQuery}` });
		}
	},
	component: ConsentPage,
});

export function ConsentPage({ query = initialQuery }: { query?: string }) {
	const params = new URLSearchParams(query);
	const clientId = params.get("client_id") ?? "";
	const scopes = (params.get("scope") ?? "").split(" ").filter(Boolean);
	const [pending, setPending] = useState<boolean | null>(null);
	const [expired, setExpired] = useState(() => isExpired(query));
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
		// the tab may have sat open past `exp`
		if (isExpired(query)) return setExpired(true);
		setPending(accept);
		try {
			const { data } = await httpClient.post<{ redirect: boolean; url: string }>(
				"/auth/oauth2/consent",
				{ accept, oauth_query: query },
			);
			window.location.href = data.url;
		} catch (error) {
			// e.g. clock skew: the server says expired before we did
			if (isInvalidSignature(error)) setExpired(true);
			else showErrorNotification(error as Error, false);
			setPending(null);
		}
	}

	const name = client?.client_name ?? client?.name ?? "An app";

	if (expired) {
		return (
			<AuthCard>
				<div className="flex flex-col items-center gap-2 text-center">
					<FluxifyBrand />
					<h1 className="text-xl font-semibold tracking-tight text-foreground">
						This request has expired
					</h1>
					<p className="text-sm text-muted">Start the connection again from your AI app.</p>
				</div>
			</AuthCard>
		);
	}

	return (
		<AuthCard>
			<div className="flex flex-col gap-8">
				<div className="flex flex-col items-center gap-2 text-center">
					<FluxifyBrand />
					{icon ? <img src={icon} alt="" className="h-12 w-12 rounded-md object-contain" /> : null}
					<h1 className="text-xl font-semibold tracking-tight text-foreground">
						{name} wants to access your Fluxify account
					</h1>
					{client?.client_uri ? <p className="text-sm text-muted">{client.client_uri}</p> : null}
				</div>
				{!clientId || isError ? (
					<p role="alert" className="text-center text-sm text-danger">
						Invalid authorization request
					</p>
				) : null}
				{scopes.length ? (
					<div className="flex flex-col gap-3">
						<p className="text-sm text-muted">It will be able to:</p>
						<div className="flex flex-wrap gap-2">
							{scopes.map((s) => (
								<Chip key={s} size="sm">
									{SCOPE_LABELS[s] ?? s}
								</Chip>
							))}
						</div>
						<p className="text-xs text-muted">
							It can only do what you can do in your projects. Revoke it anytime under Account →
							Connected apps.
						</p>
					</div>
				) : null}
				<div className="flex flex-col gap-3">
					<Button
						variant="primary"
						fullWidth
						isDisabled={pending !== null}
						isPending={pending === true}
						onPress={() => decide(true)}
					>
						Allow
					</Button>
					<Button
						variant="outline"
						fullWidth
						isDisabled={pending !== null}
						isPending={pending === false}
						onPress={() => decide(false)}
					>
						Deny
					</Button>
				</div>
			</div>
		</AuthCard>
	);
}
