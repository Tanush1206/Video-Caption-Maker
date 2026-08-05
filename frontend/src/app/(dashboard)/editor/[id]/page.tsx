export default function EditorPage({ params }: { params: { id: string } }) {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">Caption Editor</h1>
      {/* Milestone 5-7: caption list, video preview/timeline, styling controls */}
      <p className="mt-4 text-sm text-muted-foreground">
        Editing video {params.id} — editor UI lands in Milestone 5.
      </p>
    </main>
  );
}
