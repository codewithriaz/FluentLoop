import { AppProvider, useApp } from "./AppContext";
import { FeedbackProvider } from "./components/feedback";
import { ShellProvider } from "./components/Shell";
import { Sidebar } from "./components/Sidebar";
import { ErrorBox } from "./components/ui";
import { navItemFor } from "./lib/nav";
import { DashboardScreen } from "./screens/DashboardScreen";
import { LibraryScreen } from "./screens/LibraryScreen";
import { NotesScreen } from "./screens/NotesScreen";
import { PlaceholderScreen } from "./screens/PlaceholderScreen";
import { PracticeHome } from "./screens/PracticeHome";
import { SettingsScreen } from "./screens/SettingsScreen";
import { TemplatesScreen } from "./screens/TemplatesScreen";
import { TtsScreen } from "./screens/TtsScreen";
import { VaultScreen } from "./screens/VaultScreen";
import { WorkspaceScreen } from "./screens/workspace/WorkspaceScreen";

function Main() {
  const { route, info } = useApp();
  if (info && !info.path) {
    return (
      <div className="p-8">
        <ErrorBox>
          The library could not be opened: {info.openError ?? "unknown error"}
          {"\n"}Open Settings to choose another library folder.
        </ErrorBox>
        <div className="mt-6">
          <SettingsScreen />
        </div>
      </div>
    );
  }
  switch (route.screen) {
    case "dashboard":
      return <DashboardScreen />;
    case "library":
      return <LibraryScreen folderId={route.folderId} recent={false} />;
    case "recent":
      return <LibraryScreen folderId={null} recent />;
    case "practice":
      return route.videoId ? (
        <WorkspaceScreen key={route.videoId} videoId={route.videoId} seekTo={route.seekTo} focusSentenceId={route.sentenceId} />
      ) : (
        <PracticeHome />
      );
    case "vault":
      return <VaultScreen />;
    case "templates":
      return <TemplatesScreen initialId={route.templateId} />;
    case "notes":
      return <NotesScreen />;
    case "tts":
      return <TtsScreen />;
    case "settings":
      return <SettingsScreen />;
    case "inbox":
    case "youtube":
    case "tasks":
    case "ideas":
    case "planning":
    case "time":
    case "lessons":
      return <PlaceholderScreen key={route.screen} item={navItemFor(route.screen)} />;
  }
}

export default function App() {
  return (
    <FeedbackProvider>
      <AppProvider>
        <ShellProvider>
          <div className="flex h-full">
            <Sidebar />
            <main className="flex min-w-0 flex-1 flex-col bg-bg">
              <Main />
            </main>
          </div>
        </ShellProvider>
      </AppProvider>
    </FeedbackProvider>
  );
}
