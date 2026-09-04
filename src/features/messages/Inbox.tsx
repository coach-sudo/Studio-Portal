import { ArrowLeft, Mail, MessageSquare, Plus, RotateCcw, Search, Send, Users } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Dialog, EmptyState, PageHeader, Status } from "../../components/Primitives";
import { studioCommand } from "../../data/bookingCommands";
import type { Conversation, ConversationMessage, Role, StudioSnapshot } from "../../domain/model";
import { formatStudioDateTime } from "../../domain/presentation";
import { useStudio } from "../../hooks/useStudio";
import { useStudioStore } from "../../state/StudioStore";
import { useQueryClient } from "@tanstack/react-query";

type Thread = Conversation & { subtitle: string; unread?: boolean; draftBody?: string };

export function CoachInbox() {
  const { data, isLoading, isDemo } = useStudio();
  if (isLoading || !data) return <div className="loading">Opening inbox…</div>;
  return <Inbox data={data} isDemo={isDemo} role="coach" />;
}

export function PortalInbox({ data, isDemo, role }: { data: StudioSnapshot; isDemo: boolean; role: Extract<Role, "student" | "guardian"> }) {
  return <Inbox data={data} isDemo={isDemo} role={role} />;
}

function threadCandidates(data: StudioSnapshot, role: Role): Thread[] {
  const known = new Map<string, Thread>();
  for (const conversation of data.conversations) {
    const student = data.students.find((item) => item.id === conversation.studentId);
    const state = data.conversationStates.find((item) => item.conversationId === conversation.id);
    const latest = [...data.conversationMessages].reverse().find((item) => item.conversationId === conversation.id);
    known.set(conversation.kind === "direct" ? `student:${conversation.studentId}` : `offering:${conversation.offeringId}`, {
      ...conversation,
      subtitle: conversation.kind === "class" ? "Group class" : student?.email || "Private conversation",
      unread: Boolean(latest && latest.authorRole !== role && (!state?.lastReadAt || latest.createdAt > state.lastReadAt)),
      draftBody: state?.draftBody || "",
    });
  }
  const students = role === "coach" ? data.students.filter((item) => !item.deletedAt) : data.students;
  for (const student of students) {
    const key = `student:${student.id}`;
    if (!known.has(key)) known.set(key, {
      id: key,
      studioId: data.studioId,
      kind: "direct",
      studentId: student.id,
      title: student.preferredName || student.fullName,
      subtitle: student.email || "Private conversation",
      lastMessageAt: "",
      version: 0,
      updatedAt: "",
    });
  }
  for (const offering of data.serviceOfferings.filter((item) => item.published)) {
    const key = `offering:${offering.id}`;
    if (!known.has(key)) known.set(key, {
      id: key,
      studioId: data.studioId,
      kind: "class",
      offeringId: offering.id,
      title: offering.title,
      subtitle: "Group class",
      lastMessageAt: "",
      version: 0,
      updatedAt: "",
    });
  }
  return [...known.values()].sort((a, b) => (b.lastMessageAt || "").localeCompare(a.lastMessageAt || "") || a.title.localeCompare(b.title));
}

const emailTemplates = {
  custom: { label: "Custom email", subject: "", body: "" },
  reminder: { label: "Lesson reminder", subject: "Your upcoming Coach'D lesson", body: "A quick reminder about your upcoming lesson. Open your portal for the current time, joining link, and lesson work." },
  schedule: { label: "Schedule update", subject: "Your Coach'D schedule was updated", body: "Your lesson schedule has changed. Open your portal to review the current date, time, and lesson details." },
  work: { label: "Notes or materials", subject: "New lesson work in Coach'D", body: "New notes or materials are ready in your portal." },
  package: { label: "Package reminder", subject: "Your Coach'D lesson package", body: "Your lesson package needs attention. Open Payments in your portal to review the balance and renewal options." },
  access: { label: "Account access", subject: "Your Coach'D portal access", body: "Your Coach'D portal account is ready. Use the most recent secure login instructions sent to this address." },
} as const;

function Inbox({ data, isDemo, role }: { data: StudioSnapshot; isDemo: boolean; role: Role }) {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const store = useStudioStore();
  const threads = useMemo(() => threadCandidates(data, role), [data, role]);
  const [threadFilter, setThreadFilter] = useState<"recent" | "unread" | "drafts">("recent");
  const [newMessageOpen, setNewMessageOpen] = useState(false);
  const [recipientSearch, setRecipientSearch] = useState("");
  const requested = params.get("conversation");
  const requestedStudent = params.get("student");
  const requestedOffering = params.get("offering");
  const initial = threads.find((item) => item.id === requested)
    || threads.find((item) => item.studentId === requestedStudent)
    || threads.find((item) => item.offeringId === requestedOffering);
  const [selectedKey, setSelectedKey] = useState(initial?.id || "");
  const selected = selectedKey ? threads.find((item) => item.id === selectedKey) || initial : undefined;
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [undoMessage, setUndoMessage] = useState<{ id: string; until: number }>();
  const [undoEmail, setUndoEmail] = useState<{ id: string; until: number }>();
  const [clock, setClock] = useState(Date.now());
  const [emailOpen, setEmailOpen] = useState(params.get("email") === "1");
  const [emailTemplate, setEmailTemplate] = useState<keyof typeof emailTemplates>("custom");
  const selectedStudent = data.students.find((item) => item.id === selected?.studentId);
  const [email, setEmail] = useState({ recipient: params.get("recipient") || selectedStudent?.email || "", subject: "", body: "" });
  const visibleThreads = useMemo(() => {
    const recentCutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;
    return threads.filter((thread) => threadFilter === "unread" ? thread.unread : threadFilter === "drafts" ? Boolean(thread.draftBody) : thread.unread || Boolean(thread.draftBody) || (Boolean(thread.lastMessageAt) && new Date(thread.lastMessageAt).getTime() >= recentCutoff) || (role !== "coach" && !thread.lastMessageAt)).slice(0, 30);
  }, [threads, threadFilter, role]);
  const recipients = useMemo(() => {
    const query = recipientSearch.trim().toLowerCase();
    const students = data.students.filter((student) => !student.deletedAt).map((student) => {
      const household = data.linkedContacts.filter((contact) => contact.studentId === student.id && contact.portalEnabled);
      const searchText = [student.fullName, student.preferredName, student.email, ...household.flatMap((contact) => [contact.fullName, contact.email, contact.relationshipLabel])].filter(Boolean).join(" ").toLowerCase();
      const thread = threads.find((item) => item.studentId === student.id) || { id:`student:${student.id}`, studioId:data.studioId, kind:"direct" as const, studentId:student.id, title:student.preferredName || student.fullName, subtitle:student.email || "Private conversation", lastMessageAt:"", version:0, updatedAt:"" };
      return { key:`student:${student.id}`, title:student.preferredName || student.fullName, subtitle:[student.email, household.length ? `${household.length} household contact${household.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · "), searchText, thread };
    });
    const classes = data.serviceOfferings.filter((item)=>item.published).map((offering)=>({ key:`offering:${offering.id}`, title:offering.title, subtitle:"Group class", searchText:`${offering.title} group class`.toLowerCase(), thread:threads.find((item)=>item.offeringId===offering.id) || { id:`offering:${offering.id}`, studioId:data.studioId, kind:"class" as const, offeringId:offering.id, title:offering.title, subtitle:"Group class", lastMessageAt:"", version:0, updatedAt:"" } }));
    return [...students, ...classes].filter((item)=>!query || item.searchText.includes(query)).slice(0,40);
  }, [data, recipientSearch, threads]);

  useEffect(() => {
    if (!undoMessage && !undoEmail) return;
    const timer = window.setInterval(() => setClock(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [undoMessage, undoEmail]);
  useEffect(() => {
    if (undoMessage && clock >= undoMessage.until) setUndoMessage(undefined);
    if (undoEmail && clock >= undoEmail.until) setUndoEmail(undefined);
  }, [clock, undoMessage, undoEmail]);

  const messages = selected && !selected.id.startsWith("student:") && !selected.id.startsWith("offering:")
    ? data.conversationMessages.filter((item) => item.conversationId === selected.id)
    : [];

  const choose = (thread: Thread) => {
    setSelectedKey(thread.id);
    setParams({ conversation: thread.id });
    setNotice("");
    setBody(thread.draftBody || "");
    setNewMessageOpen(false);
  };

  useEffect(() => {
    setBody(selected?.draftBody || "");
  }, [selected?.id]);

  useEffect(() => {
    if (!selected || selected.id.startsWith("student:") || selected.id.startsWith("offering:")) return;
    if (isDemo) {
      store.transact((draft) => {
        const state = draft.conversationStates.find((item) => item.conversationId === selected.id);
        if (state) { state.lastReadAt = new Date().toISOString(); state.updatedAt = new Date().toISOString(); }
        else draft.conversationStates.push({ conversationId:selected.id, userId:"demo-user", lastReadAt:new Date().toISOString(), draftBody:selected.draftBody || "", updatedAt:new Date().toISOString() });
      });
    } else void studioCommand("messages", { command:"mark_read", entityId:selected.id, expectedVersion:0, payload:{}, reason:"Opened inbox conversation" }).then(()=>queryClient.invalidateQueries({queryKey:["studio"]})).catch(()=>undefined);
  }, [selected?.id]);

  useEffect(() => {
    if (!selected || selected.id.startsWith("student:") || selected.id.startsWith("offering:") || body === (selected.draftBody || "")) return;
    const timer = window.setTimeout(() => {
      if (isDemo) store.transact((draft)=>{const state=draft.conversationStates.find((item)=>item.conversationId===selected.id);if(state){state.draftBody=body;state.updatedAt=new Date().toISOString();}else draft.conversationStates.push({conversationId:selected.id,userId:"demo-user",draftBody:body,updatedAt:new Date().toISOString()});});
      else void studioCommand("messages", {command:"save_draft",entityId:selected.id,expectedVersion:0,payload:{body},reason:"Saved inbox draft"}).catch(()=>undefined);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [body, selected?.id, isDemo]);

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    const text = body.trim();
    if (!selected || !text || busy) return;
    setBusy(true);
    setNotice("");
    try {
      if (isDemo) {
        let conversationId = selected.id;
        const messageId = `conversation-message-${crypto.randomUUID()}`;
        store.transact((draft) => {
          if (conversationId.startsWith("student:") || conversationId.startsWith("offering:")) {
            conversationId = `conversation-${crypto.randomUUID()}`;
            draft.conversations.push({ ...selected, id: conversationId, version: 1, lastMessageAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
          }
          const message: ConversationMessage = { id: messageId, conversationId, studioId: data.studioId, authorRole: role, authorName: data.displayName, body: text, createdAt: new Date().toISOString() };
          draft.conversationMessages.push(message);
        });
        setUndoMessage({ id: messageId, until: Date.now() + 10_000 });
        setSelectedKey(conversationId);
      } else {
        const response = await studioCommand("messages", {
          command: "send",
          expectedVersion: selected.version,
          payload: {
            conversationId: selected.id.startsWith("student:") || selected.id.startsWith("offering:") ? undefined : selected.id,
            studentId: selected.studentId,
            offeringId: selected.offeringId,
            body: text,
          },
          reason: "Sent a studio inbox message",
        });
        const messageId = response.resource.id as string;
        const conversationId = response.resource.conversation_id as string;
        setSelectedKey(conversationId);
        setParams({ conversation: conversationId });
        setUndoMessage({ id: messageId, until: Date.now() + 10_000 });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setBody("");
      setNotice("Message sent.");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Message could not be sent.");
    } finally {
      setBusy(false);
    }
  };

  const undoLastMessage = async () => {
    if (!undoMessage) return;
    const target = undoMessage;
    setUndoMessage(undefined);
    try {
      if (isDemo) store.transact((draft) => { draft.conversationMessages = draft.conversationMessages.filter((item) => item.id !== target.id); });
      else {
        await studioCommand("messages", { command: "undo", entityId: target.id, expectedVersion: 1, reason: "Undid a just-sent inbox message" });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setNotice("Message undone.");
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Message could not be undone."); }
  };

  const openEmail = (source?: StudioSnapshot["outbox"][number]) => {
    const recipient = source?.recipient || selectedStudent?.email || "";
    setEmail({ recipient, subject: source?.subject || "", body: source?.body || "" });
    setEmailTemplate("custom");
    setEmailOpen(true);
  };

  const chooseEmailTemplate = (key: keyof typeof emailTemplates) => {
    setEmailTemplate(key);
    const template = emailTemplates[key];
    setEmail((current) => ({ ...current, subject: template.subject, body: template.body }));
  };

  const sendEmail = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (isDemo) {
        const id = `outbox-${crypto.randomUUID()}`;
        store.transact((draft) => draft.outbox.push({ id, studentId: selectedStudent?.id, channel: "email", recipient: email.recipient, subject: email.subject, body: email.body, status: "queued", attempts: 0, sendAt: new Date(Date.now() + 8_000).toISOString(), eventKey: "manual.email", version: 1, updatedAt: new Date().toISOString() }));
        setUndoEmail({ id, until: Date.now() + 8_000 });
      } else {
        const response = await studioCommand("outbox", { command: "manual_send", expectedVersion: 0, payload: { ...email, studentId: selectedStudent?.id }, reason: `Manually sent ${emailTemplate.replaceAll("_", " ")} email` });
        setUndoEmail({ id: response.resource.id, until: new Date(response.undoUntil).getTime() });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setEmailOpen(false);
      setNotice("Email queued. You have a few seconds to undo it.");
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Email could not be queued."); }
    finally { setBusy(false); }
  };

  const resendEmail = async (source: StudioSnapshot["outbox"][number]) => {
    if (busy) return;
    setBusy(true);
    try {
      if (isDemo) openEmail(source);
      else {
        const response = await studioCommand("outbox", { command: "resend", entityId: source.id, expectedVersion: source.version, reason: "Coach manually resent an email" });
        setUndoEmail({ id: response.resource.id, until: new Date(response.undoUntil).getTime() });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
        setNotice("Email queued again. You have a few seconds to undo it.");
      }
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Email could not be queued again."); }
    finally { setBusy(false); }
  };

  const undoLastEmail = async () => {
    if (!undoEmail) return;
    const target = undoEmail;
    setUndoEmail(undefined);
    try {
      if (isDemo) store.transact((draft) => { const item = draft.outbox.find((row) => row.id === target.id); if (item) item.status = "cancelled"; });
      else {
        await studioCommand("outbox", { command: "cancel_manual", entityId: target.id, expectedVersion: 1, reason: "Coach undid a manual email send" });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setNotice("Email send undone.");
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "This email has already started sending."); }
  };

  const history = role === "coach" ? [...data.outbox].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8) : [];
  return <div className={role === "coach" ? "page inbox-page" : "student-page inbox-page"}>
    <PageHeader title="Inbox" action={role === "coach" ? <div className="header-actions"><button onClick={() => setNewMessageOpen(true)}><Plus />New message</button><button className="primary-button" onClick={() => openEmail()}><Mail />Send email</button></div> : undefined}>
      Private conversations and group-class messages in one place.
    </PageHeader>
    {notice && <p className="portal-notice" role="status">{notice}</p>}
    {(undoMessage || undoEmail) && <div className="undo-send" role="status"><span>{undoEmail ? "Email queued" : "Message sent"}</span><button onClick={() => void (undoEmail ? undoLastEmail() : undoLastMessage())}><RotateCcw />Undo ({Math.max(1, Math.ceil(((undoEmail || undoMessage)!.until - clock) / 1000))}s)</button></div>}
    <div className={`inbox-layout ${selected ? "has-selection" : ""}`}>
      <aside className="inbox-threads" aria-label="Conversations">
        <header><strong>Conversations</strong><small>{threads.filter((thread)=>thread.unread).length} unread</small></header>
        <div className="inbox-filters">{(["recent","unread","drafts"] as const).map((filter)=><button key={filter} className={threadFilter===filter?"active":""} onClick={()=>setThreadFilter(filter)}>{filter}</button>)}</div>
        {visibleThreads.map((thread) => <button key={thread.id} className={`${selected?.id === thread.id ? "active" : ""} ${thread.unread ? "unread" : ""}`} onClick={() => choose(thread)}><span>{thread.kind === "class" ? <Users /> : <MessageSquare />}</span><div><strong>{thread.title}{thread.unread&&<i aria-label="Unread"/>}</strong><small>{thread.draftBody ? `Draft: ${thread.draftBody}` : thread.subtitle}</small></div></button>)}
        {!visibleThreads.length && <EmptyState title={threadFilter === "unread" ? "No unread messages" : threadFilter === "drafts" ? "No saved drafts" : "No recent conversations"} detail="Use New message to find any student, household, or group class." />}
      </aside>
      <section className="inbox-conversation">
        {selected ? <>
          <header><button className="inbox-back" onClick={() => setSelectedKey("")} aria-label="Back to conversations"><ArrowLeft /></button><div><strong>{selected.title}</strong><small>{selected.subtitle}</small></div>{role === "coach" && selectedStudent?.email && <button onClick={() => openEmail()}><Mail />Email</button>}</header>
          <div className="inbox-messages" aria-live="polite">
            {messages.map((message) => <article key={message.id} className={message.authorRole === role || (role === "coach" && message.authorRole === "coach") ? "mine" : "theirs"}><small>{message.authorName}</small><p>{message.body}</p><time>{formatStudioDateTime(message.createdAt, data.settings.timezone)}</time></article>)}
            {!messages.length && <EmptyState title="Start the conversation" detail={selected.kind === "class" ? "Everyone enrolled in this class can read and reply here." : "Messages stay private between the studio and this household."} />}
          </div>
          <form className="inbox-composer" onSubmit={sendMessage}><label htmlFor="inbox-message">Message</label><textarea id="inbox-message" maxLength={4000} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write a clear, helpful message…" /><button className="primary" disabled={busy || !body.trim()}><Send />{busy ? "Sending…" : "Send"}</button></form>
        </> : <EmptyState title="Choose a conversation" detail="Select a student, household, or group class to begin." />}
      </section>
    </div>
    {role === "coach" && <section className="inbox-email-history"><header><div><strong>Recent email</strong><small>Any recorded email can be sent again manually.</small></div></header><div className="table-list">{history.map((item) => <article key={item.id}><Mail /><div><strong>{item.subject}</strong><small>{item.recipient} · {item.status}</small></div><Status tone={item.status === "sent" ? "good" : item.status === "failed" ? "danger" : "neutral"}>{item.status}</Status><button disabled={busy} onClick={() => void resendEmail(item)}>Send again</button></article>)}{!history.length && <EmptyState title="No email history" detail="Manually sent and automated email will appear here." />}</div></section>}
    {newMessageOpen && <Dialog title="New message" description="Search by student, guardian, support person, email, or group class. Household messages stay together in one private thread." onClose={()=>setNewMessageOpen(false)}><div className="recipient-picker"><label><Search/>Find a person or class<input autoFocus value={recipientSearch} onChange={(event)=>setRecipientSearch(event.target.value)} placeholder="Start typing a name or email…"/></label><div>{recipients.map((recipient)=><button key={recipient.key} onClick={()=>choose(recipient.thread)}><span><strong>{recipient.title}</strong><small>{recipient.subtitle}</small></span><MessageSquare/></button>)}{!recipients.length&&<EmptyState title="No match" detail="Try a different name or email address."/>}</div></div></Dialog>}
    {emailOpen && <Dialog title="Send email" description="The email waits eight seconds before delivery so you can undo an accidental send." onClose={() => !busy && setEmailOpen(false)}><form className="workflow-form" onSubmit={sendEmail}><label>Template<select value={emailTemplate} onChange={(event) => chooseEmailTemplate(event.target.value as keyof typeof emailTemplates)}>{Object.entries(emailTemplates).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label><label>Recipient<input type="email" required value={email.recipient} onChange={(event) => setEmail({ ...email, recipient: event.target.value })} /></label><label className="full">Subject<input required value={email.subject} onChange={(event) => setEmail({ ...email, subject: event.target.value })} /></label><label className="full">Message<textarea rows={8} required value={email.body} onChange={(event) => setEmail({ ...email, body: event.target.value })} /></label><div className="form-actions full"><button type="button" onClick={() => setEmailOpen(false)}>Cancel</button><button className="primary" disabled={busy}>{busy ? "Queuing…" : "Queue email"}</button></div></form></Dialog>}
  </div>;
}
