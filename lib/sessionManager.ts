import { supabase } from '../supabaseClient';
import { logSecurityEvent } from './security';

// Session configuration
const SESSION_CONFIG = {
  accessTokenExpiry: 15 * 60, // 15 minutes
  refreshTokenExpiry: 30 * 24 * 60 * 60, // 30 days
  maxConcurrentSessions: 3,
  sessionTimeout: 30 * 60, // 30 minutes of inactivity
  suspiciousActivityThreshold: 5,
};

// Session interface
interface UserSession {
  id: string;
  user_id: string;
  session_token: string;
  ip_address: string;
  user_agent: string;
  created_at: string;
  expires_at: string;
  last_activity: string;
  is_active: boolean;
}

// Enhanced session manager
export class SessionManager {
  private static instance: SessionManager;

  static getInstance(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager();
    }
    return SessionManager.instance;
  }

  // Create new session with security tracking
  async createSession(userId: string, ipAddress: string, userAgent: string): Promise<void> {
    try {
      // Check for suspicious activity first
      const suspiciousActivity = await this.checkSuspiciousActivity(userId, ipAddress);
      
      if (suspiciousActivity.risk_score > 50) {
        await logSecurityEvent({
          type: 'SUSPICIOUS_LOGIN_ATTEMPT',
          userId,
          ip: ipAddress,
          userAgent,
          metadata: { riskScore: suspiciousActivity.risk_score, flags: suspiciousActivity.flags },
          severity: 'high',
        });
        
        // Could implement additional verification here (MFA, email confirmation, etc.)
      }

      // Check concurrent sessions
      const activeSessions = await this.getActiveSessionCount(userId);
      
      if (activeSessions >= SESSION_CONFIG.maxConcurrentSessions) {
        // Remove oldest session
        await this.removeOldestSession(userId);
        
        await logSecurityEvent({
          type: 'SESSION_LIMIT_EXCEEDED',
          userId,
          ip: ipAddress,
          userAgent,
          metadata: { activeSessions, maxAllowed: SESSION_CONFIG.maxConcurrentSessions },
          severity: 'medium',
        });
      }

      // Create session record
      const sessionToken = this.generateSecureToken();
      const expiresAt = new Date(Date.now() + SESSION_CONFIG.accessTokenExpiry * 1000).toISOString();

      const { error } = await supabase
        .from('user_sessions')
        .insert({
          user_id: userId,
          session_token: sessionToken,
          ip_address: ipAddress,
          user_agent: userAgent,
          expires_at: expiresAt,
        });

      if (error) {
        console.error('Failed to create session:', error);
        throw error;
      }

      await logSecurityEvent({
        type: 'SESSION_CREATED',
        userId,
        ip: ipAddress,
        userAgent,
        metadata: { sessionId: sessionToken },
        severity: 'low',
      });

    } catch (error) {
      console.error('Session creation error:', error);
      throw error;
    }
  }

  // Validate and refresh session
  async validateSession(sessionToken: string, ipAddress: string, userAgent: string): Promise<boolean> {
    try {
      const { data: session, error } = await supabase
        .from('user_sessions')
        .select('*')
        .eq('session_token', sessionToken)
        .eq('is_active', true)
        .maybeSingle(); // Use maybeSingle() to handle no session case

      if (error || !session) {
        await logSecurityEvent({
          type: 'INVALID_SESSION_TOKEN',
          ip: ipAddress,
          userAgent,
          metadata: { token: sessionToken.substring(0, 10) + '...' },
          severity: 'medium',
        });
        return false;
      }

      // Check if session is expired
      if (new Date(session.expires_at) < new Date()) {
        await this.invalidateSession(sessionToken);
        return false;
      }

      // Check for IP address change (potential session hijacking)
      if (session.ip_address !== ipAddress) {
        await logSecurityEvent({
          type: 'SESSION_IP_MISMATCH',
          userId: session.user_id,
          ip: ipAddress,
          userAgent,
          metadata: { 
            originalIp: session.ip_address,
            sessionId: session.id 
          },
          severity: 'high',
        });
        
        // Could require re-authentication here
        return false;
      }

      // Update last activity
      await this.updateSessionActivity(sessionToken);
      
      return true;
    } catch (error) {
      console.error('Session validation error:', error);
      return false;
    }
  }

  // Invalidate session
  async invalidateSession(sessionToken: string): Promise<void> {
    try {
      const { data: session } = await supabase
        .from('user_sessions')
        .select('user_id, ip_address')
        .eq('session_token', sessionToken)
        .maybeSingle(); // Use maybeSingle() to handle no session case

      await supabase
        .from('user_sessions')
        .update({ is_active: false })
        .eq('session_token', sessionToken);

      if (session) {
        await logSecurityEvent({
          type: 'SESSION_INVALIDATED',
          userId: session.user_id,
          ip: session.ip_address,
          metadata: { sessionId: sessionToken },
          severity: 'low',
        });
      }
    } catch (error) {
      console.error('Session invalidation error:', error);
    }
  }

  // Invalidate all user sessions
  async invalidateAllUserSessions(userId: string): Promise<void> {
    try {
      const { data: sessions } = await supabase
        .from('user_sessions')
        .select('session_token, ip_address')
        .eq('user_id', userId)
        .eq('is_active', true);

      await supabase
        .from('user_sessions')
        .update({ is_active: false })
        .eq('user_id', userId);

      if (sessions && sessions.length > 0) {
        await logSecurityEvent({
          type: 'ALL_SESSIONS_INVALIDATED',
          userId,
          ip: sessions[0].ip_address,
          metadata: { sessionCount: sessions.length },
          severity: 'medium',
        });
      }
    } catch (error) {
      console.error('All sessions invalidation error:', error);
    }
  }

  // Get active session count for user
  private async getActiveSessionCount(userId: string): Promise<number> {
    try {
      const { count } = await supabase
        .from('user_sessions')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('is_active', true)
        .gt('expires_at', new Date().toISOString());

      return count || 0;
    } catch (error) {
      console.error('Error getting session count:', error);
      return 0;
    }
  }

  // Remove oldest session for user
  private async removeOldestSession(userId: string): Promise<void> {
    try {
      const { data: oldestSession } = await supabase
        .from('user_sessions')
        .select('session_token')
        .eq('user_id', userId)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle(); // Use maybeSingle() to handle no session case

      if (oldestSession) {
        await this.invalidateSession(oldestSession.session_token);
      }
    } catch (error) {
      console.error('Error removing oldest session:', error);
    }
  }

  // Update session activity timestamp
  private async updateSessionActivity(sessionToken: string): Promise<void> {
    try {
      await supabase
        .from('user_sessions')
        .update({ 
          last_activity: new Date().toISOString(),
          expires_at: new Date(Date.now() + SESSION_CONFIG.accessTokenExpiry * 1000).toISOString()
        })
        .eq('session_token', sessionToken);
    } catch (error) {
      console.error('Error updating session activity:', error);
    }
  }

  // Check for suspicious activity
  private async checkSuspiciousActivity(userId: string, ipAddress: string): Promise<any> {
    try {
      // This would call the database function we created
      const { data, error } = await supabase
        .rpc('check_suspicious_activity', { 
          user_id_param: userId, 
          ip_address_param: ipAddress 
        });

      if (error) {
        console.error('Error checking suspicious activity:', error);
        return { risk_score: 0, flags: [] };
      }

      return data || { risk_score: 0, flags: [] };
    } catch (error) {
      console.error('Suspicious activity check error:', error);
      return { risk_score: 0, flags: [] };
    }
  }

  // Generate secure session token
  private generateSecureToken(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  // Clean up expired sessions
  async cleanupExpiredSessions(): Promise<number> {
    try {
      const { data, error } = await supabase.rpc('cleanup_expired_sessions');
      
      if (error) {
        console.error('Session cleanup error:', error);
        return 0;
      }

      return data || 0;
    } catch (error) {
      console.error('Session cleanup error:', error);
      return 0;
    }
  }

  // Get all active sessions for user
  async getUserSessions(userId: string): Promise<UserSession[]> {
    try {
      const { data, error } = await supabase
        .from('user_sessions')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error getting user sessions:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error getting user sessions:', error);
      return [];
    }
  }
}

// Export singleton instance
export const sessionManager = SessionManager.getInstance();

// Enhanced authentication wrapper
export async function secureAuth(email: string, password: string, ipAddress: string, userAgent: string) {
  try {
    // Log login attempt
    await logSecurityEvent({
      type: 'LOGIN_ATTEMPT',
      ip: ipAddress,
      userAgent,
      metadata: { email },
      severity: 'low',
    });

    // Attempt authentication
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      // Log failed login
      await supabase
        .from('failed_login_attempts')
        .insert({
          email,
          ip_address: ipAddress,
          user_agent: userAgent,
        });

      await logSecurityEvent({
        type: 'LOGIN_FAILED',
        ip: ipAddress,
        userAgent,
        metadata: { email, error: error.message },
        severity: 'medium',
      });

      throw error;
    }

    // Create secure session
    if (data.user) {
      await sessionManager.createSession(data.user.id, ipAddress, userAgent);
    }

    await logSecurityEvent({
      type: 'LOGIN_SUCCESS',
      userId: data.user?.id,
      ip: ipAddress,
      userAgent,
      metadata: { email },
      severity: 'low',
    });

    return data;
  } catch (error) {
    console.error('Secure auth error:', error);
    throw error;
  }
}
