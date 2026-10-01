import { Metadata } from "next";
import { ChatInterface } from "@/components/chat/ChatInterface";

export const metadata: Metadata = {
  title: "Contract Chat — ClauseLens",
  description: "Chat with verified citations and zero hallucination.",
};

export default async function DocumentChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ conv?: string }>;
}) {
  const { id } = await params;
  const { conv } = await searchParams;

  return (
    <div className="-m-6 -mb-10">
      <ChatInterface documentId={id} initialConversationId={conv} />
    </div>
  );
}
