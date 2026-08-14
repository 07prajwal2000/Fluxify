import { cn } from "@fluxify/components";
import { FiMail, FiShield } from "react-icons/fi";

export type AuthType = "traditional" | "sso";

const CheckIcon = ({ className }: { className?: string }) => (
	<svg
		viewBox="0 0 24 24"
		className={className}
		fill="none"
		xmlns="http://www.w3.org/2000/svg"
	>
		<circle cx="12" cy="12" r="12" fill="currentColor" />
		<path
			d="M7 12.5L10 15.5L17 8.5"
			stroke="var(--accent-foreground, #000)"
			strokeWidth="2.5"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

interface AuthModeCardProps {
	type: AuthType;
	onChange: (type: AuthType) => void;
}

export function AuthModeCard({ type, onChange }: AuthModeCardProps) {
	return (
		<div className="grid grid-cols-2 gap-3">
			<button
				type="button"
				onClick={() => onChange("traditional")}
				className={cn(
					"relative flex flex-col text-left p-4 rounded-[12px] border transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
					type === "traditional"
						? "border-accent bg-accent/5"
						: "border-border bg-background hover:bg-surface-secondary",
				)}
			>
				<div className="flex w-full items-start justify-between mb-4">
					<div
						className={cn(
							"flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
							type === "traditional"
								? "bg-accent text-accent-foreground"
								: "bg-transparent border border-border text-muted",
						)}
					>
						<FiMail className="h-4 w-4" />
					</div>
					<div className="flex items-center gap-1.5">
						<span className="rounded bg-transparent border border-border px-2 py-0.5 text-[10px] font-medium text-muted">
							Default
						</span>
						{type === "traditional" && (
							<CheckIcon className="h-5 w-5 text-accent" />
						)}
					</div>
				</div>
				<div>
					<h4 className="text-sm font-bold text-foreground mb-1">
						Traditional (Email + Password)
					</h4>
					<p className="text-xs text-muted leading-relaxed">
						Email + Password with optional 2FA. Best for small teams.
					</p>
				</div>
			</button>

			<button
				type="button"
				onClick={() => onChange("sso")}
				className={cn(
					"relative flex flex-col text-left p-4 rounded-[12px] border transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
					type === "sso"
						? "border-accent bg-accent/5"
						: "border-border bg-background hover:bg-surface-secondary",
				)}
			>
				<div className="flex w-full items-start justify-between mb-4">
					<div
						className={cn(
							"flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
							type === "sso"
								? "bg-accent text-accent-foreground"
								: "bg-transparent border border-border text-muted",
						)}
					>
						<FiShield className="h-4 w-4" />
					</div>
					<div className="flex items-center gap-1.5">
						<span className="rounded bg-transparent border border-border px-2 py-0.5 text-[10px] font-medium text-muted">
							Enterprise
						</span>
						{type === "sso" && <CheckIcon className="h-5 w-5 text-accent" />}
					</div>
				</div>
				<div>
					<h4 className="text-sm font-bold text-foreground mb-1">SSO Only</h4>
					<p className="text-xs text-muted leading-relaxed">
						Enforce enterprise identity. Password login hidden for all users.
					</p>
				</div>
			</button>
		</div>
	);
}
