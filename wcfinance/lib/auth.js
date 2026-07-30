import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';

const SECRET = () => {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error('AUTH_SECRET missing or shorter than 32 characters');
  return new TextEncoder().encode(s);
};

export const SESSION_COOKIE = 'wcf_session';
export const SESSION_MAX_AGE = 60 * 60 * 12; // 12h

export const hashPassword = (plain) => bcrypt.hash(plain, 12);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

export async function createSession({ userId, roleId, dept }) {
  return new SignJWT({ roleId, dept })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(SECRET());
}

export async function readSession(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET());
    return { userId: payload.sub, roleId: payload.roleId, dept: payload.dept };
  } catch {
    return null;
  }
}

/** Permission check mirroring the prototype: "*" grants everything. */
export function can(permissions, permission) {
  if (!permissions) return false;
  return permissions.includes('*') || permissions.includes(permission);
}

/** Who may see every department's data. */
export const seesAllDepts = (permissions) => can(permissions, '*') || can(permissions, 'disburse');
