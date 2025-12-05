const fs = require('fs');
const path = require('path');

const storagePath = path.resolve(__dirname, '..', 'data', 'storage.json');
const backupPath = path.resolve(__dirname, '..', 'data', 'storage.json.pre-migration-backup.json');

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

  if (!Array.isArray(data.tasks)) {
    console.log('No tasks array found in storage.json');
    process.exit(0);
  }

  console.log(`Migrating ${data.tasks.length} tasks to full schema...`);

  // Add new fields and convert old date fields to new schema format
  data.tasks = data.tasks.map(task => {
    const migrated = {
      ...task,
      // Add new schema fields if they don't exist
      brand: task.brand ?? null,
      model: task.model ?? null,
      serialNumber: task.serialNumber ?? null,
      location: task.location ?? null,
      installationDate: task.installationDate ?? null,
      warrantyPeriodMonths: task.warrantyPeriodMonths ?? null,
      minorIntervalMonths: task.minorIntervalMonths ?? null,
      majorIntervalMonths: task.majorIntervalMonths ?? null,
      relatedItemIds: task.relatedItemIds ?? null
    };

    // Convert old date fields to new schema format if they exist
    if (!migrated.lastMaintenanceDate && (task.lastCompleted || task.completedAt)) {
      migrated.lastMaintenanceDate = JSON.stringify({
        minor: task.lastCompleted || task.completedAt || null,
        major: null
      });
    }
    if (!migrated.nextMaintenanceDate && (task.nextDue || task.dueDate)) {
      migrated.nextMaintenanceDate = JSON.stringify({
        minor: task.nextDue || task.dueDate || null,
        major: null
      });
    }

    // Remove old fields
    delete migrated.dueDate;
    delete migrated.nextDue;
    delete migrated.lastCompleted;
    delete migrated.completedAt;

    return migrated;
  });

  fs.writeFileSync(storagePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log('Migration complete. Updated storage.json with new schema fields.');
  console.log(`All ${data.tasks.length} tasks now have:`);
  console.log('  - lastMaintenanceDate, nextMaintenanceDate (JSON with minor/major)');
  console.log('  - brand, model, serialNumber, location, installationDate');
  console.log('  - warrantyPeriodMonths, minorIntervalMonths, majorIntervalMonths, relatedItemIds');
  console.log('Removed old fields: dueDate, nextDue, lastCompleted, completedAt');
}

main();
