import { Spinner } from "@fluxify/components";
import { instanceSettingsQuery } from "@/query/instanceSettingsQuery";
import { SsoCard } from "./SsoCard";

export function AuthSettings() {
	const { data, isLoading, isError } = instanceSettingsQuery.auth.useQuery();

	if (isLoading) {
		return (
			<div className="flex justify-center py-16">
				<Spinner />
			</div>
		);
	}
	if (isError || !data) {
		return <p className="py-16 text-center text-muted-foreground">Couldn't load authentication settings.</p>;
	}

	return (
		<div className="flex w-full max-w-3xl mx-auto flex-col gap-6">
			<div>
				<h2 className="text-xl font-bold tracking-tight">Authentication</h2>
				<p className="text-sm text-muted-foreground mt-0.5">
					Choose how users sign in to this instance, fill in the details, then save. Enforcing SSO
					will disable email and password logins for all users.
				</p>
			</div>
			<SsoCard initialType={data.type} initial={data.sso_config} />
		</div>
	);
}
