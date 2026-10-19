import { Link } from "react-router-dom";
import { studioNavigation } from "../../app/coachNavigation";
import { PageHeader } from "../../components/Primitives";
export function StudioHub() {
  return (
    <div className="page">
      <PageHeader title="Studio" />
      <nav className="workspace-destinations" aria-label="Studio tools">
        {studioNavigation.map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to}>
            <Icon aria-hidden="true" />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
