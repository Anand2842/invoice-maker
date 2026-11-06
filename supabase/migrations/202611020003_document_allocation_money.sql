-- Additive money-function replacement. Pure arithmetic only: sales-order
-- conversion authority separately proves frozen IDs, source values and scope.
create or replace function public.billing_document_source_allocation(i jsonb,c jsonb,kind text,tax_type text,gst_mode text) returns jsonb
language plpgsql immutable set search_path='' as $$
declare s jsonb=i->'sourceAllocation'; k text; a jsonb; raw text; n numeric;
 source_q numeric; before_q numeric; after_q numeric; q numeric;
 source_value numeric; prior numeric; component numeric; remaining numeric; expected numeric;
 parts jsonb; subtotal numeric; tax numeric; total numeric;
 keys text[]=array['taxable','discount','cgst','sgst','igst','vat','cess']; forbidden text[];
begin
 if c is not null and c<>'null'::jsonb then
  if jsonb_typeof(c)<>'object' or c->'version' is distinct from '1'::jsonb or c->>'policy' is distinct from 'cumulative-proportion-final-residual' or c->>'kind' is distinct from kind or kind not in ('invoice','gst-invoice','commercial-invoice','delivery-challan','credit-note') or coalesce(c->>'conversionId','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Invalid reviewed source document conversion'; end if;
 else
  if s is not null and s<>'null'::jsonb then raise exception 'Source line allocation requires a reviewed document conversion'; end if;
  return null;
 end if;
 if s is null or s='null'::jsonb then raise exception 'Every converted document line requires its frozen source allocation'; end if;
 if jsonb_typeof(s)<>'object' or s->'version' is distinct from '1'::jsonb or s->>'policy' is distinct from 'cumulative-proportion-final-residual' or s->'reviewed' is distinct from 'true'::jsonb or coalesce(s->>'sourceLineId','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or coalesce(s->>'conversionLineId','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or i->>'id' is distinct from s->>'conversionLineId' then raise exception 'Invalid reviewed source line allocation'; end if;
 foreach k in array array['sourceQuantity','quantityBefore','quantityAfter'] loop
  raw=s->>k;
  if jsonb_typeof(s->k) is distinct from 'string' or raw!~'^[0-9]{1,10}(\.[0-9]{1,6})?$' then raise exception 'Source allocation quantities require decimal strings with at most six places'; end if;
  n=raw::numeric; if n>1000000000 then raise exception 'Source allocation quantity exceeds supported range'; end if;
  if k='sourceQuantity' then source_q=n; elsif k='quantityBefore' then before_q=n; else after_q=n; end if;
 end loop;
 raw=i->>'quantity';
 if jsonb_typeof(i->'quantity') not in ('string','number') or raw is null or raw!~'^[0-9]{1,10}(\.[0-9]{1,6})?$' then raise exception 'Source allocation quantities require at most six places'; end if;
 q=raw::numeric;
 if source_q<=0 or q<=0 or before_q+q<>after_q or after_q>source_q then raise exception 'Source allocation quantity interval is invalid'; end if;
 foreach k in array array['sourceTotals','allocatedBefore','components'] loop
  a=s->k;
  if jsonb_typeof(a) is distinct from 'object' then raise exception 'Source allocation requires all seven monetary components'; end if;
  if (select count(*) from jsonb_object_keys(a))<>7 or not a?&keys then raise exception 'Source allocation requires all seven monetary components'; end if;
  for raw in select value#>>'{}' from jsonb_each(a) loop
   if raw!~'^[0-9]{1,16}$' or raw::numeric>9007199254740991 then raise exception 'Source allocation monetary components must be safe non-negative integer cent strings'; end if;
  end loop;
  if exists(select 1 from jsonb_each(a) where jsonb_typeof(value)<>'string') then raise exception 'Source allocation monetary components must be strings'; end if;
 end loop;
 parts='{}'::jsonb;
 foreach k in array keys loop
  source_value=(s->'sourceTotals'->>k)::numeric;prior=(s->'allocatedBefore'->>k)::numeric;component=(s->'components'->>k)::numeric;
  if prior>source_value then raise exception 'Source allocation exceeds frozen source amount'; end if;
  remaining=source_value-prior;
  expected=case when after_q=source_q then remaining else greatest(0,least(remaining,div(source_value*after_q*2+source_q,source_q*2)-prior)) end;
  if component<>expected then raise exception 'Source allocation does not match cumulative rounding policy'; end if;
  parts=parts||jsonb_build_object(k,component);
 end loop;
 forbidden=case when kind='delivery-challan' or tax_type='NONE' then array['cgst','sgst','igst','vat','cess'] when tax_type='VAT' then array['cgst','sgst','igst','cess'] when gst_mode='igst' then array['cgst','sgst','vat'] else array['igst','vat'] end;
 foreach k in array forbidden loop
  if (s->'sourceTotals'->>k)::numeric<>0 then raise exception 'Source allocation tax components do not match document tax scheme'; end if;
 end loop;
 subtotal=(parts->>'taxable')::numeric+(parts->>'discount')::numeric;
 tax=(parts->>'cgst')::numeric+(parts->>'sgst')::numeric+(parts->>'igst')::numeric+(parts->>'vat')::numeric;
 total=(parts->>'taxable')::numeric+tax+(parts->>'cess')::numeric;
 if greatest(subtotal,tax,total)>9007199254740991 then raise exception 'Source allocation is too large to export accurately'; end if;
 return parts||jsonb_build_object('subtotal',subtotal,'tax',tax,'total',total);
end $$;

create or replace function public.billing_document_totals(d jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare kind text; currency text; tax_type text; gst_mode text; item jsonb; shipping jsonb;
 q numeric; rate numeric; discount numeric; discount_type text; tax_rate numeric; cess_rate numeric;
 subtotal numeric; taxable numeric; tax numeric; cgst numeric; sgst numeric; igst numeric; vat numeric; cess numeric;
 quantity numeric=0; m jsonb='{"subtotal":0,"discount":0,"taxable":0,"cgst":0,"sgst":0,"igst":0,"vat":0,"cess":0,"tax":0,"shipping":0,"roundOff":0,"preRoundTotal":0,"total":0}';
 allocation jsonb; line jsonb; groups jsonb='{}'; group_row jsonb; group_key text; k text; v jsonb; result jsonb; pre_total numeric; total numeric; rounded boolean=false;
begin
 kind=regexp_replace(lower(btrim(coalesce(nullif(d->>'type',''),'invoice'))),'[ _]+','-','g');
 kind=case kind when 'proforma-invoice' then 'proforma' when 'tax-invoice' then 'gst-invoice' when 'quote' then 'quotation' when 'purchaseorder' then 'purchase-order' when 'deliverychallan' then 'delivery-challan' else kind end;
 if kind not in ('invoice','gst-invoice','quotation','proforma','purchase-order','delivery-challan','commercial-invoice','credit-note','debit-note') then raise exception 'Unsupported document type'; end if;
 currency=upper(btrim(coalesce(nullif(d->>'currency',''),'INR')));
 if currency!~'^[A-Z]{3}$' then raise exception 'Currency must be a three-letter code'; end if;
 tax_type=upper(coalesce(nullif(d->>'taxType',''),case when kind='gst-invoice' then 'GST' else 'NONE' end));
 gst_mode=coalesce(nullif(d->>'gstMode',''),'split');
 if tax_type not in ('GST','VAT','NONE') or gst_mode not in ('split','igst') then raise exception 'Invalid tax type or GST mode'; end if;
 if jsonb_typeof(d->'items') is distinct from 'array' then raise exception 'Add between 1 and 1,000 document items'; end if;
 if jsonb_array_length(d->'items') not between 1 and 1000 then raise exception 'Add between 1 and 1,000 document items'; end if;
 for item in select value from jsonb_array_elements(d->'items') loop
  if jsonb_typeof(item)<>'object' then raise exception 'Document item must be an object'; end if;
  q=public.billing_decimal(item->'quantity','Quantity',1,1000000000);
  if q=0 then raise exception 'Quantity must be greater than zero'; end if;
  quantity=quantity+q;
  rate=public.billing_decimal(item->'rate','Rate');
  subtotal=round(q*rate*100);
  discount=public.billing_decimal(item->'discount','Discount');
  discount_type=lower(coalesce(nullif(item->>'discountType',''),'fixed'));
  if discount_type in ('percent','percentage','%') then
   if discount>100 then raise exception 'Percentage discount cannot exceed 100'; end if;
   discount=round(subtotal*discount/100);
  elsif discount_type in ('fixed','amount') then discount=round(discount*100);
  else raise exception 'Discount type must be fixed or percent'; end if;
  allocation=public.billing_document_source_allocation(item,d->'orderConversion',kind,tax_type,gst_mode);
  if allocation is not null then subtotal=(allocation->>'subtotal')::numeric;discount=(allocation->>'discount')::numeric; end if;
  if discount>subtotal then raise exception 'Discount cannot exceed its line amount'; end if;
  taxable=subtotal-discount;
  tax_rate=public.billing_decimal(item->'taxRate','Tax rate',0,100);
  cess_rate=public.billing_decimal(item->'cessRate','Cess rate',0,1000);
  if cess_rate>0 and (tax_type<>'GST' or kind='delivery-challan') then raise exception 'Percentage cess requires a GST document'; end if;
  tax=case when tax_type<>'NONE' and kind<>'delivery-challan' then round(taxable*tax_rate/100) else 0 end;
  cgst=case when tax_type='GST' and gst_mode='split' then floor(tax/2) else 0 end;
  sgst=case when tax_type='GST' and gst_mode='split' then tax-cgst else 0 end;
  igst=case when tax_type='GST' and gst_mode='igst' then tax else 0 end;
  vat=case when tax_type='VAT' then tax else 0 end;
  cess=round(taxable*cess_rate/100);
  if allocation is not null then
   tax=(allocation->>'tax')::numeric;cgst=(allocation->>'cgst')::numeric;sgst=(allocation->>'sgst')::numeric;igst=(allocation->>'igst')::numeric;vat=(allocation->>'vat')::numeric;cess=(allocation->>'cess')::numeric;
  end if;
  line=jsonb_build_object('subtotal',subtotal,'discount',discount,'taxable',taxable,'tax',tax,'cgst',cgst,'sgst',sgst,'igst',igst,'vat',vat,'cess',cess);
  for k,v in select * from jsonb_each(line) loop
   m=jsonb_set(m,array[k],to_jsonb((m->>k)::numeric+(v#>>'{}')::numeric));
   if (m->>k)::numeric>9007199254740991 then raise exception 'Amount is too large to export accurately'; end if;
  end loop;
  if taxable+tax+cess>9007199254740991 then raise exception 'Amount is too large to export accurately'; end if;
  if tax_type<>'NONE' and kind<>'delivery-challan' then
   group_key=trim_scale(tax_rate)::text;
   group_row=coalesce(groups->group_key,jsonb_build_object('rate',tax_rate,'taxable',0,'tax',0,'cgst',0,'sgst',0,'igst',0,'vat',0));
   foreach k in array array['taxable','tax','cgst','sgst','igst','vat'] loop
    group_row=jsonb_set(group_row,array[k],to_jsonb((group_row->>k)::numeric+(line->>k)::numeric));
   end loop;
   groups=jsonb_set(groups,array[group_key],group_row);
  end if;
 end loop;
 shipping=d->'shipping';
 if jsonb_typeof(shipping)='object' then shipping=coalesce(nullif(shipping->'amount','null'::jsonb),nullif(shipping->'charge','null'::jsonb),'0'); end if;
 -- Legacy free-form shipping addresses carry no charge. Numeric strings remain validated.
 if jsonb_typeof(shipping)='string' and btrim(shipping#>>'{}')!~* '^[+-]?([0-9]*\.?[0-9]+)(e[+-]?[0-9]+)?$' then shipping='0'; end if;
 m=jsonb_set(m,'{shipping}',to_jsonb(round(public.billing_decimal(shipping,'Shipping charge')*100)));
 if d?'roundOff' then
  if jsonb_typeof(d->'roundOff')<>'boolean' then raise exception 'Round-off must be enabled or disabled'; end if;
  rounded=(d->>'roundOff')::boolean;
 end if;
 if rounded and (currency<>'INR' or kind='delivery-challan') then raise exception 'Rupee round-off is only available for INR amount documents'; end if;
 pre_total=(m->>'taxable')::numeric+(m->>'tax')::numeric+(m->>'cess')::numeric+(m->>'shipping')::numeric;
 total=case when rounded then round(pre_total/100)*100 else pre_total end;
 if greatest(pre_total,total)>9007199254740991 then raise exception 'Amount is too large to export accurately'; end if;
 m=m||jsonb_build_object('preRoundTotal',pre_total,'total',total,'roundOff',total-pre_total);
 select jsonb_object_agg(key,(value#>>'{}')::numeric/100) into result from jsonb_each(m);
 return jsonb_build_object('type',kind,'currency',currency,'taxType',tax_type,'gstMode',gst_mode,'roundOff',rounded,'totals',result||jsonb_build_object('minor',m,'quantity',quantity,'currency',currency,'displayAmounts',kind<>'delivery-challan','taxGroups',coalesce((select jsonb_agg(value order by (value->>'rate')::numeric) from jsonb_each(groups)),'[]'::jsonb)));
end $$;


notify pgrst,'reload schema';
