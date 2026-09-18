import { useEffect, useState } from "react";
import { Button, Input, Label, TextField, toast } from "@fluxify/components";
import { useQueryClient } from "@tanstack/react-query";
import { instanceSettingsQuery } from "@/query/instanceSettingsQuery";
import { publicSettingsQuery } from "@/query/publicSettingsQuery";
import { showErrorNotification } from "@/lib/errorNotifier";

export const DEFAULT_BASE_DOMAIN = "localhost";

/**
 * The domain every project's API is served under. Projects with a subdomain
 * answer on `<subdomain>.<domain>`; the rest share the domain itself.
 *
 * Saved through the instance-settings endpoint, which pushes it to every worker
 * and to the edge, so no restart is involved.
 */
export function HostingSettings() {
	const client = useQueryClient();
	const { data: publicSettings } = publicSettingsQuery.get.useQuery();
	// empty is a local install: served on localhost, portal trusted on localhost and 127.0.0.1
	const current = publicSettings?.hosting?.baseDomain ?? "";
	const upsert = instanceSettingsQuery.upsert.mutation();
	const [domain, setDomain] = useState(current);

	useEffect(() => setDomain(current), [current]);

	function save() {
		upsert.mutate(
			{ key: "hosting", category: "hosting", value: { baseDomain: domain.trim().toLowerCase() } },
			{
				onSuccess: () => {
					client.invalidateQueries({ queryKey: ["public-settings"] });
					toast.success("Hosting saved");
				},
				onError: (error) => showErrorNotification(error as Error),
			},
		);
	}

	return (
		<div className="flex flex-col gap-6">
			<div>
				<h2 className="text-xl font-semibold tracking-tight text-foreground">Hosting</h2>
				<p className="text-sm text-muted">Where your projects' APIs are reached.</p>
			</div>

			<section className="flex flex-col gap-4 rounded-xl border border-border bg-background p-5">
				<TextField value={domain} onChange={setDomain} className="max-w-md">
					<Label>Base domain</Label>
					<Input placeholder={`example.com — empty uses ${DEFAULT_BASE_DOMAIN}`} />
				</TextField>
				<p className="text-xs text-muted">
					A project with the subdomain <code>shop</code> is served on{" "}
					<code>shop.{domain || DEFAULT_BASE_DOMAIN}</code>. Projects without one share{" "}
					<code>{domain || DEFAULT_BASE_DOMAIN}</code>, where two projects using the same path clash.
					Point a wildcard DNS record (<code>*.{domain || DEFAULT_BASE_DOMAIN}</code>) at this server.
				</p>
				{domain !== current && (
					<p className="text-xs text-warning">
						Every project with a subdomain moves to the new domain. Nodes serving a single project
						are replaced, so they drop traffic for a moment.
					</p>
				)}
				<div>
					<Button
						variant="primary"
						isPending={upsert.isPending}
						isDisabled={domain.trim() === current}
						onPress={save}
					>
						Save
					</Button>
				</div>
			</section>
		</div>
	);
}
