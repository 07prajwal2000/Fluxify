import { Children, isValidElement, type ReactNode } from "react";
import { TbCheck, TbX } from "react-icons/tb";
import "./blocks.css";
import { BlockToolbar, useHoverIntent } from "./BlockToolbar";
import { BlockHandle, type BlockHandleProps } from "./handles/BlockHandle";
import { HANDLE_CONFIG, type HandleSide } from "./handles/handleConfig";

export type BaseBlockProps = {
	blockId: string;
	/** Block type key, e.g. `httprequest`. Exposed as `data-block-type`. */
	blockType: string;
	/** Graph position — exposed as data attributes for debugging/tests. */
	position?: { x: number; y: number };
	/** Human readable name, shown top-right of the icon. */
	name: string;
	/** Shown under the name, truncated to a single line. */
	description?: string;
	icon?: ReactNode;
	selected?: boolean;
	/** Execution outcome: `true` = succeeded (green), `false` = failed (red),
	 *  `undefined`/`null` = not executed (no outline, no badge). */
	status?: boolean | null;
	/** Tints the icon; leave unset to inherit the foreground colour. */
	color?: string;
	/** Show the hover action strip (open/duplicate/copy/delete). Default `true`;
	 *  always hidden in readonly mode. */
	showToolbar?: boolean;
	className?: string;
	/** `<BlockHandle>` children get routed to edge rails; anything else renders
	 *  after the text column. */
	children?: ReactNode;
};

type Rails = Record<HandleSide, ReactNode[]>;

export function splitChildren(children: ReactNode) {
	const rails: Rails = { left: [], right: [], top: [], bottom: [] };
	const body: ReactNode[] = [];

	for (const child of Children.toArray(children)) {
		if (isValidElement<BlockHandleProps>(child) && child.type === BlockHandle) {
			rails[HANDLE_CONFIG[child.props.kind].side].push(child);
		} else {
			body.push(child);
		}
	}
	return { rails, body };
}

const RAIL_SIDES: HandleSide[] = ["left", "right", "top", "bottom"];

/**
 * Block shell: icon on the left, name + truncated description on the right, and
 * edge rails that lay out whichever `<BlockHandle>`s were passed as children
 * (flex, space-around per edge). Wrap it to build a concrete block type.
 */
export function BaseBlock({
	blockId,
	blockType,
	position,
	name,
	description,
	icon,
	selected,
	status,
	color,
	showToolbar = true,
	className,
	children,
}: BaseBlockProps) {
	const { rails, body } = splitChildren(children);
	const { hovered, hoverProps } = useHoverIntent();
	const statusClass =
		status === true ? "fx-block--ok" : status === false ? "fx-block--fail" : "";

	return (
		<div
			{...hoverProps}
			data-block-id={blockId}
			data-block-type={blockType}
			data-x={position?.x}
			data-y={position?.y}
			className={[
				"fx-block",
				statusClass,
				selected ? "fx-block--selected" : "",
				className ?? "",
			]
				.filter(Boolean)
				.join(" ")}
		>
			{showToolbar && (
				<BlockToolbar
					blockId={blockId}
					visible={hovered}
					hoverProps={hoverProps}
				/>
			)}
			{status != null && (
				<span
					className={`fx-block__status fx-block__status--${status ? "ok" : "fail"}`}
					title={status ? "Succeeded" : "Failed"}
					aria-label={status ? "Succeeded" : "Failed"}
				>
					{status ? <TbCheck size={10} /> : <TbX size={10} />}
				</span>
			)}
			{icon && (
				<span className="fx-block__icon" style={color ? { color } : undefined}>
					{icon}
				</span>
			)}
			<span className="fx-block__text">
				<span className="fx-block__name">{name}</span>
				{description && (
					<span className="fx-block__description">{description}</span>
				)}
			</span>
			{body}
			{RAIL_SIDES.map((side) =>
				rails[side].length === 0 ? null : (
					<div key={side} className={`fx-block__rail fx-block__rail--${side}`}>
						{rails[side]}
					</div>
				),
			)}
		</div>
	);
}
