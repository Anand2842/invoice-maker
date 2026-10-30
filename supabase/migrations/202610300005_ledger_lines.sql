-- Read-only, keyset-paginated account ledger. Balances include every preceding entry,
-- not merely rows on the current page. Posted originals and reversals stay separate.
create function public.billing_ledger_lines(
 business uuid,data_mode boolean,account_id uuid,from_date date,to_date date,
 after_date date default null,after_batch uuid default null,after_line integer default null,page_size integer default 100,snapshot_number bigint default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare account public.billing_ledger_accounts;currency text;opening numeric;closing numeric;result_rows jsonb;next_cursor jsonb=null;ceiling bigint;current_ceiling bigint;
begin
 if auth.uid() is null or not public.billing_can_access(business) then raise exception using errcode='42501',message='Business ledger unavailable';end if;
 if data_mode is null or account_id is null or from_date is null or to_date is null or not isfinite(from_date) or not isfinite(to_date) or from_date>to_date then raise exception 'Choose an account and valid report date range';end if;
 if page_size is null or page_size not between 1 and 200 then raise exception 'Ledger page size must be between 1 and 200';end if;
 if num_nonnulls(after_date,after_batch,after_line) not in (0,3) then raise exception 'Provide the complete ledger page cursor';end if;
 select * into account from public.billing_ledger_accounts a where a.id=billing_ledger_lines.account_id and a.business_id=business and a.demo=data_mode;
 if account.id is null then raise exception 'Account unavailable in this business and data mode';end if;
 select c.currency,c.next_number-1 into currency,current_ceiling from public.billing_ledger_configs c where c.business_id=business and c.demo=data_mode;
 if after_date is not null and snapshot_number is null then raise exception 'Continue ledger pages with the original snapshot number';end if;
 ceiling=coalesce(snapshot_number,current_ceiling);
 if ceiling<0 or ceiling>current_ceiling then raise exception 'Ledger snapshot number is outside the posted sequence';end if;
 if after_date is not null then
  if not isfinite(after_date) or after_date<from_date or after_date>to_date or after_line not between 1 and 200 or not exists(
   select 1 from public.billing_ledger_entries e join public.billing_ledger_batches b on b.id=e.batch_id
   where e.business_id=business and e.demo=data_mode and e.account_id=billing_ledger_lines.account_id and e.batch_id=after_batch and e.line=after_line and b.date=after_date and substring(b.number from '([0-9]+)$')::bigint<=ceiling
  ) then raise exception 'Ledger page cursor is invalid for this account and period';end if;
 end if;
 select coalesce(sum(e.debit-e.credit) filter(where b.date<from_date),0),coalesce(sum(e.debit-e.credit),0) into opening,closing
 from public.billing_ledger_entries e join public.billing_ledger_batches b on b.id=e.batch_id
 where e.business_id=business and e.demo=data_mode and e.account_id=billing_ledger_lines.account_id and b.date<=to_date and substring(b.number from '([0-9]+)$')::bigint<=ceiling;
 with running as(
  select b.date,b.id as batch_id,b.number,b.description,e.line,e.debit,e.credit,
   opening+sum(e.debit-e.credit) over(order by b.date,b.id,e.line rows between unbounded preceding and current row) as balance
  from public.billing_ledger_entries e join public.billing_ledger_batches b on b.id=e.batch_id
  where e.business_id=business and e.demo=data_mode and e.account_id=billing_ledger_lines.account_id and b.date between from_date and to_date and substring(b.number from '([0-9]+)$')::bigint<=ceiling
 ),page as(
  select * from running where after_date is null or (date,batch_id,line)>(after_date,after_batch,after_line)
  order by date,batch_id,line limit page_size+1
 )
 select coalesce(jsonb_agg(jsonb_build_object('date',date,'batchId',batch_id,'number',number,'description',description,'line',line,'debit',debit::text,'credit',credit::text,'balance',balance::text) order by date,batch_id,line),'[]'::jsonb) into result_rows from page;
 if jsonb_array_length(result_rows)>page_size then
  next_cursor=jsonb_build_object('date',result_rows->(page_size-1)->>'date','batch',result_rows->(page_size-1)->>'batchId','line',(result_rows->(page_size-1)->>'line')::integer,'snapshot',ceiling::text);
  result_rows=result_rows-page_size;
 end if;
 return jsonb_build_object('currency',currency,'snapshotNumber',ceiling::text,'account',jsonb_build_object('id',account.id,'code',account.code,'name',account.name,'type',account.type),'opening',opening::text,'closing',closing::text,'rows',result_rows,'next',next_cursor);
end$$;
revoke all on function public.billing_ledger_lines(uuid,boolean,uuid,date,date,date,uuid,integer,integer,bigint) from public,anon,authenticated;
grant execute on function public.billing_ledger_lines(uuid,boolean,uuid,date,date,date,uuid,integer,integer,bigint) to authenticated;
notify pgrst,'reload schema';
