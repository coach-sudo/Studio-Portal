export function lessonPaymentPath(studentId?: string, lessonId?: string) {
  const params = new URLSearchParams({ pay: "lesson" });
  if (studentId) params.set("student", studentId);
  if (lessonId) params.set("lesson", lessonId);
  return `/portal/payments?${params}`;
}

export function lessonPaymentEmail(
  origin: string,
  studentId?: string,
  lessonId?: string,
) {
  const url = new URL(lessonPaymentPath(studentId, lessonId), origin);
  return {
    subject: "Pay for your Coach’D lesson",
    body: `Hi,\n\nUse the link below to sign in and pay your lesson invoice or choose a lesson package. You can open it on your phone or computer.\n\n${url.href}\n\nPlease reply if you have a question about your balance or which package to choose.\n\nCoach’D`,
  };
}
