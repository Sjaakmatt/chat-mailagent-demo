import { NextRequest, NextResponse } from "next/server";
import { supabaseOnResponse } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** POST /api/auth/sign-out — logt uit en stuurt naar /sign-in. */
export async function POST(request: NextRequest): Promise<Response> {
  const response = NextResponse.redirect(new URL("/sign-in", request.url), {
    status: 303,
  });
  const supabase = supabaseOnResponse(request, response);
  if (supabase) await supabase.auth.signOut();
  return response;
}
