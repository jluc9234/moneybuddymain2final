# MoneyBuddy Security Deployment Checklist

## 🚀 Pre-Deployment Security Setup

### 1. **Database Security Setup** ⚠️ REQUIRED

Run these SQL files in Supabase SQL Editor in order:

1. **`database-security.sql`** - Core security tables and RLS policies
2. **`database-alerts.sql`** - Security alerts and monitoring tables

```bash
# Verify setup
SELECT 'Database security setup completed' as status;
```

### 2. **Environment Variables** ⚠️ REQUIRED

Set these in your Supabase Edge Function settings:

```bash
# Core Configuration
PLAID_ENV=production
STRIPE_ENV=live
SUPABASE_URL=https://your-project.supabase.co

# API Keys (NEVER commit to git)
PLAID_CLIENT_ID=your_plaid_client_id
PLAID_SECRET=your_plaid_secret
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...  # CRITICAL - Get from Stripe dashboard
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Security Configuration
ALLOWED_ORIGINS=https://your-domain.com
ADMIN_IPS=192.168.1.100,10.0.0.50
```

### 3. **Stripe Webhook Setup** ⚠️ CRITICAL

1. Go to Stripe Dashboard → Webhooks
2. Add webhook endpoint: `https://your-project.supabase.co/functions/v1/stripe-webhook`
3. Select events:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `account.updated`
4. Copy the webhook secret to environment variables
5. Test webhook signature verification

## 🔒 Security Verification Checklist

### ✅ Webhook Security
- [ ] Stripe webhook signature verification implemented
- [ ] Webhook endpoint validates all incoming requests
- [ ] Invalid signatures are rejected with 401 status
- [ ] Webhook events are logged for audit trail

### ✅ API Security
- [ ] Rate limiting configured for all endpoints
- [ ] Input validation on all sensitive operations
- [ ] Session validation on every API call
- [ ] Security headers added to all responses

### ✅ Database Security
- [ ] Row Level Security (RLS) enabled on all tables
- [ ] Security policies restrict data access by user ID
- [ ] Service role has proper permissions
- [ ] Audit logging configured for sensitive operations

### ✅ Session Management
- [ ] Session tokens have short expiry (15 minutes)
- [ ] Session validation checks IP address changes
- [ ] Concurrent session limits enforced
- [ ] Session cleanup for expired tokens

### ✅ Monitoring & Alerting
- [ ] Security alerts table created
- [ ] Failed login attempt tracking
- [ ] Transaction volume monitoring
- [ ] Unusual IP address detection
- [ ] Security dashboard data available

## 🚨 Critical Security Tests

### Test 1: Webhook Tampering
```bash
# Test with fake webhook
curl -X POST https://your-project.supabase.co/functions/v1/stripe-webhook \
  -H "Content-Type: application/json" \
  -H "stripe-signature: fake_signature" \
  -d '{"type": "payment_intent.succeeded", "data": {"object": {"id": "test"}}}'
# Expected: 401 Unauthorized
```

### Test 2: Rate Limiting
```bash
# Make rapid requests to test rate limiting
for i in {1..110}; do
  curl -X POST https://your-project.supabase.co/functions/v1/create-payment-intent \
    -H "Authorization: Bearer YOUR_TOKEN" \
    -d '{"amount": 10.00, "recipient_email": "test@example.com"}'
done
# Expected: 429 Too Many Requests after 100 requests
```

### Test 3: Input Validation
```bash
# Test malicious input
curl -X POST https://your-project.supabase.co/functions/v1/create-payment-intent \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"amount": -100, "recipient_email": "<script>alert(\"xss\")</script>"}'
# Expected: 400 Bad Request with validation error
```

### Test 4: Database Access Control
```sql
-- Test RLS policies
SELECT * FROM profiles WHERE id != 'your_user_id';
-- Expected: Empty result (can't access other users' data)

SELECT * FROM transactions WHERE sender_id != 'your_user_id';
-- Expected: Empty result (can't access other users' transactions)
```

## 🔧 Production Hardening

### 1. **Infrastructure Security**
- [ ] HTTPS enforced everywhere (no HTTP)
- [ ] HSTS headers configured
- [ ] CDN with DDoS protection enabled
- [ ] Firewall rules restricting database access
- [ ] Regular security updates applied

### 2. **Application Security**
- [ ] Environment variables encrypted at rest
- [ ] API keys rotated regularly
- [ ] Backup encryption enabled
- [ ] Error messages don't leak sensitive information
- [ ] Debug mode disabled in production

### 3. **Monitoring Setup**
- [ ] Security alerts configured to email/SMS
- [ ] Log aggregation for security events
- [ ] Performance monitoring for anomaly detection
- [ ] Uptime monitoring with alerting
- [ ] Regular security scans scheduled

## 📋 Ongoing Security Maintenance

### Daily
- [ ] Review security alerts dashboard
- [ ] Check for unusual login patterns
- [ ] Monitor transaction volumes
- [ ] Verify webhook processing

### Weekly
- [ ] Review failed login attempts
- [ ] Check for new security vulnerabilities
- [ ] Update security rules if needed
- [ ] Backup security configurations

### Monthly
- [ ] Rotate API keys and secrets
- [ ] Security audit of user permissions
- [ ] Review and update RLS policies
- [ ] Test incident response procedures

### Quarterly
- [ ] Full security audit
- [ ] Penetration testing
- [ ] Update security documentation
- [ ] Security training for team

## 🚨 Incident Response Plan

### Immediate Actions (0-1 hour)
1. **Containment**: Block suspicious IPs, disable compromised accounts
2. **Assessment**: Determine scope and impact
3. **Notification**: Alert security team, stakeholders

### Investigation (1-24 hours)
1. **Forensics**: Analyze logs, identify attack vectors
2. **Remediation**: Patch vulnerabilities, update security rules
3. **Documentation**: Record timeline, actions taken

### Recovery (24-72 hours)
1. **Verification**: Test security fixes
2. **Communication**: Notify affected users if required
3. **Prevention**: Update procedures to prevent recurrence

## 📞 Emergency Contacts

- **Security Team**: security@moneybuddy.com
- **Incident Response**: +1-555-SECURITY
- **Compliance Officer**: compliance@moneybuddy.com
- **Legal Counsel**: legal@moneybuddy.com

## ✅ Deployment Sign-off

Before going live, verify:

- [ ] All security tests pass
- [ ] Environment variables set correctly
- [ ] Database security configured
- [ ] Monitoring systems active
- [ ] Team trained on security procedures
- [ ] Incident response plan reviewed
- [ ] Backup and recovery procedures tested

---

**⚠️ WARNING**: Do not deploy to production without completing all security checks. Financial applications require the highest security standards.

**📞 Support**: If you need help with security setup, contact the security team before deployment.
