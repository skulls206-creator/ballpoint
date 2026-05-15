import { createContext, useContext, type ReactNode } from "react";

interface AuthContextValue {
  user: null;
  token: null;
  loading: false;
  login: () => Promise<void>;
  register: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <AuthContext.Provider value={{ user: null, token: null, loading: false, login: async () => {}, register: async () => {}, logout: () => {} }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return { user: null, token: null, loading: false, login: async () => {}, register: async () => {}, logout: () => {} };
}
