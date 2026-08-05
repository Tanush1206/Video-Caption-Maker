export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
        VideoCaptionMaker
      </h1>
      <p className="mt-6 max-w-xl text-lg text-muted-foreground">
        AI-generated captions, a full editor, and semantic search across your
        video library — all in one place.
      </p>
      <div className="mt-10 flex gap-4">
        <a
          href="/register"
          className="rounded-md bg-primary px-6 py-3 text-primary-foreground font-medium hover:opacity-90 transition"
        >
          Get started
        </a>
        <a
          href="/login"
          className="rounded-md border border-border px-6 py-3 font-medium hover:bg-muted transition"
        >
          Sign in
        </a>
      </div>
    </main>
  );
}
