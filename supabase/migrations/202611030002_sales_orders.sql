-- Typed commercial orders. No generic status flag creates stock, money or issuance.
create table public.billing_sales_orders(
 id uuid primary key,business_id uuid not null references public.billing_businesses(id),demo boolean not null,
 client_id uuid not null,data jsonb not null,status text not null default 'draft' check(status in ('draft','issued','cancelled')),
 version integer not null default 1 check(version>0),number text,date date not null,currency text not null,
 issued_at timestamptz,cancelled_on date,cancellation_reason text,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(id,business_id,demo),unique(business_id,demo,number),foreign key(client_id,business_id,demo) references public.billing_records(id,business_id,demo),
 check((status='draft')=(issued_at is null)),check((status='cancelled')=(cancelled_on is not null))
);
create table public.billing_sales_order_sequences(business_id uuid not null references public.billing_businesses(id),demo boolean not null,next_number bigint not null default 1 check(next_number between 1 and 1000000000),primary key(business_id,demo));
create table public.billing_sales_order_lines(
 id uuid primary key,business_id uuid not null,demo boolean not null,order_id uuid not null,line_index integer not null check(line_index between 0 and 999),
 item_id uuid not null,unit_id uuid not null,quantity numeric(24,6) not null check(quantity>0 and quantity<=1000000000),base_quantity numeric(24,6) not null check(base_quantity>0),unit_factor numeric(24,6) not null check(unit_factor>0),
 snapshot jsonb not null,source_totals jsonb not null,unique(id,business_id,demo),unique(order_id,line_index),
 foreign key(order_id,business_id,demo) references public.billing_sales_orders(id,business_id,demo),
 foreign key(item_id,business_id,demo) references public.billing_inventory_items(id,business_id,demo),
 foreign key(unit_id,business_id,demo) references public.billing_inventory_units(id,business_id,demo)
);
create table public.billing_sales_order_commands(
 business_id uuid not null references public.billing_businesses(id),demo boolean not null,command_id uuid not null,actor_id uuid not null references auth.users(id),request jsonb not null,result jsonb not null,primary key(business_id,demo,command_id)
);
create table public.billing_sales_order_outbox(
 id uuid primary key default gen_random_uuid(),business_id uuid not null,demo boolean not null,command_id uuid not null,topic text not null,payload jsonb not null,created_at timestamptz not null default now(),
 unique(business_id,demo,command_id),foreign key(business_id,demo,command_id) references public.billing_sales_order_commands(business_id,demo,command_id)
);
create table public.billing_sales_order_cancellations(
 id uuid primary key,business_id uuid not null,demo boolean not null,order_id uuid not null unique,date date not null,reason text not null,actor_id uuid not null references auth.users(id),created_at timestamptz not null default now(),
 foreign key(order_id,business_id,demo) references public.billing_sales_orders(id,business_id,demo)
);
create table public.billing_sales_document_conversions(
 id uuid primary key,business_id uuid not null,demo boolean not null,document_id uuid not null unique,kind text not null check(kind in ('invoice','gst-invoice','commercial-invoice','delivery-challan','credit-note')),
 date date not null,expected_data jsonb not null,actor_id uuid not null references auth.users(id),created_at timestamptz not null default now(),unique(id,business_id,demo)
);
create table public.billing_sales_conversion_lines(
 id uuid primary key,business_id uuid not null,demo boolean not null,conversion_id uuid not null,order_line_id uuid not null,source_invoice_line_id uuid,fulfillment_line_id uuid,
 quantity numeric(24,6) not null check(quantity>0 and quantity<=1000000000),source_allocation jsonb not null,snapshot jsonb not null,
 unique(id,business_id,demo),
 foreign key(conversion_id,business_id,demo) references public.billing_sales_document_conversions(id,business_id,demo),
 foreign key(order_line_id,business_id,demo) references public.billing_sales_order_lines(id,business_id,demo),
 foreign key(source_invoice_line_id,business_id,demo) references public.billing_sales_conversion_lines(id,business_id,demo)
);
create table public.billing_sales_conversion_abandonments(
 id uuid primary key,business_id uuid not null,demo boolean not null,conversion_id uuid not null unique,date date not null,reason text not null,actor_id uuid not null references auth.users(id),created_at timestamptz not null default now(),
 foreign key(conversion_id,business_id,demo) references public.billing_sales_document_conversions(id,business_id,demo)
);
create table public.billing_sales_fulfillment_events(
 id uuid primary key,business_id uuid not null,demo boolean not null,kind text not null check(kind in ('dispatch','return')),date date not null,reference text not null,reason text not null,
 actor_id uuid not null references auth.users(id),created_at timestamptz not null default now(),unique(id,business_id,demo)
);
create table public.billing_sales_fulfillment_lines(
 id uuid primary key,business_id uuid not null,demo boolean not null,event_id uuid not null,order_line_id uuid not null,kind text not null check(kind in ('dispatch','return')),returns_id uuid,
 quantity numeric(24,6) not null check(quantity>0 and quantity<=1000000000),base_quantity numeric(24,6) not null check(base_quantity>0),warehouse_id uuid,batch_code text,serials jsonb not null default '[]',snapshot jsonb not null,
 unique(id,business_id,demo),check((kind='return')=(returns_id is not null)),
 foreign key(event_id,business_id,demo) references public.billing_sales_fulfillment_events(id,business_id,demo),
 foreign key(order_line_id,business_id,demo) references public.billing_sales_order_lines(id,business_id,demo),
 foreign key(returns_id,business_id,demo) references public.billing_sales_fulfillment_lines(id,business_id,demo)
);
alter table public.billing_sales_conversion_lines add foreign key(fulfillment_line_id,business_id,demo) references public.billing_sales_fulfillment_lines(id,business_id,demo);
create unique index sales_conversion_source_once on public.billing_sales_conversion_lines(conversion_id,order_line_id,coalesce(source_invoice_line_id,'00000000-0000-0000-0000-000000000000'::uuid),coalesce(fulfillment_line_id,'00000000-0000-0000-0000-000000000000'::uuid));
create index sales_order_scope on public.billing_sales_orders(business_id,demo,date,id);
create index sales_conversion_source on public.billing_sales_conversion_lines(order_line_id,conversion_id,id);
create index sales_fulfillment_source on public.billing_sales_fulfillment_lines(order_line_id,event_id,id);

alter table public.billing_sales_orders enable row level security;
alter table public.billing_sales_order_sequences enable row level security;
alter table public.billing_sales_order_lines enable row level security;
alter table public.billing_sales_order_commands enable row level security;
alter table public.billing_sales_order_outbox enable row level security;
alter table public.billing_sales_order_cancellations enable row level security;
alter table public.billing_sales_document_conversions enable row level security;
alter table public.billing_sales_conversion_lines enable row level security;
alter table public.billing_sales_conversion_abandonments enable row level security;
alter table public.billing_sales_fulfillment_events enable row level security;
alter table public.billing_sales_fulfillment_lines enable row level security;
revoke all on public.billing_sales_orders,public.billing_sales_order_sequences,public.billing_sales_order_lines,public.billing_sales_order_commands,public.billing_sales_order_outbox,public.billing_sales_order_cancellations,public.billing_sales_document_conversions,public.billing_sales_conversion_lines,public.billing_sales_conversion_abandonments,public.billing_sales_fulfillment_events,public.billing_sales_fulfillment_lines from public,anon,authenticated;
grant select on public.billing_sales_orders,public.billing_sales_order_lines,public.billing_sales_order_cancellations,public.billing_sales_document_conversions,public.billing_sales_conversion_lines,public.billing_sales_conversion_abandonments,public.billing_sales_fulfillment_events,public.billing_sales_fulfillment_lines to authenticated;
create policy sales_order_read on public.billing_sales_orders for select to authenticated using(public.billing_can_access(business_id));
create policy sales_order_line_read on public.billing_sales_order_lines for select to authenticated using(public.billing_can_access(business_id));
create policy sales_order_cancel_read on public.billing_sales_order_cancellations for select to authenticated using(public.billing_can_access(business_id));
create policy sales_conversion_read on public.billing_sales_document_conversions for select to authenticated using(public.billing_can_access(business_id));
create policy sales_conversion_line_read on public.billing_sales_conversion_lines for select to authenticated using(public.billing_can_access(business_id));
create policy sales_conversion_abandon_read on public.billing_sales_conversion_abandonments for select to authenticated using(public.billing_can_access(business_id));
create policy sales_fulfillment_read on public.billing_sales_fulfillment_events for select to authenticated using(public.billing_can_access(business_id));
create policy sales_fulfillment_line_read on public.billing_sales_fulfillment_lines for select to authenticated using(public.billing_can_access(business_id));
create trigger sales_order_line_immutable before update or delete on public.billing_sales_order_lines for each row execute function public.billing_ledger_immutable();
create trigger sales_order_command_immutable before update or delete on public.billing_sales_order_commands for each row execute function public.billing_ledger_immutable();
create trigger sales_order_outbox_immutable before update or delete on public.billing_sales_order_outbox for each row execute function public.billing_ledger_immutable();
create trigger sales_order_cancel_immutable before update or delete on public.billing_sales_order_cancellations for each row execute function public.billing_ledger_immutable();
create trigger sales_conversion_immutable before update or delete on public.billing_sales_document_conversions for each row execute function public.billing_ledger_immutable();
create trigger sales_conversion_line_immutable before update or delete on public.billing_sales_conversion_lines for each row execute function public.billing_ledger_immutable();
create trigger sales_conversion_abandon_immutable before update or delete on public.billing_sales_conversion_abandonments for each row execute function public.billing_ledger_immutable();
create trigger sales_fulfillment_immutable before update or delete on public.billing_sales_fulfillment_events for each row execute function public.billing_ledger_immutable();
create trigger sales_fulfillment_line_immutable before update or delete on public.billing_sales_fulfillment_lines for each row execute function public.billing_ledger_immutable();
create function public.billing_sales_order_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Sales orders are retained; use a versioned correction or dated cancellation';end if;
 if new.id<>old.id or new.business_id<>old.business_id or new.demo<>old.demo or new.created_by<>old.created_by or new.created_at<>old.created_at then raise exception 'Sales order identity is immutable';end if;
 if old.status<>'draft' and (new.data<>old.data or new.client_id<>old.client_id or new.number<>old.number or new.date<>old.date or new.currency<>old.currency or new.issued_at<>old.issued_at or old.status='cancelled' or new.status<>'cancelled' or not exists(select 1 from public.billing_sales_order_cancellations c where c.order_id=old.id and c.date=new.cancelled_on and c.reason=new.cancellation_reason)) then raise exception 'Issued sales order snapshots are immutable; use their dated cancellation workflow';end if;
 return new;
end$$;
create trigger sales_order_guard before update or delete on public.billing_sales_orders for each row execute function public.billing_sales_order_guard();

create function public.billing_sales_quantity(value jsonb,allow_zero boolean default false) returns numeric language plpgsql immutable set search_path='' as $$
declare raw text;n numeric;
begin
 if value is null or jsonb_typeof(value) not in ('string','number') then raise exception 'Use an exact sales quantity with at most six decimal places';end if;raw=value#>>'{}';
 if length(raw)>40 or raw!~'^[0-9]+(\.[0-9]{1,6})?$' then raise exception 'Use an exact sales quantity with at most six decimal places';end if;n=raw::numeric;
 if n<0 or n>1000000000 or not allow_zero and n=0 then raise exception 'Sales quantities must be positive and no greater than 1,000,000,000';end if;return n;
end$$;
create function public.billing_sales_component_totals(minor jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare components jsonb='{}';key text;n numeric;
begin
 foreach key in array array['taxable','discount','cgst','sgst','igst','vat','cess'] loop n=(minor->>key)::numeric;if n is null or n<0 or n<>trunc(n) or n>1000000000000 then raise exception 'Sales source cents are outside the supported exact monetary range';end if;components=components||jsonb_build_object(key,n::text);end loop;return components;
end$$;

create function public.billing_sales_order_save(business uuid,data_mode boolean,order_id uuid,expected_version integer,command_id uuid,order_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.billing_sales_order_commands;existing public.billing_sales_orders;client public.billing_records;line jsonb;lines jsonb='[]';item record;unit record;q numeric;factor numeric;base numeric;day date;due date;doc jsonb;totals jsonb;normalized jsonb;request jsonb;result jsonb;seen uuid[]='{}';line_id uuid;
begin
 if auth.uid() is null or not public.billing_can_access(business,true) then raise exception using errcode='42501',message='Your role cannot edit sales orders';end if;
 if data_mode is null or order_id is null or expected_version is null or expected_version<0 or command_id is null or jsonb_typeof(order_data) is distinct from 'object' or order_data-array['clientId','currency','date','dueDate','reference','notes','taxType','gstMode','lines']<>'{}'::jsonb then raise exception 'Invalid versioned sales order draft';end if;
 request=jsonb_build_object('action','save','orderId',order_id,'version',expected_version,'data',order_data);
 select * into prior from public.billing_sales_order_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_sales_order_save.command_id;
 if prior.command_id is not null then if prior.actor_id<>auth.uid() or prior.request<>request then raise exception using errcode='40001',message='Retry key was used for a different sales order command';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 perform public.billing_ledger_writer_lock(business,false);
 select * into prior from public.billing_sales_order_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_sales_order_save.command_id;
 if prior.command_id is not null then if prior.actor_id<>auth.uid() or prior.request<>request then raise exception using errcode='40001',message='Retry key was used for a different sales order command';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 if coalesce(order_data->>'clientId','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'Choose an explicit saved customer';end if;
 select * into client from public.billing_records r where r.id=(order_data->>'clientId')::uuid and r.business_id=business and r.demo=data_mode and r.collection='clients' and not r.archived;
 if client.id is null then raise exception 'Choose an active saved customer in this business and data mode';end if;
 if coalesce(order_data->>'currency','')!~'^[A-Z]{3}$' then raise exception 'Choose an explicit commercial currency';end if;
 day=public.billing_payment_date(order_data->'date');due=public.billing_payment_date(order_data->'dueDate');if due<day then raise exception 'Order due date cannot precede its date';end if;
 if jsonb_typeof(order_data->'reference') is distinct from 'string' or length(order_data->>'reference')>180 or jsonb_typeof(order_data->'notes') is distinct from 'string' or length(order_data->>'notes')>5000 then raise exception 'Review the external order reference and notes';end if;
 if coalesce(order_data->>'taxType','') not in ('NONE','GST','VAT') or coalesce(order_data->>'gstMode','') not in ('split','igst') then raise exception 'Review the order tax type and GST mode';end if;
 if jsonb_typeof(order_data->'lines') is distinct from 'array' or jsonb_array_length(order_data->'lines') not between 1 and 1000 then raise exception 'A sales order requires 1 to 1,000 explicit lines';end if;
 for line in select value from jsonb_array_elements(order_data->'lines') loop
  if jsonb_typeof(line) is distinct from 'object' or line-array['id','itemId','unitId','name','quantity','rate','discount','discountType','taxRate','cessRate','hsn']<>'{}'::jsonb or coalesce(line->>'id','')!~'^[0-9a-fA-F-]{36}$' or coalesce(line->>'itemId','')!~'^[0-9a-fA-F-]{36}$' or coalesce(line->>'unitId','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'Each order line needs its own stable ID and canonical item/unit IDs';end if;
  line_id=(line->>'id')::uuid;if line_id=any(seen) then raise exception 'Order line IDs must be distinct';end if;seen=array_append(seen,line_id);
  select * into item from public.billing_inventory_items i where i.id=(line->>'itemId')::uuid and i.business_id=business and i.demo=data_mode;
  select * into unit from public.billing_inventory_units u where u.id=(line->>'unitId')::uuid and u.business_id=business and u.demo=data_mode and u.item_id=(line->>'itemId')::uuid;
  if item.id is null or unit.id is null then raise exception 'Choose a canonical item and its matching unit in this business and data mode';end if;
  q=public.billing_sales_quantity(line->'quantity');factor=unit.factor;base=q*factor;if base<>round(base,6) or base<=0 or base>1000000000000 then raise exception 'This unit conversion cannot preserve the requested base quantity at six places';end if;
  if jsonb_typeof(line->'name') is distinct from 'string' or length(btrim(line->>'name')) not between 1 and 500 or jsonb_typeof(line->'hsn') is distinct from 'string' or length(line->>'hsn')>30 then raise exception 'Review each line description and HSN/SAC';end if;
  lines=lines||jsonb_build_array(line||jsonb_build_object('rate',public.billing_decimal(line->'rate','Order rate')::text,'discount',public.billing_decimal(line->'discount','Order discount')::text,'taxRate',public.billing_decimal(line->'taxRate','Order tax rate',0,100)::text,'cessRate',public.billing_decimal(line->'cessRate','Order cess rate',0,1000)::text,'id',line_id,'itemId',item.id,'unitId',unit.id,'quantity',q::numeric(24,6)::text,'unitFactor',factor::text,'baseQuantity',base::numeric(24,6)::text,'itemSnapshot',to_jsonb(item),'unitSnapshot',to_jsonb(unit)));
 end loop;
 doc=jsonb_build_object('type','invoice','currency',order_data->>'currency','items',lines,'taxType',order_data->>'taxType','gstMode',order_data->>'gstMode','roundOff',false,'shipping',jsonb_build_object('amount','0'));
 totals=public.billing_document_totals(doc);if (totals->'totals'->>'total')::numeric>10000000000 then raise exception 'Order totals exceed the supported ledger/document amount range';end if;
 normalized=order_data||jsonb_build_object('lines',lines,'totals',totals->'totals');
 select * into existing from public.billing_sales_orders o where o.id=order_id and o.business_id=business and o.demo=data_mode for update;
 if existing.id is null then if expected_version<>0 then raise exception using errcode='40001',message='Sales order draft unavailable; reload before saving';end if;
  insert into public.billing_sales_orders(id,business_id,demo,client_id,data,date,currency,created_by) values(order_id,business,data_mode,client.id,normalized,day,order_data->>'currency',auth.uid()) returning * into existing;
 else
  if existing.status<>'draft' then raise exception 'Issued order contents cannot be edited; correct their downstream source history';end if;
  if existing.version<>expected_version then raise exception using errcode='40001',message='Sales order draft changed; reload before saving';end if;
  update public.billing_sales_orders set data=normalized,client_id=client.id,date=day,currency=order_data->>'currency',version=version+1,updated_at=now() where id=existing.id returning * into existing;
 end if;
 result=jsonb_build_object('order',to_jsonb(existing),'replayed',false);
 insert into public.billing_sales_order_commands(business_id,demo,command_id,actor_id,request,result) values(business,data_mode,command_id,auth.uid(),request,result);
 insert into public.billing_ledger_audit(business_id,demo,actor_id,action,details) values(business,data_mode,auth.uid(),'sales-order.draft-saved',jsonb_build_object('orderId',existing.id,'version',existing.version));
 insert into public.billing_sales_order_outbox(business_id,demo,command_id,topic,payload) values(business,data_mode,command_id,'sales-order.draft-saved',result);return result;
end$$;

create function public.billing_sales_order_issue(business uuid,data_mode boolean,order_id uuid,expected_version integer,command_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.billing_sales_order_commands;source public.billing_sales_orders;client public.billing_records;company public.billing_businesses;request jsonb;result jsonb;line jsonb;doc jsonb;parts jsonb;sequence bigint;n integer=0;
begin
 if auth.uid() is null or not public.billing_can_access(business,true) then raise exception using errcode='42501',message='Your role cannot issue sales orders';end if;
 if data_mode is null or order_id is null or expected_version is null or expected_version<1 or command_id is null then raise exception 'Invalid versioned order issue command';end if;
 request=jsonb_build_object('action','issue','orderId',order_id,'version',expected_version);
 select * into prior from public.billing_sales_order_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_sales_order_issue.command_id;
 if prior.command_id is not null then if prior.actor_id<>auth.uid() or prior.request<>request then raise exception using errcode='40001',message='Retry key was used for a different sales order command';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 perform public.billing_ledger_writer_lock(business,false);
 select * into prior from public.billing_sales_order_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_sales_order_issue.command_id;
 if prior.command_id is not null then if prior.actor_id<>auth.uid() or prior.request<>request then raise exception using errcode='40001',message='Retry key was used for a different sales order command';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 select * into source from public.billing_sales_orders o where o.id=order_id and o.business_id=business and o.demo=data_mode for update;
 if source.id is null or source.status<>'draft' then raise exception 'Choose a saved sales order draft in this business and data mode';end if;
 if source.version<>expected_version then raise exception using errcode='40001',message='Order draft changed; reload before issuance';end if;
 select * into client from public.billing_records r where r.id=source.client_id and r.business_id=business and r.demo=data_mode and r.collection='clients' and not r.archived;
 if client.id is null then raise exception 'The saved customer is no longer active; review the draft';end if;
 select * into company from public.billing_businesses where id=business;
 if source.date>(now() at time zone company.time_zone)::date then raise exception 'Order issue date cannot be after the business-local date';end if;
 insert into public.billing_sales_order_sequences(business_id,demo,next_number) values(business,data_mode,2) on conflict(business_id,demo) do update set next_number=billing_sales_order_sequences.next_number+1 returning next_number-1 into sequence;
 if sequence>999999999 then raise exception 'Sales order numbering exhausted';end if;
 source.number=(case when data_mode then 'DEMO-SO-' else 'SO-' end)||lpad(sequence::text,greatest(6,length(sequence::text)),'0');
 source.data=source.data||jsonb_build_object('number',source.number,'customer',jsonb_build_object('id',client.id,'name',client.data->>'name','address',client.data->>'address','email',client.data->>'email','phone',client.data->>'phone','gstin',client.data->>'gstin'),'business',jsonb_build_object('id',business,'name',company.name,'address',company.address,'email',company.email,'phone',company.phone,'gstin',company.gstin,'pan',company.pan),'issuedOn',source.date,'sourceVersion',source.version);
 for line in select value from jsonb_array_elements(source.data->'lines') loop
  -- Item/unit snapshots were reviewed on the saved version. Canonical identifiers
  -- cannot be rebound or reinterpreted when that version is frozen.
  if not exists(select 1 from public.billing_inventory_items i where i.id=(line->>'itemId')::uuid and i.business_id=business and i.demo=data_mode and to_jsonb(i)=line->'itemSnapshot') or not exists(select 1 from public.billing_inventory_units u where u.id=(line->>'unitId')::uuid and u.business_id=business and u.demo=data_mode and u.item_id=(line->>'itemId')::uuid and u.factor=(line->>'unitFactor')::numeric) then raise exception using errcode='40001',message='Canonical item/unit changed; resave and review this order draft';end if;
  doc=jsonb_build_object('type','invoice','currency',source.currency,'items',jsonb_build_array(line),'taxType',source.data->>'taxType','gstMode',source.data->>'gstMode','shipping',jsonb_build_object('amount','0'),'roundOff',false);
  parts=public.billing_sales_component_totals(public.billing_document_totals(doc)->'totals'->'minor');
  insert into public.billing_sales_order_lines(id,business_id,demo,order_id,line_index,item_id,unit_id,quantity,base_quantity,unit_factor,snapshot,source_totals) values((line->>'id')::uuid,business,data_mode,source.id,n,(line->>'itemId')::uuid,(line->>'unitId')::uuid,(line->>'quantity')::numeric,(line->>'baseQuantity')::numeric,(line->>'unitFactor')::numeric,line,parts);n=n+1;
 end loop;
 update public.billing_sales_orders set status='issued',data=source.data,number=source.number,issued_at=now(),version=version+1,updated_at=now() where id=source.id returning * into source;
 result=jsonb_build_object('order',to_jsonb(source),'replayed',false);
 insert into public.billing_sales_order_commands(business_id,demo,command_id,actor_id,request,result) values(business,data_mode,command_id,auth.uid(),request,result);
 insert into public.billing_ledger_audit(business_id,demo,actor_id,action,details) values(business,data_mode,auth.uid(),'sales-order.issued',jsonb_build_object('orderId',source.id,'number',source.number));
 insert into public.billing_sales_order_outbox(business_id,demo,command_id,topic,payload) values(business,data_mode,command_id,'sales-order.issued',result);return result;
end$$;

create function public.billing_sales_fulfillment_movements(source_line uuid) returns table(date date,quantity numeric,base_quantity numeric) language sql stable security definer set search_path='' as $$
 select e.date,l.quantity*case when l.kind='dispatch' then 1 else -1 end,l.base_quantity*case when l.kind='dispatch' then 1 else -1 end from public.billing_sales_fulfillment_lines l join public.billing_sales_fulfillment_events e on e.id=l.event_id where l.order_line_id=source_line
$$;
create function public.billing_sales_invoice_movements(source_line uuid) returns table(date date,quantity numeric) language sql stable security definer set search_path='' as $$
 select c.date,l.quantity from public.billing_sales_conversion_lines l join public.billing_sales_document_conversions c on c.id=l.conversion_id where l.order_line_id=source_line and c.kind in ('invoice','gst-invoice','commercial-invoice')
 union all select a.date,-l.quantity from public.billing_sales_conversion_lines l join public.billing_sales_document_conversions c on c.id=l.conversion_id join public.billing_sales_conversion_abandonments a on a.conversion_id=c.id where l.order_line_id=source_line and c.kind in ('invoice','gst-invoice','commercial-invoice')
 union all select x.date,-l.quantity from public.billing_sales_conversion_lines l join public.billing_sales_document_conversions c on c.id=l.conversion_id join public.billing_document_cancellations x on x.document_id=c.document_id where l.order_line_id=source_line and c.kind in ('invoice','gst-invoice','commercial-invoice')
 union all select i.date,-l.quantity from public.billing_sales_conversion_lines l join public.billing_sales_document_conversions c on c.id=l.conversion_id join public.billing_issued_documents i on i.document_id=c.document_id where l.order_line_id=source_line and c.kind='credit-note'
 union all select x.date,l.quantity from public.billing_sales_conversion_lines l join public.billing_sales_document_conversions c on c.id=l.conversion_id join public.billing_document_cancellations x on x.document_id=c.document_id where l.order_line_id=source_line and c.kind='credit-note'
$$;
create function public.billing_sales_validate_line(source_line uuid) returns void language plpgsql security definer set search_path='' as $$
declare source public.billing_sales_order_lines;
begin
 select * into source from public.billing_sales_order_lines where id=source_line;
 if source.id is null then raise exception 'Frozen order line unavailable';end if;
 if exists(select 1 from(select sum(sum(quantity)) over(order by date) q,sum(sum(base_quantity)) over(order by date) base from public.billing_sales_fulfillment_movements(source_line) group by date)x where q<0 or q>source.quantity or base<0 or base>source.base_quantity) then raise exception 'Dispatch/return exceeds the order source quantity at an effective date';end if;
 if exists(select 1 from(select sum(sum(quantity)) over(order by date) q from public.billing_sales_invoice_movements(source_line) group by date)x where q<0 or q>source.quantity) then raise exception 'Invoice conversion exceeds the order source quantity at an effective date';end if;
end$$;

-- Canonical inventory callbacks, never directly callable by authenticated users.
create function public.billing_sales_inventory_source(business uuid,data_mode boolean,order_line_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare line public.billing_sales_order_lines;source public.billing_sales_orders;
begin
 select * into line from public.billing_sales_order_lines l where l.id=order_line_id and l.business_id=business and l.demo=data_mode;
 select * into source from public.billing_sales_orders where id=line.order_id and status='issued';
 if line.id is null or source.id is null then raise exception 'Choose an active issued sales-order source line in this business and data mode';end if;
 return jsonb_build_object('itemId',line.item_id,'unitId',line.unit_id,'factor',line.unit_factor::text,'baseQuantity',line.base_quantity::text,'date',source.date,'snapshot',line.snapshot||jsonb_build_object('orderId',source.id,'orderNumber',source.number,'sourceLineId',line.id));
end$$;
create function public.billing_sales_inventory_authorize(fulfillment_line_id uuid,business uuid,data_mode boolean,item_id uuid,order_line_id uuid,warehouse_id uuid,kind text,base_qty numeric,effective_date date) returns void language plpgsql stable security definer set search_path='' as $$
declare line public.billing_sales_fulfillment_lines;event public.billing_sales_fulfillment_events;source public.billing_sales_order_lines;
begin
 select * into line from public.billing_sales_fulfillment_lines l where l.id=fulfillment_line_id and l.business_id=business and l.demo=data_mode;
 select * into event from public.billing_sales_fulfillment_events where id=line.event_id;
 select * into source from public.billing_sales_order_lines where id=line.order_line_id;
 if line.id is null or source.id is null or source.item_id<>item_id or line.order_line_id<>order_line_id or line.warehouse_id is distinct from warehouse_id or event.date<>effective_date or base_qty<=0 or base_qty>line.base_quantity or kind<>(case when line.kind='dispatch' then 'dispatch' else 'customer-return' end) or source.snapshot->'itemSnapshot'->>'kind'<>'stock' then raise exception 'Inventory move differs from its immutable sales fulfillment authority';end if;
 if coalesce((select sum(abs(m.quantity)) from public.billing_inventory_movements m where m.fulfillment_line=line.id),0)+base_qty>line.base_quantity then raise exception 'Inventory source authority has no remaining fulfillment quantity';end if;
 perform public.billing_sales_validate_line(source.id);
end$$;

create function public.billing_sales_invoice_components(source_line uuid) returns table(date date,quantity numeric,components jsonb,sign integer) language sql stable security definer set search_path='' as $$
 select c.date,l.quantity,l.source_allocation->'components',1 from public.billing_sales_conversion_lines l join public.billing_sales_document_conversions c on c.id=l.conversion_id where l.order_line_id=source_line and c.kind in ('invoice','gst-invoice','commercial-invoice')
 union all select a.date,-l.quantity,l.source_allocation->'components',-1 from public.billing_sales_conversion_lines l join public.billing_sales_document_conversions c on c.id=l.conversion_id join public.billing_sales_conversion_abandonments a on a.conversion_id=c.id where l.order_line_id=source_line and c.kind in ('invoice','gst-invoice','commercial-invoice')
 union all select x.date,-l.quantity,l.source_allocation->'components',-1 from public.billing_sales_conversion_lines l join public.billing_sales_document_conversions c on c.id=l.conversion_id join public.billing_document_cancellations x on x.document_id=c.document_id where l.order_line_id=source_line and c.kind in ('invoice','gst-invoice','commercial-invoice')
 union all select i.date,-l.quantity,l.source_allocation->'components',-1 from public.billing_sales_conversion_lines l join public.billing_sales_document_conversions c on c.id=l.conversion_id join public.billing_issued_documents i on i.document_id=c.document_id where l.order_line_id=source_line and c.kind='credit-note'
 union all select x.date,l.quantity,l.source_allocation->'components',1 from public.billing_sales_conversion_lines l join public.billing_sales_document_conversions c on c.id=l.conversion_id join public.billing_document_cancellations x on x.document_id=c.document_id where l.order_line_id=source_line and c.kind='credit-note'
$$;
create function public.billing_sales_conversion_reservations(source_invoice uuid,fulfillment uuid,target_kind text) returns table(date date,quantity numeric,components jsonb,sign integer) language sql stable security definer set search_path='' as $$
 select c.date,l.quantity,l.source_allocation->'components',1 from public.billing_sales_conversion_lines l join public.billing_sales_document_conversions c on c.id=l.conversion_id where (target_kind='credit-note' and c.kind='credit-note' and l.source_invoice_line_id=source_invoice) or (target_kind='delivery-challan' and c.kind='delivery-challan' and l.fulfillment_line_id=fulfillment)
 union all select a.date,-l.quantity,l.source_allocation->'components',-1 from public.billing_sales_conversion_lines l join public.billing_sales_document_conversions c on c.id=l.conversion_id join public.billing_sales_conversion_abandonments a on a.conversion_id=c.id where (target_kind='credit-note' and c.kind='credit-note' and l.source_invoice_line_id=source_invoice) or (target_kind='delivery-challan' and c.kind='delivery-challan' and l.fulfillment_line_id=fulfillment)
 union all select x.date,-l.quantity,l.source_allocation->'components',-1 from public.billing_sales_conversion_lines l join public.billing_sales_document_conversions c on c.id=l.conversion_id join public.billing_document_cancellations x on x.document_id=c.document_id where (target_kind='credit-note' and c.kind='credit-note' and l.source_invoice_line_id=source_invoice) or (target_kind='delivery-challan' and c.kind='delivery-challan' and l.fulfillment_line_id=fulfillment)
$$;
create function public.billing_sales_allocation_basis(order_line uuid,source_invoice uuid,fulfillment uuid,target_kind text,target_date date,quantity numeric,conversion_line uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare source public.billing_sales_order_lines;original public.billing_sales_conversion_lines;dispatch public.billing_sales_fulfillment_lines;source_qty numeric;before_qty numeric;totals jsonb;allocated jsonb='{}';parts jsonb='{}';key text;prior numeric;full_value numeric;after_qty numeric;value numeric;source_id uuid;
begin
 select * into source from public.billing_sales_order_lines where id=order_line;
 if source.id is null then raise exception 'Frozen order line unavailable for allocation';end if;
 if target_kind='credit-note' then
  select * into original from public.billing_sales_conversion_lines where id=source_invoice and order_line_id=source.id;
  if original.id is null then raise exception 'Choose an original invoice conversion line for credit';end if;source_qty=original.quantity;totals=original.source_allocation->'components';source_id=original.id;
 elsif target_kind='delivery-challan' then
  select * into dispatch from public.billing_sales_fulfillment_lines f where f.id=fulfillment and f.order_line_id=source.id and f.kind='dispatch';
  if dispatch.id is null then raise exception 'Choose an actual dispatch line before generating its challan';end if;source_qty=dispatch.quantity;totals='{"taxable":"0","discount":"0","cgst":"0","sgst":"0","igst":"0","vat":"0","cess":"0"}';source_id=dispatch.id;
 else source_qty=source.quantity;totals=source.source_totals;source_id=source.id;end if;
 if target_kind in ('credit-note','delivery-challan') then
  select coalesce(max(q),0) into before_qty from(select m.date,sum(sum(m.quantity)) over(order by m.date) q from public.billing_sales_conversion_reservations(source_invoice,fulfillment,target_kind)m group by m.date)x where date>=target_date;
  before_qty=greatest(before_qty,coalesce((select sum(m.quantity) from public.billing_sales_conversion_reservations(source_invoice,fulfillment,target_kind)m where m.date<=target_date),0));
 else
  select coalesce(max(q),0) into before_qty from(select m.date,sum(sum(m.quantity)) over(order by m.date) q from public.billing_sales_invoice_components(source.id)m group by m.date)x where date>=target_date;
  before_qty=greatest(before_qty,coalesce((select sum(m.quantity) from public.billing_sales_invoice_components(source.id)m where m.date<=target_date),0));
 end if;
 after_qty=before_qty+quantity;if before_qty<0 or after_qty>source_qty then raise exception 'Conversion exceeds source quantity across an affected effective-date prefix';end if;
 foreach key in array array['taxable','discount','cgst','sgst','igst','vat','cess'] loop
  if target_kind in ('credit-note','delivery-challan') then
   select coalesce(max(amount),0) into prior from(select date,sum(sum((components->>key)::numeric*sign)) over(order by date) amount from public.billing_sales_conversion_reservations(source_invoice,fulfillment,target_kind) group by date)x where date>=target_date;
   prior=greatest(prior,coalesce((select sum((m.components->>key)::numeric*m.sign) from public.billing_sales_conversion_reservations(source_invoice,fulfillment,target_kind)m where m.date<=target_date),0));
  else
   select coalesce(max(amount),0) into prior from(select date,sum(sum((components->>key)::numeric*sign)) over(order by date) amount from public.billing_sales_invoice_components(source.id) group by date)x where date>=target_date;
   prior=greatest(prior,coalesce((select sum((m.components->>key)::numeric*m.sign) from public.billing_sales_invoice_components(source.id)m where m.date<=target_date),0));
  end if;
  full_value=(totals->>key)::numeric;if prior<0 or prior>full_value then raise exception 'Existing source allocation components need review before conversion';end if;
  value=case when after_qty=source_qty then full_value-prior else greatest(0,least(full_value-prior,div(full_value*after_qty*2+source_qty,source_qty*2)-prior)) end;
  allocated=allocated||jsonb_build_object(key,prior::text);parts=parts||jsonb_build_object(key,value::text);
 end loop;
 return jsonb_build_object('version',1,'policy','cumulative-proportion-final-residual','sourceLineId',source_id,'conversionLineId',conversion_line,'sourceQuantity',source_qty::numeric(24,6)::text,'quantityBefore',before_qty::numeric(24,6)::text,'quantityAfter',after_qty::numeric(24,6)::text,'sourceTotals',totals,'allocatedBefore',allocated,'components',parts,'reviewed',true,'allocationBasis','max-effective-prefix-from-target-date');
end$$;

create function public.billing_sales_validate_value_caps(source_line uuid) returns void language plpgsql security definer set search_path='' as $$
declare source public.billing_sales_order_lines;key text;full_value numeric;original public.billing_sales_conversion_lines;dispatch public.billing_sales_fulfillment_lines;source_qty numeric;
begin
 perform public.billing_sales_validate_line(source_line);select * into source from public.billing_sales_order_lines where id=source_line;
 foreach key in array array['taxable','discount','cgst','sgst','igst','vat','cess'] loop
  full_value=(source.source_totals->>key)::numeric;
  if exists(select 1 from(select sum(sum((components->>key)::numeric*sign)) over(order by date) amount from public.billing_sales_invoice_components(source_line) group by date)x where amount<0 or amount>full_value) then raise exception 'Fiscal conversion exceeds a frozen source monetary component at an effective date';end if;
 end loop;
 for original in select l.* from public.billing_sales_conversion_lines l join public.billing_sales_document_conversions c on c.id=l.conversion_id where l.order_line_id=source_line and c.kind in ('invoice','gst-invoice','commercial-invoice') loop
  if exists(select 1 from(select sum(sum(quantity)) over(order by date) quantity from public.billing_sales_conversion_reservations(original.id,null,'credit-note') group by date)x where quantity<0 or quantity>original.quantity) then raise exception 'Credit-note conversion exceeds its original invoice-line quantity at an effective date';end if;
  foreach key in array array['taxable','discount','cgst','sgst','igst','vat','cess'] loop
   full_value=(original.source_allocation->'components'->>key)::numeric;
   if exists(select 1 from(select sum(sum((components->>key)::numeric*sign)) over(order by date) amount from public.billing_sales_conversion_reservations(original.id,null,'credit-note') group by date)x where amount<0 or amount>full_value) then raise exception 'Credit-note conversion exceeds its original invoice monetary component';end if;
  end loop;
 end loop;
 for dispatch in select * from public.billing_sales_fulfillment_lines where order_line_id=source_line and kind='dispatch' loop
  if exists(select 1 from(select sum(sum(quantity)) over(order by date) quantity from public.billing_sales_conversion_reservations(null,dispatch.id,'delivery-challan') group by date)x where quantity<0 or quantity>dispatch.quantity) then raise exception 'Delivery challan exceeds its physical dispatch source quantity';end if;
  if exists(select 1 from(select sum(sum(quantity)) over(order by date) quantity from public.billing_sales_fulfillment_invoice_movements(dispatch.id) group by date)x where quantity<0 or quantity>dispatch.quantity) then raise exception 'Linked invoice exceeds its physical dispatch source quantity';end if;
 end loop;
end$$;

create function public.billing_sales_document_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare conversion public.billing_sales_document_conversions;expected jsonb;projection jsonb;editable text[]=array['notes','terms','template','brandColor','logo','signature','customFields','bank','transport'];
begin
 if new.collection<>'documents' then return new;end if;
 select * into conversion from public.billing_sales_document_conversions c where c.document_id=new.id and c.business_id=new.business_id and c.demo=new.demo;
 if conversion.id is null then
  if new.data?'orderConversion' or exists(select 1 from jsonb_array_elements(coalesce(new.data->'items','[]'::jsonb))i where i?'sourceAllocation') then raise exception 'Source allocation metadata requires its immutable sales conversion authority';end if;
  if new.data->>'type'='credit-note' and exists(select 1 from public.billing_sales_document_conversions c where c.document_id=(new.data->>'originalDocumentId')::uuid) then raise exception 'Use the sales conversion command to credit a linked invoice without losing source quantities';end if;
  return new;
 end if;
 if new.created_by<>conversion.actor_id and tg_op='INSERT' then raise exception 'Converted document actor differs from its source authority';end if;
 if tg_op='UPDATE' and old.archived then raise exception 'An abandoned converted draft cannot be reopened';end if;
 projection=public.billing_document_projection(new.id);
 if projection is not null then
  if new.archived or new.data<>projection then raise exception 'Issued converted snapshots can change only through their typed lifecycle commands';end if;
 else
  expected=conversion.expected_data||public.billing_document_totals(conversion.expected_data);
  if new.data->>'status'<>'draft' or (new.data-editable) is distinct from (expected-editable) then raise exception 'Converted draft financial fields and source-line identities are frozen; adjust the source before generating a replacement';end if;
  if new.archived and not exists(select 1 from public.billing_sales_conversion_abandonments a where a.conversion_id=conversion.id) then raise exception 'Abandon converted drafts through their dated source command';end if;
 end if;
 return new;
end$$;
create trigger billing_89_sales_conversion_guard before insert or update on public.billing_records for each row execute function public.billing_sales_document_guard();

create function public.billing_sales_document_event_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare conversion public.billing_sales_document_conversions;line public.billing_sales_conversion_lines;
begin
 select * into conversion from public.billing_sales_document_conversions c where c.document_id=new.document_id;
 if conversion.id is null then return new;end if;
 for line in select * from public.billing_sales_conversion_lines where conversion_id=conversion.id loop perform public.billing_sales_validate_value_caps(line.order_line_id);end loop;
 return new;
end$$;
create trigger sales_conversion_issued after insert on public.billing_issued_documents for each row execute function public.billing_sales_document_event_guard();
create trigger sales_conversion_cancelled after insert on public.billing_document_cancellations for each row execute function public.billing_sales_document_event_guard();

create function public.billing_sales_fulfillment_invoice_movements(fulfillment uuid) returns table(date date,quantity numeric) language sql stable security definer set search_path='' as $$
 select c.date,l.quantity from public.billing_sales_conversion_lines l join public.billing_sales_document_conversions c on c.id=l.conversion_id where l.fulfillment_line_id=fulfillment and c.kind in ('invoice','gst-invoice','commercial-invoice')
 union all select a.date,-l.quantity from public.billing_sales_conversion_lines l join public.billing_sales_document_conversions c on c.id=l.conversion_id join public.billing_sales_conversion_abandonments a on a.conversion_id=c.id where l.fulfillment_line_id=fulfillment and c.kind in ('invoice','gst-invoice','commercial-invoice')
 union all select x.date,-l.quantity from public.billing_sales_conversion_lines l join public.billing_sales_document_conversions c on c.id=l.conversion_id join public.billing_document_cancellations x on x.document_id=c.document_id where l.fulfillment_line_id=fulfillment and c.kind in ('invoice','gst-invoice','commercial-invoice')
 union all select i.date,-l.quantity from public.billing_sales_conversion_lines l join public.billing_sales_document_conversions c on c.id=l.conversion_id join public.billing_issued_documents i on i.document_id=c.document_id where l.fulfillment_line_id=fulfillment and c.kind='credit-note'
 union all select x.date,l.quantity from public.billing_sales_conversion_lines l join public.billing_sales_document_conversions c on c.id=l.conversion_id join public.billing_document_cancellations x on x.document_id=c.document_id where l.fulfillment_line_id=fulfillment and c.kind='credit-note'
$$;

create function public.billing_sales_convert(business uuid,data_mode boolean,command_id uuid,conversion_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.billing_sales_order_commands;source public.billing_sales_order_lines;order_row public.billing_sales_orders;first_order public.billing_sales_orders;original public.billing_sales_conversion_lines;original_doc public.billing_issued_documents;dispatch public.billing_sales_fulfillment_lines;dispatch_event public.billing_sales_fulfillment_events;
 request jsonb;result jsonb;part jsonb;items jsonb='[]';authority_rows jsonb='[]';allocation jsonb;item jsonb;document_data jsonb;created public.billing_records;document_id uuid=gen_random_uuid();conversion_id uuid=gen_random_uuid();line_id uuid;source_invoice uuid;fulfillment uuid;day date;due date;kind text;q numeric;source_ids uuid[]='{}';source_key text;keys text[]='{}';number text;reason text;
begin
 if auth.uid() is null or not public.billing_can_access(business,true) then raise exception using errcode='42501',message='Your role cannot convert sales order lines';end if;
 if data_mode is null or command_id is null or jsonb_typeof(conversion_data) is distinct from 'object' or conversion_data-array['kind','date','dueDate','lines','allocationReviewed','reason']<>'{}'::jsonb or conversion_data->'allocationReviewed' is distinct from 'true'::jsonb then raise exception 'Review explicit source lines and cumulative component allocation before conversion';end if;
 request=jsonb_build_object('action','convert','data',conversion_data);
 select * into prior from public.billing_sales_order_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_sales_convert.command_id;
 if prior.command_id is not null then if prior.actor_id<>auth.uid() or prior.request<>request then raise exception using errcode='40001',message='Retry key was used for a different sales conversion';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 kind=conversion_data->>'kind';if kind is null or kind not in ('invoice','gst-invoice','commercial-invoice','delivery-challan','credit-note') then raise exception 'Choose an invoice, delivery challan or credit-note conversion';end if;
 if jsonb_typeof(conversion_data->'lines') is distinct from 'array' or jsonb_array_length(conversion_data->'lines') not between 1 and 1000 then raise exception 'Convert 1 to 1,000 explicit source lines';end if;
 for part in select value from jsonb_array_elements(conversion_data->'lines') loop
  if jsonb_typeof(part) is distinct from 'object' or part-array['orderLineId','orderVersion','quantity','sourceInvoiceLineId','fulfillmentLineId']<>'{}'::jsonb or coalesce(part->>'orderLineId','')!~'^[0-9a-fA-F-]{36}$' or coalesce(part->>'orderVersion','')!~'^[1-9][0-9]{0,8}$' then raise exception 'Each conversion needs a frozen order line, reviewed order version and exact quantity';end if;
  if kind='credit-note' then
   if coalesce(part->>'sourceInvoiceLineId','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'Credit conversion must identify each original invoice conversion line';end if;
  end if;
 end loop;
 if kind='credit-note' then perform 1 from public.billing_records r where r.id in(select c.document_id from jsonb_array_elements(conversion_data->'lines') x join public.billing_sales_conversion_lines l on l.id=(x->>'sourceInvoiceLineId')::uuid join public.billing_sales_document_conversions c on c.id=l.conversion_id) and r.business_id=business and r.demo=data_mode and r.collection='documents' order by r.id for update;end if;
 perform public.billing_ledger_writer_lock(business,false);
 select * into prior from public.billing_sales_order_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_sales_convert.command_id;
 if prior.command_id is not null then if prior.actor_id<>auth.uid() or prior.request<>request then raise exception using errcode='40001',message='Retry key was used for a different sales conversion';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 day=public.billing_payment_date(conversion_data->'date');if kind='credit-note' then due=null;reason=btrim(conversion_data->>'reason');if jsonb_typeof(conversion_data->'reason') is distinct from 'string' or length(reason) not between 1 and 1000 then raise exception 'Review the credit-note conversion reason';end if;else due=public.billing_payment_date(conversion_data->'dueDate');if due<day then raise exception 'Converted document due date cannot precede its date';end if;end if;
 for part in select value from jsonb_array_elements(conversion_data->'lines') loop
  select * into source from public.billing_sales_order_lines l where l.id=(part->>'orderLineId')::uuid and l.business_id=business and l.demo=data_mode;
  select * into order_row from public.billing_sales_orders where id=source.order_id and status='issued';
  if source.id is null or order_row.id is null then raise exception 'Choose an active issued order line in this business and data mode';end if;
  if order_row.version<>(part->>'orderVersion')::integer then raise exception using errcode='40001',message='Source order changed; reload before converting';end if;
  if day<order_row.date then raise exception 'Converted documents cannot predate their commercial order';end if;
  if first_order.id is null then first_order=order_row;elsif first_order.client_id<>order_row.client_id or first_order.currency<>order_row.currency or first_order.data->'customer'<>order_row.data->'customer' or first_order.data->'business'<>order_row.data->'business' or first_order.data->>'taxType'<>order_row.data->>'taxType' or first_order.data->>'gstMode'<>order_row.data->>'gstMode' then raise exception 'Bulk conversion requires identical frozen customer, business, currency and tax context; split incompatible orders';end if;
  q=public.billing_sales_quantity(part->'quantity');source_invoice=null;fulfillment=null;original=null;
  if kind='credit-note' then
   select * into original from public.billing_sales_conversion_lines l where l.id=(part->>'sourceInvoiceLineId')::uuid and l.order_line_id=source.id and l.business_id=business and l.demo=data_mode;
   select * into original_doc from public.billing_issued_documents i where i.document_id=(select c.document_id from public.billing_sales_document_conversions c where c.id=original.conversion_id and c.kind in ('invoice','gst-invoice','commercial-invoice'));
   if original.id is null or original_doc.document_id is null or exists(select 1 from public.billing_document_cancellations x where x.document_id=original_doc.document_id) or day<original_doc.date then raise exception 'Choose a current frozen issued source invoice on or before the credit date';end if;
   if items<>'[]'::jsonb and document_data->>'originalDocumentId' is distinct from original_doc.document_id::text then raise exception 'One credit note cannot combine different parent invoices';end if;
   source_invoice=original.id;fulfillment=original.fulfillment_line_id;document_data=jsonb_build_object('originalDocumentId',original_doc.document_id,'originalDocumentNumber',original_doc.number,'originalDocumentDate',original_doc.date,'adjustmentReason',reason);
  elsif part?'fulfillmentLineId' then
   if coalesce(part->>'fulfillmentLineId','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'Choose an immutable dispatch line when linking a fulfillment';end if;fulfillment=(part->>'fulfillmentLineId')::uuid;
  end if;
  if kind='delivery-challan' and fulfillment is null then raise exception 'A delivery challan must identify its actual dispatch source lines';end if;
  if fulfillment is not null then
   select * into dispatch from public.billing_sales_fulfillment_lines f where f.id=fulfillment and f.order_line_id=source.id and f.kind='dispatch';select * into dispatch_event from public.billing_sales_fulfillment_events where id=dispatch.event_id;
   if dispatch.id is null or day<dispatch_event.date then raise exception 'Document conversion must match an existing dispatch on or before its date';end if;
  end if;
  source_key=case when kind='credit-note' then source_invoice::text when kind='delivery-challan' then fulfillment::text else source.id::text end;
  if source_key=any(keys) then raise exception 'Select each fiscal source line once per target document';end if;keys=array_append(keys,source_key);source_ids=array_append(source_ids,source.id);
  line_id=gen_random_uuid();allocation=public.billing_sales_allocation_basis(source.id,source_invoice,fulfillment,kind,day,q,line_id);
  item=(source.snapshot-array['itemSnapshot','unitSnapshot','unitFactor','baseQuantity'])||jsonb_build_object('id',line_id,'quantity',q::numeric(24,6)::text,'itemId',source.item_id,'unitId',source.unit_id,'sourceOrderId',order_row.id,'sourceOrderLineId',source.id,'sourceAllocation',allocation);
  if fulfillment is not null then item=item||jsonb_build_object('fulfillmentLineId',fulfillment);end if;
  if source_invoice is not null then item=item||jsonb_build_object('sourceInvoiceLineId',source_invoice);end if;
  if kind='delivery-challan' then item=item||jsonb_build_object('taxRate','0','cessRate','0','discount','0','discountType','fixed');end if;
  items=items||jsonb_build_array(item);authority_rows=authority_rows||jsonb_build_array(jsonb_build_object('id',line_id,'sourceOrderLineId',source.id,'sourceInvoiceLineId',source_invoice,'fulfillmentLineId',fulfillment,'quantity',q::numeric(24,6)::text,'sourceAllocation',allocation,'snapshot',item));
 end loop;
 number=(case kind when 'credit-note' then 'CN-' when 'delivery-challan' then 'DC-' else '' end)||public.billing_next_document_number(business);
 document_data=coalesce(document_data,'{}'::jsonb)||jsonb_build_object('type',kind,'number',number,'status','draft','date',day,'dueDate',coalesce(due::text,''),'currency',first_order.currency,'seller',first_order.data->'business','buyer',first_order.data->'customer','clientId',first_order.client_id,'items',items,'taxType',case when kind='delivery-challan' then 'NONE' else first_order.data->>'taxType' end,'gstMode',first_order.data->>'gstMode','shipping',jsonb_build_object('amount','0'),'roundOff',false,'notes',first_order.data->>'notes','terms','','orderConversion',jsonb_build_object('version',1,'conversionId',conversion_id,'kind',kind,'policy','cumulative-proportion-final-residual'));
 document_data=document_data||public.billing_document_totals(document_data);
 insert into public.billing_sales_document_conversions(id,business_id,demo,document_id,kind,date,expected_data,actor_id) values(conversion_id,business,data_mode,document_id,kind,day,document_data,auth.uid());
 for part in select value from jsonb_array_elements(authority_rows) loop
  insert into public.billing_sales_conversion_lines(id,business_id,demo,conversion_id,order_line_id,source_invoice_line_id,fulfillment_line_id,quantity,source_allocation,snapshot) values((part->>'id')::uuid,business,data_mode,conversion_id,(part->>'sourceOrderLineId')::uuid,(part->>'sourceInvoiceLineId')::uuid,(part->>'fulfillmentLineId')::uuid,(part->>'quantity')::numeric,part->'sourceAllocation',part->'snapshot');
 end loop;
 foreach line_id in array source_ids loop perform public.billing_sales_validate_value_caps(line_id);end loop;
 insert into public.billing_records(id,business_id,collection,data,demo,created_by) values(document_id,business,'documents',document_data,data_mode,auth.uid()) returning * into created;
 result=jsonb_build_object('record',to_jsonb(created),'conversionId',conversion_id,'replayed',false);
 insert into public.billing_sales_order_commands(business_id,demo,command_id,actor_id,request,result) values(business,data_mode,command_id,auth.uid(),request,result);
 insert into public.billing_ledger_audit(business_id,demo,actor_id,action,details) values(business,data_mode,auth.uid(),'sales-order.document-converted',jsonb_build_object('conversionId',conversion_id,'documentId',document_id,'sourceLineIds',to_jsonb(source_ids)));
 insert into public.billing_sales_order_outbox(business_id,demo,command_id,topic,payload) values(business,data_mode,command_id,'sales-order.document-converted',result);return result;
end$$;

create table public.billing_sales_fulfillment_stock(
 fulfillment_line_id uuid primary key,business_id uuid not null,demo boolean not null,result jsonb not null,
 foreign key(fulfillment_line_id,business_id,demo) references public.billing_sales_fulfillment_lines(id,business_id,demo)
);
alter table public.billing_sales_fulfillment_stock enable row level security;
revoke all on public.billing_sales_fulfillment_stock from public,anon,authenticated;grant select on public.billing_sales_fulfillment_stock to authenticated;
create policy sales_fulfillment_stock_read on public.billing_sales_fulfillment_stock for select to authenticated using(public.billing_can_access(business_id));
create trigger sales_fulfillment_stock_immutable before update or delete on public.billing_sales_fulfillment_stock for each row execute function public.billing_ledger_immutable();

create function public.billing_sales_fulfill(business uuid,data_mode boolean,command_id uuid,fulfillment_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.billing_sales_order_commands;source public.billing_sales_order_lines;order_row public.billing_sales_orders;original public.billing_sales_fulfillment_lines;original_event public.billing_sales_fulfillment_events;event public.billing_sales_fulfillment_events;
 request jsonb;result jsonb;part jsonb;stock jsonb;rows jsonb='[]';line_id uuid;q numeric;base numeric;day date;kind text;warehouse uuid;returns uuid;reference text;reason text;already_returned numeric;
begin
 if auth.uid() is null or not public.billing_can_access(business,true) then raise exception using errcode='42501',message='Your role cannot record sales fulfillment';end if;
 if data_mode is null or command_id is null or jsonb_typeof(fulfillment_data) is distinct from 'object' or fulfillment_data-array['kind','date','reference','reason','lines','movementConfirmed']<>'{}'::jsonb or fulfillment_data->'movementConfirmed' is distinct from 'true'::jsonb then raise exception 'Confirm the actual dispatch/return record and its source quantities';end if;
 request=jsonb_build_object('action','fulfill','data',fulfillment_data);
 select * into prior from public.billing_sales_order_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_sales_fulfill.command_id;
 if prior.command_id is not null then if prior.actor_id<>auth.uid() or prior.request<>request then raise exception using errcode='40001',message='Retry key was used for a different fulfillment';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 perform public.billing_ledger_writer_lock(business,false);
 select * into prior from public.billing_sales_order_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_sales_fulfill.command_id;
 if prior.command_id is not null then if prior.actor_id<>auth.uid() or prior.request<>request then raise exception using errcode='40001',message='Retry key was used for a different fulfillment';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 kind=fulfillment_data->>'kind';day=public.billing_payment_date(fulfillment_data->'date');reference=fulfillment_data->>'reference';reason=fulfillment_data->>'reason';
 if kind is null or kind not in ('dispatch','return') or jsonb_typeof(fulfillment_data->'reference') is distinct from 'string' or length(reference)>180 or jsonb_typeof(fulfillment_data->'reason') is distinct from 'string' or length(btrim(reason)) not between 1 and 1000 or day>(select (now() at time zone time_zone)::date from public.billing_businesses where id=business) then raise exception 'Review actual fulfillment direction, business-local date, reference and reason';end if;
 if jsonb_typeof(fulfillment_data->'lines') is distinct from 'array' or jsonb_array_length(fulfillment_data->'lines') not between 1 and 1000 then raise exception 'Record 1 to 1,000 explicit fulfillment lines';end if;
 insert into public.billing_sales_fulfillment_events(id,business_id,demo,kind,date,reference,reason,actor_id) values(gen_random_uuid(),business,data_mode,kind,day,reference,reason,auth.uid()) returning * into event;
 for part in select value from jsonb_array_elements(fulfillment_data->'lines') loop
  if jsonb_typeof(part) is distinct from 'object' or part-array['orderLineId','orderVersion','quantity','warehouseId','batchCode','serials','returnsId']<>'{}'::jsonb or coalesce(part->>'orderLineId','')!~'^[0-9a-fA-F-]{36}$' or coalesce(part->>'orderVersion','')!~'^[1-9][0-9]{0,8}$' then raise exception 'Each fulfillment line needs explicit order identity, version and quantity';end if;
  select * into source from public.billing_sales_order_lines l where l.id=(part->>'orderLineId')::uuid and l.business_id=business and l.demo=data_mode;
  select * into order_row from public.billing_sales_orders where id=source.order_id and status='issued';
  if source.id is null or order_row.id is null or day<order_row.date then raise exception 'Choose an active issued order line on or before the actual fulfillment date';end if;
  if order_row.version<>(part->>'orderVersion')::integer then raise exception using errcode='40001',message='Source order changed; reload fulfillment quantities';end if;
  q=public.billing_sales_quantity(part->'quantity');base=q*source.unit_factor;if base<>round(base,6) or base<=0 then raise exception 'Fulfillment quantity cannot preserve the frozen base-unit conversion';end if;
  returns=null;warehouse=null;stock=null;
  if kind='return' then
   if coalesce(part->>'returnsId','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'A return must identify its original dispatch line';end if;
   select * into original from public.billing_sales_fulfillment_lines l where l.id=(part->>'returnsId')::uuid and l.business_id=business and l.demo=data_mode and l.order_line_id=source.id and l.kind='dispatch';
   select * into original_event from public.billing_sales_fulfillment_events where id=original.event_id;
   if original.id is null or day<original_event.date then raise exception 'Choose an original dispatch line on or before the return date';end if;
   select coalesce(sum(l.quantity),0) into already_returned from public.billing_sales_fulfillment_lines l where l.returns_id=original.id;
   if q>original.quantity-already_returned then raise exception 'Return quantity exceeds the remaining original dispatch';end if;returns=original.id;
  elsif part?'returnsId' and part->'returnsId'<>'null'::jsonb then raise exception 'Dispatch cannot claim a return source';end if;
  if source.snapshot->'itemSnapshot'->>'kind'='stock' then
   if coalesce(part->>'warehouseId','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'Choose a warehouse for stock fulfillment';end if;warehouse=(part->>'warehouseId')::uuid;
  elsif coalesce(part->>'warehouseId','')<>'' or coalesce(part->>'batchCode','')<>'' or coalesce(part->'serials','[]'::jsonb)<>'[]'::jsonb then raise exception 'Services do not move warehouse, batch or serial stock';end if;
  line_id=gen_random_uuid();
  insert into public.billing_sales_fulfillment_lines(id,business_id,demo,event_id,order_line_id,kind,returns_id,quantity,base_quantity,warehouse_id,batch_code,serials,snapshot) values(line_id,business,data_mode,event.id,source.id,kind,returns,q,base,warehouse,part->>'batchCode',coalesce(part->'serials','[]'::jsonb),source.snapshot||jsonb_build_object('orderId',order_row.id,'orderNumber',order_row.number,'orderLineId',source.id,'stockHandled',source.snapshot->'itemSnapshot'->>'kind'='stock'));
  perform public.billing_sales_validate_line(source.id);
  if source.snapshot->'itemSnapshot'->>'kind'='stock' then
   stock=public.billing_inventory_fulfill(business,data_mode,line_id,line_id,warehouse,case when kind='dispatch' then 'dispatch' else 'customer-return' end,jsonb_build_object('orderLineId',source.id,'itemId',source.item_id,'unitId',source.unit_id,'quantity',q::numeric(24,6)::text,'baseQuantity',base::numeric(24,6)::text,'batchCode',part->>'batchCode','serials',coalesce(part->'serials','[]'::jsonb),'returnsFulfillmentLineId',returns,'date',day,'reference',reference,'reason',reason));
   if stock is null or jsonb_typeof(stock) is distinct from 'object' then raise exception 'Inventory fulfillment confirmation was incomplete; no fulfillment was recorded';end if;
   insert into public.billing_sales_fulfillment_stock(fulfillment_line_id,business_id,demo,result) values(line_id,business,data_mode,stock);
  end if;
  rows=rows||jsonb_build_array(jsonb_build_object('id',line_id,'orderId',order_row.id,'orderLineId',source.id,'kind',kind,'returnsId',returns,'quantity',q::numeric(24,6)::text,'baseQuantity',base::numeric(24,6)::text,'warehouseId',warehouse,'inventory',stock));
 end loop;
 result=jsonb_build_object('event',to_jsonb(event),'lines',rows,'replayed',false);
 insert into public.billing_sales_order_commands(business_id,demo,command_id,actor_id,request,result) values(business,data_mode,command_id,auth.uid(),request,result);
 insert into public.billing_ledger_audit(business_id,demo,actor_id,action,details) values(business,data_mode,auth.uid(),'sales-order.'||kind,jsonb_build_object('eventId',event.id));
 insert into public.billing_sales_order_outbox(business_id,demo,command_id,topic,payload) values(business,data_mode,command_id,'sales-order.'||kind,result);return result;
end$$;

create function public.billing_sales_inventory_finalize(fulfillment_line_id uuid,business uuid,data_mode boolean) returns void language plpgsql stable security definer set search_path='' as $$
declare line public.billing_sales_fulfillment_lines;
begin
 select * into line from public.billing_sales_fulfillment_lines l where l.id=fulfillment_line_id and l.business_id=business and l.demo=data_mode;
 if line.id is null or coalesce((select sum(abs(m.quantity)) from public.billing_inventory_movements m where m.fulfillment_line=line.id),0)<>line.base_quantity then raise exception 'Inventory fulfillment must commit the entire immutable fulfillment authority in one command';end if;
end$$;

create function public.billing_sales_order_cancel(business uuid,data_mode boolean,order_id uuid,expected_version integer,command_id uuid,cancel_date date,reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.billing_sales_order_commands;source public.billing_sales_orders;line public.billing_sales_order_lines;request jsonb;result jsonb;
begin
 if auth.uid() is null or not public.billing_can_access(business,true) then raise exception using errcode='42501',message='Your role cannot cancel sales orders';end if;
 if data_mode is null or order_id is null or expected_version is null or expected_version<1 or command_id is null or cancel_date is null or not isfinite(cancel_date) or reason is null or length(btrim(reason)) not between 1 and 1000 then raise exception 'Choose a versioned issued order and dated cancellation reason';end if;
 request=jsonb_build_object('action','cancel','orderId',order_id,'version',expected_version,'date',cancel_date,'reason',reason);
 select * into prior from public.billing_sales_order_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_sales_order_cancel.command_id;
 if prior.command_id is not null then if prior.actor_id<>auth.uid() or prior.request<>request then raise exception using errcode='40001',message='Retry key was used for a different order cancellation';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 perform public.billing_ledger_writer_lock(business,false);
 select * into prior from public.billing_sales_order_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_sales_order_cancel.command_id;
 if prior.command_id is not null then if prior.actor_id<>auth.uid() or prior.request<>request then raise exception using errcode='40001',message='Retry key was used for a different order cancellation';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 select * into source from public.billing_sales_orders o where o.id=order_id and o.business_id=business and o.demo=data_mode for update;
 if source.id is null or source.status<>'issued' or cancel_date<source.date then raise exception 'Choose an active issued order on or before its cancellation date';end if;
 if source.version<>expected_version then raise exception using errcode='40001',message='Order state changed; reload before cancellation';end if;
 for line in select * from public.billing_sales_order_lines where public.billing_sales_order_lines.order_id=source.id loop
  if coalesce((select sum(m.quantity) from public.billing_sales_fulfillment_movements(line.id)m),0)<>0 or coalesce((select sum(m.quantity) from public.billing_sales_invoice_movements(line.id)m),0)<>0 or exists(select 1 from public.billing_sales_fulfillment_movements(line.id)m where m.date>cancel_date) or exists(select 1 from public.billing_sales_invoice_movements(line.id)m where m.date>cancel_date) then raise exception 'Return all fulfillment and correct/abandon every fiscal conversion first; order cancellation cannot predate corrections';end if;
 end loop;
 if exists(select 1 from public.billing_sales_document_conversions c join public.billing_sales_conversion_lines x on x.conversion_id=c.id join public.billing_sales_order_lines l on l.id=x.order_line_id where l.order_id=source.id and (c.date>cancel_date or not exists(select 1 from public.billing_sales_conversion_abandonments a where a.conversion_id=c.id and a.date<=cancel_date) and not exists(select 1 from public.billing_document_cancellations d where d.document_id=c.document_id and d.date<=cancel_date))) then raise exception 'Every linked fiscal document must be abandoned or cancelled before order cancellation';end if;
 insert into public.billing_sales_order_cancellations(id,business_id,demo,order_id,date,reason,actor_id) values(gen_random_uuid(),business,data_mode,source.id,cancel_date,reason,auth.uid());
 update public.billing_sales_orders set status='cancelled',cancelled_on=cancel_date,cancellation_reason=reason,version=version+1,updated_at=now() where id=source.id returning * into source;
 result=jsonb_build_object('order',to_jsonb(source),'replayed',false);
 insert into public.billing_sales_order_commands(business_id,demo,command_id,actor_id,request,result) values(business,data_mode,command_id,auth.uid(),request,result);
 insert into public.billing_ledger_audit(business_id,demo,actor_id,action,details) values(business,data_mode,auth.uid(),'sales-order.cancelled',jsonb_build_object('orderId',source.id,'date',cancel_date,'reason',reason));
 insert into public.billing_sales_order_outbox(business_id,demo,command_id,topic,payload) values(business,data_mode,command_id,'sales-order.cancelled',result);return result;
end$$;

create function public.billing_sales_conversion_abandon(business uuid,data_mode boolean,document_id uuid,expected_version integer,command_id uuid,release_date date,reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.billing_sales_order_commands;conversion public.billing_sales_document_conversions;source public.billing_records;line public.billing_sales_conversion_lines;request jsonb;result jsonb;
begin
 if auth.uid() is null or not public.billing_can_access(business,true) then raise exception using errcode='42501',message='Your role cannot abandon converted drafts';end if;
 if data_mode is null or document_id is null or expected_version is null or expected_version<1 or command_id is null or release_date is null or not isfinite(release_date) or reason is null or length(btrim(reason)) not between 1 and 1000 then raise exception 'Choose a versioned converted draft and reservation release date/reason';end if;
 request=jsonb_build_object('action','abandon','documentId',document_id,'version',expected_version,'date',release_date,'reason',reason);
 select * into prior from public.billing_sales_order_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_sales_conversion_abandon.command_id;
 if prior.command_id is not null then if prior.actor_id<>auth.uid() or prior.request<>request then raise exception using errcode='40001',message='Retry key was used for a different draft abandonment';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 select * into source from public.billing_records r where r.id=document_id and r.business_id=business and r.demo=data_mode and r.collection='documents' for update;
 if source.data->>'type'='credit-note' then perform 1 from public.billing_records where id=(source.data->>'originalDocumentId')::uuid for update;end if;
 perform public.billing_ledger_writer_lock(business,false);
 select * into prior from public.billing_sales_order_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_sales_conversion_abandon.command_id;
 if prior.command_id is not null then if prior.actor_id<>auth.uid() or prior.request<>request then raise exception using errcode='40001',message='Retry key was used for a different draft abandonment';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 select * into conversion from public.billing_sales_document_conversions c where c.document_id=source.id and c.business_id=business and c.demo=data_mode;
 if source.id is null or conversion.id is null or source.archived or source.data->>'status'<>'draft' or exists(select 1 from public.billing_issued_documents where public.billing_issued_documents.document_id=source.id) or release_date<conversion.date then raise exception 'Choose an active converted draft and release its reservation on/after the target effective date';end if;
 if source.version<>expected_version then raise exception using errcode='40001',message='Converted draft changed; reload before abandonment';end if;
 insert into public.billing_sales_conversion_abandonments(id,business_id,demo,conversion_id,date,reason,actor_id) values(gen_random_uuid(),business,data_mode,conversion.id,release_date,reason,auth.uid());
 for line in select * from public.billing_sales_conversion_lines where conversion_id=conversion.id loop perform public.billing_sales_validate_value_caps(line.order_line_id);end loop;
 update public.billing_records set archived=true where id=source.id returning * into source;
 result=jsonb_build_object('record',to_jsonb(source),'conversionId',conversion.id,'releaseDate',release_date,'replayed',false);
 insert into public.billing_sales_order_commands(business_id,demo,command_id,actor_id,request,result) values(business,data_mode,command_id,auth.uid(),request,result);
 insert into public.billing_ledger_audit(business_id,demo,actor_id,action,details) values(business,data_mode,auth.uid(),'sales-order.converted-draft-abandoned',jsonb_build_object('documentId',source.id,'date',release_date,'reason',reason));
 insert into public.billing_sales_order_outbox(business_id,demo,command_id,topic,payload) values(business,data_mode,command_id,'sales-order.converted-draft-abandoned',result);return result;
end$$;

create function public.billing_sales_order_read(business uuid,data_mode boolean,as_of date,order_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare source public.billing_sales_orders;orders jsonb;lines jsonb='[]';conversions jsonb='[]';fulfillment jsonb='[]';clients jsonb;items jsonb;units jsonb;warehouses jsonb;order_count bigint;item_count bigint;client_count bigint;warehouse_count bigint;
begin
 if auth.uid() is null or not public.billing_can_access(business) then raise exception using errcode='42501',message='Sales orders unavailable in this business';end if;
 if data_mode is null or as_of is null or not isfinite(as_of) then raise exception 'Choose a valid sales-order review date and data mode';end if;
 select count(*) into order_count from public.billing_sales_orders where business_id=business and demo=data_mode;
 select coalesce(jsonb_agg((to_jsonb(o)-'data')||jsonb_build_object('summary',jsonb_build_object('customer',coalesce(o.data->'customer',jsonb_build_object('name',p.data->>'name')),'reference',o.data->>'reference','dueDate',o.data->>'dueDate','totals',o.data->'totals','lineCount',jsonb_array_length(o.data->'lines'))) order by o.created_at desc,o.id desc),'[]'::jsonb) into orders from(select * from public.billing_sales_orders where business_id=business and demo=data_mode order by created_at desc,id desc limit 200)o left join public.billing_records p on p.id=o.client_id;
 select count(*) into client_count from public.billing_records where business_id=business and demo=data_mode and collection='clients' and not archived;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',data->>'name') order by data->>'name',id),'[]'::jsonb) into clients from(select id,data from public.billing_records where business_id=business and demo=data_mode and collection='clients' and not archived order by data->>'name',id limit 500)c;
 select count(*) into item_count from public.billing_inventory_items where business_id=business and demo=data_mode;
 select coalesce(jsonb_agg(to_jsonb(i) order by i.sku,i.id),'[]'::jsonb) into items from(select * from public.billing_inventory_items where business_id=business and demo=data_mode order by sku,id limit 500)i;
 select coalesce(jsonb_agg(to_jsonb(u) order by u.item_id,u.code,u.id),'[]'::jsonb) into units from public.billing_inventory_units u where u.business_id=business and u.demo=data_mode and u.item_id in(select i.id from public.billing_inventory_items i where i.business_id=business and i.demo=data_mode order by i.sku,i.id limit 500);
 select count(*) into warehouse_count from public.billing_inventory_warehouses where business_id=business and demo=data_mode;
 select coalesce(jsonb_agg(to_jsonb(w) order by w.code,w.id),'[]'::jsonb) into warehouses from(select * from public.billing_inventory_warehouses where business_id=business and demo=data_mode order by code,id limit 500)w;
 if order_id is not null then
  select * into source from public.billing_sales_orders o where o.id=order_id and o.business_id=business and o.demo=data_mode;
  if source.id is null then raise exception using errcode='P0002',message='Sales order unavailable in this business and data mode';end if;
  if source.status='draft' then lines=source.data->'lines';else
   select coalesce(jsonb_agg(to_jsonb(l)||jsonb_build_object('quantity',l.quantity::text,'base_quantity',l.base_quantity::text,'unit_factor',l.unit_factor::text,'dispatchedQuantity',coalesce((select sum(m.quantity) from public.billing_sales_fulfillment_movements(l.id)m where m.date<=as_of),0)::numeric(24,6)::text,'invoiceReservedQuantity',coalesce((select sum(m.quantity) from public.billing_sales_invoice_movements(l.id)m where m.date<=as_of),0)::numeric(24,6)::text,'sourceAmount',(((l.source_totals->>'taxable')::numeric+(l.source_totals->>'cgst')::numeric+(l.source_totals->>'sgst')::numeric+(l.source_totals->>'igst')::numeric+(l.source_totals->>'vat')::numeric+(l.source_totals->>'cess')::numeric)/100)::numeric(18,2)::text) order by l.line_index),'[]'::jsonb) into lines from public.billing_sales_order_lines l where l.order_id=source.id;
  end if;
  if (select count(*) from public.billing_sales_fulfillment_lines f join public.billing_sales_order_lines l on l.id=f.order_line_id where l.order_id=source.id)>1000 or (select count(distinct c.id) from public.billing_sales_document_conversions c join public.billing_sales_conversion_lines x on x.conversion_id=c.id join public.billing_sales_order_lines l on l.id=x.order_line_id where l.order_id=source.id)>1000 then raise exception 'Order detail exceeds 1,000 fulfillment/conversion events; no partial history is shown';end if;
  select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('recordVersion',r.version,'recordArchived',r.archived,'issued',exists(select 1 from public.billing_issued_documents i where i.document_id=c.document_id),'posted',exists(select 1 from public.billing_source_postings p where p.source_id=c.document_id and p.kind='document.issue'),'cancelledOn',(select x.date from public.billing_document_cancellations x where x.document_id=c.document_id),'abandonedOn',(select a.date from public.billing_sales_conversion_abandonments a where a.conversion_id=c.id),'lines',coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('quantity',x.quantity::text) order by x.id) from public.billing_sales_conversion_lines x where x.conversion_id=c.id and x.order_line_id in(select l.id from public.billing_sales_order_lines l where l.order_id=source.id)),'[]'::jsonb)) order by c.date,c.created_at,c.id),'[]'::jsonb) into conversions from public.billing_sales_document_conversions c join public.billing_records r on r.id=c.document_id where exists(select 1 from public.billing_sales_conversion_lines x join public.billing_sales_order_lines l on l.id=x.order_line_id where x.conversion_id=c.id and l.order_id=source.id);
  select coalesce(jsonb_agg(to_jsonb(f)||jsonb_build_object('quantity',f.quantity::text,'base_quantity',f.base_quantity::text,'date',e.date,'reference',e.reference,'reason',e.reason,'remainingReturnable',case when f.kind='dispatch' then f.quantity-coalesce((select sum(r.quantity) from public.billing_sales_fulfillment_lines r where r.returns_id=f.id),0) else 0 end::numeric(24,6)::text,'inventory',(select s.result from public.billing_sales_fulfillment_stock s where s.fulfillment_line_id=f.id)) order by e.date,e.created_at,f.id),'[]'::jsonb) into fulfillment from public.billing_sales_fulfillment_lines f join public.billing_sales_fulfillment_events e on e.id=f.event_id join public.billing_sales_order_lines l on l.id=f.order_line_id where l.order_id=source.id;
 end if;
 return jsonb_build_object('businessId',business,'demo',data_mode,'asOf',as_of,'canWrite',public.billing_can_access(business,true),'orders',orders,'orderCount',order_count,'ordersTruncated',order_count>200,'order',case when source.id is null then null else to_jsonb(source) end,'lines',lines,'conversions',conversions,'fulfillment',fulfillment,'clients',clients,'clientsTruncated',client_count>500,'items',items,'itemsTruncated',item_count>500,'units',units,'warehouses',warehouses,'warehousesTruncated',warehouse_count>500,'fundsMovedByFolio',false,'carrierBookingPerformed',false);
end$$;

revoke all on function public.billing_sales_order_guard(),public.billing_sales_quantity(jsonb,boolean),public.billing_sales_component_totals(jsonb),public.billing_sales_order_save(uuid,boolean,uuid,integer,uuid,jsonb),public.billing_sales_order_issue(uuid,boolean,uuid,integer,uuid),public.billing_sales_fulfillment_movements(uuid),public.billing_sales_invoice_movements(uuid),public.billing_sales_validate_line(uuid),public.billing_sales_inventory_source(uuid,boolean,uuid),public.billing_sales_inventory_authorize(uuid,uuid,boolean,uuid,uuid,uuid,text,numeric,date),public.billing_sales_invoice_components(uuid),public.billing_sales_conversion_reservations(uuid,uuid,text),public.billing_sales_allocation_basis(uuid,uuid,uuid,text,date,numeric,uuid),public.billing_sales_validate_value_caps(uuid),public.billing_sales_document_guard(),public.billing_sales_document_event_guard(),public.billing_sales_fulfillment_invoice_movements(uuid),public.billing_sales_convert(uuid,boolean,uuid,jsonb),public.billing_sales_fulfill(uuid,boolean,uuid,jsonb),public.billing_sales_inventory_finalize(uuid,uuid,boolean),public.billing_sales_order_cancel(uuid,boolean,uuid,integer,uuid,date,text),public.billing_sales_conversion_abandon(uuid,boolean,uuid,integer,uuid,date,text),public.billing_sales_order_read(uuid,boolean,date,uuid) from public,anon,authenticated;
grant execute on function public.billing_sales_order_save(uuid,boolean,uuid,integer,uuid,jsonb),public.billing_sales_order_issue(uuid,boolean,uuid,integer,uuid),public.billing_sales_convert(uuid,boolean,uuid,jsonb),public.billing_sales_fulfill(uuid,boolean,uuid,jsonb),public.billing_sales_order_cancel(uuid,boolean,uuid,integer,uuid,date,text),public.billing_sales_conversion_abandon(uuid,boolean,uuid,integer,uuid,date,text),public.billing_sales_order_read(uuid,boolean,date,uuid) to authenticated;
notify pgrst,'reload schema';
