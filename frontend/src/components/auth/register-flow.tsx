"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  PartyPopper,
  User,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { GlassField, GlassIconButton, GlassLink } from "@/components/auth/glass-field";
import { GoogleMark } from "@/components/auth/google-mark";
import { useAuth } from "@/hooks/use-auth";
import { ApiError } from "@/lib/api";
import { registerSchema } from "@/lib/validation";

import { API_URL } from "@/lib/config";

/** How long the success state stays up before redirecting. Long enough to read. */
const CELEBRATION_MS = 1600;

type Step = "email" | "password" | "confirm";
type Status = "idle" | "submitting" | "error" | "success";

const STEP_COPY: Record<Step, { title: string; hint: string }> = {
  email: { title: "Get started with us", hint: "Continue with" },
  password: {
    title: "Create your password",
    hint: "At least 8 characters. There is no password reset, so pick something you'll keep.",
  },
  confirm: { title: "One last step", hint: "Confirm your password to continue" },
};

/**
 * Registration, as a three-step glass flow.
 *
 * The 21st.dev component this is modelled on is a **mock**: its submit handler
 * runs a `setTimeout`, fires confetti and resolves. There is no request in it
 * anywhere. Dropped in as written it would have shown "Welcome Aboard!" and
 * created no account.
 *
 * So the shell is the design and the inside is ours: `registerSchema` for
 * validation (8 characters and bcrypt's 72-byte ceiling, the same rules the
 * API enforces, rather than the original's 6), `useAuth().register` for the
 * request, and real API errors in the modal instead of a hardcoded string.
 *
 * The original's staged loading sequence — "Signing you up…", "Onboarding
 * you…", "Finalizing…", 4.5 seconds on a fixed timer — is gone. Registration
 * is one POST. Three invented stages would be padding a request that takes a
 * fraction of that, and dressing a wait up as progress it isn't making.
 *
 * Why three steps at all, when the old single form worked: there is no
 * password-reset flow in this app. A mistyped password on sign-up locks the
 * account permanently, which is what makes a confirm step worth the friction.
 */
export function RegisterFlow() {
  const router = useRouter();
  const { register } = useAuth();

  const [step, setStep] = useState<Step>("email");
  const [status, setStatus] = useState<Status>("idle");

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  /** Where dismissing the error modal should land. Null means "stay put". */
  const [recoverStep, setRecoverStep] = useState<Step | null>(null);

  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  const emailOk = registerSchema.shape.email.safeParse(email).success;
  const passwordCheck = registerSchema.shape.password.safeParse(password);
  const busy = status === "submitting" || status === "success";

  // Move focus to whichever field just appeared. Without this the caret stays
  // on the previous step's button and the user has to reach for the mouse.
  useEffect(() => {
    if (step === "password") passwordRef.current?.focus();
    if (step === "confirm") confirmRef.current?.focus();
  }, [step]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFieldError(null);
    if (busy) return;

    if (step === "email") {
      if (!emailOk) {
        setFieldError("Enter a valid email address");
        return;
      }
      setStep("password");
      return;
    }

    if (step === "password") {
      if (!passwordCheck.success) {
        setFieldError(passwordCheck.error.issues[0]?.message ?? "Invalid password");
        return;
      }
      setStep("confirm");
      return;
    }

    if (password !== confirm) {
      setFormError("Those passwords don't match.");
      setStatus("error");
      return;
    }

    // Re-validate the whole payload rather than trusting the per-step checks.
    // They gate the *buttons*; this is what actually goes to the API.
    const parsed = registerSchema.safeParse({
      email,
      password,
      full_name: fullName.trim() || undefined,
    });

    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Please check your details.");
      setStatus("error");
      return;
    }

    setStatus("submitting");
    try {
      await register(parsed.data);
      setStatus("success");
      void celebrate();
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "Something went wrong. Please try again.";
      setFormError(message);
      // Splitting the form across three steps means an email the API rejects
      // is only discovered after the password has been typed twice, and
      // dismissing the modal would drop the user on the confirm step with
      // nothing there to fix. Send them back to the field at fault.
      //
      // The frontend cannot pre-empt this: zod's .email() accepts addresses
      // the backend's validator refuses — anything on a reserved TLD like
      // .test, and any domain already taken.
      if (/email/i.test(message)) setRecoverStep("email");
      setStatus("error");
    }
  }

  // Redirect after the celebration, not immediately — the account exists
  // either way, and cutting the confetti off mid-flight looks like a glitch.
  useEffect(() => {
    if (status !== "success") return;
    const timer = setTimeout(() => router.push("/dashboard"), CELEBRATION_MS);
    return () => clearTimeout(timer);
  }, [status, router]);

  function goBack() {
    setFieldError(null);
    if (step === "confirm") {
      setConfirm("");
      setStep("password");
    } else if (step === "password") {
      setStep("email");
    }
  }

  const copy = STEP_COPY[step];

  return (
    <>
      <StatusModal
        status={status}
        message={formError}
        onDismiss={() => {
          setStatus("idle");
          setFormError(null);
          if (recoverStep) {
            setStep(recoverStep);
            setRecoverStep(null);
          }
        }}
      />

      <fieldset disabled={busy} className="w-full">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ y: 6, opacity: 0, filter: "blur(6px)" }}
            animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, filter: "blur(4px)" }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="text-center"
          >
            <h1 className="text-balance text-4xl font-light tracking-tight sm:text-5xl">
              {copy.title}
            </h1>
            <p className="mx-auto mt-3 max-w-xs text-body-sm text-muted-foreground">
              {copy.hint}
            </p>
          </motion.div>
        </AnimatePresence>

        {step === "email" && (
          <div className="mt-6">
            {/* An anchor, not a fetch: OAuth needs a full-page navigation so
                the browser follows Google's redirect and receives the
                callback's cookie. The original also offered GitHub — there is
                no GitHub provider on this backend, and a button that silently
                does nothing is worse than one that isn't there. */}
            <GlassLink
              href={`${API_URL}/api/auth/google/authorize`}
              className="mx-auto max-w-[300px]"
            >
              <GoogleMark />
              Continue with Google
            </GlassLink>

            <div className="mx-auto mt-5 flex w-full max-w-[300px] items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="label-caps">or</span>
              <span className="h-px flex-1 bg-border" />
            </div>
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          noValidate
          className="mx-auto mt-8 w-full max-w-[300px] space-y-6"
        >
          {step === "email" && (
            <GlassField
              label="Email"
              icon={Mail}
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="Email"
              value={email}
              labelVisible={email.length > 0}
              error={fieldError ?? undefined}
              onChange={(event) => setEmail(event.target.value)}
              action={
                emailOk ? (
                  <GlassIconButton type="submit" aria-label="Continue">
                    <ArrowRight className="size-5" />
                  </GlassIconButton>
                ) : undefined
              }
            />
          )}

          {step === "password" && (
            <GlassField
              ref={passwordRef}
              label="Password"
              icon={Lock}
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              placeholder="Password"
              value={password}
              labelVisible={password.length > 0}
              error={fieldError ?? undefined}
              onChange={(event) => setPassword(event.target.value)}
              leading={
                password.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setShowPassword((shown) => !shown)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="rounded-full p-2 text-foreground/80 transition-colors hover:text-foreground"
                  >
                    {showPassword ? (
                      <EyeOff className="size-5" />
                    ) : (
                      <Eye className="size-5" />
                    )}
                  </button>
                ) : undefined
              }
              action={
                passwordCheck.success ? (
                  <GlassIconButton type="submit" aria-label="Continue">
                    <ArrowRight className="size-5" />
                  </GlassIconButton>
                ) : undefined
              }
            />
          )}

          {step === "confirm" && (
            <>
              <GlassField
                ref={confirmRef}
                label="Confirm password"
                icon={Lock}
                type={showConfirm ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Confirm password"
                value={confirm}
                labelVisible={confirm.length > 0}
                onChange={(event) => setConfirm(event.target.value)}
                leading={
                  confirm.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setShowConfirm((shown) => !shown)}
                      aria-label={showConfirm ? "Hide password" : "Show password"}
                      className="rounded-full p-2 text-foreground/80 transition-colors hover:text-foreground"
                    >
                      {showConfirm ? (
                        <EyeOff className="size-5" />
                      ) : (
                        <Eye className="size-5" />
                      )}
                    </button>
                  ) : undefined
                }
              />

              {/* The old form collected this and the new design had nowhere
                  for it, so it lands on the last step where it reads as the
                  optional extra it is rather than another gate. */}
              <GlassField
                label="Name (optional)"
                icon={User}
                autoComplete="name"
                placeholder="Name (optional)"
                value={fullName}
                labelVisible={fullName.length > 0}
                onChange={(event) => setFullName(event.target.value)}
                action={
                  confirm.length > 0 ? (
                    <GlassIconButton type="submit" aria-label="Create account">
                      <ArrowRight className="size-5" />
                    </GlassIconButton>
                  ) : undefined
                }
              />
            </>
          )}

          {step !== "email" && (
            <button
              type="button"
              onClick={goBack}
              className="flex items-center gap-2 text-body-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
              Go back
            </button>
          )}
        </form>
      </fieldset>

      <p className="mt-10 text-center text-body-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}

/**
 * Declared at module scope, not inside the component.
 *
 * The original defined its modal as a nested function component, which makes
 * it a *new component type* on every render — React unmounts the old tree and
 * mounts a fresh one each time, so the entry animation restarts and any state
 * inside it is lost. It is the kind of bug that looks like a CSS problem.
 */
function StatusModal({
  status,
  message,
  onDismiss,
}: {
  status: Status;
  message: string | null;
  onDismiss: () => void;
}) {
  const open = status === "submitting" || status === "error" || status === "success";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm"
          role={status === "error" ? "alertdialog" : "dialog"}
          aria-modal="true"
          aria-live="assertive"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="relative flex w-full max-w-sm flex-col items-center gap-4 rounded-xl border border-border bg-card p-8 shadow-overlay"
          >
            {status === "error" && (
              <>
                <button
                  type="button"
                  onClick={onDismiss}
                  aria-label="Dismiss"
                  className="absolute right-2 top-2 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
                <AlertCircle className="size-10 text-destructive" aria-hidden="true" />
                <p className="text-center text-body-md font-medium">{message}</p>
                <button
                  type="button"
                  onClick={onDismiss}
                  className="mt-2 text-body-sm font-medium text-primary hover:underline"
                >
                  Try again
                </button>
              </>
            )}

            {status === "submitting" && (
              <>
                <Loader2 className="size-10 animate-spin text-primary" aria-hidden="true" />
                <p className="text-body-md font-medium">Creating your account…</p>
              </>
            )}

            {status === "success" && (
              <>
                <PartyPopper className="size-10 text-success" aria-hidden="true" />
                <p className="text-body-md font-medium">Welcome aboard</p>
                <p className="text-body-sm text-muted-foreground">Taking you in…</p>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Confetti, loaded only when it is actually needed.
 *
 * A dynamic import keeps the library out of the page bundle — it is dead
 * weight for everyone who never completes a sign-up, which includes everyone
 * who is only here to reach the login link.
 *
 * `disableForReducedMotion` is the library's own honouring of the media
 * query. The app's global CSS reset cannot reach this: it is drawn on a
 * canvas, not animated with CSS.
 */
async function celebrate() {
  try {
    const { default: confetti } = await import("canvas-confetti");
    const shared = {
      particleCount: 50,
      startVelocity: 30,
      spread: 360,
      ticks: 60,
      zIndex: 60,
      disableForReducedMotion: true,
    };
    void confetti({ ...shared, origin: { x: 0, y: 1 }, angle: 60 });
    void confetti({ ...shared, origin: { x: 1, y: 1 }, angle: 120 });
  } catch {
    // A decoration failing must never take the sign-up with it. The account
    // already exists at this point and the redirect is on its own timer.
  }
}

