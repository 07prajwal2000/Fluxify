import { Description, Label, ListBox, Select } from "@fluxify/components";
import type { CustomBlockUsage } from "@fluxify/server/src/db/schema";

export type { CustomBlockUsage };

/** where a custom block may run (#534), with the page that explains each */
export const USAGE_OPTIONS: { id: CustomBlockUsage; label: string; help: string; docs: string }[] =
	[
		{
			id: "flow",
			label: "Routes & workflows",
			help: "Drop it on any route, workflow or custom block canvas.",
			docs: "https://docs.fluxify.rest/concepts/blocks.html",
		},
		{
			id: "test",
			label: "Test setup & teardown",
			help: "Runs only before or after a test suite. Hidden from the block picker.",
			docs: "https://docs.fluxify.rest/testing/setup-and-teardown.html",
		},
		{
			id: "middleware",
			label: "Middleware",
			help: "Runs only as a step of a middleware, before or after a route. Takes no input parameters.",
			docs: "https://docs.fluxify.rest/concepts/middlewares.html",
		},
	];

export const usageLabel = (usage: CustomBlockUsage) =>
	USAGE_OPTIONS.find((o) => o.id === usage)?.label ?? usage;

/**
 * Where the block may run. Chosen once at create: routes, suites and middlewares
 * depend on it, so the settings modal shows it read-only (`isDisabled`).
 */
export function UsageField({
	value,
	onChange,
	isDisabled,
}: {
	value: CustomBlockUsage;
	onChange?: (next: CustomBlockUsage) => void;
	isDisabled?: boolean;
}) {
	const selected = USAGE_OPTIONS.find((o) => o.id === value) ?? USAGE_OPTIONS[0];
	return (
		<div className="flex flex-col gap-1">
			<Select
				fullWidth
				variant="secondary"
				value={value}
				isDisabled={isDisabled}
				onChange={(next) => onChange?.(next as CustomBlockUsage)}
			>
				<Label>Used for</Label>
				<Select.Trigger>
					<Select.Value />
					<Select.Indicator />
				</Select.Trigger>
				<Description>
					{selected.help}{" "}
					{isDisabled
						? "Set when the block was created and can't be changed."
						: "Can't be changed later."}
				</Description>
				<Select.Popover>
					<ListBox>
						{USAGE_OPTIONS.map((option) => (
							<ListBox.Item key={option.id} id={option.id} textValue={option.label}>
								{option.label}
								<ListBox.ItemIndicator />
							</ListBox.Item>
						))}
					</ListBox>
				</Select.Popover>
			</Select>
			<a
				href={selected.docs}
				target="_blank"
				rel="noreferrer"
				className="w-fit text-xs text-accent hover:underline"
			>
				What does this do?
			</a>
		</div>
	);
}
