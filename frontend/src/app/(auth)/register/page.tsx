"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Field } from "@/components/ui/field";
import { useAuth } from "@/hooks/use-auth";
import { ApiError } from "@/lib/api";
import { fieldErrors, registerSchema } from "@/lib/validation";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export default function RegisterPage() {
  const router = useRouter();
  const { register } = useAuth();

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});

    const form = new FormData(event.currentTarget);
    const fullName = String(form.get("full_name") ?? "").trim();

    const parsed = registerSchema.safeParse({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      full_name: fullName || undefined,
    });

    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }

    setSubmitting(true);
    try {
      await register(parsed.data);
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
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold mb-6">Create an account</h1>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {errors.form && (
            <p role="alert" className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-500">
              {errors.form}
            </p>
          )}

          <Field
            label="Name"
            name="full_name"
            autoComplete="name"
            placeholder="Optional"
            error={errors.full_name}
          />
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
            autoComplete="new-password"
            placeholder="At least 8 characters"
            error={errors.password}
          />

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
          >
            {submitting ? "Creating account…" : "Create account"}
          </button>
        </form>

        <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          OR
          <span className="h-px flex-1 bg-border" />
        </div>

        <a
          href={`${API_URL}/api/auth/google/authorize`}
          className="block w-full rounded-md border border-border px-4 py-2 text-center font-medium transition hover:bg-muted"
        >
          Continue with Google
        </a>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
