import { NextResponse } from "next/server";
import { getSessionUser, sanitizeUser } from "@/lib/auth";

export async function GET() {
  const user = await getSessionUser();
  return NextResponse.json({ me: sanitizeUser(user) });
}
