const fs = require('fs');
const path = require('path');

const DIR = process.cwd();
const TARGET = '2025-10-10';

function updateFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  // replace minor/major date values (including empty strings) inside JSON
  const updated = raw
    .replace(/("minor"\s*:\s*")([0-9]{4}-[0-9]{2}-[0-9]{2}|")/g, `$1${TARGET}`)
    .replace(/("major"\s*:\s*")([0-9]{4}-[0-9]{2}-[0-9]{2}|")/g, `$1${TARGET}`);
  fs.writeFileSync(filePath, updated, 'utf8');
  console.log('Updated', filePath);
}

const files = fs.readdirSync(DIR).filter(f => f.startsWith('maintenance-template') && f.endsWith('.json'));
if (files.length === 0) {
  console.error('No maintenance-template-*.json files found in', DIR);
  process.exit(1);
}
for (const f of files) {
  updateFile(path.join(DIR, f));
}
console.log('Done');
