import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MagicLinkLogin } from "./MagicLinkLogin";
import { AuthCallback } from "./AuthCallback";
import { ChangeTemporaryPassword } from "./ChangeTemporaryPassword";

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  setSession: vi.fn(),
  signInWithOAuth: vi.fn(),
  signInWithOtp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("../../lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: { auth },
}));
const session = { access_token: "test-access", user: { id: "coach" } };
const fetchMock = vi.fn();
function renderAuth(path: string, element: React.ReactNode) {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={path.split("?")[0]} element={element} />
          <Route path="/coach" element={<h1>Coach workspace</h1>} />
          <Route path="/portal" element={<h1>Student workspace</h1>} />
          <Route
            path="/change-password"
            element={<h1>Temporary password change</h1>}
          />
          {path.split("?")[0] !== "/auth/reset-password" && (
            <Route
              path="/auth/reset-password"
              element={<h1>Password recovery</h1>}
            />
          )}
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  auth.getSession.mockResolvedValue({ data: { session }, error: null });
  auth.setSession.mockResolvedValue({ error: null });
  auth.resetPasswordForEmail.mockResolvedValue({ error: null });
  auth.updateUser.mockResolvedValue({ error: null });
  auth.signOut.mockResolvedValue({ error: null });
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve(
      Response.json(
        url.includes("booking/services")
          ? { studio: { name: "Test Studio" } }
          : url.includes("claim-access")
            ? { role: "coach", destination: "/coach" }
            : {
                accessToken: "test-access",
                refreshToken: "test-refresh",
                destination: "/coach",
              },
      ),
    ),
  );
});

describe("password and recovery login", () => {
  it("offers coach email login and shows/hides a password without submitting", async () => {
    const user = userEvent.setup();
    renderAuth("/coach/login", <MagicLinkLogin coachOnly />);
    await user.type(screen.getByLabelText("Email"), "coach@example.com");
    const password = screen.getByLabelText("Password");
    await user.type(password, "a private passphrase");
    expect(password).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "text");
    expect(
      fetchMock.mock.calls.some(([url]) => url === "/api/v2/auth/login"),
    ).toBe(false);
    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(password).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Coach workspace")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v2/auth/login",
      expect.objectContaining({
        body: JSON.stringify({
          username: "coach@example.com",
          password: "a private passphrase",
        }),
      }),
    );
  });
  it("keeps first-login password changes mandatory even with a return path", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        Response.json(
          url.includes("booking")
            ? { studio: {} }
            : {
                accessToken: "access",
                refreshToken: "refresh",
                destination: "/change-password",
              },
        ),
      ),
    );
    renderAuth("/login?returnTo=/portal", <MagicLinkLogin />);
    fireEvent.change(screen.getByLabelText("Email or username"), {
      target: { value: "student.name" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "temporary password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(
      await screen.findByText("Temporary password change"),
    ).toBeInTheDocument();
  });
  it("requests a password link for an existing Google account", async () => {
    const user = userEvent.setup();
    renderAuth("/coach/login", <MagicLinkLogin coachOnly />);
    await user.click(screen.getByText("Set or reset your password"));
    await user.type(
      screen.getByLabelText("Account email"),
      "coach@example.com",
    );
    await user.click(
      screen.getByRole("button", { name: "Email password link" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "If that email belongs to an account",
    );
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith(
      "coach@example.com",
      {
        redirectTo:
          "http://localhost:3000/auth/callback?returnTo=%2Fcoach&action=reset-password",
      },
    );
  });
  it("recovers from a Google network error", async () => {
    auth.signInWithOAuth.mockRejectedValue(new Error("Network failed"));
    renderAuth("/coach/login", <MagicLinkLogin coachOnly />);
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Try email and password",
    );
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });
});
describe("authentication callback", () => {
  it("shows provider errors even if an old session exists", async () => {
    renderAuth(
      "/auth/callback?returnTo=/coach&error=server_error",
      <AuthCallback />,
    );
    expect(
      await screen.findByRole("heading", {
        name: "We couldn’t finish sign-in",
      }),
    ).toBeInTheDocument();
    expect(auth.getSession).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });
  it("routes verified recovery sessions to password setup", async () => {
    renderAuth(
      "/auth/callback?returnTo=/coach&action=reset-password",
      <AuthCallback />,
    );
    expect(await screen.findByText("Password recovery")).toBeInTheDocument();
  });
  it("preserves a working session when the claim service is temporarily unavailable", async () => {
    fetchMock.mockResolvedValue(Response.json({}, { status: 503 }));
    renderAuth("/auth/callback?returnTo=/coach", <AuthCallback />);
    expect(
      await screen.findByText(/couldn’t reach the studio/),
    ).toBeInTheDocument();
    expect(auth.signOut).not.toHaveBeenCalled();
  });
  it("rejects unauthorized accounts", async () => {
    fetchMock.mockResolvedValue(Response.json({}, { status: 403 }));
    renderAuth("/auth/callback?returnTo=/coach", <AuthCallback />);
    expect(
      await screen.findByText(/does not have studio access/),
    ).toBeInTheDocument();
    expect(auth.signOut).toHaveBeenCalled();
  });
});
describe("password setup", () => {
  it("returns the coach to the coach workspace after saving", async () => {
    const user = userEvent.setup();
    renderAuth("/auth/reset-password", <ChangeTemporaryPassword recovery />);
    await user.type(
      await screen.findByLabelText("New password"),
      "my new private passphrase",
    );
    await user.type(
      screen.getByLabelText("Confirm new password"),
      "my new private passphrase",
    );
    await user.click(
      screen.getByRole("button", { name: "Save password and sign in" }),
    );
    expect(await screen.findByText("Coach workspace")).toBeInTheDocument();
    expect(auth.updateUser).toHaveBeenCalledWith(
      expect.objectContaining({ password: "my new private passphrase" }),
    );
  });
  it("does not allow a password update without a session", async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    renderAuth("/auth/reset-password", <ChangeTemporaryPassword recovery />);
    await waitFor(() =>
      expect(
        screen.getByText("Request a new password link"),
      ).toBeInTheDocument(),
    );
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
});
