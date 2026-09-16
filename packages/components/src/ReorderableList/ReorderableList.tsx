import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@heroui/react";
import { TbChevronDown, TbChevronUp, TbGripVertical, TbX } from "react-icons/tb";
import clsx from "clsx";
import { displayRows } from "./displayRows";
import type { ReorderableListItemMeta, ReorderableListProps } from "./types";

interface DragState {
	index: number;
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
	x: number;
	y: number;
}

export function ReorderableList<T>({
	items,
	getKey,
	onReorder,
	onMove,
	onRemove,
	removeButtonAriaLabel,
	isEditable = true,
	showIndex = false,
	showMoveButtons = true,
	placeholderText = "Drop here",
	emptyMessage,
	className,
	itemClassName,
	getItemLabel,
	renderItem,
	renderItemContent,
	renderActions,
	renderPreview,
	onItemMouseEnter,
	onItemMouseLeave,
	onItemFocus,
	onItemBlur,
	onDragStart,
	onDragEnd,
	isItemLocked,
	isItemPinned,
}: ReorderableListProps<T>) {
	const itemsRef = useRef(items);
	itemsRef.current = items;

	const [dragState, setDragState] = useState<DragState | null>(null);
	const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
	const dragOverIndexRef = useRef<number | null>(null);
	const listRef = useRef<HTMLOListElement>(null);

	// Safety cleanup of body styles if unmounted during an active drag
	useEffect(() => {
		return () => {
			document.body.style.userSelect = "";
			document.body.style.cursor = "";
		};
	}, []);

	const isPinned = useCallback(
		(index: number) => !!isItemPinned && index in itemsRef.current && isItemPinned(itemsRef.current[index]),
		[isItemPinned],
	);

	const handleMove = useCallback(
		(from: number, to: number) => {
			const currentItems = itemsRef.current;
			// a pinned item "moving" to its own index still leaves its pin
			if (to < 0 || to >= currentItems.length || (from === to && !isPinned(from))) return;
			const next = [...currentItems];
			const [moved] = next.splice(from, 1);
			next.splice(to, 0, moved);
			onMove?.(from, to);
			onReorder?.(next, from, to);
		},
		[onMove, onReorder, isPinned],
	);

	const handlePointerDown = (e: React.PointerEvent<HTMLLIElement>, index: number) => {
		if (!isEditable || e.button !== 0 || isItemLocked?.(itemsRef.current[index])) return;
		// only the grip starts a drag; events bubbling up from a portal (e.g. a modal) never reach one
		const handle = (e.target as HTMLElement).closest("[data-drag-handle]");
		if (!handle || !e.currentTarget.contains(handle)) return;

		const targetLi = e.currentTarget;
		const rect = targetLi.getBoundingClientRect();
		const startX = e.clientX;
		const startY = e.clientY;
		const offsetX = startX - rect.left;
		const offsetY = startY - rect.top;

		let isDragging = false;
		dragOverIndexRef.current = index;

		const onPointerMove = (moveEvent: PointerEvent) => {
			const dx = moveEvent.clientX - startX;
			const dy = moveEvent.clientY - startY;

			if (!isDragging) {
				if (Math.hypot(dx, dy) < 4) return;
				isDragging = true;
				document.body.style.userSelect = "none";
				document.body.style.cursor = "grabbing";
				if (items[index]) {
					onDragStart?.(items[index], index, targetLi);
				}
			}

			setDragState({
				index,
				width: rect.width,
				height: rect.height,
				offsetX,
				offsetY,
				x: moveEvent.clientX,
				y: moveEvent.clientY,
			});

			const listEl = listRef.current;
			if (!listEl) return;

			// Auto-scroll the container if dragging near top/bottom boundaries
			const scrollContainer =
				listEl.closest<HTMLElement>("[data-slot='tabs-panel'], .tabs__panel") ?? listEl;
			if (scrollContainer) {
				const cRect = scrollContainer.getBoundingClientRect();
				if (moveEvent.clientY < cRect.top + 32) {
					scrollContainer.scrollTop -= 8;
				} else if (moveEvent.clientY > cRect.bottom - 32) {
					scrollContainer.scrollTop += 8;
				}
			}

			// Find closest target slot by midpoint
			const itemEls = Array.from(listEl.querySelectorAll<HTMLElement>("[data-display-index]"));
			if (itemEls.length === 0) return;

			let closestIndex = 0;
			let minDistance = Infinity;

			for (const el of itemEls) {
				const elRect = el.getBoundingClientRect();
				const midY = elRect.top + elRect.height / 2;
				const dist = Math.abs(moveEvent.clientY - midY);
				if (dist < minDistance) {
					minDistance = dist;
					const idx = Number(el.dataset.displayIndex);
					if (!Number.isNaN(idx)) {
						closestIndex = idx;
					}
				}
			}

			dragOverIndexRef.current = closestIndex;
			setDragOverIndex(closestIndex);
		};

		const cleanup = () => {
			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("pointerup", onPointerUp);
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("blur", onBlur);
			document.body.style.userSelect = "";
			document.body.style.cursor = "";
		};

		const onPointerUp = () => {
			cleanup();
			if (isDragging) {
				const targetIndex = dragOverIndexRef.current;
				if (targetIndex !== null && (targetIndex !== index || isPinned(index))) {
					handleMove(index, targetIndex);
				}
				setDragState(null);
				setDragOverIndex(null);
				dragOverIndexRef.current = null;
				onDragEnd?.();
			}
		};

		const onKeyDown = (keyEvent: KeyboardEvent) => {
			if (keyEvent.key === "Escape") {
				cleanup();
				setDragState(null);
				setDragOverIndex(null);
				dragOverIndexRef.current = null;
				onDragEnd?.();
			}
		};

		const onBlur = () => {
			cleanup();
			setDragState(null);
			setDragOverIndex(null);
			dragOverIndexRef.current = null;
			onDragEnd?.();
		};

		window.addEventListener("pointermove", onPointerMove);
		window.addEventListener("pointerup", onPointerUp);
		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("blur", onBlur);
	};

	const displayItems = useMemo(
		() =>
			displayRows(
				items,
				dragState && dragOverIndex !== null ? { from: dragState.index, over: dragOverIndex } : null,
				isItemPinned,
			),
		[items, dragState, dragOverIndex, isItemPinned],
	);

	const draggedItem = dragState !== null ? items[dragState.index] : null;
	const noop = () => {};
	const previewMeta: ReorderableListItemMeta | null = dragState && {
		index: dragState.index,
		displayIndex: dragOverIndex ?? dragState.index,
		isDragging: true,
		isDisabled: true,
		canMoveUp: false,
		canMoveDown: false,
		moveUp: noop,
		moveDown: noop,
		remove: noop,
	};

	if (items.length === 0 && emptyMessage) {
		return <>{emptyMessage}</>;
	}

	return (
		<div className={clsx("flex flex-col gap-1 w-full", className)}>
			<ol ref={listRef} className="flex flex-col gap-1 w-full">
				{displayItems.map((entry) => {
					if (entry.type === "placeholder") {
						return (
							<li
								key="__reorder_drop_placeholder__"
								data-display-index={entry.hitIndex}
								style={{ height: dragState ? `${dragState.height}px` : undefined }}
								className="flex items-center gap-2 rounded-md border-2 border-dashed border-primary/40 bg-surface-secondary/40 px-2 py-1 text-sm select-none transition-all"
								aria-hidden="true"
							>
								{showIndex && (
									<span className="w-5 shrink-0 text-xs font-mono text-muted/50">
										{entry.displayIndex}
									</span>
								)}
								<span className="min-w-0 flex-1 truncate text-xs text-muted/50 italic">
									{placeholderText}
								</span>
							</li>
						);
					}

					const { item, originalIndex, displayIndex } = entry;
					const itemKey = getKey ? getKey(item, originalIndex) : originalIndex;
					const controls = isEditable && !isItemLocked?.(item);
					const dropClasses = clsx(
						entry.isDropTarget && "border-primary ring-2 ring-primary/40",
						entry.isPinnedSource && "opacity-40",
					);

					const meta: ReorderableListItemMeta = {
						index: originalIndex,
						displayIndex,
						isDragging: dragState?.index === originalIndex,
						isDisabled: !isEditable || dragState !== null,
						canMoveUp: (displayIndex > 0 || isPinned(originalIndex)) && dragState === null,
						canMoveDown: displayIndex < items.length - 1 && dragState === null,
						// a pinned row moving up leaves its pin and lands just above it
						moveUp: () =>
							handleMove(originalIndex, isPinned(originalIndex) ? originalIndex : originalIndex - 1),
						moveDown: () => handleMove(originalIndex, originalIndex + 1),
						remove: onRemove ? () => onRemove(item, originalIndex) : undefined,
					};

					if (renderItem) {
						return (
							<li
								key={itemKey}
								data-display-index={entry.hitIndex}
								onPointerDown={(e) => handlePointerDown(e, originalIndex)}
								onMouseEnter={(e) => onItemMouseEnter?.(item, e.currentTarget)}
								onMouseLeave={() => onItemMouseLeave?.(item)}
								onFocus={(e) => onItemFocus?.(item, e.currentTarget)}
								onBlur={() => onItemBlur?.(item)}
								className={clsx(
									editableItemClasses(isEditable, dragState !== null),
								dropClasses,
									itemClassName,
								)}
							>
								{renderItem(item, meta)}
							</li>
						);
					}

					return (
						<li
							key={itemKey}
							data-display-index={entry.hitIndex}
							onPointerDown={(e) => handlePointerDown(e, originalIndex)}
							onMouseEnter={(e) => onItemMouseEnter?.(item, e.currentTarget)}
							onMouseLeave={() => onItemMouseLeave?.(item)}
							onFocus={(e) => onItemFocus?.(item, e.currentTarget)}
							onBlur={() => onItemBlur?.(item)}
							className={clsx(
								"group flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground transition-colors",
								editableItemClasses(isEditable, dragState !== null),
								dropClasses,
								itemClassName,
							)}
						>
							{controls && (
								<span
									data-drag-handle
									aria-hidden="true"
									className="-my-1 -ml-1.5 flex shrink-0 cursor-grab touch-none items-center self-stretch rounded-l-md px-1.5 text-muted transition-colors group-hover:text-foreground hover:bg-foreground/10 active:cursor-grabbing active:bg-foreground/15"
								>
									<TbGripVertical />
								</span>
							)}
							{showIndex && (
								<span className="w-5 shrink-0 text-xs text-muted">{displayIndex}</span>
							)}
							<div className="min-w-0 flex-1 truncate">
								{renderItemContent
									? renderItemContent(item, meta)
									: (getItemLabel ? getItemLabel(item, originalIndex) : String(item))}
							</div>
							{renderActions?.(item, meta)}
							{controls && (showMoveButtons || onRemove) && (
								<div className="flex items-center gap-0.5 shrink-0">
									{showMoveButtons && (
										<>
											<Button
												isIconOnly
												size="sm"
												variant="ghost"
												aria-label="Move item up"
												isDisabled={!meta.canMoveUp}
												onPress={meta.moveUp}
											>
												<TbChevronUp />
											</Button>
											<Button
												isIconOnly
												size="sm"
												variant="ghost"
												aria-label="Move item down"
												isDisabled={!meta.canMoveDown}
												onPress={meta.moveDown}
											>
												<TbChevronDown />
											</Button>
										</>
									)}
									{onRemove && (
										<Button
											isIconOnly
											size="sm"
											variant="ghost"
											aria-label={
												typeof removeButtonAriaLabel === "function"
													? removeButtonAriaLabel(item, originalIndex)
													: removeButtonAriaLabel ?? "Remove item"
											}
											isDisabled={meta.isDisabled}
											onPress={() => onRemove(item, originalIndex)}
											className="text-muted hover:text-danger hover:bg-danger/10 transition-colors"
										>
											<TbX />
										</Button>
									)}
								</div>
							)}
						</li>
					);
				})}
			</ol>

			{/* Floating Trello-style Drag Preview: 100% Opaque, Elevated Shadow, Zero Tilt */}
			{dragState &&
				previewMeta &&
				draggedItem &&
				createPortal(
					<div
						className="fixed pointer-events-none z-[9999] flex items-center gap-2 rounded-md border border-primary/50 bg-surface px-2 py-1 text-sm text-foreground shadow-2xl ring-1 ring-primary/20 select-none"
						style={{
							top: 0,
							left: 0,
							width: `${dragState.width}px`,
							height: `${dragState.height}px`,
							transform: `translate3d(${dragState.x - dragState.offsetX}px, ${dragState.y - dragState.offsetY}px, 0)`,
							opacity: 1,
						}}
					>
						{renderPreview ? (
							renderPreview(draggedItem, previewMeta)
						) : (
							<>
								<TbGripVertical className="shrink-0 text-primary cursor-grabbing" />
								{showIndex && (
									<span className="w-5 shrink-0 text-xs font-semibold text-primary">
										{dragOverIndex ?? dragState.index}
									</span>
								)}
								<div className="min-w-0 flex-1 truncate font-medium text-foreground">
									{renderItemContent
										? renderItemContent(draggedItem, previewMeta)
										: (getItemLabel
												? getItemLabel(draggedItem, dragState.index)
												: String(draggedItem))}
								</div>
								{(showMoveButtons || onRemove) && (
									<div className="flex items-center gap-0.5 opacity-40 shrink-0">
										{showMoveButtons && (
											<>
												<Button isIconOnly size="sm" variant="ghost" isDisabled>
													<TbChevronUp />
												</Button>
												<Button isIconOnly size="sm" variant="ghost" isDisabled>
													<TbChevronDown />
												</Button>
											</>
										)}
										{onRemove && (
											<Button isIconOnly size="sm" variant="ghost" isDisabled>
												<TbX />
											</Button>
										)}
									</div>
								)}
							</>
						)}
					</div>,
					document.body,
				)}
		</div>
	);
}

function editableItemClasses(editable: boolean, isAnyDragging: boolean) {
	if (!editable) return "";
	if (isAnyDragging) return "select-none pointer-events-none";
	return "hover:border-border-secondary hover:bg-surface-secondary";
}
