import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@fluxify/components";

export const Route = createFileRoute("/")({
	component: Home,
});

function Home() {
	return (
		<main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background text-foreground">
			<h1 className="text-2xl font-semibold tracking-tight">Fluxify Portal</h1>
			<p className="text-muted">Scaffold running. Login page next.</p>
			<Button variant="primary">HeroUI OK</Button>
		</main>
	);
}
