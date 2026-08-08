"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { useState } from "react";

import { AuthDivider, GoogleButton } from "@/components/auth/google-button";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { useAuth } from "@/hooks/use-auth";
import { ApiError } from "@/lib/api";
import { fieldErrors, loginSchema } from "@/lib/validation";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});

    const form = new FormData(event.currentTarget);
    const parsed = loginSchema.safeParse({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });

    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }

    setSubmitting(true);
    try {
      await login(parsed.data);
      router.push("/dashboard");
    } catch (error) {
      setErrors({
        form:
          error instanceof ApiError
            ? error.message
            : "Something went wrong. Please try again.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Welcome back</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Sign in to reach your videos and transcripts.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {errors.form && (
          <div
            role="alert"
            className="flex gap-2.5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
          >
            <AlertCircle className="mt-px size-4 shrink-0" />
            <span>{errors.form}</span>
          </div>
        )}

        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          error={errors.email}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          error={errors.password}
        />

        <Button type="submit" size="lg" loading={submitting} className="w-full">
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <AuthDivider />
      <GoogleButton label="Continue with Google" />

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link href="/register" className="font-medium text-primary hover:underline">
          Create one
        </Link>
      </p>
    </>
  );
}
