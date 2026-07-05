import { useEffect, useRef, useState, useLayoutEffect, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { VirtualItemData } from "./types";

interface UseVirtualChatScrollParams {
	items: VirtualItemData[];
	hasNextPage?: boolean;
	isFetchingNextPage?: boolean;
	fetchNextPage?: () => void;
}

export const useVirtualChatScroll = ({
	items,
	hasNextPage,
	isFetchingNextPage,
	fetchNextPage,
}: UseVirtualChatScrollParams) => {
	const parentRef = useRef<HTMLDivElement>(null);
	const [showScrollBottomButton, setShowScrollBottomButton] = useState(false);

	const isInitialLoadRef = useRef(true);
	const isFetchingOlderRef = useRef(false);
	const prevScrollHeightRef = useRef(0);
	const prevScrollTopRef = useRef(0);
	const prevItemsLengthRef = useRef(0);

	const rowVirtualizer = useVirtualizer({
		count: items.length,
		getScrollElement: () => parentRef.current,
		estimateSize: () => 180,
		getItemKey: (index) => items[index]?.id ?? index,
		overscan: 5,
	});

	const virtualItems = rowVirtualizer.getVirtualItems();

	// Trigger pagination when top 4th message (visible index <= 1) is shown
	useEffect(() => {
		if (
			virtualItems.length > 0 &&
			hasNextPage &&
			!isFetchingNextPage &&
			!isFetchingOlderRef.current
		) {
			const firstVisibleIndex = virtualItems[0].index;
			if (firstVisibleIndex <= 1) {
				if (parentRef.current) {
					prevScrollHeightRef.current = parentRef.current.scrollHeight;
					prevScrollTopRef.current = parentRef.current.scrollTop;
					isFetchingOlderRef.current = true;
				}
				fetchNextPage?.();
			}
		}
	}, [virtualItems, hasNextPage, isFetchingNextPage, fetchNextPage]);

	// Maintain scroll offset after older messages are prepended
	useLayoutEffect(() => {
		if (isFetchingOlderRef.current && parentRef.current) {
			const newScrollHeight = parentRef.current.scrollHeight;
			const diff = newScrollHeight - prevScrollHeightRef.current;
			if (diff > 0) {
				parentRef.current.scrollTop = prevScrollTopRef.current + diff;
			}
			isFetchingOlderRef.current = false;
		}
	}, [items]);

	// Scroll management on initial load vs new message push
	useEffect(() => {
		if (items.length === 0) return;

		if (isInitialLoadRef.current) {
			const timeout = setTimeout(() => {
				if (parentRef.current) {
					parentRef.current.scrollTop = parentRef.current.scrollHeight;
				} else {
					rowVirtualizer.scrollToIndex(items.length - 1, { align: "end" });
				}
				isInitialLoadRef.current = false;
			}, 50);
			prevItemsLengthRef.current = items.length;
			return () => clearTimeout(timeout);
		}

		if (!isFetchingOlderRef.current && items.length > prevItemsLengthRef.current) {
			const newMsgIndex = items.length - 1;
			rowVirtualizer.scrollToIndex(newMsgIndex, {
				align: "start",
				behavior: "smooth",
			});
		}

		prevItemsLengthRef.current = items.length;
	}, [items.length, rowVirtualizer]);

	const handleScroll = useCallback(() => {
		if (!parentRef.current) return;
		const { scrollTop, scrollHeight, clientHeight } = parentRef.current;
		const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
		setShowScrollBottomButton(distanceFromBottom > 200);
	}, []);

	const scrollToBottom = useCallback(() => {
		if (parentRef.current) {
			parentRef.current.scrollTo({
				top: parentRef.current.scrollHeight,
				behavior: "smooth",
			});
		} else {
			rowVirtualizer.scrollToIndex(items.length - 1, {
				align: "end",
				behavior: "smooth",
			});
		}
	}, [items.length, rowVirtualizer]);

	return {
		parentRef,
		rowVirtualizer,
		showScrollBottomButton,
		handleScroll,
		scrollToBottom,
	};
};
