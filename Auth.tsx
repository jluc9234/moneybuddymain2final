
import React, { useState } from 'react';
import { supabase } from './supabaseClient';

const Auth: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    const { error } = isSignUp 
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setMessage({ type: 'error', text: error.message });
      if (error.message.includes('Invalid URL') || error.message.includes('fetch')) {
        setMessage({ type: 'error', text: 'Connection failed. Please try again later.' });
      }
    } else if (isSignUp) {
      setMessage({ type: 'success', text: 'Confirmation link sent to your email.' });
    }
    setLoading(false);
  };

  const handlePasswordReset = async () => {
    if (!email) {
      setMessage({ type: 'error', text: 'Please enter your email address first.' });
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) {
      setMessage({ type: 'error', text: error.message });
    } else {
      setMessage({ type: 'success', text: 'Password reset link sent. Check your email.' });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md w-full glass p-8 rounded-3xl space-y-8 shadow-2xl relative border border-white/10">
        <div className="text-center flex flex-col items-center gap-1">
          <div className="w-24 h-24 relative mb-2">
             <div className="absolute inset-0 bg-lime-400/20 blur-2xl rounded-full animate-pulse"></div>
             <img 
               src="logo.png" 
               alt="Money Buddy Mascot" 
               className="w-full h-full object-contain relative z-10 transform hover:scale-110 transition-transform duration-500"
             />
          </div>
          <h2 className="text-3xl font-extrabold text-white tracking-tight leading-none">
            Money Buddy
          </h2>
          <p className="mt-1 text-sm font-bold uppercase tracking-[0.3em]" style={{ color: '#a3e635' }}>
            Secure Marketplace
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleAuth}>
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-bold text-indigo-200 uppercase tracking-[0.2em] mb-2 block ml-1">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-lime-400/50 transition-colors text-sm"
                placeholder="user@example.com"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-indigo-200 uppercase tracking-[0.2em] mb-2 block ml-1">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-lime-400/50 transition-colors text-sm"
                placeholder="••••••••"
              />
            </div>
          </div>

          {message && (
            <div className={`p-4 rounded-xl text-xs font-bold leading-relaxed animate-pulse ${message.type === 'error' ? 'bg-red-500/20 text-red-200 border border-red-500/30' : 'bg-lime-500/20 text-lime-200 border border-lime-500/30'}`}>
              <span className="uppercase mr-2">[{message.type}]:</span> {message.text}
            </div>
          )}

          <div className="space-y-3">
            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl transition-all shadow-lg active:scale-[0.98] disabled:opacity-50 border border-indigo-400/30"
            >
              {loading ? 'Signing in...' : (isSignUp ? 'SIGN UP' : 'LOG IN')}
            </button>

            {!isSignUp && (
              <button
                type="button"
                onClick={handlePasswordReset}
                className="w-full text-[10px] text-indigo-400 hover:text-white transition-colors uppercase font-bold tracking-widest"
              >
                Forgot Password?
              </button>
            )}
          </div>
        </form>

        <div className="text-center pt-4">
          <button
            onClick={() => setIsSignUp(!isSignUp)}
            className="text-indigo-200 hover:text-lime-400 transition-colors text-xs font-bold uppercase tracking-widest"
          >
            {isSignUp ? 'Already have an account? Log In' : "Don't have an account? Sign Up"}
          </button>
        </div>
      </div>
      
      <div className="absolute top-1/3 left-1/3 w-[500px] h-[500px] rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.08) 0%, transparent 70%)', filter: 'blur(80px)' }}></div>
      <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(163,230,53,0.06) 0%, transparent 70%)', filter: 'blur(80px)' }}></div>
    </div>
  );
};

export default Auth;
