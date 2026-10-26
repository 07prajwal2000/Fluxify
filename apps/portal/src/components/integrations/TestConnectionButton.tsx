import { Button } from "@fluxify/components";
import type { ReactNode } from "react";
import { useRef } from "react";
import { TbBolt } from "react-icons/tb";

/** One signal per attempt; `abort` cancels the attempt in flight. */
export function useTestAbort() {
	const controller = useRef<AbortController | null>(null);
	return {
		next() {
			controller.current = new AbortController();
			return controller.current.signal;
		},
		abort: () => controller.current?.abort(),
	};
}

/**
 * A Test connection button that offers Cancel while its test runs. `onCancel`
 * aborts the request and resets the mutation, so the UI is idle at once.
 */
export function TestConnectionButton({
	isPending,
	onPress,
	onCancel,
	children = "Test connection",
}: {
	isPending: boolean;
	onPress: () => void;
	onCancel: () => void;
	children?: ReactNode;
}) {
	return (
		<>
			<Button
				variant="outline"
				size="sm"
				isPending={isPending}
				onPress={onPress}
				className="whitespace-nowrap"
			>
				<TbBolt size={14} className="text-accent" />
				<span>{children}</span>
			</Button>
			{isPending && (
				<Button variant="ghost" size="sm" onPress={onCancel} className="whitespace-nowrap">
					Cancel
				</Button>
			)}
		</>
	);
}
