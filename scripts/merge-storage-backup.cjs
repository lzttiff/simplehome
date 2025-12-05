const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');

// Generate deterministic UUID v5-like ID from a namespace and name
function deterministicUUID(namespace, name) {
  const hash = createHash('sha1').update(`${namespace}:${name}`).digest();
  // Set version (5) and variant bits per UUID v5 spec
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
}

const dataDir = path.resolve(__dirname, '..', 'data');
const storagePath = path.join(dataDir, 'storage.json');
const backupPath = path.join(dataDir, 'storage.json.pre-schema-backup.json');

if (!fs.existsSync(storagePath)) {
  console.error('storage.json missing');
  process.exit(1);
}
if (!fs.existsSync(backupPath)) {
  console.error('backup not found:', backupPath);
  process.exit(1);
}

const current = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));

const out = { ...current };

// If backup has templates/tasks, copy them but update template IDs to be deterministic
if (Array.isArray(backup.templates)) {
  const oldIdToNewId = {};
  const updatedTemplates = backup.templates.map(t => {
    const detId = deterministicUUID('simplehome-template', t.type);
    oldIdToNewId[t.id] = detId;
    return { ...t, id: detId };
  });
  out.templates = updatedTemplates;
  
  // Update task templateIds to match new deterministic IDs
  if (Array.isArray(backup.tasks)) {
    out.tasks = backup.tasks.map(task => {
      if (task.templateId && oldIdToNewId[task.templateId]) {
        return { ...task, templateId: oldIdToNewId[task.templateId] };
      }
      return task;
    });
  }
} else if (Array.isArray(backup.tasks)) {
  out.tasks = backup.tasks;
}

if (backup.responses && typeof backup.responses === 'object') out.responses = backup.responses;

fs.writeFileSync(storagePath, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log('Merged backup templates/tasks into', storagePath);
