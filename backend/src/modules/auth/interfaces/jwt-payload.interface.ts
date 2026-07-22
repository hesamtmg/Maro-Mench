export interface JwtPayload {
  sub: string; // user id
  email: string;
  jti?: string; // unique token id, guarantees uniqueness even if issued
  // within the same second as another token for the same user
}
