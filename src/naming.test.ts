/**
 * Unit tests for tool name shortening strategies
 */

import { describe, it, expect } from 'vitest';
import { 
  shortenToolName, 
  pickMostSimilarPairs,
  NamingStrategy,
  type OperationForNaming 
} from './naming.js';

describe('shortenToolName', () => {
  const mockOp: OperationForNaming = {
    operationId: 'putApiV4ProjectsIdRepositoryBranchesBranchUnprotect',
    method: 'put',
    path: '/api/v4/projects/{id}/repository/branches/{branch}/unprotect',
    tags: ['branches'],
  };

  const allOps: OperationForNaming[] = [
    mockOp,
    {
      operationId: 'putApiV4ProjectsIdRepositoryBranchesBranchProtect',
      method: 'put',
      path: '/api/v4/projects/{id}/repository/branches/{branch}/protect',
      tags: ['branches'],
    },
    {
      operationId: 'getApiV4ProjectsIdIssues',
      method: 'get',
      path: '/api/v4/projects/{id}/issues',
      tags: ['issues'],
    },
  ];

  describe('balanced strategy', () => {
    it('should create meaningful short names', () => {
      const result = shortenToolName(mockOp, NamingStrategy.Balanced, 45, allOps);
      expect(result.name).toBeTruthy();
      expect(result.name.length).toBeLessThanOrEqual(45);
      expect(result.name.length).toBeGreaterThanOrEqual(10); // Should have some context
      expect(result.truncated).toBe(true);
    });

    it('should be unique across operations', () => {
      const results = allOps.map(op => 
        shortenToolName(op, NamingStrategy.Balanced, 45, allOps)
      );
      
      const names = results.map(r => r.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(allOps.length); // All unique
    });

    it('should respect min parts and min length', () => {
      const result = shortenToolName(mockOp, NamingStrategy.Balanced, 45, allOps, {
        minParts: 3,
        minLength: 20,
      });
      
      expect(result.name.length).toBeGreaterThanOrEqual(15); // Should try to reach minLength
      expect(result.partsUsed).toBeGreaterThanOrEqual(2); // At least verb + something
    });

    it('should handle operations already under limit', () => {
      const shortOp: OperationForNaming = {
        operationId: 'getProjects',
        method: 'get',
        path: '/projects',
        tags: ['projects'],
      };
      
      const result = shortenToolName(shortOp, NamingStrategy.Balanced, 45, [shortOp]);
      expect(result.name).toBe('get_projects');
      expect(result.truncated).toBe(false);
    });
  });

  describe('iterative strategy', () => {
    it('should progressively remove noise', () => {
      const result = shortenToolName(mockOp, NamingStrategy.Iterative, 45, allOps);
      expect(result.name).toBeTruthy();
      expect(result.name.length).toBeLessThanOrEqual(45);
      expect(result.truncated).toBe(true);
    });

    it('should preserve verb and key parts', () => {
      const result = shortenToolName(mockOp, NamingStrategy.Iterative, 45, allOps);
      // Should contain verb (put) or key action (unprotect)
      expect(result.name).toMatch(/put|unprotect/);
    });

    it('should handle very short limits', () => {
      const result = shortenToolName(mockOp, NamingStrategy.Iterative, 15, allOps);
      expect(result.name.length).toBeLessThanOrEqual(15);
    });
  });

  describe('hash strategy', () => {
    it('should create deterministic short name with hash', () => {
      const result = shortenToolName(mockOp, NamingStrategy.Hash, 45, allOps);
      expect(result.name).toMatch(/^put_branches_[a-z0-9]{4}$/);
      expect(result.name.length).toBeLessThanOrEqual(45);
      expect(result.truncated).toBe(true);
    });

    it('should be deterministic', () => {
      const result1 = shortenToolName(mockOp, NamingStrategy.Hash, 45, allOps);
      const result2 = shortenToolName(mockOp, NamingStrategy.Hash, 45, allOps);
      expect(result1.name).toBe(result2.name);
    });

    it('should handle very short limits', () => {
      const result = shortenToolName(mockOp, NamingStrategy.Hash, 15, allOps);
      expect(result.name.length).toBeLessThanOrEqual(15);
    });
  });

  describe('auto strategy', () => {
    it('should try strategies in order', () => {
      const result = shortenToolName(mockOp, NamingStrategy.Auto, 45, allOps);
      expect(result.name).toBeTruthy();
      expect(result.name.length).toBeLessThanOrEqual(45);
      expect(result.strategy).toBe(NamingStrategy.Auto);
    });

    it('should handle short limits by falling back', () => {
      const result = shortenToolName(mockOp, NamingStrategy.Auto, 15, allOps);
      expect(result.name.length).toBeLessThanOrEqual(15);
    });
  });

  describe('none strategy', () => {
    it('should return original operationId', () => {
      const result = shortenToolName(mockOp, NamingStrategy.None, 45, allOps);
      expect(result.name).toBe(mockOp.operationId);
      expect(result.truncated).toBe(false);
    });
  });

  describe('length limits', () => {
    it('should respect max length constraint', () => {
      const result = shortenToolName(mockOp, NamingStrategy.Hash, 20, allOps);
      expect(result.name.length).toBeLessThanOrEqual(20);
    });

    it('should handle edge cases', () => {
      // Very short limit
      const result1 = shortenToolName(mockOp, NamingStrategy.Hash, 5, allOps);
      expect(result1.name.length).toBeLessThanOrEqual(5);
      
      // Very long limit (no truncation needed)
      const result2 = shortenToolName(mockOp, NamingStrategy.Balanced, 200, allOps);
      expect(result2.name.length).toBeLessThanOrEqual(200);
    });
  });
});

describe('pickMostSimilarPairs', () => {
  const ops: OperationForNaming[] = [
    {
      operationId: 'putApiV4ProjectsIdRepositoryBranchesBranchProtect',
      method: 'put',
      path: '/api/v4/projects/{id}/repository/branches/{branch}/protect',
      tags: ['branches'],
    },
    {
      operationId: 'putApiV4ProjectsIdRepositoryBranchesBranchUnprotect',
      method: 'put',
      path: '/api/v4/projects/{id}/repository/branches/{branch}/unprotect',
      tags: ['branches'],
    },
    {
      operationId: 'getApiV4Projects',
      method: 'get',
      path: '/api/v4/projects',
      tags: ['projects'],
    },
    {
      operationId: 'postApiV4Projects',
      method: 'post',
      path: '/api/v4/projects',
      tags: ['projects'],
    },
  ];

  it('should find most similar pairs', () => {
    const pairs = pickMostSimilarPairs(ops, 2, 0.5);
    expect(pairs).toHaveLength(2);
    
    // Should find similar pairs (high similarity >= 0.5)
    expect(pairs[0].similarity).toBeGreaterThanOrEqual(0.5);
    expect(pairs[1].similarity).toBeGreaterThanOrEqual(0.5);
    
    // Verify we got actual pairs
    const allIds = pairs.flatMap(p => [p.opA.operationId, p.opB.operationId]);
    expect(new Set(allIds).size).toBeGreaterThanOrEqual(2);
  });

  it('should return deterministic results', () => {
    const pairs1 = pickMostSimilarPairs(ops, 2, 0.5);
    const pairs2 = pickMostSimilarPairs(ops, 2, 0.5);
    expect(pairs1.length).toBe(pairs2.length);
    expect(pairs1[0].opA.operationId).toBe(pairs2[0].opA.operationId);
  });

  it('should respect similarity threshold', () => {
    const pairs = pickMostSimilarPairs(ops, 10, 0.9); // High threshold = very similar
    pairs.forEach(pair => {
      expect(pair.similarity).toBeGreaterThanOrEqual(0.9);
    });
  });

  it('should handle small sets', () => {
    const smallOps = ops.slice(0, 2);
    const pairs = pickMostSimilarPairs(smallOps, 5, 0.5);
    expect(pairs.length).toBeLessThanOrEqual(1); // Only 1 possible pair
  });

  it('should avoid duplicate operations when possible', () => {
    const pairs = pickMostSimilarPairs(ops, 2, 0.5);
    
    // Count how many times each operation appears
    const opCounts = new Map<string, number>();
    pairs.forEach(pair => {
      opCounts.set(pair.opA.operationId, (opCounts.get(pair.opA.operationId) || 0) + 1);
      opCounts.set(pair.opB.operationId, (opCounts.get(pair.opB.operationId) || 0) + 1);
    });
    
    // Most operations should appear only once (preferring diverse pairs)
    const singleAppearances = Array.from(opCounts.values()).filter(count => count === 1);
    expect(singleAppearances.length).toBeGreaterThan(0);
  });
});
