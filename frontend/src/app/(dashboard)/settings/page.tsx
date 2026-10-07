"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Check } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { InstallSettings } from "@/components/settings/install-settings";
import { useDeleteAccount, useChangePassword, useUpdateProfile } from "@/hooks/use-account";
import { useAuth } from "@/hooks/use-auth";
import { useAuthStore } from "@/stores/auth";
import { LOCAL_MODE } from "@/lib/config";
import { cn } from "@/lib/utils";

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
    <Card className={cn("p-4 sm:p-5", danger && "border-destructive/40")}>
      <h2 className={cn("text-sm font-semibold", danger && "text-destructive")}>{title}</h2>
      <p className="mb-4 mt-1 text-sm text-muted-foreground">{description}</p>
      {children}
    </Card>
  );
}

/** A confirmation that appears next to the button that caused it. */
function Saved({ label }: { label: string }) {
  return (
    <span className="flex animate-fade-in items-center gap-1.5 text-sm text-success">
      <Check className="size-4" />
      {label}
    </span>
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
        className="space-y-4"
      >
        <Field
          label="Name"
          name="full_name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Your name"
          autoComplete="name"
        />

        <div className="space-y-1.5">
          <label className="block text-sm font-medium">Email</label>
          <p className="rounded-md border border-dashed border-border bg-subtle px-3 py-2 text-sm text-muted-foreground">
            {user?.email}
          </p>
          {/* Not an oversight worth hiding: say why it's fixed. */}
          <p className="text-xs text-muted-foreground">
            Your email can&apos;t be changed here — a new address would have to be
            verified before the old one stopped working, and there&apos;s no mail
            delivery set up to do that.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={!dirty} loading={updateProfile.isPending}>
            {updateProfile.isPending ? "Saving…" : "Save"}
          </Button>

          {updateProfile.isSuccess && !dirty && <Saved label="Saved" />}
          {updateProfile.isError && (
            <span role="alert" className="text-sm text-destructive">
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
      <form onSubmit={submit} className="space-y-4">
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
          hint="At least 8 characters"
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
          <Button
            type="submit"
            loading={changePassword.isPending}
            disabled={!current || next.length < 8}
          >
            {changePassword.isPending ? "Changing…" : "Change password"}
          </Button>

          {changePassword.isSuccess && <Saved label="Changed" />}
          {changePassword.isError && (
            <span role="alert" className="text-sm text-destructive">
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
        <Button variant="danger" onClick={() => setOpen(true)}>
          Delete my account
        </Button>
      ) : (
        <form onSubmit={confirm} className="animate-fade-in space-y-4">
          <div className="flex gap-2.5 rounded-md border border-destructive/30 bg-destructive/10 p-3">
            <AlertTriangle className="mt-px size-4 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">
              This permanently deletes everything owned by{" "}
              <span className="font-medium">{user?.email}</span>.
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
            <Button
              type="submit"
              variant="destructive"
              loading={deleteAccount.isPending}
              disabled={!password}
            >
              {deleteAccount.isPending ? "Deleting…" : "Delete everything"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setOpen(false);
                setPassword("");
                deleteAccount.reset();
              }}
            >
              Cancel
            </Button>
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
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to your videos
      </Link>

      <h1 className="mb-6 text-h1">{LOCAL_MODE ? "Settings" : "Account settings"}</h1>

      {/* A local install has no account to manage; it has the machine instead.
          A hosted one keeps the account pages and leaves the install alone. */}
      {LOCAL_MODE ? (
        <InstallSettings />
      ) : (
        <div className="space-y-4">
          <ProfileSection />
          <PasswordSection />
          <DangerSection />
        </div>
      )}
    </main>
  );
}
