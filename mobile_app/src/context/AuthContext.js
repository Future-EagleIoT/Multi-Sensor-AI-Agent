import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../services/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    let mounted = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) setAuthError(error.message);
      setSession(data.session ?? null);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setUser(next?.user ?? null);
      setLoading(false);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email, password) => {
    setAuthError(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setAuthError(error.message);
      return { error };
    }
    return { data };
  }, []);

  const signUp = useCallback(async (email, password) => {
    setAuthError(null);
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      setAuthError(error.message);
      return { error };
    }
    return { data };
  }, []);

  const signOut = useCallback(async () => {
    setAuthError(null);
    if (user?.isGuest) {
      setSession(null);
      setUser(null);
      return { error: null };
    }
    const { error } = await supabase.auth.signOut();
    if (error) setAuthError(error.message);
    setSession(null);
    setUser(null);
    return { error };
  }, [user]);

  const continueAsGuest = useCallback(() => {
    // Guest uses anon key reads (schema allows anon SELECT for lab demos)
    setSession({ guest: true });
    setUser({ id: 'guest', email: 'guest@local', isGuest: true });
    setLoading(false);
  }, []);

  const value = useMemo(
    () => ({
      session,
      user,
      loading,
      authError,
      isConfigured: isSupabaseConfigured,
      isGuest: Boolean(user?.isGuest),
      signIn,
      signUp,
      signOut,
      continueAsGuest,
      clearError: () => setAuthError(null),
    }),
    [session, user, loading, authError, signIn, signUp, signOut, continueAsGuest],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
