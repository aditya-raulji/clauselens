import { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, FileText, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Document Viewer — ClauseLens",
};

export default async function DocumentViewerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="max-w-4xl mx-auto py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-1.5" />
            Back to Library
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
            The interactive document viewer with highlighted quote navigation is
            coming in the next prompt. For now, use the Chat to analyze this
            contract.
          </p>
        </div>
        <Link href={`/chat?doc=${id}`}>
          <Button variant="primary" size="sm">
            <MessageSquare className="w-4 h-4 mr-1.5" />
            Chat about this contract
          </Button>
        </Link>
      </div>
    </div>
  );
}
