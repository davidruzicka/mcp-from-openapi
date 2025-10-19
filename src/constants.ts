/**
 * Application constants
 * 
 * Why: Centralized constants improve readability and maintainability.
 * Magic numbers scattered through code are harder to understand and change.
 */

/**
 * Time conversion constants
 */
export const TIME = {
  MS_PER_SECOND: 1000,
  MS_PER_MINUTE: 60000,
  MS_PER_HOUR: 3600000,
  SECONDS_PER_MINUTE: 60,
  MINUTES_PER_HOUR: 60,
} as const;

/**
 * HTTP status codes
 * 
 * Why: Named constants more readable than numeric literals.
 * Makes intent clear (STATUS_TOO_MANY_REQUESTS vs 429).
 */
export const HTTP_STATUS = {
  OK: 200,
  MULTIPLE_CHOICES: 300,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
} as const;

