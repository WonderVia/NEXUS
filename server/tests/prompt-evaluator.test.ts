import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../src/index.js';
import { evaluatePrompt, aggregatePromptAnalytics } from '../src/services/promptEvaluator.js';

describe('AI Prompt Quality & Integrity Evaluation Engine', () => {
  let adminToken: string;

  beforeAll(async () => {
    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@wuelev8.com', password: 'Admin@123' });
    adminToken = adminLogin.body.token;
  });

  describe('Direct Answer Seeking vs Good Prompt Heuristics', () => {
    it('should flag and heavily penalize direct answer seeking prompts (Bad Prompt)', () => {
      const badPrompt1 = 'Which option is correct for question 3: (A) Mutex (B) Semaphore (C) Monitor (D) Spinlock? Give me the answer.';
      const res1 = evaluatePrompt(badPrompt1);

      expect(res1.isDirectAnswerSeeking).toBe(true);
      expect(res1.tier).toBe('POOR_DIRECT_ANSWER');
      expect(res1.qualityScore).toBeLessThan(40);
      expect(res1.detectedAntiPatterns).toContain('Direct Answer Solicitation');
      expect(res1.verdict).toContain('Direct Answer Seeking');

      const badPrompt2 = 'Solve question 3 for me and tell me what option to choose';
      const res2 = evaluatePrompt(badPrompt2);
      expect(res2.isDirectAnswerSeeking).toBe(true);
      expect(res2.tier).toBe('POOR_DIRECT_ANSWER');
    });

    it('should detect lazy/low-effort noise inputs', () => {
      const lazyPrompt = 'hi';
      const res = evaluatePrompt(lazyPrompt);

      expect(res.tier).toBe('LAZY_INPUT');
      expect(res.qualityScore).toBeLessThanOrEqual(15);
      expect(res.detectedAntiPatterns).toContain('Low Effort / Telemetry Noise');
    });

    it('should score standard conceptual questions as Moderate', () => {
      const moderatePrompt = 'How does a binary semaphore handle wait and signal operations in an operating system?';
      const res = evaluatePrompt(moderatePrompt);

      expect(res.isDirectAnswerSeeking).toBe(false);
      expect(res.qualityScore).toBeGreaterThanOrEqual(45);
      expect(res.qualityScore).toBeLessThan(80);
      expect(res.tier).toBe('MODERATE');
    });

    it('should reward structured prompt engineering with high/exemplary scores (Good Prompt)', () => {
      const goodPrompt = `Act as a Senior Systems Architect. In a multithreaded queue, why can calling signal() before updating shared state trigger race conditions? Explain the mechanism step-by-step in a markdown table. Do not reveal direct exam answers.`;
      const res = evaluatePrompt(goodPrompt);

      expect(res.isDirectAnswerSeeking).toBe(false);
      expect(res.qualityScore).toBeGreaterThanOrEqual(80);
      expect(res.tier).toBe('EXEMPLARY');
      expect(res.detectedTechniques).toContain('Role Assignment / Persona');
      expect(res.detectedTechniques).toContain('Chain of Thought / Step-by-Step');
      expect(res.detectedTechniques).toContain('Structured Format Specification');
      expect(res.detectedTechniques).toContain('Negative Boundary / Anti-Cheating Constraint');
      expect(res.verdict).toContain('Prompt Engineering');
    });
  });

  describe('Aggregate Analytics & API Endpoint', () => {
    it('should correctly aggregate prompt analytics and calculate personas', () => {
      const sampleEvents = [
        {
          id: '1',
          eventType: 'ai_query_submitted',
          details: 'Which option is correct for question 1: A or B?',
          studentId: 'stud-1',
          studentName: 'Alice'
        },
        {
          id: '2',
          eventType: 'ai_query_submitted',
          details: 'Act as a Senior Database Engineer. Explain B+ tree node splits step by step in markdown. Do not give exam answers.',
          studentId: 'stud-2',
          studentName: 'Bob'
        }
      ];

      const aggregate = aggregatePromptAnalytics(sampleEvents);
      expect(aggregate.totalPromptsAnalyzed).toBe(2);
      expect(aggregate.directAnswerSeekingCount).toBe(1);
      expect(aggregate.directAnswerSeekingPercentage).toBe(50);
      expect(aggregate.qualityBreakdown.exemplary).toBe(1);
      expect(aggregate.qualityBreakdown.poorDirectAnswer).toBe(1);
      expect(aggregate.candidatePersonas['stud-1'].persona).toContain('Direct Answer Seeker');
      expect(aggregate.candidatePersonas['stud-2'].persona).toBe('Strategic Prompt Engineer');
    });

    it('should fetch enriched prompt analytics from GET /api/admin/prompt-analytics', async () => {
      const res = await request(app)
        .get('/api/admin/prompt-analytics')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.summary).toBeDefined();
      expect(res.body.events).toBeDefined();
      expect(Array.isArray(res.body.events)).toBe(true);
    });
  });
});

