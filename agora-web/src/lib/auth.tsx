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
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  isAdmin: false,
  isTeacher: false,
  logout: async () => {},
  refreshUser: async () => {},
});

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
        setUser(JSON.parse(cachedUser));
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
      } else {
        const u = await getMe();
        setUser(u);
        localStorage.setItem("agora_user", JSON.stringify(u));
        setLoading(false);
      }
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

  return (
    <AuthContext.Provider value={{ user, loading, isAdmin, isTeacher, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
