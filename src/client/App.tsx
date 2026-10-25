import { Route, Routes } from "react-router-dom";
import { Header } from "./components/Chrome";
import { DomainPage } from "./pages/DomainPage";
import { SearchPage } from "./pages/SearchPage";
import { useTheme } from "./theme";

export function App() {
  const { theme, toggle } = useTheme();
  return (
    <>
      <Header theme={theme} onToggle={toggle} />
      <Routes>
        <Route path="/" element={<SearchPage />} />
        <Route path="/domain/*" element={<DomainPage />} />
      </Routes>
      <footer className="footer">
        <div className="footer-inner">
          <span>NameSales</span>
          <span>Ranges stay ranges. Unknown venues are shown as not reported.</span>
        </div>
      </footer>
    </>
  );
}
