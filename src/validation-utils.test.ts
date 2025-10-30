import { describe, it, expect } from 'vitest';
import { isEmail, isUri } from './validation-utils.js';

describe('Validation Utils', () => {
  describe('isEmail', () => {
    it('should validate correct email addresses', () => {
      expect(isEmail('user@example.com')).toBe(true);
      expect(isEmail('test.email+tag@domain.co.uk')).toBe(true);
      expect(isEmail('user_name@subdomain.example.org')).toBe(true);
    });

    it('should reject invalid email addresses', () => {
      expect(isEmail('invalid')).toBe(false);
      expect(isEmail('@example.com')).toBe(false);
      expect(isEmail('user@')).toBe(false);
      expect(isEmail('user.example.com')).toBe(false);
      expect(isEmail('user@.com')).toBe(false);
      expect(isEmail('')).toBe(false);
    });
  });

  describe('isUri', () => {
    it('should validate correct URIs', () => {
      expect(isUri('https://example.com')).toBe(true);
      expect(isUri('http://localhost:3000')).toBe(true);
      expect(isUri('ftp://ftp.example.com/file.txt')).toBe(true);
      expect(isUri('mailto:user@example.com')).toBe(true);
      expect(isUri('file:///path/to/file')).toBe(true);
    });

    it('should reject invalid URIs', () => {
      expect(isUri('not-a-url')).toBe(false);
      expect(isUri('')).toBe(false);
      expect(isUri('example.com')).toBe(false);
      expect(isUri('://invalid')).toBe(false);
    });
  });
});
