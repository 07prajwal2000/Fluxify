import { Button, Dropdown, Label, Tabs } from "@fluxify/components";
import { useRef, useState } from "react";
import {
	TbAlertCircle,
	TbAlertTriangle,
	TbBold,
	TbEye,
	TbHeading,
	TbInfoCircle,
	TbItalic,
	TbPencil,
	TbUnderline,
} from "react-icons/tb";
import { MarkdownViewer } from "@/components/ai/MarkdownViewer";
import { type Edit, insertBlock, prefixLine, wrapSelection } from "./docsEditing";

const HEADINGS = [1, 2, 3] as const;
const HINTS = [
	{ kind: "info", label: "Info", icon: <TbInfoCircle size={16} /> },
	{ kind: "warning", label: "Warning", icon: <TbAlertTriangle size={16} /> },
	{ kind: "danger", label: "Error", icon: <TbAlertCircle size={16} /> },
] as const;

/** Plain markdown textarea with a few formatting shortcuts and a preview. */
export function DocsEditor({
	value,
	onChange,
	isDisabled,
}: {
	value: string;
	onChange: (value: string) => void;
	isDisabled?: boolean;
}) {
	const ref = useRef<HTMLTextAreaElement>(null);
	const [mode, setMode] = useState("write");

	function apply(edit: (value: string, start: number, end: number) => Edit) {
		const el = ref.current;
		if (!el) return;
		const next = edit(value, el.selectionStart, el.selectionEnd);
		onChange(next.value);
		// wait for the controlled value to land before moving the caret
		requestAnimationFrame(() => {
			el.focus();
			el.setSelectionRange(next.start, next.end);
		});
	}

	const tool = (label: string, icon: React.ReactNode, onPress: () => void) => (
		<Button
			isIconOnly
			size="sm"
			variant="ghost"
			aria-label={label}
			isDisabled={isDisabled}
			onPress={onPress}
		>
			{icon}
		</Button>
	);

	return (
		<Tabs
			variant="secondary"
			selectedKey={mode}
			onSelectionChange={(key) => setMode(String(key))}
			className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface"
		>
			<div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-secondary/40 pr-2">
				<Tabs.ListContainer className="flex-none">
					<Tabs.List aria-label="Docs editor mode" className="w-auto min-w-0 border-none">
						<Tabs.Tab id="write" className="gap-1.5 px-3 text-xs">
							<TbPencil size={14} /> Write
							<Tabs.Indicator />
						</Tabs.Tab>
						<Tabs.Tab id="preview" className="gap-1.5 px-3 text-xs">
							<TbEye size={14} /> Preview
							<Tabs.Indicator />
						</Tabs.Tab>
					</Tabs.List>
				</Tabs.ListContainer>
				<div className={`ml-auto flex items-center gap-0.5 ${mode === "write" ? "" : "invisible"}`}>
					<Dropdown>
						<Dropdown.Trigger>
							<Button
								isIconOnly
								size="sm"
								variant="ghost"
								aria-label="Heading"
								isDisabled={isDisabled}
							>
								<TbHeading size={16} />
							</Button>
						</Dropdown.Trigger>
						<Dropdown.Popover>
							<Dropdown.Menu
								onAction={(key) => apply((v, s) => prefixLine(v, s, `${"#".repeat(Number(key))} `))}
							>
								{HEADINGS.map((level) => (
									<Dropdown.Item key={level} id={String(level)} textValue={`Heading ${level}`}>
										<Label>Heading {level}</Label>
									</Dropdown.Item>
								))}
							</Dropdown.Menu>
						</Dropdown.Popover>
					</Dropdown>
					{tool("Bold", <TbBold size={16} />, () =>
						apply((v, s, e) => wrapSelection(v, s, e, "**", "**")),
					)}
					{tool("Italic", <TbItalic size={16} />, () =>
						apply((v, s, e) => wrapSelection(v, s, e, "_", "_")),
					)}
					{tool("Underline", <TbUnderline size={16} />, () =>
						apply((v, s, e) => wrapSelection(v, s, e, ":u[", "]")),
					)}
					<span className="mx-1 h-4 w-px bg-border" />
					{HINTS.map((hint) => (
						<span key={hint.kind}>
							{tool(`${hint.label} hint`, hint.icon, () =>
								apply((v, s, e) => insertBlock(v, s, e, `:::${hint.kind}\n`, "\n:::")),
							)}
						</span>
					))}
				</div>
			</div>
			<Tabs.Panel id="write" className="flex min-h-0 flex-1 flex-col p-0">
				<textarea
					ref={ref}
					value={value}
					disabled={isDisabled}
					onChange={(e) => onChange(e.target.value)}
					placeholder="# What this block does&#10;&#10;Explain its inputs and output. Markdown is supported."
					className="min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-sm leading-relaxed text-foreground outline-none placeholder:text-muted/60"
				/>
			</Tabs.Panel>
			<Tabs.Panel id="preview" className="min-h-0 flex-1 overflow-y-auto p-4">
				{value.trim() ? (
					<MarkdownViewer content={value} />
				) : (
					<div className="flex h-full items-center justify-center text-sm text-muted">
						No docs found.
					</div>
				)}
			</Tabs.Panel>
		</Tabs>
	);
}
