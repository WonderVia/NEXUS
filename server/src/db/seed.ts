import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { db, initDatabase } from './schema.js';

export const SEED_QUESTIONS = [
  // SECTION 1: Quantitative Aptitude & Logical Reasoning (Questions 1 - 4)
  {
    category: 'Quantitative Aptitude',
    questionText: 'A train 240 m long passes a pole in 24 seconds. How long will it take to pass a platform 650 m long?',
    options: [
      '65 seconds',
      '89 seconds',
      '100 seconds',
      '150 seconds'
    ],
    correctAnswer: 1, // 89 seconds: speed = 240/24 = 10 m/s; total distance = 240 + 650 = 890 m; time = 890 / 10 = 89 s
    explanation: 'Speed of train = 240 m / 24 s = 10 m/s. Total distance to cross platform = 240 + 650 = 890 m. Time taken = 890 / 10 = 89 seconds.'
  },
  {
    category: 'Logical Reasoning',
    questionText: 'If in a certain code language, "PROCTOR" is coded as "RTQEVQT", how is "BROWSER" coded in that language?',
    options: [
      'DTQYUGT',
      'DTRYYGT',
      'DTQYTHS',
      'CTQYUGT'
    ],
    correctAnswer: 0, // +2 shift: B(+2)=D, R(+2)=T, O(+2)=Q, W(+2)=Y, S(+2)=U, E(+2)=G, R(+2)=T -> DTQYUGT
    explanation: 'Each letter in the word is shifted forward by 2 positions in alphabetical order (+2). B->D, R->T, O->Q, W->Y, S->U, E->G, R->T. Result is DTQYUGT.'
  },
  {
    category: 'Quantitative Aptitude',
    questionText: 'Two pipes A and B can fill a tank in 20 and 30 minutes respectively. If both pipes are opened together, the time taken to fill the tank is:',
    options: [
      '50 minutes',
      '25 minutes',
      '15 minutes',
      '12 minutes'
    ],
    correctAnswer: 3, // 1/20 + 1/30 = 5/60 = 1/12 -> 12 mins
    explanation: 'Part filled in 1 min = (1/20 + 1/30) = 5/60 = 1/12. Hence the tank is filled in 12 minutes.'
  },
  {
    category: 'Logical Reasoning',
    questionText: 'Statement: "All firewalls are security systems. Some security systems are cloud-native." Conclusion I: Some firewalls are cloud-native. Conclusion II: Some security systems are firewalls.',
    options: [
      'Only Conclusion I follows',
      'Only Conclusion II follows',
      'Both Conclusions I and II follow',
      'Neither Conclusion follows'
    ],
    correctAnswer: 1,
    explanation: 'All firewalls are security systems implies that the subset of security systems that are firewalls exists (Some security systems are firewalls). Conclusion I does not necessarily follow from the premises.'
  },

  // SECTION 2: Data Structures & Algorithms (Questions 5 - 8)
  {
    category: 'Data Structures',
    questionText: 'What is the worst-case time complexity of searching for an element in an unbalanced Binary Search Tree (BST) containing n nodes?',
    options: [
      'O(1)',
      'O(log n)',
      'O(n)',
      'O(n log n)'
    ],
    correctAnswer: 2, // O(n) when degenerated into linked list
    explanation: 'In the worst case, an unbalanced BST can degenerate into a skewed linked list where all nodes have only one child, requiring O(n) comparisons.'
  },
  {
    category: 'Algorithms',
    questionText: 'Which sorting algorithm has a guaranteed worst-case time complexity of O(n log n) while also operating in-place with O(1) auxiliary space?',
    options: [
      'Merge Sort',
      'Heap Sort',
      'Quick Sort',
      'Insertion Sort'
    ],
    correctAnswer: 1, // Heap Sort
    explanation: 'Heap Sort achieves O(n log n) worst-case time complexity while modifying the array in-place requiring O(1) auxiliary space. Merge Sort requires O(n) auxiliary space.'
  },
  {
    category: 'Data Structures',
    questionText: 'In a circular queue implemented using an array of size N, what condition indicates that the queue is completely full?',
    options: [
      'front == rear',
      '(rear + 1) % N == front',
      'rear == N - 1',
      '(front + 1) % N == rear'
    ],
    correctAnswer: 1,
    explanation: 'In a circular queue with array size N, leaving one slot empty distinguishes between completely full and completely empty states: (rear + 1) % N == front indicates full.'
  },
  {
    category: 'Algorithms',
    questionText: 'Dijkstra’s algorithm for finding the single-source shortest path is not suitable for graphs containing:',
    options: [
      'Cycles',
      'Directed edges',
      'Negative edge weights',
      'Disconnected components'
    ],
    correctAnswer: 2,
    explanation: 'Dijkstra’s greedy approach assumes that once a vertex distance is finalized, it cannot be reduced further. Negative edge weights violate this assumption and can produce incorrect shortest path estimates.'
  },

  // SECTION 3: Operating Systems & System Architecture (Questions 9 - 12)
  {
    category: 'Operating Systems',
    questionText: 'Which of the following is NOT one of the four Coffman conditions necessary for a system deadlock to occur?',
    options: [
      'Mutual Exclusion',
      'Hold and Wait',
      'Preemptive Resource Allocation',
      'Circular Wait'
    ],
    correctAnswer: 2, // No preemption is required; Preemptive resource allocation prevents deadlock!
    explanation: 'The four Coffman conditions are Mutual Exclusion, Hold and Wait, No Preemption, and Circular Wait. "Preemptive Resource Allocation" actually prevents deadlock.'
  },
  {
    category: 'Operating Systems',
    questionText: 'What is the phenomenon called when excessive paging activity causes the operating system to spend more time swapping pages than executing processes?',
    options: [
      'Segmentation Fault',
      'Thrashing',
      'Belady’s Anomaly',
      'Internal Fragmentation'
    ],
    correctAnswer: 1, // Thrashing
    explanation: 'Thrashing occurs when the system spends an excessive amount of time swapping pages between RAM and disk storage rather than executing actual instructions, leading to severe performance collapse.'
  },
  {
    category: 'Operating Systems',
    questionText: 'In process synchronization, how does a counting semaphore initialized to value 3 behave when 4 concurrent processes execute wait() (P) operations?',
    options: [
      'All 4 processes enter the critical section',
      'The first 3 processes proceed, and the 4th process is blocked',
      'All 4 processes are blocked immediately',
      'An arithmetic overflow exception occurs'
    ],
    correctAnswer: 1,
    explanation: 'A counting semaphore allows up to N concurrent threads. With initial value 3, the first 3 wait() calls decrement the counter to 0 and proceed. The 4th wait() decrements to -1 and blocks the process.'
  },
  {
    category: 'System Architecture',
    questionText: 'In computer architecture, what principle explains why programs tend to reuse data and instructions they have referenced recently?',
    options: [
      'Amdahl’s Law',
      'Locality of Reference (Temporal & Spatial)',
      'Moore’s Law',
      'Flynn’s Taxonomy'
    ],
    correctAnswer: 1,
    explanation: 'Locality of reference describes the tendency of a processor to access the same set of memory locations repetitively over a short period (temporal locality) or nearby storage locations (spatial locality).'
  },

  // SECTION 4: Database Management Systems (Questions 13 - 16)
  {
    category: 'Databases',
    questionText: 'Which ACID property guarantees that multiple concurrent transactions will execute without interfering with one another, yielding the same result as sequential execution?',
    options: [
      'Atomicity',
      'Consistency',
      'Isolation',
      'Durability'
    ],
    correctAnswer: 2, // Isolation
    explanation: 'Isolation ensures that concurrent execution of transactions results in a system state that would be obtained if transactions were executed sequentially (serializability).'
  },
  {
    category: 'Databases',
    questionText: 'A database relation is in Third Normal Form (3NF) if and only if it is in 2NF and:',
    options: [
      'Every determinant is a candidate key',
      'No non-prime attribute is transitively dependent on the primary key',
      'There are no multivalued dependencies',
      'All attributes are atomic values'
    ],
    correctAnswer: 1,
    explanation: 'A table is in 3NF if it is in 2NF and no non-prime attribute has a transitive dependency on any candidate/primary key (X -> Y requires X is superkey or Y is prime attribute).'
  },
  {
    category: 'Databases',
    questionText: 'What is the primary operational advantage of using a B+ Tree index over a Hash Index in relational database engines?',
    options: [
      'O(1) exact equality lookups',
      'Efficient execution of range queries (e.g., WHERE age BETWEEN 20 AND 30)',
      'Lower disk storage requirements',
      'Zero locking overhead during writes'
    ],
    correctAnswer: 1,
    explanation: 'B+ Tree leaf nodes are linked in sequential order, making range queries, ordering (ORDER BY), and prefix searches extremely efficient compared to Hash Indexes which only support exact key lookups.'
  },
  {
    category: 'Databases',
    questionText: 'What SQL isolation level prevents dirty reads, non-repeatable reads, and phantom reads simultaneously?',
    options: [
      'Read Uncommitted',
      'Read Committed',
      'Repeatable Read',
      'Serializable'
    ],
    correctAnswer: 3, // Serializable
    explanation: 'Serializable is the highest isolation level. It prevents Dirty Reads, Non-repeatable Reads, and Phantom Reads by ensuring transactions execute as if they were serial.'
  },

  // SECTION 5: Computer Networks & Cybersecurity (Questions 17 - 20)
  {
    category: 'Computer Networks',
    questionText: 'During a standard TCP three-way handshake connection establishment, what flags are set in the second packet sent from the server to the client?',
    options: [
      'SYN',
      'SYN-ACK',
      'ACK',
      'FIN-ACK'
    ],
    correctAnswer: 1, // SYN-ACK
    explanation: 'Step 1: Client sends SYN. Step 2: Server responds with SYN and ACK flags set (SYN-ACK). Step 3: Client responds with ACK.'
  },
  {
    category: 'Cybersecurity',
    questionText: 'Which cryptographic algorithm is based on the computational difficulty of factoring the product of two large prime numbers?',
    options: [
      'AES (Advanced Encryption Standard)',
      'SHA-256 (Secure Hash Algorithm)',
      'RSA (Rivest–Shamir–Adleman)',
      'Diffie-Hellman Key Exchange over Elliptic Curves'
    ],
    correctAnswer: 2, // RSA
    explanation: 'The security of RSA asymmetric public-key cryptography relies on the practical difficulty of the factorization of the product of two large prime numbers (the RSA problem).'
  },
  {
    category: 'Cybersecurity',
    questionText: 'What browser security mechanism restricts a web page from making requests to a different domain, protocol, or port than the one that served the original web page?',
    options: [
      'Content Security Policy (CSP)',
      'Same-Origin Policy (SOP)',
      'Cross-Site Scripting (XSS) Filter',
      'Subresource Integrity (SRI)'
    ],
    correctAnswer: 1, // SOP
    explanation: 'The Same-Origin Policy (SOP) is a critical security mechanism that restricts how a document or script loaded from one origin can interact with a resource from another origin.'
  },
  {
    category: 'Computer Science',
    questionText: 'In modern Web Application security, what defense is recommended to prevent Cross-Site Request Forgery (CSRF) attacks?',
    options: [
      'Encrypting passwords using Base64 encoding',
      'Using Anti-CSRF tokens and SameSite cookie attributes (Strict/Lax)',
      'Disabling HTTPS TLS certificates',
      'Storing session IDs in localStorage accessible via JavaScript'
    ],
    correctAnswer: 1,
    explanation: 'Anti-CSRF tokens (unique, secret, and unpredictable tokens validated on state-changing requests) together with SameSite=Lax/Strict cookie attributes provide robust defense against CSRF.'
  }
];

export async function seedDatabase() {
  initDatabase();

  console.log('Seeding database with default users and assessments...');

  // Hash demo passwords
  const adminPasswordHash = await bcrypt.hash('Admin@123', 10);
  const studentPasswordHash = await bcrypt.hash('Student@123', 10);

  const adminId = 'user-admin-001';
  const studentId = 'user-student-001';
  const assessmentId = 'assessment-ngata-2026';

  const now = new Date().toISOString();

  // Insert Users
  const insertUser = db.prepare(`
    INSERT OR REPLACE INTO users (id, name, email, passwordHash, role, createdAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  insertUser.run(adminId, 'Dr. Sarah Mitchell (Administrator)', 'admin@wuelev8.com', adminPasswordHash, 'admin', now);
  insertUser.run(studentId, 'Alex Chen (Student)', 'student@wuelev8.com', studentPasswordHash, 'student', now);

  // Policy configuration for Scenario B: Strict DSA / Independent Coding Assessment
  const dsaPolicy = JSON.stringify({
    maxMinorViolations: 3,
    maxTotalViolations: 5,
    faceAbsenceTimeoutSec: 7,
    focusLossAllowanceSec: 4,
    requireFullscreen: true,
    requireWebcam: true,
    requireMicrophone: false,
    autoSubmitOnCriticalViolations: true,
    // Assessment Security Settings (Admin Configurable)
    aiUsage: 'prohibited',
    aiPromptMonitoring: 'disabled',
    tabSwitchingPolicy: 'restrict',
    externalResourceAccess: 'restricted',
    permittedWebsites: [],
    violationHandling: 'terminate',
    allowOfflineMode: false,
    connectivityPolicy: 'require_continuous'
  });

  // Policy configuration for Scenario A: Prompt Engineering Interview (AI Allowed, Prompts Monitored)
  const promptEngPolicy = JSON.stringify({
    maxMinorViolations: 5,
    maxTotalViolations: 10,
    faceAbsenceTimeoutSec: 10,
    focusLossAllowanceSec: 6,
    requireFullscreen: false,
    requireWebcam: true,
    requireMicrophone: false,
    autoSubmitOnCriticalViolations: false,
    // Assessment Security Settings (Admin Configurable)
    aiUsage: 'allowed',
    aiPromptMonitoring: 'enabled',
    tabSwitchingPolicy: 'warn',
    externalResourceAccess: 'allowed',
    permittedWebsites: ['chatgpt.com', 'openai.com', 'claude.ai', 'gemini.google.com', 'perplexity.ai'],
    violationHandling: 'record_only',
    allowOfflineMode: true,
    connectivityPolicy: 'allow_offline'
  });

  // Insert Assessment
  const insertAssessment = db.prepare(`
    INSERT OR REPLACE INTO assessments (id, title, description, durationMinutes, status, totalMarks, passMarks, policy, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Scenario B Assessment (Strict)
  insertAssessment.run(
    assessmentId,
    'National Graduate Aptitude & Technical Assessment (NGATA 2026)',
    'Comprehensive multi-disciplinary assessment covering Quantitative Aptitude, Logical Reasoning, Algorithms, Data Structures, Operating Systems, Computer Networks, and Modern Cybersecurity.',
    25, // 25 minutes
    'active',
    100,
    40,
    dsaPolicy,
    now
  );

  // Scenario A Assessment (Prompt Engineering - AI Allowed & Monitored)
  const promptEngAssessmentId = 'assessment-prompt-eng';
  insertAssessment.run(
    promptEngAssessmentId,
    'AI & Prompt Engineering Technical Assessment',
    'Interactive practical assessment evaluating prompt engineering techniques, problem decomposition, and AI-assisted technical workflows. AI tools are permitted and interactions are monitored for evaluation.',
    30, // 30 minutes
    'active',
    100,
    50,
    promptEngPolicy,
    now
  );

  // Reset previous attempts, events, and answers for a pristine state
  db.prepare(`DELETE FROM answers`).run();
  db.prepare(`DELETE FROM proctoring_events`).run();
  db.prepare(`DELETE FROM attempts`).run();

  // Clear existing questions for both assessments
  db.prepare(`DELETE FROM questions WHERE assessmentId = ?`).run(assessmentId);
  db.prepare(`DELETE FROM questions WHERE assessmentId = ?`).run(promptEngAssessmentId);

  // Insert Questions
  const insertQuestion = db.prepare(`
    INSERT INTO questions (id, assessmentId, questionText, options, correctAnswer, explanation, category, orderIndex)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  SEED_QUESTIONS.forEach((q, index) => {
    insertQuestion.run(
      `q-ngata-${String(index + 1).padStart(3, '0')}`,
      assessmentId,
      q.questionText,
      JSON.stringify(q.options),
      q.correctAnswer,
      q.explanation,
      q.category,
      index + 1
    );
  });

  // Questions for Scenario A: Prompt Engineering Assessment
  const PROMPT_ENG_QUESTIONS = [
    {
      category: 'Prompt Engineering',
      questionText: 'Which prompting technique provides one or more input-output examples directly in the context to guide the model format and output?',
      options: ['Zero-Shot Prompting', 'Few-Shot Prompting', 'Directional Stimulus Prompting', 'Prefix Prompting'],
      correctAnswer: 1,
      explanation: 'Few-Shot prompting provides demonstrations/examples in the prompt to condition the model to follow specific formatting and reasoning patterns.'
    },
    {
      category: 'Prompt Engineering',
      questionText: 'What is Chain-of-Thought (CoT) prompting primarily designed to accomplish?',
      options: [
        'Speed up LLM generation latency',
        'Break complex multi-step reasoning problems into intermediate reasoning steps',
        'Compress prompt tokens to save context window size',
        'Directly execute Python code inside the language model weights'
      ],
      correctAnswer: 1,
      explanation: 'Chain-of-Thought prompting encourages the model to generate intermediate steps of reasoning before producing the final answer, dramatically improving performance on complex logic and math.'
    },
    {
      category: 'AI Architecture',
      questionText: 'When developing production LLM pipelines, which parameter adjustment is most effective for ensuring repeatable, deterministic answers for automated unit tests?',
      options: ['Set temperature close to 0.0', 'Set top_k to maximum value (e.g. 1000)', 'Increase frequency_penalty to 2.0', 'Double the max_tokens parameter'],
      correctAnswer: 0,
      explanation: 'Setting temperature to 0.0 (or greedy decoding) selects the token with highest probability at each step, yielding the most deterministic, reproducible outputs.'
    },
    {
      category: 'Prompt Engineering',
      questionText: 'To mitigate hallucinations when using LLMs for factual summarization, which prompt design strategy is most reliable?',
      options: [
        'Tell the model to assume all input is true without verification',
        'Provide grounded source documents and instruct the model to answer strictly using the provided context and state "Information not found" if missing',
        'Prompt the model in all capital letters',
        'Increase model temperature to 1.5'
      ],
      correctAnswer: 1,
      explanation: 'Grounded generation (RAG style) with explicit boundary instructions ("Answer strictly based on the provided text; say not found if missing") significantly reduces hallucinations.'
    },
    {
      category: 'System Design with AI',
      questionText: 'What is the primary role of the "System" prompt in modern chat-based AI APIs (such as OpenAI or Anthropic)?',
      options: [
        'It is discarded by the tokenizer and used only for internal telemetry',
        'It defines the high-level persona, security boundaries, behavioral constraints, and instructions that govern the conversation',
        'It functions identically to user inputs and has no special priority',
        'It acts as the database cache key'
      ],
      correctAnswer: 1,
      explanation: 'The system message sets high-level instructions, rules, constraints, and operational personas that guide the model throughout subsequent user turns.'
    }
  ];

  PROMPT_ENG_QUESTIONS.forEach((q, index) => {
    insertQuestion.run(
      `q-prompt-${String(index + 1).padStart(3, '0')}`,
      promptEngAssessmentId,
      q.questionText,
      JSON.stringify(q.options),
      q.correctAnswer,
      q.explanation,
      q.category,
      index + 1
    );
  });

  console.log(`Successfully seeded:`);
  console.log(`  - 2 Demo Users (admin@wuelev8.com / Admin@123, student@wuelev8.com / Student@123)`);
  console.log(`  - Assessment B: NGATA 2026 (${assessmentId}) - AI Prohibited, Tab Restrict`);
  console.log(`  - Assessment A: Prompt Engineering (${promptEngAssessmentId}) - AI Allowed, Prompts Monitored`);
  console.log(`  - ${SEED_QUESTIONS.length + PROMPT_ENG_QUESTIONS.length} Verified Questions with detailed explanations.`);
  console.log(`  - ${SEED_QUESTIONS.length} Verified Questions with detailed explanations across 5 CS domains.`);
}

// Execute seeding
seedDatabase()
  .then(() => {
    console.log('Seed completed successfully!');
  })
  .catch((err) => {
    console.error('Seed failed:', err);
  });

