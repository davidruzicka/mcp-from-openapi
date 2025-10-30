/**
 * Validation utilities for common data types
 *
 * Why: Provides reusable validation functions for email, URI, and other formats
 * Centralizes validation logic and ensures consistency across the application
 */

/**
 * Validates if a string is a valid email address
 */
export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Validates if a string is a valid URI
 */
export function isUri(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}
