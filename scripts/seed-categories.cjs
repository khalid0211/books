const { PrismaClient } = require('@prisma/client');
const fs = require('node:fs');
const ts = require('typescript');
const output = ts.transpileModule(fs.readFileSync('src/lib/classification.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const moduleData = { exports: {} };
new Function('exports', output)(moduleData.exports);
const db = new PrismaClient();
(async () => {
  for (const name of moduleData.exports.STARTER_CATEGORIES) {
    await db.category.upsert({ where: { nameKey: name.toLowerCase() }, create: { name, nameKey: name.toLowerCase() }, update: {} });
  }
  console.log('Starter categories are ready. Books remain unclassified until reviewed.');
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
