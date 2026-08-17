import { useMemo } from "react";
import { Dropdown, Kbd, Label, type Key } from "@fluxify/components";
import { comboLabel } from "../actions/combo";
import type { CanvasAction } from "../actions/useCanvasActions";
import type { CanvasContextMenuState } from "./useContextMenu";

export type CanvasContextMenuProps = {
	menu: CanvasContextMenuState;
	actions: CanvasAction[];
};

/** Splits the flat action list on `startsGroup` so the menu reads as sections. */
function groupActions(actions: CanvasAction[]): CanvasAction[][] {
	const groups: CanvasAction[][] = [];
	for (const action of actions) {
		if (action.startsGroup || groups.length === 0) groups.push([]);
		groups[groups.length - 1].push(action);
	}
	return groups.filter((group) => group.length > 0);
}

/**
 * Right-click menu for the canvas. It is the same action list the keyboard layer
 * runs, so every entry shows the shortcut that does the same thing.
 *
 * Positioning uses an empty 1×1 trigger parked under the pointer: HeroUI's
 * dropdown anchors to its trigger, and a throwaway anchor keeps the menu's
 * focus management, arrow-key navigation and dismiss behaviour intact rather
 * than reimplementing them around a floating div.
 */
export function CanvasContextMenu({ menu, actions }: CanvasContextMenuProps) {
	const available = useMemo(
		() => actions.filter((action) => action.available),
		[actions],
	);
	const groups = useMemo(() => groupActions(available), [available]);

	if (!menu.enabled) return null;

	const onAction = (key: Key) => {
		const action = available.find((candidate) => candidate.id === key);
		menu.close();
		if (action && !action.disabled) action.run();
	};

	return (
		<Dropdown
			isOpen={menu.isOpen}
			onOpenChange={(open) => {
				if (!open) menu.close();
			}}
		>
			{/* Inline styles, not classes: the button's own variant styling would
			    otherwise win on size and padding and give the anchor a real box. */}
			<Dropdown.Trigger
				aria-label="Canvas actions"
				excludeFromTabOrder
				style={{
					position: "fixed",
					left: menu.position?.x ?? 0,
					top: menu.position?.y ?? 0,
					width: 1,
					height: 1,
					minWidth: 0,
					minHeight: 0,
					padding: 0,
					border: 0,
					background: "transparent",
					opacity: 0,
					pointerEvents: "none",
				}}
			/>
			{/* Compact by design: this menu is read at a glance, mid-gesture, and a
			    full-size dropdown covers the blocks the user just right-clicked. */}
			<Dropdown.Popover placement="bottom start" className="min-w-52 max-w-72 p-1">
				<Dropdown.Menu
					onAction={onAction}
					aria-label="Canvas actions"
					className="gap-0 p-0"
				>
					{groups.map((group, index) => (
						<Dropdown.Section
							key={group[0].id}
							className={index === 0 ? "" : "mt-0.5 border-t border-border pt-0.5"}
						>
							{group.map((action) => (
								<Dropdown.Item
									key={action.id}
									id={action.id}
									textValue={action.label}
									isDisabled={action.disabled}
									variant={action.danger ? "danger" : undefined}
									className={`min-h-0 gap-2 rounded-md px-2 py-1 text-[13px] leading-5 ${
										action.danger
											? "text-danger hover:bg-danger/10 focus:bg-danger/10 focus:text-danger"
											: ""
									}`}
								>
									<span
										className={`shrink-0 ${action.danger ? "text-danger" : "text-muted"}`}
									>
										{action.icon}
									</span>
									<Label
										className={`flex-1 truncate text-[13px] ${action.danger ? "text-danger" : ""}`}
									>
										{action.label}
									</Label>
									{action.combo && (
										<Kbd className="ml-3 shrink-0 px-1 py-0 text-[10px] leading-4">
											{comboLabel(action.combo)}
										</Kbd>
									)}
								</Dropdown.Item>
							))}
						</Dropdown.Section>
					))}
				</Dropdown.Menu>
			</Dropdown.Popover>
		</Dropdown>
	);
}
