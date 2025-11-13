const fs = require('fs');
const path = require('path');

function usage() {
  console.log('Usage: node scripts/fix-singleFamilyDates.cjs [templateFile] <YYYY-MM-DD>');
  console.log('If only one argument is provided it is treated as the date and the default file');
  console.log('  maintenance-template-singleFamilyHome.json will be used.');
  process.exit(1);
}

const args = process.argv.slice(2);
let filePath;
let dateArg;
if (args.length === 0) {
  usage();
} else if (args.length === 1) {
  // single arg -> date, use default file
  dateArg = args[0];
  filePath = path.resolve(__dirname, '..', 'maintenance-template-singleFamilyHome.json');
} else {
  // two args -> file, date
  filePath = path.resolve(process.cwd(), args[0]);
  dateArg = args[1];
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
  console.error('Date must be in YYYY-MM-DD format. Got:', dateArg);
  process.exit(2);
}

if (!fs.existsSync(filePath)) {
  console.error('Template file not found:', filePath);
  process.exit(3);
}

let data;
try {
  data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
} catch (e) {
  console.error('Failed to read/parse JSON:', e.message);
  process.exit(4);
}

function fixItem(item) {
  if (!item) return;
  item.lastMaintenanceDate = item.lastMaintenanceDate || {};
  item.lastMaintenanceDate.minor = dateArg;
  item.lastMaintenanceDate.major = dateArg;

  item.nextMaintenanceDate = item.nextMaintenanceDate || {};
  item.nextMaintenanceDate.minor = null;
  item.nextMaintenanceDate.major = null;
}

let updated = 0;
if (Array.isArray(data.householdCatalog)) {
  for (const category of data.householdCatalog) {
    if (Array.isArray(category.items)) {
      for (const item of category.items) {
        fixItem(item);
        updated++;
      }
    }
  }
}

fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log(`Updated ${updated} items in ${filePath} (lastMaintenance=${dateArg}, nextMaintenance=null)`);
