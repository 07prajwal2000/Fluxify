"use client";

import {
	Accordion,
	Alert,
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

// The web app is served under /_/admin/ui behind the same proxy origin as the
// API, so relative same-origin fetches carry the session cookie automatically.
const API = "/_/admin/api";
const AUTH = `${API}/auth`;

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

export default function SsoTestPage() {
	const [publicSettings, setPublicSettings] = useState<Json | null>(null);
	const [session, setSession] = useState<Json | null>(null);
	const [providerId, setProviderId] = useState("enterprise");
	const [email, setEmail] = useState("");
	const [callbackURL, setCallbackURL] = useState("");
	const [result, setResult] = useState<Json | null>(null);
	const [busy, setBusy] = useState(false);

	// Load public settings + current session on mount.
	useEffect(() => {
		setCallbackURL(`${window.location.origin}/_/admin/ui/sso-test`);
		void refresh();
	}, []);

	async function refresh() {
		const [pub, sess] = await Promise.all([
			apiFetch(`${API}/public-settings`),
			apiFetch(`${AUTH}/get-session`),
		]);
		setPublicSettings(pub.body as Json);
		setSession((sess.body as Json) ?? null);
	}

	const sso = (publicSettings?.sso_config as Json | undefined) ?? undefined;
	const authCfg = (publicSettings?.auth_config as Json | undefined) ?? undefined;

	async function handleLogin() {
		setBusy(true);
		setResult(null);
		try {
			const payload: Json = { callbackURL, errorCallbackURL: callbackURL };
			if (providerId.trim()) payload.providerId = providerId.trim();
			if (email.trim()) payload.email = email.trim();

			const res = await apiFetch(`${AUTH}/sign-in/sso`, {
				method: "POST",
				body: JSON.stringify(payload),
			});
			setResult({ request: payload, status: res.status, response: res.body });

			// On success Better Auth returns a redirect URL to the IdP.
			const url = (res.body as Json | null)?.url as string | undefined;
			if (res.ok && url) {
				window.location.href = url;
			}
		} finally {
			setBusy(false);
		}
	}

	async function handleSignOut() {
		setBusy(true);
		const res = await apiFetch(`${AUTH}/sign-out`, { method: "POST", body: "{}" });
		setResult({ signOut: res.status, response: res.body });
		await refresh();
		setBusy(false);
	}

	const user = (session?.user as Json | undefined) ?? undefined;

	return (
		<Container size="md" py="xl">
			<Stack gap="lg">
				<div>
					<Title order={2}>SSO Test Console</Title>
					<Text c="dimmed" size="sm">
						Unauthenticated page to exercise the enterprise SSO login flow and
						inspect the raw API responses.
					</Text>
				</div>

				{/* Current instance config (public, secrets stripped server-side) */}
				<Card withBorder radius="md" padding="lg">
					<Group justify="space-between" mb="xs">
						<Title order={4}>Instance configuration</Title>
						<Button size="xs" variant="light" onClick={refresh}>
							Refresh
						</Button>
					</Group>
					<Group gap="xs" mb="sm">
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
					{sso ? (
						<List size="sm" spacing={2}>
							<List.Item>
								Provider ID: <Code>{(sso.providerId as string) ?? "—"}</Code>
							</List.Item>
							<List.Item>
								Issuer: <Code>{(sso.issuer as string) ?? "—"}</Code>
							</List.Item>
							<List.Item>
								Domain: <Code>{(sso.domain as string) ?? "—"}</Code>
							</List.Item>
						</List>
					) : (
						<Alert color="yellow">
							No public <Code>sso_config</Code> found. Configure it via{" "}
							<Code>PUT /_/admin/api/v1/instance-settings</Code> and set{" "}
							<Code>isPublic: true</Code>.
						</Alert>
					)}
				</Card>

				{/* Session panel */}
				<Card withBorder radius="md" padding="lg">
					<Title order={4} mb="xs">
						Current session
					</Title>
					{user ? (
						<Group justify="space-between">
							<Stack gap={0}>
								<Text fw={600}>{(user.email as string) ?? "(no email)"}</Text>
								<Text size="xs" c="dimmed">
									id: {(user.id as string) ?? "—"}
								</Text>
							</Stack>
							<Button color="red" variant="light" onClick={handleSignOut} loading={busy}>
								Sign out
							</Button>
						</Group>
					) : (
						<Text c="dimmed" size="sm">
							Not signed in.
						</Text>
					)}
				</Card>

				{/* SSO login form */}
				<Card withBorder radius="md" padding="lg">
					<Title order={4} mb="md">
						Start SSO login
					</Title>
					<Stack gap="sm">
						<TextInput
							label="Provider ID"
							description="The providerId configured in sso_config (defaultSSO). Leave email blank to use this."
							value={providerId}
							onChange={(e) => setProviderId(e.currentTarget.value)}
							placeholder="enterprise"
						/>
						<TextInput
							label="Email (optional)"
							description="Alternatively identify the provider by the user's email domain."
							value={email}
							onChange={(e) => setEmail(e.currentTarget.value)}
							placeholder="user@company.com"
						/>
						<TextInput
							label="Callback URL"
							description="Where the browser returns after the IdP round-trip."
							value={callbackURL}
							onChange={(e) => setCallbackURL(e.currentTarget.value)}
						/>
						<Group>
							<Button onClick={handleLogin} loading={busy} disabled={!sso?.enabled}>
								Login with SSO
							</Button>
							{!sso?.enabled ? (
								<Text size="xs" c="dimmed">
									Enable SSO in instance settings to test.
								</Text>
							) : null}
						</Group>
					</Stack>
				</Card>

				{/* Instance settings forms (system-admin only) */}
				<SettingsForms
					sso={sso}
					mode={(authCfg?.mode as string) ?? ""}
					onResult={(r) => {
						setResult(r);
						void refresh();
					}}
				/>

				{/* Raw API result */}
				{result ? (
					<Card withBorder radius="md" padding="lg">
						<Title order={4} mb="xs">
							Last API response
						</Title>
						<Code block>{JSON.stringify(result, null, 2)}</Code>
					</Card>
				) : null}

				<Divider label="Setup instructions" labelPosition="center" />
				<SetupInstructions providerId={providerId || "enterprise"} />
			</Stack>
		</Container>
	);
}

function SettingsForms({
	sso,
	mode,
	onResult,
}: {
	sso: Json | undefined;
	mode: string;
	onResult: (r: Json) => void;
}) {
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
	const [authMode, setAuthMode] = useState(mode || "traditional");
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
		if (mode) setAuthMode(mode);
	}, [mode]);

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
			onResult({ save: "sso_config", status: res.status, response: res.body });
			if (res.ok) setClientSecret("");
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
			onResult({ save: "auth_config", status: res.status, response: res.body });
		} finally {
			setSavingAuth(false);
		}
	}

	return (
		<Card withBorder radius="md" padding="lg">
			<Title order={4} mb={4}>
				Manage instance settings
			</Title>
			<Text size="xs" c="dimmed" mb="md">
				Requires a system-admin session. Secrets are write-only — re-enter them
				whenever you save SSO config.
			</Text>

			<Stack gap="sm">
				<Text fw={600} size="sm">
					sso_config
				</Text>
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

				<Divider my="xs" />

				<Text fw={600} size="sm">
					auth_config
				</Text>
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
	);
}

function SetupInstructions({ providerId }: { providerId: string }) {
	const origin = typeof window !== "undefined" ? window.location.origin : "";
	const oidcRedirect = `${origin}/_/admin/api/auth/sso/callback/${providerId}`;
	const samlAcs = `${origin}/_/admin/api/auth/sso/saml2/callback/${providerId}`;

	return (
		<Accordion variant="separated" multiple defaultValue={["idp", "redirect"]}>
			<Accordion.Item value="idp">
				<Accordion.Control>1. In your identity provider (IdP)</Accordion.Control>
				<Accordion.Panel>
					<Text size="sm" mb="xs">
						Create an application in your IdP (Okta, Entra ID / Azure AD, Auth0,
						Keycloak, Google Workspace, etc.). Pick <b>OIDC</b> for the simplest
						setup, or <b>SAML 2.0</b> if your org requires it. You will collect:
					</Text>
					<List size="sm" spacing={4}>
						<List.Item>
							<b>Issuer URL</b> — the provider&apos;s base URL. In OIDC it&apos;s the
							value under <Code>issuer</Code> in the provider&apos;s{" "}
							<Code>/.well-known/openid-configuration</Code> document (e.g. Okta:{" "}
							<Code>https://your-org.okta.com</Code>; Entra:{" "}
							<Code>https://login.microsoftonline.com/&lt;tenant-id&gt;/v2.0</Code>).
						</List.Item>
						<List.Item>
							<b>Client ID</b> &amp; <b>Client Secret</b> — generated when you
							register the app. Found on the app&apos;s &quot;Credentials&quot; /
							&quot;Certificates &amp; secrets&quot; page. (OIDC)
						</List.Item>
						<List.Item>
							<b>Discovery endpoint</b> — usually{" "}
							<Code>{"{issuer}"}/.well-known/openid-configuration</Code>. Fluxify
							derives this from the issuer if you don&apos;t set it. (OIDC)
						</List.Item>
						<List.Item>
							<b>Sign-on URL / SSO URL</b> (=<Code>entryPoint</Code>) and the{" "}
							<b>X.509 signing certificate</b> (=<Code>samlCert</Code>) — from the
							IdP app&apos;s SAML settings / metadata. (SAML)
						</List.Item>
						<List.Item>
							<b>Email domain</b> your users sign in with (e.g.{" "}
							<Code>company.com</Code>). This becomes <Code>domain</Code> and gates
							which accounts an admin may pre-provision.
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
						Register these exact URLs in the IdP app (Redirect URI for OIDC, ACS
						URL for SAML). <Code>{providerId}</Code> is your provider ID:
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
						In production, replace the origin with your real domain (the value of{" "}
						<Code>SERVER_URL</Code> / your proxy host).
					</Text>
				</Accordion.Panel>
			</Accordion.Item>

			<Accordion.Item value="fluxify">
				<Accordion.Control>3. On the Fluxify server</Accordion.Control>
				<Accordion.Panel>
					<Text size="sm" mb="xs">
						Save the IdP values as instance settings (system-admin only). Secrets
						are write-only — reads mask them.
					</Text>
					<Code block>{`# OIDC example
PUT /_/admin/api/v1/instance-settings
{
  "key": "sso_config",
  "isPublic": true,
  "value": {
    "provider": "oidc",
    "enabled": true,
    "providerId": "${providerId}",
    "issuer": "https://your-org.okta.com",
    "domain": "company.com",
    "clientId": "<from IdP>",
    "clientSecret": "<from IdP>"
  }
}

# Switch the login mode
PUT /_/admin/api/v1/instance-settings
{
  "key": "auth_config",
  "isPublic": true,
  "value": { "mode": "sso_only" }
}`}</Code>
					<Text size="xs" c="dimmed" mt="xs">
						Also ensure <Code>TRUSTED_ORIGINS</Code> includes this origin so CORS
						and Better Auth accept the redirect.
					</Text>
				</Accordion.Panel>
			</Accordion.Item>

			<Accordion.Item value="provision">
				<Accordion.Control>4. Pre-provision users (no JIT)</Accordion.Control>
				<Accordion.Panel>
					<Text size="sm" mb="xs">
						SSO login only succeeds for accounts that already exist — there is no
						just-in-time signup. Create each user first (their email domain must
						match <Code>sso_config.domain</Code>):
					</Text>
					<Code block>{`POST /_/admin/api/auth/create-user
{ "email": "user@company.com", "fullname": "User" }`}</Code>
					<Text size="xs" c="dimmed" mt="xs">
						Signing in with an email that was never provisioned returns{" "}
						<Code>ACCOUNT_NOT_PRE_PROVISIONED</Code>.
					</Text>
				</Accordion.Panel>
			</Accordion.Item>
		</Accordion>
	);
}
