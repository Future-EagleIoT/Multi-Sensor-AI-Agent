import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient, isApiConfigured } from '../services/api';

const SESSION_KEY = 'eagle_mobile_session_v2';
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  const persist = useCallback(async (next) => {
    setSession(next);
    if (next) {
      await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(next));
    } else {
      await AsyncStorage.removeItem(SESSION_KEY);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(SESSION_KEY)
      .then((raw) => {
        if (!mounted) return;
        if (raw) {
          try {
            setSession(JSON.parse(raw));
          } catch {
            // ignore corrupted storage
          }
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const signIn = useCallback(
    async (email, password) => {
      setAuthError(null);
      try {
        const data = await apiClient.login(email, password);
        await persist(data);
        return { data };
      } catch (error) {
        setAuthError(error.message);
        return { error };
      }
    },
    [persist],
  );

  const signUp = useCallback(
    async (email, fullName, password, orgName) => {
      setAuthError(null);
      try {
        const data = await apiClient.register(email, fullName, password, orgName);
        await persist(data);
        return { data };
      } catch (error) {
        setAuthError(error.message);
        return { error };
      }
    },
    [persist],
  );

  const switchOrg = useCallback(
    async (orgId) => {
      if (!session?.access_token) return { error: new Error('Not signed in') };
      setAuthError(null);
      try {
        const data = await apiClient.switchOrg(session.access_token, orgId);
        await persist(data);
        return { data };
      } catch (error) {
        setAuthError(error.message);
        return { error };
      }
    },
    [session, persist],
  );

  const signOut = useCallback(async () => {
    setAuthError(null);
    await persist(null);
    return { error: null };
  }, [persist]);

  const user = useMemo(
    () =>
      session
        ? {
            id: session.user_id,
            email: session.email,
            fullName: session.full_name,
            activeOrg: session.active_org,
            organizations: session.organizations || [],
          }
        : null,
    [session],
  );

  const value = useMemo(
    () => ({
      session,
      token: session?.access_token ?? null,
      user,
      loading,
      authError,
      isConfigured: isApiConfigured,
      isGuest: false,
      signIn,
      signUp,
      switchOrg,
      signOut,
      clearError: () => setAuthError(null),
    }),
    [session, user, loading, authError, signIn, signUp, switchOrg, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
