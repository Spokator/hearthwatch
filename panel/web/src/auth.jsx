import { createContext, useContext } from 'react';

const AuthContext = createContext({ user: null, setUser: () => {} });

export const AuthProvider = AuthContext.Provider;
export const useAuth = () => useContext(AuthContext);

// can('players.moderate') -> true / false selon le rôle du compte connecté.
export function useCan() {
  const { user } = useAuth();
  return (permission) => !!user?.permissions?.includes(permission);
}
