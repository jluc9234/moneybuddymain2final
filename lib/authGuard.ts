import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import Auth from '../Auth';

// Authentication guard for components
export async function requireAuth(): Promise<{ user: any; session: any }> {
  const { data: { session }, error } = await supabase.auth.getSession();
  
  if (error || !session || !session.user) {
    throw new Error('Authentication required');
  }
  
  return { user: session.user, session };
}

// Higher-order component for protecting routes
export function withAuth<T extends Record<string, any>>(
  Component: React.ComponentType<T>,
  FallbackComponent?: React.ComponentType<any>
) {
  return function AuthenticatedComponent(props: T) {
    const [isLoading, setIsLoading] = useState(true);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [session, setSession] = useState<any>(null);

    useEffect(() => {
      const checkAuth = async () => {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session && session.user) {
            setSession(session);
            setIsAuthenticated(true);
          } else {
            setIsAuthenticated(false);
          }
        } catch (error) {
          setIsAuthenticated(false);
        } finally {
          setIsLoading(false);
        }
      };

      checkAuth();

      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session && session.user) {
          setSession(session);
          setIsAuthenticated(true);
        } else {
          setSession(null);
          setIsAuthenticated(false);
        }
        setIsLoading(false);
      });

      return () => subscription.unsubscribe();
    }, []);

    if (isLoading) {
      return React.createElement(
        'div',
        { className: "min-h-screen bg-gradient-to-br from-[#4a1a5e] via-[#1b6e8a] to-[#25905a] flex items-center justify-center" },
        React.createElement(
          'div',
          { className: "text-center" },
          React.createElement(
            'div',
            { className: "w-16 h-16 border-4 border-lime-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" }
          ),
          React.createElement(
            'p',
            { className: "text-white text-sm font-bold uppercase tracking-widest" },
            "Loading..."
          )
        )
      );
    }

    if (!isAuthenticated) {
      const Fallback = FallbackComponent || Auth;
      return React.createElement(Fallback);
    }

    return React.createElement(Component, { ...(props as any), session });
  };
}

// Hook for checking authentication status
export function useAuth() {
  const [session, setSession] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session && session.user) {
          setSession(session);
          setIsAuthenticated(true);
        } else {
          setIsAuthenticated(false);
        }
      } catch (error) {
        setIsAuthenticated(false);
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session && session.user) {
        setSession(session);
        setIsAuthenticated(true);
      } else {
        setSession(null);
        setIsAuthenticated(false);
      }
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  return { session, isLoading, isAuthenticated };
}
