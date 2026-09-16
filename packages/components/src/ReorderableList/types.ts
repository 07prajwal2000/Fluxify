import type { ReactNode } from "react";

export interface ReorderableListItemMeta {
	index: number;
	displayIndex: number;
	isDragging: boolean;
	isDisabled: boolean;
	canMoveUp: boolean;
	canMoveDown: boolean;
	moveUp: () => void;
	moveDown: () => void;
	remove?: () => void;
}

export interface ReorderableListProps<T> {
	items: T[];
	getKey?: (item: T, index: number) => string | number;
	onReorder?: (newItems: T[], fromIndex: number, toIndex: number) => void;
	onMove?: (fromIndex: number, toIndex: number) => void;
	onRemove?: (item: T, index: number) => void;
	removeButtonAriaLabel?: string | ((item: T, index: number) => string);
	isEditable?: boolean;
	showIndex?: boolean;
	showMoveButtons?: boolean;
	placeholderText?: string;
	emptyMessage?: ReactNode;
	className?: string;
	itemClassName?: string;
	getItemLabel?: (item: T, index: number) => ReactNode;
	/** custom rows drag only from an element marked `data-drag-handle` */
	renderItem?: (item: T, meta: ReorderableListItemMeta) => ReactNode;
	renderItemContent?: (item: T, meta: ReorderableListItemMeta) => ReactNode;
	renderActions?: (item: T, meta: ReorderableListItemMeta) => ReactNode;
	renderPreview?: (item: T, meta: ReorderableListItemMeta) => ReactNode;
	onItemMouseEnter?: (item: T, targetEl: HTMLElement) => void;
	onItemMouseLeave?: (item: T) => void;
	onItemFocus?: (item: T, targetEl: HTMLElement) => void;
	onItemBlur?: (item: T) => void;
	onDragStart?: (item: T, index: number, targetEl: HTMLElement) => void;
	onDragEnd?: () => void;
	/** a locked item can't be dragged and shows no grip or buttons */
	isItemLocked?: (item: T) => boolean;
	/**
	 * A pinned item keeps its place while others are dragged, and dropping onto it
	 * calls onMove(from, pinnedIndex). Dragging a pinned item out calls
	 * onMove(pinnedIndex, to), where `to` may equal its own index. Pin only the last item.
	 */
	isItemPinned?: (item: T) => boolean;
}
