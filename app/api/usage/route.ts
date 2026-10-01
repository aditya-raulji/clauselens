/**
 * app/api/usage/route.ts
 *
 * Returns today's AI token consumption and quota percentage.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiUsage } from "@/lib/schema";

export async function GET() {
  try {
    const today = new Date().toISOString().split("T")[0];
    const [row] = await db
      .select()
      .from(aiUsage)
      .where(eq(aiUsage.day, today))
      .limit(1);

    const todayTokens = row?.tokens || 0;
    const dailyLimit = 200000; // Free tier standard daily limit
    const percentage = Math.min(100, Math.round((todayTokens / dailyLimit) * 100));

    return NextResponse.json({
      today,
      todayTokens,
      dailyLimit,
      percentage,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Failed to fetch usage", details: error?.message },
      { status: 500 }
    );
  }
}
