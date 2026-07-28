import { useEffect, useState, useCallback, type RefObject } from "react";

export function useScrollToBottom(bottomRef: RefObject<HTMLElement | null>, threshold = 250) {
	const [isAtBottom, setIsAtBottom] = useState(true);

	useEffect(() => {
		if (!bottomRef.current) return;

		const observer = new IntersectionObserver(
			([entry]) => {
				setIsAtBottom(entry.isIntersecting);
			},
			{
				rootMargin: `0px 0px ${threshold}px 0px`,
			}
		);

		observer.observe(bottomRef.current);
		return () => observer.disconnect();
	}, [bottomRef, threshold]);

	const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
		bottomRef.current?.scrollIntoView({ behavior, block: "center" });
	}, [bottomRef]);

	return { isAtBottom, scrollToBottom };
}
