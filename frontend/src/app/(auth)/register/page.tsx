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
import { fieldErrors, registerSchema } from "@/lib/validation";

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
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Create an account</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Everything runs on your own machine. No card, no per-minute billing.
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
          // A hint, not an error: the requirement is stated up front rather
          // than sprung on submit.
          hint="At least 8 characters"
          error={errors.password}
        />

        <Button type="submit" size="lg" loading={submitting} className="w-full">
          {submitting ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <AuthDivider />
      <GoogleButton label="Continue with Google" />

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
