-- Durable demo-only mock refunds. Reservations are operational, never GL money.
create table public.billing_mock_refund_requests(
 id uuid primary key,business_id uuid not null,demo boolean not null check(demo),source_kind text not null check(source_kind in ('cash','vendor-credit')),source_id uuid not null,
 date date not null,currency text not null,amount numeric(18,2) not null check(amount>0 and amount<=10000000000),scenario text not null check(scenario in ('success','failure','timeout-once','timeout-always')),
 snapshot jsonb not null,actor_id uuid not null references auth.users(id),created_at timestamptz not null default now(),unique(id,business_id,demo),foreign key(business_id,demo) references public.billing_cash_configs(business_id,demo)
);
create table public.billing_mock_refund_states(
 request_id uuid primary key references public.billing_mock_refund_requests(id),status text not null check(status in ('queued','leased','posting','needs-review','acknowledged','failed','cancelled')),
 attempt integer not null default 0 check(attempt between 0 and 5),lease_token uuid,lease_until timestamptz,next_attempt timestamptz not null default now(),provider_id text not null,refund_id uuid unique references public.billing_refund_events(id),result jsonb,
 check((status='leased')=(lease_token is not null and lease_until is not null)),check((status='acknowledged')=(refund_id is not null))
);
create table public.billing_mock_refund_events(
 id uuid primary key default gen_random_uuid(),business_id uuid not null,demo boolean not null,request_id uuid not null references public.billing_mock_refund_requests(id),command_id uuid not null,
 kind text not null,attempt integer not null,actor_id uuid not null references auth.users(id),payload jsonb not null,created_at timestamptz not null default now(),unique(business_id,demo,command_id)
);
create table public.billing_mock_refund_commands(
 business_id uuid not null,demo boolean not null,command_id uuid not null,actor_id uuid not null references auth.users(id),request jsonb not null,result jsonb not null,
 primary key(business_id,demo,command_id),foreign key(business_id,demo) references public.billing_cash_configs(business_id,demo)
);
create table public.billing_mock_refund_outbox(
 id uuid primary key default gen_random_uuid(),business_id uuid not null,demo boolean not null,request_id uuid not null references public.billing_mock_refund_requests(id),command_id uuid not null,topic text not null,payload jsonb not null,created_at timestamptz not null default now(),
 unique(business_id,demo,command_id),foreign key(business_id,demo,command_id) references public.billing_mock_refund_commands(business_id,demo,command_id)
);
-- Transient authority only within a complete() transaction. A caller-controlled
-- GUC, browser callback or snapshot flag never authorizes a simulated settlement.
create table public.billing_mock_refund_posting_authority(request_id uuid primary key references public.billing_mock_refund_requests(id),lease_token uuid not null);
create table public.billing_mock_refund_settlements(
 request_id uuid primary key references public.billing_mock_refund_requests(id),refund_id uuid not null unique references public.billing_refund_events(id),refund_command_id uuid not null,provider_id text not null,created_at timestamptz not null default now()
);
create index mock_refund_source on public.billing_mock_refund_requests(business_id,demo,source_kind,source_id,date,id);
alter table public.billing_mock_refund_requests enable row level security;alter table public.billing_mock_refund_states enable row level security;alter table public.billing_mock_refund_events enable row level security;alter table public.billing_mock_refund_commands enable row level security;alter table public.billing_mock_refund_outbox enable row level security;alter table public.billing_mock_refund_posting_authority enable row level security;alter table public.billing_mock_refund_settlements enable row level security;
revoke all on public.billing_mock_refund_requests,public.billing_mock_refund_states,public.billing_mock_refund_events,public.billing_mock_refund_commands,public.billing_mock_refund_outbox,public.billing_mock_refund_posting_authority,public.billing_mock_refund_settlements from public,anon,authenticated;
create trigger mock_refund_request_immutable before update or delete on public.billing_mock_refund_requests for each row execute function public.billing_ledger_immutable();
create trigger mock_refund_event_immutable before update or delete on public.billing_mock_refund_events for each row execute function public.billing_ledger_immutable();
create trigger mock_refund_command_immutable before update or delete on public.billing_mock_refund_commands for each row execute function public.billing_ledger_immutable();
create trigger mock_refund_outbox_immutable before update or delete on public.billing_mock_refund_outbox for each row execute function public.billing_ledger_immutable();
create trigger mock_refund_settlement_immutable before update or delete on public.billing_mock_refund_settlements for each row execute function public.billing_ledger_immutable();

create function public.billing_mock_refund_reserved(business uuid,data_mode boolean,source_kind text,source_id uuid,as_of date) returns numeric language sql stable security definer set search_path='' as $$
 select coalesce(sum(q.amount),0) from public.billing_mock_refund_requests q join public.billing_mock_refund_states s on s.request_id=q.id where q.business_id=business and q.demo=data_mode and q.source_kind=$3 and q.source_id=$4 and q.date<=as_of and s.status in ('queued','leased','needs-review')
$$;
create function public.billing_mock_refund_book(source_kind text,source_id uuid,as_of date) returns numeric language sql stable security definer set search_path='' as $$
 select coalesce(sum(delta),0) from(select date,delta from public.billing_cash_movements($2) where $1='cash' union all select date,delta from public.billing_vendor_credit_movements($2) where $1='vendor-credit')m where date<=as_of
$$;
create function public.billing_mock_refund_spendable(business uuid,data_mode boolean,source_kind text,source_id uuid,as_of date) returns numeric language sql stable security definer set search_path='' as $$
 with movements as(select date,delta from public.billing_cash_movements($4) where $3='cash' union all select date,delta from public.billing_vendor_credit_movements($4) where $3='vendor-credit' union all select q.date,-q.amount from public.billing_mock_refund_requests q join public.billing_mock_refund_states s on s.request_id=q.id where q.business_id=business and q.demo=data_mode and q.source_kind=$3 and q.source_id=$4 and s.status in ('queued','leased','needs-review') union all select as_of,0::numeric),running as(select date,sum(sum(delta)) over(order by date) balance from movements group by date) select coalesce(min(balance) filter(where date>=as_of),0) from running
$$;
create function public.billing_validate_mock_refund_reservations(business uuid,data_mode boolean,source_kind text,source_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.billing_mock_refund_requests q join public.billing_mock_refund_states s on s.request_id=q.id where q.business_id=business and q.demo=data_mode and q.source_kind=billing_validate_mock_refund_reservations.source_kind and q.source_id=billing_validate_mock_refund_reservations.source_id and s.status in ('queued','leased','needs-review')) then return;end if;
 if exists(with movements as(
  select date,delta from public.billing_cash_movements(source_id) where source_kind='cash'
  union all select date,delta from public.billing_vendor_credit_movements(source_id) where source_kind='vendor-credit'
  union all select q.date,-q.amount from public.billing_mock_refund_requests q join public.billing_mock_refund_states s on s.request_id=q.id where q.business_id=business and q.demo=data_mode and q.source_kind=billing_validate_mock_refund_reservations.source_kind and q.source_id=billing_validate_mock_refund_reservations.source_id and s.status in ('queued','leased','needs-review')
 ),running as(select sum(sum(delta)) over(order by date) balance from movements group by date)select 1 from running where balance<0) then raise exception 'Pending mock refund reservations exceed source availability at an effective date; review or cancel the reservation first';end if;
end$$;
create function public.billing_mock_refund_reservation_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare source_type text;source uuid;
begin
 if tg_table_name='billing_cash_allocations' then source_type='cash';source=new.cash_id;
 elsif tg_table_name='billing_cash_events' then if new.kind<>'reversal' then return new;end if;source_type='cash';source=new.reverses_id;
 elsif tg_table_name='billing_vendor_credit_allocations' then source_type='vendor-credit';source=new.credit_id;
 elsif tg_table_name='billing_vendor_credit_reversals' then source_type='vendor-credit';source=new.credit_id;
 elsif tg_table_name='billing_refund_events' then source_type=new.source_kind;source=new.source_id;
 end if;
 if source_type in ('cash','vendor-credit') then perform public.billing_validate_mock_refund_reservations(new.business_id,new.demo,source_type,source);end if;return new;
end$$;
create trigger mock_reservation_cash_allocation after insert on public.billing_cash_allocations for each row execute function public.billing_mock_refund_reservation_guard();
create trigger mock_reservation_cash_reversal after insert on public.billing_cash_events for each row execute function public.billing_mock_refund_reservation_guard();
create trigger mock_reservation_credit_allocation after insert on public.billing_vendor_credit_allocations for each row execute function public.billing_mock_refund_reservation_guard();
create trigger mock_reservation_credit_reversal after insert on public.billing_vendor_credit_reversals for each row execute function public.billing_mock_refund_reservation_guard();
create trigger mock_reservation_refund after insert on public.billing_refund_events for each row execute function public.billing_mock_refund_reservation_guard();

create function public.billing_mock_refund_mark_simulation() returns trigger language plpgsql security definer set search_path='' as $$
declare request public.billing_mock_refund_requests;matches integer;
begin
 if new.kind<>'refund' then return new;end if;
 select count(*) into matches from public.billing_mock_refund_posting_authority a join public.billing_mock_refund_requests q on q.id=a.request_id join public.billing_mock_refund_states s on s.request_id=q.id where s.status='posting' and q.business_id=new.business_id and q.demo=new.demo and q.source_kind=new.source_kind and q.source_id=new.source_id and q.date=new.date and q.currency=new.currency and q.amount=new.amount;
 if matches=0 then return new;end if;if matches<>1 or not new.demo then raise exception 'Ambiguous or non-demo mock refund posting authority';end if;
 select q.* into request from public.billing_mock_refund_posting_authority a join public.billing_mock_refund_requests q on q.id=a.request_id join public.billing_mock_refund_states s on s.request_id=q.id where s.status='posting' and q.business_id=new.business_id and q.demo=new.demo and q.source_kind=new.source_kind and q.source_id=new.source_id and q.date=new.date and q.currency=new.currency and q.amount=new.amount;
 new.snapshot=new.snapshot||jsonb_build_object('providerMode','mock','simulationOnly',true,'simulationConfirmed',true,'paidConfirmed',false,'mockRequestId',request.id,'mockProviderId','mock-refund-'||request.id::text,'fundsMovedByFolio',false);return new;
end$$;
create trigger mock_refund_simulation_provenance before insert on public.billing_refund_events for each row execute function public.billing_mock_refund_mark_simulation();

create function public.billing_mock_refund_json(request_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('request',to_jsonb(q)||jsonb_build_object('amount',q.amount::text),'state',to_jsonb(s)) from public.billing_mock_refund_requests q join public.billing_mock_refund_states s on s.request_id=q.id where q.id=$1
$$;
create function public.billing_mock_refund_command(business uuid,data_mode boolean,command_id uuid,action text,command_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.billing_mock_refund_commands;request public.billing_mock_refund_requests;state public.billing_mock_refund_states;config public.billing_cash_configs;ledger public.billing_ledger_configs;cash public.billing_cash_events;credit public.billing_vendor_credits;
 payload jsonb;result jsonb;outcome jsonb;posted jsonb;snapshot jsonb;request_id uuid;lease uuid;day date;amount numeric(18,2);source_type text;source uuid;scenario text;event_kind text;reason text;provider_id text;
begin
 if auth.uid() is null or not public.billing_can_access(business,true) then raise exception using errcode='42501',message='Your role cannot request or dispatch mock refunds';end if;
 if data_mode is distinct from true then raise exception 'Mock financial refund requests are available only in demo mode; no real money or real-record cash change is performed';end if;
 if command_id is null or action is null or action not in ('request','claim','complete','cancel') or jsonb_typeof(command_data) is distinct from 'object' then raise exception 'Invalid mock refund command';end if;
 payload=jsonb_build_object('action',action,'data',command_data);
 select * into prior from public.billing_mock_refund_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_mock_refund_command.command_id;
 if prior.command_id is not null then if prior.actor_id<>auth.uid() or prior.request<>payload then raise exception using errcode='40001',message='Retry key was used for a different mock refund command';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 perform public.billing_ledger_writer_lock(business,false);
 select * into ledger from public.billing_ledger_configs where business_id=business and demo=data_mode for update;
 select * into config from public.billing_cash_configs where business_id=business and demo=data_mode;if config.business_id is null then raise exception 'Configure demo cash/advance controls first';end if;
 select * into prior from public.billing_mock_refund_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_mock_refund_command.command_id;
 if prior.command_id is not null then if prior.actor_id<>auth.uid() or prior.request<>payload then raise exception using errcode='40001',message='Retry key was used for a different mock refund command';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 if action='request' then
  if command_data-array['sourceKind','sourceId','date','currency','amount','scenario','simulationConfirmed']<>'{}'::jsonb or command_data->'simulationConfirmed' is distinct from 'true'::jsonb or coalesce(command_data->>'sourceId','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'Confirm a demo-only simulation against an exact cash/credit source';end if;
  source_type=command_data->>'sourceKind';source=(command_data->>'sourceId')::uuid;scenario=command_data->>'scenario';day=public.billing_payment_date(command_data->'date');amount=public.billing_payment_amount(command_data->'amount');
  if command_data->>'currency' is distinct from config.currency or scenario is null or scenario not in ('success','failure','timeout-once','timeout-always') or day<config.cutover_date or day<=coalesce(ledger.closed_through,day-1) or day>(select (now() at time zone time_zone)::date from public.billing_businesses where id=business) then raise exception 'Review demo refund currency, scenario and open effective date';end if;
  if source_type='cash' then select * into cash from public.billing_cash_events c where c.id=source and c.business_id=business and c.demo and c.kind='cash';if cash.id is null or day<cash.date or exists(select 1 from public.billing_cash_events where reverses_id=cash.id) then raise exception 'Choose active demo cash on or before the request date';end if;snapshot=cash.snapshot;
  elsif source_type='vendor-credit' then select * into credit from public.billing_vendor_credits c where c.id=source and c.business_id=business and c.demo;if credit.id is null or day<credit.date or exists(select 1 from public.billing_vendor_credit_reversals where credit_id=credit.id) then raise exception 'Choose active demo vendor credit on or before the request date';end if;snapshot=credit.snapshot;
  else raise exception 'Mock requests currently require a demo cash advance or vendor credit source';end if;
  request_id=gen_random_uuid();provider_id='mock-refund-'||request_id::text;
  insert into public.billing_mock_refund_requests(id,business_id,demo,source_kind,source_id,date,currency,amount,scenario,snapshot,actor_id) values(request_id,business,true,source_type,source,day,config.currency,amount,scenario,jsonb_build_object('source',snapshot,'simulationOnly',true,'simulationConfirmed',true,'providerMode','mock','fundsMovedByFolio',false),auth.uid()) returning * into request;
  insert into public.billing_mock_refund_states(request_id,status,provider_id) values(request.id,'queued',provider_id) returning * into state;
  perform public.billing_validate_mock_refund_reservations(business,true,source_type,source);event_kind='requested';
 else
  if coalesce(command_data->>'requestId','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'Choose a mock refund request';end if;request_id=(command_data->>'requestId')::uuid;
  select * into request from public.billing_mock_refund_requests q where q.id=request_id and q.business_id=business and q.demo;
  if request.id is null then raise exception using errcode='P0002',message='Mock refund request unavailable in this business and data mode';end if;
  select * into state from public.billing_mock_refund_states s where s.request_id=request.id for update;
  if action='claim' then
   if command_data-array['requestId']<>'{}'::jsonb then raise exception 'Claim accepts only the request identity';end if;
   if state.status not in ('queued','leased') or state.status='leased' and state.lease_until>now() or state.next_attempt>now() or state.attempt>=5 then raise exception using errcode='40001',message='Mock refund is not ready for a new dispatch lease';end if;
   lease=gen_random_uuid();update public.billing_mock_refund_states s set status='leased',attempt=s.attempt+1,lease_token=lease,lease_until=now()+interval '30 seconds',result=null where s.request_id=request.id returning * into state;event_kind='leased';
  elsif action='cancel' then
   if command_data-array['requestId','reason']<>'{}'::jsonb or jsonb_typeof(command_data->'reason') is distinct from 'string' or length(btrim(command_data->>'reason')) not between 1 and 1000 then raise exception 'Enter the mock reservation cancellation reason';end if;
   if state.status not in ('queued','leased','needs-review') then raise exception 'Only an active mock reservation can be cancelled; correct completed refund records separately';end if;
   update public.billing_mock_refund_states s set status='cancelled',lease_token=null,lease_until=null,result=jsonb_build_object('reason',btrim(command_data->>'reason'),'providerMode','mock','fundsMovedByFolio',false) where s.request_id=request.id returning * into state;event_kind='cancelled';
  else
   if command_data-array['requestId','leaseToken']<>'{}'::jsonb or coalesce(command_data->>'leaseToken','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'Completion needs the current dispatch lease, never a browser outcome';end if;
   lease=(command_data->>'leaseToken')::uuid;
   if state.status<>'leased' or state.lease_token<>lease or state.lease_until<=now() then raise exception using errcode='40001',message='Mock refund lease expired or belongs to a different attempt';end if;
   -- Outcome is computed from the immutable request; a browser/provider payload
   -- cannot claim success, change the amount or choose a different identity.
   outcome=jsonb_build_object('providerMode','mock','simulationOnly',true,'fundsMovedByFolio',false,'providerId',state.provider_id,'idempotencyKey',request.id,'status',case when request.scenario='failure' then 'failed' when request.scenario='timeout-always' or request.scenario='timeout-once' and state.attempt=1 then 'timeout' else 'succeeded' end);
   if outcome->>'status'='failed' then update public.billing_mock_refund_states s set status='failed',lease_token=null,lease_until=null,result=outcome where s.request_id=request.id returning * into state;event_kind='failed';
   elsif outcome->>'status'='timeout' then update public.billing_mock_refund_states s set status=case when s.attempt>=5 then 'needs-review' else 'queued' end,lease_token=null,lease_until=null,next_attempt=now()+s.attempt*interval '1 second',result=outcome where s.request_id=request.id returning * into state;event_kind='timeout';
   elsif request.date<ledger.start_date or request.date<=coalesce(ledger.closed_through,request.date-1) then
    outcome=outcome||jsonb_build_object('status','needs-review','reason','The effective ledger period closed before acknowledgment; no demo refund was posted');update public.billing_mock_refund_states s set status='needs-review',lease_token=null,lease_until=null,result=outcome where s.request_id=request.id returning * into state;event_kind='needs-review';
   else
    -- Release this reservation only inside the same transaction that posts the
    -- authoritative demo refund. Any source/outbox failure restores the lease.
    update public.billing_mock_refund_states s set status='posting',lease_token=null,lease_until=null where s.request_id=request.id;
    insert into public.billing_mock_refund_posting_authority(request_id,lease_token) values(request.id,lease);
    posted=public.billing_refund_command(business,true,request.id,'record',jsonb_build_object('sourceKind',request.source_kind,'sourceId',request.source_id,'date',request.date,'currency',request.currency,'amount',request.amount::text,'method','Mock gateway simulation','reference',state.provider_id,'notes','DEMO SIMULATION ONLY. No actual funds moved.','paidConfirmed',true));
    delete from public.billing_mock_refund_posting_authority where public.billing_mock_refund_posting_authority.request_id=request.id;
    insert into public.billing_mock_refund_settlements(request_id,refund_id,refund_command_id,provider_id) values(request.id,(posted->'refund'->>'id')::uuid,request.id,state.provider_id);
    update public.billing_mock_refund_states s set status='acknowledged',refund_id=(posted->'refund'->>'id')::uuid,result=outcome||jsonb_build_object('refundId',posted->'refund'->>'id') where s.request_id=request.id returning * into state;event_kind='acknowledged';
   end if;
  end if;
 end if;
 result=public.billing_mock_refund_json(request.id)||jsonb_build_object('providerMode','mock','fundsMovedByFolio',false,'replayed',false);if posted is not null then result=result||jsonb_build_object('refund',posted->'refund','journal',posted->'journal');end if;
 insert into public.billing_mock_refund_commands(business_id,demo,command_id,actor_id,request,result) values(business,true,command_id,auth.uid(),payload,result);
 insert into public.billing_mock_refund_events(business_id,demo,request_id,command_id,kind,attempt,actor_id,payload) values(business,true,request.id,command_id,event_kind,state.attempt,auth.uid(),coalesce(outcome,state.result,'{}'::jsonb)||jsonb_build_object('leaseToken',state.lease_token,'providerMode','mock','fundsMovedByFolio',false));
 insert into public.billing_mock_refund_outbox(business_id,demo,request_id,command_id,topic,payload) values(business,true,request.id,command_id,'mock-refund.'||event_kind,result);
 insert into public.billing_ledger_audit(business_id,demo,actor_id,action,details) values(business,true,auth.uid(),'mock-refund.'||event_kind,jsonb_build_object('requestId',request.id,'attempt',state.attempt,'providerMode','mock','fundsMovedByFolio',false));return result;
end$$;

create function public.billing_mock_refund_read(business uuid,data_mode boolean,request_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb;selected jsonb=null;source jsonb=null;request public.billing_mock_refund_requests;count bigint;book numeric(30,2);reserved numeric(30,2);
begin
 if auth.uid() is null or not public.billing_can_access(business) then raise exception using errcode='42501',message='Mock refunds unavailable in this business';end if;if data_mode is null then raise exception 'Choose a data mode';end if;
 select count(*) into count from public.billing_mock_refund_requests q where q.business_id=business and q.demo=data_mode;
 select coalesce(jsonb_agg(public.billing_mock_refund_json(id) order by created_at desc,id desc),'[]'::jsonb) into rows from(select id,created_at from public.billing_mock_refund_requests q where q.business_id=business and q.demo=data_mode order by created_at desc,id desc limit 200)q;
 if request_id is not null then select * into request from public.billing_mock_refund_requests q where q.id=request_id and q.business_id=business and q.demo=data_mode;if request.id is null then raise exception using errcode='P0002',message='Mock refund unavailable in this business and data mode';end if;
  if (select count(*) from public.billing_mock_refund_events e where e.request_id=request.id)>1000 then raise exception 'Mock refund detail exceeds 1,000 dispatch events; no partial history is shown';end if;
  selected=public.billing_mock_refund_json(request.id)||jsonb_build_object('events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at,e.id) from public.billing_mock_refund_events e where e.request_id=request.id),'[]'::jsonb));
  book=public.billing_mock_refund_book(request.source_kind,request.source_id,request.date);reserved=public.billing_mock_refund_reserved(business,data_mode,request.source_kind,request.source_id,request.date);
  source=jsonb_build_object('kind',request.source_kind,'id',request.source_id,'currency',request.currency,'asOf',request.date,'bookAvailable',book::text,'reserved',reserved::text,'availableAtDate',(book-reserved)::text,'availableToAllocate',public.billing_mock_refund_spendable(business,data_mode,request.source_kind,request.source_id,request.date)::numeric(30,2)::text);
 end if;return jsonb_build_object('businessId',business,'demo',data_mode,'providerMode','mock','fundsMovedByFolio',false,'canWrite',public.billing_can_access(business,true),'requests',rows,'requestCount',count,'truncated',count>200,'selected',selected,'source',source);
end$$;
revoke all on function public.billing_mock_refund_reserved(uuid,boolean,text,uuid,date),public.billing_mock_refund_book(text,uuid,date),public.billing_mock_refund_spendable(uuid,boolean,text,uuid,date),public.billing_validate_mock_refund_reservations(uuid,boolean,text,uuid),public.billing_mock_refund_reservation_guard(),public.billing_mock_refund_mark_simulation(),public.billing_mock_refund_json(uuid),public.billing_mock_refund_command(uuid,boolean,uuid,text,jsonb),public.billing_mock_refund_read(uuid,boolean,uuid) from public,anon,authenticated;
grant execute on function public.billing_mock_refund_command(uuid,boolean,uuid,text,jsonb),public.billing_mock_refund_read(uuid,boolean,uuid) to authenticated;
notify pgrst,'reload schema';
