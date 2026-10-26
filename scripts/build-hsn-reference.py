import json,re,gzip,hashlib,argparse
from pathlib import Path
import pdfplumber
parser=argparse.ArgumentParser(description='Build the reference using downloaded official HS JSON and SAC PDF (requires pdfplumber).')
parser.add_argument('--hs-json',required=True);parser.add_argument('--sac-pdf',required=True);parser.add_argument('--output',default='public/data/hsn-sac.json');args=parser.parse_args()
rows=[]
for r in json.loads(Path(args.hs_json).read_text())['results']:
 if re.fullmatch(r'\d{4}',r['id']):rows.append({'code':r['id'],'type':'HSN','description':r['text'].split(' - ',1)[-1],'gstRate':None,'cessRate':None})
with pdfplumber.open(args.sac_pdf) as doc:
 for page in doc.pages:
  for table in page.extract_tables():
   for r in table:
    if len(r)>=4 and re.fullmatch(r'99\d{4}',r[2] or ''):
     rows.append({'code':r[2],'type':'SAC','description':' '.join((r[3]or'').split()),'gstRate':18 if r[2] in ['998313','998314','998315','998316','998319'] else None,'cessRate':0 if r[2] in ['998313','998314','998315','998316','998319'] else None})
rows=list({r['code']:r for r in rows}.values());rows.sort(key=lambda r:r['code'])
data={'version':'2026-10-25-reference','sources':[{'name':'UNSD HS 2022 four-digit headings','url':'https://comtradeapi.un.org/files/v1/app/reference/H6.json','sha256':hashlib.sha256(Path(args.hs_json).read_bytes()).hexdigest()},{'name':'GST Council amended classification of services','url':'https://gstcouncil.gov.in/sites/default/files/2024-02/scheme_of_classification_of_services_amended.pdf','sha256':hashlib.sha256(Path(args.sac_pdf).read_bytes()).hexdigest()},{'name':'Services rate schedule; IT suggestions require applicability review','url':'https://www.gstcouncil.gov.in/sites/default/files/2024-02/gstservicerates.pdf'}],'limitations':['Reference classification, not a complete current Indian tariff or rate database. Goods headings are four-digit HS 2022 references; check the required six/eight-digit classification for filing.','A null rate means not verified. The picker preserves the existing rate and asks for review. IT service suggestions are conditional; exemptions and export treatment may differ.'],'entries':rows}
out=json.dumps(data,ensure_ascii=False,separators=(',',':')).encode();Path(args.output).write_bytes(out);print(json.dumps({'codes':len(rows),'goods':sum(r['type']=='HSN'for r in rows),'services':sum(r['type']=='SAC'for r in rows),'gzipBytes':len(gzip.compress(out)),'sample':next(r for r in rows if r['code']=='998314')}))
