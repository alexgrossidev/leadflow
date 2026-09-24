/** Claims carried by an access token. Deliberately minimal: identity only. */
export interface AccessTokenClaims {
  sub: string; // user id
  iat?: number;
  exp?: number;
}

export interface AuthenticatedUser {
  userId: number;
}
