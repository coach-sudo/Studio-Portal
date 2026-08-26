import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { App } from "./App";

const renderRoute = (path: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const routes = [
  ["31 coach home", "/coach", /Good (morning|afternoon|evening)/i],
  ["32 today follow-up queue", "/coach/today", /Notes due within 48 hours/i],
  ["33 booking administration", "/coach/bookings", /^Bookings$/i],
  ["34 legacy lesson route joins booking calendar", "/coach/lessons", /^Bookings$/i],
  ["35 legacy notes route joins Today", "/coach/notes", /^Today$/i],
  ["36 global materials", "/coach/materials", /^Materials$/i],
  ["37 payments workspace", "/coach/finance", /^Payments$/i],
  ["38 actor publishing", "/coach/actor-pages", /Actor Pages/i],
  ["39 studio settings", "/coach/settings", /Settings/i],
  ["40 student record", "/coach/students/student-maya", /Maya Kim/i],
  ["41 student lesson history", "/coach/students/student-maya/lessons", /Lesson history/i],
  ["42 student current work", "/coach/students/student-maya/work", /Practice/i],
  ["43 student notes", "/coach/students/student-maya/notes", /^Notes$/i],
  ["44 student account", "/coach/students/student-maya/account", /Access & visibility/i],
  ["45 portal home", "/portal", /Welcome back/i],
  ["46 portal notes", "/portal/notes", /^Notes$/i],
  ["47 portal practice joins current work", "/portal/practice", /^Current Work$/i],
  ["48 portal materials join current work", "/portal/materials", /^Current Work$/i],
  ["49 unified sign-in", "/login", /Sign in to/i],
  ["50 public booking catalog", "/book", /Choose your session/i],
] as const;

describe("production completeness workflows 31–50", () => {
  it.each(routes)("%s", async (_name, path, expected) => {
    renderRoute(path);
    expect((await screen.findAllByText(expected)).length).toBeGreaterThan(0);
  });
});
