import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  hasPermission,
  type AuthResponse,
  type Permission,
  type TenantDto,
  type UserDto,
} from "@blujay/shared";
import { api, restoreSession, setAccessToken } from "./api";

interface AuthState {
  user: UserDto | null;
  tenant: TenantDto | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    companyName: string;
    name: string;
    email: string;
    password: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  setAuth: (res: AuthResponse) => void;
  can: (permission: Permission) => boolean;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [tenant, setTenant] = useState<TenantDto | null>(null);
  const [ready, setReady] = useState(false);

  const setAuth = useCallback((res: AuthResponse) => {
    setAccessToken(res.accessToken);
    setUser(res.user);
    setTenant(res.tenant);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const ok = await restoreSession();
        if (ok) {
          const me = await api<{ user: UserDto; tenant: TenantDto }>("/api/auth/me");
          setUser(me.user);
          setTenant(me.tenant);
        }
      } catch {
        setAccessToken(null);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api<AuthResponse>("/api/auth/login", {
        method: "POST",
        body: { email, password },
      });
      setAuth(res);
    },
    [setAuth],
  );

  const register = useCallback(
    async (input: { companyName: string; name: string; email: string; password: string }) => {
      const res = await api<AuthResponse>("/api/auth/register", {
        method: "POST",
        body: input,
      });
      setAuth(res);
    },
    [setAuth],
  );

  const logout = useCallback(async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      setAccessToken(null);
      setUser(null);
      setTenant(null);
    }
  }, []);

  const can = useCallback(
    (permission: Permission) => (user ? hasPermission(user.role, permission) : false),
    [user],
  );

  const refreshUser = useCallback(async () => {
    const me = await api<{ user: UserDto; tenant: TenantDto }>("/api/auth/me");
    setUser(me.user);
    setTenant(me.tenant);
  }, []);

  const value = useMemo(
    () => ({ user, tenant, ready, login, register, logout, setAuth, can, refreshUser }),
    [user, tenant, ready, login, register, logout, setAuth, can, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth fora do AuthProvider");
  return ctx;
}
