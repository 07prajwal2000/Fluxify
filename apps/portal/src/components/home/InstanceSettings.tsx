import { useState } from "react";
import {
	Button,
	Card,
	Checkbox,
	Input,
	Label,
	Spinner,
	TextField,
	toast,
} from "@fluxify/components";
import { instanceSettingsQuery } from "@/query/instanceSettingsQuery";
import { showErrorNotification } from "@/lib/errorNotifier";

type Dict = Record<string, unknown>;

export function InstanceSettings() {
	const { data, isLoading, isError } = instanceSettingsQuery.getAll.useQuery();

	if (isLoading) {
		return (
			<div className="flex justify-center py-16">
				<Spinner />
			</div>
		);
	}
	if (isError) {
		return <p className="py-16 text-center text-muted">Couldn't load settings.</p>;
	}

	const authConfig = (data?.find((s) => s.key === "auth_config")?.value ?? {}) as Dict;
	const ssoConfig = (data?.find((s) => s.key === "sso_config")?.value ?? {}) as Dict;

	return (
		<div className="flex max-w-2xl flex-col gap-6 pt-4">
			<AuthModeCard initialMode={(authConfig.mode as string) ?? "traditional"} />
			<SsoCard initial={ssoConfig} />
		</div>
	);
}

const MODES = ["traditional", "sso_only"] as const;

function AuthModeCard({ initialMode }: { initialMode: string }) {
	const upsert = instanceSettingsQuery.upsert.mutation();
	const [mode, setMode] = useState(initialMode);

	function save() {
		upsert.mutate(
			{ key: "auth_config", value: { mode }, category: "auth" },
			{
				onSuccess: () => toast.success("Auth mode saved"),
				onError: (e) => showErrorNotification(e as Error),
			},
		);
	}

	return (
		<Card>
			<Card.Header>
				<Card.Title>Authentication mode</Card.Title>
				<Card.Description>How users sign in to this instance.</Card.Description>
			</Card.Header>
			<Card.Content>
				<div className="flex gap-1.5">
					{MODES.map((m) => (
						<Button
							key={m}
							type="button"
							variant={mode === m ? "primary" : "outline"}
							onPress={() => setMode(m)}
						>
							{m === "sso_only" ? "SSO only" : "Traditional"}
						</Button>
					))}
				</div>
			</Card.Content>
			<Card.Footer>
				<Button variant="primary" isPending={upsert.isPending} onPress={save}>
					Save
				</Button>
			</Card.Footer>
		</Card>
	);
}

const PROVIDERS = ["oidc", "saml"] as const;

function SsoCard({ initial }: { initial: Dict }) {
	const upsert = instanceSettingsQuery.upsert.mutation();
	const [enabled, setEnabled] = useState(Boolean(initial.enabled));
	const [provider, setProvider] = useState<(typeof PROVIDERS)[number]>(
		(initial.provider as "oidc" | "saml") ?? "oidc",
	);
	const [issuer, setIssuer] = useState((initial.issuer as string) ?? "");
	const [domain, setDomain] = useState((initial.domain as string) ?? "");
	const [clientId, setClientId] = useState((initial.clientId as string) ?? "");
	const [clientSecret, setClientSecret] = useState("");
	const [entryPoint, setEntryPoint] = useState((initial.entryPoint as string) ?? "");
	const [samlCert, setSamlCert] = useState("");

	function save(e: React.FormEvent) {
		e.preventDefault();
		const value: Dict = {
			provider,
			enabled,
			providerId: (initial.providerId as string) ?? "enterprise",
			issuer,
			domain,
		};
		if (provider === "oidc") {
			value.clientId = clientId;
			// secrets are write-only; only send when the admin entered a new one
			if (clientSecret) value.clientSecret = clientSecret;
		} else {
			value.entryPoint = entryPoint;
			if (samlCert) value.samlCert = samlCert;
		}
		upsert.mutate(
			{ key: "sso_config", value, category: "auth", isPublic: false },
			{
				onSuccess: () => toast.success("SSO settings saved"),
				onError: (err) => showErrorNotification(err as Error),
			},
		);
	}

	return (
		<Card>
			<Card.Header>
				<Card.Title>Single sign-on</Card.Title>
				<Card.Description>
					Connect an identity provider. Secrets are write-only and never shown.
				</Card.Description>
			</Card.Header>
			<form onSubmit={save}>
				<Card.Content>
					<div className="flex flex-col gap-4">
						<Checkbox isSelected={enabled} onChange={setEnabled}>
							Enable SSO
						</Checkbox>

						<div className="flex flex-col gap-1.5">
							<Label>Provider</Label>
							<div className="flex gap-1.5">
								{PROVIDERS.map((p) => (
									<Button
										key={p}
										type="button"
										variant={provider === p ? "primary" : "outline"}
										onPress={() => setProvider(p)}
									>
										{p.toUpperCase()}
									</Button>
								))}
							</div>
						</div>

						<TextField value={issuer} onChange={setIssuer}>
							<Label>Issuer URL</Label>
							<Input placeholder="https://idp.company.com" />
						</TextField>
						<TextField value={domain} onChange={setDomain}>
							<Label>Email domain</Label>
							<Input placeholder="company.com" />
						</TextField>

						{provider === "oidc" ? (
							<>
								<TextField value={clientId} onChange={setClientId}>
									<Label>Client ID</Label>
									<Input placeholder="Client ID" />
								</TextField>
								<TextField type="password" value={clientSecret} onChange={setClientSecret}>
									<Label>Client secret</Label>
									<Input placeholder="Leave blank to keep current" />
								</TextField>
							</>
						) : (
							<>
								<TextField value={entryPoint} onChange={setEntryPoint}>
									<Label>Entry point URL</Label>
									<Input placeholder="https://idp.company.com/saml" />
								</TextField>
								<TextField type="password" value={samlCert} onChange={setSamlCert}>
									<Label>Signing certificate</Label>
									<Input placeholder="Leave blank to keep current" />
								</TextField>
							</>
						)}
					</div>
				</Card.Content>
				<Card.Footer>
					<Button type="submit" variant="primary" isPending={upsert.isPending}>
						Save SSO settings
					</Button>
				</Card.Footer>
			</form>
		</Card>
	);
}
