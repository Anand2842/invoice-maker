-- Immutable evidence packets and explicit human control-review attestations.
-- No arithmetic comparison or mock provider is an accountant's sign-off.
create table public.billing_accounting_reviewers(
 business_id uuid not null references public.billing_businesses(id),user_id uuid not null references auth.users(id),enabled boolean not null,
 qualification_note text not null,granted_by uuid not null references auth.users(id),updated_at timestamptz not null default now(),primary key(business_id,user_id)
);
create table public.billing_accounting_review_packets(
 id uuid primary key,business_id uuid not null,demo boolean not null,as_of date not null,fingerprint text not null check(fingerprint~'^[a-f0-9]{64}$'),
 evidence jsonb not null,actor_id uuid not null references auth.users(id),created_at timestamptz not null default now(),
 unique(id,business_id,demo),foreign key(business_id,demo) references public.billing_ledger_configs(business_id,demo)
);
create index accounting_review_packet_scope on public.billing_accounting_review_packets(business_id,demo,as_of,created_at,id);
create table public.billing_accounting_review_decisions(
 id bigint generated always as identity primary key,packet_id uuid not null,business_id uuid not null,demo boolean not null,
 decision text not null check(decision in ('approved','rejected','needs-changes')),reviewer_id uuid not null references auth.users(id),reviewer_name text not null,
 capacity text not null check(capacity in ('business-owner','internal-reviewer','external-accountant')),qualification text not null,notes text not null,
 personally_reviewed boolean not null check(personally_reviewed),scope_acknowledged boolean not null check(scope_acknowledged),created_at timestamptz not null default now(),
 foreign key(packet_id,business_id,demo) references public.billing_accounting_review_packets(id,business_id,demo)
);
create index accounting_review_decision_scope on public.billing_accounting_review_decisions(business_id,demo,id);
create table public.billing_accounting_review_commands(
 business_id uuid not null references public.billing_businesses(id),demo boolean not null,command_id uuid not null,actor_id uuid not null references auth.users(id),request jsonb not null,result jsonb not null,
 primary key(business_id,demo,command_id)
);
create table public.billing_accounting_review_outbox(
 id uuid primary key default gen_random_uuid(),business_id uuid not null,demo boolean not null,command_id uuid not null,topic text not null,payload jsonb not null,created_at timestamptz not null default now(),
 unique(business_id,demo,command_id),foreign key(business_id,demo,command_id) references public.billing_accounting_review_commands(business_id,demo,command_id)
);
alter table public.billing_accounting_reviewers enable row level security;
alter table public.billing_accounting_review_packets enable row level security;
alter table public.billing_accounting_review_decisions enable row level security;
alter table public.billing_accounting_review_commands enable row level security;
alter table public.billing_accounting_review_outbox enable row level security;
revoke all on public.billing_accounting_reviewers,public.billing_accounting_review_packets,public.billing_accounting_review_decisions,public.billing_accounting_review_commands,public.billing_accounting_review_outbox from public,anon,authenticated;
grant select on public.billing_accounting_review_packets,public.billing_accounting_review_decisions to authenticated;
create policy accounting_review_packet_read on public.billing_accounting_review_packets for select to authenticated using(public.billing_can_access(business_id));
create policy accounting_review_decision_read on public.billing_accounting_review_decisions for select to authenticated using(public.billing_can_access(business_id));
create trigger accounting_review_packet_immutable before update or delete on public.billing_accounting_review_packets for each row execute function public.billing_ledger_immutable();
create trigger accounting_review_decision_immutable before update or delete on public.billing_accounting_review_decisions for each row execute function public.billing_ledger_immutable();
create trigger accounting_review_command_immutable before update or delete on public.billing_accounting_review_commands for each row execute function public.billing_ledger_immutable();
create trigger accounting_review_outbox_immutable before update or delete on public.billing_accounting_review_outbox for each row execute function public.billing_ledger_immutable();

create function public.billing_accounting_can_review(business uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and public.billing_can_access(business) and (public.billing_is_owner(business) or exists(select 1 from public.billing_accounting_reviewers r where r.business_id=business and r.user_id=auth.uid() and r.enabled))
$$;
create function public.billing_accounting_review_context(business uuid,data_mode boolean,as_of date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare report jsonb;ledger public.billing_ledger_configs;provenance jsonb='{}';body jsonb;relation_name text;row_count bigint;digest text;source_query text;
begin
 report=public.billing_source_reconciliation(business,data_mode,as_of)-'canManage';
 if report->>'configured'<>'true' then return jsonb_build_object('businessId',business,'demo',data_mode,'asOf',as_of,'configured',false,'report',report);end if;
 select * into ledger from public.billing_ledger_configs where business_id=business and demo=data_mode;
 if as_of<ledger.start_date then raise exception 'Review date predates the configured ledger start';end if;
 foreach relation_name in array array['billing_records','billing_vendor_bills','billing_issued_documents','billing_document_cancellations','billing_source_postings','billing_posted_expenses','billing_expense_reversals','billing_cash_events','billing_cash_allocations','billing_vendor_credits','billing_vendor_credit_reversals','billing_vendor_credit_allocations','billing_refund_events'] loop
  source_query=' from public.'||quote_ident(relation_name)||' t where t.business_id=$1 and t.demo=$2'||case when relation_name='billing_records' then ' and t.collection in (''documents'',''payments'',''expenses'',''subscriptions'')' else '' end;
  execute 'select count(*)'||source_query into row_count using business,data_mode;
  if row_count>20000 then raise exception 'Accounting review provenance exceeds 20,000 rows in a source table; no partial packet is created';end if;
  execute $q$select encode(sha256(convert_to(coalesce(string_agg(h,'' order by h),''),'UTF8')),'hex') from(select encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') h$q$||source_query||') hashes' into digest using business,data_mode;
  provenance=provenance||jsonb_build_object(relation_name,jsonb_build_object('count',row_count,'sha256',digest));
 end loop;
 body=jsonb_build_object('businessId',business,'demo',data_mode,'asOf',as_of,'configured',true,'ledgerSequence',(ledger.next_number-1)::text,'currency',ledger.currency,'period',jsonb_build_object('startDate',ledger.start_date,'closedThrough',ledger.closed_through,'locked',ledger.closed_through is not null and ledger.closed_through>=as_of),'report',report,'sourceProvenance',provenance,'reviewScope',jsonb_build_object('kind','posted-control-review','covered',jsonb_build_array('AR','AP','cash','output tax','reviewed input tax','customer advances','vendor advances','supplier credits'),'exclusions',jsonb_build_array('Inventory movements/cost layers and inventory-to-GL reconciliation require their own verified review.','FX conversion and approved opening imports are not attested by this control packet.','Statutory filings, credential verification, independent recovery and an audit opinion are outside this packet.','Unposted and legacy source differences are retained for review, never invented as postings.'),'inventoryReadAvailable',to_regprocedure('public.billing_inventory_read(uuid,boolean,date,uuid)') is not null),'credentialVerification','self-asserted; not externally verified','wholeBooksCertified',false);
 return body||jsonb_build_object('fingerprint',encode(sha256(convert_to(body::text,'UTF8')),'hex'));
end$$;

create function public.billing_accounting_review_command(business uuid,data_mode boolean,command_id uuid,action text,command_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.billing_accounting_review_commands;packet public.billing_accounting_review_packets;decision public.billing_accounting_review_decisions;request jsonb;result jsonb;evidence jsonb;day date;reviewer uuid;
begin
 if auth.uid() is null or not public.billing_can_access(business) or action='reviewer' and not public.billing_is_owner(business) or action<>'reviewer' and not public.billing_accounting_can_review(business) then raise exception using errcode='42501',message='Your current role is not authorized for accounting review';end if;
 if data_mode is null or command_id is null or action is null or action not in ('packet','decide','reviewer') or jsonb_typeof(command_data) is distinct from 'object' then raise exception 'Invalid accounting review command';end if;
 request=jsonb_build_object('action',action,'data',command_data);
 select * into prior from public.billing_accounting_review_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_accounting_review_command.command_id;
 if prior.command_id is not null then if prior.actor_id<>auth.uid() or prior.request<>request then raise exception using errcode='40001',message='Retry key was used for a different accounting review command';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 perform 1 from public.billing_businesses where id=business for no key update;
 if not public.billing_can_access(business) or action='reviewer' and not public.billing_is_owner(business) or action<>'reviewer' and not public.billing_accounting_can_review(business) then raise exception using errcode='42501',message='Your current role no longer permits this accounting review';end if;
 select * into prior from public.billing_accounting_review_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_accounting_review_command.command_id;
 if prior.command_id is not null then if prior.actor_id<>auth.uid() or prior.request<>request then raise exception using errcode='40001',message='Retry key was used for a different accounting review command';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 if action='reviewer' then
  if command_data-array['userId','enabled','qualificationNote']<>'{}'::jsonb or coalesce(command_data->>'userId','')!~'^[0-9a-fA-F-]{36}$' or jsonb_typeof(command_data->'enabled') is distinct from 'boolean' or jsonb_typeof(command_data->'qualificationNote') is distinct from 'string' or length(btrim(command_data->>'qualificationNote')) not between 1 and 1000 then raise exception 'Choose a current member, enabled state and reviewer capability note';end if;
  reviewer=(command_data->>'userId')::uuid;
  if not exists(select 1 from public.billing_members m where m.business_id=business and m.user_id=reviewer) then raise exception 'Choose an existing business member for reviewer capability';end if;
  insert into public.billing_accounting_reviewers(business_id,user_id,enabled,qualification_note,granted_by) values(business,reviewer,(command_data->>'enabled')::boolean,btrim(command_data->>'qualificationNote'),auth.uid()) on conflict(business_id,user_id) do update set enabled=excluded.enabled,qualification_note=excluded.qualification_note,granted_by=excluded.granted_by,updated_at=now();
  result=jsonb_build_object('reviewer',jsonb_build_object('businessId',business,'userId',reviewer,'enabled',(command_data->>'enabled')::boolean,'qualificationNote',btrim(command_data->>'qualificationNote')),'replayed',false);
 else
  if action='packet' then
   if command_data-array['date','fingerprint']<>'{}'::jsonb or coalesce(command_data->>'fingerprint','')!~'^[a-f0-9]{64}$' then raise exception 'Review the current fingerprint before capturing evidence';end if;
   day=public.billing_payment_date(command_data->'date');evidence=public.billing_accounting_review_context(business,data_mode,day);
   if evidence->>'configured'<>'true' then raise exception 'Configure automatic source reconciliation before creating a control-review packet';end if;
   if evidence->>'fingerprint'<>command_data->>'fingerprint' then raise exception using errcode='40001',message='Accounting evidence changed; reload before capturing its review packet';end if;
   insert into public.billing_accounting_review_packets(id,business_id,demo,as_of,fingerprint,evidence,actor_id) values(gen_random_uuid(),business,data_mode,day,evidence->>'fingerprint',evidence,auth.uid()) returning * into packet;
   result=jsonb_build_object('packet',to_jsonb(packet),'replayed',false);
  else
   if command_data-array['packetId','decision','reviewerName','capacity','qualification','notes','personallyReviewed','scopeAcknowledged']<>'{}'::jsonb or coalesce(command_data->>'packetId','')!~'^[0-9a-fA-F-]{36}$' or coalesce(command_data->>'decision','') not in ('approved','rejected','needs-changes') or coalesce(command_data->>'capacity','') not in ('business-owner','internal-reviewer','external-accountant') or command_data->'personallyReviewed' is distinct from 'true'::jsonb or command_data->'scopeAcknowledged' is distinct from 'true'::jsonb or jsonb_typeof(command_data->'reviewerName') is distinct from 'string' or length(btrim(command_data->>'reviewerName')) not between 1 and 180 or jsonb_typeof(command_data->'qualification') is distinct from 'string' or length(btrim(command_data->>'qualification')) not between 1 and 1000 or jsonb_typeof(command_data->'notes') is distinct from 'string' or length(btrim(command_data->>'notes')) not between 1 and 5000 then raise exception 'Record a personal review decision, identity/capacity assertion, notes and explicit scope acknowledgment';end if;
   if command_data->>'capacity'='business-owner' and not public.billing_is_owner(business) then raise exception 'Only the actual business owner may assert owner review capacity';end if;
   select * into packet from public.billing_accounting_review_packets p where p.id=(command_data->>'packetId')::uuid and p.business_id=business and p.demo=data_mode;
   if packet.id is null then raise exception using errcode='P0002',message='Accounting review packet unavailable in this business and data mode';end if;
   evidence=public.billing_accounting_review_context(business,data_mode,packet.as_of);
   if command_data->>'decision'='approved' then
    if evidence->>'fingerprint' is distinct from packet.fingerprint then raise exception using errcode='40001',message='This packet drifted after capture; create and review a fresh packet';end if;
    if packet.evidence->'report'->>'arithmeticAgrees' is distinct from 'true' then raise exception 'Resolve every source/control difference before approving this control packet';end if;
    if packet.evidence->'period'->>'locked' is distinct from 'true' then raise exception 'Close the ledger through the review date and capture a fresh packet before final approval';end if;
   end if;
   insert into public.billing_accounting_review_decisions(packet_id,business_id,demo,decision,reviewer_id,reviewer_name,capacity,qualification,notes,personally_reviewed,scope_acknowledged) values(packet.id,business,data_mode,command_data->>'decision',auth.uid(),btrim(command_data->>'reviewerName'),command_data->>'capacity',btrim(command_data->>'qualification'),btrim(command_data->>'notes'),true,true) returning * into decision;
   result=jsonb_build_object('packetId',packet.id,'decision',to_jsonb(decision)||jsonb_build_object('id',decision.id::text),'wholeBooksCertified',false,'credentialVerification','self-asserted; not externally verified','replayed',false);
  end if;
 end if;
 insert into public.billing_accounting_review_commands(business_id,demo,command_id,actor_id,request,result) values(business,data_mode,command_id,auth.uid(),request,result);
 insert into public.billing_ledger_audit(business_id,demo,actor_id,action,details) values(business,data_mode,auth.uid(),'accounting-review.'||action,jsonb_build_object('commandId',command_id,'packetId',packet.id,'decisionId',decision.id,'reviewerUserId',reviewer));
 insert into public.billing_accounting_review_outbox(business_id,demo,command_id,topic,payload) values(business,data_mode,command_id,'accounting-review.'||action,result);return result;
end$$;

create function public.billing_accounting_review_read(business uuid,data_mode boolean,as_of date,packet_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare current_context jsonb;packets jsonb;decisions jsonb;reviewers jsonb='[]';selected public.billing_accounting_review_packets;latest public.billing_accounting_review_decisions;latest_packet public.billing_accounting_review_packets;selected_context jsonb;selected_decisions jsonb='[]';status text='unreviewed';acceptance boolean=false;packet_count bigint;
begin
 if auth.uid() is null or not public.billing_can_access(business) then raise exception using errcode='42501',message='Accounting review evidence unavailable in this business';end if;
 if data_mode is null or as_of is null or not isfinite(as_of) then raise exception 'Choose a review date and data mode';end if;
 current_context=public.billing_accounting_review_context(business,data_mode,as_of);
 select count(*) into packet_count from public.billing_accounting_review_packets p where p.business_id=business and p.demo=data_mode and p.as_of=billing_accounting_review_read.as_of;
 select coalesce(jsonb_agg(to_jsonb(p)-'evidence'||jsonb_build_object('matchesCurrent',p.fingerprint=current_context->>'fingerprint') order by p.created_at desc,p.id desc),'[]'::jsonb) into packets from(select * from public.billing_accounting_review_packets p where p.business_id=business and p.demo=data_mode and p.as_of=billing_accounting_review_read.as_of order by p.created_at desc,p.id desc limit 100)p;
 select d.* into latest from public.billing_accounting_review_decisions d join public.billing_accounting_review_packets p on p.id=d.packet_id where d.business_id=business and d.demo=data_mode and p.as_of=billing_accounting_review_read.as_of order by d.id desc limit 1;
 if latest.id is not null then
  select * into latest_packet from public.billing_accounting_review_packets where id=latest.packet_id;
  acceptance=latest.decision='approved' and latest_packet.fingerprint=current_context->>'fingerprint';
  status=case when acceptance then 'accepted-current-controls' when latest.decision='approved' then 'approval-drifted' else latest.decision end;
 end if;
 if packet_id is not null then
  select * into selected from public.billing_accounting_review_packets p where p.id=packet_id and p.business_id=business and p.demo=data_mode;
  if selected.id is null then raise exception using errcode='P0002',message='Review packet unavailable in this business and data mode';end if;
  if (select count(*) from public.billing_accounting_review_decisions where public.billing_accounting_review_decisions.packet_id=selected.id)>1000 then raise exception 'Review packet exceeds 1,000 decisions; no partial decision history is shown';end if;
  selected_context=case when selected.as_of=as_of then current_context else public.billing_accounting_review_context(business,data_mode,selected.as_of) end;
  select coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('id',d.id::text) order by d.id),'[]'::jsonb) into selected_decisions from public.billing_accounting_review_decisions d where d.packet_id=selected.id;
 end if;
 if public.billing_is_owner(business) then select coalesce(jsonb_agg(to_jsonb(r) order by r.user_id),'[]'::jsonb) into reviewers from public.billing_accounting_reviewers r where r.business_id=business;end if;
 return jsonb_build_object('businessId',business,'demo',data_mode,'asOf',as_of,'canReview',public.billing_accounting_can_review(business),'canManageReviewers',public.billing_is_owner(business),'current',current_context,'packets',packets,'packetCount',packet_count,'packetsTruncated',packet_count>100,'selected',case when selected.id is null then null else to_jsonb(selected)||jsonb_build_object('matchesCurrent',selected.fingerprint=selected_context->>'fingerprint') end,'selectedDecisions',selected_decisions,'reviewers',reviewers,'humanReviewStatus',status,'currentAcceptance',acceptance,'latestDecision',case when latest.id is null then null else to_jsonb(latest)||jsonb_build_object('id',latest.id::text) end,'wholeBooksCertified',false,'credentialVerification','self-asserted; not externally verified');
end$$;
revoke all on function public.billing_accounting_can_review(uuid),public.billing_accounting_review_context(uuid,boolean,date),public.billing_accounting_review_command(uuid,boolean,uuid,text,jsonb),public.billing_accounting_review_read(uuid,boolean,date,uuid) from public,anon,authenticated;
grant execute on function public.billing_accounting_review_command(uuid,boolean,uuid,text,jsonb),public.billing_accounting_review_read(uuid,boolean,date,uuid) to authenticated;
notify pgrst,'reload schema';
