// Milestone 2: this layout will wrap all dashboard/editor/search pages
// with an auth guard (redirect to /login if not authenticated) and
// the shared Header/Sidebar.
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-screen">{children}</div>;
}
