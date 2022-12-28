import { createContext } from "react";
import { OauthConfig } from "../types";

export const ConfigContext = createContext<OauthConfig>(null as any)