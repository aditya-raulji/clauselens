import React from "react";
import Link from "next/link";
import { MessageSquare, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function ChatIndexPage() {
  return (
    <div className="space-y-6 max-w-4xl mx-auto py-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#171717] tracking-tight">
            Chat & Questions
          </h1>
          <p className="text-sm text-[#77736C] mt-0.5">
            Ask targeted questions against single or multiple contracts with verified proof.
          </p>
        </div>
      </div>

      <EmptyState
        icon={<MessageSquare className="w-6 h-6 text-[#77736C]" />}
        title="No active conversations"
        description="Select or upload a contract to initiate contract analysis, ask questions, or run deep research."
        action={
          <Link href="/documents/upload">
            <Button variant="primary" size="sm">
              <Upload className="w-3.5 h-3.5 mr-1.5" />
              Upload Contract to Chat
            </Button>
          </Link>
        }
      />
    </div>
  );
}
