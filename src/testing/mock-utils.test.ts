import { describe, it, expect } from 'vitest';
import {
  parseUrl,
  parsePaginationParams,
  parseSearchParam,
  parseBranchParams,
  parseScopeParam,
  applyPagination,
  calculateOffset
} from './mock-utils.js';

describe('Mock Utils', () => {
  const baseUrl = 'https://gitlab.com/api/v4';

  describe('parseUrl', () => {
    it('should parse URL from request', () => {
      const mockRequest = {
        url: `${baseUrl}/projects/123/issues?page=2&per_page=10`
      } as Request;

      const url = parseUrl(mockRequest);
      expect(url.pathname).toBe('/api/v4/projects/123/issues');
      expect(url.searchParams.get('page')).toBe('2');
      expect(url.searchParams.get('per_page')).toBe('10');
    });
  });

  describe('parsePaginationParams', () => {
    it('should parse default pagination params', () => {
      const mockRequest = {
        url: `${baseUrl}/projects/123/issues`
      } as Request;

      const { page, perPage } = parsePaginationParams(mockRequest);
      expect(page).toBe(1);
      expect(perPage).toBe(20);
    });

    it('should parse custom pagination params', () => {
      const mockRequest = {
        url: `${baseUrl}/projects/123/issues?page=3&per_page=50`
      } as Request;

      const { page, perPage } = parsePaginationParams(mockRequest);
      expect(page).toBe(3);
      expect(perPage).toBe(50);
    });
  });

  describe('parseSearchParam', () => {
    it('should return search param when present', () => {
      const mockRequest = {
        url: `${baseUrl}/projects/123/branches?search=main`
      } as Request;

      const search = parseSearchParam(mockRequest);
      expect(search).toBe('main');
    });

    it('should return null when search param is missing', () => {
      const mockRequest = {
        url: `${baseUrl}/projects/123/branches`
      } as Request;

      const search = parseSearchParam(mockRequest);
      expect(search).toBeNull();
    });
  });

  describe('parseBranchParams', () => {
    it('should parse branch and ref params', () => {
      const mockRequest = {
        url: `${baseUrl}/projects/123/branches?branch=feature-x&ref=main`
      } as Request;

      const { branch, ref } = parseBranchParams(mockRequest);
      expect(branch).toBe('feature-x');
      expect(ref).toBe('main');
    });

    it('should return undefined for missing params', () => {
      const mockRequest = {
        url: `${baseUrl}/projects/123/branches`
      } as Request;

      const { branch, ref } = parseBranchParams(mockRequest);
      expect(branch).toBeUndefined();
      expect(ref).toBeUndefined();
    });
  });

  describe('parseScopeParam', () => {
    it('should parse scope array params', () => {
      const mockRequest = {
        url: `${baseUrl}/projects/123/jobs?scope[]=failed&scope[]=success`
      } as Request;

      const scope = parseScopeParam(mockRequest);
      expect(scope).toEqual(['failed', 'success']);
    });

    it('should return empty array when no scope params', () => {
      const mockRequest = {
        url: `${baseUrl}/projects/123/jobs`
      } as Request;

      const scope = parseScopeParam(mockRequest);
      expect(scope).toEqual([]);
    });
  });

  describe('calculateOffset', () => {
    it('should calculate correct offset', () => {
      expect(calculateOffset(1, 20)).toBe(0);
      expect(calculateOffset(2, 20)).toBe(20);
      expect(calculateOffset(3, 10)).toBe(20);
    });
  });

  describe('applyPagination', () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

    it('should apply pagination correctly', () => {
      expect(applyPagination(data, 1, 5)).toEqual([1, 2, 3, 4, 5]);
      expect(applyPagination(data, 2, 5)).toEqual([6, 7, 8, 9, 10]);
      expect(applyPagination(data, 1, 3)).toEqual([1, 2, 3]);
    });

    it('should handle edge cases', () => {
      expect(applyPagination(data, 1, 20)).toEqual(data); // More than available
      expect(applyPagination(data, 10, 5)).toEqual([]); // Beyond available
    });
  });
});

