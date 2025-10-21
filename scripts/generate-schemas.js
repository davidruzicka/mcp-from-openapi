#!/usr/bin/env node

/**
 * Generate Zod schemas from TypeScript types
 *
 * Single source of truth: src/types/profile.ts
 * Generated: src/generated-schemas.ts (for runtime validation)
 *
 * Manual maintenance: profile-schema.json (for IDE autocomplete)
 */

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('🔄 Generating schemas from TypeScript types...');

// Skip JSON Schema generation - maintain manually for IDE support
// JSON Schema provides better IDE autocomplete than generated versions
console.log('⏭️  Skipping JSON Schema generation (maintained manually for IDE support)');

// Generate Zod schemas
console.log('🔧 Generating Zod schemas...');
const zodOutputPath = 'src/generated-schemas.ts';

try {
  execSync(`npx ts-to-zod src/types/profile.ts ${zodOutputPath} --skipValidation`, {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..')
  });
  console.log(`✅ Zod schemas written to ${zodOutputPath}`);
} catch (error) {
  console.error('❌ Failed to generate Zod schemas:', error.message);
  process.exit(1);
}

console.log('🎉 Schema generation completed!');
console.log('');
console.log('📋 Manual steps:');
console.log('1. Review generated Zod schemas');
console.log('2. Update profile-schema.json manually if needed');
console.log('3. Test that everything still works');
