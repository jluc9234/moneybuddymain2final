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
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);

  // Fetch user profile and bank info
  useEffect(() => {
    async function fetchProfile() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .maybeSingle(); // Use maybeSingle() to handle no profile case

        if (data) {
          setProfile(data as UserProfile);
        }

        const { data: banks } = await supabase
          .from('bank_accounts')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });

        if (banks && banks.length > 0) {
          setBankAccounts(banks);
          setBankInfo({ name: banks[0].name, mask: banks[0].mask });
        }
      } catch (error) {
        console.error('Error fetching profile:', error);
      }
    }

    fetchProfile();
  }, [userEmail]); // Add dependency to prevent infinite re-renders

  // Function to remove bank account
  const handleRemoveBank = async (accountId: string) => {
    if (!confirm('Are you sure you want to remove this bank account? This will unlink it from MoneyBuddy.')) {
      return;
    }

    setLoading(true);
    setStatusMsg('Removing bank account...');
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('bank_accounts')
        .delete()
        .eq('id', accountId)
        .eq('user_id', user.id);

      if (error) throw error;

      // Refresh bank accounts list
      const { data: updatedBanks } = await supabase
        .from('bank_accounts')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      
      if (updatedBanks) {
        setBankAccounts(updatedBanks);
        if (updatedBanks.length > 0) {
          setBankInfo({ name: updatedBanks[0].name, mask: updatedBanks[0].mask });
        } else {
          setBankInfo(null);
        }
      }

      setStatusMsg('Bank account removed successfully');
    } catch (err) {
      setStatusMsg(`Error: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  // Request Plaid Link token
  const handleConnectBank = async () => {
    if (loading) return; // Prevent multiple simultaneous calls
    
    setLoading(true);
    setStatusMsg(null);
    
    // Basic integration check
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setStatusMsg('Authentication error. Please log in again.');
        setLoading(false);
        return;
      }
    } catch (error) {
      setStatusMsg('Authentication error. Please log in again.');
      setLoading(false);
      return;
    }
    
    try {
      console.log('Requesting Plaid link token...');
      const result = await callEdgeFunction<{ link_token: string }>('create-link-token', {});
      console.log('Plaid link token received:', result ? 'success' : 'failed');
      setLinkToken(result.link_token);
    } catch (err) {
      console.error('Plaid link token error:', err);
      const errorMessage = (err as Error).message;
      
      // Provide more user-friendly error messages
      if (errorMessage.includes('Missing') || errorMessage.includes('PLAID_CLIENT_ID') || errorMessage.includes('PLAID_SECRET')) {
        setStatusMsg('Plaid configuration error. Please contact support.');
      } else if (errorMessage.includes('Unauthorized')) {
        setStatusMsg('Authentication error. Please log in again.');
      } else {
        setStatusMsg(`Error: ${errorMessage}`);
      }
    } finally {
      setLoading(false);
    }
  };

  // Plaid Link success handler
  const onPlaidSuccess = useCallback(async (publicToken: string, metadata: { account_id?: string; accounts?: Array<{ id: string }> }) => {
    setLoading(true);
    setStatusMsg('Linking bank accounts...');
    try {
      console.log('Exchanging Plaid token...', metadata);
      
      const account_ids = metadata.accounts ? metadata.accounts.map(account => account.id) : (metadata.account_id ? [metadata.account_id] : []);
      console.log('Account IDs to send:', account_ids);
      const result = await callEdgeFunction<{
        success: boolean;
        stripe_connect_account_id: string;
        accounts: Array<{ account_id: string; name: string; mask: string; type: string }>;
        debug_trace: any[];
      }>('exchange-plaid-token', {
        public_token: publicToken,
        account_ids: account_ids,
      });

      console.log('Plaid token exchange result:', result);

      console.log("SERVER_TRACE:", result.debug_trace);

      setProfile(prev => prev ? { ...prev, stripe_connect_account_id: result.stripe_connect_account_id } : prev);
      
      // Refresh bank accounts list to include the new ones
      try {
        console.log('Refreshing bank accounts...');
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: updatedBanks, error } = await supabase
            .from('bank_accounts')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });
          
          if (error) {
            console.error('Error fetching updated banks:', error);
            throw error;
          }

          console.log('Updated banks from DB:', updatedBanks);
          if (updatedBanks) {
            setBankAccounts(updatedBanks);
            if (updatedBanks.length > 0) {
              setBankInfo({ name: updatedBanks[0].name, mask: updatedBanks[0].mask });
            }
          }
        }
      } catch (error) {
        console.error('Error refreshing bank accounts:', error);
      }
      
      setStatusMsg(`${result.accounts.length} bank account${result.accounts.length > 1 ? 's' : ''} linked successfully`);
      setLinkToken(null);
    } catch (err) {
      console.error('Plaid token exchange error:', err);
      const errorMessage = (err as Error).message;
      
      // Provide more user-friendly error messages
      if (errorMessage.includes('Missing') || errorMessage.includes('PLAID_CLIENT_ID') || errorMessage.includes('PLAID_SECRET')) {
        setStatusMsg('Plaid configuration error. Please contact support.');
      } else if (errorMessage.includes('Unauthorized')) {
        setStatusMsg('Authentication error. Please log in again.');
      } else if (errorMessage.includes('Plaid API error')) {
        setStatusMsg('Bank connection failed. Please try again.');
      } else {
        setStatusMsg(`Error: ${errorMessage}`);
      }
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
  const isStripeOnboarded = !!profile?.stripe_connect_onboarded || !!profile?.stripe_connect_account_id;
  const handlePurgeLocalData = () => {
    if (confirm('Are you sure you want to purge all local data? This will reset your setup and configuration.')) {
      localStorage.clear();
      window.location.reload();
    }
  };

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
              <div className="py-2 border-b border-white/5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-gray-400 font-bold uppercase tracking-widest">Bank Accounts ({bankAccounts.length})</span>
                  <button
                    onClick={handleConnectBank}
                    disabled={loading}
                    className="px-3 py-1 bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 rounded-lg text-[10px] font-black uppercase tracking-widest border border-indigo-500/30 transition-all disabled:opacity-50"
                  >
                    {loading ? 'Loading...' : '+ Add Account'}
                  </button>
                </div>
                
                {bankAccounts.length > 0 ? (
                  <div className="space-y-2">
                    {bankAccounts.map((account, index) => (
                      <div key={account.id} className="flex items-center justify-between py-2 px-3 bg-white/5 rounded-lg border border-white/10">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-indigo-600/20 rounded-lg flex items-center justify-center">
                            <span className="text-indigo-400 text-xs font-bold">{account.type?.charAt(0).toUpperCase() || 'B'}</span>
                          </div>
                          <div>
                            <span className="text-sm text-white font-medium block">{account.name}</span>
                            <span className="text-xs text-gray-400">****{account.mask} • {account.type || 'checking'}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-lime-400 font-medium">${(account.balance || 0).toLocaleString()}</span>
                          <button
                            onClick={() => handleRemoveBank(account.id)}
                            disabled={loading}
                            className="w-6 h-6 rounded bg-red-500/20 hover:bg-red-500/30 text-red-400 hover:text-red-300 flex items-center justify-center transition-all disabled:opacity-50"
                            title="Remove bank account"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                          <span className="w-2 h-2 rounded-full bg-lime-400 shadow-[0_0_8px_#bef264]"></span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <div className="text-gray-500 text-xs font-medium uppercase tracking-widest">No bank accounts connected</div>
                    <div className="text-gray-600 text-[10px] mt-1">Connect your first bank account to get started</div>
                  </div>
                )}
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
                <button onClick={handlePurgeLocalData} className="w-full py-3 glass hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 text-xs font-black uppercase tracking-widest transition-all rounded-xl">
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
