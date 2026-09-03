import { CircleDollarSign, Gift, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { formatMoney } from "../../domain/finance";

type Catalog = { package: { id: string; name: string; description: string; sessionCount: number; sessionDurationMinutes: number; priceMinor: number; currency: string; deliveryFormat?: string; giftable: boolean }; studio?: { name?: string } };

export default function PackageLanding() {
  const { definitionId = "" } = useParams();
  const [catalog, setCatalog] = useState<Catalog>();
  const [error, setError] = useState("");
  useEffect(() => {
    fetch(`/api/v2/public/package-gifts/catalog?definitionId=${encodeURIComponent(definitionId)}`)
      .then(async (response) => { const value = await response.json(); if (!response.ok) throw new Error(value.message || "Package unavailable."); setCatalog(value); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Package unavailable."));
  }, [definitionId]);
  if (!catalog && !error) return <div className="loading">Opening package…</div>;
  return <main className="gift-page"><section className="gift-card package-landing"><CircleDollarSign /><small>{catalog?.studio?.name || "Coach'D"}</small>{catalog ? <><h1>{catalog.package.name}</h1><p>{catalog.package.description}</p><div className="gift-package-summary"><ShieldCheck /><div><strong>{catalog.package.sessionCount} lessons</strong><span>{catalog.package.sessionDurationMinutes} minutes each · {(catalog.package.deliveryFormat || "studio choice").replaceAll("_", " ")}</span></div><b>{formatMoney(catalog.package.priceMinor, catalog.package.currency)}</b></div><div className="form-actions"><Link className="button-link primary" to={`/login?returnTo=${encodeURIComponent(`/portal/payments?package=${catalog.package.id}`)}`}>Sign in to purchase</Link>{catalog.package.giftable && <Link className="button-link" to={`/gift/${catalog.package.id}`}><Gift />Purchase as a gift</Link>}</div></> : <><h1>Package unavailable</h1><p className="inline-error">{error}</p></>}<Link to="/book">View booking options</Link></section></main>;
}
