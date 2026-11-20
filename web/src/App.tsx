import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { useProjects } from "./hooks";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import { Login } from "./pages/Login";
import { Workspaces } from "./pages/Workspaces";
import { BoardPage } from "./pages/BoardPage";
import { BacklogPage } from "./pages/BacklogPage";
import { ReportsPage } from "./pages/ReportsPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { MembersPage } from "./pages/settings/Members";
import { WorkflowsPage } from "./pages/settings/Workflows";
import { WebhooksPage } from "./pages/settings/Webhooks";
import { BillingPage } from "./pages/settings/Billing";
import { AuditPage } from "./pages/settings/Audit";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** /w/:slug lands on the first project's board, or the projects page if there are none. */
function WorkspaceHome() {
  const { data, isLoading } = useProjects();
  if (isLoading) return <Spinner />;
  return data && data.length ? <Navigate to={`p/${data[0].id}/board`} replace /> : <Navigate to="projects" replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Workspaces />
          </RequireAuth>
        }
      />
      <Route
        path="/w/:slug"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<WorkspaceHome />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="p/:projectId/board" element={<BoardPage />} />
        <Route path="p/:projectId/backlog" element={<BacklogPage />} />
        <Route path="p/:projectId/reports" element={<ReportsPage />} />
        <Route path="settings/members" element={<MembersPage />} />
        <Route path="settings/workflows" element={<WorkflowsPage />} />
        <Route path="settings/webhooks" element={<WebhooksPage />} />
        <Route path="settings/billing" element={<BillingPage />} />
        <Route path="settings/audit" element={<AuditPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
