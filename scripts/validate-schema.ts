#!/usr/bin/env node

/**
 * Validates profile-schema.json against JSON Schema Draft-07 meta-schema
 * 
 * Why: Ensures our schema is valid before users rely on it for validation
 */

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function validateSchema() {
  try {
    // Read our profile schema (from project root)
    const schemaPath = path.resolve(process.cwd(), 'profile-schema.json');
    const schemaContent = await fs.readFile(schemaPath, 'utf-8');
    const profileSchema = JSON.parse(schemaContent);

    // Create Ajv instance with Draft-07 support
    const ajv = new Ajv.default({
      strict: true,
      allErrors: true,
      verbose: true,
    });
    
    // Add format validators (uri, etc.)
    addFormats.default(ajv);

    // Validate against meta-schema (Draft-07)
    const validate = ajv.compile(ajv.getSchema('http://json-schema.org/draft-07/schema')?.schema || {});
    const valid = validate(profileSchema);

    console.log('');
    console.log('═══════════════════════════════════════════════════');
    console.log('  PROFILE SCHEMA VALIDATION');
    console.log('═══════════════════════════════════════════════════');
    console.log('');
    console.log(`Schema: ${schemaPath}`);
    console.log(`Meta-Schema: JSON Schema Draft-07`);
    console.log('');

    if (valid) {
      console.log('✅ VALID - profile-schema.json is a valid JSON Schema');
      console.log('');
      
      // Test that it can compile
      try {
        ajv.compile(profileSchema);
        console.log('✅ COMPILABLE - Schema can be used for validation');
      } catch (e) {
        console.log('⚠️  WARNING - Schema is valid but may have compilation issues:');
        console.log(`  ${(e as Error).message}`);
      }
      
      console.log('');
      console.log('Schema Statistics:');
      console.log(`  Definitions: ${Object.keys(profileSchema.definitions || {}).length}`);
      console.log(`  Root properties: ${Object.keys(profileSchema.properties || {}).length}`);
      console.log(`  Required fields: ${(profileSchema.required || []).length}`);
      
    } else {
      console.log('❌ INVALID - profile-schema.json has errors:');
      console.log('');
      
      if (validate.errors) {
        for (const error of validate.errors) {
          console.log(`  • ${error.instancePath || '/'}: ${error.message}`);
          if (error.params) {
            console.log(`    ${JSON.stringify(error.params)}`);
          }
        }
      }
      
      console.log('');
      process.exit(1);
    }
    
    console.log('');
    console.log('═══════════════════════════════════════════════════');
    
  } catch (e) {
    console.error('Fatal error:', (e as Error).message);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  validateSchema();
}

export { validateSchema };

