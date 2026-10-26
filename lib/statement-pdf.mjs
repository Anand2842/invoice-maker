import{PDFDocument,StandardFonts,rgb}from'pdf-lib';
export async function statementPDF(r){
 if(r.rows.length>2000)throw Error('PDF supports up to 2,000 statement movements. Use CSV for larger reports.');
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);let page,y,pageNo=0;
 const clean=s=>String(s??'').replace(/[\r\n\t]/g,' ').replace(/₹/g,'INR ').trim();
 function draw(text,x,y,size=10,b=false){try{page.drawText(clean(text),{x,y,size,font:b?bold:font,color:rgb(.15,.12,.2)})}catch{throw Error('Statement PDF supports Latin text. Use CSV for names in other writing systems.')}}
 function fit(text,width,size=9){text=clean(text);try{while(font.widthOfTextAtSize(text,size)>width)text=text.slice(0,-4)+'...';return text}catch{throw Error('Statement PDF supports Latin text. Use CSV for names in other writing systems.')}}
 function next(){page=pdf.addPage([595.28,841.89]);pageNo++;y=790;draw('Client statement',36,y,18,true);draw(fit(r.businessName,360,11),36,y-=22,11);draw(r.currency+' | '+r.from+' to '+r.to,36,y-=18);draw(fit(r.clientName,500),36,y-=16);draw('Page '+pageNo,510,28,9);y-=28}
 function line(text,b=false){if(y<65)next();draw(fit(text,520,10),36,y,10,b);y-=18}
 const amount=n=>Number(n).toFixed(2);
 function headings(){if(y<90)next();for(const[t,x]of[['Date',36],['Type / reference',108],['Debit',360],['Credit',430],['Balance',500]])draw(t,x,y,9,true);y-=20}
 next();line('Opening '+amount(r.opening)+' | Debits '+amount(r.debits)+' | Credits '+amount(r.credits),true);line('Closing balance '+amount(r.closing)+' '+r.currency,true);line('Review issues: '+r.issues.length+' | Excluded records: '+r.excluded.length);headings();
 for(const row of r.rows){if(y<65){next();headings()}draw(row.date,36,y,9);draw(fit(row.type+' / '+row.number,242),108,y,9);for(const[n,x]of[[row.debit,360],[row.credit,430],[row.balance,500]])draw(amount(n),x,y,Math.min(8,65/font.widthOfTextAtSize(amount(n),1)));y-=14;draw(fit(row.clientName,400,8),108,y,8);y-=19}
 y-=12;line('Receivables aging as of '+r.to,true);for(const[k,label]of Object.entries({current:'Current / not overdue',days1to30:'1-30 days overdue',days31to60:'31-60 days overdue',days61to90:'61-90 days overdue',daysOver90:'Over 90 days overdue',undated:'No due date'}))line(label+': '+amount(r.buckets[k])+' '+r.currency);line('Credit balances: '+amount(r.creditBalance)+' '+r.currency);line('Net balance: '+amount(r.closing)+' '+r.currency,true);
 line('Review notes',true);for(const issue of r.issues){line(issue.code+' | '+issue.recordId);wrap(issue.message)}for(const limit of r.limitations)wrap(limit);
 function wrap(text){let row='';for(const word of clean(text).split(' ')){if(font.widthOfTextAtSize(row+' '+word,10)>510){line(row);row=word}else row+=(row?' ':'')+word}if(row)line(row)}
 return pdf.save();
}
