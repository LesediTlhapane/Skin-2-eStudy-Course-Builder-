import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { CompanyMembership, CompanyRole, CompanyWorkspace, UserProfile } from '../types';
import { getSupabaseClient, isSupabaseClientConfigured } from '../lib/supabaseClient';
import { parseApiJson, setApiAuthContext } from '../utils/apiClient';
import {
  applyBrandThemeToDocument,
  getStoredSurfaceMode,
  saveStoredSurfaceMode,
  type BrandSurfaceMode,
} from '../utils/brandTheme';

const ACTIVE_COMPANY_STORAGE_KEY = 'estudy_active_company_id';

interface TenantContextValue {
  isClientSupabaseConfigured: boolean;
  isServerSupabaseConfigured: boolean | null;
  isInitializing: boolean;
  session: Session | null;
  accessToken: string | null;
  profile: UserProfile | null;
  memberships: CompanyMembership[];
  activeCompany: CompanyWorkspace | null;
  activeRole: CompanyRole | null;
  isPasswordRecoveryMode: boolean;
  authError: string | null;
  workspaceNotice: string | null;
  setWorkspaceNotice: (msg: string | null) => void;
  surfaceMode: BrandSurfaceMode;
  setSurfaceMode: (mode: BrandSurfaceMode) => void;
  previewTheme: (primaryColour: string, secondaryColour: string, mode?: BrandSurfaceMode) => void;
  resetThemePreview: () => void;
  setActiveCompanyId: (companyId: string) => Promise<void>;
  refreshTenantContext: (overrideToken?: string, preferredCompanyId?: string) => Promise<void>;
  signInWithPassword: (
    email: string,
    password: string,
    options?: { skipRefresh?: boolean }
  ) => Promise<string>;
  sendPasswordResetEmail: (email: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
  clearPasswordRecoveryMode: () => void;
  signOut: () => Promise<void>;
  updateLocalActiveCompany: (company: CompanyWorkspace) => void;
}

const TenantContext = createContext<TenantContextValue | undefined>(undefined);

export const TenantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isClientConfigured = isSupabaseClientConfigured();
  const [isServerConfigured, setIsServerConfigured] = useState<boolean | null>(null);
  const [isInitializing, setIsInitializing] = useState<boolean>(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [memberships, setMemberships] = useState<CompanyMembership[]>([]);
  const [activeCompany, setActiveCompany] = useState<CompanyWorkspace | null>(null);
  const [activeRole, setActiveRole] = useState<CompanyRole | null>(null);
  const [isPasswordRecoveryMode, setIsPasswordRecoveryMode] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null);
  const [surfaceMode, setSurfaceModeState] = useState<BrandSurfaceMode>(() =>
    getStoredSurfaceMode(null)
  );

  const tokenRef = useRef<string | null>(null);
  const companyIdRef = useRef<string | null>(null);

  tokenRef.current = session?.access_token || null;
  companyIdRef.current = activeCompany?.id || null;

  useEffect(() => {
    setApiAuthContext({
      getAccessToken: () => tokenRef.current,
      getCompanyId: () => companyIdRef.current,
    });
  }, []);

  // Load saved surface mode whenever activeCompany switches
  useEffect(() => {
    if (activeCompany?.id) {
      setSurfaceModeState(getStoredSurfaceMode(activeCompany.id));
    }
  }, [activeCompany?.id]);

  // Apply official eStudy identity on public auth/recovery screens; apply company branding once inside a workspace
  useEffect(() => {
    if (!activeCompany || isPasswordRecoveryMode) {
      applyBrandThemeToDocument('#052B66', '#45CC42', 'vibrant');
      return;
    }
    const primary = activeCompany.primaryColour || '#052B66';
    const secondary = activeCompany.secondaryColour || '#45CC42';
    applyBrandThemeToDocument(primary, secondary, surfaceMode);
  }, [activeCompany, isPasswordRecoveryMode, surfaceMode]);

  const setSurfaceMode = useCallback(
    (mode: BrandSurfaceMode) => {
      setSurfaceModeState(mode);
      saveStoredSurfaceMode(activeCompany?.id, mode);
    },
    [activeCompany?.id]
  );

  const previewTheme = useCallback(
    (primaryColour: string, secondaryColour: string, mode?: BrandSurfaceMode) => {
      applyBrandThemeToDocument(primaryColour, secondaryColour, mode ?? surfaceMode);
    },
    [surfaceMode]
  );

  const resetThemePreview = useCallback(() => {
    if (!activeCompany || isPasswordRecoveryMode) {
      applyBrandThemeToDocument('#052B66', '#45CC42', 'vibrant');
      return;
    }
    const primary = activeCompany.primaryColour || '#052B66';
    const secondary = activeCompany.secondaryColour || '#45CC42';
    applyBrandThemeToDocument(primary, secondary, surfaceMode);
  }, [activeCompany, isPasswordRecoveryMode, surfaceMode]);

  // Query backend health once for server Supabase status
  useEffect(() => {
    fetch('/api/health')
      .then(r => parseApiJson<any>(r))
      .then(data => {
        if (typeof data?.supabaseConfigured === 'boolean') {
          setIsServerConfigured(data.supabaseConfigured);
        }
      })
      .catch(() => {});
  }, []);

  const refreshTenantContext = useCallback(
    async (overrideToken?: string, preferredCompanyId?: string) => {
      const token = overrideToken || tokenRef.current;
      if (!token) {
        setProfile(null);
        setMemberships([]);
        setActiveCompany(null);
        setActiveRole(null);
        return;
      }

      setAuthError(null);
      const savedCompanyId =
        preferredCompanyId ||
        (() => {
          try {
            return localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || undefined;
          } catch {
            return undefined;
          }
        })();

      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
      };
      if (savedCompanyId) {
        headers['X-Company-Id'] = savedCompanyId;
      }

      let res = await fetch('/api/v2/tenant/me', { headers });
      if (res.status === 403 && savedCompanyId) {
        // Stored company may belong to another previous user; clear and retry cleanly
        try {
          localStorage.removeItem(ACTIVE_COMPANY_STORAGE_KEY);
        } catch {}
        res = await fetch('/api/v2/tenant/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
      }

      const data = await parseApiJson<any>(res);
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to load tenant workspace profile.');
      }

      const nextMemberships: CompanyMembership[] = Array.isArray(data.memberships)
        ? data.memberships
        : [];
      const nextCompany: CompanyWorkspace | null = data.activeCompany || null;
      const nextRole: CompanyRole | null = data.activeRole || null;

      setProfile(data.profile || null);
      setMemberships(nextMemberships);
      setActiveCompany(nextCompany);
      setActiveRole(nextRole);

      if (nextCompany?.id) {
        companyIdRef.current = nextCompany.id;
        try {
          localStorage.setItem(ACTIVE_COMPANY_STORAGE_KEY, nextCompany.id);
        } catch {}
      } else {
        companyIdRef.current = null;
      }
    },
    []
  );

  // Initialize Supabase session & listen for auth changes (including password recovery)
  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) {
      setIsInitializing(false);
      return;
    }

    if (typeof window !== 'undefined' && window.location.hash.includes('type=recovery')) {
      setIsPasswordRecoveryMode(true);
    }

    let mounted = true;
    (async () => {
      try {
        const { data } = await client.auth.getSession();
        if (!mounted) return;
        const currentSession = data?.session || null;
        setSession(currentSession);
        tokenRef.current = currentSession?.access_token || null;
        if (currentSession?.access_token) {
          await refreshTenantContext(currentSession.access_token);
        }
      } catch (err: any) {
        if (mounted) {
          setAuthError(err?.message || 'Could not restore authentication session.');
        }
      } finally {
        if (mounted) setIsInitializing(false);
      }
    })();

    const { data: subscription } = client.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return;
      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecoveryMode(true);
      }
      setSession(nextSession);
      tokenRef.current = nextSession?.access_token || null;
      if (nextSession?.access_token) {
        void refreshTenantContext(nextSession.access_token).catch(err => {
          setAuthError(err?.message || 'Unable to load workspace profile.');
        });
      } else {
        setProfile(null);
        setMemberships([]);
        setActiveCompany(null);
        setActiveRole(null);
        companyIdRef.current = null;
      }
    });

    return () => {
      mounted = false;
      subscription?.subscription.unsubscribe();
    };
  }, [refreshTenantContext]);

  const setActiveCompanyId = useCallback(
    async (companyId: string) => {
      if (!tokenRef.current) return;
      await refreshTenantContext(tokenRef.current, companyId);
    },
    [refreshTenantContext]
  );

  const signInWithPassword = useCallback(
    async (
      email: string,
      password: string,
      options?: { skipRefresh?: boolean }
    ): Promise<string> => {
      const client = getSupabaseClient();
      if (!client) {
        throw new Error('Supabase client is not configured (missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).');
      }
      setAuthError(null);
      const { data, error } = await client.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (error || !data.session) {
        throw new Error(error?.message || 'Invalid email or password.');
      }
      setSession(data.session);
      tokenRef.current = data.session.access_token;
      if (!options?.skipRefresh) {
        await refreshTenantContext(data.session.access_token);
      }
      return data.session.access_token;
    },
    [refreshTenantContext]
  );

  const sendPasswordResetEmail = useCallback(async (email: string) => {
    const client = getSupabaseClient();
    if (!client) {
      throw new Error('Supabase client is not configured.');
    }
    const redirectTo = typeof window !== 'undefined' ? window.location.origin : undefined;
    const { error } = await client.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo,
    });
    if (error) {
      throw new Error(error.message);
    }
  }, []);

  const updatePassword = useCallback(async (newPassword: string) => {
    const client = getSupabaseClient();
    if (!client) {
      throw new Error('Supabase client is not configured.');
    }
    const { error } = await client.auth.updateUser({ password: newPassword });
    if (error) {
      throw new Error(error.message);
    }
    setIsPasswordRecoveryMode(false);
    if (typeof window !== 'undefined' && window.location.hash.includes('type=recovery')) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  const signOut = useCallback(async () => {
    const client = getSupabaseClient();
    if (client) {
      await client.auth.signOut().catch(() => {});
    }
    setSession(null);
    setProfile(null);
    setMemberships([]);
    setActiveCompany(null);
    setActiveRole(null);
    setIsPasswordRecoveryMode(false);
    tokenRef.current = null;
    companyIdRef.current = null;
    try {
      localStorage.removeItem(ACTIVE_COMPANY_STORAGE_KEY);
    } catch {}
  }, []);

  const updateLocalActiveCompany = useCallback((company: CompanyWorkspace) => {
    setActiveCompany(company);
    setMemberships(prev =>
      prev.map(m => (m.companyId === company.id ? { ...m, company } : m))
    );
  }, []);

  return (
    <TenantContext.Provider
      value={{
        isClientSupabaseConfigured: isClientConfigured,
        isServerSupabaseConfigured: isServerConfigured,
        isInitializing,
        session,
        accessToken: session?.access_token || null,
        profile,
        memberships,
        activeCompany,
        activeRole,
        isPasswordRecoveryMode,
        authError,
        workspaceNotice,
        setWorkspaceNotice,
        surfaceMode,
        setSurfaceMode,
        previewTheme,
        resetThemePreview,
        setActiveCompanyId,
        refreshTenantContext,
        signInWithPassword,
        sendPasswordResetEmail,
        updatePassword,
        clearPasswordRecoveryMode: () => setIsPasswordRecoveryMode(false),
        signOut,
        updateLocalActiveCompany,
      }}
    >
      {children}
    </TenantContext.Provider>
  );
};

export function useTenant(): TenantContextValue {
  const ctx = useContext(TenantContext);
  if (!ctx) {
    throw new Error('useTenant must be used within TenantProvider');
  }
  return ctx;
}
