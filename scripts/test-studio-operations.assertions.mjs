import assert from 'node:assert/strict';

export async function verifyWorkflows({db,as,Client,coach,peer,student,studio,lesson}) {
  const context = await as('authenticated',coach,'select public.student_setup_context($1) v',[student]);
  assert.deepEqual(context.packages,[]);
  assert.equal(await as('authenticated',peer,'select public.student_setup_context($1) v',[student]),null);
  const other = await as('authenticated',coach,'select public.command_create_student_once($1,$2) v',[{fullName:'Sibling'},'sibling-create-key']);
  const source = (await db.query("insert into public.linked_contacts(studio_id,student_id,full_name,email,relationship_type,can_view_finance,portal_enabled) values($1,$2,'Shared Guardian','guardian@example.test','guardian',true,true) returning *",[studio,other.resource.id])).rows[0];
  const contact = {sourceContactId:source.id,sourceVersion:source.version,fullName:source.full_name,email:source.email,relationshipType:'guardian',isPrimaryPayer:false,isPrimarySchedulingContact:false,canViewFinance:false,portalEnabled:false};
  let version = (await db.query('select version from public.students where id=$1',[student])).rows[0].version;
  await assert.rejects(()=>as('authenticated',coach,'select public.command_apply_setup_record($1,$2,$3,$4,$5) v',[student,'contact',{...contact,sourceVersion:source.version+1},version,'contact-stale-key']),/VERSION_CONFLICT/);
  assert.equal((await db.query('select count(*)::int n from public.linked_contacts where student_id=$1',[student])).rows[0].n,0);
  const linked = await as('authenticated',coach,'select public.command_apply_setup_record($1,$2,$3,$4,$5) v',[student,'contact',contact,version,'contact-success-key']);
  assert.equal(linked.resource.can_view_finance,false); assert.equal(linked.resource.portal_enabled,false);
  version = (await db.query('select version from public.students where id=$1',[student])).rows[0].version;
  const reuse = await as('authenticated',coach,'select public.command_apply_setup_record($1,$2,$3,$4,$5) v',[student,'contact',contact,version,'contact-reuse-key']);
  assert.equal(reuse.alreadyExists,true);
  assert.equal((await db.query('select count(*)::int n from public.linked_contacts where student_id=$1',[student])).rows[0].n,1);
  await assert.rejects(()=>as('authenticated',coach,'select public.command_apply_setup_record($1,$2,$3,$4,$5) v',[student,'access',{portalEnabled:true,consentConfirmed:false},version,'minor-no-account-key']),/REVIEW_REQUIRED/);
  await assert.rejects(()=>as('authenticated',coach,'select public.command_create_lesson_once($1,$2) v',[{...lesson,startsAt:'2031-01-25T15:00:00Z',endsAt:'2031-01-25T16:00:00Z',recurrence:'weekly',occurrenceCount:2},'future-conflict-key']),/SLOT_UNAVAILABLE/);
  assert.equal((await db.query("select count(*)::int n from workspace_internal.operation_receipts where key='future-conflict-key'")).rows[0].n,0);
  // Separate sessions exercise actual PostgreSQL row/advisory locking and receipt replay.
  const concurrent = async()=>{
    const client = new Client({host:'127.0.0.1',port:56441,user:'postgres',database:'postgres'});
    await client.connect();
    try { await client.query('begin'); await client.query('set local role authenticated');
      await client.query("select set_config('request.jwt.claim.sub',$1,true)",[coach]);
      const r = await client.query('select public.command_create_lesson_once($1,$2) v',[{...lesson,startsAt:'2031-04-01T15:00:00Z',endsAt:'2031-04-01T16:00:00Z'},'concurrent-create-key']);
      await client.query('commit'); return r.rows[0].v;
    } finally { await client.end(); }
  };
  const results = await Promise.all([concurrent(),concurrent()]);
  assert.deepEqual(results[0],results[1]);
  assert.equal((await db.query("select count(*)::int n from public.lessons where starts_at='2031-04-01T15:00:00Z'")).rows[0].n,1);
  console.log('PASS: authorized setup context, contact reuse, stale rollback, minor access, recurrence conflicts and two-session idempotency');
}
