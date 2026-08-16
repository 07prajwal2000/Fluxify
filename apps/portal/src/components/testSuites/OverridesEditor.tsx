import { Button, DeleteIconButton, Label, ListBox, Select } from "@fluxify/components";
import { TbArrowRight, TbPlus } from "react-icons/tb";
import { appConfigQuery } from "@/query/appConfigQuery";
import { integrationsQuery } from "@/query/integrationsQuery";
import type { SuiteDraft } from "./types";

const inputClass =
	"w-full rounded-md border border-border bg-background-secondary px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted focus:border-accent";

/**
 * Per-suite overrides so a test can run without touching production data. App
 * config is applied first on the server, then integrations resolve against the
 * overridden values.
 */
export function OverridesEditor({
	projectId,
	draft,
	onChange,
}: {
	projectId: string;
	draft: SuiteDraft;
	onChange: (patch: Partial<SuiteDraft>) => void;
}) {
	const keys = appConfigQuery.getKeysList.useQuery(projectId, "");
	const integrations = integrationsQuery.getBasicList.useQuery(projectId);
	const integrationList = integrations.data ?? [];

	const { appConfigOverrides, integrationOverrides } = draft;

	function patchConfig(index: number, patch: Partial<{ key: string; value: string }>) {
		onChange({
			appConfigOverrides: appConfigOverrides.map((item, i) =>
				i === index ? { ...item, ...patch } : item,
			),
		});
	}

	function patchIntegration(
		index: number,
		patch: Partial<{ existingId: string; newId: string }>,
	) {
		onChange({
			integrationOverrides: integrationOverrides.map((item, i) =>
				i === index ? { ...item, ...patch } : item,
			),
		});
	}

	function nameOf(id: string) {
		return integrationList.find((item) => item.id === id)?.name ?? "Pick one";
	}

	return (
		<div className="flex flex-col gap-8">
			<section className="flex flex-col gap-3">
				<div className="flex items-center justify-between">
					<div>
						<Label>App config overrides</Label>
						<p className="text-xs text-muted">
							Test-only values for existing config keys. Applied before integrations resolve.
						</p>
					</div>
					<Button
						variant="outline"
						size="sm"
						onPress={() =>
							onChange({ appConfigOverrides: [...appConfigOverrides, { key: "", value: "" }] })
						}
					>
						<TbPlus size={15} /> Add
					</Button>
				</div>

				{appConfigOverrides.map((override, index) => (
					// eslint-disable-next-line react/no-array-index-key -- overrides are an ordered list with no id
					<div key={index} className="flex items-center gap-2">
						<Select
							aria-label="Config key"
							selectedKey={override.key || null}
							onSelectionChange={(key) => key && patchConfig(index, { key: key as string })}
							className="w-64 shrink-0"
						>
							<Select.Trigger>
								<span className="truncate font-mono text-xs">
									{override.key || "Pick a key"}
								</span>
								<Select.Indicator />
							</Select.Trigger>
							<Select.Popover className="max-h-72">
								<ListBox>
									{(keys.data ?? []).map((key) => (
										<ListBox.Item key={key} id={key} textValue={key}>
											<span className="font-mono text-xs">{key}</span>
											<ListBox.ItemIndicator />
										</ListBox.Item>
									))}
								</ListBox>
							</Select.Popover>
						</Select>
						{/* these are credentials in practice — never render them in plain text */}
						<input
							type="password"
							autoComplete="new-password"
							className={`${inputClass} min-w-0 flex-1`}
							placeholder="Test value"
							value={override.value}
							onChange={(e) => patchConfig(index, { value: e.target.value })}
						/>
						<DeleteIconButton
							aria-label="Remove override"
							size="sm"
							className="shrink-0"
							onPress={() =>
								onChange({
									appConfigOverrides: appConfigOverrides.filter((_, i) => i !== index),
								})
							}
						/>
					</div>
				))}
			</section>

			<section className="flex flex-col gap-3">
				<div className="flex items-center justify-between">
					<div>
						<Label>Integration overrides</Label>
						<p className="text-xs text-muted">
							Swap an integration for another one, for this suite only.
						</p>
					</div>
					<Button
						variant="outline"
						size="sm"
						onPress={() =>
							onChange({
								integrationOverrides: [
									...integrationOverrides,
									{ existingId: "", newId: "" },
								],
							})
						}
					>
						<TbPlus size={15} /> Add
					</Button>
				</div>

				{integrationOverrides.map((override, index) => (
					// eslint-disable-next-line react/no-array-index-key -- overrides are an ordered list with no id
					<div key={index} className="flex items-center gap-2">
						{(["existingId", "newId"] as const).map((side, position) => (
							<div key={side} className="flex min-w-0 flex-1 items-center gap-2">
								{position === 1 && <TbArrowRight size={16} className="shrink-0 text-muted" />}
								<Select
									aria-label={side === "existingId" ? "Integration to replace" : "Replacement"}
									selectedKey={override[side] || null}
									onSelectionChange={(key) =>
										key && patchIntegration(index, { [side]: key as string })
									}
									className="min-w-0 flex-1"
								>
									<Select.Trigger>
										<span className="truncate text-xs">{nameOf(override[side])}</span>
										<Select.Indicator />
									</Select.Trigger>
									<Select.Popover className="max-h-72">
										<ListBox>
											{integrationList
												// the same integration on both sides is a no-op the server rejects
												.filter(
													(item) =>
														item.id !==
														override[side === "existingId" ? "newId" : "existingId"],
												)
												.map((item) => (
													<ListBox.Item key={item.id} id={item.id} textValue={item.name}>
														<span className="flex min-w-0 items-center gap-2">
															<span className="truncate text-xs">{item.name}</span>
															<span className="text-xs text-muted">{item.variant}</span>
														</span>
														<ListBox.ItemIndicator />
													</ListBox.Item>
												))}
										</ListBox>
									</Select.Popover>
								</Select>
							</div>
						))}
						<DeleteIconButton
							aria-label="Remove override"
							size="sm"
							onPress={() =>
								onChange({
									integrationOverrides: integrationOverrides.filter((_, i) => i !== index),
								})
							}
						/>
					</div>
				))}
			</section>
		</div>
	);
}
