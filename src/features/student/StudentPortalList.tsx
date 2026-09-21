import { FileText } from "lucide-react";
import { useState } from "react";
import "../../components/IdentityActions.css";
import { EmptyState, Section, Status } from "../../components/Primitives";

export function PortalList({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: { title: string; detail: string; status: string; url?: string }[];
}) {
  const [notice, setNotice] = useState("");
  return (
    <div className="student-page">
      <header className="student-header">
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      {notice && <p className="portal-notice">{notice}</p>}
      <Section title={title} marked>
        <div className="table-list">
          {items.map((item, index) => (
            <article key={`${item.title}-${index}`}>
              <FileText />
              <div>
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </div>
              <Status
                tone={
                  item.status.includes("complete") || item.status === "active"
                    ? "good"
                    : "neutral"
                }
              >
                {item.status.replaceAll("_", " ")}
              </Status>
              <button
                onClick={() =>
                  item.url
                    ? window.open(item.url, "_blank", "noopener,noreferrer")
                    : setNotice(
                        `${item.title} does not have a downloadable link yet.`,
                      )
                }
              >
                Open
              </button>
            </article>
          ))}
          {!items.length && (
            <EmptyState
              title={`No ${title.toLowerCase()} yet`}
              detail="Nothing is required from you right now."
            />
          )}
        </div>
      </Section>
    </div>
  );
}
