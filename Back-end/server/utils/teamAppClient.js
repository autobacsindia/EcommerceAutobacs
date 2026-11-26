/**
 * The Autobacs Team phone app (Mobile/autobacs-team) signs in with the normal
 * staff login but cannot use httpOnly cookies well: React Native's cookie jar
 * is shared, not encrypted, and a PDF download does not carry it. So when a
 * request says `X-Client: autobacs-team`, login and refresh answer with the
 * token pair in the JSON BODY (the app keeps it in SecureStore and sends
 * `Authorization: Bearer`) and set NO auth cookies.
 *
 * The website never sends this header, so its cookie flow is unchanged.
 * The header grants nothing by itself: the same password check, the same
 * tokens, the same sessionVersion check in `protect`. It only changes where the
 * tokens travel. (A browser could send it too and would then just hold the
 * tokens in JS — its own choice, no one else's account is touched.)
 */
import jwt from 'jsonwebtoken';

export const TEAM_APP_CLIENT = 'autobacs-team';

export function isTeamAppClient(req) {
  const v = req?.headers?.['x-client'];
  return typeof v === 'string' && v.trim().toLowerCase() === TEAM_APP_CLIENT;
}

const iso = (d) => {
  const t = d ? new Date(d) : null;
  return t && !Number.isNaN(t.getTime()) ? t.toISOString() : null;
};

/**
 * The body fields the app stores. Access expiry comes from the JWT itself
 * (`accessTokenExpiry` is a duration like '30m'); refresh expiry is a Date (or
 * an ISO string on the grace-replay path).
 */
export function tokenBody(tokens) {
  const exp = jwt.decode(tokens.accessToken)?.exp;
  return {
    tokenType: 'Bearer',
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: exp ? new Date(exp * 1000).toISOString() : null,
    refreshToken: tokens.refreshToken,
    refreshTokenExpiresAt: iso(tokens.refreshTokenExpiry),
  };
}
