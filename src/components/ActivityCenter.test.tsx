import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { demoSnapshot } from "../data/demo";
import { ActivityCenter } from "./ActivityCenter";

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="current route">{location.pathname}{location.search}</output>;
}

describe("ActivityCenter", () => {
  it("marks an item read in the interface and navigates directly to its route", () => {
    const data = structuredClone(demoSnapshot);
    data.lessons = [];
    data.lessonParticipants = [];
    data.materials = [];
    data.assignments = [];
    data.notes = [];
    data.integrationImports = [];
    data.bookings = [{
      ...structuredClone(demoSnapshot.bookings[0]), id: "booking-notification",
      guestName: "Notification Student", manageToken: undefined, updatedAt: new Date().toISOString(),
    }];

    render(
      <MemoryRouter initialEntries={["/coach"]}>
        <ActivityCenter data={data} audience="coach" />
        <Routes><Route path="*" element={<LocationProbe />} /></Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "1 unread notifications" }));
    fireEvent.click(screen.getByRole("button", { name: /booking confirmed\. notification student/i }));

    expect(screen.getByLabelText("current route")).toHaveTextContent("/coach/bookings?view=overview");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "0 unread notifications" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "0 unread notifications" }));
    expect(screen.queryByRole("button", { name: /booking confirmed\. notification student/i })).not.toBeInTheDocument();
    expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
  });

  it("navigates lesson activity directly to the exact student lesson workspace", () => {
    const data = structuredClone(demoSnapshot);
    data.bookings = [];
    data.materials = [];
    data.assignments = [];
    data.notes = [];
    data.integrationImports = [];
    data.lessons = [{
      ...structuredClone(demoSnapshot.lessons[0]),
      id: "lesson-notification",
      studentId: "student-maya",
      updatedAt: new Date().toISOString(),
    }];

    render(
      <MemoryRouter initialEntries={["/coach"]}>
        <ActivityCenter data={data} audience="coach" />
        <Routes><Route path="*" element={<LocationProbe />} /></Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "1 unread notifications" }));
    fireEvent.click(screen.getByRole("button", { name: /lesson updated/i }));

    expect(screen.getByLabelText("current route")).toHaveTextContent("/coach/students/student-maya/lessons/lesson-notification");
  });
});
