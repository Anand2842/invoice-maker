-- Simulated compliance submissions and their append-only history.
create table public.billing_compliance_settings(business_id uuid not null references public.billing_businesses(id),demo boolean not null,enabled boolean not null,threshold numeric(18,2) not null check(threshold>=0),actor_id uuid not null references auth.users(id),created_at timestamptz not null default now(),id uuid primary key default gen_random_uuid());
create table public.billing_compliance_records(id uuid primary key default gen_random_uuid(),business_id uuid not null references public.billing_businesses(id),demo boolean not null,document_id uuid not null references public.billing_issued_documents(document_id),kind text not null check(kind in ('irn','ewb')),request jsonb not null,response jsonb not null,actor_id uuid not null references auth.users(id),created_at timestamptz not null default now(),simulated boolean not null default true check(simulated),unique(business_id,demo,document_id,kind));
create table public.billing_compliance_events(id uuid primary key default gen_random_uuid(),business_id uuid not null references public.billing_businesses(id),demo boolean not null,record_id uuid not null references public.billing_compliance_records(id),kind text not null check(kind in ('generated','cancelled','vehicle-updated')),details jsonb not null,actor_id uuid not null references auth.users(id),created_at timestamptz not null default now());
create table public.billing_compliance_commands(business_id uuid not null references public.billing_businesses(id),demo boolean not null,command_id uuid not null,actor_id uuid not null references auth.users(id),request jsonb not null,result jsonb not null,primary key(business_id,demo,command_id));
create unique index compliance_unique_irn on public.billing_compliance_records(demo,(response->>'Irn')) where kind='irn';
create index compliance_history on public.billing_compliance_events(record_id,created_at,id);
DO $$declare t text;begin foreach t in array array['billing_compliance_settings','billing_compliance_records','billing_compliance_events','billing_compliance_commands'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('create policy compliance_read on public.%I for select to authenticated using(public.billing_can_access(business_id))',t);execute format('grant select on public.%I to authenticated',t);execute format('create trigger compliance_immutable before update or delete on public.%I for each row execute function public.billing_ledger_immutable()',t);end loop;end$$;

create function public.billing_compliance_gstin(value text) returns boolean language plpgsql immutable set search_path='' as $$
declare chars text='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'; factor integer=2; total integer=0; n integer; i integer;
begin
 if value is null or value !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$' or not (substring(value,1,2)::integer between 1 and 38 or substring(value,1,2) in ('96','97')) then return false;end if;
 for i in reverse 14..1 loop n=(strpos(chars,substring(value,i,1))-1)*factor;total=total+n/36+n%36;factor=case factor when 2 then 1 else 2 end;end loop;
 return substring(chars,((36-total%36)%36)+1,1)=substring(value,15,1);
end$$;

create function public.billing_compliance_read(business uuid,data_mode boolean) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare settings jsonb;docs jsonb;records jsonb;
begin
 if auth.uid() is null or not public.billing_can_access(business) then raise exception using errcode='42501',message='Business access required';end if;if data_mode is null then raise exception 'Choose data mode';end if;
 select jsonb_build_object('enabled',s.enabled,'threshold',s.threshold) into settings from public.billing_compliance_settings s where s.business_id=business and s.demo=data_mode order by s.created_at desc,s.id desc limit 1;
 select coalesce(jsonb_agg(jsonb_build_object('documentId',d.document_id,'number',d.number,'type',d.type,'date',d.date,'snapshot',d.snapshot) order by d.created_at desc),'[]') into docs from public.billing_issued_documents d where d.business_id=business and d.demo=data_mode and d.type in ('invoice','gst-invoice','credit-note','debit-note','delivery-challan') and not exists(select 1 from public.billing_document_cancellations c where c.document_id=d.document_id);
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'documentId',r.document_id,'kind',r.kind,'status',case when exists(select 1 from public.billing_compliance_events e where e.record_id=r.id and e.kind='cancelled') then 'cancelled' else 'active' end,'request',r.request,'response',r.response,'createdAt',r.created_at,'simulated',true,'history',coalesce((select jsonb_agg(jsonb_build_object('kind',e.kind,'details',e.details,'actor',e.actor_id,'createdAt',e.created_at) order by e.created_at,e.id) from public.billing_compliance_events e where e.record_id=r.id),'[]')) order by r.created_at desc),'[]') into records from public.billing_compliance_records r where r.business_id=business and r.demo=data_mode;
 return jsonb_build_object('businessId',business,'demo',data_mode,'timeZone',(select b.time_zone from public.billing_businesses b where b.id=business),'canWrite',public.billing_can_access(business,true),'settings',coalesce(settings,'{"enabled":false,"threshold":50000}'::jsonb),'documents',docs,'records',records);
end$$;

create function public.billing_compliance_payload(snapshot jsonb,transport jsonb,eway boolean) returns jsonb language plpgsql immutable set search_path='' as $$
declare seller jsonb=snapshot->'seller';buyer jsonb=snapshot->'buyer';sp jsonb;bp jsonb;doc jsonb;tx jsonb;v jsonb;items jsonb='[]';goods jsonb='[]';item jsonb;one jsonb;line jsonb;idx integer=0;ss text;bs text;pos text;sup text;dtype text;dt text;
begin
 ss=coalesce(nullif(seller->>'gstState',''),substring(seller->>'gstin',1,2),'');bs=coalesce(nullif(buyer->>'gstState',''),substring(buyer->>'gstin',1,2),'');pos=coalesce(nullif(snapshot->'gstReporting'->>'placeOfSupply',''),nullif(snapshot->'taxDetails'->>'placeOfSupply',''),nullif(buyer->>'placeOfSupply',''),bs);
 sp=jsonb_build_object('Gstin',coalesce(seller->>'gstin',''),'LglNm',coalesce(seller->>'name',''),'Addr1',coalesce(nullif(seller->>'street',''),seller->>'address',''),'Loc',coalesce(seller->>'city',''),'Pin',coalesce(nullif(seller->>'pincode','')::numeric,0),'Stcd',ss);
 bp=jsonb_build_object('Gstin',coalesce(buyer->>'gstin',''),'LglNm',coalesce(buyer->>'name',''),'Addr1',coalesce(nullif(buyer->>'street',''),buyer->>'address',''),'Loc',coalesce(buyer->>'city',''),'Pin',coalesce(nullif(buyer->>'pincode','')::numeric,0),'Stcd',bs,'Pos',pos);
 dtype=case snapshot->>'type' when 'invoice' then 'INV' when 'gst-invoice' then 'INV' when 'credit-note' then 'CRN' when 'debit-note' then 'DBN' else '' end;dt=to_char((snapshot->>'date')::date,'DD/MM/YYYY');
 doc=jsonb_build_object('Typ',dtype,'No',snapshot->>'number','Dt',dt);sup=upper(coalesce(nullif(snapshot->'gstReporting'->>'supplyType',''),nullif(snapshot->>'supplyType',''),'B2B'));if sup not in ('B2B','SEZWP','SEZWOP','EXPWP','EXPWOP') then sup='B2B';end if;
 tx=jsonb_build_object('TaxSch','GST','SupTyp',sup,'RegRev',case when lower(coalesce(nullif(snapshot->'taxDetails'->>'reverseCharge',''),snapshot->>'reverseCharge','')) in ('yes','y','true') then 'Y' else 'N' end,'IgstOnIntra',case when ss=pos and snapshot->>'gstMode'='igst' then 'Y' else 'N' end);
 v=(public.billing_document_totals(snapshot))->'totals';
 for item in select value from jsonb_array_elements(snapshot->'items') loop
  idx=idx+1;one=(public.billing_document_totals((snapshot-'shipping'-'roundOff')||jsonb_build_object('items',jsonb_build_array(item),'roundOff',false)))->'totals';
  line=jsonb_build_object('SlNo',idx::text,'PrdDesc',coalesce(nullif(item->>'name',''),nullif(item->>'description',''),'Item '||idx),'IsServc',case when item->>'hsn' like '99%' then 'Y' else 'N' end,'HsnCd',coalesce(item->>'hsn',''),'Qty',coalesce((item->>'quantity')::numeric,1),'Unit',coalesce(nullif(item->>'uqc',''),'NOS'),'UnitPrice',round(coalesce((item->>'rate')::numeric,0)*100)/100,'TotAmt',one->'subtotal','Discount',one->'discount','AssAmt',one->'taxable','GstRt',case when coalesce(nullif(snapshot->>'taxType',''),case when snapshot->>'type'='gst-invoice' then 'GST' else 'NONE' end)='NONE' or snapshot->>'type'='delivery-challan' then 0 else coalesce((item->>'taxRate')::numeric,0) end,'IgstAmt',one->'igst','CgstAmt',one->'cgst','SgstAmt',one->'sgst','CesRt',coalesce((item->>'cessRate')::numeric,0),'CesAmt',one->'cess','TotItemVal',(one->>'taxable')::numeric+(one->>'tax')::numeric+(one->>'cess')::numeric);
  items=items||jsonb_build_array(line);
  if line->>'IsServc'='N' then goods=goods||jsonb_build_array(jsonb_build_object('productName',line->'PrdDesc','hsnCode',line->'HsnCd','quantity',line->'Qty','qtyUnit',line->'Unit','taxableAmount',line->'AssAmt','cgstRate',case when (line->>'CgstAmt')::numeric<>0 then (line->>'GstRt')::numeric/2 else 0 end,'sgstRate',case when (line->>'SgstAmt')::numeric<>0 then (line->>'GstRt')::numeric/2 else 0 end,'igstRate',case when (line->>'IgstAmt')::numeric<>0 then (line->>'GstRt')::numeric else 0 end,'cessRate',line->'CesRt'));end if;
 end loop;
 if eway then return jsonb_build_object('supplyType','O','subSupplyType',coalesce(nullif(transport->>'subSupplyType',''),'1'),'docType',case when snapshot->>'type'='delivery-challan' then 'CHL' else 'INV' end,'docNo',snapshot->>'number','docDate',dt,'fromGstin',sp->'Gstin','fromPincode',sp->'Pin','fromStateCode',sp->'Stcd','toGstin',coalesce(nullif(bp->>'Gstin',''),'URP'),'toPincode',bp->'Pin','toStateCode',bp->'Stcd','itemList',goods,'totalValue',v->'taxable','cgstValue',v->'cgst','sgstValue',v->'sgst','igstValue',v->'igst','cessValue',v->'cess','totInvValue',v->'total','transMode',coalesce(transport->>'transMode',''),'transDistance',coalesce((transport->>'transDistance')::numeric,0),'transporterId',coalesce(transport->>'transporterId',''),'vehicleNo',upper(coalesce(transport->>'vehicleNo','')),'vehicleType',coalesce(nullif(transport->>'vehicleType',''),'R'));end if;
 return jsonb_build_object('Version','1.1','TranDtls',tx,'DocDtls',doc,'SellerDtls',sp,'BuyerDtls',bp,'ItemList',items,'ValDtls',jsonb_build_object('AssVal',v->'taxable','CgstVal',v->'cgst','SgstVal',v->'sgst','IgstVal',v->'igst','CesVal',v->'cess','Discount',v->'discount','OthChrg',v->'shipping','RndOffAmt',v->'roundOff','TotInvVal',v->'total'));
end$$;

create function public.billing_compliance_command(business uuid,data_mode boolean,command_id uuid,kind text,request jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
<<cmd>>
declare prior public.billing_compliance_commands; d public.billing_issued_documents; rec public.billing_compliance_records; cfg public.billing_compliance_settings; p jsonb; response jsonb; result jsonb; item jsonb; src jsonb; totals jsonb; n integer; seq bigint; dtype text; fy text; seller text; buyer text; irn text; tz text; expiry timestamptz; now_local timestamp; distance integer; days integer; reason text; vehicle text; mode text; total numeric; k text; expected numeric; supplied numeric;
begin
 if auth.uid() is null or not public.billing_can_access(business,true) then raise exception using errcode='42501',message='Your role cannot change compliance records';end if;
 if data_mode is null or command_id is null or kind not in ('configure','generate-irn','generate-ewb','cancel-irn','cancel-ewb','update-vehicle') or jsonb_typeof(request) is distinct from 'object' then raise exception 'Invalid compliance command';end if;
 perform public.billing_ledger_writer_lock(business,false);
 select * into prior from public.billing_compliance_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_compliance_command.command_id;
 if prior.command_id is not null then if prior.actor_id<>auth.uid() or prior.request is distinct from jsonb_build_object('kind',kind,'request',request) then raise exception using errcode='40001',message='Command key already used for a different request';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 select time_zone into tz from public.billing_businesses where id=business;
 if kind='configure' then
  if jsonb_typeof(request->'enabled') is distinct from 'boolean' or coalesce(request->>'threshold','') !~ '^([0-9]{1,14})(\.[0-9]{1,2})?$' then raise exception 'Enter an enabled setting and a non-negative threshold';end if;
  insert into public.billing_compliance_settings(business_id,demo,enabled,threshold,actor_id) values(business,data_mode,(request->>'enabled')::boolean,(request->>'threshold')::numeric,auth.uid());result=jsonb_build_object('enabled',(request->>'enabled')::boolean,'threshold',(request->>'threshold')::numeric,'simulated',true);
 else
  if coalesce(request->>'documentId','')!~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Choose an issued document';end if;
  select * into d from public.billing_issued_documents x where x.document_id=(request->>'documentId')::uuid and x.business_id=business and x.demo=data_mode;
  if d.document_id is null then raise exception using errcode='P0002',message='Issued document unavailable in this business and data mode';end if;
  select * into rec from public.billing_compliance_records r where r.business_id=business and r.demo=data_mode and r.document_id=d.document_id and r.kind=case when billing_compliance_command.kind in ('generate-irn','cancel-irn') then 'irn' else 'ewb' end;
  if kind in ('generate-irn','generate-ewb') then
   if exists(select 1 from public.billing_document_cancellations c where c.document_id=d.document_id) then raise exception 'Cancelled documents are not eligible';end if;
   if rec.id is not null then raise exception 'This document already has a simulated compliance record';end if;
   if d.date>(now() at time zone tz)::date or d.number !~ '^[A-Za-z1-9][A-Za-z0-9/-]{0,15}$' then raise exception 'Document number or date is invalid';end if;
   p=request->'payload';if jsonb_typeof(p) is distinct from 'object' then raise exception 'A validated request payload is required';end if;
   if p is distinct from public.billing_compliance_payload(d.snapshot,request,kind='generate-ewb') then raise exception 'Payload differs from frozen document and transport details';end if;
   totals=(public.billing_document_totals(d.snapshot))->'totals';seller=upper(coalesce(d.snapshot->'seller'->>'gstin',''));buyer=upper(coalesce(d.snapshot->'buyer'->>'gstin',''));
   if not public.billing_compliance_gstin(seller) or seller is distinct from upper(coalesce((select b.gstin from public.billing_businesses b where b.id=business),'')) then raise exception 'Seller GSTIN must be valid and match the business GSTIN';end if;
   if kind='generate-irn' then
    if coalesce(p->'SellerDtls'->>'Stcd','')<>left(seller,2) or coalesce(p->'BuyerDtls'->>'Stcd','')<>left(buyer,2) or coalesce(p->'BuyerDtls'->>'Pos','') !~ '^(0[1-9]|[12][0-9]|3[0-8]|96|97)$' or coalesce(p->'SellerDtls'->>'Pin','') !~ '^[0-9]{6}$' or coalesce(p->'BuyerDtls'->>'Pin','') !~ '^[0-9]{6}$' or btrim(coalesce(p->'SellerDtls'->>'LglNm',''))='' or btrim(coalesce(p->'BuyerDtls'->>'LglNm',''))='' or btrim(coalesce(p->'SellerDtls'->>'Addr1',''))='' or btrim(coalesce(p->'BuyerDtls'->>'Addr1',''))='' or btrim(coalesce(p->'SellerDtls'->>'Loc',''))='' or btrim(coalesce(p->'BuyerDtls'->>'Loc',''))='' then raise exception 'Seller and buyer require valid state, address, name, city and PIN';end if;
    if p->'SellerDtls'->>'Stcd'=p->'BuyerDtls'->>'Pos' and p->'TranDtls'->>'IgstOnIntra'<>'Y' then if (totals->>'igst')::numeric<>0 or abs((totals->>'cgst')::numeric-(totals->>'sgst')::numeric)>1 then raise exception 'Intra-state tax must use CGST and SGST';end if;else if (totals->>'cgst')::numeric<>0 or (totals->>'sgst')::numeric<>0 then raise exception 'Inter-state tax must use IGST';end if;end if;
   else
    if buyer<>'' and not public.billing_compliance_gstin(buyer) then raise exception 'Recipient GSTIN is invalid';end if;
    if coalesce(p->>'fromStateCode','')<>left(seller,2) or coalesce(p->>'toStateCode','') !~ '^(0[1-9]|[12][0-9]|3[0-8]|96|97)$' or (buyer<>'' and p->>'toStateCode'<>left(buyer,2)) or coalesce(p->>'fromPincode','') !~ '^[0-9]{6}$' or coalesce(p->>'toPincode','') !~ '^[0-9]{6}$' then raise exception 'Enter valid state codes and PINs';end if;
    if coalesce(p->>'subSupplyType','') not in ('1','4','5','8') then raise exception 'Choose a supported sub-supply type';end if;
    for item in select value from jsonb_array_elements(p->'itemList') loop
     if coalesce(item->>'hsnCode','') !~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$' or item->>'hsnCode' like '99%' or (item->>'quantity')::numeric<=0 then raise exception 'Use valid goods HSN and quantity';end if;
     if p->>'fromStateCode'=p->>'toStateCode' then if (item->>'igstRate')::numeric<>0 or abs((item->>'cgstRate')::numeric-(item->>'sgstRate')::numeric)>1 then raise exception 'Intra-state tax must use CGST and SGST';end if;else if (item->>'cgstRate')::numeric<>0 or (item->>'sgstRate')::numeric<>0 then raise exception 'Inter-state tax must use IGST';end if;end if;
    end loop;
   end if;
   if kind='generate-irn' then
    select * into cfg from public.billing_compliance_settings s where s.business_id=business and s.demo=data_mode order by s.created_at desc,s.id desc limit 1;
    if not coalesce(cfg.enabled,false) then raise exception 'Enable e-invoicing first';end if;
    if d.type not in ('invoice','gst-invoice','credit-note','debit-note') or coalesce(nullif(d.snapshot->>'taxType',''),case when d.type='gst-invoice' then 'GST' else 'NONE' end)<>'GST' or not public.billing_compliance_gstin(buyer) then raise exception 'Choose a GST invoice or adjustment with a valid buyer GSTIN';end if;
    dtype=case d.type when 'credit-note' then 'CRN' when 'debit-note' then 'DBN' else 'INV' end;
    if p->>'Version'<>'1.1' or p->'DocDtls'->>'Typ'<>dtype or p->'DocDtls'->>'No'<>d.number or p->'DocDtls'->>'Dt'<>to_char(d.date,'DD/MM/YYYY') or p->'SellerDtls'->>'Gstin'<>seller or p->'BuyerDtls'->>'Gstin'<>buyer or p->'TranDtls'->>'TaxSch'<>'GST' then raise exception 'Payload identity differs from frozen document';end if;
    if jsonb_typeof(p->'ItemList') is distinct from 'array' or jsonb_array_length(p->'ItemList')<>jsonb_array_length(d.snapshot->'items') then raise exception 'Payload lines differ from frozen document';end if;
    for n in 0..jsonb_array_length(p->'ItemList')-1 loop item=p->'ItemList'->n;src=d.snapshot->'items'->n;
     if item->>'HsnCd' is distinct from src->>'hsn' or item->>'HsnCd' !~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$' or (item->>'Qty')::numeric is distinct from coalesce((src->>'quantity')::numeric,1) or (item->>'UnitPrice')::numeric is distinct from round(coalesce((src->>'rate')::numeric,0)*100)/100 or item->>'IsServc'<>(case when item->>'HsnCd' like '99%' then 'Y' else 'N' end) then raise exception 'Payload item differs from frozen line';end if;
    end loop;
    foreach k in array array['AssVal','CgstVal','SgstVal','IgstVal','CesVal','Discount','OthChrg','RndOffAmt','TotInvVal'] loop expected=coalesce((totals->>case k when 'AssVal' then 'taxable' when 'CgstVal' then 'cgst' when 'SgstVal' then 'sgst' when 'IgstVal' then 'igst' when 'CesVal' then 'cess' when 'Discount' then 'discount' when 'OthChrg' then 'shipping' when 'RndOffAmt' then 'roundOff' else 'total' end)::numeric,0);supplied=(p->'ValDtls'->>k)::numeric;if supplied is null or abs(supplied-expected)>0.01 then raise exception 'Payload totals differ from frozen document: %',k;end if;end loop;
    fy=case when extract(month from d.date)>=4 then to_char(d.date,'YYYY')||'-'||to_char(d.date+interval '1 year','YY') else to_char(d.date-interval '1 year','YYYY')||'-'||to_char(d.date,'YY') end;
    irn=encode(sha256(convert_to(seller||fy||dtype||d.number,'UTF8')),'hex');
    if exists(select 1 from public.billing_compliance_records r where r.demo=data_mode and r.kind='irn' and r.response->>'Irn'=irn) then raise exception using errcode='23505',message='2150: IRN already generated for this seller, financial year, document type and number';end if;
    select count(*)+1 into seq from public.billing_compliance_records r where r.business_id=business and r.demo=data_mode and r.kind='irn';
    response=jsonb_build_object('Irn',irn,'AckNo',lpad(seq::text,15,'0'),'AckDt',now(),'SignedQRCode','UNSIGNED-SIMULATED:'||encode(convert_to(jsonb_build_object('SellerGstin',seller,'BuyerGstin',buyer,'DocNo',d.number,'DocTyp',dtype,'DocDt',to_char(d.date,'DD/MM/YYYY'),'TotInvVal',totals->'total','ItemCnt',jsonb_array_length(p->'ItemList'),'MainHsnCode',p->'ItemList'->0->>'HsnCd','Irn',irn,'IrnDt',now())::text,'UTF8'),'base64'),'simulated',true);
   else
    if d.type not in ('invoice','gst-invoice','delivery-challan') then raise exception 'Choose an outward invoice or delivery challan';end if;
    if not exists(select 1 from jsonb_array_elements(d.snapshot->'items') x where coalesce(x->>'hsn','') ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$' and x->>'hsn' not like '99%') then raise exception 'E-way bills require goods lines';end if;
    if p->>'docNo'<>d.number or p->>'fromGstin'<>seller or (p->>'totInvValue')::numeric is distinct from (totals->>'total')::numeric then raise exception 'Payload identity or value differs from frozen document';end if;
    distance=coalesce((request->>'transDistance')::integer,0);vehicle=upper(coalesce(request->>'vehicleNo',''));mode=request->>'vehicleType';
    if distance not between 1 and 4000 or coalesce(request->>'transMode','') not in ('1','2','3','4') or mode not in ('R','O') or vehicle !~ '^([A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}|TR[A-Z0-9/-]{4,18})$' then raise exception 'Enter valid transport details and vehicle';end if;
    if coalesce(request->>'transporterId','')<>'' and upper(request->>'transporterId') !~ '^(0[1-9]|[12][0-9]|3[0-8]|96|97)[A-Z0-9]{13}$' then raise exception 'Invalid transporter ID';end if;
    days=ceil(distance::numeric/case when mode='O' then 20 else 200 end);now_local=now() at time zone tz;expiry=((now_local::date+days+1)::timestamp - interval '1 second') at time zone tz;
    select count(*)+1 into seq from public.billing_compliance_records r where r.business_id=business and r.demo=data_mode and r.kind='ewb';
    response=jsonb_build_object('ewayBillNo',lpad(seq::text,12,'0'),'ewayBillDate',now(),'validUpto',expiry,'simulated',true);
   end if;
   insert into public.billing_compliance_records(business_id,demo,document_id,kind,request,response,actor_id) values(business,data_mode,d.document_id,case when kind='generate-irn' then 'irn' else 'ewb' end,p,response,auth.uid()) returning * into rec;
   insert into public.billing_compliance_events(business_id,demo,record_id,kind,details,actor_id) values(business,data_mode,rec.id,'generated',response,auth.uid());
   result=jsonb_build_object('id',rec.id,'documentId',d.document_id,'kind',rec.kind,'status','active','request',p,'response',response,'simulated',true);
  else
   if rec.id is null then raise exception 'No simulated record exists for this document';end if;
   if exists(select 1 from public.billing_compliance_events e where e.record_id=rec.id and e.kind='cancelled') then raise exception 'This record is already cancelled';end if;
   reason=coalesce(request->>'reason','');
   if kind in ('cancel-irn','cancel-ewb') then
    if now()>rec.created_at+interval '24 hours' then raise exception 'Cancellation is only allowed within 24 hours';end if;
    if reason not in ('1','2','3','4') or length(coalesce(request->>'remark',''))>100 then raise exception 'Choose a cancellation reason and a remark of at most 100 characters';end if;
    insert into public.billing_compliance_events(business_id,demo,record_id,kind,details,actor_id) values(business,data_mode,rec.id,'cancelled',jsonb_build_object('reason',reason,'remark',coalesce(request->>'remark',''),'simulated',true),auth.uid());result=jsonb_build_object('id',rec.id,'status','cancelled','simulated',true);
   else
    vehicle=upper(coalesce(request->>'vehicleNo',''));mode=request->>'vehicleType';if now()>(rec.response->>'validUpto')::timestamptz then raise exception 'Vehicle changes require an unexpired e-way bill';end if;
    if vehicle !~ '^([A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}|TR[A-Z0-9/-]{4,18})$' or mode not in ('R','O') or length(btrim(reason)) not between 1 and 100 then raise exception 'Enter a valid vehicle, vehicle type and reason';end if;
    insert into public.billing_compliance_events(business_id,demo,record_id,kind,details,actor_id) values(business,data_mode,rec.id,'vehicle-updated',jsonb_build_object('vehicleNo',vehicle,'vehicleType',mode,'reason',reason,'simulated',true),auth.uid());result=jsonb_build_object('id',rec.id,'status','active','simulated',true);
   end if;
  end if;
 end if;
 insert into public.billing_compliance_commands(business_id,demo,command_id,actor_id,request,result) values(business,data_mode,command_id,auth.uid(),jsonb_build_object('kind',kind,'request',request),result);return result||jsonb_build_object('replayed',false);
end$$;
create function public.billing_compliance_replay(business uuid,data_mode boolean,command_id uuid,kind text,request jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
<<replay>>
declare prior public.billing_compliance_commands;
begin
 if auth.uid() is null or not public.billing_can_access(business,true) then raise exception using errcode='42501',message='Your role cannot change compliance records';end if;
 if data_mode is null or command_id is null or jsonb_typeof(request) is distinct from 'object' then raise exception 'Invalid compliance command';end if;
 select * into prior from public.billing_compliance_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_compliance_replay.command_id;
 if prior.command_id is null then return null;end if;
 if prior.actor_id<>auth.uid() or prior.request->>'kind' is distinct from kind or (prior.request->'request'-'payload') is distinct from request then raise exception using errcode='40001',message='Command key already used for a different request';end if;
 return prior.result||jsonb_build_object('replayed',true);
end$$;
DO $$declare fn regprocedure;begin for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'billing_compliance_%' loop execute format('revoke all on function %s from public,anon,authenticated',fn);end loop;end$$;
grant execute on function public.billing_compliance_read(uuid,boolean),public.billing_compliance_command(uuid,boolean,uuid,text,jsonb),public.billing_compliance_replay(uuid,boolean,uuid,text,jsonb) to authenticated;
notify pgrst,'reload schema';
