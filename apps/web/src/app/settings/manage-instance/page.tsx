"use client";

import {
	Accordion,
	Badge,
	Button,
	Card,
	Code,
	Container,
	Divider,
	Group,
	List,
	PasswordInput,
	Select,
	Stack,
	Switch,
	Text,
	Textarea,
	TextInput,
	Title,
} from "@mantine/core";
import { useEffect, useState } from "react";

const API = "/_/admin/api";

type Json = Record<string, unknown>;

async function apiFetch(path: string, init?: RequestInit) {
	const res = await fetch(path, {
		credentials: "include",
		headers: { "Content-Type": "application/json" },
		...init,
	});
	const text = await res.text();
	let body: unknown = text;
	try {
		body = text ? JSON.parse(text) : null;
	} catch {
		/* keep raw text */
	}
	return { ok: res.ok, status: res.status, body };
}

const Page = () => {
	const [publicSettings, setPublicSettings] = useState<Json | null>(null);
	const [result, setResult] = useState<Json | null>(null);

	useEffect(() => {
		void refresh();
	}, []);

	async function refresh() {
		const res = await apiFetch(`${API}/public-settings`);
		setPublicSettings(res.body as Json);
	}

	const sso = (publicSettings?.sso_config as Json | undefined) ?? undefined;
	const authCfg = (publicSettings?.auth_config as Json | undefined) ?? undefined;

	// sso_config fields
	const [enabled, setEnabled] = useState(false);
	const [provider, setProvider] = useState<string>("oidc");
	const [providerId, setProviderId] = useState("enterprise");
	const [issuer, setIssuer] = useState("");
	const [domain, setDomain] = useState("");
	const [clientId, setClientId] = useState("");
	const [clientSecret, setClientSecret] = useState("");
	const [discoveryEndpoint, setDiscoveryEndpoint] = useState("");
	const [scopes, setScopes] = useState("");
	const [entryPoint, setEntryPoint] = useState("");
	const [samlCert, setSamlCert] = useState("");
	const [ssoPublic, setSsoPublic] = useState(true);
	const [savingSso, setSavingSso] = useState(false);

	// auth_config fields
	const [authMode, setAuthMode] = useState("traditional");
	const [authPublic, setAuthPublic] = useState(true);
	const [savingAuth, setSavingAuth] = useState(false);

	// Seed non-secret fields from the public projection whenever it changes.
	// Secrets are never returned, so clientSecret/samlCert stay blank and must
	// be re-entered on each save (the upsert replaces the whole value object).
	useEffect(() => {
		if (!sso) return;
		setEnabled(Boolean(sso.enabled));
		if (sso.provider) setProvider(sso.provider as string);
		if (sso.providerId) setProviderId(sso.providerId as string);
		if (sso.issuer) setIssuer(sso.issuer as string);
		if (sso.domain) setDomain(sso.domain as string);
	}, [JSON.stringify(sso ?? null)]);

	useEffect(() => {
		if (authCfg?.mode) setAuthMode(authCfg.mode as string);
	}, [authCfg?.mode]);

	async function saveSso() {
		setSavingSso(true);
		try {
			const value: Json = {
				provider,
				enabled,
				providerId: providerId.trim() || "enterprise",
				issuer: issuer.trim(),
				domain: domain.trim(),
			};
			if (provider === "oidc") {
				if (clientId.trim()) value.clientId = clientId.trim();
				if (clientSecret) value.clientSecret = clientSecret;
				if (discoveryEndpoint.trim())
					value.discoveryEndpoint = discoveryEndpoint.trim();
				if (scopes.trim())
					value.scopes = scopes.split(",").map((s) => s.trim()).filter(Boolean);
			} else {
				if (entryPoint.trim()) value.entryPoint = entryPoint.trim();
				if (samlCert.trim()) value.samlCert = samlCert.trim();
			}
			const res = await apiFetch(`${API}/v1/instance-settings`, {
				method: "PUT",
				body: JSON.stringify({ key: "sso_config", isPublic: ssoPublic, value }),
			});
			setResult({ save: "sso_config", status: res.status, response: res.body });
			if (res.ok) setClientSecret("");
			await refresh();
		} finally {
			setSavingSso(false);
		}
	}

	async function saveAuth() {
		setSavingAuth(true);
		try {
			const res = await apiFetch(`${API}/v1/instance-settings`, {
				method: "PUT",
				body: JSON.stringify({
					key: "auth_config",
					isPublic: authPublic,
					value: { mode: authMode },
				}),
			});
			setResult({ save: "auth_config", status: res.status, response: res.body });
			await refresh();
		} finally {
			setSavingAuth(false);
		}
	}

	const origin = typeof window !== "undefined" ? window.location.origin : "";
	const oidcRedirect = `${origin}/_/admin/api/auth/sso/callback/${providerId || "enterprise"}`;
	const samlAcs = `${origin}/_/admin/api/auth/sso/saml2/callback/${providerId || "enterprise"}`;

	return (
		<Container size="md" py="xl">
			<Stack gap="lg">
				<div>
					<Title order={2}>Manage instance settings</Title>
					<Text c="dimmed" size="sm">
						Configure enterprise SSO and the platform login mode. Requires a
						system-admin session. Secrets are write-only — re-enter them
						whenever you save SSO config.
					</Text>
				</div>

				<Card withBorder radius="md" padding="lg">
					<Group justify="space-between" mb="xs">
						<Title order={4}>Current status</Title>
						<Button size="xs" variant="light" onClick={refresh}>
							Refresh
						</Button>
					</Group>
					<Group gap="xs">
						<Badge color={sso?.enabled ? "green" : "gray"}>
							SSO {sso?.enabled ? "enabled" : "disabled"}
						</Badge>
						<Badge color="violet" variant="light">
							mode: {(authCfg?.mode as string) ?? "unset"}
						</Badge>
						{sso?.provider ? (
							<Badge variant="outline">{sso.provider as string}</Badge>
						) : null}
					</Group>
				</Card>

				{/* sso_config form */}
				<Card withBorder radius="md" padding="lg">
					<Title order={4} mb="md">
						SSO configuration (sso_config)
					</Title>
					<Stack gap="sm">
						<Switch
							label="Enabled"
							checked={enabled}
							onChange={(e) => setEnabled(e.currentTarget.checked)}
						/>
						<Group grow>
							<Select
								label="Provider"
								data={[
									{ value: "oidc", label: "OIDC" },
									{ value: "saml", label: "SAML" },
								]}
								value={provider}
								onChange={(v) => setProvider(v ?? "oidc")}
								allowDeselect={false}
							/>
							<TextInput
								label="Provider ID"
								value={providerId}
								onChange={(e) => setProviderId(e.currentTarget.value)}
							/>
						</Group>
						<Group grow>
							<TextInput
								label="Issuer URL"
								placeholder="https://your-org.okta.com"
								value={issuer}
								onChange={(e) => setIssuer(e.currentTarget.value)}
							/>
							<TextInput
								label="Email domain"
								placeholder="company.com"
								value={domain}
								onChange={(e) => setDomain(e.currentTarget.value)}
							/>
						</Group>

						{provider === "oidc" ? (
							<>
								<Group grow>
									<TextInput
										label="Client ID"
										value={clientId}
										onChange={(e) => setClientId(e.currentTarget.value)}
									/>
									<PasswordInput
										label="Client Secret"
										placeholder="re-enter to save"
										value={clientSecret}
										onChange={(e) => setClientSecret(e.currentTarget.value)}
									/>
								</Group>
								<Group grow>
									<TextInput
										label="Discovery endpoint (optional)"
										placeholder="defaults to {issuer}/.well-known/openid-configuration"
										value={discoveryEndpoint}
										onChange={(e) => setDiscoveryEndpoint(e.currentTarget.value)}
									/>
									<TextInput
										label="Scopes (optional, comma-separated)"
										placeholder="openid, email, profile"
										value={scopes}
										onChange={(e) => setScopes(e.currentTarget.value)}
									/>
								</Group>
							</>
						) : (
							<>
								<TextInput
									label="Entry point (SSO URL)"
									placeholder="https://idp.company.com/sso/saml"
									value={entryPoint}
									onChange={(e) => setEntryPoint(e.currentTarget.value)}
								/>
								<Textarea
									label="X.509 signing certificate"
									placeholder="-----BEGIN CERTIFICATE-----"
									autosize
									minRows={3}
									value={samlCert}
									onChange={(e) => setSamlCert(e.currentTarget.value)}
								/>
							</>
						)}

						<Switch
							label="Public (exposed via /public-settings, secrets always stripped)"
							checked={ssoPublic}
							onChange={(e) => setSsoPublic(e.currentTarget.checked)}
						/>
						<Group>
							<Button onClick={saveSso} loading={savingSso}>
								Save SSO config
							</Button>
						</Group>
					</Stack>
				</Card>

				{/* auth_config form */}
				<Card withBorder radius="md" padding="lg">
					<Title order={4} mb="md">
						Login mode (auth_config)
					</Title>
					<Stack gap="sm">
						<Group grow align="flex-end">
							<Select
								label="Login mode"
								data={[
									{ value: "traditional", label: "traditional (email + password)" },
									{ value: "sso_only", label: "sso_only (offload to IdP)" },
								]}
								value={authMode}
								onChange={(v) => setAuthMode(v ?? "traditional")}
								allowDeselect={false}
							/>
							<Switch
								label="Public"
								checked={authPublic}
								onChange={(e) => setAuthPublic(e.currentTarget.checked)}
							/>
						</Group>
						<Group>
							<Button onClick={saveAuth} loading={savingAuth} variant="light">
								Save auth mode
							</Button>
						</Group>
					</Stack>
				</Card>

				{result ? (
					<Card withBorder radius="md" padding="lg">
						<Title order={4} mb="xs">
							Last API response
						</Title>
						<Code block>{JSON.stringify(result, null, 2)}</Code>
					</Card>
				) : null}

				<Divider label="Setup instructions" labelPosition="center" />

				<Accordion variant="separated" multiple defaultValue={["idp", "redirect"]}>
					<Accordion.Item value="idp">
						<Accordion.Control>1. In your identity provider (IdP)</Accordion.Control>
						<Accordion.Panel>
							<Text size="sm" mb="xs">
								Create an application in your IdP (Okta, Entra ID / Azure AD,
								Auth0, Keycloak, Google Workspace, etc.). Pick <b>OIDC</b> for the
								simplest setup, or <b>SAML 2.0</b> if your org requires it. You
								will collect:
							</Text>
							<List size="sm" spacing={4}>
								<List.Item>
									<b>Issuer URL</b> — the provider&apos;s base URL. In OIDC it&apos;s
									the value under <Code>issuer</Code> in the provider&apos;s{" "}
									<Code>/.well-known/openid-configuration</Code> document (e.g.
									Okta: <Code>https://your-org.okta.com</Code>; Entra:{" "}
									<Code>https://login.microsoftonline.com/&lt;tenant-id&gt;/v2.0</Code>
									).
								</List.Item>
								<List.Item>
									<b>Client ID</b> &amp; <b>Client Secret</b> — generated when you
									register the app. Found on the app&apos;s &quot;Credentials&quot;
									/ &quot;Certificates &amp; secrets&quot; page. (OIDC)
								</List.Item>
								<List.Item>
									<b>Discovery endpoint</b> — usually{" "}
									<Code>{"{issuer}"}/.well-known/openid-configuration</Code>.
									Fluxify derives this from the issuer if you don&apos;t set it.
									(OIDC)
								</List.Item>
								<List.Item>
									<b>Sign-on URL / SSO URL</b> (=<Code>entryPoint</Code>) and the{" "}
									<b>X.509 signing certificate</b> (=<Code>samlCert</Code>) — from
									the IdP app&apos;s SAML settings / metadata. (SAML)
								</List.Item>
								<List.Item>
									<b>Email domain</b> your users sign in with (e.g.{" "}
									<Code>company.com</Code>). This becomes <Code>domain</Code> and
									gates which accounts an admin may pre-provision.
								</List.Item>
							</List>
						</Accordion.Panel>
					</Accordion.Item>

					<Accordion.Item value="redirect">
						<Accordion.Control>
							2. Redirect / callback URLs to whitelist in the IdP
						</Accordion.Control>
						<Accordion.Panel>
							<Text size="sm" mb="xs">
								Register these exact URLs in the IdP app (Redirect URI for OIDC,
								ACS URL for SAML). <Code>{providerId || "enterprise"}</Code> is
								your provider ID:
							</Text>
							<List size="sm" spacing={4}>
								<List.Item>
									OIDC Redirect URI: <Code>{oidcRedirect}</Code>
								</List.Item>
								<List.Item>
									SAML ACS (Assertion Consumer Service): <Code>{samlAcs}</Code>
								</List.Item>
							</List>
							<Text size="xs" c="dimmed" mt="xs">
								In production, replace the origin with your real domain (the
								value of <Code>SERVER_URL</Code> / your proxy host).
							</Text>
						</Accordion.Panel>
					</Accordion.Item>

					<Accordion.Item value="provision">
						<Accordion.Control>3. Provision users</Accordion.Control>
						<Accordion.Panel>
							<Text size="sm" mb="xs">
								In <b>sso_only</b> mode, creating a user here only registers them
								in the platform (email must match the <Code>sso_config.domain</Code>
								); their Better Auth login account is created automatically the
								first time they sign in through the IdP. In <b>traditional</b>{" "}
								mode, a password is required and the login account is created
								immediately.
							</Text>
							<Code block>{`POST /_/admin/api/auth/create-user
{ "email": "user@company.com", "fullname": "User" }`}</Code>
						</Accordion.Panel>
					</Accordion.Item>
				</Accordion>
			</Stack>
		</Container>
	);
};

export default Page;
