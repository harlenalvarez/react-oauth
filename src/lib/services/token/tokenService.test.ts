import { beforeAll, describe, test } from 'vitest';
import { getTokenStorage } from '../token-storage/TokenStorage';
import { TokenService } from './tokenService';

// dummy token save to check in
const testToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1bmlxdWVfbmFtZSI6ImhhcmxlbmFsdmFyZXoiLCJzdWIiOiJoYXJsZW5hbHZhcmV6IiwianRpIjoiYzM2NDIzMTEiLCJhdWQiOlsiaHR0cDovL2xvY2FsaG9zdDozMTE1MiIsImh0dHBzOi8vbG9jYWxob3N0OjQ0MzQ5IiwiaHR0cHM6Ly9sb2NhbGhvc3Q6NzAxNSIsImh0dHA6Ly9sb2NhbGhvc3Q6NTA1NiJdLCJuYmYiOjE2OTc4MzY4MDUsImV4cCI6MTcwNTc4NTYwNSwiaWF0IjoxNjk3ODM2ODA2LCJpc3MiOiJkb3RuZXQtdXNlci1qd3RzIn0.KjtJjW3J21Ed9t4bQmeChZm87JTsIok1JScxKabQRs4';
// This set of tests is to parse
describe('Token Service Tests', () => {
  beforeAll(() => {
    const tokenStorage = getTokenStorage('123');
    //tokenStorage.save
  })
  test('Should parse token', () => {
    const tokenStorage = getTokenStorage('123');
    //tokenStorage.x
    TokenService.getJwtClaims()
  })
})