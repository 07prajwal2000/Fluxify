import { CloseButton, Kbd, Modal } from "@fluxify/components";
import { TbKeyboard } from "react-icons/tb";
import { comboLabel } from "../actions/combo";

export type KeyboardShortcutsModalProps = {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
};

type ShortcutRow = {
	label: string;
	combo: string[];
};

type ShortcutSection = {
	title: string;
	shortcuts: ShortcutRow[];
};

const SHORTCUT_SECTIONS: ShortcutSection[] = [
	{
		title: "General & Navigation",
		shortcuts: [
			{ label: "Open command palette (Spotlight)", combo: ["mod+k", "mod+space"] },
			{ label: "Keyboard shortcuts manual", combo: ["?"] },
			{ label: "Save canvas", combo: ["mod+s"] },
			{ label: "Select all elements", combo: ["mod+a"] },
			{ label: "Auto-format blocks layout", combo: ["shift+f"] },
			{ label: "Undo last change", combo: ["mod+z"] },
			{ label: "Redo last change", combo: ["mod+shift+z"] },
		],
	},
	{
		title: "Block Operations",
		shortcuts: [
			{ label: "Open block settings panel", combo: ["enter"] },
			{ label: "Add block (open picker)", combo: ["shift+a"] },
			{ label: "Duplicate selected blocks", combo: ["shift+d"] },
			{ label: "Delete selected elements", combo: ["backspace", "delete"] },
			{ label: "Copy selected blocks", combo: ["mod+c"] },
			{ label: "Paste blocks", combo: ["mod+v"] },
			{ label: "Export selection to JSON", combo: ["mod+e"] },
			{ label: "Import blocks from file", combo: ["mod+i"] },
		],
	},
	{
		title: "Canvas Controls",
		shortcuts: [
			{ label: "Pan canvas viewport", combo: ["space + drag", "middle click"] },
			{ label: "Zoom canvas in / out", combo: ["ctrl + scroll", "pinch"] },
			{ label: "Inspect settings (read-only)", combo: ["double click"] },
		],
	},
];

function formatCombo(key: string): string {
	if (key.includes("+") && !key.includes("drag") && !key.includes("scroll")) {
		return comboLabel(key);
	}
	if (key === "backspace") return "Backspace";
	if (key === "delete") return "Del";
	if (key === "enter") return "Enter";
	return key;
}

export function KeyboardShortcutsModal({ isOpen, onOpenChange }: KeyboardShortcutsModalProps) {
	return (
		<Modal isOpen={isOpen} onOpenChange={onOpenChange}>
			<Modal.Backdrop variant="blur" className="backdrop-blur-xs bg-black/50">
				<Modal.Container placement="center" size="lg" className="p-4">
					<Modal.Dialog
						aria-label="Keyboard Shortcuts"
						className="w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-background shadow-2xl shadow-black/60 p-0 text-foreground"
					>
						<Modal.Header className="flex !flex-row shrink-0 items-center justify-between border-b border-border px-5 py-3.5">
							<div className="flex items-center gap-2">
								<TbKeyboard size={20} className="text-accent" />
								<Modal.Heading className="text-base font-semibold">
									Keyboard Shortcuts
								</Modal.Heading>
							</div>
							<CloseButton
								aria-label="Close shortcuts modal"
								className="ml-auto"
								onPress={() => onOpenChange(false)}
							/>
						</Modal.Header>

						<Modal.Body className="max-h-[70vh] overflow-y-auto p-5 space-y-6">
							{SHORTCUT_SECTIONS.map((section) => (
								<div key={section.title} className="space-y-2.5">
									<h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
										{section.title}
									</h3>
									<div className="divide-y divide-border rounded-lg border border-border bg-surface/30">
										{section.shortcuts.map((shortcut) => (
											<div
												key={shortcut.label}
												className="flex items-center justify-between px-3.5 py-2 text-sm"
											>
												<span className="text-foreground">{shortcut.label}</span>
												<div className="flex items-center gap-1.5">
													{shortcut.combo.map((c, i) => (
														<span key={c} className="flex items-center gap-1.5">
															{i > 0 && <span className="text-xs text-muted">or</span>}
															<Kbd className="px-2 py-0.5 text-xs">{formatCombo(c)}</Kbd>
														</span>
													))}
												</div>
											</div>
										))}
									</div>
								</div>
							))}
						</Modal.Body>

						<Modal.Footer className="flex items-center justify-between border-t border-border bg-surface/30 px-5 py-2.5 text-xs text-muted">
							<span>Press any shortcut anywhere on the canvas to act.</span>
							<span className="flex items-center gap-1.5">
								<Kbd className="px-1.5 py-0.5 text-[10px]">Esc</Kbd>
								<span>to close</span>
							</span>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
