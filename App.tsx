
import React, { useState, useEffect, useCallback } from 'react';
import Header from './components/Header';
import BalanceSummary from './components/BalanceSummary';
import SendMoneyForm from './components/SendMoneyForm';
import AccountList from './components/AccountList';
import SecureEscrow from './components/SecureEscrow';
import SetupWizard from './components/SetupWizard';
import Settings from './components/Settings';
import AdminPanel from './components/AdminPanel';
import TransactionHistory from './components/TransactionHistory';
import Auth from './Auth';
import { supabase } from './supabaseClient';
import { BankAccount, Transaction } from './types';

type View = 'dashboard' | 'settings' | 'setup' | 'admin' | 'history';

const ADMIN_EMAIL = (import.meta.env.VITE_ADMIN_EMAIL || '').toLowerCase();

const App: React.FC = () => {
  const [session, setSession] = useState<any>(null);
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [inboundTransfers, setInboundTransfers] = useState<Transaction[]>([]);
  const [platformRevenue, setPlatformRevenue] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasCompletedSetup, setHasCompletedSetup] = useState(false);
  
  const [theme, setTheme] = useState({
    primary: '#4f46e5',
    secondary: '#0f0c29',
    accent: '#bef264'
  });

  // Fetch Logic
  const fetchData = useCallback(async () => {
    if (!session) return;
    setIsLoading(true);

    // 1. Fetch User Accounts
    const { data: accData } = await supabase
      .from('bank_accounts')
      .select('*')
      .order('created_at', { ascending: false });

    // 2. Fetch User Transaction History (Sent and Received)
    const { data: txData } = await supabase
      .from('transactions')
      .select('*')
      .order('created_at', { ascending: false });

    // 3. Filter Inbound Locked Transfers for Escrow
    const inbound = txData?.filter(tx => 
      tx.recipient_email.toLowerCase() === session.user.email.toLowerCase() && 
      (tx.status === 'locked' || tx.status === 'pending_escrow')
    ) || [];

    // 4. Admin Specific Logic (Lucas)
    if (session.user.email.toLowerCase() === ADMIN_EMAIL) {
      const { data: metrics } = await supabase.rpc('get_platform_revenue'); // Requires RPC or simple sum query
      // For simplicity in this build, we use the view or a sum query:
      const { data: allTx } = await supabase.from('transactions').select('amount');
      const totalRev = allTx?.reduce((sum, tx) => sum + (tx.amount * 0.02), 0) || 0;
      setPlatformRevenue(totalRev);
    }

    setAccounts(accData || []);
    setTransactions(txData || []);
    setInboundTransfers(inbound);
    setIsLoading(false);
  }, [session]);

  useEffect(() => {
    // Auth Listeners
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    // Setup Wizard Check
    const setupStatus = localStorage.getItem('moneybuddy_setup_complete');
    if (setupStatus) setHasCompletedSetup(true);

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) {
      fetchData();
      if (!hasCompletedSetup && currentView !== 'setup') {
        setCurrentView('setup');
      }
    }
  }, [session, hasCompletedSetup, fetchData]);

  const handleTransactionInitiated = async () => {
    // Refresh history after a transfer is made
    await fetchData();
  };

  const handleClaimFunds = async (_txId: string) => {
    // Escrow release is now handled server-side by the release-escrow Edge Function
    // This callback just refreshes the data after a successful claim
    await fetchData();
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setCurrentView('dashboard');
  };

  const cssVars = {
    '--primary-color': theme.primary,
    '--secondary-bg': theme.secondary,
    '--accent-color': theme.accent,
  } as React.CSSProperties;

  if (!session) {
    return (
      <div style={cssVars} className="min-h-screen bg-gradient-to-br from-[#4a1a5e] via-[#1b6e8a] to-[#25905a] overflow-hidden">
        <Auth />
      </div>
    );
  }

  return (
    <div style={cssVars} className="min-h-screen bg-gradient-to-br from-[#4a1a5e] via-[#1b6e8a] to-[#25905a] text-white overflow-x-hidden transition-all">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <Header 
          onConnect={() => alert('Launching Plaid Production Interface...')} 
          onLogout={handleLogout} 
          userEmail={session.user.email} 
          isAdmin={session.user.email.toLowerCase() === ADMIN_EMAIL}
          currentView={currentView}
          setView={setCurrentView}
        />
        
        <main className="mt-8 transition-all">
          {currentView === 'setup' && (
            <SetupWizard onComplete={() => { 
              setHasCompletedSetup(true); 
              localStorage.setItem('moneybuddy_setup_complete', 'true'); 
              setCurrentView('dashboard'); 
            }} />
          )}

          {currentView === 'settings' && (
            <Settings userEmail={session.user.email} isAdmin={session.user.email.toLowerCase() === ADMIN_EMAIL} />
          )}

          {currentView === 'history' && (
            <TransactionHistory transactions={transactions} />
          )}

          {currentView === 'admin' && (
            <AdminPanel currentTheme={theme} onThemeChange={setTheme} />
          )}

          {currentView === 'dashboard' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-in fade-in zoom-in duration-500">
              <div className="lg:col-span-8 space-y-8">
                {session.user.email.toLowerCase() === ADMIN_EMAIL && (
                  <div className="p-4 bg-lime-400/10 border border-lime-400/30 rounded-2xl flex justify-between items-center">
                    <span className="text-xs font-black text-lime-400 uppercase tracking-widest">Platform Revenue (2% Service Fee)</span>
                    <span className="text-xl font-mono text-white font-black">${platformRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
                
                <BalanceSummary accounts={accounts} transactions={transactions} isLoading={isLoading} />
                <AccountList accounts={accounts} />
                
                <div className="space-y-4">
                  <div className="flex justify-between items-center px-2">
                    <h3 className="text-lg font-bold uppercase tracking-tight">Recent Activity</h3>
                    <button onClick={() => setCurrentView('history')} className="text-[10px] font-black text-indigo-400 hover:text-lime-400 uppercase tracking-[0.2em] transition-colors">
                      View All
                    </button>
                  </div>
                  <div className="glass rounded-3xl overflow-hidden border border-white/5 divide-y divide-white/5">
                    {transactions.slice(0, 4).map(tx => (
                      <div key={tx.id} onClick={() => setCurrentView('history')} className="p-4 flex items-center justify-between hover:bg-white/5 transition-all cursor-pointer group">
                         <div className="flex items-center space-x-4">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xs font-black border ${tx.status === 'completed' ? 'bg-lime-400/10 border-lime-400/20 text-lime-400' : 'bg-indigo-400/10 border-indigo-400/20 text-indigo-400'}`}>
                              {tx.sender_id === session.user.id ? 'OUT' : 'IN'}
                            </div>
                            <div>
                               <p className="text-sm font-bold text-white group-hover:text-lime-300 transition-colors">{tx.description || 'Payment'}</p>
                               <p className="text-[9px] text-gray-500 uppercase font-black">{new Date(tx.created_at).toLocaleDateString()}</p>
                            </div>
                         </div>
                         <div className="text-right">
                            <p className={`text-sm font-black font-mono ${tx.sender_id === session.user.id ? 'text-white' : 'text-lime-400'}`}>
                              {tx.sender_id === session.user.id ? '-' : '+'}${tx.amount.toLocaleString()}
                            </p>
                            <p className="text-[8px] font-black text-gray-600 uppercase tracking-tighter">{tx.status}</p>
                         </div>
                      </div>
                    ))}
                    {transactions.length === 0 && (
                      <div className="p-8 text-center text-gray-500 text-xs font-bold uppercase tracking-widest opacity-30 italic">No Activity Logs Found</div>
                    )}
                  </div>
                </div>

                <SecureEscrow inboundTransfers={inboundTransfers} onClaim={handleClaimFunds} />
              </div>
              <div className="lg:col-span-4">
                <SendMoneyForm onTransactionInitiated={handleTransactionInitiated} />
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default App;
