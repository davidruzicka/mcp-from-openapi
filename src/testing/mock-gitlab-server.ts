/**
 * Mock GitLab API server for integration testing
 * 
 * Why: Enables end-to-end testing without real GitLab instance.
 * Tests actual HTTP flow, parameter handling, error scenarios.
 */

import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import * as fixtures from './fixtures.js';

const BASE_URL = 'https://gitlab.com/api/v4';

/**
 * Mock GitLab API endpoints
 * 
 * Why ordered by resource: Mirrors actual GitLab API structure for maintainability
 * Why wildcard patterns: GitLab accepts URL-encoded paths like my-org/my-project
 */
export const handlers = [
  // Project Badges
  http.get(`${BASE_URL}/projects/*/badges`, ({ request, params }) => {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const perPage = parseInt(url.searchParams.get('per_page') || '20', 10);
    
    // Simple pagination
    if (page === 1) {
      return HttpResponse.json(fixtures.mockBadgesList);
    }
    return HttpResponse.json([]);
  }),

  http.get(`${BASE_URL}/projects/*/badges/*`, ({ request }) => {
    // Extract badge ID from URL
    const badgeId = parseInt(request.url.split('/').pop() || '0', 10);
    if (badgeId === 1) {
      return HttpResponse.json(fixtures.mockBadge);
    }
    return HttpResponse.json({ message: 'Not Found' }, { status: 404 });
  }),

  http.post(`${BASE_URL}/projects/*/badges`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    
    if (!body.link_url || !body.image_url) {
      return HttpResponse.json(
        { error: 'link_url and image_url are required' },
        { status: 400 }
      );
    }

    return HttpResponse.json({
      ...fixtures.mockBadge,
      id: 3,
      name: body.name || 'New Badge',
      link_url: body.link_url,
      image_url: body.image_url,
    }, { status: 201 });
  }),

  http.put(`${BASE_URL}/projects/*/badges/*`, async ({ request }) => {
    const badgeId = parseInt(request.url.split('/').pop() || '0', 10);
    const body = await request.json() as Record<string, unknown>;

    if (badgeId === 1) {
      return HttpResponse.json({
        ...fixtures.mockBadge,
        name: body.name || fixtures.mockBadge.name,
        link_url: body.link_url || fixtures.mockBadge.link_url,
        image_url: body.image_url || fixtures.mockBadge.image_url,
      });
    }
    return HttpResponse.json({ message: 'Not Found' }, { status: 404 });
  }),

  http.delete(`${BASE_URL}/projects/*/badges/*`, ({ request }) => {
    const badgeId = parseInt(request.url.split('/').pop() || '0', 10);
    if (badgeId === 1) {
      return new HttpResponse(null, { status: 204 });
    }
    return HttpResponse.json({ message: 'Not Found' }, { status: 404 });
  }),

  // Group Badges (similar structure)
  http.get(`${BASE_URL}/groups/*/badges`, () => {
    return HttpResponse.json(fixtures.mockBadgesList);
  }),

  http.post(`${BASE_URL}/groups/*/badges`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json({
      ...fixtures.mockBadge,
      id: 4,
      kind: 'group',
      name: body.name || 'Group Badge',
    }, { status: 201 });
  }),

  // Branches
  http.get(`${BASE_URL}/projects/*/repository/branches`, ({ request }) => {
    const url = new URL(request.url);
    const search = url.searchParams.get('search');
    
    if (search) {
      return HttpResponse.json(
        fixtures.mockBranchesList.filter(b => b.name.includes(search))
      );
    }
    return HttpResponse.json(fixtures.mockBranchesList);
  }),

  http.get(`${BASE_URL}/projects/*/repository/branches/*`, ({ request }) => {
    const branch = decodeURIComponent(request.url.split('/').pop() || '');
    const found = fixtures.mockBranchesList.find(b => b.name === branch);
    
    if (found) {
      return HttpResponse.json(found);
    }
    return HttpResponse.json({ message: 'Branch Not Found' }, { status: 404 });
  }),

  http.post(`${BASE_URL}/projects/*/repository/branches`, async ({ request }) => {
    const url = new URL(request.url);
    const branch = url.searchParams.get('branch');
    const ref = url.searchParams.get('ref');

    if (!branch || !ref) {
      return HttpResponse.json(
        { error: 'branch and ref parameters are required' },
        { status: 400 }
      );
    }

    return HttpResponse.json({
      name: branch,
      commit: fixtures.mockBranch.commit,
      merged: false,
      protected: false,
      default: false,
    }, { status: 201 });
  }),

  http.delete(`${BASE_URL}/projects/*/repository/branches/*`, ({ request }) => {
    const branch = decodeURIComponent(request.url.split('/').pop() || '');
    if (branch !== 'main') {
      return new HttpResponse(null, { status: 204 });
    }
    return HttpResponse.json(
      { message: 'Cannot delete default branch' },
      { status: 403 }
    );
  }),

  http.put(`${BASE_URL}/projects/*/repository/branches/*/protect`, ({ request }) => {
    const parts = request.url.split('/');
    const branch = decodeURIComponent(parts[parts.length - 2]); // second-to-last part
    return HttpResponse.json({
      ...fixtures.mockBranch,
      name: branch,
      protected: true,
    });
  }),

  http.put(`${BASE_URL}/projects/*/repository/branches/*/unprotect`, ({ request }) => {
    const parts = request.url.split('/');
    const branch = decodeURIComponent(parts[parts.length - 2]); // second-to-last part
    return HttpResponse.json({
      ...fixtures.mockBranch,
      name: branch,
      protected: false,
    });
  }),

  // Access Requests
  http.get(`${BASE_URL}/projects/*/access_requests`, () => {
    return HttpResponse.json(fixtures.mockAccessRequestsList);
  }),

  http.get(`${BASE_URL}/groups/*/access_requests`, () => {
    return HttpResponse.json(fixtures.mockAccessRequestsList);
  }),

  http.post(`${BASE_URL}/projects/*/access_requests`, () => {
    return HttpResponse.json(fixtures.mockAccessRequest, { status: 201 });
  }),

  http.put(`${BASE_URL}/projects/*/access_requests/*/approve`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    const parts = request.url.split('/');
    const userId = parseInt(parts[parts.length - 2], 10); // second-to-last part

    return HttpResponse.json({
      ...fixtures.mockAccessRequest,
      id: userId,
      access_level: body.access_level || 30,
    });
  }),

  http.delete(`${BASE_URL}/projects/*/access_requests/*`, () => {
    return new HttpResponse(null, { status: 204 });
  }),

  // Jobs
  http.get(`${BASE_URL}/projects/*/jobs`, ({ request }) => {
    const url = new URL(request.url);
    // Why getAll: GitLab sends array params as scope[]=failed&scope[]=canceled
    const scope = url.searchParams.getAll('scope[]');

    if (scope.length > 0 && scope.includes('failed')) {
      return HttpResponse.json(fixtures.mockJobsList.filter(j => j.status === 'failed'));
    }
    return HttpResponse.json(fixtures.mockJobsList);
  }),

  http.get(`${BASE_URL}/projects/*/jobs/*`, ({ request }) => {
    const jobId = parseInt(request.url.split('/').pop() || '0', 10);
    if (jobId === 1234) {
      return HttpResponse.json(fixtures.mockJob);
    }
    return HttpResponse.json({ message: 'Not Found' }, { status: 404 });
  }),

  http.post(`${BASE_URL}/projects/*/jobs/*/play`, ({ request }) => {
    const parts = request.url.split('/');
    const jobId = parseInt(parts[parts.length - 2], 10); // second-to-last part
    return HttpResponse.json({
      ...fixtures.mockJob,
      id: jobId,
      status: 'pending',
    });
  }),

  // Rate limiting simulation
  http.get(`${BASE_URL}/rate-limit-test`, () => {
    return HttpResponse.json(
      { message: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  }),

  // Server error simulation
  http.get(`${BASE_URL}/server-error-test`, () => {
    return HttpResponse.json(
      { message: 'Internal Server Error' },
      { status: 503 }
    );
  }),
];

/**
 * Create and configure mock server
 * 
 * Why setupServer: MSW's node integration for testing environments
 */
export const mockServer = setupServer(...handlers);

/**
 * Helper: start server before tests
 */
export function startMockServer() {
  mockServer.listen({ onUnhandledRequest: 'error' });
}

/**
 * Helper: reset handlers between tests
 * 
 * Why: Prevents test pollution from runtime handler modifications
 */
export function resetMockServer() {
  mockServer.resetHandlers();
}

/**
 * Helper: stop server after tests
 */
export function stopMockServer() {
  mockServer.close();
}

