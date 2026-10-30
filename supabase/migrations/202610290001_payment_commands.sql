-- Additive, single-invoice incoming receipts and full dated reversals.
-- Run the read-only preflight and backup/restore rehearsal before production apply.
-- Existing payment rows are retained; no paid flags become synthetic cash.
create table public.billing_payment_commands (
 business_id uuid not null references public.billing_businesses(id), demo boolean not null,
 command_id uuid not null, actor_id uuid not null references auth.users(id), request jsonb not null,
 result_id uuid references public.billing_records(id), created_at timestamptz not null default now(),
 primary key(business_id,demo,command_id)
);
create table public.billing_payment_sequences (
 business_id uuid not null references public.billing_businesses(id), demo boolean not null,
 next_number bigint not null default 1 check(next_number between 1 and 1000000000),
 primary key(business_id,demo)
);
create table public.billing_payment_events (
 id uuid primary key, business_id uuid not null references public.billing_businesses(id), demo boolean not null,
 document_id uuid not null references public.billing_records(id), reverses_id uuid references public.billing_records(id),
 kind text not null check(kind in ('receipt','reversal')), number text not null,
 transaction_date date not null, currency text not null check(currency ~ '^[A-Z]{3}$'),
 amount numeric(16,2) not null check(amount>0 and amount<=10000000000),
 actor_id uuid not null references auth.users(id), snapshot jsonb not null,
 created_at timestamptz not null default now(),
 check((kind='reversal')=(reverses_id is not null)), unique(business_id,demo,number)
);
create unique index billing_one_payment_reversal on public.billing_payment_events(reverses_id) where kind='reversal';
create index billing_payment_invoice on public.billing_payment_events(business_id,demo,document_id,transaction_date,id);
create index billing_legacy_payment_invoice on public.billing_records(business_id,demo,(data->>'documentId')) where collection='payments';
create table public.billing_payment_outbox (
 id bigint generated always as identity primary key, event_id uuid not null unique references public.billing_payment_events(id),
 business_id uuid not null references public.billing_businesses(id), topic text not null,
 payload jsonb not null, created_at timestamptz not null default now()
);
alter table public.billing_payment_events enable row level security;
alter table public.billing_payment_commands enable row level security;
alter table public.billing_payment_sequences enable row level security;
alter table public.billing_payment_outbox enable row level security;
revoke all on public.billing_payment_events,public.billing_payment_commands,public.billing_payment_sequences,public.billing_payment_outbox from public,anon,authenticated;
grant select on public.billing_payment_events to authenticated;
create policy payment_event_read on public.billing_payment_events for select to authenticated using(public.billing_can_access(business_id));

create function public.billing_payment_amount(value jsonb) returns numeric
language plpgsql immutable set search_path='' as $$
declare raw text; amount numeric;
begin
 if value is null or jsonb_typeof(value) not in ('string','number') then raise exception 'Enter a positive payment amount with at most two decimal places'; end if;
 raw=value#>>'{}';
 if length(raw)>64 or raw!~'^[0-9]+(\.[0-9]{1,2})?$' then raise exception 'Enter a positive payment amount with at most two decimal places'; end if;
 amount=raw::numeric;
 if amount<=0 or amount>10000000000 then raise exception 'Payment amount is outside the supported range'; end if;
 return amount;
end $$;
create function public.billing_payment_date(value jsonb) returns date
language plpgsql immutable set search_path='' as $$
declare raw text; result date;
begin
 if value is null or jsonb_typeof(value)<>'string' then raise exception 'Enter a real payment date'; end if;
 raw=value#>>'{}';
 if raw!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Enter a real payment date'; end if;
 begin result=raw::date; exception when others then raise exception 'Enter a real payment date'; end;
 if to_char(result,'YYYY-MM-DD')<>raw then raise exception 'Enter a real payment date'; end if;
 return result;
end $$;
create function public.billing_payment_event_immutable() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'Payment events are immutable; record a reversal'; end $$;
create trigger billing_payment_event_immutable before update or delete on public.billing_payment_events
for each row execute function public.billing_payment_event_immutable();

-- A compatibility row can only be inserted after its authoritative immutable event.
-- Authenticated users cannot write the event table. A client-supplied GUC is not authority.
create function public.billing_payment_projection_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.collection<>'payments' then return new; end if;
 if tg_op='UPDATE' then raise exception 'Recorded payments cannot be edited or archived; use a reversal'; end if;
 if new.archived or not exists(select 1 from public.billing_payment_events e where e.id=new.id
  and e.business_id=new.business_id and e.demo=new.demo and e.snapshot=new.data and e.actor_id=new.created_by)
 then raise exception 'Use the payment command to record a payment'; end if;
 return new;
end $$;
create trigger billing_05_payment_projection before insert or update on public.billing_records
for each row execute function public.billing_payment_projection_guard();

create function public.billing_paid_invoice_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
declare field text;
begin
 if old.collection<>'documents' then return new; end if;
 if not exists(select 1 from public.billing_records p where p.business_id=old.business_id and p.demo=old.demo
   and p.collection='payments' and p.data->>'documentId'=old.id::text) then return new; end if;
 if new.archived or not coalesce(new.data->>'status' in ('sent','paid'),false) then raise exception 'An invoice with recorded payments cannot be cancelled or archived; use adjustments and payment reversals'; end if;
 foreach field in array array['type','number','date','dueDate','currency','seller','buyer','clientId','items','taxType','gstMode','roundOff','shipping','gstReporting','bank','discount'] loop
  if new.data->field is distinct from old.data->field then raise exception 'An invoice with recorded payments cannot change financial details; use an adjustment'; end if;
 end loop;
 return new;
end $$;
create trigger billing_05_paid_invoice before update on public.billing_records
for each row execute function public.billing_paid_invoice_guard();

create function public.billing_payment_readiness(business uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.billing_can_access(business) then raise exception 'Business unavailable'; end if;
 return jsonb_build_object('apiVersion',1,'canWrite',public.billing_can_access(business,true));
end $$;

create function public.billing_record_payment(business uuid,invoice_id uuid,expected_version integer,command_id uuid,payment_data jsonb,data_mode boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare source public.billing_records; cmd public.billing_payment_commands; result public.billing_records;
 amount numeric; payment_date date; payload jsonb; request jsonb; sequence bigint; receipt_number text; event_id uuid=gen_random_uuid();
begin
 if auth.uid() is null or not coalesce(public.billing_can_access(business,true),false) then raise exception using errcode='42501',message='You cannot record payments for this business'; end if;
 if command_id is null or invoice_id is null or data_mode is null or expected_version is null or expected_version<1
  or jsonb_typeof(payment_data) is distinct from 'object' then raise exception 'Invalid payment command'; end if;
 if (payment_data-array['amount','date','method','reference','notes','currency'])<>'{}'::jsonb then raise exception 'Unexpected payment fields'; end if;
 amount=public.billing_payment_amount(payment_data->'amount');payment_date=public.billing_payment_date(payment_data->'date');
 if jsonb_typeof(payment_data->'method') is distinct from 'string' or length(btrim(payment_data->>'method')) not between 1 and 100 then raise exception 'Enter a payment method (up to 100 characters)'; end if;
 if payment_data?'reference' and (jsonb_typeof(payment_data->'reference')<>'string' or length(payment_data->>'reference')>500) then raise exception 'Payment reference must be text up to 500 characters'; end if;
 if payment_data?'notes' and (jsonb_typeof(payment_data->'notes')<>'string' or length(payment_data->>'notes')>5000) then raise exception 'Payment notes must be text up to 5000 characters'; end if;
 request=jsonb_build_object('action','record','invoice',invoice_id,'version',expected_version,'data',payment_data);
 select * into cmd from public.billing_payment_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_record_payment.command_id;
 if cmd.actor_id<>auth.uid() or cmd.request<>request then raise exception using errcode='40001',message='This retry key was used for a different payment'; end if;
 -- Resolve a committed replay before checking a now-stale invoice version.
 if cmd.result_id is not null then select * into result from public.billing_records where id=cmd.result_id;return jsonb_build_object('record',to_jsonb(result),'replayed',true);end if;
 select * into source from public.billing_records where id=invoice_id and business_id=business and demo=data_mode and collection='documents' for update;
 -- Preserve invoice -> business FK lock order used by document numbering.
 insert into public.billing_payment_commands(business_id,demo,command_id,actor_id,request)
 values(business,data_mode,command_id,auth.uid(),request) on conflict do nothing;
 select * into cmd from public.billing_payment_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_record_payment.command_id for update;
 if cmd.actor_id<>auth.uid() or cmd.request<>request then raise exception using errcode='40001',message='This retry key was used for a different payment'; end if;
 -- Resolve a committed replay before checking a now-stale invoice version.
 if cmd.result_id is not null then select * into result from public.billing_records where id=cmd.result_id;return jsonb_build_object('record',to_jsonb(result),'replayed',true);end if;
 if source.id is null or source.business_id<>business or source.demo<>data_mode or source.archived or source.collection<>'documents'
  or not coalesce(source.data->>'type' in ('invoice','gst-invoice','commercial-invoice'),false)
  or not coalesce(source.data->>'status' in ('sent','paid'),false) then raise exception 'Choose an issued invoice in this business and data mode'; end if;
 if source.version<>expected_version then raise exception using errcode='40001',message='The invoice changed. Reload before recording payment'; end if;
 if source.data->>'currency' is null or source.data->>'currency'!~'^[A-Z]{3}$'
  or (payment_data?'currency' and payment_data->>'currency' is distinct from source.data->>'currency') then raise exception 'Payment currency differs from its invoice'; end if;
 -- Freeze validated snapshot totals and dates; never trust the caller for parties or invoice identity.
 perform public.billing_document_totals(source.data);perform public.billing_payment_date(source.data->'date');
 if coalesce(source.data->>'dueDate','')<>'' then
  if public.billing_payment_date(source.data->'dueDate')<public.billing_payment_date(source.data->'date') then raise exception 'The invoice due date needs review before recording payment'; end if;
 end if;
 if jsonb_typeof(source.data->'number') is distinct from 'string' or length(btrim(source.data->>'number')) not between 1 and 256 then raise exception 'The invoice number needs review before recording payment'; end if;
 if jsonb_typeof(source.data->'seller'->'name') is distinct from 'string' or length(btrim(source.data->'seller'->>'name')) not between 1 and 1024
  or jsonb_typeof(source.data->'buyer'->'name') is distinct from 'string' or length(btrim(source.data->'buyer'->>'name')) not between 1 and 1024
 then raise exception 'The invoice parties need review before recording payment'; end if;
 loop
  insert into public.billing_payment_sequences(business_id,demo,next_number) values(business,data_mode,2)
   on conflict(business_id,demo) do update set next_number=billing_payment_sequences.next_number+1 returning next_number-1 into sequence;
  if sequence>999999999 then raise exception 'Receipt sequence exhausted'; end if;
  receipt_number=(case when data_mode then 'DEMO-RCT-' else 'RCT-' end)||lpad(sequence::text,greatest(6,length(sequence::text)),'0');
  exit when not exists(select 1 from public.billing_records where business_id=business and demo=data_mode and collection='payments' and data->>'number'=receipt_number);
 end loop;
 payload=jsonb_build_object('kind','receipt','number',receipt_number,'documentId',source.id,'invoiceNumber',source.data->>'number',
  'invoiceDate',source.data->>'date','invoiceType',source.data->>'type','currency',source.data->>'currency','date',payment_date::text,
  'amount',to_char(amount,'FM99999999990.00'),'method',btrim(payment_data->>'method'),'direction','incoming',
  'reference',coalesce(payment_data->>'reference',''),'notes',coalesce(payment_data->>'notes',''),
  'seller',source.data->'seller','buyer',source.data->'buyer','clientId',coalesce(source.data->>'clientId',''));
 insert into public.billing_payment_events(id,business_id,demo,document_id,kind,number,transaction_date,currency,amount,actor_id,snapshot)
 values(event_id,business,data_mode,source.id,'receipt',receipt_number,payment_date,source.data->>'currency',amount,auth.uid(),payload);
 insert into public.billing_records(id,business_id,collection,data,demo,created_by) values(event_id,business,'payments',payload,data_mode,auth.uid()) returning * into result;
 insert into public.billing_payment_outbox(event_id,business_id,topic,payload) values(event_id,business,'payment.recorded',jsonb_build_object('paymentId',event_id,'documentId',source.id,'demo',data_mode));
 update public.billing_payment_commands c set result_id=result.id where c.business_id=business and c.demo=data_mode and c.command_id=billing_record_payment.command_id;
 return jsonb_build_object('record',to_jsonb(result),'replayed',false);
end $$;

create function public.billing_reverse_payment(business uuid,payment_id uuid,command_id uuid,reversal_data jsonb,data_mode boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare original public.billing_records; source public.billing_records; cmd public.billing_payment_commands; result public.billing_records;
 amount numeric; reversal_date date; request jsonb; payload jsonb; event_id uuid=gen_random_uuid(); reversal_number text;
begin
 if auth.uid() is null or not coalesce(public.billing_can_access(business,true),false) then raise exception using errcode='42501',message='You cannot reverse payments for this business'; end if;
 if command_id is null or payment_id is null or data_mode is null or jsonb_typeof(reversal_data) is distinct from 'object' then raise exception 'Invalid reversal command'; end if;
 if (reversal_data-array['date','reason'])<>'{}'::jsonb then raise exception 'Unexpected reversal fields'; end if;
 reversal_date=public.billing_payment_date(reversal_data->'date');
 if jsonb_typeof(reversal_data->'reason') is distinct from 'string' or length(btrim(reversal_data->>'reason')) not between 1 and 1000 then raise exception 'Enter a reversal reason (up to 1000 characters)'; end if;
 request=jsonb_build_object('action','reverse','payment',payment_id,'data',reversal_data);
 select * into cmd from public.billing_payment_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_reverse_payment.command_id;
 if cmd.actor_id<>auth.uid() or cmd.request<>request then raise exception using errcode='40001',message='This retry key was used for a different payment'; end if;
 if cmd.result_id is not null then select * into result from public.billing_records where id=cmd.result_id;return jsonb_build_object('record',to_jsonb(result),'replayed',true);end if;
 select * into original from public.billing_records where id=payment_id and business_id=business and demo=data_mode and collection='payments';
 if original.id is null or original.collection<>'payments' or original.business_id<>business or original.demo<>data_mode or original.archived
  or coalesce(original.data->>'kind','receipt')<>'receipt' or coalesce(original.data->>'direction','incoming')<>'incoming'
 then raise exception 'Payment unavailable in this business and data mode'; end if;
 -- Original rows (including retained legacy rows) are now protected by the projection guard.
 select * into source from public.billing_records where id=(original.data->>'documentId')::uuid and business_id=business and demo=data_mode and collection='documents' for update;
 -- Preserve invoice -> business FK lock order used by document numbering.
 insert into public.billing_payment_commands(business_id,demo,command_id,actor_id,request) values(business,data_mode,command_id,auth.uid(),request) on conflict do nothing;
 select * into cmd from public.billing_payment_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_reverse_payment.command_id for update;
 if cmd.actor_id<>auth.uid() or cmd.request<>request then raise exception using errcode='40001',message='This retry key was used for a different payment'; end if;
 if cmd.result_id is not null then select * into result from public.billing_records where id=cmd.result_id;return jsonb_build_object('record',to_jsonb(result),'replayed',true);end if;
 if source.id is null or source.business_id<>business or source.demo<>data_mode or source.archived or source.collection<>'documents'
  or not coalesce(source.data->>'type' in ('invoice','gst-invoice','commercial-invoice'),false)
  or not coalesce(source.data->>'status' in ('sent','paid'),false) then raise exception 'The payment invoice needs review before reversal'; end if;
 if original.data?'currency' and original.data->>'currency' is distinct from source.data->>'currency' then raise exception 'The payment currency needs review before reversal'; end if;
 amount=public.billing_payment_amount(original.data->'amount');
 if reversal_date<public.billing_payment_date(original.data->'date') then raise exception 'A reversal cannot predate its payment'; end if;
 if exists(select 1 from public.billing_payment_events where reverses_id=original.id) then raise exception using errcode='40001',message='This payment is already reversed'; end if;
 reversal_number='REV-'||event_id::text;
 payload=jsonb_build_object('kind','reversal','number',reversal_number,'documentId',source.id,'reversalOf',original.id,
  'invoiceNumber',source.data->>'number','invoiceDate',source.data->>'date','invoiceType',source.data->>'type',
  'currency',source.data->>'currency','date',reversal_date::text,'amount',to_char(amount,'FM99999999990.00'),
  'direction','incoming','method',original.data->>'method','reason',btrim(reversal_data->>'reason'),
  'seller',coalesce(original.data->'seller',source.data->'seller'),'buyer',coalesce(original.data->'buyer',source.data->'buyer'),
  'clientId',coalesce(source.data->>'clientId',''));
 insert into public.billing_payment_events(id,business_id,demo,document_id,reverses_id,kind,number,transaction_date,currency,amount,actor_id,snapshot)
 values(event_id,business,data_mode,source.id,original.id,'reversal',reversal_number,reversal_date,source.data->>'currency',amount,auth.uid(),payload);
 insert into public.billing_records(id,business_id,collection,data,demo,created_by) values(event_id,business,'payments',payload,data_mode,auth.uid()) returning * into result;
 insert into public.billing_payment_outbox(event_id,business_id,topic,payload) values(event_id,business,'payment.reversed',jsonb_build_object('paymentId',original.id,'reversalId',event_id,'documentId',source.id,'demo',data_mode));
 update public.billing_payment_commands c set result_id=result.id where c.business_id=business and c.demo=data_mode and c.command_id=billing_reverse_payment.command_id;
 return jsonb_build_object('record',to_jsonb(result),'replayed',false);
end $$;

revoke all on function public.billing_payment_amount(jsonb),public.billing_payment_date(jsonb),public.billing_payment_readiness(uuid),
 public.billing_record_payment(uuid,uuid,integer,uuid,jsonb,boolean),public.billing_reverse_payment(uuid,uuid,uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.billing_payment_readiness(uuid),public.billing_record_payment(uuid,uuid,integer,uuid,jsonb,boolean),public.billing_reverse_payment(uuid,uuid,uuid,jsonb,boolean) to authenticated;
notify pgrst,'reload schema';
