import { QueryClient,QueryClientProvider } from "@tanstack/react-query";
import { render,screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe,expect,it } from "vitest";
import { App } from "./App";
const renderApp=(path="/")=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={[path]}><App/></MemoryRouter></QueryClientProvider>);
describe("studio surfaces",()=>{
  it("shows one explainable coach next action",async()=>{renderApp();expect(await screen.findByRole("heading",{name:/good morning/i})).toBeInTheDocument();expect(screen.getByRole("heading",{name:"Up next"})).toBeInTheDocument();await userEvent.click(screen.getByRole("button",{name:/open/i}));expect(screen.getByRole("heading",{name:/review liam foster/i})).toBeInTheDocument();expect(screen.getByText("Why this is here")).toBeInTheDocument()});
  it("prioritizes student work and next lesson",async()=>{renderApp("/portal");expect(await screen.findByRole("heading",{name:/welcome back/i})).toBeInTheDocument();expect(screen.getByRole("heading",{name:"Continue your work"})).toBeInTheDocument();expect(screen.getByRole("heading",{name:"Next lesson"})).toBeInTheDocument()});
  it("does not publish draft actor profiles",async()=>{renderApp("/actors/maya-kim");expect(await screen.findByRole("heading",{name:"Actor page unavailable"})).toBeInTheDocument()});
});
