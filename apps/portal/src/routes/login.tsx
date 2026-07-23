import { useState } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import {
	Button,
	Card,
	TextField,
	Label,
	Input,
	FieldError,
	Separator,
	toast,
} from "@fluxify/components";
import { isAxiosError } from "axios";
import { authClient } from "@/lib/auth";
import { showErrorNotification } from "@/lib/errorNotifier";

const logo = `${import.meta.env.BASE_URL}logo_title.webp`;

export const Route = createFileRoute("/login")({
	validateSearch: z.object({ next: z.string().optional() }),
	beforeLoad: async ({ search }) => {
		const session = await authClient.getSession();
		if (session.data?.user) {
			// ponytail: `next` is a raw path; cast until project routes are typed
			throw redirect({ to: (search.next ?? "/") as "/" });
		}
	},
	component: LoginPage,
});

function LoginPage() {
	return (
		<div className="flex min-h-screen w-screen items-center justify-center bg-background p-4 text-foreground">
			<Card className="w-full max-w-105 border border-border p-8 shadow-2xl shadow-black/50">
				<LoginForm />
			</Card>
		</div>
	);
}

function LoginForm() {
	const navigate = useNavigate();
	const { next } = Route.useSearch();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
	const [loading, setLoading] = useState(false);

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		setLoading(true);
		setErrors({});
		try {
			const result = await authClient.signIn.email({ email, password });
			if (result.error) {
				toast.danger(result.error.message ?? "Failed to login");
				return;
			}
			if (result.data?.user) {
				toast.success(`Logged in as ${result.data.user.email}`);
				navigate({ to: (next ?? "/") as "/" });
			}
		} catch (error) {
			if (isAxiosError(error) && error.response?.data?.type === "validation") {
				const fieldErrors: Record<string, string> = {};
				for (const err of error.response.data.errors)
					fieldErrors[err.field] = err.message;
				setErrors(fieldErrors);
			} else {
				showErrorNotification(error as Error, false);
			}
		} finally {
			setLoading(false);
		}
	}

	return (
		<form onSubmit={onSubmit} className="flex flex-col gap-8">
			<div className="flex flex-col items-center gap-2 text-center">
				<img src={logo} alt="Fluxify" className="mb-2 h-9 object-contain" />
				<h1 className="text-xl font-semibold tracking-tight text-foreground">
					Welcome back
				</h1>
				<p className="text-sm text-muted">
					Sign in to your account to continue
				</p>
			</div>

			<div className="flex flex-col gap-4">
				<TextField
					type="email"
					isRequired
					value={email}
					onChange={setEmail}
					isInvalid={!!errors.email}
				>
					<Label>Email address</Label>
					<Input placeholder="name@company.com" />
					<FieldError>{errors.email}</FieldError>
				</TextField>

				<TextField
					type="password"
					isRequired
					value={password}
					onChange={setPassword}
					isInvalid={!!errors.password}
				>
					<Label>Password</Label>
					<Input placeholder="Enter your password" />
					<FieldError>{errors.password}</FieldError>
				</TextField>
			</div>

			<div className="flex flex-col gap-3">
				<Button type="submit" variant="primary" fullWidth isPending={loading}>
					Sign In
				</Button>

				<div className="flex items-center gap-3 py-1 text-xs text-muted">
					<Separator className="flex-1" />
					OR
					<Separator className="flex-1" />
				</div>

				<Button
					type="button"
					variant="outline"
					fullWidth
					onPress={() => toast.info("SSO Login is not configured yet.")}
				>
					Continue with SSO
				</Button>
			</div>
		</form>
	);
}
