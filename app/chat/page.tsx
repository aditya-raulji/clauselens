import { Metadata } from "next";
import { ChatInterface } from "@/components/chat/ChatInterface";

export const metadata: Metadata = {
  title: "Chat & Questions — ClauseLens",
  description: "Ask targeted questions against contracts with zero-hallucination verified proof.",
};

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ doc?: string; documentId?: string; conv?: string }>;
}) {
  const params = await searchParams;
  const docId = params.doc || params.documentId;
  const convId = params.conv;

  return (
    <div className="-m-6 -mb-10">
      <ChatInterface documentId={docId} initialConversationId={convId} />
    </div>
  );
}
