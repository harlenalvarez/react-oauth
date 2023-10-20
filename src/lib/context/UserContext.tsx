import { createContext } from "react";

export const UserContext = createContext<JWT | null>(null);
export const UserActionsContext = createContext<(payload: unknown) => void>(null as any);