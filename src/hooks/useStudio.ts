import { useQuery } from "@tanstack/react-query";
import type { Role } from "../domain/model";
import { loadStudioSnapshot } from "../data/repository";
export const useStudio = (role: Role = "coach", studentId?: string) => useQuery({ queryKey: ["studio", role, studentId], queryFn: () => loadStudioSnapshot(role, studentId) });
