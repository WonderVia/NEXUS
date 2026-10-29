import React, { createContext, useContext, useState, useEffect } from 'react';
import { User } from '../types';
import { authAPI } from '../services/api';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (credentials: { email: string; password: string }) => Promise<User>;
  register: (payload: { name: string; email: string; password: string; role?: string }) => Promise<User>;
  verifyOtp: (payload: { email: string; otp: string }) => Promise<User>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('proctor_auth_token'));
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    async function loadUser() {
      const storedToken = localStorage.getItem('proctor_auth_token');
      if (!storedToken) {
        setIsLoading(false);
        return;
      }

      try {
        const { user: fetchedUser } = await authAPI.getMe();
        setUser(fetchedUser);
      } catch (err) {
        console.warn('Session expired or invalid, logging out:', err);
        localStorage.removeItem('proctor_auth_token');
        setUser(null);
        setToken(null);
      } finally {
        setIsLoading(false);
      }
    }

    loadUser();
  }, []);

  const login = async (credentials: { email: string; password: string }): Promise<User> => {
    const { token: receivedToken, user: receivedUser } = await authAPI.login(credentials);
    localStorage.setItem('proctor_auth_token', receivedToken);
    setToken(receivedToken);
    setUser(receivedUser);
    return receivedUser;
  };

  const register = async (payload: { name: string; email: string; password: string; role?: string }): Promise<User> => {
    const { token: receivedToken, user: receivedUser } = await authAPI.register(payload);
    localStorage.setItem('proctor_auth_token', receivedToken);
    setToken(receivedToken);
    setUser(receivedUser);
    return receivedUser;
  };

  const verifyOtp = async (payload: { email: string; otp: string }): Promise<User> => {
    const { token: receivedToken, user: receivedUser } = await authAPI.verifyOtp(payload);
    localStorage.setItem('proctor_auth_token', receivedToken);
    setToken(receivedToken);
    setUser(receivedUser);
    return receivedUser;
  };

  const logout = () => {
    localStorage.removeItem('proctor_auth_token');
    setUser(null);
    setToken(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, register, verifyOtp, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
