export type AutomationSettings = {
  enabled?: boolean;
  coachNewBooking?: boolean;
  studentConfirmation?: boolean;
  reminders?: boolean;
  confirmationSubject?: string;
  confirmationBody?: string;
  coachSubject?: string;
  coachBody?: string;
  reminderSubject?: string;
  reminderBody?: string;
  rescheduleSubject?: string;
  rescheduleBody?: string;
  cancellationSubject?: string;
  cancellationBody?: string;
  packageExpirySubject?: string;
  packageExpiryBody?: string;
  paymentFailedSubject?: string;
  paymentFailedBody?: string;
};
export const emailDefaults: Required<AutomationSettings> = {
  enabled: true,
  coachNewBooking: true,
  studentConfirmation: true,
  reminders: true,
  confirmationSubject: "Your {{studioName}} booking is confirmed",
  confirmationBody:
    "Hi {{studentName}},\n\nYour {{serviceName}} booking is confirmed for {{startsAt}}.\n\nManage your booking: {{manageUrl}}",
  coachSubject: "New booking: {{studentName}} — {{serviceName}}",
  coachBody:
    "{{studentName}} booked {{serviceName}} for {{startsAt}} ({{location}}). Reference: {{reference}}.",
  reminderSubject: "Reminder: {{serviceName}} in {{hours}} hours",
  reminderBody:
    "Hi {{studentName}},\n\nYour {{serviceName}} session starts at {{startsAt}}. {{meetingDetails}}",
  rescheduleSubject: "{{serviceName}} rescheduled — {{startsAt}}",
  rescheduleBody:
    "Hi {{studentName}},\n\nYour {{serviceName}} lesson has been rescheduled to {{startsAt}}. Your calendar invitation is being updated automatically.\n\nLocation: {{location}}",
  cancellationSubject: "{{serviceName}} cancelled",
  cancellationBody:
    "Hi {{studentName}},\n\nYour {{serviceName}} lesson scheduled for {{startsAt}} has been cancelled. Your calendar invitation and studio schedule are being updated automatically.",
  packageExpirySubject: "{{packageName}} expires in {{days}} days",
  packageExpiryBody:
    "Hi {{studentName}},\n\nYour {{packageName}} has {{credits}} credits remaining and expires on {{expiresAt}}. You can book or review your package from your studio portal.",
  paymentFailedSubject: "Payment needs attention for {{studioName}}",
  paymentFailedBody:
    "We could not collect your scheduled payment. Please update your payment method within seven days.",
};
export const renderEmailTemplate = (
  template: string,
  values: Record<string, string>,
) =>
  template.replace(/{{([a-zA-Z]+)}}/g, (_, key: string) => values[key] ?? "");
