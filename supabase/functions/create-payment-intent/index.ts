import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const {
      amount,
      recipient_email,
      description,
      geo_fence_lat,
      geo_fence_lng,
      geo_fence_radius,
      time_lock_until,
      geofence_points,
    } = await req.json();

    if (!amount || amount <= 0) {
      return new Response(JSON.stringify({ error: 'Invalid amount' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!recipient_email) {
      return new Response(JSON.stringify({ error: 'Recipient email is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Calculate 2% platform fee
    const amountCents = Math.round(amount * 100);
    const platformFeeCents = Math.round(amountCents * 0.02);

    // Look up recipient's profile for their Stripe Connect ID
    const serviceSupabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: recipientProfile } = await serviceSupabase
      .from('profiles')
      .select('id, stripe_connect_account_id, stripe_connect_onboarded')
      .eq('email', recipient_email.toLowerCase())
      .single();

    // Create Stripe PaymentIntent on the platform
    const params = new URLSearchParams();
    params.append('amount', amountCents.toString());
    params.append('currency', 'usd');
    params.append('payment_method_types[]', 'card');
    params.append('metadata[sender_id]', user.id);
    params.append('metadata[recipient_email]', recipient_email);
    params.append('metadata[platform_fee_cents]', platformFeeCents.toString());

    if (recipientProfile?.stripe_connect_account_id) {
      params.append('metadata[recipient_connect_account]', recipientProfile.stripe_connect_account_id);
    }

    const res = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('STRIPE_SECRET_KEY')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const paymentIntent = await res.json();

    if (paymentIntent.error) {
      throw new Error(paymentIntent.error.message);
    }

    // Insert transaction in DB (the trigger handles fee calculation)
    const { data: transaction, error: txError } = await serviceSupabase
      .from('transactions')
      .insert({
        sender_id: user.id,
        recipient_email: recipient_email.toLowerCase(),
        recipient_id: recipientProfile?.id || null,
        amount,
        description: description || 'Goods & Services Payment',
        status: 'pending_payment',
        stripe_payment_intent_id: paymentIntent.id,
        platform_fee_amount: platformFeeCents / 100,
        geo_fence_lat: geo_fence_lat || null,
        geo_fence_lng: geo_fence_lng || null,
        geo_fence_radius: geo_fence_radius || null,
        time_lock_until: time_lock_until || null,
        geofence_points: geofence_points || null,
        expires_at: time_lock_until || null,
      })
      .select()
      .single();

    if (txError) {
      throw new Error(txError.message);
    }

    return new Response(JSON.stringify({
      client_secret: paymentIntent.client_secret,
      transaction_id: transaction.id,
      payment_intent_id: paymentIntent.id,
      platform_fee: platformFeeCents / 100,
      net_amount: (amountCents - platformFeeCents) / 100,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
