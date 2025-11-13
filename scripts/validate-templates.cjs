const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const schemaPath = path.resolve(__dirname, '..', 'maintenance-list-schema-1.0.0.json');
if (!fs.existsSync(schemaPath)) {
  console.error('Schema not found at', schemaPath);
  process.exit(2);
}
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

const files = fs.readdirSync(path.resolve(__dirname, '..')).filter(f => f.startsWith('maintenance-template-') && f.endsWith('.json'));
if (files.length === 0) {
  console.log('No maintenance-template-*.json files found.');
  process.exit(0);
}

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

let hadError = false;
for (const file of files) {
  const p = path.resolve(__dirname, '..', file);
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    const valid = validate(data);
    if (!valid) {
      hadError = true;
      console.log(`\nVALIDATION FAILED: ${file}`);
      for (const err of validate.errors) {
        console.log(' -', err.instancePath || '/', err.message);
      }
    } else {
      console.log(`OK: ${file}`);
    }
  } catch (e) {
    hadError = true;
    console.log(`\nERROR reading/parsing ${file}: ${e.message}`);
  }
}

process.exit(hadError ? 1 : 0);
