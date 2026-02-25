
import React from 'react';

interface HeaderProps {
  onConnect: () => void;
  onLogout: () => void;
  userEmail?: string;
  isAdmin?: boolean;
  currentView: string;
  setView: (view: any) => void;
}

const Header: React.FC<HeaderProps> = ({ onConnect, onLogout, userEmail, isAdmin, currentView, setView }) => {
  return (
    <header className="flex flex-col md:flex-row justify-between items-center p-6 glass rounded-2xl gap-4 border border-white/5">
      <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setView('dashboard')}>
        <div className="w-12 h-12 relative flex-shrink-0">
          <img 
            src="logo.png" 
            alt="Money Buddy Mascot" 
            className="w-full h-full object-contain rounded-xl shadow-lg shadow-lime-400/10 hover:scale-105 transition-transform"
          />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
            Money Buddy
          </h1>
          <div className="flex items-center space-x-2">
            <p className="text-xs font-medium uppercase tracking-widest" style={{ color: '#a3e635' }}>Secure Marketplace</p>
            {isAdmin && (
              <span className="px-1.5 py-0.5 bg-lime-400/20 text-lime-400 text-[8px] font-black rounded border border-lime-400/30 uppercase tracking-tighter shadow-[0_0_5px_rgba(190,242,100,0.4)]">
                Admin Terminal
              </span>
            )}
          </div>
        </div>
      </div>

      <nav className="flex items-center space-x-1 bg-black/20 p-1 rounded-xl border border-white/5 overflow-x-auto max-w-full">
        <NavBtn label="Dashboard" view="dashboard" current={currentView} onClick={setView} />
        <NavBtn label="History" view="history" current={currentView} onClick={setView} />
        <NavBtn label="Settings" view="settings" current={currentView} onClick={setView} />
        {isAdmin && <NavBtn label="Admin Panel" view="admin" current={currentView} onClick={setView} highlight />}
      </nav>

      <div className="flex items-center space-x-4">
        {userEmail && (
          <div className="hidden lg:flex flex-col items-end">
            <span className="text-xs text-indigo-300 font-bold uppercase tracking-tighter">Personnel</span>
            <span className="text-[10px] font-medium text-white/60 truncate max-w-[120px]">{userEmail}</span>
          </div>
        )}
        <div className="flex items-center space-x-2">
          <button onClick={onConnect} className="px-4 py-2 bg-[var(--accent-color,#bef264)] hover:opacity-90 text-indigo-900 text-xs font-black rounded-xl transition-all uppercase tracking-widest">
            Plaid
          </button>
          <button onClick={onLogout} className="p-2.5 glass-dark hover:bg-red-500/20 text-gray-400 hover:text-red-400 rounded-xl transition-all">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
};

const NavBtn: React.FC<{ label: string, view: string, current: string, onClick: (v: any) => void, highlight?: boolean }> = ({ label, view, current, onClick, highlight }) => (
  <button 
    onClick={() => onClick(view)}
    className={`px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${current === view ? 'bg-indigo-600 text-white shadow-lg' : highlight ? 'text-lime-400 hover:bg-lime-400/10' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
  >
    {label}
  </button>
);

export default Header;
