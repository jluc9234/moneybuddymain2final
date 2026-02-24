import React from 'react';
import { BankAccount, Transaction } from '../types';

interface BalanceSummaryProps {
  accounts: BankAccount[];
  transactions: Transaction[];
  isLoading: boolean;
}

const BalanceSummary: React.FC<BalanceSummaryProps> = ({ accounts, transactions, isLoading }) => {
  const totalBalance = accounts.reduce((sum, acc) => sum + acc.balance, 0);

  // Compute real stats from transaction data
  const uniqueCards = new Set(transactions.map(tx => tx.sender_id)).size;
  const securedZones = new Set(
    transactions
      .filter(tx => tx.geo_fence_lat && tx.geo_fence_lng)
      .map(tx => `${tx.geo_fence_lat},${tx.geo_fence_lng}`)
  ).size;

  // Calculate month-over-month change from real transaction data
  const now = new Date();
  const thisMonth = transactions.filter(tx => {
    const d = new Date(tx.created_at);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() && tx.status === 'completed';
  });
  const lastMonth = transactions.filter(tx => {
    const d = new Date(tx.created_at);
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return d.getMonth() === prev.getMonth() && d.getFullYear() === prev.getFullYear() && tx.status === 'completed';
  });

  const thisMonthInflow = thisMonth.reduce((sum, tx) => sum + tx.amount, 0);
  const lastMonthInflow = lastMonth.reduce((sum, tx) => sum + tx.amount, 0);
  const percentChange = lastMonthInflow > 0 ? ((thisMonthInflow - lastMonthInflow) / lastMonthInflow) * 100 : 0;

  return (
    <div className="p-8 glass rounded-3xl relative overflow-hidden">
      <div className="relative z-10">
        <h2 className="text-gray-400 font-medium mb-2">Total Combined Balance</h2>
        <div className="flex items-baseline space-x-2">
          <span className="text-4xl md:text-5xl font-bold">
            {isLoading ? "..." : `$${totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </span>
          {!isLoading && percentChange !== 0 && (
            <span className={`text-sm font-semibold ${percentChange >= 0 ? 'text-lime-400' : 'text-red-400'}`}>
              {percentChange >= 0 ? '+' : ''}{percentChange.toFixed(1)}% this month
            </span>
          )}
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
          <StatBox label="Active Cards" value={isLoading ? "..." : uniqueCards.toString()} icon="💳" />
          <StatBox label="Secured Zones" value={isLoading ? "..." : securedZones.toString()} icon="📍" />
          <StatBox label="Transactions" value={isLoading ? "..." : transactions.filter(tx => tx.status === 'completed').length.toString()} icon="🛡️" />
          <StatBox label="Linked Banks" value={isLoading ? "..." : accounts.length.toString()} icon="🏛️" />
        </div>
      </div>
      
      {/* Decorative pulse */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-lime-400/10 rounded-full blur-3xl animate-pulse"></div>
    </div>
  );
};

const StatBox: React.FC<{ label: string, value: string, icon: string }> = ({ label, value, icon }) => (
  <div className="glass-dark p-3 rounded-xl">
    <div className="text-lg mb-1">{icon}</div>
    <div className="text-sm font-bold">{value}</div>
    <div className="text-[10px] text-gray-400 uppercase tracking-tighter">{label}</div>
  </div>
);

export default BalanceSummary;
