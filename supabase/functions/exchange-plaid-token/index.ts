import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PLAID_BASE = 'https://production.plaid.com';
const STRIPE_BASE = 'https://api.stripe.com/v1';

async function plaidRequest(endpoint: string, body: Record<string, unknown>) {
  try {
    console.log(`Making Plaid request to: ${endpoint}`);
    console.log('Request body:', JSON.stringify(body, null, 2));
    
    const res = await fetch(`${PLAID_BASE}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: Deno.env.get('PLAID_CLIENT_ID'),
        secret: Deno.env.get('PLAID_SECRET'),
        ...body,
      }),
    });
    
    const responseText = await res.text();
    console.log(`Plaid response status: ${res.status}`);
    console.log(`Plaid response body: ${responseText}`);
    
    if (!res.ok) {
      throw new Error(`Plaid API error: ${res.status} - ${responseText}`);
    }
    
    return JSON.parse(responseText);
  } catch (error) {
    console.error('Plaid request failed:', error);
    throw error;
  }
}

async function stripeRequest(endpoint: string, body: string) {
  const res = await fetch(`${STRIPE_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('STRIPE_SECRET_KEY')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  return res.json();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Check required environment variables
  const plaidClientId = Deno.env.get('PLAID_CLIENT_ID');
  const plaidSecret = Deno.env.get('PLAID_SECRET');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');

  if (!plaidClientId || !plaidSecret || !supabaseUrl || !supabaseAnonKey || !supabaseServiceKey || !stripeSecretKey) {
    console.error('Missing required environment variables');
    return new Response(JSON.stringify({ 
      error: 'Server configuration error', 
      details: 'Missing required environment variables' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    try {
      const requestBody = await req.json();
      console.log('Request body received:', JSON.stringify(requestBody, null, 2));
      
      let { public_token, account_ids, account_id } = requestBody;
      
      if (!public_token) {
        console.error('Missing public_token in request');
        return new Response(JSON.stringify({ error: 'Missing public_token' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      // Handle backward compatibility: if account_id is provided, use it as single account
      if (account_id && !account_ids) {
        account_ids = [account_id];
      }
      
      if (!Array.isArray(account_ids) || account_ids.length === 0) {
        return new Response(JSON.stringify({ error: 'Missing or invalid account_ids array' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // 1. Exchange public token for access token
      console.log('Exchanging public token for access token');
      const exchangeData = await plaidRequest('/item/public_token/exchange', { public_token });
      if (exchangeData.error_code) {
        console.error('Plaid public token exchange failed:', exchangeData);
        return new Response(JSON.stringify({ error: 'Plaid API Error', details: exchangeData.error_message || 'Failed to exchange public token' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const accessToken = exchangeData.access_token;
      const itemId = exchangeData.item_id;
      console.log('Successfully exchanged token');

      // 2. Get account details
      console.log('Fetching account details');
      const accountsData = await plaidRequest('/accounts/get', { access_token: accessToken });
      
      if (accountsData.error_code) {
        console.error('Plaid accounts get failed:', accountsData);
        return new Response(JSON.stringify({ error: 'Failed to get account details', details: accountsData.error_message || 'Plaid API error' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      if (!accountsData.accounts || accountsData.accounts.length === 0) {
        console.error('No accounts returned from Plaid');
        return new Response(JSON.stringify({ error: 'No accounts found' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // 3. Check if user already has a Stripe Connect account
      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_connect_account_id')
        .eq('id', user.id)
        .maybeSingle();

      let connectAccountId = profile?.stripe_connect_account_id;

      // Create service client
      const serviceSupabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );

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

        // Immediately save to prevent race conditions
        const { error: updateError } = await serviceSupabase.from('profiles').upsert({
          id: user.id,
          email: user.email,
          stripe_connect_account_id: connectAccountId,
        });

        if (updateError) {
          throw new Error('Failed to save Stripe account ID');
        }
      }

      // 5. Process each selected account
      const processedAccounts = [];

      for (const accountId of account_ids) {
        const account = accountsData.accounts?.find((a: { account_id: string }) => a.account_id === accountId);
        if (!account) {
          continue;
        }

        // Create Stripe bank account token via Plaid integration
        const bankTokenData = await plaidRequest('/processor/stripe/bank_account_token/create', {
          access_token: accessToken,
          account_id: accountId,
        });

        if (bankTokenData.error_code) {
          throw new Error(bankTokenData.error_message);
        }

        // Attach bank account to Connect account
        const attachParams = new URLSearchParams();
        attachParams.append('external_account', bankTokenData.stripe_bank_account_token);

        await stripeRequest(`/accounts/${connectAccountId}/external_accounts`, attachParams.toString());

        // Save to database
        await serviceSupabase.from('bank_accounts').upsert({
          user_id: user.id,
          name: account.name || account.official_name || 'Bank Account',
          mask: account.mask || '****',
          balance: account.balances?.current || 0,
          type: account.subtype || 'checking',
          institution_name: 'Linked via Plaid',
          plaid_item_id: itemId,
          plaid_account_id: accountId,
          plaid_access_token: accessToken,
          stripe_bank_account_token: bankTokenData.stripe_bank_account_token,
        }, { onConflict: 'plaid_account_id' });

        processedAccounts.push({
          account_id: accountId,
          name: account.name || account.official_name || 'Bank Account',
          mask: account.mask || '****',
          type: account.subtype || 'checking',
        });
      }

      return new Response(JSON.stringify({
        success: true,
        stripe_connect_account_id: connectAccountId,
        accounts: processedAccounts,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    catch (err) {
      return new Response(JSON.stringify({ error: (err as Error).message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }
  catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
