import test from 'node:test';
import assert from 'node:assert/strict';
import{brandColor,templateStyle}from'../public/pdf-templates/index.js';

test('the old purple saved as a business brand colour prints as teal; chosen colours are kept',()=>{
 assert.equal(brandColor('#3c136b'),'#115e59');
 assert.equal(brandColor('#5B3FA8'),'#115e59');
 assert.equal(brandColor('#c2410c'),'#c2410c');
 assert.deepEqual(templateStyle('modern','#3c136b'),templateStyle('modern','#115e59'));
 assert.notDeepEqual(templateStyle('modern','#c2410c'),templateStyle('modern','#115e59'));
 assert.throws(()=>templateStyle('modern','purple'),/valid brand color/);
});
