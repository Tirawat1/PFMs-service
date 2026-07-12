import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "./db";

const COOKIE = "pfms_sess";
const secret = () =>
  new TextEncoder().encode(process.env.AUTH_SECRET || "dev-secret-change-me");

export async function createSession(userId) {
  const jwt = await new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .sign(secret());
  cookies().set(COOKIE, jwt, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
}

export function clearSession() {
  cookies().delete(COOKIE);
}

export async function getSessionUser() {
  try {
    const t = cookies().get(COOKIE)?.value;
    if (!t) return null;
    const { payload } = await jwtVerify(t, secret());
    return await prisma.user.findUnique({
      where: { id: payload.uid },
      include: { role: true },
    });
  } catch {
    return null;
  }
}

export function can(user, key) {
  const perms = (user && user.role && user.role.perms) || [];
  return perms.includes("*") || perms.includes(key);
}

export function isAdmin(user) {
  return can(user, "*") || (user?.role?.perms || []).includes("*");
}

export function sanitizeUser(u) {
  if (!u) return null;
  const { passwordHash, ...rest } = u;
  return rest;
}
