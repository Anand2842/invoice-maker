-- Tax deduction records are immutable; settlement and reversals are dated ledger events.
create table public.billing_tds_sections(business_id uuid not null references public.billing_businesses(id),demo boolean not null,code text not null,effective_date date not null,rate numeric(8,4) not null check(rate between 0 and 100),threshold numeric(18,2) not null check(threshold>=0),threshold_kind text not null check(threshold_kind in ('single','annual','monthly','none')),primary key(business_id,demo,code,effective_date));
create table public.billing_tds_commands(business_id uuid not null references public.billing_businesses(id),demo boolean not null,command_id uuid not null,actor_id uuid not null references auth.users(id),request jsonb not null,result jsonb not null,primary key(business_id,demo,command_id));
create table public.billing_tds_deductions(id uuid primary key default gen_random_uuid(),business_id uuid not null references public.billing_businesses(id),demo boolean not null,bill_id uuid not null unique,section text not null,pan text not null,deductee_type text not null,base numeric(18,2) not null,rate numeric(8,4) not null,amount numeric(18,2) not null check(amount>0),date date not null,threshold_warning boolean not null,batch_id uuid not null unique,foreign key(bill_id,business_id,demo) references public.billing_vendor_bills(id,business_id,demo),foreign key(batch_id,business_id,demo) references public.billing_ledger_batches(id,business_id,demo));
create table public.billing_tds_challans(id uuid primary key default gen_random_uuid(),business_id uuid not null references public.billing_businesses(id),demo boolean not null,section text not null,bsr text not null,serial text not null,date date not null,amount numeric(18,2) not null,interest numeric(18,2) not null,late_fee numeric(18,2) not null,batch_id uuid not null unique,foreign key(batch_id,business_id,demo) references public.billing_ledger_batches(id,business_id,demo),unique(id,business_id,demo));
create table public.billing_tds_allocations(id uuid primary key default gen_random_uuid(),business_id uuid not null references public.billing_businesses(id),demo boolean not null,challan_id uuid not null references public.billing_tds_challans(id),deduction_id uuid not null references public.billing_tds_deductions(id),allocation_date date not null,amount numeric(18,2) not null check(amount>0));
alter table public.billing_tds_sections enable row level security;
alter table public.billing_tds_commands enable row level security;
alter table public.billing_tds_deductions enable row level security;
alter table public.billing_tds_challans enable row level security;
alter table public.billing_tds_allocations enable row level security;
revoke all on public.billing_tds_sections,public.billing_tds_commands,public.billing_tds_deductions,public.billing_tds_challans,public.billing_tds_allocations from public,anon,authenticated;
grant select on public.billing_tds_sections,public.billing_tds_deductions,public.billing_tds_challans,public.billing_tds_allocations to authenticated;
create policy tds_commands_read on public.billing_tds_commands for select to authenticated using(public.billing_can_access(business_id));
create policy tds_sections_read on public.billing_tds_sections for select to authenticated using(public.billing_can_access(business_id));
create policy tds_deductions_read on public.billing_tds_deductions for select to authenticated using(public.billing_can_access(business_id));
create policy tds_challans_read on public.billing_tds_challans for select to authenticated using(public.billing_can_access(business_id));
create policy tds_allocations_read on public.billing_tds_allocations for select to authenticated using(public.billing_can_access(business_id));
create trigger tds_deduction_immutable before update or delete on public.billing_tds_deductions for each row execute function public.billing_ledger_immutable();
create trigger tds_challan_immutable before update or delete on public.billing_tds_challans for each row execute function public.billing_ledger_immutable();
create trigger tds_allocation_immutable before update or delete on public.billing_tds_allocations for each row execute function public.billing_ledger_immutable();
create trigger tds_command_immutable before update or delete on public.billing_tds_commands for each row execute function public.billing_ledger_immutable();

-- Default rates are effective until overridden for a business and mode.
create function public.billing_tds_defaults() returns table(code text,rate numeric,threshold numeric,threshold_kind text) language sql immutable set search_path='' as $$
 values ('194C-individual',1::numeric,30000::numeric,'single'),('194C-other',2,30000,'single'),('194J-professional',10,50000,'annual'),('194J-technical',2,50000,'annual'),('194H',2,20000,'annual'),('194I-plant',2,50000,'monthly'),('194I-building',10,50000,'monthly'),('194Q',0.1,5000000,'annual'),('194A',10,0,'none')
$$;
create function public.billing_tds_section_save(business uuid,data_mode boolean,command_id uuid,section_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare req jsonb;prior public.billing_tds_commands;result jsonb;rate_value numeric;limit_value numeric;day date;kind text;code_value text;
begin
 if auth.uid() is null or not public.billing_can_access(business,true) then raise exception using errcode='42501',message='You cannot edit TDS sections';end if;
 perform public.billing_ledger_writer_lock(business,false);
 if data_mode is null or command_id is null or jsonb_typeof(section_data) is distinct from 'object' or (section_data-array['code','effectiveDate','rate','threshold','thresholdKind'])<>'{}'::jsonb then raise exception 'Invalid TDS section';end if;
 req=jsonb_build_object('action','tds.section','data',section_data);select * into prior from public.billing_tds_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_tds_section_save.command_id;
 if prior.command_id is not null then if prior.actor_id<>auth.uid() or prior.request<>req then raise exception using errcode='40001',message='Retry key was used for another TDS command';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 code_value=section_data->>'code';kind=section_data->>'thresholdKind';day=public.billing_payment_date(section_data->'effectiveDate');if jsonb_typeof(section_data->'rate') not in ('string','number') or coalesce(section_data->>'rate','') !~ '^[0-9]{1,3}(\.[0-9]{1,4})?$' then raise exception 'Enter a rate with up to four decimal places';end if;rate_value=(section_data->>'rate')::numeric;limit_value=public.billing_ledger_amount(section_data->'threshold');
 if not exists(select 1 from public.billing_tds_defaults() d where d.code=code_value) or kind not in ('single','annual','monthly','none') or rate_value>100 then raise exception 'Enter a valid section, rate and threshold';end if;
 insert into public.billing_tds_sections values(business,data_mode,code_value,day,rate_value,limit_value,kind) on conflict (business_id,demo,code,effective_date) do update set rate=excluded.rate,threshold=excluded.threshold,threshold_kind=excluded.threshold_kind;
 result=jsonb_build_object('section',section_data,'replayed',false);insert into public.billing_tds_commands values(business,data_mode,command_id,auth.uid(),req,result);return result;
end$$;

create function public.billing_tds_bill_issue(business uuid,data_mode boolean,bill_id uuid,expected_version integer,command_id uuid,tds_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.billing_vendor_bills;v public.billing_records;prior public.billing_tds_commands;req jsonb;result jsonb;journal jsonb;entries jsonb;code_value text;pan_value text;deductee text;day date;rate_value numeric;threshold_value numeric;threshold_kind_value text;base numeric;tax numeric;gross numeric;deduction numeric;aggregate_value numeric;warning boolean;payable uuid;tax_account uuid;tds_account uuid;fy date;
begin
 if auth.uid() is null or not public.billing_can_access(business,true) then raise exception using errcode='42501',message='You cannot issue vendor bills';end if;
 perform public.billing_ledger_writer_lock(business,false);
 if data_mode is null or bill_id is null or command_id is null or expected_version is null or expected_version<1 or jsonb_typeof(tds_data) is distinct from 'object' or (tds_data-array['section','pan'])<>'{}'::jsonb then raise exception 'Invalid TDS bill command';end if;
 req=jsonb_build_object('action','tds.bill.issue','billId',bill_id,'version',expected_version,'tds',tds_data);select * into prior from public.billing_tds_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_tds_bill_issue.command_id;
 if prior.command_id is not null then if prior.actor_id<>auth.uid() or prior.request<>req then raise exception using errcode='40001',message='Retry key was used for another TDS command';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 perform 1 from public.billing_ledger_configs where business_id=business and demo=data_mode for update;if not found then raise exception 'Configure the ledger first';end if;
 select * into b from public.billing_vendor_bills where id=bill_id and business_id=business and demo=data_mode for update;
 if b.id is null or b.status<>'draft' then raise exception 'Choose an unissued vendor bill';end if;
 if b.version<>expected_version then raise exception using errcode='40001',message='Vendor bill changed; reload before issuing';end if;
 if b.data->>'taxReviewed'<>'true' then raise exception 'Review tax before issuing';end if;
 select * into v from public.billing_records where id=b.vendor_id and business_id=business and demo=data_mode and collection='vendors' and not archived;
 if v.id is null then raise exception 'Vendor is no longer active';end if;
 if exists(select 1 from public.billing_vendor_bills x where x.business_id=business and x.demo=data_mode and x.vendor_id=b.vendor_id and x.status='issued' and lower(x.data->>'number')=lower(b.data->>'number') and not exists(select 1 from public.billing_ledger_batches r where r.reverses_id=x.issued_batch)) then raise exception using errcode='23505',message='This vendor reference is already issued';end if;
 if exists(select 1 from public.billing_vendor_bills x join public.billing_ledger_batches r on r.reverses_id=x.issued_batch where x.business_id=business and x.demo=data_mode and x.vendor_id=b.vendor_id and lower(x.data->>'number')=lower(b.data->>'number') and r.date>(b.data->>'date')::date) then raise exception 'Replacement cannot predate the bill reversal';end if;
 code_value=tds_data->>'section';pan_value=upper(btrim(coalesce(tds_data->>'pan','')));if pan_value<>'' and pan_value!~'^[A-Z]{5}[0-9]{4}[A-Z]$' then raise exception 'Enter a valid PAN or leave it blank';end if;
 deductee=case substring(pan_value,4,1) when 'P' then 'individual' when 'H' then 'HUF' when 'C' then 'company' when 'F' then 'firm' when 'A' then 'association' when 'T' then 'trust' when 'B' then 'body of individuals' when 'G' then 'government' when 'L' then 'local authority' when 'J' then 'artificial juridical person' else 'unknown' end;
 if code_value like '194C-%' and pan_value<>'' and ((deductee in ('individual','HUF'))<>(code_value='194C-individual')) then raise exception '194C section variant does not match the PAN deductee type';end if;
 day=(b.data->>'date')::date;select d.rate,d.threshold,d.threshold_kind into rate_value,threshold_value,threshold_kind_value from public.billing_tds_defaults() d where d.code=code_value;
 if rate_value is null then raise exception 'Choose a valid TDS section';end if;
 select s.rate,s.threshold,s.threshold_kind into rate_value,threshold_value,threshold_kind_value from public.billing_tds_sections s where s.business_id=business and s.demo=data_mode and s.code=code_value and s.effective_date<=day order by s.effective_date desc limit 1;
 if not found then select d.rate,d.threshold,d.threshold_kind into rate_value,threshold_value,threshold_kind_value from public.billing_tds_defaults() d where d.code=code_value;end if;
 if pan_value='' then rate_value=greatest(rate_value,case when code_value='194Q' then 5 else 20 end);end if;
 base=(b.data->>'subtotal')::numeric;tax=(b.data->>'taxAmount')::numeric;gross=base+tax;deduction=round(base*rate_value/100,2);if deduction<=0 or deduction>=gross then raise exception 'TDS must be positive and less than the bill total';end if;
 fy=make_date(extract(year from day)::int-case when extract(month from day)<4 then 1 else 0 end,4,1);
 select coalesce(sum(d.base),0) into aggregate_value from public.billing_tds_deductions d join public.billing_vendor_bills x on x.id=d.bill_id where d.business_id=business and d.demo=data_mode and x.vendor_id=b.vendor_id and split_part(d.section,'-',1)=split_part(code_value,'-',1) and d.date>=fy and d.date<=day and not exists(select 1 from public.billing_ledger_batches r where r.reverses_id=d.batch_id and r.date<=day);
 warning=case when code_value like '194C-%' then base<=threshold_value and aggregate_value+base<=100000 when threshold_kind_value='none' then false when threshold_kind_value='single' then base<=threshold_value when threshold_kind_value='annual' then aggregate_value+base<=threshold_value when threshold_kind_value='monthly' then base<=threshold_value else false end;
 select id into payable from public.billing_ledger_accounts where business_id=business and demo=data_mode and code='2000' and type='liability';select id into tax_account from public.billing_ledger_accounts where business_id=business and demo=data_mode and code='1300' and type='asset';
 if payable is null or tax_account is null or not exists(select 1 from public.billing_ledger_accounts where id=(b.data->>'accountId')::uuid and business_id=business and demo=data_mode and (type='expense' or (type='asset' and code not in ('1000','1100','1300','1400','1450')))) then raise exception 'Bill posting accounts unavailable';end if;
 insert into public.billing_ledger_accounts(business_id,demo,code,name,type) values(business,data_mode,'TDS-'||split_part(code_value,'-',1),'TDS payable – '||split_part(code_value,'-',1),'liability') on conflict (business_id,demo,code) do nothing;
 select id into tds_account from public.billing_ledger_accounts where business_id=business and demo=data_mode and code='TDS-'||split_part(code_value,'-',1) and type='liability';if tds_account is null then raise exception 'TDS payable account has an incompatible type';end if;
 entries=jsonb_build_array(jsonb_build_object('account_id',b.data->>'accountId','debit',base::text,'credit','0'));if tax>0 then entries=entries||jsonb_build_array(jsonb_build_object('account_id',tax_account,'debit',tax::text,'credit','0'));end if;
 entries=entries||jsonb_build_array(jsonb_build_object('account_id',payable,'debit','0','credit',(gross-deduction)::text),jsonb_build_object('account_id',tds_account,'debit','0','credit',deduction::text));
 b.data=b.data||jsonb_build_object('netPayable',(gross-deduction)::text,'tdsAmount',deduction::text,'tdsSection',code_value,'vendor',jsonb_build_object('id',v.id,'name',v.data->>'name','address',v.data->>'address','email',v.data->>'email','phone',v.data->>'phone','gstin',v.data->>'gstin'));
 journal=public.billing_ledger_commit(business,data_mode,command_id,req,jsonb_build_object('date',day,'description','Vendor bill '||(b.data->>'number'),'kind','manual','entries',entries));
 update public.billing_vendor_bills set status='issued',issued_batch=(journal->'batch'->>'id')::uuid,data=b.data,version=version+1,updated_at=now() where id=b.id returning * into b;
 insert into public.billing_tds_deductions(business_id,demo,bill_id,section,pan,deductee_type,base,rate,amount,date,threshold_warning,batch_id) values(business,data_mode,b.id,code_value,pan_value,deductee,base,rate_value,deduction,day,warning,b.issued_batch);
 result=jsonb_build_object('bill',to_jsonb(b),'journal',journal->'batch','thresholdWarning',warning,'rate',rate_value::text,'replayed',false);insert into public.billing_tds_commands values(business,data_mode,command_id,auth.uid(),req,result);return result;
end$$;

create function public.billing_tds_challan(business uuid,data_mode boolean,command_id uuid,challan_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare req jsonb;prior public.billing_tds_commands;result jsonb;journal jsonb;day date;amount numeric;interest numeric;fee numeric;allocation numeric;allocated numeric=0;item jsonb;d public.billing_tds_deductions;challan public.billing_tds_challans;cash uuid;liability uuid;expense uuid;section_value text;entries jsonb;
begin
 if auth.uid() is null or not public.billing_can_access(business,true) then raise exception using errcode='42501',message='You cannot record TDS challans';end if;
 perform public.billing_ledger_writer_lock(business,false);
 if data_mode is null or command_id is null or jsonb_typeof(challan_data) is distinct from 'object' or (challan_data-array['section','bsr','serial','date','amount','interest','lateFee','accountId','allocations'])<>'{}'::jsonb then raise exception 'Invalid TDS challan';end if;
 req=jsonb_build_object('action','tds.challan','data',challan_data);select * into prior from public.billing_tds_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_tds_challan.command_id;
 if prior.command_id is not null then if prior.actor_id<>auth.uid() or prior.request<>req then raise exception using errcode='40001',message='Retry key was used for another TDS command';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 perform 1 from public.billing_ledger_configs where business_id=business and demo=data_mode for update;if not found then raise exception 'Configure the ledger first';end if;
 section_value=challan_data->>'section';day=public.billing_payment_date(challan_data->'date');amount=public.billing_ledger_amount(challan_data->'amount');interest=public.billing_ledger_amount(coalesce(challan_data->'interest','"0"'::jsonb));fee=public.billing_ledger_amount(coalesce(challan_data->'lateFee','"0"'::jsonb));
 if section_value not in ('194C','194J','194H','194I','194Q','194A') or coalesce(challan_data->>'bsr','')!~'^[0-9]{7}$' or coalesce(challan_data->>'serial','')!~'^[0-9]{5}$' or amount<=0 or jsonb_typeof(challan_data->'allocations') is distinct from 'array' or jsonb_array_length(challan_data->'allocations')>500 then raise exception 'Enter a section, 7-digit BSR, 5-digit challan serial and positive amount';end if;
 if coalesce(challan_data->>'accountId','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'Choose a bank account';end if;
 select id into cash from public.billing_ledger_accounts where id=(challan_data->>'accountId')::uuid and business_id=business and demo=data_mode and code='1000' and type='asset';select id into liability from public.billing_ledger_accounts where business_id=business and demo=data_mode and code='TDS-'||section_value and type='liability';select id into expense from public.billing_ledger_accounts where business_id=business and demo=data_mode and code='5000' and type='expense';
 if cash is null or liability is null or expense is null then raise exception 'Required bank, TDS liability or expense account is unavailable';end if;
 for item in select value from jsonb_array_elements(challan_data->'allocations') loop
  if jsonb_typeof(item) is distinct from 'object' or (item-array['deductionId','amount'])<>'{}'::jsonb or coalesce(item->>'deductionId','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'Invalid challan allocation';end if;
  select * into d from public.billing_tds_deductions where id=(item->>'deductionId')::uuid and business_id=business and demo=data_mode and split_part(section,'-',1)=section_value;
  allocation=public.billing_ledger_amount(item->'amount');
  if d.id is null or d.date>day or allocation<=0 or exists(select 1 from public.billing_ledger_batches r where r.reverses_id=d.batch_id and r.date<=day) or allocation+coalesce((select sum(a.amount) from public.billing_tds_allocations a join public.billing_tds_challans c on c.id=a.challan_id where a.deduction_id=d.id and not exists(select 1 from public.billing_ledger_batches r where r.reverses_id=c.batch_id)),0)>d.amount then raise exception 'Allocation exceeds an eligible deduction';end if;
  if (select count(*) from jsonb_array_elements(challan_data->'allocations') x where x->>'deductionId'=item->>'deductionId')>1 then raise exception 'A deduction may appear only once per challan';end if;
  allocated=allocated+allocation;
 end loop;
 if allocated>amount then raise exception 'Allocations exceed the challan amount';end if;
 entries=jsonb_build_array(jsonb_build_object('account_id',liability,'debit',amount::text,'credit','0'));if interest+fee>0 then entries=entries||jsonb_build_array(jsonb_build_object('account_id',expense,'debit',(interest+fee)::text,'credit','0'));end if;
 entries=entries||jsonb_build_array(jsonb_build_object('account_id',cash,'debit','0','credit',(amount+interest+fee)::text));
 journal=public.billing_ledger_commit(business,data_mode,command_id,req,jsonb_build_object('date',day,'description','TDS challan '||(challan_data->>'serial'),'kind','manual','entries',entries));
 insert into public.billing_tds_challans(business_id,demo,section,bsr,serial,date,amount,interest,late_fee,batch_id) values(business,data_mode,section_value,challan_data->>'bsr',challan_data->>'serial',day,amount,interest,fee,(journal->'batch'->>'id')::uuid) returning * into challan;
 for item in select value from jsonb_array_elements(challan_data->'allocations') loop insert into public.billing_tds_allocations(business_id,demo,challan_id,deduction_id,allocation_date,amount) values(business,data_mode,challan.id,(item->>'deductionId')::uuid,day,public.billing_ledger_amount(item->'amount'));end loop;
 result=jsonb_build_object('challan',to_jsonb(challan),'journal',journal->'batch','replayed',false);insert into public.billing_tds_commands values(business,data_mode,command_id,auth.uid(),req,result);return result;
end$$;

create function public.billing_tds_read(business uuid,data_mode boolean,as_of date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare sections jsonb;deductions jsonb;challans jsonb;accounts jsonb;
begin
 if auth.uid() is null or not public.billing_can_access(business) then raise exception using errcode='42501',message='TDS register unavailable in this business';end if;
 if data_mode is null or as_of is null or not isfinite(as_of) then raise exception 'Choose a valid TDS register date';end if;
 select coalesce(jsonb_agg(jsonb_build_object('code',d.code,'rate',coalesce(s.rate,d.rate)::text,'threshold',coalesce(s.threshold,d.threshold)::text,'thresholdKind',coalesce(s.threshold_kind,d.threshold_kind),'effectiveDate',s.effective_date) order by d.code),'[]'::jsonb) into sections from public.billing_tds_defaults() d left join lateral (select * from public.billing_tds_sections x where x.business_id=business and x.demo=data_mode and x.code=d.code and x.effective_date<=as_of order by x.effective_date desc limit 1)s on true;
 select coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('base',d.base::text,'rate',d.rate::text,'amount',d.amount::text,'vendorId',b.vendor_id,'vendorName',b.data->'vendor'->>'name','billNumber',b.data->>'number','dueDate',case when extract(month from d.date)=3 then make_date(extract(year from d.date)::int,4,30) else (date_trunc('month',d.date)+interval '1 month 6 days')::date end,'quarter',((extract(month from d.date)::int+8)%12)/3+1,'financialYear',extract(year from d.date)::int-case when extract(month from d.date)<4 then 1 else 0 end,'allocated',coalesce((select sum(a.amount) from public.billing_tds_allocations a join public.billing_tds_challans c on c.id=a.challan_id where a.deduction_id=d.id and a.allocation_date<=as_of and c.date<=as_of and not exists(select 1 from public.billing_ledger_batches r where r.reverses_id=c.batch_id and r.date<=as_of)),0)::text,'allocations',coalesce((select jsonb_agg(jsonb_build_object('challanId',c.id,'amount',a.amount::text,'bsr',c.bsr,'serial',c.serial,'date',c.date)) from public.billing_tds_allocations a join public.billing_tds_challans c on c.id=a.challan_id where a.deduction_id=d.id and a.allocation_date<=as_of and c.date<=as_of and not exists(select 1 from public.billing_ledger_batches r where r.reverses_id=c.batch_id and r.date<=as_of)),'[]'::jsonb),'reversalDate',(select r.date from public.billing_ledger_batches r where r.reverses_id=d.batch_id)) order by d.date,d.id),'[]'::jsonb) into deductions from public.billing_tds_deductions d join public.billing_vendor_bills b on b.id=d.bill_id where d.business_id=business and d.demo=data_mode and d.date<=as_of;
 select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('amount',c.amount::text,'interest',c.interest::text,'late_fee',c.late_fee::text,'reversalDate',(select r.date from public.billing_ledger_batches r where r.reverses_id=c.batch_id)) order by c.date,c.id),'[]'::jsonb) into challans from public.billing_tds_challans c where c.business_id=business and c.demo=data_mode and c.date<=as_of;
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'code',a.code)),'[]'::jsonb) into accounts from public.billing_ledger_accounts a where a.business_id=business and a.demo=data_mode and a.code='1000' and a.type='asset';
 return jsonb_build_object('sections',sections,'deductions',deductions,'challans',challans,'accounts',accounts,'canWrite',public.billing_can_access(business,true),'asOf',as_of);
end$$;

create or replace view public.billing_vendor_statement_events with(security_barrier=true) as
 select b.business_id,b.demo,b.vendor_id,b.id as bill_id,j.id as batch_id,j.date,
 substring(j.number from '([0-9]+)$')::bigint as sequence,j.number,'bill'::text as kind,
 b.data->>'number' as reference,coalesce((b.data->>'netPayable')::numeric,(b.data->>'total')::numeric) as charge,0::numeric as credit
 from public.billing_vendor_bills b join public.billing_ledger_batches j on j.id=b.issued_batch
 union all
 select b.business_id,b.demo,b.vendor_id,b.id,j.id,j.date,substring(j.number from '([0-9]+)$')::bigint,j.number,'bill-reversal',
 b.data->>'number',0::numeric,coalesce((b.data->>'netPayable')::numeric,(b.data->>'total')::numeric)
 from public.billing_vendor_bills b join public.billing_ledger_batches j on j.reverses_id=b.issued_batch
 union all
 select b.business_id,b.demo,b.vendor_id,b.id,j.id,j.date,substring(j.number from '([0-9]+)$')::bigint,j.number,'payment',
 coalesce(nullif(p.data->>'reference',''),b.data->>'number'),0::numeric,p.amount
 from public.billing_vendor_payments p join public.billing_vendor_bills b on b.id=p.bill_id join public.billing_ledger_batches j on j.id=p.batch_id
 union all
 select b.business_id,b.demo,b.vendor_id,b.id,j.id,j.date,substring(j.number from '([0-9]+)$')::bigint,j.number,'payment-reversal',
 coalesce(nullif(p.data->>'reference',''),b.data->>'number'),p.amount,0::numeric
 from public.billing_vendor_payments p join public.billing_vendor_bills b on b.id=p.bill_id join public.billing_ledger_batches j on j.reverses_id=p.batch_id
 union all
 select c.business_id,c.demo,c.party_id,a.target_id,j.id,a.date,substring(j.number from '([0-9]+)$')::bigint,j.number,
 case when a.kind='allocate' then 'allocation' else 'allocation-release' end,c.number,
 case when a.kind='release' then a.amount else 0::numeric end,case when a.kind='allocate' then a.amount else 0::numeric end
 from public.billing_cash_allocations a join public.billing_cash_events c on c.id=a.cash_id join public.billing_ledger_batches j on j.id=a.batch_id where c.direction='outgoing'
 union all
 select c.business_id,c.demo,c.vendor_id,a.bill_id,j.id,a.date,substring(j.number from '([0-9]+)$')::bigint,j.number,
 case when a.kind='allocate' then 'credit-allocation' else 'credit-release' end,c.number,
 case when a.kind='release' then a.amount else 0::numeric end,case when a.kind='allocate' then a.amount else 0::numeric end
 from public.billing_vendor_credit_allocations a join public.billing_vendor_credits c on c.id=a.credit_id join public.billing_ledger_batches j on j.id=a.batch_id;

create or replace function public.billing_settlement_movements(target uuid,direction text) returns table(date date,delta numeric) language sql stable security definer set search_path='' as $$
 select i.date,(i.snapshot->'totals'->>'total')::numeric from public.billing_issued_documents i where $2='incoming' and i.document_id=target
 union all select c.date,-(i.snapshot->'totals'->>'total')::numeric from public.billing_document_cancellations c join public.billing_issued_documents i on i.document_id=c.document_id where $2='incoming' and c.document_id=target
 union all select i.date,(i.snapshot->'totals'->>'total')::numeric*case when i.type='credit-note' then -1 else 1 end from public.billing_issued_documents i where $2='incoming' and i.snapshot->>'originalDocumentId'=target::text and i.type in ('credit-note','debit-note')
 union all select c.date,(i.snapshot->'totals'->>'total')::numeric*case when i.type='credit-note' then 1 else -1 end from public.billing_document_cancellations c join public.billing_issued_documents i on i.document_id=c.document_id where $2='incoming' and i.snapshot->>'originalDocumentId'=target::text and i.type in ('credit-note','debit-note')
 union all select p.transaction_date,p.amount*case when p.kind='receipt' then -1 else 1 end from public.billing_payment_events p where $2='incoming' and p.document_id=target
 -- Retain old recorded cash effects; no synthetic backfill or status inference.
 union all select (r.data->>'date')::date,(r.data->>'amount')::numeric*case when coalesce(r.data->>'kind','receipt')='receipt' then -1 else 1 end from public.billing_records r where $2='incoming' and r.collection='payments' and not r.archived and r.data->>'documentId'=target::text and coalesce(r.data->>'direction','incoming')='incoming' and coalesce(r.data->>'kind','receipt') in ('receipt','reversal') and not exists(select 1 from public.billing_payment_events e where e.id=r.id)
 union all select (b.data->>'date')::date,coalesce((b.data->>'netPayable')::numeric,(b.data->>'total')::numeric) from public.billing_vendor_bills b where $2='outgoing' and b.id=target and b.status='issued'
 union all select r.date,-coalesce((b.data->>'netPayable')::numeric,(b.data->>'total')::numeric) from public.billing_vendor_bills b join public.billing_ledger_batches r on r.reverses_id=b.issued_batch where $2='outgoing' and b.id=target
 union all select p.date,-p.amount from public.billing_vendor_payments p where $2='outgoing' and p.bill_id=target
 union all select r.date,p.amount from public.billing_vendor_payments p join public.billing_ledger_batches r on r.reverses_id=p.batch_id where $2='outgoing' and p.bill_id=target
 union all select a.date,a.amount*case when a.kind='allocate' then -1 else 1 end from public.billing_cash_allocations a join public.billing_cash_events c on c.id=a.cash_id where a.target_id=target and c.direction=$2

 union all select a.date,a.amount*case when a.kind='allocate' then -1 else 1 end from public.billing_vendor_credit_allocations a where $2='outgoing' and a.bill_id=target

 union all select f.date,f.amount*case when f.kind='refund' then 1 else -1 end from public.billing_refund_events f join public.billing_issued_documents i on i.document_id=f.source_id where $2='incoming' and f.source_kind='customer-credit-note' and i.snapshot->>'originalDocumentId'=target::text
$$;


create or replace function public.billing_vendor_bill_pay(business uuid,data_mode boolean,bill_id uuid,expected_version integer,command_id uuid,payment_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare bill public.billing_vendor_bills;config public.billing_ledger_configs;prior public.billing_ledger_batches;payment public.billing_vendor_payments;
 request jsonb;result jsonb;day date;amount numeric;paid numeric;latest date;cash uuid;payable uuid;
begin
 if auth.uid() is null or not public.billing_can_access(business,true) then raise exception using errcode='42501',message='You cannot record vendor payments in this business';end if;
 perform public.billing_ledger_writer_lock(business,false);
 if data_mode is null or bill_id is null or expected_version is null or expected_version<1 or command_id is null or jsonb_typeof(payment_data) is distinct from 'object' or (payment_data-array['date','amount','accountId','method','reference','notes'])<>'{}'::jsonb then raise exception 'Invalid vendor payment command';end if;
 select * into config from public.billing_ledger_configs where business_id=business and demo=data_mode for update;
 if config.business_id is null then raise exception 'Configure the ledger first';end if;
 request=jsonb_build_object('action','vendor-bill.pay','billId',bill_id,'version',expected_version,'payment',payment_data);
 select * into prior from public.billing_ledger_batches b where b.business_id=business and b.demo=data_mode and b.command_id=billing_vendor_bill_pay.command_id;
 if prior.id is not null then
  if prior.actor_id<>auth.uid() or prior.request<>request then raise exception using errcode='40001',message='Retry key was used for a different vendor payment command';end if;
  select * into payment from public.billing_vendor_payments where batch_id=prior.id;
  if payment.id is null then raise exception 'Vendor payment journal confirmation is inconsistent';end if;
  return jsonb_build_object('payment',to_jsonb(payment)||jsonb_build_object('amount',payment.amount::text),'journal',public.billing_ledger_batch_json(prior.id),'replayed',true);
 end if;
 select * into bill from public.billing_vendor_bills where id=bill_id and business_id=business and demo=data_mode and status='issued';
 if bill.id is null then raise exception 'Choose an issued bill in this business and data mode';end if;
 if bill.version<>expected_version then raise exception using errcode='40001',message='Vendor bill changed; reload before recording a payment';end if;
 if exists(select 1 from public.billing_ledger_batches where reverses_id=bill.issued_batch) then raise exception 'This bill is reversed; no new payment can be recorded';end if;
 day=public.billing_payment_date(payment_data->'date');amount=public.billing_ledger_amount(payment_data->'amount');
 if day<(bill.data->>'date')::date or amount<=0 then raise exception 'Payment must be positive and cannot predate its bill';end if;
 -- Explicitly supported history: new payments cannot precede an existing settlement event.
 select greatest(max(p.date),max(r.date)),coalesce(sum(p.amount) filter(where r.id is null),0) into latest,paid from public.billing_vendor_payments p left join public.billing_ledger_batches r on r.reverses_id=p.batch_id where p.bill_id=bill.id;
 if latest is not null and day<latest then raise exception 'Payment date cannot precede the latest payment or payment reversal for this bill';end if;
 if amount>coalesce((bill.data->>'netPayable')::numeric,(bill.data->>'total')::numeric)-paid then raise exception 'Payment exceeds the remaining bill balance';end if;
 if jsonb_typeof(payment_data->'accountId') is distinct from 'string' or coalesce(payment_data->>'accountId','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'Choose the cash and bank account';end if;
 select id into cash from public.billing_ledger_accounts where id=(payment_data->>'accountId')::uuid and business_id=business and demo=data_mode and code='1000' and type='asset';
 select id into payable from public.billing_ledger_accounts where business_id=business and demo=data_mode and code='2000' and type='liability';
 if cash is null or payable is null then raise exception 'Vendor payments require the cash and bank (1000) and accounts payable (2000) control accounts';end if;
 if jsonb_typeof(payment_data->'method') is distinct from 'string' or length(btrim(payment_data->>'method')) not between 1 and 80 or jsonb_typeof(payment_data->'reference') is distinct from 'string' or length(payment_data->>'reference')>180 or jsonb_typeof(payment_data->'notes') is distinct from 'string' or length(payment_data->>'notes')>1000 then raise exception 'Enter a payment method, reference (up to 180 characters) and notes (up to 1000)';end if;
 result=public.billing_ledger_commit(business,data_mode,command_id,request,jsonb_build_object('date',day,'kind','manual','description','Vendor payment '||(bill.data->>'number'),'entries',jsonb_build_array(jsonb_build_object('account_id',payable,'debit',amount::text,'credit','0'),jsonb_build_object('account_id',cash,'debit','0','credit',amount::text))));
 insert into public.billing_vendor_payments(business_id,demo,bill_id,date,amount,account_id,data,batch_id,actor_id)
 values(business,data_mode,bill.id,day,amount,cash,payment_data||jsonb_build_object('vendor',bill.data->'vendor','billNumber',bill.data->>'number','currency',config.currency),(result->'batch'->>'id')::uuid,auth.uid()) returning * into payment;
 return jsonb_build_object('payment',to_jsonb(payment)||jsonb_build_object('amount',payment.amount::text),'journal',result->'batch','replayed',false);
end$$;

revoke all on function public.billing_tds_defaults(),public.billing_tds_section_save(uuid,boolean,uuid,jsonb),public.billing_tds_bill_issue(uuid,boolean,uuid,integer,uuid,jsonb),public.billing_tds_challan(uuid,boolean,uuid,jsonb),public.billing_tds_read(uuid,boolean,date) from public,anon,authenticated;
grant execute on function public.billing_tds_section_save(uuid,boolean,uuid,jsonb),public.billing_tds_bill_issue(uuid,boolean,uuid,integer,uuid,jsonb),public.billing_tds_challan(uuid,boolean,uuid,jsonb),public.billing_tds_read(uuid,boolean,date) to authenticated;
notify pgrst,'reload schema';
-- Receivable TDS accompanies an ordinary gross settlement, plus an immutable cash reclassification.
create table public.billing_tds_receivable_commands (
 business_id uuid not null references public.billing_businesses(id), demo boolean not null, command_id uuid not null,
 actor_id uuid not null references auth.users(id), request jsonb not null, result jsonb not null,
 primary key(business_id,demo,command_id)
);
create table public.billing_tds_receivables (
 receipt_id uuid primary key references public.billing_payment_events(id), business_id uuid not null references public.billing_businesses(id), demo boolean not null,
 invoice_id uuid not null references public.billing_records(id), date date not null, section text not null, amount numeric(18,2) not null check(amount>0),
 cash_amount numeric(18,2) not null check(cash_amount>=0), certificate text not null, customer_pan text not null, customer_tan text not null,
 batch_id uuid not null references public.billing_ledger_batches(id), claimed boolean not null default false
);
alter table public.billing_tds_receivable_commands enable row level security;
alter table public.billing_tds_receivables enable row level security;
revoke all on public.billing_tds_receivable_commands,public.billing_tds_receivables from public,anon,authenticated;
grant select on public.billing_tds_receivables to authenticated;
create policy tds_receivable_command_read on public.billing_tds_receivable_commands for select to authenticated using(public.billing_can_access(business_id));
create policy tds_receivable_read on public.billing_tds_receivables for select to authenticated using(public.billing_can_access(business_id));

create function public.billing_tds_record_receipt(business uuid,invoice_id uuid,expected_version integer,command_id uuid,receipt_data jsonb,data_mode boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.billing_tds_receivable_commands; request jsonb; cash numeric; tax numeric; gross numeric; day date; payment jsonb; journal jsonb; result jsonb; account uuid; cfg public.billing_auto_posting_configs; rec_id uuid; pan text; tan text; section text; certificate text;
begin
 if auth.uid() is null or not coalesce(public.billing_can_access(business,true),false) then raise exception using errcode='42501',message='You cannot record TDS receipts for this business';end if;
 if business is null or data_mode is null or invoice_id is null or expected_version is null or expected_version<1 or command_id is null or jsonb_typeof(receipt_data) is distinct from 'object' or (receipt_data-array['amount','date','method','reference','notes','currency','tdsAmount','section','certificate','customerPan','customerTan'])<>'{}'::jsonb then raise exception 'Invalid TDS receipt command';end if;
 perform 1 from public.billing_records where id=invoice_id and business_id=business and demo=data_mode and collection='documents' for update;
 perform public.billing_ledger_writer_lock(business,false);
 request=jsonb_build_object('action','receipt','invoiceId',invoice_id,'version',expected_version,'data',receipt_data);
 select * into prior from public.billing_tds_receivable_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_tds_record_receipt.command_id;
 if prior.command_id is not null then
  if prior.actor_id<>auth.uid() or prior.request<>request then raise exception using errcode='40001',message='This retry key was used for a different TDS command';end if;
  return prior.result||jsonb_build_object('replayed',true);
 end if;
 if exists(select 1 from public.billing_payment_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_tds_record_receipt.command_id) then raise exception using errcode='40001',message='This retry key was used for a different payment';end if;
 cash=public.billing_ledger_amount(receipt_data->'amount');tax=public.billing_payment_amount(receipt_data->'tdsAmount');gross=cash+tax;
 if gross>10000000000 then raise exception 'Receipt exceeds the supported amount';end if;
 day=public.billing_payment_date(receipt_data->'date');
 section=btrim(coalesce(receipt_data->>'section',''));certificate=btrim(coalesce(receipt_data->>'certificate',''));pan=upper(btrim(coalesce(receipt_data->>'customerPan','')));tan=upper(btrim(coalesce(receipt_data->>'customerTan','')));
 if jsonb_typeof(receipt_data->'section') is distinct from 'string' or section!~'^[A-Za-z0-9 /.-]{1,40}$' then raise exception 'Enter a TDS section';end if;
 if receipt_data?'certificate' and (jsonb_typeof(receipt_data->'certificate')<>'string' or length(certificate)>200) then raise exception 'Certificate reference must be text up to 200 characters';end if;
 if receipt_data?'customerPan' and jsonb_typeof(receipt_data->'customerPan')<>'string' or pan<>'' and pan!~'^[A-Z]{5}[0-9]{4}[A-Z]$' then raise exception 'Enter a valid customer PAN';end if;
 if receipt_data?'customerTan' and jsonb_typeof(receipt_data->'customerTan')<>'string' or tan<>'' and tan!~'^[A-Z]{4}[0-9]{5}[A-Z]$' then raise exception 'Enter a valid customer TAN';end if;
 select * into cfg from public.billing_auto_posting_configs where business_id=business and demo=data_mode;
 if cfg.business_id is null then raise exception 'Configure automatic invoice and receipt posting before recording TDS';end if;
 insert into public.billing_ledger_accounts(business_id,demo,code,name,type) values(business,data_mode,'TDS-REC','TDS receivable','asset') on conflict(business_id,demo,code) do nothing;
 select id into account from public.billing_ledger_accounts where business_id=business and demo=data_mode and code='TDS-REC' and type='asset' and name='TDS receivable';
 if account is null or account=cfg.cash_account or account=cfg.receivable_account then raise exception 'TDS receivable account needs review';end if;
 payment=public.billing_record_payment(business,invoice_id,expected_version,command_id,(receipt_data-array['tdsAmount','section','certificate','customerPan','customerTan'])||jsonb_build_object('amount',gross::text),data_mode);
 rec_id=(payment->'record'->>'id')::uuid;
 -- Cash plus TDS may settle at most the invoice balance on every effective date, even before any cash allocation exists.
 perform public.billing_validate_customer_settlement(invoice_id,day);
 journal=public.billing_ledger_commit(business,data_mode,gen_random_uuid(),request||jsonb_build_object('receiptId',rec_id),jsonb_build_object('date',day,'kind','manual','description','TDS withheld on customer receipt','entries',jsonb_build_array(jsonb_build_object('account_id',account,'debit',tax::text,'credit','0'),jsonb_build_object('account_id',cfg.cash_account,'debit','0','credit',tax::text))));
 insert into public.billing_tds_receivables(receipt_id,business_id,demo,invoice_id,date,section,amount,cash_amount,certificate,customer_pan,customer_tan,batch_id) values(rec_id,business,data_mode,invoice_id,day,section,tax,cash,certificate,pan,tan,(journal->'batch'->>'id')::uuid);
 result=jsonb_build_object('record',payment->'record','journal',journal->'batch','replayed',false);
 insert into public.billing_tds_receivable_commands values(business,data_mode,command_id,auth.uid(),request,result);
 return result;
end$$;

-- Prevent independent reversal; the payment reversal event drives the matching reclassification reversal.
create function public.billing_tds_receivable_reversal_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.reverses_id is not null and exists(select 1 from public.billing_tds_receivables t where t.batch_id=new.reverses_id and not exists(select 1 from public.billing_payment_events e where e.reverses_id=t.receipt_id and e.kind='reversal' and e.transaction_date=new.date)) then raise exception 'Reverse the customer receipt to reverse its TDS';end if;
 return new;
end$$;
create trigger billing_tds_receivable_reversal_guard before insert on public.billing_ledger_batches for each row execute function public.billing_tds_receivable_reversal_guard();
create function public.billing_tds_receivable_reverse() returns trigger language plpgsql security definer set search_path='' as $$
declare t public.billing_tds_receivables; entries jsonb;
begin
 if new.kind<>'reversal' then return new;end if;
 select * into t from public.billing_tds_receivables where receipt_id=new.reverses_id and business_id=new.business_id and demo=new.demo;
 if t.receipt_id is null then return new;end if;
 select jsonb_agg(jsonb_build_object('account_id',e.account_id,'debit',e.credit::text,'credit',e.debit::text) order by e.line) into entries from public.billing_ledger_entries e where e.batch_id=t.batch_id;
 perform public.billing_ledger_commit(new.business_id,new.demo,gen_random_uuid(),jsonb_build_object('source','tds.receipt.reversal','paymentId',new.id),jsonb_build_object('date',new.transaction_date,'kind','reversal','description','Reverse TDS on customer receipt','entries',entries),t.batch_id);
 return new;
end$$;
create trigger billing_tds_receivable_reverse after insert on public.billing_payment_events for each row execute function public.billing_tds_receivable_reverse();

create function public.billing_tds_receivables(business uuid,data_mode boolean) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb;
begin
 if auth.uid() is null or not coalesce(public.billing_can_access(business),false) then raise exception using errcode='42501',message='TDS receivables unavailable';end if;
 if data_mode is null then raise exception 'Choose a data mode';end if;
 select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('amount',t.amount::text,'cash_amount',t.cash_amount::text,'financialYear',(case when extract(month from t.date)>=4 then extract(year from t.date)::integer else extract(year from t.date)::integer-1 end)::text||'-'||(case when extract(month from t.date)>=4 then extract(year from t.date)::integer+1 else extract(year from t.date)::integer end)::text,'quarter',((extract(month from t.date)::integer+8)%12)/3+1,'customer',p.snapshot->'buyer','invoiceNumber',p.snapshot->>'invoiceNumber','reversalDate',r.transaction_date) order by t.date desc,t.receipt_id),'[]'::jsonb) into rows from public.billing_tds_receivables t join public.billing_payment_events p on p.id=t.receipt_id left join public.billing_payment_events r on r.reverses_id=t.receipt_id where t.business_id=business and t.demo=data_mode;
 return jsonb_build_object('receivables',rows,'canWrite',public.billing_can_access(business,true));
end$$;
create function public.billing_tds_claim_receivable(business uuid,data_mode boolean,command_id uuid,receipt_id uuid,claimed boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.billing_tds_receivable_commands; request jsonb; result jsonb;
begin
 if auth.uid() is null or not coalesce(public.billing_can_access(business,true),false) then raise exception using errcode='42501',message='You cannot change TDS reconciliation for this business';end if;
 if business is null or data_mode is null or command_id is null or receipt_id is null or claimed is null then raise exception 'Invalid TDS reconciliation command';end if;
 perform public.billing_ledger_writer_lock(business,false);
 request=jsonb_build_object('action','claim','receiptId',receipt_id,'claimed',claimed);
 select * into prior from public.billing_tds_receivable_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_tds_claim_receivable.command_id;
 if prior.command_id is not null then
  if prior.actor_id<>auth.uid() or prior.request<>request then raise exception using errcode='40001',message='This retry key was used for a different TDS command';end if;
  return prior.result||jsonb_build_object('replayed',true);
 end if;
 update public.billing_tds_receivables t set claimed=billing_tds_claim_receivable.claimed where t.receipt_id=billing_tds_claim_receivable.receipt_id and t.business_id=business and t.demo=data_mode;
 if not found then raise exception 'TDS receipt unavailable in this business and data mode';end if;
 result=jsonb_build_object('receiptId',receipt_id,'claimed',claimed,'replayed',false);
 insert into public.billing_tds_receivable_commands values(business,data_mode,command_id,auth.uid(),request,result);
 return result;
end$$;
revoke all on function public.billing_tds_record_receipt(uuid,uuid,integer,uuid,jsonb,boolean),public.billing_tds_receivable_reversal_guard(),public.billing_tds_receivable_reverse(),public.billing_tds_receivables(uuid,boolean),public.billing_tds_claim_receivable(uuid,boolean,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.billing_tds_record_receipt(uuid,uuid,integer,uuid,jsonb,boolean),public.billing_tds_receivables(uuid,boolean),public.billing_tds_claim_receivable(uuid,boolean,uuid,uuid,boolean) to authenticated;

-- Reconcile actual cash separately from the gross receivable settlement.
create or replace function public.billing_source_reconciliation(business uuid,data_mode boolean,as_of date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare customer_refund_ar numeric(30,2)=0;credit_expected numeric(30,2)=0;credit_actual numeric(30,2)=0;refund_cash numeric(30,2)=0;credit_tax numeric(30,2)=0;advance_in_expected numeric(30,2)=0;advance_out_expected numeric(30,2)=0;advance_in_actual numeric(30,2)=0;advance_out_actual numeric(30,2)=0;cash_new numeric(30,2)=0;ar_allocated numeric(30,2)=0;config public.billing_auto_posting_configs;ledger public.billing_ledger_configs;accounts jsonb;
 ar_expected numeric(30,2)=0;ar_actual numeric(30,2)=0;ap_expected numeric(30,2)=0;ap_actual numeric(30,2)=0;cash_expected numeric(30,2)=0;cash_actual numeric(30,2)=0;tax_expected numeric(30,2)=0;tax_actual numeric(30,2)=0;
 itc_expected numeric(30,2)=0;itc_actual numeric(30,2)=0;itc_account uuid;expense_cash numeric(30,2)=0;unposted_expenses bigint=0;
 cash_vendor numeric(30,2)=0;unposted bigint=0;legacy bigint=0;foreign_docs bigint=0;ap_account uuid;row_count bigint;result jsonb;source_rows bigint;
begin
 if auth.uid() is null or not public.billing_can_access(business) then raise exception using errcode='42501',message='Source reconciliation unavailable in this business';end if;
 if data_mode is null or as_of is null or not isfinite(as_of) then raise exception 'Choose a valid reconciliation date';end if;
 select * into ledger from public.billing_ledger_configs where business_id=business and demo=data_mode;
 select * into config from public.billing_auto_posting_configs where business_id=business and demo=data_mode;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'type',type) order by code),'[]'::jsonb) into accounts from public.billing_ledger_accounts where business_id=business and demo=data_mode;
 if config.business_id is null then return jsonb_build_object('businessId',business,'demo',data_mode,'configured',false,'ledgerConfigured',ledger.business_id is not null,'canManage',public.billing_is_owner(business),'accounts',accounts,'currency',ledger.currency,'ledgerStart',ledger.start_date,'asOf',as_of,'reviewStatus','unreviewed');end if;
 with documents as(
  select i.*,case when i.type='credit-note' then -1 else 1 end as sign,c.date as cancelled_on from public.billing_issued_documents i left join public.billing_document_cancellations c on c.document_id=i.document_id
  where i.business_id=business and i.demo=data_mode and i.date>=config.cutover_date and i.date<=as_of and i.snapshot->>'currency'=config.currency and i.type in ('invoice','gst-invoice','commercial-invoice','credit-note','debit-note')
 ) select coalesce(sum((snapshot->'totals'->>'total')::numeric*sign) filter(where cancelled_on is null or cancelled_on>as_of),0),coalesce(sum(((snapshot->'totals'->>'tax')::numeric+(snapshot->'totals'->>'cess')::numeric)*sign) filter(where cancelled_on is null or cancelled_on>as_of),0),count(*) into ar_expected,tax_expected,source_rows from documents;
 select ar_expected-coalesce(sum(case when p.kind='receipt' then p.amount else -p.amount end),0),coalesce(sum((case when p.kind='receipt' then 1 else -1 end)*(p.amount-coalesce((select t.amount from public.billing_tds_receivables t where t.receipt_id=case when p.kind='receipt' then p.id else p.reverses_id end),0))),0) into ar_expected,cash_expected
 from public.billing_payment_events p join public.billing_issued_documents i on i.document_id=p.document_id
 where p.business_id=business and p.demo=data_mode and p.transaction_date between config.cutover_date and as_of and p.currency=config.currency and i.date>=config.cutover_date;
 select coalesce(sum(e.charge-e.credit),0) into ap_expected from public.billing_vendor_statement_events e where e.business_id=business and e.demo=data_mode and e.date<=as_of;
 select coalesce(sum(p.amount) filter(where p.date<=as_of),0)-coalesce(sum(p.amount) filter(where r.date<=as_of),0) into cash_vendor from public.billing_vendor_payments p left join public.billing_ledger_batches r on r.reverses_id=p.batch_id where p.business_id=business and p.demo=data_mode and p.account_id=config.cash_account;
 cash_expected=cash_expected-cash_vendor;
 -- Include actual dated challan cash postings, including interest and fees.
 select cash_expected+coalesce(sum(e.debit-e.credit),0) into cash_expected from public.billing_tds_challans t join public.billing_ledger_batches j on j.id=t.batch_id or j.reverses_id=t.batch_id join public.billing_ledger_entries e on e.batch_id=j.id and e.account_id=config.cash_account where t.business_id=business and t.demo=data_mode and j.date<=as_of;
 select coalesce(sum(p.gross_amount) filter(where p.cash_account=config.cash_account),0),coalesce(sum(p.input_tax),0) into expense_cash,itc_expected from public.billing_posted_expenses p left join public.billing_expense_reversals r on r.expense_id=p.expense_id where p.business_id=business and p.demo=data_mode and p.date<=as_of and (r.id is null or r.date>as_of);
 cash_expected=cash_expected-expense_cash;
 select itc_expected+coalesce(sum((b.data->>'taxAmount')::numeric),0) into itc_expected from public.billing_vendor_bills b where b.business_id=business and b.demo=data_mode and b.status='issued' and (b.data->>'date')::date<=as_of and not exists(select 1 from public.billing_ledger_batches r where r.reverses_id=b.issued_batch and r.date<=as_of);
 select id into itc_account from public.billing_ledger_accounts where business_id=business and demo=data_mode and code='1300' and type='asset';
 select coalesce(sum(e.debit-e.credit),0) into itc_actual from public.billing_ledger_entries e join public.billing_ledger_batches b on b.id=e.batch_id where e.business_id=business and e.demo=data_mode and e.account_id=itc_account and b.date<=as_of;
 select count(*) into unposted_expenses from public.billing_records r where r.business_id=business and r.demo=data_mode and r.collection='expenses' and not r.archived and r.data->>'date'<=as_of::text and not exists(select 1 from public.billing_posted_expenses p where p.expense_id=r.id);

 select id into ap_account from public.billing_ledger_accounts where business_id=business and demo=data_mode and code='2000' and type='liability';
 select coalesce(sum(c.amount*case when c.direction='incoming' then 1 else -1 end*case when c.kind='cash' then 1 else -1 end),0) into cash_new from public.billing_cash_events c where c.business_id=business and c.demo=data_mode and c.date<=as_of;
 cash_expected=cash_expected+cash_new;
 select coalesce(sum(f.amount*case when f.direction='incoming' then 1 else -1 end*case when f.kind='refund' then 1 else -1 end),0) into refund_cash from public.billing_refund_events f where f.business_id=business and f.demo=data_mode and f.date<=as_of;
 cash_expected=cash_expected+refund_cash;
 select coalesce(sum(c.tax_amount),0) into credit_tax from public.billing_vendor_credits c where c.business_id=business and c.demo=data_mode and c.date<=as_of and not exists(select 1 from public.billing_vendor_credit_reversals r where r.credit_id=c.id and r.date<=as_of);
 itc_expected=itc_expected-credit_tax;
 select coalesce(sum(coalesce((select sum(m.delta) from public.billing_vendor_credit_movements(c.id)m where m.date<=as_of),0)),0) into credit_expected from public.billing_vendor_credits c where c.business_id=business and c.demo=data_mode;
 select coalesce(sum(e.debit-e.credit),0) into credit_actual from public.billing_ledger_entries e join public.billing_ledger_accounts a on a.id=e.account_id join public.billing_ledger_batches b on b.id=e.batch_id where e.business_id=business and e.demo=data_mode and a.code='1450' and b.date<=as_of;

 select coalesce(sum(a.amount*case when a.kind='allocate' then 1 else -1 end),0) into ar_allocated from public.billing_cash_allocations a join public.billing_cash_events c on c.id=a.cash_id where a.business_id=business and a.demo=data_mode and a.date<=as_of and c.direction='incoming';
 ar_expected=ar_expected-ar_allocated;
 select coalesce(sum(f.amount*case when f.kind='refund' then 1 else -1 end),0) into customer_refund_ar from public.billing_refund_events f where f.business_id=business and f.demo=data_mode and f.source_kind='customer-credit-note' and f.date<=as_of;
 ar_expected=ar_expected+customer_refund_ar;
 with funds as(select c.id,c.direction,coalesce((select sum(m.delta) from public.billing_cash_movements(c.id)m where m.date<=as_of),0) amount from public.billing_cash_events c where c.business_id=business and c.demo=data_mode and c.kind='cash')
 select coalesce(sum(amount) filter(where direction='incoming'),0),coalesce(sum(amount) filter(where direction='outgoing'),0) into advance_in_expected,advance_out_expected from funds;
 select coalesce(sum(e.credit-e.debit) filter(where a.code='2200'),0),coalesce(sum(e.debit-e.credit) filter(where a.code='1400'),0) into advance_in_actual,advance_out_actual from public.billing_ledger_entries e join public.billing_ledger_accounts a on a.id=e.account_id join public.billing_ledger_batches b on b.id=e.batch_id where e.business_id=business and e.demo=data_mode and b.date<=as_of;
 select coalesce(sum(e.debit-e.credit) filter(where e.account_id=config.receivable_account),0),coalesce(sum(e.credit-e.debit) filter(where e.account_id=ap_account),0),coalesce(sum(e.debit-e.credit) filter(where e.account_id=config.cash_account),0),coalesce(sum(e.credit-e.debit) filter(where e.account_id=config.tax_account),0) into ar_actual,ap_actual,cash_actual,tax_actual
 from public.billing_ledger_entries e join public.billing_ledger_batches b on b.id=e.batch_id where e.business_id=business and e.demo=data_mode and b.date<=as_of;
 select count(*) filter(where i.document_id is null),count(*) filter(where i.document_id is not null and not exists(select 1 from public.billing_source_postings p where p.source_id=r.id and p.kind='document.issue')),count(*) filter(where r.data->>'currency'<>config.currency)
 into legacy,unposted,foreign_docs from public.billing_records r left join public.billing_issued_documents i on i.document_id=r.id
 where r.business_id=business and r.demo=data_mode and r.collection='documents' and not r.archived and r.data->>'type' in ('invoice','gst-invoice','commercial-invoice','credit-note','debit-note') and (r.data->>'status' in ('sent','paid') or r.data->>'status'='cancelled' and i.document_id is not null) and (r.data->>'date')::date<=as_of;
 return jsonb_build_object('businessId',business,'demo',data_mode,'configured',true,'ledgerConfigured',true,'canManage',public.billing_is_owner(business),'config',to_jsonb(config),'currency',config.currency,'asOf',as_of,'accounts',accounts,'controls',jsonb_build_array(
 jsonb_build_object('code','AR','name','Accounts receivable','expected',ar_expected::text,'ledger',ar_actual::text,'difference',(ar_actual-ar_expected)::text),
 jsonb_build_object('code','AP','name','Accounts payable','expected',ap_expected::text,'ledger',ap_actual::text,'difference',(ap_actual-ap_expected)::text),
 jsonb_build_object('code','CASH','name','Cash / bank','expected',cash_expected::text,'ledger',cash_actual::text,'difference',(cash_actual-cash_expected)::text),
 jsonb_build_object('code','TAX','name','Output tax payable','expected',tax_expected::text,'ledger',tax_actual::text,'difference',(tax_actual-tax_expected)::text),jsonb_build_object('code','ITC','name','Reviewed input tax receivable','expected',itc_expected::text,'ledger',itc_actual::text,'difference',(itc_actual-itc_expected)::text),
 jsonb_build_object('code','CUSTOMER_ADVANCE','name','Unapplied customer cash','expected',advance_in_expected::text,'ledger',advance_in_actual::text,'difference',(advance_in_actual-advance_in_expected)::text),
 jsonb_build_object('code','VENDOR_ADVANCE','name','Unapplied vendor disbursements','expected',advance_out_expected::text,'ledger',advance_out_actual::text,'difference',(advance_out_actual-advance_out_expected)::text),jsonb_build_object('code','VENDOR_CREDIT','name','Unapplied supplier credits','expected',credit_expected::text,'ledger',credit_actual::text,'difference',(credit_actual-credit_expected)::text)),
 'unpostedExpenses',unposted_expenses,'unpostedManagedDocuments',unposted,'legacyDocumentsNeedingOpeningReview',legacy,'foreignDocumentsNeedingFxReview',foreign_docs,'managedDocumentsThroughDate',source_rows,'arithmeticAgrees',ar_actual=ar_expected and ap_actual=ap_expected and cash_actual=cash_expected and tax_actual=tax_expected and itc_actual=itc_expected and advance_in_actual=advance_in_expected and advance_out_actual=advance_out_expected and credit_actual=credit_expected and unposted_expenses=0 and unposted=0 and legacy=0 and foreign_docs=0,'reviewStatus','unreviewed',
 'limitations',jsonb_build_array('Mechanical control-account comparison only; personal review decisions are recorded separately and this result does not assert sign-off. Supplier credit tax amounts are user-reviewed corrections, not completed GST filings.','Expected AR/output tax uses frozen managed documents and dated receipt/cancellation events after cutover. No paid flag becomes cash. Customer credit-note refund records debit AR separately from advance refunds; record corrections remain dated.','Expected AP uses explicit Folio vendor bills/payments/reversals. Cash allocations/releases are included once; unapplied advances are independent controls. Supplier credit allocations/releases reduce AP; supplier credit issues/refunds stay separate from bill aging. Manual journals are not invented.','Expected cash also includes explicit paid expense snapshots/reversals; reviewed input tax includes expense and vendor bill snapshots. Unposted expenses require opening/source review.','Manual/opening control-account entries can cause differences and need reviewed mappings. FX, inventory and additional expense sources remain separate work.'));
end$$;

create function public.billing_tds_allocate(business uuid,data_mode boolean,command_id uuid,allocation_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare req jsonb;prior public.billing_tds_commands;result jsonb;c public.billing_tds_challans;d public.billing_tds_deductions;item jsonb;day date;amount numeric;allocated numeric;
begin
 if auth.uid() is null or not public.billing_can_access(business,true) then raise exception using errcode='42501',message='You cannot allocate TDS challans';end if;
 perform public.billing_ledger_writer_lock(business,false);
 if data_mode is null or command_id is null or jsonb_typeof(allocation_data) is distinct from 'object' or (allocation_data-array['challanId','date','allocations'])<>'{}'::jsonb or coalesce(allocation_data->>'challanId','')!~'^[0-9a-fA-F-]{36}$' or jsonb_typeof(allocation_data->'allocations') is distinct from 'array' or jsonb_array_length(allocation_data->'allocations') not between 1 and 500 then raise exception 'Choose a challan and deductions';end if;
 req=jsonb_build_object('action','tds.allocate','data',allocation_data);select * into prior from public.billing_tds_commands x where x.business_id=business and x.demo=data_mode and x.command_id=billing_tds_allocate.command_id;
 if prior.command_id is not null then if prior.actor_id<>auth.uid() or prior.request<>req then raise exception using errcode='40001',message='Retry key was used for another TDS command';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 day=public.billing_payment_date(allocation_data->'date');select * into c from public.billing_tds_challans where id=(allocation_data->>'challanId')::uuid and business_id=business and demo=data_mode;
 if c.id is null or day<c.date or exists(select 1 from public.billing_ledger_batches r where r.reverses_id=c.batch_id) then raise exception 'Choose an active challan and allocation date on or after deposit';end if;
 select coalesce(sum(a.amount),0) into allocated from public.billing_tds_allocations a where a.challan_id=c.id;
 for item in select value from jsonb_array_elements(allocation_data->'allocations') loop
  if jsonb_typeof(item) is distinct from 'object' or (item-array['deductionId','amount'])<>'{}'::jsonb or coalesce(item->>'deductionId','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'Invalid challan allocation';end if;
  select * into d from public.billing_tds_deductions where id=(item->>'deductionId')::uuid and business_id=business and demo=data_mode and split_part(section,'-',1)=c.section;amount=public.billing_ledger_amount(item->'amount');
  if d.id is null or d.date>c.date or amount<=0 or exists(select 1 from public.billing_ledger_batches r where r.reverses_id=d.batch_id) or amount+coalesce((select sum(a.amount) from public.billing_tds_allocations a join public.billing_tds_challans x on x.id=a.challan_id where a.deduction_id=d.id and not exists(select 1 from public.billing_ledger_batches r where r.reverses_id=x.batch_id)),0)>d.amount then raise exception 'Allocation exceeds an eligible deduction';end if;
  allocated=allocated+amount;if allocated>c.amount then raise exception 'Allocations exceed the challan amount';end if;
  insert into public.billing_tds_allocations(business_id,demo,challan_id,deduction_id,allocation_date,amount) values(business,data_mode,c.id,d.id,day,amount);
 end loop;
 result=jsonb_build_object('challanId',c.id,'allocated',allocated::text,'replayed',false);insert into public.billing_tds_commands values(business,data_mode,command_id,auth.uid(),req,result);return result;
end$$;
create function public.billing_tds_bill_reversal_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.reverses_id is not null and exists(select 1 from public.billing_tds_deductions d join public.billing_tds_allocations a on a.deduction_id=d.id join public.billing_tds_challans c on c.id=a.challan_id where d.batch_id=new.reverses_id and not exists(select 1 from public.billing_ledger_batches r where r.reverses_id=c.batch_id and r.date<=new.date)) then raise exception 'Reverse the allocated challan before reversing this bill';end if;
 return new;
end$$;
create trigger tds_bill_reversal_guard before insert on public.billing_ledger_batches for each row execute function public.billing_tds_bill_reversal_guard();
revoke all on function public.billing_tds_allocate(uuid,boolean,uuid,jsonb),public.billing_tds_bill_reversal_guard() from public,anon,authenticated;
grant execute on function public.billing_tds_allocate(uuid,boolean,uuid,jsonb) to authenticated;
