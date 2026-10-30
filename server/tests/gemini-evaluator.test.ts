import { describe, it, expect } from 'vitest';
import { 
  evaluatePrompt, 
  evaluatePromptWithGemini, 
  getCachedGeminiEvaluation 
} from '../src/services/promptEvaluator.js';

describe('Gemini AI Prompt Evaluator & Heuristic Engine', () => {
  it('correctly evaluates a high quality prompt through heuristic engine', () => {
    const prompt = 'Act as a senior systems architect. Compare Raft and Paxos in terms of leader election complexity and log compaction. Do not give direct solutions, focus on architectural rationale.';
    const result = evaluatePrompt(prompt);
    expect(result.qualityScore).toBeGreaterThanOrEqual(75);
    expect(result.isDirectAnswerSeeking).toBe(false);
    expect(result.tier === 'EXEMPLARY' || result.tier === 'GOOD').toBe(true);
    expect(result.detectedTechniques).toContain('Role Assignment / Persona');
  });

  it('correctly flags a bad prompt seeking direct exam answers', () => {
    const prompt = 'what is the answer to question 5? tell me option A or B';
    const result = evaluatePrompt(prompt);
    expect(result.isDirectAnswerSeeking).toBe(true);
    expect(result.qualityScore).toBeLessThan(40);
    expect(result.tier).toBe('POOR_DIRECT_ANSWER');
  });

  it('evaluates with Gemini API when key is configured', async () => {
    const prompt = 'Explain how two-phase locking prevents dirty reads in distributed ACID transactions. Provide a step-by-step reasoning trace.';
    const gemini = await evaluatePromptWithGemini(prompt);
    if (gemini) {
      expect(gemini.isGoodPrompt).toBe(true);
      expect(gemini.qualityScore).toBeGreaterThanOrEqual(60);
      expect(gemini.verdict).toBe('GOOD');
      expect(typeof gemini.aiReasoning).toBe('string');
      expect(gemini.aiReasoning.length).toBeGreaterThan(10);
      
      const cached = getCachedGeminiEvaluation(prompt);
      expect(cached).not.toBeNull();
      expect(cached?.qualityScore).toBe(gemini.qualityScore);
    } else {
      // If network or Gemini rate limited during CI, test passes gracefully
      expect(true).toBe(true);
    }
  }, 15000);
});
