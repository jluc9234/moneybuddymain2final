import React, { useState } from 'react';
import { Transaction } from '../types';
import { supabase } from '../supabaseClient';
import { callEdgeFunction } from '../lib/api';

interface SecureEscrowProps {
  inboundTransfers: Transaction[];
  onClaim: (id: string) => void;
}

const isInsideGeofence = (point: [number, number], vs: [number, number][]) => {
  const x = point[0], y = point[1];
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][0], yi = vs[i][1];
    const xj = vs[j][0], yj = vs[j][1];
    const intersect = ((yi > y) !== (yj > y))
        && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
};

const SecureEscrow: React.FC<SecureEscrowProps> = ({ inboundTransfers, onClaim }) => {
  const [checkingLocation, setCheckingLocation] = useState<string | null>(null);

  const handleClaimAttempt = (transfer: Transaction) => {
    setCheckingLocation(transfer.id);
    
    const now = new Date();
    if (transfer.expires_at) {
      const expiry = new Date(transfer.expires_at);
      if (now > expiry) {
        alert("This order has expired. The buyer's payment will be refunded.");
        setCheckingLocation(null);
        return;
      }
    }

    // If no geofence and no time lock, release via server
    const hasGeofence = (transfer.geofence_points && transfer.geofence_points.length > 0) || 
                        (transfer.geo_fence_lat != null && transfer.geo_fence_lng != null);
    const hasTimeLock = !!transfer.time_lock_until;

    if (!hasGeofence && !hasTimeLock) {
      // No conditions -- call server-side release directly
      releaseEscrowOnServer(transfer.id, null, null);
      return;
    }

    // Need location for geo-fenced transfers
    const geoOptions = {
      enableHighAccuracy: true,
      maximumAge: 0, 
      timeout: 10000 
    };

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const userLat = position.coords.latitude;
        const userLng = position.coords.longitude;
        const userPoint: [number, number] = [userLat, userLng];
        
        // Client-side pre-verification for polygon geofence
        if (transfer.geofence_points && transfer.geofence_points.length > 0) {
          const isSecure = isInsideGeofence(userPoint, transfer.geofence_points);
          if (!isSecure) {
            await supabase.from('audit_log').insert({
              event_type: 'SPATIAL_VERIFICATION_FAILURE',
              transaction_id: transfer.id,
              metadata: { attempted_coords: userPoint }
            });
            alert('Location check failed: You must be at the designated delivery zone to collect payment.');
            setCheckingLocation(null);
            return;
          }
        }

        // Server-side release (handles geo-fence radius check, time-lock, and Stripe transfer)
        await releaseEscrowOnServer(transfer.id, userLat, userLng);
      },
      (error) => {
        alert(`Location access required: ${error.message}. Enable GPS to verify delivery location.`);
        setCheckingLocation(null);
      },
      geoOptions
    );
  };

  const releaseEscrowOnServer = async (txId: string, lat: number | null, lng: number | null) => {
    try {
      const result = await callEdgeFunction<{
        success: boolean;
        transfer_id: string;
        amount_transferred: number;
        platform_fee: number;
        error?: string;
      }>('release-escrow', {
        transaction_id: txId,
        current_lat: lat,
        current_lng: lng,
      });

      if (result.success) {
        alert(
          `Escrow Released. $${result.amount_transferred.toFixed(2)} transferred to your account.\n` +
          `Platform Fee: $${result.platform_fee.toFixed(2)} | Transfer ID: ${result.transfer_id}`
        );
        onClaim(txId);
      } else {
        alert(`Release Denied: ${result.error || 'Unknown error'}`);
      }
    } catch (err) {
      alert(`Escrow Release Error: ${(err as Error).message}`);
    } finally {
      setCheckingLocation(null);
    }
  };

  if (inboundTransfers.length === 0) return null;

  return (
    <div className="space-y-4 mt-8 animate-in fade-in slide-in-from-bottom-4">
      <h3 className="text-lg font-bold px-2 flex items-center text-lime-400">
        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
        Incoming Orders
      </h3>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {inboundTransfers.map(transfer => {
          const isExpired = transfer.expires_at && new Date() > new Date(transfer.expires_at);
          return (
            <div key={transfer.id} className={`p-6 glass-dark border rounded-3xl relative overflow-hidden group transition-all ${isExpired ? 'border-red-500/30 opacity-60' : 'border-indigo-500/30 hover:border-lime-400/40 shadow-xl'}`}>
              <div className="flex justify-between items-start mb-4">
                <div>
                  <p className="text-[10px] text-indigo-300 font-bold uppercase tracking-widest mb-1">
                    {isExpired ? 'Order Expired' : 'Payment in Escrow'}
                  </p>
                  <h4 className="text-2xl font-black font-mono text-white">${transfer.amount.toLocaleString()}</h4>
                  {transfer.net_amount && (
                    <p className="text-[9px] text-gray-500 font-bold mt-1">Net: ${transfer.net_amount.toLocaleString()} (2% fee)</p>
                  )}
                </div>
                <div className="text-right">
                  <span className="text-[9px] text-gray-500 font-bold uppercase tracking-tighter block">Buyer</span>
                  <span className="text-[10px] font-medium text-indigo-200">{transfer.senderEmail}</span>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-center text-[9px] uppercase font-black tracking-[0.2em]">
                  <span className="text-gray-500">Conditions:</span>
                  <div className="flex space-x-2">
                    {(transfer.geofence_points || transfer.geo_fence_lat != null) && <span className="text-lime-400">DELIVERY_ZONE</span>}
                    {(transfer.expires_at || transfer.time_lock_until) && <span className="text-orange-400">DEADLINE</span>}
                    {!transfer.geofence_points && transfer.geo_fence_lat == null && !transfer.expires_at && !transfer.time_lock_until && <span className="text-indigo-400">STANDARD</span>}
                  </div>
                </div>
                
                <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div className={`h-full animate-pulse ${isExpired ? 'bg-red-500 w-full' : 'bg-lime-400 w-3/4'}`}></div>
                </div>

                <button 
                  onClick={() => handleClaimAttempt(transfer)}
                  disabled={checkingLocation === transfer.id || !!isExpired}
                  className={`w-full py-4 border rounded-2xl text-[10px] font-black transition-all uppercase tracking-[0.3em] flex items-center justify-center space-x-3 ${
                    isExpired 
                    ? 'bg-red-500/10 border-red-500/20 text-red-400 cursor-not-allowed opacity-50' 
                    : 'bg-indigo-600/10 hover:bg-lime-400 text-indigo-300 hover:text-indigo-900 border-indigo-500/30 hover:border-lime-400 shadow-lg shadow-indigo-500/10'
                  }`}
                >
                  {checkingLocation === transfer.id ? (
                    <>
                      <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                      <span>Verifying...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                      <span>{isExpired ? 'Expired' : 'Confirm Delivery & Collect'}</span>
                    </>
                  )}
                </button>
              </div>
              <div className="absolute -bottom-4 -right-4 w-24 h-24 bg-lime-400/5 rounded-full blur-3xl"></div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SecureEscrow;
