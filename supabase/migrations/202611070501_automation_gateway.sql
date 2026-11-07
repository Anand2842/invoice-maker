-- Automation (P1.1-P1.3) and online payment links (P1.4).
-- No service-role key exists at runtime. Machine work enters through RPCs gated by a system secret whose SHA-256 is
-- stored in billing_system_secrets (set by an operator in SQL, never by app users). Gateway webhooks are verified with
-- HMAC-SHA256 against the business webhook secret. After that verification, existing commands run as the business owner
-- for the rest of the transaction so every current validation, ledger and outbox rule applies unchanged.
-- Automation only touches real data; demo data never emails anyone. Mock gateway capture is demo-only because a
-- simulated receipt must never enter real books.

create table public.billing_system_secrets(name text primary key check(name='automation'),secret_hash bytea not null check(length(secret_hash)=32),created_at timestamptz not null default now());
create table public.billing_automation_settings(business_id uuid primary key references public.billing_businesses(id),recurring_enabled boolean not null default false,reminders_enabled boolean not null default false,reminder_days integer[] not null default '{1,7,14}',updated_by uuid not null references auth.users(id),updated_at timestamptz not null default now(),check(cardinality(reminder_days) between 1 and 6));
create table public.billing_email_outbox(id uuid primary key default gen_random_uuid(),business_id uuid not null references public.billing_businesses(id),kind text not null check(kind in('reminder','recurring-summary')),dedupe_key text not null unique,document_id uuid,recipient text not null,subject text not null,body text not null,status text not null default 'queued' check(status in('queued','sending','sent','failed','cancelled')),attempts integer not null default 0,claimed_at timestamptz,retry_at timestamptz,provider_id text,last_error text,created_at timestamptz not null default now(),sent_at timestamptz);
create index email_outbox_queue on public.billing_email_outbox(status,created_at);
create table public.billing_automation_commands(business_id uuid not null references public.billing_businesses(id),demo boolean not null,command_id uuid not null,actor_id uuid not null references auth.users(id),request jsonb not null,result jsonb not null,created_at timestamptz not null default now(),primary key(business_id,demo,command_id));
-- Failed recurring generation backs off per subscription so one business's broken subscriptions cannot hold the batch.
create table public.billing_automation_failures(source_id uuid primary key references public.billing_records(id),business_id uuid not null references public.billing_businesses(id),attempts integer not null,retry_at timestamptz not null,last_error text not null,updated_at timestamptz not null default now());
create table public.billing_gateway_settings(business_id uuid not null references public.billing_businesses(id),demo boolean not null,provider text not null check(provider in('mock','razorpay')),webhook_secret text not null check(length(webhook_secret) between 16 and 200),enabled boolean not null,updated_by uuid not null references auth.users(id),updated_at timestamptz not null default now(),primary key(business_id,demo),check(provider<>'mock' or demo));
create table public.billing_payment_links(id uuid primary key default gen_random_uuid(),business_id uuid not null references public.billing_businesses(id),demo boolean not null,document_id uuid not null references public.billing_records(id),token_hash bytea not null unique,amount numeric(18,2) not null check(amount>0),currency text not null,status text not null default 'open' check(status in('open','paid','cancelled')),created_by uuid not null references auth.users(id),created_at timestamptz not null default now());
create unique index payment_link_one_open on public.billing_payment_links(document_id) where status='open';
create table public.billing_gateway_events(id uuid primary key default gen_random_uuid(),business_id uuid not null references public.billing_businesses(id),demo boolean not null,link_id uuid not null references public.billing_payment_links(id),provider text not null,provider_payment_id text not null,amount numeric(18,2),currency text,status text not null check(status in('recorded','needs-review')),payment_record_id uuid,detail text not null default '',payload jsonb not null,received_at timestamptz not null default now(),unique(provider,provider_payment_id));

DO $$declare t text;begin foreach t in array array['billing_system_secrets','billing_automation_settings','billing_email_outbox','billing_automation_commands','billing_automation_failures','billing_gateway_settings','billing_payment_links','billing_gateway_events'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on table public.%I from public,anon,authenticated',t);end loop;end$$;
-- Members read automation state, outbox delivery and links; secrets and command results stay definer-only.
create policy automation_settings_read on public.billing_automation_settings for select to authenticated using(public.billing_can_access(business_id));
create policy email_outbox_read on public.billing_email_outbox for select to authenticated using(public.billing_can_access(business_id));
create policy automation_failures_read on public.billing_automation_failures for select to authenticated using(public.billing_can_access(business_id));
create policy payment_links_read on public.billing_payment_links for select to authenticated using(public.billing_can_access(business_id));
create policy gateway_events_read on public.billing_gateway_events for select to authenticated using(public.billing_can_access(business_id));
grant select on public.billing_automation_settings,public.billing_automation_failures,public.billing_email_outbox,public.billing_payment_links,public.billing_gateway_events to authenticated;

create function public.billing_automation_secret_ok(secret text) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(length(secret) between 32 and 256 and exists(select 1 from public.billing_system_secrets s where s.name='automation' and s.secret_hash=sha256(convert_to(secret,'UTF8'))),false)
$$;
create function public.billing_require_automation(secret text) returns void language plpgsql stable security definer set search_path='' as $$
begin if not public.billing_automation_secret_ok(secret) then raise exception using errcode='28000',message='Automation secret rejected';end if;end$$;
-- Transaction-local owner context for system work that has already passed secret or signature verification.
create function public.billing_act_as_owner(business uuid) returns void language plpgsql security definer set search_path='' as $$
declare owner uuid;begin select owner_id into owner from public.billing_businesses where id=business;if owner is null then raise exception 'Business unavailable';end if;perform set_config('request.jwt.claim.sub',owner::text,true);end$$;
create function public.billing_end_owner_context() returns void language sql security definer set search_path='' as $$select set_config('request.jwt.claim.sub','',true)$$;

-- Remaining customer obligation on a business-local date: issued documents use the dated settlement movements; legacy
-- records use their own totals. Future-dated receipts do not reduce what is due today.
create function public.billing_invoice_outstanding(doc uuid,as_of date) returns numeric language plpgsql stable security definer set search_path='' as $$
declare total numeric;moved numeric;
begin
 select coalesce(sum(m.delta),0) into moved from public.billing_settlement_movements(doc,'incoming') m where m.date<=as_of;
 if exists(select 1 from public.billing_issued_documents where document_id=doc) then return moved;end if;
 select (public.billing_document_totals(r.data)->'totals'->>'total')::numeric into total from public.billing_records r where r.id=doc and r.collection='documents';
 return coalesce(total,0)+moved;
end$$;
create function public.billing_money_text(n numeric) returns text language sql immutable set search_path='' as $$select to_char(n,'FM999999999990.00')$$;
create function public.billing_business_today(business uuid) returns date language sql stable security definer set search_path='' as $$select (now() at time zone time_zone)::date from public.billing_businesses where id=business$$;
create function public.billing_reminder_body(doc jsonb,owing numeric,business_name text) returns text language sql immutable set search_path='' as $$
 select 'Hello '||coalesce(nullif(doc->'buyer'->>'name',''),'there')||','||chr(10)||chr(10)||'Invoice '||(doc->>'number')||' dated '||(doc->>'date')||' was due on '||(doc->>'dueDate')||'. '||coalesce(doc->>'currency','')||' '||public.billing_money_text(owing)||' remains unpaid.'||chr(10)||chr(10)||'If you have already paid, please ignore this reminder.'||chr(10)||chr(10)||business_name
$$;

create function public.billing_automation_configure(business uuid,command_id uuid,settings jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.billing_automation_commands;request jsonb;days integer[];result jsonb;
begin
 if auth.uid() is null or not coalesce(public.billing_is_owner(business),false) then raise exception using errcode='42501',message='Only the business owner can change automation';end if;
 if command_id is null or jsonb_typeof(settings) is distinct from 'object' or (settings-array['recurringEnabled','remindersEnabled','reminderDays'])<>'{}'::jsonb
  or jsonb_typeof(settings->'recurringEnabled') is distinct from 'boolean' or jsonb_typeof(settings->'remindersEnabled') is distinct from 'boolean' or jsonb_typeof(settings->'reminderDays') is distinct from 'array'
  or jsonb_array_length(settings->'reminderDays') not between 1 and 6 or exists(select 1 from jsonb_array_elements(settings->'reminderDays') d where jsonb_typeof(d)<>'number' or d::text!~'^\d{1,3}$' or d::text::integer>365)
 then raise exception 'Choose recurring and reminder switches and 1-6 reminder days between 0 and 365 after the due date';end if;
 perform public.billing_ledger_writer_lock(business,true);
 request=jsonb_build_object('action','configure','settings',settings);
 select * into prior from public.billing_automation_commands c where c.business_id=business and not c.demo and c.command_id=billing_automation_configure.command_id;
 if prior.command_id is not null then if prior.actor_id<>auth.uid() or prior.request<>request then raise exception using errcode='40001',message='This retry key was used for a different automation command';end if;return prior.result||'{"replayed":true}';end if;
 select array_agg(distinct d::text::integer order by d::text::integer) into days from jsonb_array_elements(settings->'reminderDays') d;
 if cardinality(days)<>jsonb_array_length(settings->'reminderDays') then raise exception 'Reminder days must be distinct';end if;
 insert into public.billing_automation_settings as s(business_id,recurring_enabled,reminders_enabled,reminder_days,updated_by) values(business,(settings->>'recurringEnabled')::boolean,(settings->>'remindersEnabled')::boolean,days,auth.uid())
  on conflict(business_id) do update set recurring_enabled=excluded.recurring_enabled,reminders_enabled=excluded.reminders_enabled,reminder_days=excluded.reminder_days,updated_by=excluded.updated_by,updated_at=now();
 result=jsonb_build_object('recurringEnabled',(settings->>'recurringEnabled')::boolean,'remindersEnabled',(settings->>'remindersEnabled')::boolean,'reminderDays',to_jsonb(days),'replayed',false);
 insert into public.billing_automation_commands values(business,false,command_id,auth.uid(),request,result);return result;
end$$;

create function public.billing_automation_read(business uuid,data_mode boolean) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.billing_automation_settings;g public.billing_gateway_settings;
begin
 if auth.uid() is null or data_mode is null or not coalesce(public.billing_can_access(business),false) then raise exception using errcode='42501',message='You cannot view automation for this business';end if;
 select * into s from public.billing_automation_settings where business_id=business;select * into g from public.billing_gateway_settings where business_id=business and demo=data_mode;
 return jsonb_build_object('owner',public.billing_is_owner(business),
  'automation',jsonb_build_object('recurringEnabled',coalesce(s.recurring_enabled,false),'remindersEnabled',coalesce(s.reminders_enabled,false),'reminderDays',to_jsonb(coalesce(s.reminder_days,'{1,7,14}'::integer[])),'updatedAt',s.updated_at),
  'gateway',case when g.business_id is null then null else jsonb_build_object('provider',g.provider,'enabled',g.enabled,'secretHint','…'||right(g.webhook_secret,4),'simulated',g.provider='mock') end,
  'outbox',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'kind',o.kind,'documentId',o.document_id,'recipient',o.recipient,'subject',o.subject,'status',o.status,'attempts',o.attempts,'error',o.last_error,'createdAt',o.created_at,'sentAt',o.sent_at) order by o.created_at desc) from(select * from public.billing_email_outbox where business_id=business order by created_at desc limit 50)o),'[]'),
  'generationFailures',coalesce((select jsonb_agg(jsonb_build_object('subscriptionId',x.source_id,'name',r.data->>'name','attempts',x.attempts,'retryAt',x.retry_at,'error',x.last_error) order by x.updated_at desc) from public.billing_automation_failures x join public.billing_records r on r.id=x.source_id where x.business_id=business),'[]'),
  'links',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'documentId',l.document_id,'number',r.data->>'number','amount',public.billing_money_text(l.amount),'currency',l.currency,'status',l.status,'createdAt',l.created_at) order by l.created_at desc) from(select * from public.billing_payment_links where business_id=business and demo=data_mode order by created_at desc limit 50)l join public.billing_records r on r.id=l.document_id),'[]'),
  'openInvoices',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'number',i.data->>'number','buyer',i.data->'buyer'->>'name','dueDate',i.data->>'dueDate','currency',i.data->>'currency','outstanding',public.billing_money_text(i.owing)) order by i.data->>'date' desc,i.id) from(select r.id,r.data,public.billing_invoice_outstanding(r.id,public.billing_business_today(business)) owing from public.billing_records r where r.business_id=business and r.demo=data_mode and r.collection='documents' and not r.archived and r.data->>'type' in('invoice','gst-invoice','commercial-invoice') and r.data->>'status'='sent' order by r.data->>'date' desc limit 100)i where i.owing>0),'[]'),
  'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'linkId',e.link_id,'provider',e.provider,'paymentId',e.provider_payment_id,'amount',public.billing_money_text(e.amount),'currency',e.currency,'status',e.status,'detail',e.detail,'receivedAt',e.received_at) order by e.received_at desc) from(select * from public.billing_gateway_events where business_id=business and demo=data_mode order by received_at desc limit 50)e),'[]'));
end$$;

-- Daily tick: queue at most one reminder per invoice per reached offset, and list subscriptions due for generation.
create function public.billing_automation_due(secret text,at timestamptz default now()) returns jsonb language plpgsql security definer set search_path='' as $$
declare b record;inv record;today date;due date;step integer;owing numeric;queued integer=0;n integer;subs jsonb;
begin
 perform public.billing_require_automation(secret);
 for b in select s.*,bb.name,bb.time_zone from public.billing_automation_settings s join public.billing_businesses bb on bb.id=s.business_id where s.reminders_enabled loop
  today=(at at time zone b.time_zone)::date;
  for inv in select r.id,r.data from public.billing_records r where r.business_id=b.business_id and r.collection='documents' and not r.demo and not r.archived and r.data->>'type' in('invoice','gst-invoice','commercial-invoice') and r.data->>'status'='sent'
   and coalesce(r.data->>'dueDate','')~'^\d{4}-\d{2}-\d{2}$' and coalesce(r.data->'buyer'->>'email','')~'^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$' and length(r.data->'buyer'->>'email')<=254 loop
   begin due=(inv.data->>'dueDate')::date;exception when others then continue;end;
   select max(d) into step from unnest(b.reminder_days) d where today-due>=d;
   if step is null then continue;end if;
   owing=public.billing_invoice_outstanding(inv.id,today);if owing<=0 then continue;end if;
   insert into public.billing_email_outbox(business_id,kind,dedupe_key,document_id,recipient,subject,body)
   values(b.business_id,'reminder','reminder:'||inv.id||':'||step,inv.id,inv.data->'buyer'->>'email','Payment reminder: '||(inv.data->>'number')||' from '||b.name,
    public.billing_reminder_body(inv.data,owing,b.name))
   on conflict(dedupe_key) do nothing;
   get diagnostics n=row_count;queued=queued+n;
  end loop;
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('record',to_jsonb(r)-'turn','business',jsonb_build_object('id',bb.id,'name',bb.name,'currency',bb.currency,'time_zone',bb.time_zone))),'[]') into subs
 -- At most 25 per business per run, interleaved across businesses, skipping subscriptions still backing off after a failure.
 from(select * from(select r.*,row_number() over(partition by r.business_id order by r.data->>'nextDate',r.id) turn from public.billing_records r join public.billing_automation_settings s on s.business_id=r.business_id and s.recurring_enabled join public.billing_businesses bb on bb.id=r.business_id
  where r.collection='subscriptions' and not r.demo and not r.archived and r.data->>'status'='Active' and coalesce(r.data->>'nextDate','')~'^\d{4}-\d{2}-\d{2}$' and r.data->>'nextDate'<=((at at time zone bb.time_zone)::date)::text
   and not exists(select 1 from public.billing_automation_failures x where x.source_id=r.id and x.retry_at>at))q where turn<=25 order by turn,q.data->>'nextDate',q.id limit 200)r
 join public.billing_businesses bb on bb.id=r.business_id;
 return jsonb_build_object('remindersQueued',queued,'subscriptions',subs);
end$$;

-- Generates one subscription period through the existing workflow command, then tells the owner a draft awaits review.
create function public.billing_automation_generate(secret text,source_id uuid,source_version integer,document_data jsonb,next_date date) returns jsonb language plpgsql security definer set search_path='' as $$
declare source public.billing_records;doc public.billing_records;email text;
begin
 perform public.billing_require_automation(secret);
 select * into source from public.billing_records where id=source_id;
 if source.id is null or source.demo or source.collection<>'subscriptions' or not exists(select 1 from public.billing_automation_settings where business_id=source.business_id and recurring_enabled) then raise exception using errcode='P0002',message='Subscription is not enabled for automatic invoicing';end if;
 perform public.billing_act_as_owner(source.business_id);
 doc=public.billing_generate_document(source_id,source_version,document_data,next_date);
 select to_jsonb(u)->>'email' into email from auth.users u join public.billing_businesses b on b.owner_id=u.id where b.id=source.business_id;
 if coalesce(email,'')~'^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$' then
  insert into public.billing_email_outbox(business_id,kind,dedupe_key,document_id,recipient,subject,body) values(source.business_id,'recurring-summary','recurring:'||source_id||':'||(source.data->>'nextDate'),doc.id,email,
   'Recurring invoice draft ready: '||(doc.data->>'number'),'A draft invoice '||(doc.data->>'number')||' dated '||(doc.data->>'date')||' was generated from the subscription "'||coalesce(source.data->>'name','')||'". Review the customer, tax and amount, then issue and send it from Invoicing.')
  on conflict(dedupe_key) do nothing;
 end if;
 perform public.billing_end_owner_context();
 delete from public.billing_automation_failures where billing_automation_failures.source_id=billing_automation_generate.source_id;
 return jsonb_build_object('document',to_jsonb(doc),'sourceVersion',(select version from public.billing_records where id=source_id),'nextDate',next_date);
end$$;

-- Records a failed generation; the subscription is retried after 1, 2, 3... days (at most 7) and shown to the owner.
create function public.billing_automation_failed(secret text,source_id uuid,error text) returns jsonb language plpgsql security definer set search_path='' as $$
declare source public.billing_records;f public.billing_automation_failures;
begin
 perform public.billing_require_automation(secret);
 select * into source from public.billing_records where id=source_id and collection='subscriptions' and not demo;
 if source.id is null then raise exception using errcode='P0002',message='Subscription unavailable';end if;
 insert into public.billing_automation_failures as x(source_id,business_id,attempts,retry_at,last_error) values(source_id,source.business_id,1,now()+interval '1 day',left(coalesce(error,'Generation failed'),500))
  on conflict on constraint billing_automation_failures_pkey do update set attempts=x.attempts+1,retry_at=now()+least(x.attempts+1,7)*interval '1 day',last_error=excluded.last_error,updated_at=now() returning * into f;
 return jsonb_build_object('attempts',f.attempts,'retryAt',f.retry_at);
end$$;

-- Leased claim so a crashed sender's rows are retried after 15 minutes; failures back off 15 minutes per attempt and are marked failed after five.
create function public.billing_email_claim(secret text,max_items integer default 25) returns jsonb language plpgsql security definer set search_path='' as $$
declare out jsonb;
begin
 perform public.billing_require_automation(secret);
 if max_items is null or max_items not between 1 and 100 then raise exception 'Claim between 1 and 100 emails';end if;
 -- Reminders are re-checked at delivery: cancelled once reminders are off or the invoice is settled, closed or archived,
 -- and re-worded when a part payment changed the balance since queueing.
 update public.billing_email_outbox o set status='cancelled',last_error='No longer due when delivery was attempted' from public.billing_records r
  where o.kind='reminder' and o.status='queued' and r.id=o.document_id and (r.archived or r.data->>'status' is distinct from 'sent'
   or not exists(select 1 from public.billing_automation_settings s where s.business_id=o.business_id and s.reminders_enabled)
   or public.billing_invoice_outstanding(r.id,public.billing_business_today(o.business_id))<=0);
 update public.billing_email_outbox o set body=public.billing_reminder_body(r.data,public.billing_invoice_outstanding(r.id,public.billing_business_today(o.business_id)),b.name)
  from public.billing_records r,public.billing_businesses b where o.kind='reminder' and o.status='queued' and r.id=o.document_id and b.id=o.business_id
   and o.body is distinct from public.billing_reminder_body(r.data,public.billing_invoice_outstanding(r.id,public.billing_business_today(o.business_id)),b.name);
 with picked as(select id from public.billing_email_outbox where status='queued' and (retry_at is null or retry_at<=now()) or status='sending' and claimed_at<now()-interval '15 minutes' order by created_at limit max_items for update skip locked),
 claimed as(update public.billing_email_outbox o set status='sending',claimed_at=now(),attempts=attempts+1 from picked where o.id=picked.id returning o.*)
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'to',c.recipient,'subject',c.subject,'message',c.body,'attempt',c.attempts) order by c.created_at),'[]') into out from claimed c;
 return out;
end$$;
create function public.billing_email_complete(secret text,results jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;sent integer=0;retry integer=0;failed integer=0;item public.billing_email_outbox;
begin
 perform public.billing_require_automation(secret);
 if jsonb_typeof(results) is distinct from 'array' or jsonb_array_length(results)>100 then raise exception 'Report up to 100 delivery results';end if;
 for r in select value from jsonb_array_elements(results) loop
  if coalesce(r->>'id','')!~'^[0-9a-f-]{36}$' or jsonb_typeof(r->'ok') is distinct from 'boolean' or coalesce(r->>'attempt','')!~'^\d{1,4}$' then raise exception 'Malformed delivery result';end if;
  -- The attempt number is the lease: a sender whose lease expired and was re-claimed cannot overwrite the newer attempt.
  select * into item from public.billing_email_outbox where id=(r->>'id')::uuid and status='sending' and attempts=(r->>'attempt')::integer for update;
  if item.id is null then continue;end if;
  if (r->>'ok')::boolean then update public.billing_email_outbox set status='sent',sent_at=now(),provider_id=left(r->>'providerId',200),last_error=null where id=item.id;sent=sent+1;
  elsif item.attempts>=5 then update public.billing_email_outbox set status='failed',last_error=left(coalesce(r->>'error','Delivery failed'),500) where id=item.id;failed=failed+1;
  else update public.billing_email_outbox set status='queued',retry_at=now()+item.attempts*interval '15 minutes',last_error=left(coalesce(r->>'error','Delivery failed'),500) where id=item.id;retry=retry+1;end if;
 end loop;
 return jsonb_build_object('sent',sent,'retrying',retry,'failed',failed);
end$$;

-- RFC 2104 HMAC-SHA256 over built-in sha256(), so verification needs no extension.
create function public.billing_hmac_sha256(key bytea,message bytea) returns bytea language plpgsql immutable set search_path='' as $$
declare k bytea=key;ipad bytea;opad bytea;i integer;
begin
 if length(k)>64 then k=sha256(k);end if;k=k||decode(repeat('00',64-length(k)),'hex');ipad=k;opad=k;
 for i in 0..63 loop ipad=set_byte(ipad,i,get_byte(k,i)#54);opad=set_byte(opad,i,get_byte(k,i)#92);end loop;
 return sha256(opad||sha256(ipad||message));
end$$;

create function public.billing_gateway_configure(business uuid,data_mode boolean,command_id uuid,gateway jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.billing_automation_commands;request jsonb;provider text;secret text;result jsonb;
begin
 if auth.uid() is null or not coalesce(public.billing_is_owner(business),false) then raise exception using errcode='42501',message='Only the business owner can configure online payments';end if;
 if data_mode is null or command_id is null or jsonb_typeof(gateway) is distinct from 'object' or (gateway-array['provider','webhookSecret','enabled'])<>'{}'::jsonb or jsonb_typeof(gateway->'enabled') is distinct from 'boolean' then raise exception 'Choose a provider and whether online payments are enabled';end if;
 provider=gateway->>'provider';
 if provider='mock' and not data_mode then raise exception 'The simulated gateway is available only in demo data mode; real books need a real provider';end if;
 if provider not in('mock','razorpay') then raise exception 'Choose the simulated gateway or Razorpay';end if;
 if provider='razorpay' and (jsonb_typeof(gateway->'webhookSecret') is distinct from 'string' or length(gateway->>'webhookSecret') not between 16 and 200) then raise exception 'Enter the Razorpay webhook secret (16-200 characters)';end if;
 perform public.billing_ledger_writer_lock(business,true);
 -- The stored request omits the raw secret so command history never repeats it; retries compare the same normalized form.
 request=jsonb_build_object('action','gateway','data',gateway-'webhookSecret','secretHash',encode(sha256(convert_to(coalesce(gateway->>'webhookSecret',''),'UTF8')),'hex'));
 select * into prior from public.billing_automation_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_gateway_configure.command_id;
 if prior.command_id is not null then if prior.actor_id<>auth.uid() or prior.request<>request then raise exception using errcode='40001',message='This retry key was used for a different automation command';end if;return prior.result||'{"replayed":true}';end if;
 secret=case when provider='mock' then encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'hex') else gateway->>'webhookSecret' end;
 insert into public.billing_gateway_settings as g(business_id,demo,provider,webhook_secret,enabled,updated_by) values(business,data_mode,provider,secret,(gateway->>'enabled')::boolean,auth.uid())
  on conflict(business_id,demo) do update set provider=excluded.provider,webhook_secret=excluded.webhook_secret,enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=now();
 result=jsonb_build_object('provider',provider,'enabled',(gateway->>'enabled')::boolean,'secretHint','…'||right(secret,4),'simulated',provider='mock','replayed',false);
 insert into public.billing_automation_commands values(business,data_mode,command_id,auth.uid(),request,result);
 return result;
end$$;

create function public.billing_payment_link_create(business uuid,data_mode boolean,command_id uuid,invoice_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.billing_automation_commands;request jsonb;g public.billing_gateway_settings;src public.billing_records;owing numeric;token text;link uuid;result jsonb;
begin
 if auth.uid() is null or not coalesce(public.billing_can_access(business,true),false) then raise exception using errcode='42501',message='Your role cannot create payment links';end if;
 if data_mode is null or command_id is null or invoice_id is null then raise exception 'Choose an issued invoice';end if;
 perform public.billing_ledger_writer_lock(business,false);
 request=jsonb_build_object('action','link','invoiceId',invoice_id);
 select * into prior from public.billing_automation_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_payment_link_create.command_id;
 if prior.command_id is not null then if prior.actor_id<>auth.uid() or prior.request<>request then raise exception using errcode='40001',message='This retry key was used for a different automation command';end if;return prior.result||'{"replayed":true}';end if;
 select * into g from public.billing_gateway_settings where business_id=business and demo=data_mode;
 if g.business_id is null or not g.enabled then raise exception 'Enable online payments for this data mode first';end if;
 select * into src from public.billing_records where id=invoice_id and business_id=business and demo=data_mode and collection='documents' and not archived for update;
 if src.id is null or src.data->>'type' not in('invoice','gst-invoice','commercial-invoice') or src.data->>'status' is distinct from 'sent' then raise exception using errcode='P0002',message='Choose an issued, unpaid invoice in this business and data mode';end if;
 -- Razorpay amounts arrive in paise; other currencies use different minor units, so real links are INR only.
 if g.provider='razorpay' and src.data->>'currency' is distinct from 'INR' then raise exception 'Razorpay payment links support INR invoices only';end if;
 owing=public.billing_invoice_outstanding(invoice_id,public.billing_business_today(business));if owing<=0 then raise exception 'This invoice has no balance to collect';end if;
 update public.billing_payment_links set status='cancelled' where document_id=invoice_id and status='open';
 token=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
 insert into public.billing_payment_links(business_id,demo,document_id,token_hash,amount,currency,created_by) values(business,data_mode,invoice_id,sha256(convert_to(token,'UTF8')),owing,src.data->>'currency',auth.uid()) returning id into link;
 -- Simulated links pay on Folio's page; a Razorpay payment link is created in Razorpay with this link id as its Reference ID.
 result=jsonb_build_object('linkId',link,'reference',link,'amount',public.billing_money_text(owing),'currency',src.data->>'currency','provider',g.provider,'simulated',g.provider='mock','replayed',false)||case when g.provider='mock' then jsonb_build_object('token',token) else '{}'::jsonb end;
 insert into public.billing_automation_commands values(business,data_mode,command_id,auth.uid(),request,result);return result;
end$$;

-- Public: anyone holding the 64-hex-character token may see what they are asked to pay, nothing else.
create function public.billing_payment_link_open(token text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare l public.billing_payment_links;r public.billing_records;g public.billing_gateway_settings;
begin
 if coalesce(token,'')!~'^[0-9a-f]{64}$' then raise exception using errcode='P0002',message='Payment link unavailable';end if;
 select * into l from public.billing_payment_links where token_hash=sha256(convert_to(token,'UTF8'));
 if l.id is null then raise exception using errcode='P0002',message='Payment link unavailable';end if;
 select * into r from public.billing_records where id=l.document_id;select * into g from public.billing_gateway_settings where business_id=l.business_id and demo=l.demo;
 return jsonb_build_object('status',case when l.status='open' and not coalesce(g.enabled,false) then 'unavailable' else l.status end,'number',r.data->>'number','date',r.data->>'date','dueDate',r.data->>'dueDate','currency',l.currency,
  'amount',public.billing_money_text(case when l.status='open' then greatest(public.billing_invoice_outstanding(l.document_id,public.billing_business_today(l.business_id)),0) else l.amount end),'seller',coalesce(r.data->'seller'->>'name',''),'buyer',coalesce(r.data->'buyer'->>'name',''),
  'business',(select name from public.billing_businesses where id=l.business_id),'provider',g.provider,'simulated',coalesce(g.provider='mock',false));
end$$;

-- Verified gateway event -> receipt through billing_record_payment, deduplicated by provider payment id.
create function public.billing_gateway_process(body text,signature text) returns jsonb language plpgsql security definer set search_path='' as $$
declare payload jsonb;ref text;l public.billing_payment_links;g public.billing_gateway_settings;src public.billing_records;pay jsonb;pid text;amount numeric;owing numeric;note text;receipt jsonb;day date;tz text;
begin
 if body is null or length(body)>200000 or coalesce(signature,'')!~'^[0-9a-fA-F]{64}$' then raise exception using errcode='28000',message='Webhook signature missing or malformed';end if;
 begin payload=body::jsonb;exception when others then raise exception using errcode='22P02',message='Webhook body is not JSON';end;
 ref=payload#>>'{payload,payment_link,entity,reference_id}';
 if coalesce(ref,'')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception using errcode='P0002',message='Webhook does not reference a Folio payment link';end if;
 select * into l from public.billing_payment_links where id=ref::uuid for update;
 select * into g from public.billing_gateway_settings where business_id=l.business_id and demo=l.demo;
 if l.id is null or g.business_id is null then raise exception using errcode='P0002',message='Webhook does not reference a Folio payment link';end if;
 if encode(public.billing_hmac_sha256(convert_to(g.webhook_secret,'UTF8'),convert_to(body,'UTF8')),'hex')<>lower(signature) then raise exception using errcode='28000',message='Webhook signature rejected';end if;
 if payload->>'event' is distinct from 'payment_link.paid' then return jsonb_build_object('ignored',true,'event',payload->>'event');end if;
 pay=payload#>'{payload,payment,entity}';pid=pay->>'id';
 if coalesce(pid,'')!~'^[A-Za-z0-9_]{6,64}$' or jsonb_typeof(pay->'amount') is distinct from 'number' or (pay->>'amount')!~'^\d{1,15}$' then raise exception using errcode='22023',message='Webhook payment details are malformed';end if;
 if exists(select 1 from public.billing_gateway_events where provider=g.provider and provider_payment_id=pid) then return jsonb_build_object('duplicate',true,'paymentId',pid);end if;
 perform public.billing_act_as_owner(l.business_id);perform public.billing_ledger_writer_lock(l.business_id,false);
 -- The receipt is dated on the provider's capture day (business-local), not the day a retried webhook arrives.
 select time_zone into tz from public.billing_businesses where id=l.business_id;
 day=case when coalesce(pay->>'created_at','')~'^\d{9,11}$' then (to_timestamp((pay->>'created_at')::bigint) at time zone tz)::date else (now() at time zone tz)::date end;
 select * into src from public.billing_records where id=l.document_id for update;
 if day<(src.data->>'date')::date then day=(src.data->>'date')::date;end if;
 amount=(pay->>'amount')::numeric/100;owing=public.billing_invoice_outstanding(l.document_id,day);
 note=case when not g.enabled then 'Online payments were disabled when this payment arrived'
  when pay->>'status' is distinct from 'captured' then 'Payment is not captured'
  when upper(coalesce(pay->>'currency',''))<>l.currency then 'Payment currency differs from the invoice'
  when g.provider='razorpay' and l.currency<>'INR' then 'Only INR payments can be recorded automatically'
  when l.status<>'open' then 'Payment link was '||l.status||' when this payment arrived'
  when src.data->>'status' is distinct from 'sent' then 'Invoice is no longer open for payment'
  when amount<=0 or amount>owing then 'Payment amount exceeds the invoice balance' end;
 if note is not null then
  insert into public.billing_gateway_events(business_id,demo,link_id,provider,provider_payment_id,amount,currency,status,detail,payload) values(l.business_id,l.demo,l.id,g.provider,pid,amount,upper(pay->>'currency'),'needs-review',note,payload);
  perform public.billing_end_owner_context();
  return jsonb_build_object('recorded',false,'needsReview',true,'detail',note,'paymentId',pid);
 end if;
 -- Money has been collected either way: if posting fails (for example the period is closed) keep the verified event for review.
 begin
  receipt=public.billing_record_payment(l.business_id,l.document_id,src.version,md5('gateway:'||g.provider||':'||pid)::uuid,jsonb_build_object('amount',public.billing_money_text(amount),'date',day::text,'method',case when g.provider='mock' then 'Mock gateway (simulated)' else 'Online - Razorpay' end,'reference',pid),l.demo);
 exception when others then
  note=left('Receipt dated '||day||' could not be posted: '||sqlerrm,500);
 end;
 perform public.billing_end_owner_context();
 if note is not null then
  insert into public.billing_gateway_events(business_id,demo,link_id,provider,provider_payment_id,amount,currency,status,detail,payload) values(l.business_id,l.demo,l.id,g.provider,pid,amount,l.currency,'needs-review',note,payload);
  return jsonb_build_object('recorded',false,'needsReview',true,'detail',note,'paymentId',pid);
 end if;
 insert into public.billing_gateway_events(business_id,demo,link_id,provider,provider_payment_id,amount,currency,status,payment_record_id,payload) values(l.business_id,l.demo,l.id,g.provider,pid,amount,l.currency,'recorded',(receipt->'record'->>'id')::uuid,payload);
 if public.billing_invoice_outstanding(l.document_id,'infinity')<=0 then update public.billing_payment_links set status='paid' where id=l.id;end if;
 return jsonb_build_object('recorded',true,'paymentId',pid,'amount',public.billing_money_text(amount),'receiptId',receipt->'record'->>'id');
end$$;
create function public.billing_gateway_webhook(body text,signature text) returns jsonb language sql security definer set search_path='' as $$select public.billing_gateway_process(body,signature)$$;
-- Demo-only simulated checkout: builds a Razorpay-shaped event, signs it with the stored secret and sends it through the same verification.
create function public.billing_gateway_mock_capture(token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.billing_payment_links;g public.billing_gateway_settings;owing numeric;body text;
begin
 if coalesce(token,'')!~'^[0-9a-f]{64}$' then raise exception using errcode='P0002',message='Payment link unavailable';end if;
 select * into l from public.billing_payment_links where token_hash=sha256(convert_to(token,'UTF8'));
 select * into g from public.billing_gateway_settings where business_id=l.business_id and demo=l.demo;
 if l.id is null or g.provider is distinct from 'mock' or not l.demo then raise exception using errcode='P0002',message='Simulated checkout is unavailable for this link';end if;
 if l.status<>'open' or not g.enabled then raise exception 'This payment link is no longer open';end if;
 owing=public.billing_invoice_outstanding(l.document_id,public.billing_business_today(l.business_id));
 body=jsonb_build_object('event','payment_link.paid','payload',jsonb_build_object('payment_link',jsonb_build_object('entity',jsonb_build_object('id','plink_mock_'||left(replace(l.id::text,'-',''),14),'reference_id',l.id)),
  'payment',jsonb_build_object('entity',jsonb_build_object('id','pay_mock_'||left(md5(l.id::text||clock_timestamp()::text),14),'amount',(owing*100)::bigint,'currency',l.currency,'status','captured','method','simulated'))),'simulated',true)::text;
 return public.billing_gateway_process(body,encode(public.billing_hmac_sha256(convert_to(g.webhook_secret,'UTF8'),convert_to(body,'UTF8')),'hex'))||jsonb_build_object('simulated',true);
end$$;

DO $$declare fn regprocedure;begin for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('billing_automation_secret_ok','billing_require_automation','billing_automation_failed','billing_business_today','billing_reminder_body','billing_act_as_owner','billing_end_owner_context','billing_invoice_outstanding','billing_money_text','billing_automation_configure','billing_automation_read','billing_automation_due','billing_automation_generate','billing_email_claim','billing_email_complete','billing_hmac_sha256','billing_gateway_configure','billing_payment_link_create','billing_payment_link_open','billing_gateway_process','billing_gateway_webhook','billing_gateway_mock_capture') loop execute format('revoke all on function %s from public,anon,authenticated',fn);end loop;end$$;
grant execute on function public.billing_automation_configure(uuid,uuid,jsonb),public.billing_automation_read(uuid,boolean),public.billing_gateway_configure(uuid,boolean,uuid,jsonb),public.billing_payment_link_create(uuid,boolean,uuid,uuid) to authenticated;
-- Secret- or signature-gated machine entry points and the public link view are callable with only the publishable key.
grant execute on function public.billing_automation_due(text,timestamptz),public.billing_automation_generate(text,uuid,integer,jsonb,date),public.billing_automation_failed(text,uuid,text),public.billing_email_claim(text,integer),public.billing_email_complete(text,jsonb),public.billing_payment_link_open(text),public.billing_gateway_webhook(text,text),public.billing_gateway_mock_capture(text) to anon,authenticated;
