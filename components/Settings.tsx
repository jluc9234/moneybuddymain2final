import React, { useState, useEffect, useCallback } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { callEdgeFunction } from '../lib/api';
import { supabase } from '../supabaseClient';
import type { UserProfile } from '../types';

interface SettingsProps {
  userEmail: string;
  isAdmin: boolean;
}

const Settings: React.FC<SettingsProps> = ({ userEmail, isAdmin }) => {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [bankInfo, setBankInfo] = useState<{ name: string; mask: string } | null>(null);

  // Fetch user profile and bank info
  useEffect(() => {
    async function fetchProfile() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (data) {
        setProfile(data as UserProfile);
      }

      const { data: banks } = await supabase
        .from('bank_accounts')
        .select('name, mask')
        .eq('user_id', user.id)
        .limit(1);

      if (banks && banks.length > 0) {
        setBankInfo({ name: banks[0].name, mask: banks[0].mask });
      }
    }
    fetchProfile();
  }, []);

  // Request Plaid Link token
  const handleConnectBank = async () => {
    setLoading(true);
    setStatusMsg(null);
    try {
      const result = await callEdgeFunction<{ link_token: string }>('create-link-token', {});
      setLinkToken(result.link_token);
    } catch (err) {
      setStatusMsg(`Error: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  // Plaid Link success handler
  const onPlaidSuccess = useCallback(async (publicToken: string, metadata: { account_id?: string; accounts?: Array<{ id: string }> }) => {
    setLoading(true);
    setStatusMsg('Linking bank account...');
    try {
      const accountId = metadata.account_id || metadata.accounts?.[0]?.id;
      const result = await callEdgeFunction<{
        success: boolean;
        stripe_connect_account_id: string;
        bank_name: string;
        bank_mask: string;
      }>('exchange-plaid-token', {
        public_token: publicToken,
        account_id: accountId,
      });

      setProfile(prev => prev ? { ...prev, stripe_connect_account_id: result.stripe_connect_account_id } : prev);
      setBankInfo({ name: result.bank_name, mask: result.bank_mask });
      setStatusMsg('Bank account linked successfully');
      setLinkToken(null);
    } catch (err) {
      setStatusMsg(`Error: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const { open: openPlaid, ready: plaidReady } = usePlaidLink({
    token: linkToken,
    onSuccess: onPlaidSuccess,
    onExit: () => setLinkToken(null),
  });

  // Auto-open Plaid Link when token is ready
  useEffect(() => {
    if (linkToken && plaidReady) {
      openPlaid();
    }
  }, [linkToken, plaidReady, openPlaid]);

  // Stripe Connect onboarding
  const handleStripeOnboarding = async () => {
    setLoading(true);
    setStatusMsg(null);
    try {
      const result = await callEdgeFunction<{ url: string }>('create-connect-account-link', {
        return_url: window.location.origin,
      });
      window.open(result.url, '_blank');
      setStatusMsg('Complete Stripe onboarding in the new tab');
    } catch (err) {
      setStatusMsg(`Error: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const hasBankConnected = !!profile?.stripe_connect_account_id;
  const isStripeOnboarded = !!profile?.stripe_connect_onboarded;

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-left-4 duration-500">
      <div className="flex items-center space-x-4 px-2">
        <h2 className="text-3xl font-black tracking-tight uppercase">Account Settings</h2>
        {isAdmin && <span className="bg-lime-400/20 text-lime-400 px-3 py-1 rounded-full text-[10px] font-black uppercase border border-lime-400/30">Admin Access Restricted</span>}
      </div>

      {statusMsg && (
        <div className={`mx-2 px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-wider ${statusMsg.startsWith('Error') ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-lime-400/10 text-lime-400 border border-lime-400/20'}`}>
          {statusMsg}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-6">
          <Section title="Account Info">
            <div className="space-y-4">
              <div className="flex justify-between items-center py-2 border-b border-white/5">
                <span className="text-sm text-gray-400 font-bold uppercase tracking-widest">Email</span>
                <span className="text-sm font-medium">{userEmail}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-white/5">
                <span className="text-sm text-gray-400 font-bold uppercase tracking-widest">Account Type</span>
                <span className="text-sm font-black text-indigo-400 uppercase tracking-tighter">{isAdmin ? 'Admin' : 'Standard'}</span>
              </div>
            </div>
          </Section>

          {/* Bank & Stripe Connect Section */}
          <Section title="Financial Connection">
            <div className="space-y-5">
              {/* Bank Account Status */}
              <div className="flex items-center justify-between py-2 border-b border-white/5">
                <div>
                  <span className="text-sm text-gray-400 font-bold uppercase tracking-widest block">Bank Account</span>
                  {bankInfo && (
                    <span className="text-xs text-indigo-300 mt-1 block">{bankInfo.name} (****{bankInfo.mask})</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {hasBankConnected ? (
                    <span className="flex items-center gap-2 text-[10px] font-black uppercase text-lime-400">
                      <span className="w-2 h-2 rounded-full bg-lime-400 shadow-[0_0_8px_#bef264]"></span>
                      Connected
                    </span>
                  ) : (
                    <button
                      onClick={handleConnectBank}
                      disabled={loading}
                      className="px-4 py-2 bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 rounded-xl text-xs font-black uppercase tracking-widest border border-indigo-500/30 transition-all disabled:opacity-50"
                    >
                      {loading ? 'Loading...' : 'Connect Bank'}
                    </button>
                  )}
                </div>
              </div>

              {/* Stripe Connect Onboarding Status */}
              <div className="flex items-center justify-between py-2 border-b border-white/5">
                <div>
                  <span className="text-sm text-gray-400 font-bold uppercase tracking-widest block">Stripe Payout Account</span>
                  <span className="text-xs text-gray-500 mt-1 block">Required to receive payments from buyers</span>
                </div>
                <div className="flex items-center gap-3">
                  {isStripeOnboarded ? (
                    <span className="flex items-center gap-2 text-[10px] font-black uppercase text-lime-400">
                      <span className="w-2 h-2 rounded-full bg-lime-400 shadow-[0_0_8px_#bef264]"></span>
                      Active
                    </span>
                  ) : hasBankConnected ? (
                    <button
                      onClick={handleStripeOnboarding}
                      disabled={loading}
                      className="px-4 py-2 bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 rounded-xl text-xs font-black uppercase tracking-widest border border-indigo-500/30 transition-all disabled:opacity-50"
                    >
                      {loading ? 'Loading...' : 'Complete Setup'}
                    </button>
                  ) : (
                    <span className="text-[10px] font-black uppercase text-gray-500">Connect bank first</span>
                  )}
                </div>
              </div>

              {/* Connect Account ID */}
              {profile?.stripe_connect_account_id && (
                <div className="flex justify-between items-center py-2">
                  <span className="text-sm text-gray-400 font-bold uppercase tracking-widest">Connect ID</span>
                  <span className="text-xs font-mono text-gray-500">{profile.stripe_connect_account_id}</span>
                </div>
              )}
            </div>
          </Section>

          <Section title="Security Protocols">
            <div className="space-y-4">
              <Toggle label="Biometric Check-in" enabled={true} />
              <Toggle label="Force Geofence Tunnels" enabled={false} />
              <Toggle label="Admin Fee Transparency" enabled={isAdmin} />
              <Toggle label="Auto-Return Unclaimed Funds (24H)" enabled={true} />
            </div>
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Network Health">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase text-gray-500">Supabase Link</span>
                <span className="w-2 h-2 rounded-full bg-lime-400 shadow-[0_0_8px_#bef264]"></span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase text-gray-500">Plaid Interface</span>
                <span className={`w-2 h-2 rounded-full ${hasBankConnected ? 'bg-lime-400 shadow-[0_0_8px_#bef264]' : 'bg-yellow-400 shadow-[0_0_8px_#facc15]'}`}></span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase text-gray-500">Stripe Connect</span>
                <span className={`w-2 h-2 rounded-full ${isStripeOnboarded ? 'bg-lime-400 shadow-[0_0_8px_#bef264]' : hasBankConnected ? 'bg-yellow-400 shadow-[0_0_8px_#facc15]' : 'bg-red-400 shadow-[0_0_8px_#f87171]'}`}></span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase text-gray-500">Geospatial Sync</span>
                <span className="w-2 h-2 rounded-full bg-lime-400 shadow-[0_0_8px_#bef264]"></span>
              </div>
              <div className="pt-4 mt-4 border-t border-white/5">
                <button className="w-full py-3 glass hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 text-xs font-black uppercase tracking-widest transition-all rounded-xl">
                  Purge Local Storage
                </button>
              </div>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
};

const Section: React.FC<{ title: string, children: React.ReactNode }> = ({ title, children }) => (
  <div className="glass p-6 rounded-3xl border border-white/5">
    <h3 className="text-xs font-black text-indigo-400 uppercase tracking-[0.2em] mb-6 border-l-4 border-indigo-600 pl-3">{title}</h3>
    {children}
  </div>
);

const Toggle: React.FC<{ label: string, enabled: boolean }> = ({ label, enabled }) => {
  const [isOn, setIsOn] = React.useState(enabled);
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm font-bold text-indigo-100">{label}</span>
      <button 
        onClick={() => setIsOn(!isOn)}
        className={`w-12 h-6 rounded-full p-1 transition-all duration-300 ${isOn ? 'bg-lime-400 shadow-[0_0_10px_rgba(190,242,100,0.4)]' : 'bg-white/10'}`}
      >
        <div className={`w-4 h-4 bg-white rounded-full transition-all duration-300 ${isOn ? 'translate-x-6' : 'translate-x-0'}`}></div>
      </button>
    </div>
  );
};

export default Settings;
