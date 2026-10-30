/**
 * Controlled Exam Navigation Policy Engine
 * 
 * Enforces strict examination window security:
 * - Allows approved assessment origin and internal assessment routes.
 * - Prevents arbitrary external websites from hijacking or loading inside the exam window.
 * - Supports configurable allowed external domains (e.g. approved documentation/references).
 * - Intercepts unapproved popups and redirects.
 * - Emits audit events without abruptly terminating candidate assessments.
 */

const { URL } = require('url');

class NavigationPolicy {
  constructor(options = {}) {
    this.isExamActive = false;
    this.permittedExternalDomains = new Set(options.permittedExternalDomains || []);
    
    // Configurable approved assessment origins (supports dev and prod without hardcoding)
    this.approvedOrigins = new Set();
    this.approvedHostnames = new Set(['localhost', '127.0.0.1']);
    
    // Add custom base URL from environment if provided
    const envOrigin = process.env.ASSESSMENT_ORIGIN || process.env.VITE_DEV_SERVER_URL || process.env.PROCTOR_API_URL;
    if (envOrigin) {
      try {
        const parsed = new URL(envOrigin);
        this.approvedOrigins.add(parsed.origin);
        this.approvedHostnames.add(parsed.hostname);
      } catch {}
    }

    // Default development origins
    this.approvedOrigins.add('http://localhost:5173');
    this.approvedOrigins.add('http://127.0.0.1:5173');
    this.approvedOrigins.add('http://localhost:5000');
    this.approvedOrigins.add('http://127.0.0.1:5000');
    this.aiUsage = 'prohibited';
    this.externalResourceAccess = 'restricted';
  }

  setExamActive(active, options = {}) {
    this.isExamActive = Boolean(active);
    
    let permitted = [];
    if (Array.isArray(options)) {
      permitted = [...options];
    } else if (options && typeof options === 'object') {
      permitted = Array.isArray(options.permittedExternalDomains) 
        ? [...options.permittedExternalDomains] 
        : (Array.isArray(options.permittedWebsites) ? [...options.permittedWebsites] : []);
      this.aiUsage = options.aiUsage || 'prohibited';
      this.externalResourceAccess = options.externalResourceAccess || 'restricted';
    }

    // If AI usage is allowed for this assessment, automatically permit supported AI domains
    if (this.aiUsage === 'allowed') {
      permitted.push(
        'chatgpt.com', 'openai.com', 
        'claude.ai', 'anthropic.com', 
        'gemini.google.com', 'perplexity.ai', 
        'copilot.microsoft.com'
      );
    }

    this.permittedExternalDomains = new Set(
      permitted.map(d => d.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim()).filter(Boolean)
    );
    console.log(`[Navigation Policy] Exam active: ${this.isExamActive}. AI Usage: ${this.aiUsage}, Ext Access: ${this.externalResourceAccess}. Permitted domains:`, Array.from(this.permittedExternalDomains));
  }

  addApprovedOrigin(origin) {
    if (!origin) return;
    try {
      const parsed = new URL(origin);
      this.approvedOrigins.add(parsed.origin);
      this.approvedHostnames.add(parsed.hostname);
    } catch {
      this.approvedHostnames.add(origin.toLowerCase());
    }
  }

  isPermittedExternalDomain(hostname) {
    const lower = hostname.toLowerCase();
    for (const domain of this.permittedExternalDomains) {
      if (lower === domain || lower.endsWith(`.${domain}`)) {
        return true;
      }
    }
    return false;
  }

  evaluateNavigation(targetUrl) {
    // 1. Allow local file protocols (packaged client bundle)
    if (targetUrl.startsWith('file:') || targetUrl.startsWith('devtools:') || targetUrl.startsWith('data:') || targetUrl.startsWith('blob:')) {
      return { allowed: true, reason: 'internal_protocol' };
    }

    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return { allowed: false, reason: 'malformed_url', message: 'Malformed URL' };
    }

    // 2. Allow requests within approved application origins
    if (this.approvedOrigins.has(parsed.origin) || this.approvedHostnames.has(parsed.hostname)) {
      return { allowed: true, reason: 'approved_assessment_origin' };
    }

    // 3. If exam mode is NOT active, navigation within app or localhost is open
    if (!this.isExamActive) {
      // Allow general navigation when outside active exam session
      return { allowed: true, reason: 'outside_exam_session' };
    }

    // 4. During active exam, check if external resource access is generally allowed or domain is permitted
    if (this.externalResourceAccess === 'allowed') {
      return {
        allowed: true,
        monitored: true,
        reason: 'external_resource_access_allowed',
        domain: parsed.hostname
      };
    }

    if (this.isPermittedExternalDomain(parsed.hostname)) {
      return { 
        allowed: true, 
        monitored: true, 
        reason: 'permitted_external_domain',
        domain: parsed.hostname
      };
    }

    // 5. Blocked: External website during active exam
    return {
      allowed: false,
      reason: 'exam_policy_restricted',
      message: `Access to ${parsed.hostname} is restricted by WUElev8 Exam Security Policy.`,
      url: targetUrl,
      hostname: parsed.hostname
    };
  }
}

module.exports = { NavigationPolicy };

