import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./shell.tsx";
import { HomePage } from "../features/home/HomePage.tsx";
import { AgentsPage } from "../features/agents/AgentsPage.tsx";
import { AgentDetailPage } from "../features/agents/AgentDetailPage.tsx";
import { StudioPage } from "../features/studio/StudioPage.tsx";
import { AssetsPage } from "../features/assets/AssetsPage.tsx";
import { AssetDetailPage } from "../features/assets/AssetDetailPage.tsx";
import { CollectionPage } from "../features/assets/CollectionPage.tsx";
import { ConnectorsPage } from "../features/connectors/ConnectorsPage.tsx";
import { SkillsPage } from "../features/skills/SkillsPage.tsx";
import { SkillDetailPage } from "../features/skills/SkillDetailPage.tsx";
import { WorkflowsPage } from "../features/workflows/WorkflowsPage.tsx";
import { WorkflowDetailPage } from "../features/workflows/WorkflowDetailPage.tsx";
import { SettingsPage } from "../features/settings/SettingsPage.tsx";
import { ChatPage } from "../features/chat/ChatPage.tsx";

export function App() {
  return (
    <>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/chat" replace />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/home" element={<HomePage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/agents/:id" element={<AgentDetailPage />} />
          <Route path="/studio" element={<StudioPage />} />
          <Route path="/studio/:type" element={<StudioPage />} />
          <Route path="/studio/:type/:draftId" element={<StudioPage />} />
          <Route path="/assets" element={<AssetsPage />} />
          <Route path="/assets/collections/:id" element={<CollectionPage />} />
          <Route path="/assets/:id" element={<AssetDetailPage />} />
          <Route path="/connectors" element={<ConnectorsPage />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/skills/:id" element={<SkillDetailPage />} />
          <Route path="/workflows" element={<WorkflowsPage />} />
          <Route path="/workflows/:id" element={<WorkflowDetailPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Route>
      </Routes>
    </>
  );
}
