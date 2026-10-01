import { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, FileText, MessageSquare, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Document Viewer — ClauseLens",
};

export default async function DocumentViewerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ messageId?: string; quote?: string; occ?: string }>;
}) {
  const { id } = await params;
  const { messageId, quote, occ } = await searchParams;

  return (
    <div className="max-w-4xl mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-1.5" />
            Back to Library
          </Button>
        </Link>

        <Link href={`/documents/${id}/chat`}>
          <Button variant="secondary" size="sm">
            <MessageSquare className="w-3.5 h-3.5 mr-1.5 text-[#F97316]" />
            Chat with this Contract
          </Button>
        </Link>
      </div>

      <div className="bg-[#FCFBF8] border border-[#E7E2D9] rounded-[16px] p-8 flex flex-col items-center text-center gap-4">
        <div className="w-14 h-14 rounded-[12px] bg-[#F7F5F0] border border-[#E7E2D9] flex items-center justify-center text-[#77736C]">
          <FileText className="w-7 h-7" />
        </div>

        <div>
          <h1 className="text-lg font-semibold text-[#171717] tracking-tight">
            Document Viewer
          </h1>
          <p className="text-sm text-[#77736C] mt-1.5 max-w-sm">
            The full interactive document viewer with synchronized quote highlighting
            is implemented in the next viewer phase.
          </p>
        </div>

        {quote && (
          <div className="bg-[#3F7D58]/10 border border-[#3F7D58]/30 rounded-[12px] p-3 text-xs text-[#3F7D58] max-w-md flex items-center gap-2 text-left">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span>
              Targeting citation <strong>Quote [{quote}]</strong> (occurrence {occ || 0}) from message {messageId?.slice(0, 8)}…
            </span>
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <Link href={`/documents/${id}/chat`}>
            <Button variant="primary" size="sm">
              <MessageSquare className="w-4 h-4 mr-1.5" />
              Open Chat Interface
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
