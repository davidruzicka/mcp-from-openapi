/**
 * Tests for error utilities
 */

import { describe, it, expect } from 'vitest';
import { generateCorrelationId } from './errors.js';

describe('generateCorrelationId', () => {
  it('should generate a valid UUID v4 format', () => {
    const id = generateCorrelationId();
    
    // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(id).toMatch(uuidRegex);
  });

  it('should generate unique IDs', () => {
    const ids = new Set<string>();
    
    // Generate 100 IDs and check for uniqueness
    for (let i = 0; i < 100; i++) {
      const id = generateCorrelationId();
      expect(ids.has(id)).toBe(false);
      ids.add(id);
    }
    
    expect(ids.size).toBe(100);
  });

  it('should have correct version (4) in UUID', () => {
    const id = generateCorrelationId();
    const parts = id.split('-');
    
    // Version should be 4 (first character of third group)
    expect(parts[2][0]).toBe('4');
  });

  it('should have correct variant in UUID', () => {
    const id = generateCorrelationId();
    const parts = id.split('-');
    
    // Variant should be 8, 9, a, or b (first character of fourth group)
    expect(['8', '9', 'a', 'b']).toContain(parts[3][0]);
  });
});

