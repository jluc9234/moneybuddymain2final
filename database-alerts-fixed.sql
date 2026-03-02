-- Security Alerts Table for Monitoring System (Fixed Version)
-- Run this in Supabase SQL Editor after the main security setup

-- 1. Drop existing policies if they exist
DROP POLICY IF EXISTS "Service role can manage all alerts" ON security_alerts;
DROP POLICY IF EXISTS "Users can view their own alerts" ON security_alerts;

-- 2. Drop existing functions if they exist
DROP FUNCTION IF EXISTS get_security_stats();
DROP FUNCTION IF EXISTS auto_resolve_old_alerts();
DROP FUNCTION IF EXISTS log_alert_creation();

-- 3. Drop existing triggers if they exist
DROP TRIGGER IF EXISTS alert_creation_trigger ON security_alerts;

-- 4. Create security alerts table
CREATE TABLE IF NOT EXISTS security_alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  user_id UUID REFERENCES auth.users(id),
  ip_address INET,
  user_agent TEXT,
  metadata JSONB,
  resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMP,
  resolved_by TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 5. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_security_alerts_type ON security_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_security_alerts_severity ON security_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_security_alerts_user_id ON security_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_security_alerts_resolved ON security_alerts(resolved);
CREATE INDEX IF NOT EXISTS idx_security_alerts_created_at ON security_alerts(created_at);

-- 6. Enable Row Level Security
ALTER TABLE security_alerts ENABLE ROW LEVEL SECURITY;

-- 7. Create RLS policies
CREATE POLICY "Service role can manage all alerts" ON security_alerts
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Users can view their own alerts" ON security_alerts
  FOR SELECT USING (auth.uid() = user_id);

-- 8. Grant permissions
GRANT ALL ON security_alerts TO service_role;
GRANT SELECT ON security_alerts TO authenticated;

-- 9. Create function to get security statistics
CREATE OR REPLACE FUNCTION get_security_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT JSON_BUILD_OBJECT(
    'total_alerts', COUNT(*),
    'critical_alerts', COUNT(*) FILTER (WHERE severity = 'critical' AND NOT resolved),
    'high_alerts', COUNT(*) FILTER (WHERE severity = 'high' AND NOT resolved),
    'medium_alerts', COUNT(*) FILTER (WHERE severity = 'medium' AND NOT resolved),
    'low_alerts', COUNT(*) FILTER (WHERE severity = 'low' AND NOT resolved),
    'resolved_today', COUNT(*) FILTER (WHERE resolved = TRUE AND DATE(resolved_at) = CURRENT_DATE),
    'failed_logins_today', (SELECT COUNT(*) FROM failed_login_attempts WHERE DATE(attempted_at) = CURRENT_DATE),
    'active_sessions', (SELECT COUNT(*) FROM user_sessions WHERE is_active = TRUE AND expires_at > NOW()),
    'last_updated', NOW()
  ) INTO result
  FROM security_alerts
  WHERE created_at >= CURRENT_DATE;
  
  RETURN COALESCE(result, JSON_BUILD_OBJECT('error', 'No data available'));
END;
$$;

-- 10. Create function to auto-resolve old alerts
CREATE OR REPLACE FUNCTION auto_resolve_old_alerts()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  resolved_count INTEGER;
BEGIN
  UPDATE security_alerts 
  SET resolved = TRUE, 
      resolved_at = NOW(),
      resolved_by = 'auto-resolve'
  WHERE resolved = FALSE 
    AND created_at < NOW() - INTERVAL '7 days'
    AND severity IN ('low', 'medium');
  
  GET DIAGNOSTICS resolved_count = ROW_COUNT;
  
  -- Log the auto-resolution
  INSERT INTO security_audit_log (
    event_type,
    user_id,
    metadata,
    severity,
    created_at
  ) VALUES (
    'AUTO_RESOLVE_ALERTS',
    NULL,
    JSON_BUILD_OBJECT('resolved_count', resolved_count),
    'low',
    NOW()
  );
  
  RETURN resolved_count;
END;
$$;

-- 11. Create trigger for alert creation logging
CREATE OR REPLACE FUNCTION log_alert_creation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO security_audit_log (
    event_type,
    user_id,
    ip_address,
    user_agent,
    metadata,
    severity,
    created_at
  ) VALUES (
    'ALERT_CREATED',
    NEW.user_id,
    NEW.ip_address,
    NEW.user_agent,
    JSON_BUILD_OBJECT(
      'alert_id', NEW.id,
      'alert_type', NEW.alert_type,
      'severity', NEW.severity
    ),
    NEW.severity,
    NOW()
  );
  
  RETURN NEW;
END;
$$;

-- 12. Create trigger
CREATE TRIGGER alert_creation_trigger_v2
  AFTER INSERT ON security_alerts
  FOR EACH ROW
  EXECUTE FUNCTION log_alert_creation();

-- 13. Verification
SELECT 'Security alerts table setup completed successfully' as status;
