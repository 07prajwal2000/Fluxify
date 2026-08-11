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
import { BASE_PATH } from "@/constants/routes";

import { usePublicSettings } from "@/hooks/usePublicSettings";

const logo = `${import.meta.env.BASE_URL}icons/logo.svg`;
const SSO_ERROR_MESSAGES: Record<string, string> = {
	ACCOUNT_NOT_PRE_PROVISIONED: "Cannot find user. Contact an administrator.",
	"signup disabled": "Cannot find user. Contact an administrator.",
	signup_disabled: "Cannot find user. Contact an administrator.",
};

export const Route = createFileRoute("/login")({
	validateSearch: z.object({
		next: z.string().optional(),
		error: z.string().optional(),
	}),
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
	const { next, error: errorCode } = Route.useSearch();
	const { ssoConfig, isLoading } = usePublicSettings();
	const [showEmailForm, setShowEmailForm] = useState(false);
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
	const [loading, setLoading] = useState(false);
	const ssoError = errorCode
		? (SSO_ERROR_MESSAGES[errorCode] ??
			"Authentication failed. Please try again or contact an administrator.")
		: undefined;

	const isSsoEnabled = ssoConfig?.enabled;
	const currentView = isSsoEnabled && !showEmailForm ? "sso" : "email";

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

	async function onSsoLogin() {
		setLoading(true);
		try {
			const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
			const callback = next ? `${baseUrl}${next.startsWith("/") ? next : `/${next}`}` : import.meta.env.BASE_URL;
			const errorCallbackURL = new URL(
				`${BASE_PATH}/login`,
				window.location.origin,
			).toString();

			const result = await authClient.signIn.sso({
				providerId: ssoConfig?.providerId ?? "enterprise",
				callbackURL: callback,
				errorCallbackURL,
			});
			if (result.error) {
				toast.danger(result.error.message ?? "Failed to initiate SSO");
				setLoading(false);
			}
		} catch (error) {
			showErrorNotification(error as Error, false);
			setLoading(false);
		}
	}

	return (
		<div className="flex flex-col gap-8">
			<div className="flex flex-col items-center gap-1 text-center mb-2">
				<div className="flex items-center justify-center gap-3 mb-2">
					<img src={logo} alt="Fluxify Logo" className="h-20 w-20 object-contain" />
					<span className="text-2xl font-bold tracking-widest text-foreground">FLUXIFY</span>
				</div>
				<h1 className="text-xl font-semibold tracking-tight text-foreground">
					Welcome back
				</h1>
				<p className="text-sm text-muted">
					Sign in to your account to continue
				</p>
			</div>

			{ssoError ? (
				<p role="alert" className="text-center text-sm text-danger">
					{ssoError}
				</p>
			) : null}

			{isLoading ? (
				<div className="flex h-32 items-center justify-center">
					<div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
				</div>
			) : currentView === "sso" ? (
				<div className="flex flex-col gap-4">
					<Button
						type="button"
						variant="primary"
						fullWidth
						isPending={loading}
						onPress={onSsoLogin}
					>
						Continue with SSO
					</Button>
					<div className="text-center mt-2">
						<button
							type="button"
							onClick={() => setShowEmailForm(true)}
							className="text-xs text-muted hover:text-foreground underline decoration-muted hover:decoration-foreground underline-offset-4"
						>
							Admin Login
						</button>
					</div>
				</div>
			) : (
				<form onSubmit={onSubmit} className="flex flex-col gap-8">
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

						{isSsoEnabled && (
							<>
								<div className="flex items-center gap-3 py-1 text-xs text-muted">
									<Separator className="flex-1" />
									OR
									<Separator className="flex-1" />
								</div>
								<Button
									type="button"
									variant="outline"
									fullWidth
									onPress={() => setShowEmailForm(false)}
								>
									Back to SSO Login
								</Button>
							</>
						)}
					</div>
				</form>
			)}
		</div>
	);
}
