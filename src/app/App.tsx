import { QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Navigate, Route, Routes, useParams } from "react-router";
import { AboutPage } from "@/pages/AboutPage";
import { BundlesPage } from "@/pages/BundlesPage";
import { CategoriesPage } from "@/pages/CategoriesPage";
import { CategoryPage } from "@/pages/CategoryPage";
import { FavoritesPage } from "@/pages/FavoritesPage";
import { CommandsPage } from "@/pages/CommandsPage";
import { HelpPage } from "@/pages/HelpPage";
import { HomePage } from "@/pages/HomePage";
import { InstalledPage } from "@/pages/InstalledPage";
import { LogsPage } from "@/pages/LogsPage";
import { PackageDetailPage } from "@/pages/PackageDetailPage";
import { PublishPage } from "@/pages/PublishPage";
import { PublishWingetPage } from "@/pages/PublishWingetPage";
import { RecentPage } from "@/pages/RecentPage";
import { TopChartsPage } from "@/pages/TopChartsPage";
import { SearchPage } from "@/pages/SearchPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { SharedBundlePage } from "@/pages/SharedBundlePage";
import { StartupPage } from "@/pages/StartupPage";
import { Layout } from "./Layout";
import { queryClient } from "./queryClient";

/** Přesměrování sdíleného odkazu na detail aplikace. */
function SharedAppRedirect() {
  const { packageId = "" } = useParams();
  return <Navigate to={`/package/${encodeURIComponent(packageId)}`} replace />;
}

/**
 * Kořen aplikace. HashRouter je zvolen kvůli Tauri – adresy typu
 * index.html#/installed fungují bez jakékoli konfigurace serveru.
 */
export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="categories" element={<CategoriesPage />} />
            <Route path="categories/:categoryId" element={<CategoryPage />} />
            <Route path="package/:packageId" element={<PackageDetailPage />} />
            {/* Sdílené odkazy (unibox://app/<id>, web …/app/<id>) vedou na detail aplikace */}
            <Route path="app/:packageId" element={<SharedAppRedirect />} />
            <Route path="top" element={<TopChartsPage />} />
            <Route path="recent" element={<RecentPage />} />
            <Route path="installed" element={<InstalledPage />} />
            <Route path="favorites" element={<FavoritesPage />} />
            <Route path="bundles" element={<BundlesPage />} />
            {/* Sdílená sada z odkazu (…/bundles/shared?d=…) a seznam aplikací z webu (unibox://import?apps=…) */}
            <Route path="bundles/shared" element={<SharedBundlePage />} />
            <Route path="import" element={<SharedBundlePage />} />
            <Route path="startup" element={<StartupPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="publish" element={<PublishPage />} />
            <Route path="publish/winget" element={<PublishWingetPage />} />
            <Route path="about" element={<AboutPage />} />
            {/* Historie operací je sekcí Nastavení – starší odkazy (oznámení, nápověda) vedou tam */}
            <Route path="history" element={<Navigate to="/settings?section=history" replace />} />
            <Route path="logs" element={<LogsPage />} />
            <Route path="help" element={<HelpPage />} />
            <Route path="commands" element={<CommandsPage />} />
            {/* Neznámá adresa (zastaralý odkaz, odkaz z novější verze) – bez ní by okno zůstalo
                prázdné i bez titulkové lišty a postranního panelu */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </QueryClientProvider>
  );
}
