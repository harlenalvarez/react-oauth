import '@testing-library/jest-dom'
import crypto from 'crypto'

// not sure I need this
//global.TextEncoder = TextEncoder

// not even use I need this anymode
Object.defineProperty(global, 'crypto', {
    value: {
        getRandomValues: crypto.getRandomValues,
        subtle: crypto.webcrypto.subtle,
        randomUUID: crypto.randomUUID
    },
})