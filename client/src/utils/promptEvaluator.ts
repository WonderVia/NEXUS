/**
 * WUElev8 AI Prompt Quality & Integrity Evaluation Engine (Client Side)
 * 
 * Analyzes candidate prompts submitted during AI-monitored assessments.
 * Judges whether a prompt is high quality (structured prompt engineering,
 * problem decomposition, contextual framing) vs bad/low-quality (direct answer
 * seeking, lazy MCQ copy-pasting, cheating attempts).
 */

export interface PromptCriteriaScores {
  criticalThinkingVsAnswerSeeking: number; // 0 to 30
  contextAndFraming: number;              // 0 to 25
  promptEngineeringTechniques: number;    // 0 to 25
  constraintSpecification: number;        // 0 to 20
}

export type PromptQualityTier = 
  | 'EXEMPLARY'
  | 'GOOD'
  | 'MODERATE'
  | 'POOR_DIRECT_ANSWER'
  | 'LAZY_INPUT';

export interface GeminiPromptAnalysis {
  isGoodPrompt: boolean;
  qualityScore: number;
  tier: PromptQualityTier;
  verdict: 'GOOD' | 'BAD';
  aiReasoning: string;
  strengths: string[];
  weaknesses: string[];
  recommendation: string;
  evaluatedByModel: string;
  evaluatedAt: string;
}

export interface PromptEvaluationResult {
  cleanPrompt: string;
  qualityScore: number; // 0 - 100
  tier: PromptQualityTier;
  ratingLabel: string;
  isDirectAnswerSeeking: boolean;
  verdict: string;
  summaryReason: string;
  criteriaScores: PromptCriteriaScores;
  detectedTechniques: string[];
  detectedAntiPatterns: string[];
  strengths: string[];
  weaknesses: string[];
  recommendation: string;
  geminiEvaluation?: GeminiPromptAnalysis | null;
}

export interface PromptAnalyticsAggregate {
  totalPromptsAnalyzed: number;
  averageQualityScore: number;
  directAnswerSeekingCount: number;
  directAnswerSeekingPercentage: number;
  qualityBreakdown: {
    exemplary: number;
    good: number;
    moderate: number;
    poorDirectAnswer: number;
    lazyInput: number;
  };
  techniqueFrequency: Record<string, number>;
  antiPatternFrequency: Record<string, number>;
  candidatePersonas: Record<string, {
    studentId: string;
    studentName: string;
    studentEmail: string;
    promptCount: number;
    averageScore: number;
    directAnswerCount: number;
    persona: 'Strategic Prompt Engineer' | 'Thoughtful Inquirer' | 'Mixed Explorer' | 'Direct Answer Seeker (Cheating Pattern)' | 'Low Effort';
  }>;
}

const DIRECT_ANSWER_SEEKING_PATTERNS = [
  /which\s+option\s+(is\s+)?(correct|right|true|false)/i,
  /what\s+is\s+the\s+(correct\s+)?(answer|option|choice)/i,
  /is\s+it\s+(\(?\s*[a-d]\s*\)?|option\s+[a-d])/i,
  /option\s+[a-d]\s+(or\s+option\s+[a-d])?/i,
  /\b(give|tell|show)\s+(me\s+)?the\s+(correct\s+)?(answer|ans|code|solution)\b/i,
  /\bsolve\s+(this\s+)?(question|problem|for\s+me|exam|mcq)\b/i,
  /\bwhat\s+should\s+i\s+(choose|select|pick|mark)\b/i,
  /\bans\s+(pls|please|fast|karo|batao)\b/i,
  /\bjust\s+give\s+(the\s+)?answer\b/i,
  /\bselect\s+the\s+(best|correct)\s+option\b/i,
  /\bwhat\s+is\s+the\s+output\s+of\s+this\s+code\s*:\s*/i
];

const RAW_MCQ_INDICATORS = [
  /\b(question|q)\s*\d+[\s:.-]/i,
  /\([a-d]\)\s+[a-z0-9]/i,
  /\b[a-d]\)\s+[a-z0-9]/i,
  /\b(option\s+[a-d]:)/i,
  /\b1\.\s+.*\n\s*2\.\s+.*\n\s*3\.\s+/i
];

const ROLE_PROMPTING_PATTERNS = [
  /\bact\s+as\s+(an?|the)?\s+[a-z\s]+/i,
  /\byou\s+are\s+(an?|the)?\s+[a-z\s]+(expert|architect|engineer|developer|professor|tutor|specialist|auditor)/i,
  /\bpretend\s+to\s+be\b/i,
  /\bfrom\s+the\s+perspective\s+of\b/i,
  /\bassume\s+the\s+role\s+of\b/i
];

const CHAIN_OF_THOUGHT_PATTERNS = [
  /\bstep[-\s]by[-\s]step\b/i,
  /\bthink\s+(step[-\s]by[-\s]step|through\s+this)\b/i,
  /\bbreak\s+down\s+the\s+(logic|reasoning|derivation|process)\b/i,
  /\bexplain\s+the\s+(reasoning|derivation|why|mechanism)\b/i,
  /\bwalk\s+me\s+through\b/i,
  /\bfirst\s+principles\b/i
];

const NEGATIVE_CONSTRAINTS = [
  /\bdo\s+not\s+(give|reveal|provide|write)\s+(the\s+)?(direct\s+)?(exam\s+)?(answers?|code|solutions?)\b/i,
  /\bwithout\s+(using|revealing|telling\s+me|giving)\b/i,
  /\bdon't\s+(just\s+)?(give|reveal|tell)\b/i,
  /\bguide\s+me\s+without\s+solving\b/i,
  /\bdo\s+not\s+solve\s+it\s+for\s+me\b/i,
  /\bno\s+direct\s+answers?\b/i
];

const ANALYTICAL_INQUIRY_PATTERNS = [
  /\b(how\s+does|why\s+does|how\s+to|explain|difference\s+between|compare|analyze|what\s+happens\s+when|mechanism\s+of|walk\s+through)\b/i
];

const FORMAT_CONSTRAINTS = [
  /\b(markdown|table|bullet\s*points?|numbered\s*list|json|pseudocode|diagram|flowchart)\b/i,
  /\bformat\s+(as|in|using)\b/i,
  /\bcompare\s+.*\s+(in\s+a\s+table|side\s+by\s+side)\b/i,
  /\blimit\s+(the\s+response|to\s+\d+|your\s+answer)\b/i,
  /\bconcise\b/i,
  /\bin\s+\d+\s+(bullet\s*points|steps|sentences)\b/i
];

const CS_TECHNICAL_KEYWORDS = [
  'algorithm', 'complexity', 'semaphore', 'mutex', 'deadlock', 'concurrency',
  'thread', 'binary search', 'tree', 'graph', 'database', 'transaction', 'acid',
  'indexing', 'cache', 'latency', 'memory', 'pointer', 'asynchronous', 'promise',
  'recursion', 'dynamic programming', 'hash table', 'b-tree', 'process', 'virtual memory',
  'socket', 'http', 'rest', 'compiler', 'polymorphism', 'inheritance', 'runtime',
  'operating system', 'race condition', 'priority inversion', 'binary', 'queue'
];

export function extractCleanPrompt(rawDetails: string): string {
  if (!rawDetails) return '';

  const quoteMatch = rawDetails.match(/(?:AI prompt submitted to [^:]+:\s*|AI prompt:\s*|Prohibited AI prompt attempted:\s*|ChatGPT prompt submitted:\s*|Search query submitted to [^:]+:\s*)"([^"]+)"/i);
  if (quoteMatch && quoteMatch[1]) {
    return quoteMatch[1].trim();
  }

  const genericQuotes = rawDetails.match(/"([^"]{3,})"/);
  if (genericQuotes && genericQuotes[1]) {
    return genericQuotes[1].trim();
  }

  let cleaned = rawDetails
    .replace(/^AI prompt submitted to [^:]+:\s*/i, '')
    .replace(/^AI prompt:\s*/i, '')
    .replace(/^Prohibited AI prompt attempted:\s*/i, '')
    .replace(/^ChatGPT prompt submitted:\s*/i, '')
    .replace(/^Search query submitted to [^:]+:\s*/i, '')
    .replace(/^Candidate loaded monitored resource:\s*/i, '')
    .trim();

  return cleaned;
}

export function evaluatePrompt(rawPromptOrDetails: string): PromptEvaluationResult {
  const cleanPrompt = extractCleanPrompt(rawPromptOrDetails);
  const promptLower = cleanPrompt.toLowerCase();
  const charLength = cleanPrompt.length;
  const wordCount = cleanPrompt.split(/\s+/).filter(Boolean).length;

  const detectedTechniques: string[] = [];
  const detectedAntiPatterns: string[] = [];
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  const isLazy = charLength < 15 || (wordCount <= 2 && /^(hi|hello|hey|test|answer|ans|ok|okay|help|code)$/i.test(promptLower.trim()));
  if (isLazy) {
    detectedAntiPatterns.push('Low Effort / Telemetry Noise');
    weaknesses.push('Single word or greeting lacking intellectual query context');
  }

  let isDirectAnswerSeeking = false;
  for (const pattern of DIRECT_ANSWER_SEEKING_PATTERNS) {
    if (pattern.test(cleanPrompt)) {
      isDirectAnswerSeeking = true;
      break;
    }
  }

  let rawMcqDetected = false;
  for (const pattern of RAW_MCQ_INDICATORS) {
    if (pattern.test(cleanPrompt)) {
      rawMcqDetected = true;
      break;
    }
  }

  if (isDirectAnswerSeeking) {
    detectedAntiPatterns.push('Direct Answer Solicitation');
    weaknesses.push('Directly solicited exam solution/correct option from AI');
  }
  if (rawMcqDetected) {
    detectedAntiPatterns.push('Raw Exam Question / MCQ Paste');
    weaknesses.push('Verbatim copy-paste of multiple-choice question format');
  }

  let hasRole = false;
  for (const pattern of ROLE_PROMPTING_PATTERNS) {
    if (pattern.test(cleanPrompt)) {
      hasRole = true;
      detectedTechniques.push('Role Assignment / Persona');
      strengths.push('Defined explicit expert persona to guide model response');
      break;
    }
  }

  let hasChainOfThought = false;
  for (const pattern of CHAIN_OF_THOUGHT_PATTERNS) {
    if (pattern.test(cleanPrompt)) {
      hasChainOfThought = true;
      detectedTechniques.push('Chain of Thought / Step-by-Step');
      strengths.push('Requested step-by-step reasoning rather than raw answers');
      break;
    }
  }

  let hasNegativeConstraint = false;
  for (const pattern of NEGATIVE_CONSTRAINTS) {
    if (pattern.test(cleanPrompt)) {
      hasNegativeConstraint = true;
      detectedTechniques.push('Negative Boundary / Anti-Cheating Constraint');
      strengths.push('Instructed AI to avoid giving direct answers or code');
      break;
    }
  }

  let hasFormatConstraint = false;
  for (const pattern of FORMAT_CONSTRAINTS) {
    if (pattern.test(cleanPrompt)) {
      hasFormatConstraint = true;
      detectedTechniques.push('Structured Format Specification');
      strengths.push('Constrained output to structured format (markdown, table, etc.)');
      break;
    }
  }

  const domainMatches = CS_TECHNICAL_KEYWORDS.filter(kw => promptLower.includes(kw));
  if (domainMatches.length > 0) {
    detectedTechniques.push(`Domain Vocabulary (${domainMatches.slice(0, 3).join(', ')})`);
    strengths.push(`Employed precise technical terminology: ${domainMatches.slice(0, 3).join(', ')}`);
  }

  const isAnalyticalQuery = ANALYTICAL_INQUIRY_PATTERNS.some(p => p.test(cleanPrompt));
  if (isAnalyticalQuery && !isDirectAnswerSeeking) {
    detectedTechniques.push('Analytical Conceptual Inquiry');
    strengths.push('Formulated socratic inquiry seeking technical understanding');
  }

  // -------------------------------------------------------------
  // Scoring Dimension Calculations (0 to 100 total)
  // -------------------------------------------------------------

  // Dimension 1: Critical Thinking vs Answer Seeking (0 to 30)
  let criticalThinkingScore = 22;
  if (isDirectAnswerSeeking || rawMcqDetected) {
    criticalThinkingScore = Math.max(0, 5 - (rawMcqDetected ? 5 : 0));
  } else if (hasNegativeConstraint) {
    criticalThinkingScore = 30;
  } else if (hasChainOfThought) {
    criticalThinkingScore = 28;
  } else if (isAnalyticalQuery) {
    criticalThinkingScore = 26;
  } else if (domainMatches.length > 0 && !isLazy) {
    criticalThinkingScore = 24;
  } else if (isLazy) {
    criticalThinkingScore = 5;
  }

  // Dimension 2: Context and Framing (0 to 25)
  let contextScore = 0;
  if (isLazy) {
    contextScore = 2;
  } else if (wordCount >= 25) {
    contextScore = 25;
  } else if (wordCount >= 15) {
    contextScore = 20;
  } else if (wordCount >= 10) {
    contextScore = 16;
  } else if (wordCount >= 6) {
    contextScore = 12;
  } else {
    contextScore = 6;
  }
  if (domainMatches.length >= 2 && contextScore < 24) {
    contextScore += 2;
  }

  // Dimension 3: Prompt Engineering Techniques (0 to 25)
  let techniquesScore = 0;
  if (hasRole) techniquesScore += 9;
  if (hasChainOfThought) techniquesScore += 8;
  if (hasNegativeConstraint) techniquesScore += 5;
  if (isAnalyticalQuery) techniquesScore += 4;
  if (domainMatches.length > 0) techniquesScore += 3;
  techniquesScore = Math.min(25, techniquesScore);

  // Dimension 4: Constraint Specification & Output Formatting (0 to 20)
  let constraintScore = 0;
  if (hasFormatConstraint) constraintScore += 12;
  if (hasNegativeConstraint) constraintScore += 5;
  if (/limit|between|less than|greater than|O\(|worst[- ]case|markdown|table/i.test(cleanPrompt)) constraintScore += 3;
  constraintScore = Math.min(20, constraintScore);

  // Final Composite Quality Score
  let qualityScore = criticalThinkingScore + contextScore + techniquesScore + constraintScore;

  if (isDirectAnswerSeeking && qualityScore > 40) {
    qualityScore = Math.min(38, qualityScore - 25);
  }
  if (rawMcqDetected && qualityScore > 30) {
    qualityScore = Math.min(25, qualityScore - 20);
  }
  if (isLazy) {
    qualityScore = Math.min(15, qualityScore);
  }

  qualityScore = Math.max(5, Math.min(100, Math.round(qualityScore)));

  // Tier Determination
  let tier: PromptQualityTier = 'MODERATE';
  let ratingLabel = 'Moderate Quality';

  if (isLazy) {
    tier = 'LAZY_INPUT';
    ratingLabel = 'Low Effort / Lazy';
  } else if (isDirectAnswerSeeking || rawMcqDetected) {
    tier = 'POOR_DIRECT_ANSWER';
    ratingLabel = 'Bad Prompt (Direct Answer Seeking)';
  } else if (qualityScore >= 80) {
    tier = 'EXEMPLARY';
    ratingLabel = 'Exemplary Prompt Engineering';
  } else if (qualityScore >= 65) {
    tier = 'GOOD';
    ratingLabel = 'Good Quality Prompt';
  } else if (qualityScore >= 45) {
    tier = 'MODERATE';
    ratingLabel = 'Moderate Conceptual Query';
  } else {
    tier = 'POOR_DIRECT_ANSWER';
    ratingLabel = 'Low Quality Query';
  }

  let verdict = '';
  let summaryReason = '';
  let recommendation = '';

  if (tier === 'EXEMPLARY') {
    verdict = 'High-Value Prompt Engineering — Candidate deconstructs the problem, specifies roles/constraints, and seeks reasoning rather than verbatim answers.';
    summaryReason = 'Demonstrates sophisticated prompt engineering: role persona, structured constraints, and step-by-step logic inquiry.';
    recommendation = 'Model prompt engineering behavior. Eligible for top-tier prompt evaluation marks.';
  } else if (tier === 'GOOD') {
    verdict = 'Effective Problem Decomposition — Well-framed technical query with clear context and thoughtful boundaries.';
    summaryReason = 'Strong conceptual exploration with good technical depth, minimal direct answer reliance.';
    recommendation = 'Good performance. Adding explicit output formatting or negative constraints would elevate this to exemplary.';
  } else if (tier === 'MODERATE') {
    verdict = 'Basic Conceptual Lookup — Standard factual inquiry without structured prompt engineering techniques.';
    summaryReason = 'Candidate asked a standard technical question. No cheating detected, but prompt lacks constraints, persona, or multi-step reasoning.';
    recommendation = 'Encourage using role prompting ("Act as...") and step-by-step reasoning constraints to improve LLM output clarity.';
  } else if (tier === 'POOR_DIRECT_ANSWER') {
    verdict = 'Direct Answer Seeking (Cheating Pattern) — Candidate bypassed intellectual problem-solving and solicited direct exam answers/options.';
    summaryReason = 'Detected direct solution hunting ("What is the answer", "Which option", or verbatim MCQ paste) instead of concept exploration.';
    recommendation = 'Flag for administrative review. Deduct prompt engineering points for unassisted answer solicitation.';
  } else {
    verdict = 'Low-Effort / Telemetry Noise — Candidate submitted a one-word or greeting prompt without analytical intent.';
    summaryReason = 'Prompt contains insufficient character length or substance (<15 chars).';
    recommendation = 'Discard from substantive evaluation or flag as non-productive AI interaction.';
  }

  return {
    cleanPrompt,
    qualityScore,
    tier,
    ratingLabel,
    isDirectAnswerSeeking,
    verdict,
    summaryReason,
    criteriaScores: {
      criticalThinkingVsAnswerSeeking: criticalThinkingScore,
      contextAndFraming: contextScore,
      promptEngineeringTechniques: techniquesScore,
      constraintSpecification: constraintScore
    },
    detectedTechniques,
    detectedAntiPatterns,
    strengths,
    weaknesses,
    recommendation
  };
}

export function aggregatePromptAnalytics(events: any[]): PromptAnalyticsAggregate {
  const promptEvents = (events || []).filter(e => 
    e.eventType === 'ai_query_submitted' || 
    (e.details && (
      e.details.toLowerCase().includes('prompt') || 
      e.details.toLowerCase().includes('chatgpt') || 
      e.details.toLowerCase().includes('claude') || 
      e.details.toLowerCase().includes('gemini')
    ))
  );

  let totalScore = 0;
  let directAnswerCount = 0;

  const qualityBreakdown = {
    exemplary: 0,
    good: 0,
    moderate: 0,
    poorDirectAnswer: 0,
    lazyInput: 0
  };

  const techniqueFrequency: Record<string, number> = {};
  const antiPatternFrequency: Record<string, number> = {};
  const candidateScores: Record<string, any> = {};

  for (const ev of promptEvents) {
    const analysis = evaluatePrompt(ev.details || ev.prompt || '');
    totalScore += analysis.qualityScore;

    if (analysis.isDirectAnswerSeeking) {
      directAnswerCount++;
    }

    if (analysis.tier === 'EXEMPLARY') qualityBreakdown.exemplary++;
    else if (analysis.tier === 'GOOD') qualityBreakdown.good++;
    else if (analysis.tier === 'MODERATE') qualityBreakdown.moderate++;
    else if (analysis.tier === 'POOR_DIRECT_ANSWER') qualityBreakdown.poorDirectAnswer++;
    else if (analysis.tier === 'LAZY_INPUT') qualityBreakdown.lazyInput++;

    for (const t of analysis.detectedTechniques) {
      techniqueFrequency[t] = (techniqueFrequency[t] || 0) + 1;
    }
    for (const ap of analysis.detectedAntiPatterns) {
      antiPatternFrequency[ap] = (antiPatternFrequency[ap] || 0) + 1;
    }

    const studentKey = ev.studentId || ev.studentEmail || ev.attemptId || 'unknown';
    if (!candidateScores[studentKey]) {
      candidateScores[studentKey] = {
        studentId: ev.studentId || '',
        studentName: ev.studentName || 'Candidate',
        studentEmail: ev.studentEmail || '',
        attemptId: ev.attemptId || '',
        totalScores: 0,
        promptCount: 0,
        directAnswerCount: 0
      };
    }
    candidateScores[studentKey].totalScores += analysis.qualityScore;
    candidateScores[studentKey].promptCount++;
    if (analysis.isDirectAnswerSeeking) {
      candidateScores[studentKey].directAnswerCount++;
    }
  }

  const count = promptEvents.length;
  const averageQualityScore = count > 0 ? Math.round(totalScore / count) : 0;
  const directAnswerSeekingPercentage = count > 0 ? Math.round((directAnswerCount / count) * 100) : 0;

  const candidatePersonas: Record<string, any> = {};
  for (const [key, cand] of Object.entries(candidateScores)) {
    const avg = cand.promptCount > 0 ? Math.round(cand.totalScores / cand.promptCount) : 0;
    const directRatio = cand.promptCount > 0 ? cand.directAnswerCount / cand.promptCount : 0;

    let persona: any = 'Mixed Explorer';
    if (directRatio > 0.5) {
      persona = 'Direct Answer Seeker (Cheating Pattern)';
    } else if (avg >= 80) {
      persona = 'Strategic Prompt Engineer';
    } else if (avg >= 60) {
      persona = 'Thoughtful Inquirer';
    } else if (avg < 30) {
      persona = 'Low Effort';
    }

    candidatePersonas[key] = {
      studentId: cand.studentId,
      studentName: cand.studentName,
      studentEmail: cand.studentEmail,
      attemptId: cand.attemptId,
      promptCount: cand.promptCount,
      averageScore: avg,
      directAnswerCount: cand.directAnswerCount,
      persona
    };
  }

  return {
    totalPromptsAnalyzed: count,
    averageQualityScore,
    directAnswerSeekingCount: directAnswerCount,
    directAnswerSeekingPercentage,
    qualityBreakdown,
    techniqueFrequency,
    antiPatternFrequency,
    candidatePersonas
  };
}
