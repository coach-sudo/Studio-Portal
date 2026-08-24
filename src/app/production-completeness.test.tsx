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
  ["31 coach home", "/", /Good (morning|afternoon|evening)/i],
  ["32 today follow-up queue", "/today", /Notes due within 48 hours/i],
  ["33 booking administration", "/bookings", /^Bookings$/i],
  ["34 global lesson list", "/lessons", /^Lessons$/i],
  ["35 global notes list", "/notes", /^Notes$/i],
  ["36 global materials", "/materials", /^Materials$/i],
  ["37 payments workspace", "/finance", /^Payments$/i],
  ["38 actor publishing", "/actor-pages", /Actor Pages/i],
  ["39 studio settings", "/settings", /Settings/i],
  ["40 student record", "/students/student-maya", /Maya Kim/i],
  ["41 student lesson history", "/students/student-maya/lessons", /Lesson history/i],
  ["42 student current work", "/students/student-maya/work", /Practice/i],
  ["43 student notes", "/students/student-maya/notes", /^Notes$/i],
  ["44 student account", "/students/student-maya/account", /Access & visibility/i],
  ["45 portal home", "/portal", /Welcome back/i],
  ["46 portal notes", "/portal/notes", /^Notes$/i],
  ["47 portal practice", "/portal/practice", /^Practice$/i],
  ["48 portal materials", "/portal/materials", /^Materials$/i],
  ["49 unified sign-in", "/login", /Sign in to/i],
  ["50 public booking catalog", "/book", /Choose your session/i],
] as const;

describe("production completeness workflows 31–50", () => {
  it.each(routes)("%s", async (_name, path, expected) => {
    renderRoute(path);
    expect((await screen.findAllByText(expected)).length).toBeGreaterThan(0);
  });
});
