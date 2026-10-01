import { NextRequest, NextResponse } from "next/server";
import { eq, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/schema";

/**
 * GET /api/conversations/[id]/messages
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id))
      .limit(1);

    if (!conv) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const msgList = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(asc(messages.createdAt));

    return NextResponse.json({ conversation: conv, messages: msgList });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Failed to fetch messages", details: error?.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/conversations/[id] — delete conversation and cascaded messages
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    await db.delete(conversations).where(eq(conversations.id, id));
    return NextResponse.json({ ok: true, deletedId: id });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Failed to delete conversation", details: error?.message },
      { status: 500 }
    );
  }
}
