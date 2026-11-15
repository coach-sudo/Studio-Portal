import { CustomCreditGrant } from "./CustomCreditGrant";
import type { BookingService } from "../../domain/model";
import { useSearchParams } from "react-router-dom";
import { CreditExpiration } from "./CreditExpiration";
import { SharedCreditRestoration } from "./SharedCreditRestoration";
import { SharedPoolBilling } from "./SharedPoolBilling";
import { useId, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog } from "../../components/Primitives";
import { SharedCreditPoolDetails } from "../../components/SharedCreditPools";
import {
  coachHouseholdsSchema,
  householdCreditCommand,
  householdReplySchema,
} from "../../data/householdCredits";
import { usePrivateIdentity } from "../../hooks/usePrivateIdentity";
import type { Json } from "../../types/database.generated";
import "./HouseholdCreditAdmin.css";

type CommandValue = Record<string, Json>;
type Action =
  | "create_household"
  | "configure_definition"
  | "issue"
  | "discretionary"
  | "membership"
  | "transfer";
type Confirmation = { action: string; values: CommandValue; key: string };

export function HouseholdCreditAdmin({
  studentId,
  timezone,
  services,
}: {
  studentId: string;
  timezone: string;
  services: BookingService[];
}) {
  const [params] = useSearchParams();
  const requestedHousehold = params.get("creditHousehold");
  const requestedPool = params.get("creditPool");
  const [open, setOpen] = useState(!!requestedHousehold);
  const [action, setAction] = useState<Action>("create_household");
  const [householdId, setHouseholdId] = useState("");
  const [definitionId, setDefinitionId] = useState("");
  const [targetType, setTargetType] = useState("student");
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [preview, setPreview] =
    useState<ReturnType<typeof householdReplySchema.parse>>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const identity = usePrivateIdentity();
  const formId = useId();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["coach-credit-households", identity, studentId],
    enabled: open && !!identity,
    queryFn: async ({ signal }) =>
      coachHouseholdsSchema.parse(
        await householdCreditCommand(studentId, "coach", {}, signal),
      ),
  });
  const data = query.data;
  const household = data?.households.find((item) => item.id === householdId);
  const definition = data?.definitions.find((item) => item.id === definitionId);
  const clearReview = () => {
    setConfirmation(undefined);
    setPreview(undefined);
    setMessage("");
  };

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values: CommandValue = {
      reason: String(form.get("reason") ?? "").trim(),
    };
    if (action === "create_household") {
      values.name = String(form.get("name"));
      values.members = form.getAll("members").map(String);
      if (!values.members.length) {
        setMessage("Choose at least one student.");
        return;
      }
    } else if (action === "configure_definition") {
      values.definitionId = definitionId;
      values.shared = form.has("shared");
      values.transfer = form.has("transfer");
    } else if (action === "issue" || action === "discretionary") {
      values.householdId = householdId;
      values.definitionId = definitionId;
      if (action === "discretionary") {
        const expires = String(form.get("expiresAt") ?? "");
        values.serviceId = String(form.get("serviceId"));
        values.durationMinutes = Number(form.get("durationMinutes"));
        values.quantity = Number(form.get("quantity"));
        values.expiresAt = expires ? new Date(expires).toISOString() : null;
        values.members = form.getAll("members").map(String);
        values.portalVisible = form.has("portalVisible");
      }
    } else {
      values.packageId = String(form.get("packageId"));
      if (action === "membership") {
        values.studentId = String(form.get("member"));
        values.eligible = form.get("eligible") === "true";
      } else {
        values.quantity = Number(form.get("quantity"));
        values[targetType === "household" ? "householdId" : "studentId"] =
          String(form.get("recipient"));
      }
    }
    setBusy(true);
    setMessage("");
    try {
      const reviewed =
        action === "membership" ||
        action === "transfer" ||
        action === "discretionary";
      if (reviewed) {
        const reply = householdReplySchema.parse(
          await householdCreditCommand(studentId, action + "_preview", values),
        );
        setPreview(reply);
        if (!reply.canApply) return;
        values.preview =
          action === "discretionary"
            ? (reply.grantPreview ?? null)
            : (Object.fromEntries(
                Object.entries(reply).filter(
                  ([key]) => key !== "status" && key !== "canApply",
                ),
              ) as Json);
      }
      setConfirmation({
        action: reviewed ? action + "_apply" : action,
        values,
        key: crypto.randomUUID(),
      });
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The preview is unavailable.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!confirmation) return;
    setBusy(true);
    setMessage("");
    try {
      const reply = householdReplySchema.parse(
        await householdCreditCommand(studentId, confirmation.action, {
          ...confirmation.values,
          key: confirmation.key,
        }),
      );
      setConfirmation(undefined);
      if (reply.status !== "completed") {
        setPreview(reply);
        setMessage(
          "The change was left unapplied. Review the latest balances and preview again.",
        );
        return;
      }
      setPreview(undefined);
      setMessage("Household credit change saved.");
      await Promise.all([
        client.invalidateQueries({ queryKey: ["coach-credit-households"] }),
        client.invalidateQueries({ queryKey: ["shared-credit-pools"] }),
        client.invalidateQueries({ queryKey: ["credit-coverage"] }),
      ]);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The change could not be verified. You can retry.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Household credits
      </button>
      {open && (
        <Dialog
          title="Household credits"
          className="household-credit-dialog"
          onClose={() => {
            if (busy) return;
            setOpen(false);
            clearReview();
          }}
        >
          {query.isError && (
            <p role="alert">Household credit administration is unavailable.</p>
          )}
          {data && (
            <>
              {!confirmation &&
                data.households.map((group) => (
                  <details
                    key={group.id}
                    className="disclosure-section"
                    open={group.id === requestedHousehold || undefined}
                  >
                    <summary>
                      {group.name} · {group.pools.length} shared{" "}
                      {group.pools.length === 1 ? "package" : "packages"}
                    </summary>
                    <p>
                      {group.members.map((member) => member.name).join(", ")}
                    </p>
                    {group.pools.map((pool) => (
                      <div
                        key={pool.id}
                        className={
                          pool.id === requestedPool
                            ? "portal-notice"
                            : undefined
                        }
                      >
                        <SharedCreditPoolDetails
                          pool={pool}
                          timezone={timezone}
                        />
                        <SharedPoolBilling
                          studentId={studentId}
                          packageId={pool.id}
                          timezone={timezone}
                        />
                        <CreditExpiration
                          studentId={studentId}
                          packageId={pool.id}
                          expiresAt={pool.expiresAt}
                          timezone={timezone}
                        />
                        {pool.members.length > 0 &&
                          pool.services.length === 1 && (
                            <CustomCreditGrant
                              studentId={pool.members[0].id}
                              shared={pool}
                              services={services.filter(
                                (service) => service.name === pool.services[0],
                              )}
                            />
                          )}
                        <SharedCreditRestoration
                          studentId={studentId}
                          packageId={pool.id}
                          timezone={timezone}
                        />
                      </div>
                    ))}
                  </details>
                ))}
              <form
                className="workflow-form"
                hidden={!!confirmation}
                onSubmit={(event) => void prepare(event)}
              >
                <fieldset disabled={busy || !!confirmation}>
                  <label htmlFor={formId + "-action"}>
                    Action
                    <select
                      id={formId + "-action"}
                      value={action}
                      onChange={(event) => {
                        setAction(event.target.value as Action);
                        setDefinitionId("");
                        clearReview();
                      }}
                    >
                      <option value="create_household">
                        Create credit household
                      </option>
                      <option value="configure_definition">
                        Set package sharing and transfer policy
                      </option>
                      <option value="issue">Issue a shared package</option>
                      <option value="discretionary">
                        Grant a new shared credit lot
                      </option>
                      <option value="membership">
                        Change eligible student
                      </option>
                      <option value="transfer">
                        Transfer eligible credits
                      </option>
                    </select>
                  </label>
                  {action === "create_household" && (
                    <>
                      <label htmlFor={formId + "-name"}>
                        Household name
                        <input
                          id={formId + "-name"}
                          name="name"
                          maxLength={120}
                          required
                        />
                      </label>
                      <label htmlFor={formId + "-students"}>
                        Students
                        <select
                          id={formId + "-students"}
                          name="members"
                          required
                          multiple
                        >
                          {data.students
                            .filter(
                              (student) =>
                                !data.households.some((group) =>
                                  group.members.some(
                                    (member) => member.id === student.id,
                                  ),
                                ),
                            )
                            .map((student) => (
                              <option key={student.id} value={student.id}>
                                {student.name}
                              </option>
                            ))}
                        </select>
                      </label>
                    </>
                  )}
                  {(action === "configure_definition" ||
                    action === "issue" ||
                    action === "discretionary") && (
                    <label htmlFor={formId + "-definition"}>
                      Package definition
                      <select
                        id={formId + "-definition"}
                        value={definitionId}
                        required
                        onChange={(event) =>
                          setDefinitionId(event.target.value)
                        }
                      >
                        <option value="">Choose a package</option>
                        {data.definitions
                          .filter(
                            (item) =>
                              action === "configure_definition" || item.shared,
                          )
                          .map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                  {action === "configure_definition" && definition && (
                    <div key={definition.id}>
                      <label htmlFor={formId + "-shared"}>
                        <input
                          id={formId + "-shared"}
                          name="shared"
                          type="checkbox"
                          defaultChecked={definition.shared}
                        />{" "}
                        Allow shared household issuance
                      </label>
                      <label htmlFor={formId + "-transfer"}>
                        <input
                          id={formId + "-transfer"}
                          name="transfer"
                          type="checkbox"
                          defaultChecked={definition.transfer}
                        />{" "}
                        Allow transfers for future issuance
                      </label>
                    </div>
                  )}
                  {(action === "issue" ||
                    action === "membership" ||
                    action === "discretionary") && (
                    <label htmlFor={formId + "-household"}>
                      Household
                      <select
                        id={formId + "-household"}
                        required
                        value={householdId}
                        onChange={(event) => setHouseholdId(event.target.value)}
                      >
                        <option value="">Choose a household</option>
                        {data.households.map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {action === "discretionary" && household && (
                    <>
                      <label>
                        Eligible lesson service
                        <select name="serviceId" required>
                          <option value="">
                            Choose a service approved by this package
                          </option>
                          {services.map((service) => (
                            <option key={service.id} value={service.id}>
                              {service.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Eligible duration in minutes
                        <input
                          name="durationMinutes"
                          type="number"
                          min={15}
                          max={480}
                          required
                        />
                      </label>
                      <label>
                        Credit quantity
                        <input
                          name="quantity"
                          type="number"
                          min={1}
                          max={100000}
                          required
                        />
                      </label>
                      <label>
                        Expiration (leave blank if allowed by the package)
                        <input name="expiresAt" type="datetime-local" />
                      </label>
                      <fieldset key={household.id}>
                        <legend>Eligible students</legend>
                        {household.members.map((member) => (
                          <label key={member.id}>
                            <input
                              type="checkbox"
                              name="members"
                              value={member.id}
                            />
                            {member.name}
                          </label>
                        ))}
                      </fieldset>
                      <label>
                        <input
                          type="checkbox"
                          name="portalVisible"
                          defaultChecked
                        />
                        Show the grant in portal credit history
                      </label>
                    </>
                  )}
                  {action === "membership" && household && (
                    <>
                      <label htmlFor={formId + "-shared-package"}>
                        Shared package
                        <select
                          id={formId + "-shared-package"}
                          name="packageId"
                          required
                        >
                          <option value="">Choose a shared package</option>
                          {household.pools.map((pool) => (
                            <option key={pool.id} value={pool.id}>
                              {pool.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label htmlFor={formId + "-student"}>
                        Student
                        <select id={formId + "-student"} name="member" required>
                          <option value="">Choose a student</option>
                          {household.members.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label htmlFor={formId + "-eligibility"}>
                        Eligibility
                        <select id={formId + "-eligibility"} name="eligible">
                          <option value="true">
                            Allow this student to use the pool
                          </option>
                          <option value="false">
                            Remove this student's eligibility
                          </option>
                        </select>
                      </label>
                    </>
                  )}
                  {action === "transfer" && (
                    <>
                      <label htmlFor={formId + "-source"}>
                        Source package
                        <select
                          id={formId + "-source"}
                          name="packageId"
                          required
                        >
                          <option value="">
                            Choose a transferable package
                          </option>
                          {data.transferLots.map((lot) => (
                            <option key={lot.id} value={lot.id}>
                              {lot.name} ·{" "}
                              {data.students.find(
                                (item) => item.id === lot.studentId,
                              )?.name ??
                                data.households.find(
                                  (item) => item.id === lot.householdId,
                                )?.name}{" "}
                              · {lot.id.slice(0, 8)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label htmlFor={formId + "-recipient-type"}>
                        Recipient type
                        <select
                          id={formId + "-recipient-type"}
                          value={targetType}
                          onChange={(event) =>
                            setTargetType(event.target.value)
                          }
                        >
                          <option value="student">Student</option>
                          <option value="household">Household</option>
                        </select>
                      </label>
                      <label htmlFor={formId + "-recipient"}>
                        Recipient
                        <select
                          id={formId + "-recipient"}
                          key={targetType}
                          name="recipient"
                          required
                        >
                          <option value="">Choose a recipient</option>
                          {(targetType === "student"
                            ? data.students
                            : data.households
                          ).map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label htmlFor={formId + "-quantity"}>
                        Credit quantity
                        <input
                          id={formId + "-quantity"}
                          name="quantity"
                          type="number"
                          min={1}
                          step={1}
                          required
                        />
                      </label>
                    </>
                  )}
                  <label htmlFor={formId + "-reason"}>
                    Reason
                    <textarea
                      id={formId + "-reason"}
                      name="reason"
                      minLength={3}
                      maxLength={500}
                      required
                    />
                  </label>
                  <button type="submit">Preview change</button>
                </fieldset>
              </form>
              {confirmation && (
                <div className="workflow-content">
                  <h3>Review change</h3>
                  {confirmation.values.name && (
                    <p>{String(confirmation.values.name)}</p>
                  )}
                  {confirmation.values.definitionId && (
                    <p>{definition?.name}</p>
                  )}
                  {confirmation.values.householdId && (
                    <p>
                      {
                        data.households.find(
                          (group) =>
                            group.id === confirmation.values.householdId,
                        )?.name
                      }
                    </p>
                  )}
                  {confirmation.values.studentId && (
                    <p>
                      {
                        data.students.find(
                          (student) =>
                            student.id === confirmation.values.studentId,
                        )?.name
                      }
                      {action === "membership" &&
                        (confirmation.values.eligible
                          ? " gains access to the pool."
                          : " loses access to the pool.")}
                    </p>
                  )}
                  <p>Reason · {String(confirmation.values.reason)}</p>
                </div>
              )}
              {preview && (
                <div className="portal-notice household-credit-preview">
                  {preview.grantPreview && (
                    <>
                      <p>
                        New pool · {preview.grantPreview.serviceName} ·{" "}
                        {preview.grantPreview.durationMinutes} min
                      </p>
                      <p>
                        Available credits 0 → {preview.grantPreview.quantity}
                      </p>
                      <p>
                        {preview.grantPreview.expiresAt
                          ? "Expires " +
                            new Date(
                              preview.grantPreview.expiresAt,
                            ).toLocaleString()
                          : "No expiration"}
                      </p>
                      <p>
                        Eligible students ·{" "}
                        {household?.members
                          .filter((member) =>
                            preview.grantPreview?.members.includes(member.id),
                          )
                          .map((member) => member.name)
                          .join(", ")}
                      </p>
                      <p>
                        {preview.grantPreview.portalVisible
                          ? "Shown in portal credit history"
                          : "Private audit only"}
                      </p>
                    </>
                  )}
                  {preview.packageName && (
                    <p>
                      {preview.packageName} · {preview.durationMinutes} min
                    </p>
                  )}
                  {typeof preview.sourceAfter === "number" && (
                    <p>
                      Source availability {preview.sourceAvailable} →{" "}
                      {preview.sourceAfter} · {preview.sourceReserved} reserved
                      · Recipient receives {preview.destinationAfter}{" "}
                      {preview.destinationAfter === 1 ? "credit" : "credits"}
                    </p>
                  )}
                  {preview.conflicts?.map((lesson) => (
                    <p key={lesson.id}>
                      {lesson.topic} has a reservation in this pool.
                    </p>
                  ))}
                  {preview.canApply === false && (
                    <p>
                      This change cannot be applied. Check package permission,
                      credit availability, and household eligibility.
                    </p>
                  )}
                </div>
              )}
              {confirmation && (
                <div className="header-actions">
                  <button type="button" onClick={clearReview} disabled={busy}>
                    Back to edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void confirm()}
                    disabled={busy}
                  >
                    Confirm change
                  </button>
                </div>
              )}
              {message && <p role="status">{message}</p>}
            </>
          )}
        </Dialog>
      )}
    </>
  );
}
