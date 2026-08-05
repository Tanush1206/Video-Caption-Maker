export default function SearchPage({ params }: { params: { id: string } }) {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">Semantic Search</h1>
      {/* Milestone 9: search bar, results with timestamp jumping, RAG answers */}
      <p className="mt-4 text-sm text-muted-foreground">
        Searching video {params.id} — search UI lands in Milestone 9.
      </p>
    </main>
  );
}
