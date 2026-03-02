
import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

interface AdminPanelProps {
  currentTheme: { primary: string, secondary: string, accent: string };
  onThemeChange: (theme: any) => void;
}

const ADMIN_EMAIL = 'lucasnale305@gmail.com';

const AdminPanel: React.FC<AdminPanelProps> = ({ currentTheme, onThemeChange }) => {
  const [isAdmin, setIsAdmin] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [config, setConfig] = useState({
    plaidClientId: '',
    stripePublicKey: '',
  });
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'config' | 'sql'>('config');

  useEffect(() => {
    const checkAdminAccess = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session && session.user && session.user.email.toLowerCase() === ADMIN_EMAIL) {
          setIsAdmin(true);
        } else {
          setIsAdmin(false);
        }
      } catch (error) {
        setIsAdmin(false);
      } finally {
        setIsChecking(false);
      }
    };

    checkAdminAccess();
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem('moneybuddy_config');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setConfig({
          plaidClientId: parsed.plaidClientId || '',
          stripePublicKey: parsed.stripePublicKey || '',
        });
      } catch (e) {
        console.error("Failed to load admin config");
      }
    }
  }, []);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const fullConfig = { ...config, theme: currentTheme };
    localStorage.setItem('moneybuddy_config', JSON.stringify(fullConfig));
    
    setSaveStatus('FINANCIAL GATEWAYS SYNCHRONIZED');
    setTimeout(() => setSaveStatus(null), 3000);
  };

  const updateTheme = (key: string, val: string) => {
    onThemeChange({ ...currentTheme, [key]: val });
  };

  // Show loading state while checking admin access
  if (isChecking) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#4a1a5e] via-[#1b6e8a] to-[#25905a] flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-red-400 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-white text-sm font-bold uppercase tracking-widest">Verifying Access...</p>
        </div>
      </div>
    );
  }

  // Show access denied if not admin
  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#4a1a5e] via-[#1b6e8a] to-[#25905a] flex items-center justify-center">
        <div className="text-center glass p-8 rounded-3xl border border-red-500/30">
          <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 3.182-3.414m-3.182-3.414a2.25 2.25 0 00-3.182 3.414m3.182-3.414L12 12.5m0 0L8.818 8.918m0 0L12 12.5m0 0L15.182 8.918m-3.182-3.414L12 12.5z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-red-400 mb-2">Access Denied</h2>
          <p className="text-white/80 text-sm">You don't have permission to access the admin panel.</p>
          <p className="text-white/60 text-xs mt-4">This area is restricted to administrators only.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in zoom-in duration-500 pb-20">
      <div className="flex items-center justify-between px-2 border-l-4 border-lime-400 pl-4">
        <div>
           <h2 className="text-3xl font-black tracking-tighter uppercase italic">Overseer Command Terminal</h2>
           <div className="flex space-x-4 mt-2">
             <button onClick={() => setActiveTab('config')} className={`text-[10px] font-black uppercase tracking-widest ${activeTab === 'config' ? 'text-lime-400' : 'text-gray-500'}`}>Parameters</button>
             <button onClick={() => setActiveTab('sql')} className={`text-[10px] font-black uppercase tracking-widest ${activeTab === 'sql' ? 'text-lime-400' : 'text-gray-500'}`}>System Documentation</button>
           </div>
        </div>
        <div className="flex items-center space-x-2">
           <span className="w-2 h-2 rounded-full bg-lime-400 animate-ping"></span>
           <span className="text-[10px] text-lime-400 font-black uppercase">[ROOT ACCESS ACTIVE]</span>
        </div>
      </div>

      {activeTab === 'config' ? (
        <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-6">
            <AdminSection title="Plaid Production API" icon="🏦">
               <div className="space-y-4">
                 <InputField label="Client ID" value={config.plaidClientId} onChange={v => setConfig({...config, plaidClientId: v})} />
               </div>
            </AdminSection>

            <AdminSection title="Stripe Settlement Node" icon="💳">
               <div className="space-y-4">
                 <InputField label="Publishable Key" value={config.stripePublicKey} onChange={v => setConfig({...config, stripePublicKey: v})} placeholder="pk_live_..." />
               </div>
            </AdminSection>

            <button type="submit" className="w-full py-4 bg-lime-400 text-indigo-900 font-black rounded-2xl uppercase tracking-[0.2em] shadow-xl shadow-lime-400/20 hover:scale-[1.02] active:scale-95 transition-all text-sm">
              {saveStatus || 'APPLY GLOBAL CONFIG'}
            </button>
          </div>

          <div className="space-y-6">
            <AdminSection title="Identity Branding" icon="🎨">
              <div className="space-y-6">
                <ColorPicker label="UI Primary Accent" value={currentTheme.primary} onChange={v => updateTheme('primary', v)} />
                <ColorPicker label="Operational Backdrop" value={currentTheme.secondary} onChange={v => updateTheme('secondary', v)} />
                <ColorPicker label="Luminescent Highlight" value={currentTheme.accent} onChange={v => updateTheme('accent', v)} />
              </div>
            </AdminSection>

            <AdminSection title="Platform Sovereignty" icon="🛡️">
              <div className="grid grid-cols-2 gap-4">
                <Metric value="2.0%" label="Protocol Yield" />
                <Metric value="AES-256" label="Encryption" />
                <Metric value="ACTIVE" label="Stripe Engine" />
                <Metric value="SECURE" label="Spatial Mesh" />
              </div>
            </AdminSection>
          </div>
        </form>
      ) : (
        <div className="space-y-6">
          <AdminSection title="Production Logic" icon="🗄️">
            <div className="p-4 bg-white/5 rounded-xl border border-white/10 mb-4">
              <h4 className="text-[10px] font-black text-lime-400 uppercase mb-2">Stripe Workflow Node</h4>
              <p className="text-[10px] text-gray-400 leading-relaxed">Asset deployment triggers a Stripe Payment Intent. Funds are captured upon successful spatial verification. Unclaimed funds trigger a reverse transfer (Refund) after the Temporal Lock window expires.</p>
            </div>
            <pre className="bg-black/60 p-6 rounded-2xl border border-white/10 text-[10px] text-indigo-300 font-mono overflow-x-auto h-80">
              {`-- STRIPE INTEGRATION ADDENDUM
ALTER TABLE public.transactions 
ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT,
ADD COLUMN IF NOT EXISTS stripe_transfer_id TEXT;`}
            </pre>
          </AdminSection>
        </div>
      )}
    </div>
  );
};

const AdminSection: React.FC<{ title: string, icon: string, children: React.ReactNode }> = ({ title, icon, children }) => (
  <div className="glass p-6 rounded-[2rem] border border-white/10 shadow-2xl relative overflow-hidden">
    <div className="flex items-center space-x-3 mb-6">
      <span className="text-xl">{icon}</span>
      <h3 className="text-xs font-black text-indigo-300 uppercase tracking-widest">{title}</h3>
    </div>
    <div className="relative z-10">{children}</div>
  </div>
);

const InputField: React.FC<{ label: string, value: string, onChange: (v: string) => void, placeholder?: string, isSecret?: boolean }> = ({ label, value, onChange, placeholder, isSecret }) => (
  <div>
    <label className="text-[9px] font-black text-gray-500 uppercase tracking-widest mb-1 block ml-1">{label}</label>
    <input 
      type={isSecret ? 'password' : 'text'}
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-xs focus:outline-none focus:border-lime-400/50 transition-colors font-mono"
      placeholder={placeholder || 'SYSTEM_NODE_NULL'}
    />
  </div>
);

const ColorPicker: React.FC<{ label: string, value: string, onChange: (v: string) => void }> = ({ label, value, onChange }) => (
  <div className="flex items-center justify-between py-2 border-b border-white/5">
    <label className="text-[10px] font-black text-indigo-200 uppercase tracking-widest">{label}</label>
    <div className="relative w-12 h-8 rounded-lg overflow-hidden border border-white/20">
       <input type="color" value={value} onChange={e => onChange(e.target.value)} className="absolute inset-0 w-full h-full cursor-pointer scale-150" />
    </div>
  </div>
);

const Metric: React.FC<{ value: string, label: string }> = ({ value, label }) => (
  <div className="bg-black/40 p-4 rounded-2xl border border-white/5 text-center flex flex-col justify-center">
    <div className="text-lg font-black text-lime-400 tracking-tighter">{value}</div>
    <div className="text-[8px] text-gray-500 uppercase font-black tracking-widest mt-1">{label}</div>
  </div>
);

export default AdminPanel;
