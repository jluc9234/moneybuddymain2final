import stripe from '../../../lib/stripe';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get user session from Supabase
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization header' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Check if user already has a Stripe Connect account
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_connect_account_id')
      .eq('id', user.id)
      .single();

    if (profile?.stripe_connect_account_id) {
      // Generate onboarding link for existing account
      const accountLink = await stripe.accountLinks.create({
        account: profile.stripe_connect_account_id,
        refresh_url: `${req.headers.origin}/settings`,
        return_url: `${req.headers.origin}/settings`,
        type: 'account_onboarding',
      });

      return res.status(200).json({ url: accountLink.url });
    }

    // Create new Stripe Standard connected account
    const account = await stripe.accounts.create({
      type: 'standard',
      country: 'US', // Adjust as needed
      email: user.email,
      metadata: {
        supabase_user_id: user.id,
      },
    });

    // Store account ID in Supabase
    await supabase
      .from('profiles')
      .upsert({
        id: user.id,
        email: user.email,
        stripe_connect_account_id: account.id,
      });

    // Generate onboarding link
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${req.headers.origin}/settings`,
      return_url: `${req.headers.origin}/settings`,
      type: 'account_onboarding',
    });

    res.status(200).json({ url: accountLink.url });
  } catch (error) {
    console.error('Stripe Connect onboarding error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
