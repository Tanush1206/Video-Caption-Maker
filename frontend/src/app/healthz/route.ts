/** Liveness for the container healthcheck: answers without touching the API. */
export const dynamic = "force-dynamic";

export function GET() {
  return new Response("ok", { headers: { "Cache-Control": "no-store" } });
}
