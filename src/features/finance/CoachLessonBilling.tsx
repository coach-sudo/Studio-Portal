import { canRecordDirectLessonPayment } from "../../domain/lessonPayment";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { LessonPaymentReceipt } from "../../components/LessonPaymentReceipt";
import { Dialog } from "../../components/Primitives";
import type { Lesson, StudioSnapshot } from "../../domain/model";
import { invalidateStudioDomains } from "../../hooks/useStudio";
import { InvoiceWorkspace } from "./InvoiceWorkspace";

export function CoachLessonBilling({
  data,
  lesson,
  isDemo,
  inlineReceipt,
}: {
  data: StudioSnapshot;
  lesson: Lesson;
  isDemo: boolean;
  inlineReceipt?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  return (
    <>
      <div className="header-actions">
        <InvoiceWorkspace
          data={data}
          isDemo={isDemo}
          studentId={lesson.studentId}
          lessonId={lesson.id}
        />
        {inlineReceipt === undefined &&
          (canRecordDirectLessonPayment(lesson) ||
            (!lesson.invoiceId && (lesson.paidMinor ?? 0) > 0)) && (
            <button onClick={() => setRecording(true)}>
              {canRecordDirectLessonPayment(lesson)
                ? "Record payment"
                : "Review recorded payment"}
            </button>
          )}
        {["scheduled", "completed"].includes(lesson.status) &&
          !["paid", "paid_by_credit", "waived", "refunded"].includes(
            lesson.paymentStatus ?? "",
          ) && (
            <Link
              className="button-link"
              to={`/coach/inbox?email=1&template=lesson_payment&student=${encodeURIComponent(lesson.studentId)}&lesson=${encodeURIComponent(lesson.id)}`}
            >
              Email payment link
            </Link>
          )}
      </div>
      {inlineReceipt && !lesson.invoiceId && (
        <CoachLessonPayment lesson={lesson} isDemo={isDemo} />
      )}
      {recording && (
        <CoachLessonPaymentDialog
          lesson={lesson}
          isDemo={isDemo}
          onClose={() => setRecording(false)}
        />
      )}
    </>
  );
}

export function CoachLessonPaymentDialog({
  lesson,
  isDemo,
  onClose,
}: {
  lesson: Lesson;
  isDemo: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog
      title="Record lesson payment"
      description={lesson.topic}
      onClose={onClose}
    >
      <CoachLessonPayment lesson={lesson} isDemo={isDemo} />
    </Dialog>
  );
}

function CoachLessonPayment({
  lesson,
  isDemo,
}: {
  lesson: Lesson;
  isDemo: boolean;
}) {
  const queryClient = useQueryClient();
  return (
    <LessonPaymentReceipt
      lessonId={lesson.id}
      isDemo={isDemo}
      onSaved={() =>
        invalidateStudioDomains(queryClient, ["lessons", "finance", "booking"])
      }
    />
  );
}
