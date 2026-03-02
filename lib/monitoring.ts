import { supabase } from '../supabaseClient';
import { logSecurityEvent } from './security';

// Alert severity levels
export enum AlertSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

// Alert types
export enum AlertType {
  SUSPICIOUS_LOGIN = 'SUSPICIOUS_LOGIN',
  HIGH_TRANSACTION_VOLUME = 'HIGH_TRANSACTION_VOLUME',
  MULTIPLE_FAILED_LOGINS = 'MULTIPLE_FAILED_LOGINS',
  UNUSUAL_IP_ADDRESS = 'UNUSUAL_IP_ADDRESS',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  WEBHOOK_SIGNATURE_FAILURE = 'WEBHOOK_SIGNATURE_FAILURE',
  DATABASE_ANOMALY = 'DATABASE_ANOMALY',
  SESSION_ANOMALY = 'SESSION_ANOMALY'
}

// Alert interface
interface SecurityAlert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  userId?: string;
  ipAddress: string;
  userAgent?: string;
  metadata: any;
  timestamp: string;
  resolved: boolean;
  resolvedAt?: string;
  resolvedBy?: string;
}

// Monitoring configuration
const MONITORING_CONFIG = {
  // Thresholds for alerting
  failedLoginThreshold: 5, // 5 failed logins in 15 minutes
  transactionVolumeThreshold: 10, // 10 transactions in 1 hour
  concurrentSessionThreshold: 3, // More than 3 concurrent sessions
  unusualLocationThreshold: 1000, // km distance from usual location
  
  // Time windows for analysis
  shortWindow: 15 * 60 * 1000, // 15 minutes
  mediumWindow: 60 * 60 * 1000, // 1 hour
  longWindow: 24 * 60 * 60 * 1000, // 24 hours
  
  // Alert cooldowns (prevent alert spam)
  alertCooldowns: {
    [AlertType.MULTIPLE_FAILED_LOGINS]: 30 * 60 * 1000, // 30 minutes
    [AlertType.HIGH_TRANSACTION_VOLUME]: 60 * 60 * 1000, // 1 hour
    [AlertType.SUSPICIOUS_LOGIN]: 15 * 60 * 1000, // 15 minutes
  }
};

// Security monitoring system
export class SecurityMonitor {
  private static instance: SecurityMonitor;
  private alertCooldowns = new Map<string, number>();

  static getInstance(): SecurityMonitor {
    if (!SecurityMonitor.instance) {
      SecurityMonitor.instance = new SecurityMonitor();
    }
    return SecurityMonitor.instance;
  }

  // Check for multiple failed login attempts
  async checkFailedLogins(email: string, ipAddress: string): Promise<void> {
    try {
      const { count, error } = await supabase
        .from('failed_login_attempts')
        .select('*', { count: 'exact', head: true })
        .eq('email', email)
        .gte('attempted_at', new Date(Date.now() - MONITORING_CONFIG.shortWindow).toISOString());

      if (error) {
        console.error('Error checking failed logins:', error);
        return;
      }

      const threshold = MONITORING_CONFIG.failedLoginThreshold;
      if (count && count >= threshold) {
        await this.createAlert({
          type: AlertType.MULTIPLE_FAILED_LOGINS,
          severity: AlertSeverity.HIGH,
          ipAddress,
          metadata: {
            email,
            failedAttempts: count,
            threshold,
            timeWindow: '15 minutes'
          }
        });
      }
    } catch (error) {
      console.error('Failed login check error:', error);
    }
  }

  // Check for high transaction volume
  async checkTransactionVolume(userId: string): Promise<void> {
    try {
      const { count, error } = await supabase
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .eq('sender_id', userId)
        .gte('created_at', new Date(Date.now() - MONITORING_CONFIG.mediumWindow).toISOString());

      if (error) {
        console.error('Error checking transaction volume:', error);
        return;
      }

      const threshold = MONITORING_CONFIG.transactionVolumeThreshold;
      if (count && count >= threshold) {
        const { data: userData } = await supabase
          .from('profiles')
          .select('email')
          .eq('id', userId)
          .maybeSingle(); // Use maybeSingle() to handle no profile case

        await this.createAlert({
          type: AlertType.HIGH_TRANSACTION_VOLUME,
          severity: AlertSeverity.MEDIUM,
          userId,
          ipAddress: 'unknown',
          metadata: {
            transactionCount: count,
            threshold,
            timeWindow: '1 hour',
            userEmail: userData?.email
          }
        });
      }
    } catch (error) {
      console.error('Transaction volume check error:', error);
    }
  }

  // Check for unusual IP addresses
  async checkUnusualIPAddress(userId: string, currentIP: string): Promise<void> {
    try {
      // Get user's recent IP addresses
      const { data: recentSessions, error } = await supabase
        .from('user_sessions')
        .select('ip_address, created_at')
        .eq('user_id', userId)
        .eq('is_active', true)
        .gte('created_at', new Date(Date.now() - MONITORING_CONFIG.longWindow).toISOString())
        .order('created_at', { ascending: false })
        .limit(10);

      if (error || !recentSessions || recentSessions.length === 0) {
        return; // No history to compare against
      }

      // Check if current IP is new
      const knownIPs = new Set(recentSessions.map(s => s.ip_address));
      if (knownIPs.has(currentIP)) {
        return; // IP is known, no alert
      }

      // This is a new IP - create alert
      await this.createAlert({
        type: AlertType.UNUSUAL_IP_ADDRESS,
        severity: AlertSeverity.MEDIUM,
        userId,
        ipAddress: currentIP,
        metadata: {
          newIP: currentIP,
          knownIPs: Array.from(knownIPs),
          sessionCount: recentSessions.length
        }
      });
    } catch (error) {
      console.error('Unusual IP check error:', error);
    }
  }

  // Check for session anomalies
  async checkSessionAnomalies(userId: string): Promise<void> {
    try {
      const { data: sessions, error } = await supabase
        .from('user_sessions')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true)
        .gt('expires_at', new Date().toISOString());

      if (error || !sessions) {
        return;
      }

      const threshold = MONITORING_CONFIG.concurrentSessionThreshold;
      if (sessions.length > threshold) {
        await this.createAlert({
          type: AlertType.SESSION_ANOMALY,
          severity: AlertSeverity.MEDIUM,
          userId,
          ipAddress: sessions[0]?.ip_address || 'unknown',
          metadata: {
            activeSessions: sessions.length,
            threshold,
            sessionDetails: sessions.map(s => ({
              ip: s.ip_address,
              created: s.created_at,
              userAgent: s.user_agent
            }))
          }
        });
      }
    } catch (error) {
      console.error('Session anomaly check error:', error);
    }
  }

  // Create security alert
  async createAlert(alertData: {
    type: AlertType;
    severity: AlertSeverity;
    userId?: string;
    ipAddress: string;
    userAgent?: string;
    metadata: any;
  }): Promise<void> {
    try {
      // Check cooldown to prevent alert spam
      const cooldownKey = `${alertData.type}_${alertData.userId || 'anonymous'}_${alertData.ipAddress}`;
      const lastAlert = this.alertCooldowns.get(cooldownKey);
      const cooldownPeriod = MONITORING_CONFIG.alertCooldowns[alertData.type] || MONITORING_CONFIG.shortWindow;

      if (lastAlert && (Date.now() - lastAlert) < cooldownPeriod) {
        return; // Still in cooldown period
      }

      // Create alert in database
      const { error } = await supabase
        .from('security_alerts')
        .insert({
          alert_type: alertData.type,
          severity: alertData.severity,
          user_id: alertData.userId,
          ip_address: alertData.ipAddress,
          user_agent: alertData.userAgent,
          metadata: alertData.metadata,
          created_at: new Date().toISOString(),
        });

      if (error) {
        console.error('Failed to create alert:', error);
        return;
      }

      // Update cooldown
      this.alertCooldowns.set(cooldownKey, Date.now());

      // Log the alert
      await logSecurityEvent({
        type: `ALERT_${alertData.type}`,
        userId: alertData.userId,
        ip: alertData.ipAddress,
        userAgent: alertData.userAgent,
        metadata: alertData.metadata,
        severity: alertData.severity,
      });

      // Send notification for high/critical alerts
      if (alertData.severity === AlertSeverity.HIGH || alertData.severity === AlertSeverity.CRITICAL) {
        await this.sendSecurityNotification(alertData);
      }

    } catch (error) {
      console.error('Alert creation error:', error);
    }
  }

  // Send security notification
  private async sendSecurityNotification(alertData: {
    type: AlertType;
    severity: AlertSeverity;
    userId?: string;
    metadata: any;
  }): Promise<void> {
    try {
      // In a real implementation, this would send emails, SMS, Slack messages, etc.
      console.log('🚨 SECURITY ALERT:', {
        type: alertData.type,
        severity: alertData.severity,
        userId: alertData.userId,
        metadata: alertData.metadata,
        timestamp: new Date().toISOString()
      });

      // For critical alerts, you might want to:
      // - Send SMS to security team
      // - Create incident in incident management system
      // - Temporarily lock user account
      // - Require additional authentication

      if (alertData.severity === AlertSeverity.CRITICAL) {
        // Implement immediate response actions
        await this.handleCriticalAlert(alertData);
      }
    } catch (error) {
      console.error('Notification sending error:', error);
    }
  }

  // Handle critical security alerts
  private async handleCriticalAlert(alertData: {
    type: AlertType;
    userId?: string;
    metadata: any;
  }): Promise<void> {
    try {
      if (alertData.userId) {
        // Invalidate all user sessions for critical alerts
        const { error } = await supabase
          .from('user_sessions')
          .update({ is_active: false })
          .eq('user_id', alertData.userId);

        if (!error) {
          console.log(`All sessions invalidated for user ${alertData.userId} due to critical alert`);
        }
      }

      // Additional critical response actions could include:
      // - Temporarily suspending the account
      // - Requiring password reset
      // - Notifying compliance team
      // - Creating fraud investigation ticket
    } catch (error) {
      console.error('Critical alert handling error:', error);
    }
  }

  // Get active alerts
  async getActiveAlerts(severity?: AlertSeverity): Promise<SecurityAlert[]> {
    try {
      let query = supabase
        .from('security_alerts')
        .select('*')
        .eq('resolved', false)
        .order('created_at', { ascending: false });

      if (severity) {
        query = query.eq('severity', severity);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error getting active alerts:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Active alerts error:', error);
      return [];
    }
  }

  // Resolve alert
  async resolveAlert(alertId: string, resolvedBy: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('security_alerts')
        .update({
          resolved: true,
          resolved_at: new Date().toISOString(),
          resolved_by: resolvedBy
        })
        .eq('id', alertId);

      if (error) {
        console.error('Error resolving alert:', error);
        throw error;
      }

      await logSecurityEvent({
        type: 'ALERT_RESOLVED',
        ip: 'system',
        metadata: { alertId, resolvedBy },
        severity: 'low',
      });
    } catch (error) {
      console.error('Alert resolution error:', error);
      throw error;
    }
  }

  // Get security dashboard data
  async getSecurityDashboard(): Promise<any> {
    try {
      const [
        activeAlerts,
        recentEvents,
        failedLogins,
        transactionVolume
      ] = await Promise.all([
        this.getActiveAlerts(),
        supabase
          .from('security_audit_log')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('failed_login_attempts')
          .select('*')
          .gte('attempted_at', new Date(Date.now() - MONITORING_CONFIG.longWindow).toISOString()),
        supabase
          .from('transactions')
          .select('sender_id, amount, created_at')
          .gte('created_at', new Date(Date.now() - MONITORING_CONFIG.mediumWindow).toISOString())
      ]);

      return {
        activeAlerts: activeAlerts.length,
        criticalAlerts: activeAlerts.filter(a => a.severity === AlertSeverity.CRITICAL).length,
        highAlerts: activeAlerts.filter(a => a.severity === AlertSeverity.HIGH).length,
        recentEvents: recentEvents.data?.slice(0, 10) || [],
        failedLogins: failedLogins.data?.length || 0,
        transactionVolume: transactionVolume.data?.length || 0,
        lastUpdated: new Date().toISOString()
      };
    } catch (error) {
      console.error('Security dashboard error:', error);
      return {
        activeAlerts: 0,
        criticalAlerts: 0,
        highAlerts: 0,
        recentEvents: [],
        failedLogins: 0,
        transactionVolume: 0,
        lastUpdated: new Date().toISOString(),
        error: 'Failed to load dashboard data'
      };
    }
  }
}

// Export singleton instance
export const securityMonitor = SecurityMonitor.getInstance();

// Real-time monitoring hooks
export function setupSecurityMonitoring(): void {
  // Set up periodic checks
  setInterval(async () => {
    try {
      // Clean up old cooldowns
      const now = Date.now();
      for (const [key, timestamp] of securityMonitor['alertCooldowns'].entries()) {
        if (now - timestamp > MONITORING_CONFIG.longWindow) {
          securityMonitor['alertCooldowns'].delete(key);
        }
      }
    } catch (error) {
      console.error('Monitoring cleanup error:', error);
    }
  }, 5 * 60 * 1000); // Every 5 minutes

  console.log('🔒 Security monitoring initialized');
}
