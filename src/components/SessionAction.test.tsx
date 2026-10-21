import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { SessionAction } from "./SessionAction";

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { auth: { signOut } } }));

function setup(isDemo = false) {
  render(
    <MemoryRouter initialEntries={["/workspace"]}>
      <Routes>
        <Route path="/workspace" element={<SessionAction isDemo={isDemo} />} />
        <Route path="/login" element={<h1>Login page</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  signOut.mockResolvedValue({ error: null });
});

it("logs out before returning to login", async () => {
  let finish!: () => void;
  signOut.mockImplementation(
    () => new Promise((resolve) => (finish = () => resolve({ error: null }))),
  );
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Log out" }));
  expect(screen.getByRole("button", { name: "Log out" })).toBeDisabled();
  expect(screen.queryByRole("heading", { name: "Login page" })).toBeNull();
  finish();
  expect(
    await screen.findByRole("heading", { name: "Login page" }),
  ).toBeVisible();
  expect(signOut).toHaveBeenCalledTimes(1);
});

it("keeps the workspace open and allows retry after a logout failure", async () => {
  signOut.mockResolvedValueOnce({ error: new Error("Offline") });
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Log out" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Please try again",
  );
  fireEvent.click(screen.getByRole("button", { name: "Log out" }));
  expect(
    await screen.findByRole("heading", { name: "Login page" }),
  ).toBeVisible();
});

it("offers login in demo mode without calling signOut", async () => {
  setup(true);
  fireEvent.click(screen.getByRole("button", { name: "Log in" }));
  await waitFor(() =>
    expect(screen.getByRole("heading")).toHaveTextContent("Login page"),
  );
  expect(signOut).not.toHaveBeenCalled();
});
