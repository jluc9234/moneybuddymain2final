-- MoneyBuddy Database Security Implementation (Fixed Version)
-- Run these SQL commands in Supabase SQL Editor

-- 1. Drop existing triggers if they exist
DROP TRIGGER IF EXISTS on_tx_insert ON transactions;
DROP TRIGGER IF EXISTS transaction_security_trigger ON transactions;
DROP TRIGGER IF EXISTS alert_creation_trigger ON security_alerts;

-- 2. Drop existing functions if they exist
DROP FUNCTION IF EXISTS log_transaction_security_event();
DROP FUNCTION IF EXISTS log_security_event(TEXT);
DROP FUNCTION IF EXISTS cleanup_expired_sessions();
DROP FUNCTION IF EXISTS check_suspicious_activity(UUID, INET);

-- 3. Enable Row Level Security on all sensitive tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;

-- 4. Create security audit log table
CREATE TABLE IF NOT EXISTS security_audit_log (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  ip_address INET,
  user_agent TEXT,
  metadata JSONB,
  severity TEXT CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 5. Create failed login attempts table
CREATE TABLE IF NOT EXISTS failed_login_attempts (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  ip_address INET,
  attempted_at TIMESTAMP DEFAULT NOW(),
  user_agent TEXT
);

-- 6. Create session tracking table
CREATE TABLE IF NOT EXISTS user_sessions (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  session_token TEXT NOT NULL,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  last_activity TIMESTAMP DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE
);

-- 7. Profiles Table Security Policies
DROP POLICY IF EXISTS "Users can view their own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON profiles;

CREATE POLICY "Users can view their own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- 8. Transactions Table Security Policies
DROP POLICY IF EXISTS "Users can view their own transactions" ON transactions;
DROP POLICY IF EXISTS "Users can create transactions as sender" ON transactions;
DROP POLICY IF EXISTS "Users can update their own transactions" ON transactions;

CREATE POLICY "Users can view their own transactions" ON transactions
  FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

CREATE POLICY "Users can create transactions as sender" ON transactions
  FOR INSERT WITH CHECK (auth.uid() = sender_id);

CREATE POLICY "Users can update their own transactions" ON transactions
  FOR UPDATE USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

-- 9. Bank Accounts Table Security Policies
DROP POLICY IF EXISTS "Users can view their own bank accounts" ON bank_accounts;
DROP POLICY IF EXISTS "Users can insert their own bank accounts" ON bank_accounts;
DROP POLICY IF EXISTS "Users can update their own bank accounts" ON bank_accounts;
DROP POLICY IF EXISTS "Users can delete their own bank accounts" ON bank_accounts;

CREATE POLICY "Users can view their own bank accounts" ON bank_accounts
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own bank accounts" ON bank_accounts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own bank accounts" ON bank_accounts
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own bank accounts" ON bank_accounts
  FOR DELETE USING (auth.uid() = user_id);

-- 10. Security Audit Log Policies (service role only)
DROP POLICY IF EXISTS "Service role can manage audit logs" ON security_audit_log;
CREATE POLICY "Service role can manage audit logs" ON security_audit_log
  FOR ALL USING (auth.role() = 'service_role');

-- 11. Failed Login Attempts Policies (service role only)
DROP POLICY IF EXISTS "Service role can manage failed login attempts" ON failed_login_attempts;
CREATE POLICY "Service role can manage failed login attempts" ON failed_login_attempts
  FOR ALL USING (auth.role() = 'service_role');

-- 12. User Sessions Policies
DROP POLICY IF EXISTS "Users can view their own sessions" ON user_sessions;
DROP POLICY IF EXISTS "Users can manage their own sessions" ON user_sessions;
DROP POLICY IF EXISTS "Service role can manage all sessions" ON user_sessions;

CREATE POLICY "Users can view their own sessions" ON user_sessions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own sessions" ON user_sessions
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage all sessions" ON user_sessions
  FOR ALL USING (auth.role() = 'service_role');

-- 13. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_security_audit_log_user_id ON security_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_security_audit_log_created_at ON security_audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_security_audit_log_severity ON security_audit_log(severity);
CREATE INDEX IF NOT EXISTS idx_failed_login_attempts_email ON failed_login_attempts(email);
CREATE INDEX IF NOT EXISTS idx_failed_login_attempts_ip ON failed_login_attempts(ip_address);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_transactions_sender_id ON transactions(sender_id);
CREATE INDEX IF NOT EXISTS idx_transactions_recipient_id ON transactions(recipient_id);

-- 14. Create function to log security events
CREATE OR REPLACE FUNCTION log_security_event(
  event_type_param TEXT,
  user_id_param UUID DEFAULT NULL,
  ip_address_param INET DEFAULT NULL,
  user_agent_param TEXT DEFAULT NULL,
  metadata_param JSONB DEFAULT NULL,
  severity_param TEXT DEFAULT 'medium'
)
RETURNS VOID
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
    severity
  ) VALUES (
    event_type_param,
    user_id_param,
    ip_address_param,
    user_agent_param,
    metadata_param,
    severity_param
  );
END;
$$;

-- 15. Create function to clean up expired sessions
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM user_sessions 
  WHERE expires_at < NOW() OR last_activity < NOW() - INTERVAL '30 days';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  -- Log the cleanup
  PERFORM log_security_event(
    'SESSION_CLEANUP',
    NULL,
    NULL,
    NULL,
    JSON_BUILD_OBJECT('deleted_sessions', deleted_count),
    'low'
  );
  
  RETURN deleted_count;
END;
$$;

-- 16. Create trigger for transaction security logging
CREATE OR REPLACE FUNCTION log_transaction_security_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Log transaction creation
  IF TG_OP = 'INSERT' THEN
    PERFORM log_security_event(
      'TRANSACTION_CREATED',
      NEW.sender_id,
      NULL,
      NULL,
      JSON_BUILD_OBJECT(
        'transaction_id', NEW.id,
        'amount', NEW.amount,
        'recipient_id', NEW.recipient_id,
        'status', NEW.status
      ),
      'medium'
    );
    RETURN NEW;
  END IF;
  
  -- Log transaction status changes
  IF TG_OP = 'UPDATE' AND OLD.status != NEW.status THEN
    PERFORM log_security_event(
      'TRANSACTION_STATUS_CHANGED',
      NEW.sender_id,
      NULL,
      NULL,
      JSON_BUILD_OBJECT(
        'transaction_id', NEW.id,
        'old_status', OLD.status,
        'new_status', NEW.status,
        'amount', NEW.amount
      ),
      CASE 
        WHEN NEW.status IN ('failed', 'disputed') THEN 'high'
        WHEN NEW.status = 'completed' THEN 'medium'
        ELSE 'low'
      END
    );
    RETURN NEW;
  END IF;
  
  RETURN NEW;
END;
$$;

-- 17. Create trigger (using new name to avoid conflicts)
CREATE TRIGGER transaction_security_trigger_v2
  AFTER INSERT OR UPDATE ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION log_transaction_security_event();

-- 18. Create function to check for suspicious activity
CREATE OR REPLACE FUNCTION check_suspicious_activity(
  user_id_param UUID,
  ip_address_param INET DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
  failed_attempts INTEGER;
  recent_transactions INTEGER;
  concurrent_sessions INTEGER;
BEGIN
  -- Check failed login attempts in last hour
  SELECT COUNT(*) INTO failed_attempts
  FROM failed_login_attempts
  WHERE email = (SELECT email FROM auth.users WHERE id = user_id_param)
    AND attempted_at > NOW() - INTERVAL '1 hour';
  
  -- Check recent transaction volume
  SELECT COUNT(*) INTO recent_transactions
  FROM transactions
  WHERE sender_id = user_id_param
    AND created_at > NOW() - INTERVAL '1 hour';
  
  -- Check concurrent sessions
  SELECT COUNT(*) INTO concurrent_sessions
  FROM user_sessions
  WHERE user_id = user_id_param
    AND is_active = TRUE
    AND expires_at > NOW();
  
  -- Build result
  result := JSON_BUILD_OBJECT(
    'failed_login_attempts', failed_attempts,
    'recent_transactions', recent_transactions,
    'concurrent_sessions', concurrent_sessions,
    'risk_score', LEAST(100, (failed_attempts * 20) + (recent_transactions * 10) + GREATEST(0, concurrent_sessions - 3) * 15),
    'flags', CASE
      WHEN failed_attempts > 5 THEN JSON_BUILD_ARRAY('excessive_failed_logins')
      WHEN recent_transactions > 10 THEN JSON_BUILD_ARRAY('high_transaction_volume')
      WHEN concurrent_sessions > 5 THEN JSON_BUILD_ARRAY('excessive_sessions')
      ELSE JSON_BUILD_ARRAY()
    END
  );
  
  RETURN result;
END;
$$;

-- 19. Grant necessary permissions
GRANT USAGE ON SCHEMA public TO authenticated, anon;
GRANT ALL ON security_audit_log TO service_role;
GRANT ALL ON failed_login_attempts TO service_role;
GRANT ALL ON user_sessions TO authenticated, service_role;

-- 20. Final verification
SELECT 'Database security setup completed successfully' as status;
