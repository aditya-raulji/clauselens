import React from "react";
import { UploadCloud, FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function DocumentUploadPage() {
  return (
    <div className="max-w-2xl mx-auto py-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[#171717] tracking-tight">
          Upload Contract
        </h1>
        <p className="text-sm text-[#77736C] mt-1">
          Upload a PDF or DOCX agreement. Text is extracted into canonical sections and chunks.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Document Files</CardTitle>
            <div className="flex gap-2">
              <Badge variant="neutral" size="sm">PDF</Badge>
              <Badge variant="neutral" size="sm">DOCX</Badge>
            </div>
          </div>
          <CardDescription>
            Files are stored in secure Postgres bytea storage with chunked upload support.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border-2 border-dashed border-[#E7E2D9] rounded-[16px] p-8 text-center bg-[#F7F5F0]/50 hover:bg-[#F7F5F0] transition-colors flex flex-col items-center justify-center cursor-pointer">
            <div className="w-12 h-12 rounded-[12px] bg-[#FCFBF8] border border-[#E7E2D9] flex items-center justify-center text-[#F97316] mb-3">
              <UploadCloud className="w-6 h-6" />
            </div>
            <p className="text-sm font-medium text-[#171717]">
              Drag and drop contract file here, or browse
            </p>
            <p className="text-xs text-[#77736C] mt-1">
              Supports PDF and DOCX up to 50MB
            </p>
            <div className="mt-4">
              <Button size="sm" variant="primary">
                <FileUp className="w-3.5 h-3.5 mr-1.5" />
                Select File
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
