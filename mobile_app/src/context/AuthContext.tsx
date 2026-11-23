import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient, isApiConfigured } from '../services/api';
import type { AuthUser, SessionData } from '../types/models';

const SESSION_KEY = 'eagle_mobile_session_v2';

export interface AuthResult<T> {
  data?: T;
  error?: Error;
}

export interface AuthContextValue {
  session: SessionData | null;
  token: string | null;
  user: AuthUser | null;
  loading: boolean;
  authError: string | null;
  isConfigured: boolean;
  isGuest: boolean;
  signIn: (email: string, password: string) => Promise<AuthResult<SessionData>>;
  signUp: (
    email: string,
    fullName: string,
    password: string,
    orgName: string,
  ) => Promise<AuthResult<SessionData>>;
  switchOrg: (orgId: string) => Promise<AuthResult<SessionData>>;
  signOut: () => Promise<{ error: null }>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

export function AuthProvider({ children }: { children: ReactNode }): ReactElement {
  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const persist = useCallback(async (next: SessionData | null) => {
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
        if (!mounted || !raw) return;
        try {
          setSession(JSON.parse(raw) as SessionData);
        } catch {
          // ignore corrupted storage
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
    async (email: string, password: string): Promise<AuthResult<SessionData>> => {
      setAuthError(null);
      try {
        const data = await apiClient.login(email, password);
        await persist(data);
        return { data };
      } catch (err: unknown) {
        const error = toError(err);
        setAuthError(error.message);
        return { error };
      }
    },
    [persist],
  );

  const signUp = useCallback(
    async (
      email: string,
      fullName: string,
      password: string,
      orgName: string,
    ): Promise<AuthResult<SessionData>> => {
      setAuthError(null);
      try {
        const data = await apiClient.register(email, fullName, password, orgName);
        await persist(data);
        return { data };
      } catch (err: unknown) {
        const error = toError(err);
        setAuthError(error.message);
        return { error };
      }
    },
    [persist],
  );

  const switchOrg = useCallback(
    async (orgId: string): Promise<AuthResult<SessionData>> => {
      if (!session?.access_token) {
        return { error: new Error('Not signed in') };
      }
      setAuthError(null);
      try {
        const data = await apiClient.switchOrg(session.access_token, orgId);
        await persist(data);
        return { data };
      } catch (err: unknown) {
        const error = toError(err);
        setAuthError(error.message);
        return { error };
      }
    },
    [session, persist],
  );

  const signOut = useCallback(async (): Promise<{ error: null }> => {
    setAuthError(null);
    await persist(null);
    return { error: null };
  }, [persist]);

  const user = useMemo<AuthUser | null>(
    () =>
      session
        ? {
            id: session.user_id,
            email: session.email,
            fullName: session.full_name,
            activeOrg: session.active_org,
            organizations: session.organizations ?? [],
          }
        : null,
    [session],
  );

  const value = useMemo<AuthContextValue>(
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

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
