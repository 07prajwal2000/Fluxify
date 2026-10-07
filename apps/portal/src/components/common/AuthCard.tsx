import { Card } from "@fluxify/components";
import type { ReactNode } from "react";

const logo = `${import.meta.env.BASE_URL}icons/logo.svg`;

/** The centered card the sign-in pages sit in: login and OAuth consent. */
export function AuthCard({ children }: { children: ReactNode }) {
	return (
		<div className="flex min-h-screen w-screen items-center justify-center bg-background p-4 text-foreground">
			<Card className="w-full max-w-105 border border-border p-8 shadow-2xl shadow-black/50">
				{children}
			</Card>
		</div>
	);
}

export function FluxifyBrand() {
	return (
		<div className="flex items-center justify-center gap-3 mb-2">
			<img src={logo} alt="Fluxify Logo" className="h-20 w-20 object-contain" />
			<span className="text-2xl font-bold tracking-widest text-foreground">FLUXIFY</span>
		</div>
	);
}
