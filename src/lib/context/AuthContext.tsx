import { createContext } from 'react';
import type { AuthClient } from '@/services/auth-client/AuthClient';

export const AuthContext = createContext<AuthClient<unknown> | null>(null);
