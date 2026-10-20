import assert from "node:assert/strict";

export async function verifyWorkflows({
  db,
  as,
  Client,
  coach,
  peer,
  student,
  studio,
  lesson,
}) {
  const context = await as(
    "authenticated",
    coach,
    "select public.student_setup_context($1) v",
    [student],
  );
  assert.deepEqual(context.packages, []);
  assert.equal(
    await as(
      "authenticated",
      peer,
      "select public.student_setup_context($1) v",
      [student],
    ),
    null,
  );
  const other = await as(
    "authenticated",
    coach,
    "select public.command_create_student_once($1,$2) v",
    [{ fullName: "Sibling" }, "sibling-create-key"],
  );
  const source = (
    await db.query(
      "insert into public.linked_contacts(studio_id,student_id,full_name,email,relationship_type,can_view_finance,portal_enabled) values($1,$2,'Shared Guardian','guardian@example.test','guardian',true,true) returning *",
      [studio, other.resource.id],
    )
  ).rows[0];
  const contact = {
    sourceContactId: source.id,
    sourceVersion: source.version,
    fullName: source.full_name,
    email: source.email,
    relationshipType: "guardian",
    isPrimaryPayer: false,
    isPrimarySchedulingContact: false,
    canViewFinance: false,
    portalEnabled: false,
  };
  let version = (
    await db.query("select version from public.students where id=$1", [student])
  ).rows[0].version;
  await assert.rejects(
    () =>
      as(
        "authenticated",
        coach,
        "select public.command_apply_setup_record($1,$2,$3,$4,$5) v",
        [
          student,
          "contact",
          { ...contact, sourceVersion: source.version + 1 },
          version,
          "contact-stale-key",
        ],
      ),
    /VERSION_CONFLICT/,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.linked_contacts where student_id=$1",
        [student],
      )
    ).rows[0].n,
    0,
  );
  const linked = await as(
    "authenticated",
    coach,
    "select public.command_apply_setup_record($1,$2,$3,$4,$5) v",
    [student, "contact", contact, version, "contact-success-key"],
  );
  assert.equal(linked.resource.can_view_finance, false);
  assert.equal(linked.resource.portal_enabled, false);
  version = (
    await db.query("select version from public.students where id=$1", [student])
  ).rows[0].version;
  const reuse = await as(
    "authenticated",
    coach,
    "select public.command_apply_setup_record($1,$2,$3,$4,$5) v",
    [student, "contact", contact, version, "contact-reuse-key"],
  );
  assert.equal(reuse.alreadyExists, true);
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.linked_contacts where student_id=$1",
        [student],
      )
    ).rows[0].n,
    1,
  );
  await assert.rejects(
    () =>
      as(
        "authenticated",
        coach,
        "select public.command_apply_setup_record($1,$2,$3,$4,$5) v",
        [
          student,
          "access",
          { portalEnabled: true, consentConfirmed: false },
          version,
          "minor-no-account-key",
        ],
      ),
    /REVIEW_REQUIRED/,
  );
  await assert.rejects(
    () =>
      as(
        "authenticated",
        coach,
        "select public.command_create_lesson_once($1,$2) v",
        [
          {
            ...lesson,
            startsAt: "2031-01-25T15:00:00Z",
            endsAt: "2031-01-25T16:00:00Z",
            recurrence: "weekly",
            occurrenceCount: 2,
          },
          "future-conflict-key",
        ],
      ),
    /SLOT_UNAVAILABLE/,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from workspace_internal.operation_receipts where key='future-conflict-key'",
      )
    ).rows[0].n,
    0,
  );
  // Separate sessions exercise actual PostgreSQL row/advisory locking and receipt replay.
  const concurrent = async () => {
    const client = new Client({
      host: "127.0.0.1",
      port: 56441,
      user: "postgres",
      database: "postgres",
    });
    await client.connect();
    try {
      await client.query("begin");
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claim.sub',$1,true)", [
        coach,
      ]);
      const r = await client.query(
        "select public.command_create_lesson_once($1,$2) v",
        [
          {
            ...lesson,
            startsAt: "2031-04-01T15:00:00Z",
            endsAt: "2031-04-01T16:00:00Z",
          },
          "concurrent-create-key",
        ],
      );
      await client.query("commit");
      return r.rows[0].v;
    } finally {
      await client.end();
    }
  };
  const results = await Promise.all([concurrent(), concurrent()]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.lessons where starts_at='2031-04-01T15:00:00Z'",
      )
    ).rows[0].n,
    1,
  );
  console.log(
    "PASS: authorized setup context, contact reuse, stale rollback, minor access, recurrence conflicts and two-session idempotency",
  );
  await db.query(
    "insert into public.studio_invoices(studio_id,student_id,number,status,issue_date,due_date,currency,branding,recipient,items,total_minor,paid_minor,credit_minor,waived_minor,checkout_key,checkout_amount) values($1,$2,'W5-1','open','2031-02-01','2031-02-15','USD','{}','{}','[]',10000,1000,500,500,'pending-reviewed',8000)",
    [studio, student],
  );
  await db.query(
    "insert into public.payment_entries(student_id,kind,amount_minor,currency,reason,account_credit,created_at) values($1,'payment',3000,'USD','Received',false,'2031-02-01T06:00:00Z'),($1,'payment',9000,'USD','Prior month',false,'2031-02-01T04:00:00Z'),($1,'refund',500,'USD','Cash refund',false,'2031-02-02T06:00:00Z'),($1,'payment',700,'EUR','Other currency',false,'2031-02-02T06:00:00Z'),($1,'refund',2000,'USD','Prepaid credit',true,'2031-02-02T06:00:00Z'),($1,'adjustment',200,'USD','Credit used',true,'2031-02-03T06:00:00Z')",
    [student],
  );
  const financial = await as(
    "authenticated",
    coach,
    "select public.studio_financial_dashboard('2031-02-01') v",
  );
  assert.equal(Date.parse(financial.from), Date.parse("2031-02-01T05:00:00Z"));
  for (const [metric, currency, amount] of [
    ["outstanding", "USD", 8000],
    ["receipts", "USD", 3000],
    ["refunds", "USD", 500],
    ["receipts", "EUR", 700],
    ["dollarCredit", "USD", 1800],
    ["pending", "USD", 8000],
  ]) {
    const t = financial.totals.find(
      (t) => t.metric === metric && t.currency === currency,
    );
    assert.equal(t.amount, amount, metric);
    const drill = await as(
      "authenticated",
      coach,
      "select public.studio_financial_dashboard('2031-02-01',$1,$2,1) v",
      [metric, currency],
    );
    assert.equal(
      drill.items.reduce((n, r) => n + r.amount, 0),
      t.amount,
    );
    assert.equal(drill.count, t.count);
  }
  await assert.rejects(
    () =>
      as(
        "authenticated",
        peer,
        "select public.studio_financial_dashboard('2031-02-01') v",
      ),
    /FORBIDDEN/,
  );
  const activity = await as(
    "authenticated",
    coach,
    "select public.communication_activity() v",
  );
  assert.deepEqual(activity.items, []);
  console.log(
    "PASS: finance snapshot/drill-down parity, studio-month boundaries, currency/refund/credit separation and denied unrelated reads",
  );
  await db.query(
    "update public.students set actor_page_eligible=true,email=$2 where id=$1",
    [student, "learner@example.test"],
  );
  const actor = (
    await db.query(
      "insert into public.actor_profiles(student_id,slug,display_name,bio) values($1,'wave-five-local','Name Only','Original biography') returning *",
      [student],
    )
  ).rows[0];
  const actorCommand = (command, value, version, key, identity = coach) =>
    as(
      "authenticated",
      identity,
      "select public.command_actor_page($1,$2,$3,$4,$5) v",
      [actor.id, command, value, version, key],
    );
  await assert.rejects(
    () =>
      actorCommand(
        "review",
        { status: "published" },
        actor.version,
        "actor-unapproved-key",
      ),
    /REVIEW_REQUIRED/,
  );
  const approved = await actorCommand(
    "review",
    { status: "approved" },
    actor.version,
    "actor-approved-key",
  );
  const published = await actorCommand(
    "review",
    { status: "published" },
    approved.resource.version,
    "actor-published-key",
  );
  assert.deepEqual(
    await actorCommand(
      "review",
      { status: "published" },
      approved.resource.version,
      "actor-published-key",
    ),
    published,
  );
  const revision = (
    await db.query(
      "select content from public.actor_profile_revisions where id=$1",
      [published.resource.published_revision_id],
    )
  ).rows[0].content;
  const changed = await actorCommand(
    "save",
    {
      status: "draft",
      bio: "Private changes",
      portfolio: {
        presentation: {
          version: 1,
          layout: "spotlight",
          sections: ["biography", "headshots", "credits", "skills", "media"],
        },
      },
    },
    published.resource.version,
    "actor-save-new-draft",
  );
  assert.equal(changed.resource.status, "published");
  assert.equal(changed.resource.draft_status, "draft");
  assert.equal(
    changed.resource.published_revision_id,
    published.resource.published_revision_id,
  );
  assert.deepEqual(
    (
      await db.query(
        "select content from public.actor_profile_revisions where id=$1",
        [published.resource.published_revision_id],
      )
    ).rows[0].content,
    revision,
  );
  await assert.rejects(
    () =>
      actorCommand(
        "review",
        { status: "approved" },
        changed.resource.version,
        "actor-forged-key",
        peer,
      ),
    /FORBIDDEN/,
  );
  await assert.rejects(
    () =>
      as(
        "authenticated",
        coach,
        "update public.actor_profiles set status='published' where id=$1 returning id v",
        [actor.id],
      ),
    /permission denied/,
  );
  console.log(
    "PASS: atomic Actor approval/publication replay, stable published revision during edits, denied forged/direct publication",
  );
  const draftId = "f5500000-0000-4000-8000-000000000020",
    sendKey = "f5500000-0000-4000-8000-000000000021";
  const campaign = (command, value = {}, version = 0, key = sendKey) =>
    as(
      "service_role",
      "",
      "select public.manage_campaign_draft($1,$2,$3,$4,$5,$6,$7) v",
      [
        coach,
        draftId,
        command,
        value,
        version,
        key,
        "https://staging.example.test",
      ],
    );
  let draft = await campaign("save", {
    name: "Local campaign",
    subject: "Hello {{firstName}}",
    content: {
      version: 1,
      blocks: [{ id: crypto.randomUUID(), type: "text", text: "Private test" }],
    },
    textTemplate: "Hi {{firstName}}",
    recipientEmails: ["learner@example.test"],
    sendAt: "2031-02-01T12:00:00Z",
  });
  assert.equal(
    (await db.query("select count(*)::int n from public.outbox_messages"))
      .rows[0].n,
    0,
  );
  draft = await campaign("review", {}, draft.version);
  assert.equal(draft.review.audience.length, 1);
  await db.query(
    "insert into public.mailing_list_contacts(studio_id,email,display_name,unsubscribed_at) values($1,'learner@example.test','Name Only',now())",
    [studio],
  );
  await assert.rejects(
    () => campaign("queue", { reviewId: draft.review.id }, draft.version),
    /REVIEW_REQUIRED/,
  );
  assert.equal(
    (await db.query("select count(*)::int n from public.email_campaigns"))
      .rows[0].n,
    0,
  );
  await db.query(
    "update public.mailing_list_contacts set unsubscribed_at=null where studio_id=$1 and email='learner@example.test'",
    [studio],
  );
  draft = await campaign("review", {}, draft.version);
  const queued = await campaign(
    "queue",
    { reviewId: draft.review.id },
    draft.version,
  );
  assert.equal(queued.recipientCount, 1);
  assert.deepEqual(
    await campaign("queue", { reviewId: draft.review.id }, draft.version),
    queued,
  );
  assert.equal(
    (await db.query("select count(*)::int n from public.outbox_messages"))
      .rows[0].n,
    1,
  );
  assert.equal(
    await as(
      "service_role",
      "",
      "select public.campaign_recipient_eligible($1,$2) v",
      [studio, "learner@example.test"],
    ),
    true,
  );
  await db.query(
    "update public.mailing_list_contacts set unsubscribed_at=now() where studio_id=$1 and email='learner@example.test'",
    [studio],
  );
  assert.equal(
    await as(
      "service_role",
      "",
      "select public.campaign_recipient_eligible($1,$2) v",
      [studio, "learner@example.test"],
    ),
    false,
  );
  console.log(
    "PASS: durable campaign save without delivery, frozen audience, consent changes, transactional queue/replay and delivery-time suppression",
  );
  const settings = await as(
    "authenticated",
    coach,
    "select public.command_patch_studio_settings($1,$2,$3) v",
    [
      {
        studioName: "Wave five isolated",
        branding: { primaryColor: "#183c36", accentColor: "#ffffff" },
        portalLabel: "My studio",
      },
      null,
      "settings-initial-key",
    ],
  );
  const base = settings.resource.settings;
  await as(
    "authenticated",
    coach,
    "select public.command_patch_studio_settings($1,$2,$3) v",
    [{ branding: { primaryColor: "#123456" } }, base, "settings-primary-key"],
  );
  const disjoint = await as(
    "authenticated",
    coach,
    "select public.command_patch_studio_settings($1,$2,$3) v",
    [{ branding: { accentColor: "#eeeeee" } }, base, "settings-disjoint-key"],
  );
  assert.equal(disjoint.resource.settings.branding.primaryColor, "#123456");
  assert.equal(disjoint.resource.settings.branding.accentColor, "#eeeeee");
  await assert.rejects(
    () =>
      as(
        "authenticated",
        coach,
        "select public.command_patch_studio_settings($1,$2,$3) v",
        [{ branding: { primaryColor: "#000000" } }, base, "settings-stale-key"],
      ),
    /VERSION_CONFLICT/,
  );
  await assert.rejects(
    () =>
      as(
        "authenticated",
        peer,
        "select public.command_patch_studio_settings($1,$2,$3) v",
        [{ studioName: "Forged" }, null, "settings-forged-key"],
      ),
    /FORBIDDEN/,
  );
  await assert.rejects(
    () =>
      as(
        "authenticated",
        coach,
        "select public.command_patch_studio_settings($1,$2,$3) v",
        [{ serviceRoleKey: "forbidden" }, null, "settings-private-key"],
      ),
    /VALIDATION_FAILED/,
  );
  const reload = new Client({
    host: "127.0.0.1",
    port: 56441,
    user: "postgres",
    database: "postgres",
  });
  await reload.connect();
  try {
    assert.equal(
      (
        await reload.query("select settings from public.studios where id=$1", [
          studio,
        ])
      ).rows[0].settings.portalLabel,
      "My studio",
    );
  } finally {
    await reload.end();
  }
  console.log(
    "PASS: Settings persistence across sessions, disjoint nested patches, stale conflicts and rejected unauthorized/private fields",
  );
  const setup = (
    command,
    value = {},
    version = 0,
    key = "setup-recovery-key",
  ) =>
    as(
      "service_role",
      "",
      "select public.manage_student_setup($1,$2,$3,$4,$5,$6) v",
      [coach, student, command, value, version, key],
    );
  const original = await setup("read"),
    recoveryAction = {
      id: "f5500000-0000-4000-8000-000000000030",
      kind: "details",
      payload: {
        fullName: "Name Only",
        focusArea: "Recovered focus",
        goals: "",
        isMinor: true,
      },
    };
  let recovery = await setup(
    "save",
    { step: 5, actions: [recoveryAction] },
    original.version,
  );
  recovery = await setup("review", {}, recovery.version);
  const pending = await setup(
    "claim",
    { reviewId: recovery.review.id, actionId: recoveryAction.id },
    recovery.version,
    "setup-interrupted-key",
  );
  await as(
    "authenticated",
    coach,
    "select public.command_apply_setup_record($1,$2,$3,$4,$5) v",
    [
      student,
      "details",
      recoveryAction.payload,
      pending.studentVersion,
      pending.key,
    ],
  );
  // Simulate a process stopping after the committed mutation but before orchestration finish.
  const recovered = await setup(
    "claim",
    { reviewId: recovery.review.id, actionId: recoveryAction.id },
    recovery.version,
    "never-repeated-key",
  );
  assert.equal(recovered.completed, true);
  assert.equal(recovered.reviewRequired, true);
  assert.equal((await setup("read")).review, null);
  assert.equal(
    (
      await db.query("select focus_area from public.students where id=$1", [
        student,
      ])
    ).rows[0].focus_area,
    "Recovered focus",
  );
  const guardian = "f5500000-0000-4000-8000-000000000031";
  await db.query(
    "insert into auth.users(id,email) values($1,'guardian-session@example.test')",
    [guardian],
  );
  await db.query(
    "update public.linked_contacts set user_id=$2,portal_enabled=true,can_view_work=true,can_view_schedule=true,can_manage_profile=true where id=$1",
    [linked.resource.id, guardian],
  );
  await db.query(
    "insert into public.portal_accounts(student_id,studio_id,user_id,username,email,account_type,linked_contact_id) values($1,$2,$3,'wave-five-guardian','guardian-session@example.test','guardian',$4)",
    [student, studio, guardian, linked.resource.id],
  );
  assert.equal(
    (
      await as(
        "authenticated",
        guardian,
        "select public.portal_student_contexts($1,1) v",
        [student],
      )
    ).selected.id,
    student,
  );
  assert.equal(
    (
      await as(
        "authenticated",
        coach,
        "select public.household_access_states($1) v",
        [student],
      )
    ).items[0].activation,
    "provisioned",
  );
  await assert.rejects(
    () =>
      as(
        "authenticated",
        guardian,
        "select public.household_access_states($1) v",
        [student],
      ),
    /FORBIDDEN/,
  );
  await db.query(
    "update public.linked_contacts set portal_enabled=false,can_receive_notifications=false where id=$1",
    [linked.resource.id],
  );
  assert.equal(
    (
      await as(
        "authenticated",
        guardian,
        "select public.portal_student_contexts($1,1) v",
        [student],
      )
    ).selected,
    null,
  );
  assert.equal(
    await as(
      "authenticated",
      guardian,
      "select count(*)::int v from public.students where id=$1",
      [student],
    ),
    0,
  );
  assert.equal(
    await as(
      "authenticated",
      guardian,
      "select public.can_manage_student_profile($1) v",
      [student],
    ),
    false,
  );
  console.log(
    "PASS: interrupted setup receipt recovery without replay and guardian context/direct-read/command denial after revocation",
  );
}
