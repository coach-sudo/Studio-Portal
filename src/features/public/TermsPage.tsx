import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import terms from "../../content/terms.md?raw";
import { applyStudioBranding } from "../../lib/branding";

function inline(value: string): ReactNode[] {
  return value.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={index}>{part.slice(2, -2)}</strong>
    ) : part,
  );
}

export function TermsPage() {
  const [studio, setStudio] = useState<{ name: string; website?: string }>({ name: "Coach Darius" });
  useEffect(() => {
    fetch("/api/v2/public/booking/services")
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((payload) => {
        setStudio({ name: payload.studio.name, website: payload.studio.bookingPage?.footerWebsiteUrl });
        applyStudioBranding(payload.studio.branding);
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => { document.title = `${studio.name} — Terms and Conditions`; }, [studio.name]);
  const blocks = useMemo(() => terms.split(/\r?\n/), []);
  return (
    <main className="legal-page">
      <header>
        <Link to="/book" className="wordmark">{studio.name}</Link>
        <Link to="/book">Return to booking</Link>
      </header>
      <article>
        {blocks.map((line, index) => {
          if (!line.trim()) return null;
          if (line.startsWith("# ")) return <h1 key={index}>{line.slice(2)}</h1>;
          if (line.startsWith("## ")) return <h2 key={index}>{line.slice(3)}</h2>;
          if (line.startsWith("* ")) return <p className="legal-bullet" key={index}>• {inline(line.slice(2))}</p>;
          return <p key={index}>{inline(line)}</p>;
        })}
      </article>
      <footer>
        <span>{studio.name}</span>
        {studio.website && <a href={studio.website} target="_blank" rel="noreferrer">Website</a>}
      </footer>
    </main>
  );
}
