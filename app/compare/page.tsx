import React from "react";
import Link from "next/link";
import { GitCompare, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function ComparePage() {
  return (
    <div className="space-y-6 max-w-4xl mx-auto py-4">
      <div>
        <h1 className="text-xl font-semibold text-[#171717] tracking-tight">
          Compare Contracts
        </h1>
        <p className="text-sm text-[#77736C] mt-0.5">
          Side-by-side clause comparison across agreements, versions, or counter-proposals.
        </p>
      </div>

      <EmptyState
        icon={<GitCompare className="w-6 h-6 text-[#77736C]" />}
        title="At least two contracts required"
        description="Upload two contracts or versions to run an automated clause diff and alignment check."
        action={
          <Link href="/documents/upload">
            <Button variant="primary" size="sm">
              <Upload className="w-3.5 h-3.5 mr-1.5" />
              Upload Contracts
            </Button>
          </Link>
        }
      />
    </div>
  );
}
