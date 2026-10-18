-- Organizer instruction: 2026-10-18T05:20:46Z.
-- These event-day scans were physically admitted despite management's missing data.
-- One-time, idempotent reconciliation, NOT a future entry-policy change.
-- No names or payments are invented, and original scan outcomes remain immutable.
-- Run in a transaction; first validate with ROLLBACK, then explicitly COMMIT.
DO $reconcile$
declare
 scan_row navrang_private.attempts%rowtype;
 admission_row navrang_private.admissions%rowtype;
 expected_count integer := 18;
 candidate_count integer;
 inserted_count integer := 0;
 tickets_before text;
 attempts_before text;
 confirmations_before integer;
 recorded_at timestamptz := clock_timestamp();
 evidence_ref constant text := 'organizer-confirmation-2026-10-18T05:20:46Z';
begin
 perform 1 from navrang_private.event where id='O9KL3' for update;
 select count(distinct ticket_id) into candidate_count from navrang_private.attempts
 where not test_fixture and response->>'code'='not_found'
  and at >= '2026-10-16T18:30:00Z'::timestamptz
  and at < '2026-10-17T18:30:00Z'::timestamptz
  and at <= '2026-10-18T05:20:46Z'::timestamptz;
 if candidate_count<>expected_count then raise exception 'Expected % missing-data tickets, found %. Review before proceeding.',expected_count,candidate_count;end if;
 select md5(coalesce(jsonb_agg(to_jsonb(t) order by t.id)::text,'')) into tickets_before from navrang_private.tickets t;
 select md5(coalesce(jsonb_agg(to_jsonb(t) order by t.actor,t.request_id)::text,'')) into attempts_before from navrang_private.attempts t;
 select count(*) into confirmations_before from navrang_private.admissions where event_id='O9KL3' and not test_fixture;
 for scan_row in
  select distinct on (x.ticket_id) x.* from navrang_private.attempts x
  where not x.test_fixture and x.response->>'code'='not_found'
   and x.at >= '2026-10-16T18:30:00Z'::timestamptz
   and x.at < '2026-10-17T18:30:00Z'::timestamptz
   and x.at <= '2026-10-18T05:20:46Z'::timestamptz
  order by x.ticket_id,x.at,x.actor,x.request_id
 loop
  -- Never overwrite a pre-existing receipt, including an earlier reconciliation.
  if exists(select 1 from navrang_private.admissions a where a.event_id='O9KL3' and a.ticket_id=scan_row.ticket_id) then continue;end if;
  insert into navrang_private.admissions(event_id,ticket_id,checker_id,at,receipt,test_fixture)
   values('O9KL3',scan_row.ticket_id,null,recorded_at,'{}'::jsonb,false) returning * into admission_row;
  update navrang_private.admissions set receipt=jsonb_build_object(
   'code','admitted','id',scan_row.ticket_id,
   'entry',jsonb_build_object(
    'ticketId',scan_row.ticket_id,'name','Name not supplied — registration data missing',
    'checker','Organizer-confirmed correction','checkerId',null,'deviceId','organizer-reconciliation',
    'at',recorded_at,'seq',admission_row.seq,'source',evidence_ref,
    'admissionBasis','organizer_confirmed','note','Admitted — registration data missing',
    'recordedAt',recorded_at,'actualAdmittedAt',null,'observedScanAt',scan_row.at,
    'timeBasis','correction_recorded','nameStatus','not_supplied','paymentVerified',null,
    'confirmedBy','Namdev Shirodkar','confirmationInstructionAt','2026-10-18T05:20:46Z',
    'evidence',jsonb_build_object('originalOutcome','not_found','actor',scan_row.actor,
     'requestId',scan_row.request_id,'deviceId',scan_row.device_id,'observedAt',scan_row.at)
   )
  ) where event_id='O9KL3' and ticket_id=scan_row.ticket_id and seq=admission_row.seq;
  inserted_count:=inserted_count+1;
 end loop;
 if (select md5(coalesce(jsonb_agg(to_jsonb(t) order by t.id)::text,'')) from navrang_private.tickets t) is distinct from tickets_before then raise exception 'Registration data changed unexpectedly';end if;
 if (select md5(coalesce(jsonb_agg(to_jsonb(t) order by t.actor,t.request_id)::text,'')) from navrang_private.attempts t) is distinct from attempts_before then raise exception 'Original scan evidence changed unexpectedly';end if;
 if (select count(*) from navrang_private.admissions where event_id='O9KL3' and not test_fixture)<>confirmations_before+inserted_count then raise exception 'Attendance reconciliation did not balance';end if;
 if exists(select 1 from navrang_private.attempts x where not x.test_fixture and x.response->>'code'='not_found'
  and x.at>='2026-10-16T18:30:00Z'::timestamptz and x.at<'2026-10-17T18:30:00Z'::timestamptz
  and not exists(select 1 from navrang_private.admissions a where a.event_id='O9KL3' and a.ticket_id=x.ticket_id and not a.test_fixture))
 then raise exception 'An event-day missing-data ticket is still unreconciled';end if;
 raise notice 'Organizer-confirmed admissions added: %; original ticket and attempt data unchanged.',inserted_count;
end
$reconcile$;
