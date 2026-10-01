import React from "react";
import Link from "next/link";
import { Upload, FileText, CheckCircle2, GitCompare, Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";

export default function HomePage() {
  return (
    <div className="space-y-12 max-w-5xl mx-auto py-4">
      {/* Hero Section */}
      <section className="text-center pt-8 pb-4 space-y-4">
        <div className="inline-flex items-center gap-2 mb-2">
          <Badge variant="verified" size="md">
            Verified Source Proofs
          </Badge>
          <Badge variant="ai" size="md">
            Zero Hallucination
          </Badge>
        </div>

        {/* Hero headline in Instrument Serif italic 52-64px letter-spacing -1.5px */}
        <h1 className="hero-serif text-5xl sm:text-6xl text-[#171717] tracking-[-1.5px] leading-[1.08] max-w-3xl mx-auto">
          Understand your contracts, clearly.
        </h1>

        {/* Short Inter subline */}
        <p className="text-base sm:text-lg text-[#77736C] max-w-xl mx-auto font-normal leading-relaxed">
          Upload any agreement (PDF or DOCX). Chat with answers backed by exact quotes verified to exist in the original text.
        </p>

        <div className="pt-3 flex flex-wrap items-center justify-center gap-3">
          <Link href="/documents/upload">
            <Button size="lg" variant="primary" className="shadow-none font-medium">
              <Upload className="w-4 h-4 mr-2" />
              Upload Contract
            </Button>
          </Link>
          <Link href="/compare">
            <Button size="lg" variant="secondary">
              <GitCompare className="w-4 h-4 mr-2" />
              Compare Agreements
            </Button>
          </Link>
        </div>
      </section>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Documents Section (Clean Inter heading) */}
        <div className="md:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[#171717] tracking-tight">
              Documents
            </h2>
            <span className="text-xs text-[#77736C]">0 active files</span>
          </div>

          <EmptyState
            icon={<FileText className="w-6 h-6 text-[#77736C]" />}
            title="No contracts uploaded yet"
            description="Add your first PDF or DOCX agreement to extract canonical text, view interactive pages, and start verifying clauses."
            action={
              <Link href="/documents/upload">
                <Button variant="primary" size="sm">
                  <Upload className="w-3.5 h-3.5 mr-1.5" />
                  Upload your first contract
                </Button>
              </Link>
            }
          />
        </div>

        {/* Recent Contracts / Sidebar Overview (Clean Inter heading) */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[#171717] tracking-tight">
              Recent contracts
            </h2>
          </div>

          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-semibold">Activity</CardTitle>
              <CardDescription>
                Track recently analyzed documents and their verification status.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-3 space-y-3">
              <div className="p-3 rounded-[12px] bg-[#F7F5F0] border border-[#E7E2D9] text-xs text-[#77736C] flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#F97316] shrink-0" />
                <span>Uploads are processed locally into canonical chunks.</span>
              </div>
            </CardContent>
          </Card>

          {/* Verified sources Card (Clean Inter heading) */}
          <div className="pt-2">
            <h2 className="text-lg font-semibold text-[#171717] tracking-tight mb-3">
              Verified sources
            </h2>
            <Card>
              <CardContent className="p-4 space-y-3 text-xs text-[#77736C]">
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[#3F7D58] shrink-0 mt-0.5" />
                  <div>
                    <span className="font-medium text-[#171717]">Rigorous quote matching:</span> Answers never guess page numbers or quote positions; our engine locates them strictly.
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[#3F7D58] shrink-0 mt-0.5" />
                  <div>
                    <span className="font-medium text-[#171717]">Transparent coverage:</span> If only part of a document is read, ClauseLens alerts you immediately.
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
