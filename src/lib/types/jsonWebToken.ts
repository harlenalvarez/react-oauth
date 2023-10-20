export type JsonWebToken = {
  iss: string; // issuer ( url )
  sub: string;
  aud: string | string[];
  exp: number;
  iat: number; // issue at time
  jti: string // jwt id
}