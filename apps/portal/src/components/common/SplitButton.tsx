import { Button, ButtonGroup, Dropdown, Label } from "@fluxify/components";
import type { ReactNode } from "react";
import { TbChevronDown } from "react-icons/tb";

export type SplitButtonItem = {
	id: string;
	label: string;
	icon?: ReactNode;
	onAction: () => void;
	/** blocks this item alone; the rest of the menu stays reachable */
	isDisabled?: boolean;
};

/**
 * One button with a menu attached: the main action, and a caret that opens the
 * related ones. The two halves read as one control: a shared outline, one divider,
 * rounded only on the outer corners. With no items it is just the button.
 */
export function SplitButton({
	children,
	onPress,
	isDisabled,
	menuLabel,
	items,
}: {
	children: ReactNode;
	onPress: () => void;
	/** the main action only; the menu stays reachable */
	isDisabled?: boolean;
	/** names the caret for screen readers, e.g. "Version options" */
	menuLabel: string;
	items: SplitButtonItem[];
}) {
	if (items.length === 0) {
		return (
			<Button variant="outline" isDisabled={isDisabled} onPress={onPress}>
				{children}
			</Button>
		);
	}
	return (
		<ButtonGroup variant="outline">
			{/* the button's own radius outranks utilities, hence the ! */}
			<Button className="!rounded-e-none" isDisabled={isDisabled} onPress={onPress}>
				{children}
			</Button>
			<Dropdown>
				<Button
					isIconOnly
					variant="outline"
					aria-label={menuLabel}
					className="-ml-px !rounded-s-none"
				>
					<ButtonGroup.Separator />
					<TbChevronDown size={14} />
				</Button>
				<Dropdown.Popover>
					<Dropdown.Menu onAction={(key) => items.find((item) => item.id === key)?.onAction()}>
						{items.map((item) => (
							<Dropdown.Item
								key={item.id}
								id={item.id}
								textValue={item.label}
								isDisabled={item.isDisabled}
							>
								{item.icon}
								<Label>{item.label}</Label>
							</Dropdown.Item>
						))}
					</Dropdown.Menu>
				</Dropdown.Popover>
			</Dropdown>
		</ButtonGroup>
	);
}
