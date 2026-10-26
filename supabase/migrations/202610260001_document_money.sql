-- Monetary values are derived from line inputs at the database boundary.
-- This guards direct authenticated REST writes as well as application writes.
create or replace function public.billing_decimal(v jsonb, label text, fallback numeric default 0, maximum numeric default 1000000000000)
returns numeric language plpgsql immutable set search_path='' as $$
declare raw text; parts text[]; exponent integer; scale integer; n numeric;
begin
 if v is null or v='null'::jsonb or v='""'::jsonb then return fallback; end if;
 if jsonb_typeof(v) not in ('string','number') then raise exception '% must be a decimal number',label; end if;
 raw=btrim(v#>>'{}');
 if length(raw)>100 or raw!~* '^\+?([0-9]*\.?[0-9]+)(e[+-]?[0-9]+)?$' then raise exception '% must be a decimal number',label; end if;
 parts=regexp_match(raw,'^\+?([0-9]*\.?[0-9]+)(?:e([+-]?[0-9]+))?$','i');
 -- Check the exponent before casting it to an integer.
 if abs(coalesce(parts[2],'0')::numeric)>30 then raise exception '% has too much decimal precision',label; end if;
 exponent=coalesce(parts[2],'0')::integer;
 scale=case when strpos(parts[1],'.')>0 then length(split_part(parts[1],'.',2)) else 0 end-exponent;
 if abs(scale)>30 then raise exception '% has too much decimal precision',label; end if;
 n=raw::numeric;
 if n<0 or n>maximum then raise exception '% is outside the supported range',label; end if;
 return n;
end $$;

create or replace function public.billing_document_totals(d jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare kind text; currency text; tax_type text; gst_mode text; item jsonb; shipping jsonb;
 q numeric; rate numeric; discount numeric; discount_type text; tax_rate numeric; cess_rate numeric;
 subtotal numeric; taxable numeric; tax numeric; cgst numeric; sgst numeric; igst numeric; vat numeric; cess numeric;
 quantity numeric=0; m jsonb='{"subtotal":0,"discount":0,"taxable":0,"cgst":0,"sgst":0,"igst":0,"vat":0,"cess":0,"tax":0,"shipping":0,"roundOff":0,"preRoundTotal":0,"total":0}';
 line jsonb; groups jsonb='{}'; group_row jsonb; group_key text; k text; v jsonb; result jsonb; pre_total numeric; total numeric; rounded boolean=false;
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

create or replace function public.billing_document_money_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.collection='documents' then new.data=new.data||public.billing_document_totals(new.data); end if;
 return new;
end $$;
-- PostgreSQL executes BEFORE triggers in name order: calculate before note limits.
create trigger billing_00_document_money before insert or update on public.billing_records
for each row execute function public.billing_document_money_guard();
notify pgrst,'reload schema';
