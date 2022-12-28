import { describe, it } from "vitest";
import { render } from '@testing-library/react'
import { OauthProvider } from "./OauthProvider";
import { mockTestSetup } from "@/types/config.type.test";

describe('Should verify provider mounts', () => {
    it('Should reander', () => {
        render(
            <OauthProvider config={mockTestSetup}>
                <div>Test</div>
            </OauthProvider>
        )
    })
})