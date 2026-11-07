import test from 'node:test';
import assert from 'node:assert/strict';
import {indianWords,rupeesInWords,build} from '../public/document-export.js';

test('Amounts read in Indian numbering with paise',()=>{
 assert.equal(indianWords(0),'Zero');
 assert.equal(indianWords(15),'Fifteen');
 assert.equal(indianWords(105),'One Hundred Five');
 assert.equal(indianWords(100000),'One Lakh');
 assert.equal(indianWords(1234567),'Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven');
 assert.equal(indianWords(250000000),'Twenty Five Crore');
 assert.equal(rupeesInWords(71680),'Rupees Seven Hundred Sixteen and Eighty Paise Only');
 assert.equal(rupeesInWords(100),'Rupees One Only');
});

test('GST PDF shows place of supply by state and the total in words',()=>{
 const text=Buffer.from(build({type:'gst-invoice',number:'INV-1',date:'2026-11-07',currency:'INR',taxType:'GST',gstMode:'igst',seller:{name:'S',gstin:'27BBBBB1111B1Z6'},buyer:{name:'B',gstin:'29AAAAA0000A1Z5'},items:[{name:'Paper',hsn:'4802',quantity:2,rate:320,taxRate:12}],taxDetails:{placeOfSupply:'29',reverseCharge:'No'}}).bytes).toString('latin1');
 assert.match(text,/Place of supply: Karnataka \\\(29\\\)/);
 assert.match(text,/Amount in words: Rupees Seven Hundred Sixteen and Eighty Paise Only/);
 assert.match(text,/HSN\/SAC: 4802/);
});
