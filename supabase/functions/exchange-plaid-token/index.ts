import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const PLAID_BASE = 'https://production.plaid.com';
const STRIPE_BASE = 'https://api.stripe.com/v1';

async function plaidRequest(endpoint: string, body: Record<string, unknown>) {
  const res = await fetch(`${PLAID_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.PLAID_CLIENT_ID,
      secret: process.env.PLAID_SECRET,
      ...body,
    }),
  });
  return res.json();
}

async function stripeRequest(endpoint: string, body: string) {
  const res = await fetch(`${STRIPE_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  return res.json();
}

export async function OPTIONS() {
  return NextResponse.json({}, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    },
  });
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized: Missing token' }, { status: 401 });
    }
    const token = authHeader.replace('Bearer ', '');

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized: Invalid token' }, { status: 401 });
    }

    const { public_token, account_id } = await req.json();

    // 1. Exchange public token for access token
    const exchangeData = await plaidRequest('/item/public_token/exchange', { public_token });
    if (exchangeData.error_code) {
      throw new Error(exchangeData.error_message);
    }
    const accessToken = exchangeData.access_token;
    const itemId = exchangeData.item_id;

    // 2. Get account details
    const accountsData = await plaidRequest('/accounts/get', { access_token: accessToken });
    const account = accountsData.accounts?.find((a: any) => a.account_id === account_id) || accountsData.accounts?.[0];

    // 3. Check if user already has a Stripe Connect account
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_connect_account_id')
      .eq('id', user.id)
      .single();

    let connectAccountId = profile?.stripe_connect_account_id;

    // 4. Create Stripe Connect Express account if needed
    if (!connectAccountId) {
      const params = new URLSearchParams();
      params.append('type', 'express');
      params.append('email', user.email!);
      params.append('capabilities[transfers][requested]', 'true');
      params.append('business_type', 'individual');
      params.append('metadata[supabase_user_id]', user.id);

      const stripeAccount = await stripeRequest('/accounts', params.toString());
      if (stripeAccount.error) {
        throw new Error(stripeAccount.error.message);
      }
      connectAccountId = stripeAccount.id;
    }

    // 5. Create Stripe bank account token via Plaid integration
    const bankTokenData = await plaidRequest('/processor/stripe/bank_account_token/create', {
      access_token: accessToken,
      account_id: account_id || account?.account_id,
    });

    if (bankTokenData.error_code) {
      throw new Error(bankTokenData.error_message);
    }

    // 6. Attach bank account to Connect account
    const attachParams = new URLSearchParams();
    attachParams.append('external_account', bankTokenData.stripe_bank_account_token);

    const attachRes = await stripeRequest(`/accounts/${connectAccountId}/external_accounts`, attachParams.toString());
    if (attachRes.error) {
       throw new Error(attachRes.error.message);
    }

    // 7. Save to database
    const serviceSupabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    await serviceSupabase.from('profiles').upsert({
      id: user.id,
      email: user.email,
      stripe_connect_account_id: connectAccountId,
    });

    await serviceSupabase.from('bank_accounts').upsert({
      user_id: user.id,
      name: account?.name || account?.official_name || 'Bank Account',
      mask: account?.mask || '****',
      balance: account?.balances?.current || 0,
      type: account?.subtype || 'checking',
      institution_name: 'Linked via Plaid',
      plaid_item_id: itemId,
      plaid_account_id: account_id || account?.account_id,
      plaid_access_token: accessToken,
      stripe_bank_account_token: bankTokenData.stripe_bank_account_token,
    }, { onConflict: 'plaid_account_id' });

    return NextResponse.json({
      success: true,
      stripe_connect_account_id: connectAccountId,
      bank_name: account?.name || 'Bank Account',
      bank_mask: account?.mask || '****',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
