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

const storagePath = path.resolve(__dirname, '..', 'data', 'storage.json');
const backupPath = path.resolve(__dirname, '..', 'data', 'storage.json.pre-schema-backup.json');

function safeDateObj(value) {
  if (!value) return { minor: null, major: null };
  if (typeof value === 'string') return { minor: value, major: null };
  if (typeof value === 'object') {
    const minor = value.minor !== undefined ? value.minor : null;
    const major = value.major !== undefined ? value.major : null;
    return { minor, major };
  }
  return { minor: null, major: null };
}

function main() {
  if (!fs.existsSync(storagePath)) {
    console.error('storage.json not found at', storagePath);
    process.exit(1);
  }

  const raw = fs.readFileSync(storagePath, 'utf8');
  fs.writeFileSync(backupPath, raw, 'utf8');
  console.log('Backup written to', backupPath);

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.error('Failed to parse storage.json:', err);
    process.exit(1);
  }

  const templates = Array.isArray(data.templates) ? data.templates : [];
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];

  const templateMap = {};
  const typeToDetId = {};
  templates.forEach(t => {
    templateMap[t.id] = t;
    // Generate deterministic ID based on template type
    const detId = deterministicUUID('simplehome-template', t.type);
    typeToDetId[t.type] = detId;
    t.deterministicId = detId;
  });

  const householdCatalog = templates.map(t => ({ categoryName: t.name, items: [] }));

  tasks.forEach(task => {
    if (!task.isTemplate) return;
    const tid = task.templateId;
    if (!tid || !templateMap[tid]) return;

    const item = {
      id: task.id || (task.title ? task.title.replace(/\s+/g, '-').toLowerCase() : ''),
      name: task.title || '',
      brand: null,
      model: null,
      serialNumber: null,
      location: null,
      installationDate: null,
      warrantyPeriodMonths: null,
      lastMaintenanceDate: safeDateObj(task.lastCompleted),
      nextMaintenanceDate: safeDateObj(task.nextDue),
      maintenanceSchedule: {
        minorTasks: [{ taskName: task.title || '', description: task.description || '', id: task.id || '' }],
        minorIntervalMonths: null,
        majorTasks: [],
        majorIntervalMonths: null
      },
      notes: task.notes || '',
      relatedItemIds: []
    };

    const idx = templates.findIndex(tt => tt.id === tid);
    if (idx !== -1) householdCatalog[idx].items.push(item);
  });

  const out = { provider: 'gemini', householdCatalog };
  fs.writeFileSync(storagePath, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log('Wrote schema-compliant storage.json to', storagePath);
}

main();
