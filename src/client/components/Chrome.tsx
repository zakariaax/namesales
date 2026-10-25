import { Link } from "react-router-dom";
import type { Theme } from "../theme";

export function Header({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link to="/" className="brand">
          <Logo />
          <span>
            <span className="brand-name">NameSales</span>
            <span className="brand-tag">Aftermarket sales</span>
          </span>
        </Link>
        <button
          type="button"
          className="icon-button"
          onClick={onToggle}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          aria-pressed={theme === "dark"}
        >
          {theme === "dark" ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>
    </header>
  );
}

export function Logo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="currentColor" />
      <path className="logo-bars" d="M8 21.5V18h3.2v3.5H8Zm6.4 0V13h3.2v8.5h-3.2Zm6.4 0V9h3.2v12.5H20.8Z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15.5 3.5a8.2 8.2 0 1 0 5 12.2A7.2 7.2 0 0 1 15.5 3.5Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

export function PriceText({ text, exact, title }: { text: string; exact: boolean; title: string }) {
  return (
    <span className={exact ? "price-text" : "price-text is-range"} title={title}>
      {text}
    </span>
  );
}
