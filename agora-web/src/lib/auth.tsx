"use client";

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { getMe, logout as apiLogout, clearTokens, getToken } from "./api";

interface User {
  id: string;
  school_id: string;
  first_name: string;
  last_name: string;
  email: string;
  roles: string[];
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  isTeacher: boolean;
  isParent: boolean;
  isStudent: boolean;
  isPrincipal: boolean;
  isVicePrincipal: boolean;
  isHeadmistress: boolean;
  isAccountant: boolean;
  isFrontDesk: boolean;
  isHrAdmin: boolean;
  isLeadership: boolean;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  isAdmin: false,
  isTeacher: false,
  isParent: false,
  isStudent: false,
  isPrincipal: false,
  isVicePrincipal: false,
  isHeadmistress: false,
  isAccountant: false,
  isFrontDesk: false,
  isHrAdmin: false,
  isLeadership: false,
  logout: async () => {},
  refreshUser: async () => {},
});

function parseCachedUser(raw: string): User | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    if (!Array.isArray((parsed as User).roles)) return null;
    return parsed as User;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const token = getToken();
      if (!token) {
        setUser(null);
        setLoading(false);
        return;
      }
      const cachedUser = localStorage.getItem("agora_user");
      if (cachedUser) {
        const parsedUser = parseCachedUser(cachedUser);
        if (parsedUser) {
          setUser(parsedUser);
          setLoading(false);
          // Also validate with server in background
          getMe()
            .then((u) => {
              setUser(u);
              localStorage.setItem("agora_user", JSON.stringify(u));
            })
            .catch(() => {
              clearTokens();
              setUser(null);
            });
          return;
        }

        // Drop invalid/stale local cache and fetch from server
        localStorage.removeItem("agora_user");
      } else {
        // continue to server fetch branch
      }

      const u = await getMe();
      setUser(u);
      localStorage.setItem("agora_user", JSON.stringify(u));
      setLoading(false);
    } catch {
      clearTokens();
      setUser(null);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
    window.location.href = "/login";
  }, []);

  const isAdmin = user?.roles?.includes("school_admin") ?? false;
  const isTeacher = user?.roles?.includes("teacher") ?? false;
  const isParent = user?.roles?.includes("parent") ?? false;
  const isStudent = user?.roles?.includes("student") ?? false;
  const isPrincipal = user?.roles?.includes("principal") ?? false;
  const isVicePrincipal = user?.roles?.includes("vice_principal") ?? false;
  const isHeadmistress = user?.roles?.includes("headmistress") ?? false;
  const isAccountant = user?.roles?.includes("accountant") ?? false;
  const isFrontDesk = user?.roles?.includes("front_desk") ?? false;
  const isHrAdmin = user?.roles?.includes("hr_admin") ?? false;
  const isLeadership = isAdmin || isPrincipal || isVicePrincipal;

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAdmin,
        isTeacher,
        isParent,
        isStudent,
        isPrincipal,
        isVicePrincipal,
        isHeadmistress,
        isAccountant,
        isFrontDesk,
        isHrAdmin,
        isLeadership,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
