import { Button, Popover } from "@heroui/react";
import clsx from "clsx";
import { useRef, useState } from "react";
import { TbCheck, TbRefresh, TbSettings } from "react-icons/tb";
import { Checkbox } from "../Checkbox";
import { restartLanguageServer } from "../JavaScriptTextArea";

export type EditorTheme = "auto" | "vs-dark" | "light";

export type EditorSettingsMenuProps = {
	theme: EditorTheme;
	onThemeChange: (theme: EditorTheme) => void;
	wordWrap: boolean;
	onWordWrapChange: (wordWrap: boolean) => void;
};

export function EditorSettingsMenu({
	theme,
	onThemeChange,
	wordWrap,
	onWordWrapChange,
}: EditorSettingsMenuProps) {
	const [isOpen, setIsOpen] = useState(false);
	const [isRestarting, setIsRestarting] = useState(false);
	const [statusMessage, setStatusMessage] = useState<string | null>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);

	const handleRestart = async () => {
		setIsRestarting(true);
		setStatusMessage(null);
		try {
			await restartLanguageServer();
			setStatusMessage("Language server restarted");
			setTimeout(() => {
				setStatusMessage(null);
			}, 3000);
		} catch {
			setStatusMessage("Failed to restart");
		} finally {
			setIsRestarting(false);
		}
	};

	return (
		<>
			<Button
				ref={triggerRef}
				isIconOnly
				size="sm"
				variant="ghost"
				className={clsx(
					"h-8 w-8 text-muted hover:text-foreground rounded-lg transition-colors",
					isOpen && "bg-surface-secondary text-foreground",
				)}
				aria-label="Editor settings"
				onPress={() => setIsOpen((prev) => !prev)}
			>
				<TbSettings className="size-4" />
			</Button>

			<Popover isOpen={isOpen} onOpenChange={setIsOpen}>
				<Popover.Content
					triggerRef={triggerRef}
					placement="top start"
					className="w-72 rounded-xl border border-border bg-overlay p-0 shadow-2xl z-[9999]"
				>
					<Popover.Dialog className="p-3.5 flex flex-col gap-3.5 outline-none">
						<div className="flex items-center justify-between border-b border-border pb-2">
							<span className="text-xs font-semibold text-foreground">
								Editor Settings
							</span>
						</div>

						{/* Theme Selection */}
						<div className="flex flex-col gap-1.5">
							<span
								id="editor-settings-theme"
								className="text-[11px] font-medium text-muted"
							>
								Theme
							</span>
							<div
								role="group"
								aria-labelledby="editor-settings-theme"
								className="grid grid-cols-3 gap-1 bg-surface-secondary p-1 rounded-lg border border-border"
							>
								{(["auto", "vs-dark", "light"] as const).map((t) => (
									<button
										key={t}
										type="button"
										onClick={() => onThemeChange(t)}
										className={clsx(
											"px-2 py-1 text-xs rounded-md capitalize transition-colors font-medium text-center cursor-pointer",
											theme === t
												? "bg-surface text-foreground shadow-sm"
												: "text-muted hover:text-foreground",
										)}
									>
										{t === "auto" ? "Auto" : t === "vs-dark" ? "Dark" : "Light"}
									</button>
								))}
							</div>
						</div>

						{/* Wrap Lines Toggle */}
						<div className="flex items-center justify-between border-t border-border pt-2.5">
							<div className="flex flex-col">
								<span className="text-xs font-medium text-foreground">
									Wrap Lines
								</span>
								<span className="text-[11px] text-muted-foreground leading-tight">
									Wrap long lines in editor
								</span>
							</div>
							<Checkbox
								aria-label="Wrap lines"
								isSelected={wordWrap}
								onChange={onWordWrapChange}
							/>
						</div>

						{/* Language Server Restart */}
						<div className="flex flex-col gap-1.5 border-t border-border pt-2.5">
							<div className="flex items-center justify-between">
								<span className="text-[11px] font-medium text-muted">
									Language Server
								</span>
							</div>
							<p className="text-[11px] text-muted-foreground leading-tight">
								Reload TypeScript runtime globals and package completions.
							</p>
							<Button
								size="sm"
								variant="secondary"
								isDisabled={isRestarting}
								className="mt-1 h-7 text-xs font-medium gap-1.5 justify-center w-full"
								onPress={handleRestart}
							>
								<TbRefresh
									className={clsx("size-3.5", isRestarting && "animate-spin")}
								/>
								<span>{isRestarting ? "Restarting..." : "Restart Server"}</span>
							</Button>

							{statusMessage && (
								<div className="flex items-center gap-1 text-[11px] text-accent mt-0.5 justify-center">
									<TbCheck className="size-3 shrink-0" />
									<span>{statusMessage}</span>
								</div>
							)}
						</div>
					</Popover.Dialog>
				</Popover.Content>
			</Popover>
		</>
	);
}
