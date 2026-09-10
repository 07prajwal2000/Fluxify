import { useState } from "react";
import { Button, Checkbox, cn, toast } from "@fluxify/components";
import { TbHeart, TbKey, TbUsers } from "react-icons/tb";
import { instanceSettingsQuery } from "@/query/instanceSettingsQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import type { LicenseView, SetLicenseBody } from "@/services/instanceSettings";

type Edition = LicenseView["edition"];

const LICENSING_DOCS = "https://docs.fluxify.rest/deployments/licensing.html";

const OPTIONS: { id: Edition; label: string; hint: string; icon: typeof TbKey }[] = [
	{
		id: "community",
		label: "Community",
		hint: "Free for any use, including commercial. No external connectors.",
		icon: TbUsers,
	},
	{
		id: "non_commercial",
		label: "Non-commercial",
		hint: "Every Enterprise feature, free for personal, education and non-profit use.",
		icon: TbHeart,
	},
	{ id: "enterprise", label: "Enterprise", hint: "Activate a license key you were issued.", icon: TbKey },
];

/** Switches the edition. Read-only while LICENSE_KEY is set in the environment. */
export function EditionForm({ view }: { view: LicenseView }) {
	const readOnly = view.source === "env";
	const [edition, setEdition] = useState<Edition>(view.edition);
	const [confirmed, setConfirmed] = useState(false);
	const [key, setKey] = useState("");
	const setLicense = instanceSettingsQuery.license.mutation();

	const body: SetLicenseBody | null =
		edition === "community"
			? { edition }
			: edition === "non_commercial"
				? confirmed
					? { edition, confirmNonCommercial: true }
					: null
				: key.trim()
					? { edition, key: key.trim() }
					: null;

	function save(e: React.FormEvent) {
		e.preventDefault();
		if (!body) return;
		setLicense.mutate(body, {
			onSuccess: () => {
				toast.success("License updated");
				setKey("");
				setConfirmed(false);
			},
			onError: (err) => showErrorNotification(err as Error),
		});
	}

	return (
		<form onSubmit={save} className="flex flex-col gap-4">
			<h3 className="text-sm font-semibold text-foreground">Change edition</h3>
			<fieldset disabled={readOnly} className="grid gap-2.5 sm:grid-cols-3">
				{OPTIONS.map(({ id, label, hint, icon: Icon }) => (
					<button
						key={id}
						type="button"
						onClick={() => setEdition(id)}
						aria-pressed={edition === id}
						className={cn(
							"flex flex-col gap-2 rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
							edition === id
								? "border-accent bg-accent/10"
								: "border-border bg-surface enabled:hover:bg-surface-secondary",
						)}
					>
						<Icon size={18} className="text-accent" />
						<span className="text-sm font-semibold text-foreground">{label}</span>
						<span className="text-xs text-muted">{hint}</span>
					</button>
				))}
			</fieldset>

			{!readOnly && edition === "non_commercial" && (
				<div className="flex flex-col gap-1">
					<Checkbox
						checked={confirmed}
						onChange={setConfirmed}
						label="I confirm this instance is used only for personal, education, or non-profit purposes."
					/>
					<a href={LICENSING_DOCS} target="_blank" rel="noreferrer" className="pl-7 text-xs text-accent hover:underline">
						Who qualifies for non-commercial use
					</a>
				</div>
			)}

			{!readOnly && edition === "enterprise" && (
				<div className="flex flex-col gap-1.5">
					<label htmlFor="license-key" className="text-[10px] font-bold uppercase tracking-widest text-muted">
						License key
					</label>
					<textarea
						id="license-key"
						value={key}
						onChange={(e) => setKey(e.target.value)}
						placeholder="Paste your license key"
						spellCheck={false}
						autoComplete="off"
						className="min-h-[90px] w-full rounded-md border border-border bg-transparent px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus"
					/>
					<p className="text-xs text-muted">
						Checked before it is saved. Once saved it is stored encrypted and never shown again.
					</p>
				</div>
			)}

			{!readOnly && (
				<div className="flex justify-end">
					<Button type="submit" variant="primary" isDisabled={!body} isPending={setLicense.isPending} className="h-8 px-4 text-xs font-semibold">
						Save edition
					</Button>
				</div>
			)}
		</form>
	);
}
