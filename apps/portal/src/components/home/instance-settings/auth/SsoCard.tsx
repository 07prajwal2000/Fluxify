import { useState } from "react";
import { Button, CloseButton, Input, Modal, Tabs, toast, cn } from "@fluxify/components";
import { instanceSettingsQuery } from "@/query/instanceSettingsQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import {
	FiBookOpen,
	FiCheck,
	FiCopy,
	FiGlobe,
	FiAtSign,
	FiKey,
	FiLock,
	FiShield,
} from "react-icons/fi";
import { BiFingerprint } from "react-icons/bi";
import { AuthModeCard, type AuthType } from "./AuthModeCard";

type Dict = Record<string, unknown>;

const PROVIDERS = ["oidc", "saml"] as const;
type GuideProtocol = (typeof PROVIDERS)[number];

function CopyCodeBlock({
	label,
	value,
	description,
	copied,
	onCopy,
}: {
	label: string;
	value: string;
	description: string;
	copied: boolean;
	onCopy: () => void;
}) {
	return (
		<div className="rounded-lg border border-border bg-background p-3">
			<div className="mb-2 flex items-start justify-between gap-3">
				<div>
					<p className="text-xs font-semibold text-foreground">{label}</p>
					<p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
				</div>
				<Button
					type="button"
					isIconOnly
					size="sm"
					variant="ghost"
					onPress={onCopy}
					aria-label={`Copy ${label}`}
				>
					{copied ? <FiCheck className="text-success" /> : <FiCopy />}
				</Button>
			</div>
			<code className="block break-all rounded-md border border-border bg-background px-2.5 py-2 font-mono text-xs text-foreground">
				{value}
			</code>
		</div>
	);
}

// Only the keys the user actually touched go in the patch — the server
// merges them into whatever's already stored, so untouched fields survive.
function buildSsoPatch(current: Dict, initial: Dict): Dict {
	const patch: Dict = {};
	for (const key of Object.keys(current)) {
		const value = current[key];
		if (value === "" || value === (initial[key] ?? "")) continue;
		patch[key] = value;
	}
	return patch;
}

export function SsoCard({ initialType, initial }: { initialType: AuthType; initial: Dict }) {
	const patchAuth = instanceSettingsQuery.auth.mutation();
	const [isGuideOpen, setIsGuideOpen] = useState(false);
	const [guideProtocol, setGuideProtocol] = useState<GuideProtocol>("oidc");
	const [copiedGuideValue, setCopiedGuideValue] = useState<string | null>(null);
	const [type, setType] = useState<AuthType>(initialType);
	const [provider, setProvider] = useState<(typeof PROVIDERS)[number]>(
		(initial.provider as "oidc" | "saml") ?? "oidc",
	);
	const [issuer, setIssuer] = useState((initial.issuer as string) ?? "");
	const [domain, setDomain] = useState((initial.domain as string) ?? "");
	const [clientId, setClientId] = useState((initial.clientId as string) ?? "");
	const [clientSecret, setClientSecret] = useState("");
	const [entryPoint, setEntryPoint] = useState((initial.entryPoint as string) ?? "");
	const [samlCert, setSamlCert] = useState("");
	const authBaseUrl = `${window.location.origin}/_/admin/api/auth`;
	const providerId = (initial.providerId as string) ?? "enterprise";
	const oidcCallbackUrl = `${authBaseUrl}/sso/callback/${providerId}`;
	const samlAcsUrl = `${authBaseUrl}/sso/saml2/callback/${providerId}`;

	function openGuide() {
		setGuideProtocol(provider);
		setIsGuideOpen(true);
	}

	async function copyGuideValue(label: string, value: string) {
		try {
			await navigator.clipboard.writeText(value);
			setCopiedGuideValue(label);
			toast.success(`${label} copied`);
			window.setTimeout(() => setCopiedGuideValue(null), 2000);
		} catch {
			toast.danger("Could not copy to the clipboard");
		}
	}

	function save(e: React.FormEvent) {
		e.preventDefault();

		const sso_config =
			type === "sso"
				? buildSsoPatch(
						provider === "oidc"
							? { provider, issuer, domain, clientId, clientSecret }
							: { provider, issuer, domain, entryPoint, samlCert },
						initial,
					)
				: undefined;

		patchAuth.mutate(
			{ type, ...(sso_config && Object.keys(sso_config).length > 0 ? { sso_config } : {}) },
			{
				onSuccess: () => {
					toast.success("Authentication settings saved");
					setClientSecret("");
					setSamlCert("");
				},
				onError: (err) => showErrorNotification(err as Error),
			},
		);
	}

	return (
		<form onSubmit={save} className="flex flex-col gap-6">
			<AuthModeCard type={type} onChange={setType} />

			{type === "sso" && (
				<div className="flex flex-col rounded-[12px] border border-border bg-background p-5 shadow-sm">
					<div className="flex flex-col gap-6">
						{/* Header Section */}
						<div className="flex items-center justify-between gap-4 pb-4 border-b border-border/50">
							<div className="flex items-center gap-3">
							<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/30 text-muted-foreground border border-border">
								<BiFingerprint className="h-5 w-5" />
							</div>
							<div>
								<h3 className="text-base font-bold text-foreground">Single Sign-On</h3>
								<p className="text-xs text-muted-foreground">Connect an IdP via OIDC or SAML</p>
							</div>
							</div>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onPress={openGuide}
							>
								<FiBookOpen className="h-4 w-4" />
								Configuration Guide
							</Button>
						</div>

						{/* Provider Toggle */}
						<div className="flex items-center justify-between">
							<label className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
								Provider
							</label>
							<div className="flex items-center rounded-md border border-border bg-accent/20 p-1">
								<button
									type="button"
									onClick={() => setProvider("oidc")}
									className={cn(
										"flex items-center gap-2 rounded-sm px-3 py-1 text-sm font-medium transition-colors",
										provider === "oidc"
											? "bg-accent text-accent-foreground shadow-sm border border-border/50"
											: "text-muted hover:text-foreground"
									)}
								>
									<FiKey className="h-4 w-4" />
									OIDC
								</button>
								<button
									type="button"
									onClick={() => setProvider("saml")}
									className={cn(
										"flex items-center gap-2 rounded-sm px-3 py-1 text-sm font-medium transition-colors",
										provider === "saml"
											? "bg-accent text-accent-foreground shadow-sm border border-border/50"
											: "text-muted hover:text-foreground"
									)}
								>
									<FiShield className="h-4 w-4" />
									SAML
								</button>
							</div>
						</div>

						{/* Shared Fields */}
						<div className="grid grid-cols-2 gap-5">
							<div className="flex flex-col gap-1.5">
								<label className="text-[10px] font-bold tracking-widest text-muted uppercase">
									Issuer URL
								</label>
								<div className="relative flex items-center">
									<FiGlobe className="absolute left-2.5 text-muted h-3.5 w-3.5" />
									<Input
										value={issuer}
										onChange={(e: React.ChangeEvent<HTMLInputElement>) => setIssuer(e.target.value)}
										placeholder="https://idp.company.com"
										className="pl-8 font-mono text-xs w-full"
									/>
								</div>
							</div>
							<div className="flex flex-col gap-1.5">
								<label className="text-[10px] font-bold tracking-widest text-muted uppercase">
									Email Domain
								</label>
								<div className="relative flex items-center">
									<FiAtSign className="absolute left-2.5 text-muted h-3.5 w-3.5" />
									<Input
										value={domain}
										onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDomain(e.target.value)}
										placeholder="company.com"
										className="pl-8 font-mono text-xs w-full"
									/>
								</div>
							</div>
						</div>

						{/* OIDC Specific Fields */}
						{provider === "oidc" && (
							<div className="grid grid-cols-2 gap-5">
								<div className="flex flex-col gap-1.5">
									<label className="text-[10px] font-bold tracking-widest text-muted uppercase">
										Client ID
									</label>
									<Input
										value={clientId}
										onChange={(e: React.ChangeEvent<HTMLInputElement>) => setClientId(e.target.value)}
										placeholder="fluxify_prod_9x8a7s6d5f"
										className="font-mono text-xs w-full"
									/>
								</div>
								<div className="flex flex-col gap-1.5">
									<div className="flex items-center gap-2">
										<label className="text-[10px] font-bold tracking-widest text-muted uppercase">
											Client Secret
										</label>
										<span className="rounded-full border border-accent/30 bg-accent/10 px-1.5 py-0 text-[9px] font-medium text-accent">
											Set • Write-only
										</span>
									</div>
									<div className="relative flex items-center">
										<FiLock className="absolute left-2.5 text-muted h-3.5 w-3.5" />
										<Input
											type="password"
											value={clientSecret}
											onChange={(e: React.ChangeEvent<HTMLInputElement>) => setClientSecret(e.target.value)}
											placeholder="Re-enter to rotate ••••••"
											className="pl-8 font-mono text-xs w-full placeholder:text-muted/50"
										/>
									</div>
									<p className="text-[10px] text-muted mt-0.5">
										Leave blank to keep existing secret.
									</p>
								</div>
							</div>
						)}

						{/* SAML Specific Fields */}
						{provider === "saml" && (
							<div className="flex flex-col gap-5">
								<div className="flex flex-col gap-1.5">
									<label className="text-[10px] font-bold tracking-widest text-muted uppercase">
										Entry Point URL
									</label>
									<Input
										value={entryPoint}
										onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEntryPoint(e.target.value)}
										placeholder="https://idp.company.com/sso/saml"
										className="font-mono text-xs w-full"
									/>
								</div>
								<div className="flex flex-col gap-1.5">
									<div className="flex items-center gap-2">
										<label className="text-[10px] font-bold tracking-widest text-muted uppercase">
											SAML Certificate
										</label>
										<span className="rounded-full border border-accent/30 bg-accent/10 px-1.5 py-0 text-[9px] font-medium text-accent">
											Set • Write-only
										</span>
									</div>
									<textarea
										value={samlCert}
										onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setSamlCert(e.target.value)}
										placeholder="Re-enter to rotate — BEGIN CERTIFICATE"
										className="flex min-h-[100px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs shadow-sm placeholder:text-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 font-mono placeholder:text-muted/50"
									/>
								</div>
							</div>
						)}
					</div>

					<Modal isOpen={isGuideOpen} onOpenChange={setIsGuideOpen}>
						<Modal.Backdrop>
							<Modal.Container placement="center" scroll="inside" size="lg">
								<Modal.Dialog className="w-full !max-w-5xl max-h-[85vh]">
									<Modal.Header className="flex flex-row items-start justify-between">
										<div>
											<Modal.Heading>Configuration Guide</Modal.Heading>
											<p className="mt-1 text-sm text-muted">
												Use these values when creating an application in your identity provider.
											</p>
										</div>
										<CloseButton />
									</Modal.Header>
									<Modal.Body>
										<Tabs
											selectedKey={guideProtocol}
											onSelectionChange={(key) => setGuideProtocol(key as GuideProtocol)}
										>
											<Tabs.ListContainer>
												<Tabs.List aria-label="SSO configuration protocol" className="w-full">
													<Tabs.Tab id="oidc">
														<FiKey className="h-4 w-4" /> OIDC / SSO
														<Tabs.Indicator />
													</Tabs.Tab>
													<Tabs.Tab id="saml">
														<FiShield className="h-4 w-4" /> SAML
														<Tabs.Indicator />
													</Tabs.Tab>
												</Tabs.List>
											</Tabs.ListContainer>

											<Tabs.Panel id="oidc" className="pt-5">
												<div className="flex flex-col gap-5">
													<div className="rounded-lg border border-border border-l-2 border-l-accent bg-background p-4">
														<h4 className="font-semibold text-foreground">1. Create an OIDC application</h4>
														<p className="mt-1 text-sm text-muted">Choose a web application in your IdP and enable the <code className="rounded bg-background px-1 py-0.5 text-xs text-foreground">openid</code>, <code className="rounded bg-background px-1 py-0.5 text-xs text-foreground">profile</code>, and <code className="rounded bg-background px-1 py-0.5 text-xs text-foreground">email</code> scopes.</p>
													</div>
													<div className="grid gap-3 md:grid-cols-2">
														<CopyCodeBlock label="Redirect URI" description="Paste into your IdP callback or redirect URI field." value={oidcCallbackUrl} copied={copiedGuideValue === "OIDC redirect URI"} onCopy={() => copyGuideValue("OIDC redirect URI", oidcCallbackUrl)} />
														<CopyCodeBlock label="Required scopes" description="Enable these so Fluxify receives the user email." value="openid profile email" copied={copiedGuideValue === "OIDC scopes"} onCopy={() => copyGuideValue("OIDC scopes", "openid profile email")} />
													</div>
													<div className="grid gap-3 md:grid-cols-2">
														<div className="rounded-lg border border-border p-4"><h4 className="font-semibold text-foreground">2. Copy IdP credentials</h4><p className="mt-1 text-sm text-muted">Put the IdP issuer in <span className="font-medium text-foreground">Issuer URL</span>, then enter its client ID and client secret in Fluxify.</p></div>
														<div className="rounded-lg border border-border p-4"><h4 className="font-semibold text-foreground">3. Limit access</h4><p className="mt-1 text-sm text-muted">Enter your organisation email domain, save, then test with a pre-provisioned Fluxify user.</p></div>
													</div>
												</div>
											</Tabs.Panel>

											<Tabs.Panel id="saml" className="pt-5">
												<div className="flex flex-col gap-5">
													<div className="rounded-lg border border-border border-l-2 border-l-accent bg-background p-4">
														<h4 className="font-semibold text-foreground">1. Create a SAML application</h4>
														<p className="mt-1 text-sm text-muted">Create the application manually in your IdP, then use the ACS or Reply URL below.</p>
													</div>
													<div className="max-w-xl">
														<CopyCodeBlock label="ACS / Reply URL" description="Use this in the ACS or reply URL field for manual setup." value={samlAcsUrl} copied={copiedGuideValue === "SAML ACS URL"} onCopy={() => copyGuideValue("SAML ACS URL", samlAcsUrl)} />
													</div>
													<div className="grid gap-3 md:grid-cols-2">
														<div className="rounded-lg border border-border p-4"><h4 className="font-semibold text-foreground">2. Copy IdP details</h4><p className="mt-1 text-sm text-muted">Put the IdP entity ID in <span className="font-medium text-foreground">Issuer URL</span>, its SSO login URL in <span className="font-medium text-foreground">Entry Point URL</span>, and its signing certificate in <span className="font-medium text-foreground">SAML Certificate</span>.</p></div>
														<div className="rounded-lg border border-border p-4"><h4 className="font-semibold text-foreground">3. Send email and test</h4><p className="mt-1 text-sm text-muted">Map the user email in the SAML assertion, enter your organisation email domain, and test with a pre-provisioned user.</p></div>
													</div>
												</div>
											</Tabs.Panel>
										</Tabs>
									</Modal.Body>
									<Modal.Footer>
										<Button variant="primary" onPress={() => setIsGuideOpen(false)}>
											Done
										</Button>
									</Modal.Footer>
								</Modal.Dialog>
							</Modal.Container>
						</Modal.Backdrop>
					</Modal>
				</div>
			)}

			<div className="pt-2 flex justify-end">
				<Button
					type="submit"
					variant="primary"
					isPending={patchAuth.isPending}
					className="text-xs h-8 px-4 font-semibold"
				>
					Save changes
				</Button>
			</div>
		</form>
	);
}
