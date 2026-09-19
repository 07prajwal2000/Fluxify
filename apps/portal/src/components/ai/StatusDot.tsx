import { statusDotClass, statusMeta } from "./statusMeta";

export function StatusDot({ status }: { status: string }) {
	const { label, color } = statusMeta(status);
	const pulse = color === "accent" || color === "warning";
	return (
		<span
			role="img"
			aria-label={label}
			title={label}
			className={`inline-block size-2 shrink-0 rounded-full ${statusDotClass(color)} ${
				pulse ? "animate-pulse" : ""
			}`}
		/>
	);
}
