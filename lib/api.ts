import { supabase } from '../supabaseClient';
import { rateLimit, RATE_LIMITS, validateInput, VALIDATION_RULES, securityHeaders } from './security';
import { sessionManager } from './sessionManager';
import { securityMonitor, AlertSeverity } from './monitoring';

/**
 * Call a Supabase Edge Function with the current user's auth token.
 * Returns the parsed JSON response or throws on error.
 */
export async function callEdgeFunction<T = unknown>(
  functionName: string,
  body: Record<string, unknown>
): Promise<T> {
  // Retrieve the current session to get the JWT
  const { data: { session } } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error('No active session found. Please log in again.');
  }

  // Get client IP and user agent for security tracking
  const clientIP = getClientIP();
  const userAgent = navigator.userAgent;

  // Rate limiting check
  const rateLimitResult = await rateLimit(RATE_LIMITS.API, new Request('https://api.example.com'));
  if (!rateLimitResult.allowed) {
    await securityMonitor.createAlert({
      type: 'RATE_LIMIT_EXCEEDED' as any,
      severity: AlertSeverity.MEDIUM,
      userId: session.user?.id,
      ipAddress: clientIP,
      userAgent,
      metadata: { functionName, limit: rateLimitResult.resetTime }
    });
    throw new Error('Too many requests. Please try again later.');
  }

  // Validate session
  const bypassSessionValidation = functionName === 'create-link-token' || functionName === 'exchange-plaid-token';
  if (!bypassSessionValidation) {
    const isSessionValid = await sessionManager.validateSession(session.access_token, clientIP, userAgent);
    if (!isSessionValid) {
      throw new Error('Session expired or invalid. Please log in again.');
    }
  }

  // Input validation for sensitive functions
  let validatedBody = body;
  if (functionName === 'create-payment-intent') {
    const validation = validateInput(body, {
      amount: VALIDATION_RULES.PAYMENT_AMOUNT,
      recipient_email: VALIDATION_RULES.EMAIL,
      description: VALIDATION_RULES.DESCRIPTION,
    });
    
    if (!validation.isValid) {
      await securityMonitor.createAlert({
        type: 'DATABASE_ANOMALY' as any,
        severity: AlertSeverity.MEDIUM,
        userId: session.user?.id,
        ipAddress: clientIP,
        userAgent,
        metadata: { validationErrors: validation.errors, functionName }
      });
      throw new Error(`Validation error: ${validation.errors.join(', ')}`);
    }
    validatedBody = validation.sanitizedData;

    // Check for suspicious transaction patterns
    if (session.user?.id) {
      await securityMonitor.checkTransactionVolume(session.user.id);
    }
  }

  const { data, error } = await supabase.functions.invoke(functionName, {
    body: validatedBody,
    headers: {
      // Manually passing the Authorization header ensures the Edge Function 
      // can identify the user and create the Stripe Connect account.
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (error) {
    // Log API errors for monitoring
    await securityMonitor.createAlert({
      type: 'DATABASE_ANOMALY' as any,
      severity: AlertSeverity.MEDIUM,
      userId: session.user?.id,
      ipAddress: clientIP,
      userAgent,
      metadata: { 
        functionName, 
        error: error.message,
        errorCode: error.code 
      }
    });
    throw new Error(error.message || `Edge function "${functionName}" failed`);
  }

  return data as T;
}

// Helper function to get client IP
function getClientIP(): string {
  // In a real implementation, this would get the IP from the request
  // For now, return a placeholder
  return 'client-ip';
}
