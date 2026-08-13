import { useEffect, useRef, type ReactNode } from "react";
import { Spinner } from "@heroui/react";

export interface LazyLoaderProps<T> {
	items: T[];
	isLoading: boolean;
	isFetchingNextPage: boolean;
	hasNextPage: boolean;
	fetchNextPage: () => void;
	renderItem: (item: T, index: number) => ReactNode;
	emptyMessage?: ReactNode;
	className?: string;
}

export function LazyLoader<T>({
	items,
	isLoading,
	isFetchingNextPage,
	hasNextPage,
	fetchNextPage,
	renderItem,
	emptyMessage = "No items found.",
	className = "flex flex-col gap-2",
}: LazyLoaderProps<T>) {
	const observerTarget = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const target = observerTarget.current;
		if (!target) return;

		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage && !isLoading) {
					fetchNextPage();
				}
			},
			{ threshold: 0.1 },
		);

		observer.observe(target);
		return () => {
			if (target) observer.unobserve(target);
		};
	}, [hasNextPage, isFetchingNextPage, isLoading, fetchNextPage]);

	return (
		<div className={className}>
			{items.map((item, index) => renderItem(item, index))}

			{isLoading && items.length === 0 && (
				<div className="flex justify-center py-4">
					<Spinner />
				</div>
			)}

			{!isLoading && items.length === 0 && (
				<div className="py-4 text-center text-sm text-muted-foreground">{emptyMessage}</div>
			)}

			{/* Intersection Observer Target */}
			<div ref={observerTarget} className="h-4 w-full" />

			{isFetchingNextPage && (
				<div className="flex justify-center py-4">
					<Spinner size="sm" />
				</div>
			)}
		</div>
	);
}
