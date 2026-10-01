import Link from "react";
import { FileQuestion, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6">
      <div className="w-14 h-14 rounded-[14px] bg-[#FCFBF8] border border-[#E7E2D9] flex items-center justify-center text-[#77736C] mb-4 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
        <FileQuestion className="w-7 h-7 text-[#77736C]" />
      </div>
      <span className="text-xs font-semibold uppercase tracking-wider text-[#F97316] mb-1">
        404 Not Found
      </span>
      <h1 className="text-2xl font-semibold text-[#171717] tracking-tight">
        Document or Page Not Found
      </h1>
      <p className="text-sm text-[#77736C] max-w-sm mt-2 mb-6">
        The contract, conversation, or page you were looking for doesn&apos;t exist or may have been removed.
      </p>
      <a href="/">
        <Button variant="secondary" size="md">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Documents
        </Button>
      </a>
    </div>
  );
}
