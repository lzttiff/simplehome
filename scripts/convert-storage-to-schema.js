const fs = require('fs');
const path = require('path');

const storagePath = path.resolve(__dirname, '..', 'data', 'storage.json');
const backupPath = path.resolve(__dirname, '..', 'data', 'storage.json.pre-schema-backup.json');

function safeDateObj(value) {
  // value may be string date, null, or object with minor/major
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
  templates.forEach(t => {
    templateMap[t.id] = t;
  });

  const householdCatalog = templates.map(t => ({
    categoryName: t.name,
    items: []
  }));

  // Map: for each task that is a template and has a templateId matching a template,
  // convert to schema item and push into that template's items array.
  tasks.forEach(task => {
    if (!task.isTemplate) return; // skip non-template tasks
    const tid = task.templateId;
    if (!tid || !templateMap[tid]) return; // only attach to known templates

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
        minorTasks: [
          {
            taskName: task.title || '',
            description: task.description || '',
            id: task.id || ''
          }
        ],
        minorIntervalMonths: null,
        majorTasks: [],
        majorIntervalMonths: null
      },
      notes: task.notes || '',
      relatedItemIds: []
    };

    // find index for template in householdCatalog
    const idx = templates.findIndex(tt => tt.id === tid);
    if (idx !== -1) householdCatalog[idx].items.push(item);
  });

  const out = {
    provider: 'gemini',
    householdCatalog
  };

  const outPath = storagePath;
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log('Wrote schema-compliant storage.json to', outPath);
}

main();
