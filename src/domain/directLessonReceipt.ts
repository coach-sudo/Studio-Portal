const checkoutReceipt = /^lesson-checkout:([a-f\d-]{36}):([a-f\d-]{36})$/i;

export function directLessonReceipt(reference?: string | null) {
  const match = reference?.match(checkoutReceipt);
  if (!match) return undefined;
  return { checkoutId: match[1], lessonId: match[2] };
}
