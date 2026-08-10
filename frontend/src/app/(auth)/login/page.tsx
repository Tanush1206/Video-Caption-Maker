"use client";

import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { GlassField, GlassLink, GlassSubmit } from "@/components/auth/glass-field";
import { GoogleMark } from "@/components/auth/google-mark";
import { useAuth } from "@/hooks/use-auth";
import { ApiError } from "@/lib/api";
import { fieldErrors, loginSchema } from "@/lib/validation";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/**
 * Sign-in, on the same glass controls as registration.
 *
 * Deliberately still one step. The multi-step flow on sign-up earns its
 * friction by catching a mistyped password before it becomes permanent; here
 * a wrong password just fails and you try again, so splitting it would be
 * ceremony for its own sake.
 *
 * The inputs are controlled now rather than read from FormData on submit,
 * because the floating label has to know whether the field has a value.
 */
export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});

    const parsed = loginSchema.safeParse({ email, password });
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
      <div className="text-center">
        <h1 className="text-4xl font-light tracking-tight sm:text-5xl">Welcome back</h1>
        <p className="mx-auto mt-3 max-w-xs text-body-sm text-muted-foreground">
          Sign in to reach your videos and transcripts.
        </p>
      </div>

      <fieldset disabled={submitting} className="mx-auto mt-8 w-full max-w-[300px]">
        <GlassLink href={`${API_URL}/api/auth/google/authorize`}>
          <GoogleMark />
          Continue with Google
        </GlassLink>

        <div className="mt-5 flex items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          <span className="label-caps">or</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-6">
          {errors.form && (
            <div
              role="alert"
              className="flex gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-body-sm text-destructive"
            >
              <AlertCircle className="mt-px size-4 shrink-0" />
              <span>{errors.form}</span>
            </div>
          )}

          <GlassField
            label="Email"
            icon={Mail}
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="Email"
            value={email}
            labelVisible={email.length > 0}
            error={errors.email}
            onChange={(event) => setEmail(event.target.value)}
          />

          <GlassField
            label="Password"
            icon={Lock}
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            labelVisible={password.length > 0}
            error={errors.password}
            onChange={(event) => setPassword(event.target.value)}
            leading={
              password.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowPassword((shown) => !shown)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="rounded-full p-2 text-foreground/80 transition-colors hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
                </button>
              ) : undefined
            }
          />

          <GlassSubmit type="submit">
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Signing in…
              </>
            ) : (
              <>
                Sign in
                <ArrowRight className="size-4" />
              </>
            )}
          </GlassSubmit>
        </form>
      </fieldset>

      <p className="mt-10 text-center text-body-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link href="/register" className="font-medium text-primary hover:underline">
          Create one
        </Link>
      </p>
    </>
  );
}

