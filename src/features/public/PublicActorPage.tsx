import { ArrowLeft, FileText, MapPin } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { useStudio } from "../../hooks/useStudio";

export function PublicActorPage() {
  const { slug } = useParams();
  const { data } = useStudio();
  const profile = data?.actorProfiles.find((row) => row.slug === slug);
  const student = data?.students.find((row) => row.id === profile?.studentId);
  const materials = data?.materials.filter((row) => row.studentId === profile?.studentId && row.approvalStatus === "approved") ?? [];
  if (!profile || profile.status !== "published") return <main className="public-empty"><div className="wordmark">Stage <b>&amp;</b> Story</div><h1>Actor page unavailable</h1><p>This profile is not currently published.</p><Link to="/"><ArrowLeft/>Studio portal</Link></main>;
  return <main className="actor-public"><header><div className="wordmark">Stage <b>&amp;</b> Story</div></header><article><div className="actor-monogram">{profile.displayName.split(" ").map((part)=>part[0]).join("")}</div><div><h1>{profile.displayName}</h1><p>{profile.bio}</p>{student?.focusArea&&<span><MapPin/>Available for {student.focusArea}</span>}</div></article><section><h2>Selected work</h2>{materials.length?materials.map(material=><a key={material.id} href={material.externalUrl}><FileText/><div><strong>{material.title}</strong><small>{material.category}</small></div></a>):<p>Selected work is being prepared.</p>}</section></main>;
}
