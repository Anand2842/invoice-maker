import{spawnSync}from'node:child_process';
const files=['public/layout.js','public/mirror.js','public/navigation.js','public/services.js','public/settings.js','public/workspace-shell.js','public/confirm.js','lib/profile.mjs','lib/dashboard.mjs','lib/workflows.mjs','public/free-online-invoice-generator/invoice-app.js','public/free-online-invoice-generator/invoice-public.js','public/document-export.js','lib/business.mjs'];
for(const file of files){const r=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(r.status)process.exit(r.status)}
console.log('JavaScript syntax checks passed');
