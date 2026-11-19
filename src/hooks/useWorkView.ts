import { useSearchParams } from "react-router-dom";

export function workSectionSearch(search: string, view: "notes" | "scripts") {
  const params = new URLSearchParams(search);
  params.set("view", view);
  return params.toString();
}

export function useWorkView() {
  const [params] = useSearchParams();
  const view = params.get("view");
  return view === "notes" || view === "scripts" ? view : "homework";
}
