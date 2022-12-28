import { ConfigContext } from "@/context"
import { SetupConfig, createConfig } from '@/types';

type OauthProviderProps = {
    config: SetupConfig
    children: React.ReactNode
}
export const OauthProvider = ({ config, children }: OauthProviderProps) => {
    const generatedConfig = createConfig(config);
    return (
        <ConfigContext.Provider value={generatedConfig}>
            {children}
        </ConfigContext.Provider>
    )
}