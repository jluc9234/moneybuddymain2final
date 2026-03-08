import { supabase } from '../supabaseClient';

// Rate limiting interface
interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
  keyGenerator?: (req: Request) => string; // Custom key generator
}

// In-memory rate limit store (for production, use Redis)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

// Rate limiting middleware
export async function rateLimit(config: RateLimitConfig, req: Request): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
  const key = config.keyGenerator ? config.keyGenerator(req) : getClientIdentifier(req);
  const now = Date.now();
  
  let record = rateLimitStore.get(key);
  
  if (!record || now > record.resetTime) {
    // New window or expired window
    record = { count: 1, resetTime: now + config.windowMs };
    rateLimitStore.set(key, record);
    return { allowed: true, remaining: config.maxRequests - 1, resetTime: record.resetTime };
  }
  
  if (record.count >= config.maxRequests) {
    return { allowed: false, remaining: 0, resetTime: record.resetTime };
  }
  
  record.count++;
  return { allowed: true, remaining: config.maxRequests - record.count, resetTime: record.resetTime };
}

// Get client identifier for rate limiting
function getClientIdentifier(req: Request): string {
  // Try to get user ID from auth context first
  const forwardedFor = req.headers.get('x-forwarded-for');
  const ip = forwardedFor ? forwardedFor.split(',')[0] : req.headers.get('x-real-ip') || 'unknown';
  return ip;
}

// Input validation and sanitization
export function validateInput(data: any, rules: ValidationRules): ValidationResult {
  const errors: string[] = [];
  
  for (const [field, rule] of Object.entries(rules)) {
    const value = data[field];
    
    // Required validation
    if (rule.required && (value === undefined || value === null || value === '')) {
      errors.push(`${field} is required`);
      continue;
    }
    
    // Skip further validation if field is not provided and not required
    if (value === undefined || value === null) continue;
    
    // Type validation
    if (rule.type && typeof value !== rule.type) {
      errors.push(`${field} must be of type ${rule.type}`);
      continue;
    }
    
    // String validations
    if (typeof value === 'string') {
      if (rule.minLength && value.length < rule.minLength) {
        errors.push(`${field} must be at least ${rule.minLength} characters`);
      }
      
      if (rule.maxLength && value.length > rule.maxLength) {
        errors.push(`${field} must not exceed ${rule.maxLength} characters`);
      }
      
      if (rule.pattern && !rule.pattern.test(value)) {
        errors.push(`${field} format is invalid`);
      }
      
      // Sanitize string inputs
      if (rule.sanitize) {
        data[field] = sanitizeString(value);
      }
    }
    
    // Number validations
    if (typeof value === 'number') {
      if (rule.min !== undefined && value < rule.min) {
        errors.push(`${field} must be at least ${rule.min}`);
      }
      
      if (rule.max !== undefined && value > rule.max) {
        errors.push(`${field} must not exceed ${rule.max}`);
      }
    }
    
    // Email validation
    if (rule.email && !isValidEmail(value)) {
      errors.push(`${field} must be a valid email address`);
    }
  }
  
  return { isValid: errors.length === 0, errors, sanitizedData: data };
}

// Validation rules interface
interface ValidationRule {
  required?: boolean;
  type?: 'string' | 'number' | 'boolean' | 'object';
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
  email?: boolean;
  sanitize?: boolean;
}

interface ValidationRules {
  [field: string]: ValidationRule;
}

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  sanitizedData: any;
}

// String sanitization
function sanitizeString(str: string): string {
  return str
    .trim()
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, ''); // Remove event handlers
}

// Email validation
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Security headers
export const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://api.stripe.com https://sandbox.plaid.com https://production.plaid.com",
};

// IP whitelist for sensitive operations
export function isIPAllowed(ip: string, allowedIPs: string[]): boolean {
  return allowedIPs.includes(ip) || allowedIPs.includes('*');
}

// Audit logging
export async function logSecurityEvent(event: SecurityEvent): Promise<void> {
  try {
    // Check if session is valid, refresh if expired
    let { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session || new Date(session.expires_at * 1000) < new Date()) {
      // Attempt to refresh the session
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !refreshData.session) {
        console.log('Session refresh failed, skipping security event logging');
        return;
      }
      session = refreshData.session;
    }

    await supabase.functions.invoke('log-security-event', {
      body: {
        event_type: event.type,
        user_id: event.userId,
        ip_address: event.ip,
        user_agent: event.userAgent,
        metadata: event.metadata,
        severity: event.severity,
      },
    });
  } catch (error) {
    console.error('Failed to log security event:', error);
  }
}

interface SecurityEvent {
  type: string;
  userId?: string;
  ip: string;
  userAgent?: string;
  metadata?: any;
  severity?: 'low' | 'medium' | 'high' | 'critical';
}

// Common rate limit configurations
export const RATE_LIMITS = {
  // General API calls
  API: { windowMs: 15 * 60 * 1000, maxRequests: 100 }, // 100 requests per 15 minutes
  
  // Sensitive operations
  PAYMENT: { windowMs: 60 * 1000, maxRequests: 5 }, // 5 payments per minute
  AUTH: { windowMs: 15 * 60 * 1000, maxRequests: 10 }, // 10 auth attempts per 15 minutes
  
  // Webhook endpoints
  WEBHOOK: { windowMs: 60 * 1000, maxRequests: 100 }, // 100 webhooks per minute
};

// Common validation rules
export const VALIDATION_RULES = {
  EMAIL: {
    required: true,
    type: 'string' as const,
    email: true,
    maxLength: 255,
    sanitize: true,
  },
  
  PAYMENT_AMOUNT: {
    required: true,
    type: 'number' as const,
    min: 0.50,
    max: 10000,
  },
  
  DESCRIPTION: {
    required: false,
    type: 'string' as const,
    maxLength: 500,
    sanitize: true,
  },
  
  ACCOUNT_ID: {
    required: true,
    type: 'string' as const,
    minLength: 1,
    maxLength: 100,
    pattern: /^[a-zA-Z0-9_-]+$/,
  },
};
