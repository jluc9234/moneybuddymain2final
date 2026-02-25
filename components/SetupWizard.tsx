
import React, { useState } from 'react';

interface SetupWizardProps {
  onComplete: () => void;
}

const SetupWizard: React.FC<SetupWizardProps> = ({ onComplete }) => {
  const [step, setStep] = useState(1);

  const steps = [
    {
      id: 1,
      title: "Welcome to Money Buddy",
      description: "The secure marketplace for buying and selling goods & services with built-in escrow protection and location-verified delivery.",
      icon: "⚡"
    },
    {
      id: 2,
      title: "Connect Your Bank",
      description: "Link your bank account via Plaid to receive payments directly. Sellers get paid instantly when buyers confirm delivery.",
      icon: "🏛️"
    },
    {
      id: 3,
      title: "Location-Verified Delivery",
      description: "Set a delivery zone on any payment. Funds are held in escrow and only released when the seller arrives at the agreed meeting point.",
      icon: "📍"
    },
    {
      id: 4,
      title: "Ready to Go",
      description: "You're all set. Start buying or selling with full escrow protection, delivery verification, and automatic refunds on expired orders.",
      icon: "🛡️"
    }
  ];

  const currentStep = steps[step - 1];

  return (
    <div className="max-w-2xl mx-auto py-12 animate-in fade-in slide-in-from-bottom-8 duration-700">
      <div className="glass p-10 rounded-[3rem] border border-white/10 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-600/10 rounded-full blur-[100px] -z-10"></div>
        
        <div className="flex justify-between mb-12">
          {steps.map((s) => (
            <div key={s.id} className="flex flex-col items-center space-y-2 relative">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-black border-2 transition-all duration-500 ${step >= s.id ? 'bg-lime-400 border-lime-400 text-indigo-900 shadow-[0_0_15px_rgba(190,242,100,0.5)]' : 'bg-white/5 border-white/10 text-gray-500'}`}>
                {s.id}
              </div>
              {s.id < steps.length && (
                <div className={`absolute left-8 top-4 w-12 h-[2px] -translate-y-1/2 transition-colors duration-500 ${step > s.id ? 'bg-lime-400' : 'bg-white/10'}`}></div>
              )}
            </div>
          ))}
        </div>

        <div className="text-center space-y-6">
          <div className="text-6xl mb-6 animate-bounce">{currentStep.icon}</div>
          <h2 className="text-3xl font-black tracking-tight uppercase">{currentStep.title}</h2>
          <p className="text-indigo-200 text-lg leading-relaxed font-medium">
            {currentStep.description}
          </p>
        </div>

        <div className="mt-12 flex justify-between gap-4">
          <button 
            onClick={() => setStep(prev => Math.max(1, prev - 1))}
            className={`px-8 py-4 glass border border-white/10 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-white/10 transition-all ${step === 1 ? 'opacity-0 pointer-events-none' : ''}`}
          >
            Back
          </button>
          
          {step === steps.length ? (
            <button 
              onClick={onComplete}
              className="px-12 py-4 bg-lime-400 text-indigo-900 rounded-2xl text-xs font-black uppercase tracking-widest shadow-[0_0_20px_rgba(190,242,100,0.4)] hover:scale-105 active:scale-95 transition-all"
            >
              Finish Setup
            </button>
          ) : (
            <button 
              onClick={() => setStep(prev => prev + 1)}
              className="px-12 py-4 bg-indigo-600 text-white rounded-2xl text-xs font-black uppercase tracking-widest shadow-xl hover:bg-indigo-500 active:scale-95 transition-all"
            >
              Continue
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default SetupWizard;
