import { Link, Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { Login } from "./pages/Login";
import { Workspaces } from "./pages/Workspaces";
import { Layout } from "./pages/Layout";
import { PageView } from "./pages/PageView";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="center-msg muted">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** Pages shared directly with a guest (no workspace sidebar). */
function GuestPage() {
  return (
    <div className="app guest">
      <main className="main">
        <div className="guest-bar">
          <Link to="/" className="brand small-brand">
            <span className="logo">A</span> Inkwell
          </Link>
        </div>
        <PageView />
      </main>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<RequireAuth><Workspaces /></RequireAuth>} />
      <Route path="/p/:pageId" element={<RequireAuth><GuestPage /></RequireAuth>} />
      <Route path="/w/:workspaceId" element={<RequireAuth><Layout /></RequireAuth>}>
        <Route path="p/:pageId" element={<PageView />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
