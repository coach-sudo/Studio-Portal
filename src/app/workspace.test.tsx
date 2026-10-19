import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { demoSnapshot } from "../data/demo";
import { StudentPortal } from "../features/student/StudentPortal";
import { StudioStoreProvider } from "../state/StudioStore";
import {
  WorkspaceLocationProvider,
  useUrlNumber,
  useUnsavedWorkspaceChanges,
  useWorkspaceNavigation,
} from "../hooks/useWorkspaceLocation";
import { recordLink, resolvedRecordLink, safeReturnPath } from "./recordLinks";

beforeEach(() => {
  window.scrollTo = vi.fn();
});
function Probe() {
  const l = useLocation(),
    n = useNavigate();
  return (
    <>
      <output data-testid="url">{l.pathname + l.search}</output>
      <button onClick={() => n(-1)}>Browser Back</button>
      <button onClick={() => n(1)}>Browser Forward</button>
    </>
  );
}
function show(path: string, guardian = false) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[path]}>
        <Probe />
        {guardian ? (
          <StudioStoreProvider>
            <WorkspaceLocationProvider>
              <Routes>
                <Route
                  path="/portal/*"
                  element={<StudentPortal role="guardian" />}
                />
              </Routes>
            </WorkspaceLocationProvider>
          </StudioStoreProvider>
        ) : (
          <App />
        )}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("connected workspace", () => {
  it("keeps exact targets and rejects external return paths", () => {
    expect(
      recordLink("coach", { kind: "lesson", id: "exact", studentId: "one" }),
    ).toBe("/coach/records/lesson/exact?student=one");
    expect(
      resolvedRecordLink("guardian", {
        kind: "lesson",
        id: "exact",
        studentId: "one",
      }),
    ).toBe("/portal/lessons/exact?student=one");
    for (const bad of [
      "https://evil.example",
      "//evil.example",
      "/coach\\evil",
      "javascript:alert(1)",
    ])
      expect(safeReturnPath(bad, "/coach/today")).toBe("/coach/today");
  });
  it("preserves compatibility queries while replacing Home with Today", async () => {
    show("/coach?q=keep&view=week");
    await screen.findByRole("heading", { name: "Today" }, { timeout: 5000 });
    expect(screen.getByTestId("url")).toHaveTextContent(
      "/coach/today?q=keep&view=week",
    );
    expect(
      within(
        screen.getByRole("navigation", { name: "Coach navigation" }),
      ).getAllByRole("link"),
    ).toHaveLength(6);
    expect(screen.getByText("Week preview")).toBeVisible();
  });
  it("returns from student tabs to the filtered roster", async () => {
    const user = userEvent.setup();
    show("/coach/students?q=Maya&status=active&sort=name");
    await user.click(
      await screen.findByRole("button", { name: /Maya Kim.*Open/ }),
    );
    await user.click(await screen.findByRole("link", { name: "Lessons" }));
    const main = screen.getByRole("main");
    const back = within(main).getAllByRole("button", { name: /Back/ })[0];
    await user.click(back);
    await waitFor(() =>
      expect(screen.getByTestId("url")).toHaveTextContent(
        "/coach/students?q=Maya&status=active&sort=name",
      ),
    );
    expect(
      await screen.findByRole("textbox", { name: "Search students" }),
    ).toHaveValue("Maya");
  });
  it("opens an exact searched student with Arrow/Enter and restores origin", async () => {
    const user = userEvent.setup();
    show("/coach/today");
    await user.click(
      await screen.findByRole("button", {
        name: "Search records and destinations",
      }),
    );
    const input = screen.getByRole("combobox");
    await user.type(input, "Maya");
    await screen.findByRole("option", { name: /Students: Maya Kim/ });
    await user.keyboard("{Enter}");
    expect(
      await screen.findByRole("heading", { name: "Maya Kim" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Back to students" }));
    await waitFor(() =>
      expect(screen.getByTestId("url")).toHaveTextContent("/coach/today"),
    );
  });
  it("uses a real More menu and retains every Studio destination", async () => {
    const user = userEvent.setup();
    show("/coach/today");
    await user.click(await screen.findByRole("button", { name: "More" }));
    const menu = screen.getByRole("dialog", { name: "More" });
    for (const label of [
      "Library",
      "Studio",
      "Payments",
      "Actor Pages",
      "Referrals",
      "Campaigns",
      "Services",
      "Availability",
      "Settings",
    ])
      expect(within(menu).getByRole("link", { name: label })).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("shows a non-disclosing unavailable state for forged records", async () => {
    show("/coach/records/lesson/not-authorized");
    expect(
      await screen.findByRole("heading", { name: "Record unavailable" }),
    ).toBeVisible();
    expect(screen.queryByText(/Forbidden Person/)).not.toBeInTheDocument();
  });
  it("switches authorized guardian children through URL history", async () => {
    const data = structuredClone(demoSnapshot),
      first = data.students.find((s) => s.id === "student-sarah")!,
      second = data.students.find((s) => s.id === "student-maya")!;
    first.guardianEmail = "shared-family@example.test";
    second.guardianEmail = "shared-family@example.test";
    window.localStorage.setItem(
      "stage-story-studio-core-v2",
      JSON.stringify({ students: data.students }),
    );
    const user = userEvent.setup();
    show(`/portal?student=${first.id}`, true);
    const selector = await screen.findByRole("combobox", { name: "Student" });
    await user.selectOptions(selector, second.id);
    await waitFor(() =>
      expect(screen.getByTestId("url")).toHaveTextContent(
        `student=${second.id}`,
      ),
    );
    expect(
      screen.getByRole("region", { name: "Household context" }),
    ).toHaveTextContent(second.preferredName || second.fullName);
    await user.click(screen.getByRole("button", { name: "Browser Back" }));
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Student" })).toHaveValue(
        first.id,
      ),
    );
    await user.click(screen.getByRole("button", { name: "Browser Forward" }));
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Student" })).toHaveValue(
        second.id,
      ),
    );
  });
  it("does not substitute a child for an unauthorized URL context", async () => {
    show("/portal?student=unrelated", true);
    expect(
      await screen.findByRole("heading", { name: "Record unavailable" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("region", { name: "Household context" }),
    ).not.toBeInTheDocument();
  });
  it("protects dirty content before shared navigation and permits explicit discard", async () => {
    function Draft() {
      useUnsavedWorkspaceChanges(true);
      const workspace = useWorkspaceNavigation();
      return (
        <button onClick={() => workspace.open("/coach/today")}>
          Open Today
        </button>
      );
    }
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false),
      user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/coach/students"]}>
        <WorkspaceLocationProvider>
          <Probe />
          <Draft />
        </WorkspaceLocationProvider>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "Open Today" }));
    expect(screen.getByTestId("url")).toHaveTextContent("/coach/students");
    expect(confirm).toHaveBeenCalledOnce();
    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "Open Today" }));
    expect(screen.getByTestId("url")).toHaveTextContent("/coach/today");
    confirm.mockRestore();
  });
  it("preserves batched page-size and page URL changes", async () => {
    function Paging() {
      const [size, setSize] = useUrlNumber("pageSize", 25),
        [page, setPage] = useUrlNumber("page", 1);
      return (
        <button
          onClick={() => {
            setSize(50);
            setPage(1);
          }}
        >
          Change {size}/{page}
        </button>
      );
    }
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/coach/students?page=3"]}>
        <WorkspaceLocationProvider>
          <Probe />
          <Paging />
        </WorkspaceLocationProvider>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "Change 25/3" }));
    expect(screen.getByTestId("url")).toHaveTextContent("pageSize=50");
    expect(screen.getByTestId("url")).not.toHaveTextContent("page=3");
  });
});
