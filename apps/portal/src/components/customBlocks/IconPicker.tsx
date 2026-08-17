import { useMemo, useState } from "react";
import { Button, Input, Label, Tabs, TextField } from "@fluxify/components";
import { TbBox, TbSearch } from "react-icons/tb";
import { BaseBlock } from "@/components/canvas/blocks/BaseBlock";
import { PREMADE_ICON_NAMES, premadeIcon } from "./premadeIcons";

/** `iconUrl` is `text` in the DB but the API caps it — see custom-blocks/create/dto.ts. */
export const ICON_URL_MAX = 68266;

export type IconKind = "premade-list" | "custom";

export type IconValue = {
	icon?: IconKind;
	/** Premade icon name, or a URL / data URI when `icon` is `custom`. */
	iconUrl?: string;
};

/** The icon a block shows, for both the preview here and (later) the canvas. */
export function CustomBlockIcon({ icon, iconUrl, size = 18 }: IconValue & { size?: number }) {
	if (icon === "custom" && iconUrl) {
		return <img src={iconUrl} alt="" width={size} height={size} className="object-contain" />;
	}
	const Premade = icon === "premade-list" ? premadeIcon(iconUrl) : undefined;
	return Premade ? <Premade size={size} /> : <TbBox size={size} />;
}

export function IconPicker({
	value,
	onChange,
	isDisabled,
	previewName,
	previewDescription,
	header,
}: {
	value: IconValue;
	onChange: (next: IconValue) => void;
	isDisabled?: boolean;
	previewName: string;
	previewDescription?: string;
	/** Rendered in the left column, above the preview. */
	header?: React.ReactNode;
}) {
	const [search, setSearch] = useState("");
	const custom = value.icon === "custom";

	const results = useMemo(() => {
		const q = search.trim().toLowerCase();
		if (!q) return PREMADE_ICON_NAMES;
		return PREMADE_ICON_NAMES.filter((name) => name.includes(q));
	}, [search]);

	const customUrl = custom ? (value.iconUrl ?? "") : "";
	const tooLong = customUrl.length > ICON_URL_MAX;

	return (
		<div className="flex h-full min-h-0 gap-5">
			{/* left 30%: what the block will actually look like */}
			<div className="flex w-[30%] shrink-0 flex-col gap-3 overflow-y-auto pr-1">
				{header}
				<div className="flex shrink-0 flex-col items-center gap-3 rounded-md border border-border bg-surface px-4 py-5">
					<div className="pointer-events-none">
						<BaseBlock
							blockId="preview"
							blockType="custom"
							name={previewName || "Custom block"}
							description={previewDescription}
							icon={<CustomBlockIcon {...value} />}
							showToolbar={false}
						/>
					</div>
					<p className="w-full truncate text-center text-xs text-muted">
						{custom
							? customUrl
								? "Custom image"
								: "No image yet — default icon"
							: (value.iconUrl ?? "No icon selected — default icon")}
					</p>
				</div>
				{value.icon && (
					<Button
						variant="ghost"
						className="self-start"
						isDisabled={isDisabled}
						onPress={() => onChange({})}
					>
						Clear icon
					</Button>
				)}
			</div>

			{/* right 70%: the picker itself, the only thing allowed to scroll */}
			<Tabs
				variant="secondary"
				selectedKey={custom ? "custom" : "premade"}
				onSelectionChange={(key) =>
					onChange(
						key === "custom"
							? { icon: "custom", iconUrl: "" }
							: { icon: "premade-list", iconUrl: undefined },
					)
				}
				className="flex min-h-0 w-[70%] flex-1 flex-col"
			>
				<Tabs.List aria-label="Icon source">
					<Tabs.Tab id="premade">Premade</Tabs.Tab>
					<Tabs.Tab id="custom">URL / base64</Tabs.Tab>
				</Tabs.List>

				<Tabs.Panel id="premade" className="flex min-h-0 flex-1 flex-col gap-3 pt-3">
					<TextField value={search} onChange={setSearch} isDisabled={isDisabled}>
						<Label className="sr-only">Search icons</Label>
						<Input placeholder="Search icons" />
					</TextField>
					{results.length === 0 ? (
						<p className="flex items-center gap-2 py-6 text-xs text-muted">
							<TbSearch size={14} /> No icon matches “{search}”.
						</p>
					) : (
						<div className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(3rem,1fr))] gap-1 overflow-y-auto rounded-md border border-border p-2">
							{results.map((name) => {
								const Icon = premadeIcon(name)!;
								const selected = value.icon === "premade-list" && value.iconUrl === name;
								return (
									<button
										key={name}
										type="button"
										title={name}
										aria-label={name}
										aria-pressed={selected}
										disabled={isDisabled}
										onClick={() => onChange({ icon: "premade-list", iconUrl: name })}
										className={`flex aspect-square items-center justify-center rounded-md border transition-colors ${
											selected
												? "border-accent bg-accent/10 text-accent"
												: "border-transparent text-muted hover:bg-surface-secondary hover:text-foreground"
										}`}
									>
										<Icon size={20} />
									</button>
								);
							})}
						</div>
					)}
				</Tabs.Panel>

				<Tabs.Panel id="custom" className="min-h-0 flex-1 pt-3">
					<TextField
						value={customUrl}
						onChange={(next) => onChange({ icon: "custom", iconUrl: next })}
						isDisabled={isDisabled}
						isInvalid={tooLong}
					>
						<Label>Image URL or base64 data URI</Label>
						<Input placeholder="https://… or data:image/svg+xml;base64,…" />
						<p className={`mt-1 text-xs ${tooLong ? "text-danger" : "text-muted"}`}>
							{customUrl.length.toLocaleString()} / {ICON_URL_MAX.toLocaleString()} characters
							{tooLong ? " — too large, use a smaller image or a URL" : ""}
						</p>
					</TextField>
				</Tabs.Panel>
			</Tabs>
		</div>
	);
}
