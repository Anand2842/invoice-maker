import fs from 'node:fs/promises';
import { chromium } from '/Users/raunakpatel/.npm/_npx/af752b90495482d7/node_modules/playwright-core/index.mjs';
import { SourceAssets } from './mirror-source.mjs';

const directory = 'dist/free-online-invoice-generator';
const source = 'artifacts/source/extra-controls';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage();
await page.route('**/*', route => route.abort());
const extras = {};
async function read(name, select) {
  await page.setContent(await fs.readFile(`${source}/${name}.html`, 'utf8'), { waitUntil: 'domcontentloaded' });
  return page.evaluate(select);
}
try {
  extras.shipping = await read('shipping-desktop', () => [...document.querySelectorAll('[class*="ShippingDetails_shippingDetailsWrapper"]')].map(e => e.outerHTML));
  extras.shippingMobile = await read('shipping-mobile', () => [...document.querySelectorAll('[class*="ShippingDetails_shippingDetailsWrapper"]')].map(e => e.outerHTML));
  extras.customSelect = await read('custom-header-desktop', () => [...document.querySelectorAll('[class*="CustomFieldsContainer_addRow"]')].find(e => e.querySelector('[name="customFieldOptions"]')).outerHTML);
  extras.customDialog = await read('custom-dialog', () => [...document.querySelectorAll('[data-mode="modal"][data-visible="true"]')].at(-1).parentElement.outerHTML);
  extras.cessDialog = await read('cess-dialog', () => [...document.querySelectorAll('[data-mode="modal"][data-visible="true"]')].at(-1).parentElement.outerHTML);
  extras.attachments = await read('attachments-open', () => [...document.querySelector('form').children].find(e => /Attachment/.test(e.className) || /Attachments/.test(e.innerText) && e.querySelector('input[type="file"]'))?.outerHTML || '');
  for (const name of ['calendar', 'description', 'description-mobile', 'signature', 'signature-pad']) {
    const file = name === 'description-mobile' ? 'description-source-mobile.html' : `${name}-source.html`;
    extras[name] = await fs.readFile(`${directory}/${file}`, 'utf8');
  }
  await page.setContent(`<div>${Object.values(extras).flat().join('')}</div>`, { waitUntil: 'domcontentloaded' });
  const clean = html => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/\s+on[a-z]+=("[^"]*"|'[^']*')/gi, '');
  for (const key of Object.keys(extras)) extras[key] = Array.isArray(extras[key]) ? extras[key].map(clean) : clean(extras[key]);
  await fs.writeFile(`${directory}/extras.json`, JSON.stringify(extras));
  const css = await Promise.all(['shipping-mobile', 'custom-dialog', 'cess-dialog', 'attachments-open'].map(name => fs.readFile(`${source}/${name}.css`, 'utf8')));
  css.push(await fs.readFile(`${directory}/extra-source.css`, 'utf8'));
  const assets = new SourceAssets(`${directory}/assets`, '/free-online-invoice-generator/assets');
  await fs.writeFile(`${directory}/extras-source.css`, await assets.css([...new Set(css)].join('\n'), 'https://www.refrens.com/free-online-invoice-generator'));
  console.log('Packed observed source invoice controls', Object.keys(extras), 'asset failures', assets.failures.length);
} finally { await browser.close(); }
