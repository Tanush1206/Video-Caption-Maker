"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Check } from "lucide-react";
import { useState } from "react";

import { Field } from "@/components/ui/field";
import { useDeleteAccount, useChangePassword, useUpdateProfile } from "@/hooks/use-account";
import { useAuth } from "@/hooks/use-auth";
import { useAuthStore } from "@/stores/auth";

function Section({
  title,
  description,
  children,
  danger = false,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <section
      className={`rounded-lg border p-4 sm:p-5 ${danger ? "border-red-500/40" : "border-border"}`}
    >
      <h2 className={`text-sm font-semibold ${danger ? "text-red-500" : ""}`}>{title}</h2>
      <p className="mb-4 mt-1 text-sm text-muted-foreground">{description}</p>
      {children}
    </section>
  );
}

function ProfileSection() {
  const { user } = useAuth();
  const updateProfile = useUpdateProfile();
  const [name, setName] = useState(user?.full_name ?? "");

  const dirty = name.trim() !== (user?.full_name ?? "");

  return (
    <Section title="Profile" description="How your name appears in the app.">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          updateProfile.mutate(name.trim() || null);
        }}
        className="space-y-3"
      >
        <Field
          label="Name"
          name="full_name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Your name"
          autoComplete="name"
        />

        <div>
          <label className="block text-sm font-medium">Email</label>
          <p className="mt-1.5 rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
            {user?.email}
          </p>
          {/* Not an oversight worth hiding: say why it's fixed. */}
          <p className="mt-1 text-xs text-muted-foreground">
            Your email can&apos;t be changed here — a new address would have to be
            verified before the old one stopped working, and there&apos;s no mail
            delivery set up to do that.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!dirty || updateProfile.isPending}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
          >
            {updateProfile.isPending ? "Saving…" : "Save"}
          </button>

          {updateProfile.isSuccess && !dirty && (
            <span className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
              <Check className="h-4 w-4" />
              Saved
            </span>
          )}
          {updateProfile.isError && (
            <span role="alert" className="text-sm text-red-500">
              {(updateProfile.error as Error).message}
            </span>
          )}
        </div>
      </form>
    </Section>
  );
}

function PasswordSection() {
  const changePassword = useChangePassword();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [mismatch, setMismatch] = useState<string | undefined>();

  function submit(event: React.FormEvent) {
    event.preventDefault();

    // Checked here rather than server-side: the confirmation box exists to
    // catch a typo before it becomes a password nobody knows, and the server
    // has no business seeing it twice.
    if (next !== confirm) {
      setMismatch("These don't match");
      return;
    }
    setMismatch(undefined);

    changePassword.mutate(
      { current_password: current, new_password: next },
      {
        onSuccess: () => {
          setCurrent("");
          setNext("");
          setConfirm("");
        },
      }
    );
  }

  return (
    <Section
      title="Password"
      description="Changing this signs you out everywhere else. This browser stays signed in."
    >
      <form onSubmit={submit} className="space-y-3">
        <Field
          label="Current password"
          name="current_password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
        />
        <Field
          label="New password"
          name="new_password"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(event) => setNext(event.target.value)}
          error={next.length > 0 && next.length < 8 ? "At least 8 characters" : undefined}
        />
        <Field
          label="Confirm new password"
          name="confirm_password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          error={mismatch}
        />

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={changePassword.isPending || !current || next.length < 8}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
          >
            {changePassword.isPending ? "Changing…" : "Change password"}
          </button>

          {changePassword.isSuccess && (
            <span className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
              <Check className="h-4 w-4" />
              Changed
            </span>
          )}
          {changePassword.isError && (
            <span role="alert" className="text-sm text-red-500">
              {(changePassword.error as Error).message}
            </span>
          )}
        </div>
      </form>
    </Section>
  );
}

function DangerSection() {
  const router = useRouter();
  const { user } = useAuth();
  const clearSession = useAuthStore((state) => state.clearSession);
  const deleteAccount = useDeleteAccount();

  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");

  function confirm(event: React.FormEvent) {
    event.preventDefault();
    deleteAccount.mutate(
      { password },
      {
        onSuccess: () => {
          clearSession();
          router.replace("/login");
        },
      }
    );
  }

  return (
    <Section
      danger
      title="Delete account"
      description="Removes your account, every video you've uploaded, and all their captions and exports. There is no undo and no backup."
    >
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md border border-red-500/50 px-4 py-2 text-sm text-red-500 transition hover:bg-red-500/10"
        >
          Delete my account
        </button>
      ) : (
        <form onSubmit={confirm} className="space-y-3">
          <div className="flex gap-2 rounded-md bg-red-500/10 p-3">
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />
            <p className="text-sm text-red-500">
              This permanently deletes everything owned by {user?.email}.
            </p>
          </div>

          {/* Asked for even though the session is already authenticated: this
              is the one action with nothing to restore afterwards, and a
              browser left open on a shared machine is a real way to lose it. */}
          <Field
            label="Confirm your password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={deleteAccount.isError ? (deleteAccount.error as Error).message : undefined}
          />

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={deleteAccount.isPending || !password}
              className="rounded-md bg-red-500 px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {deleteAccount.isPending ? "Deleting…" : "Delete everything"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setPassword("");
                deleteAccount.reset();
              }}
              className="rounded-md border border-border px-4 py-2 text-sm transition hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </Section>
  );
}

export default function SettingsPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
      <Link
        href="/dashboard"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to your videos
      </Link>

      <h1 className="mb-6 text-xl font-semibold sm:text-2xl">Account settings</h1>

      <div className="space-y-4">
        <ProfileSection />
        <PasswordSection />
        <DangerSection />
      </div>
    </main>
  );
}
