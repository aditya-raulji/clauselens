import { Metadata } from "next";
import { DocumentViewerClient } from "@/components/viewer/DocumentViewerClient";

export const metadata: Metadata = {
  title: "Document Viewer — ClauseLens",
  description:
    "View and highlight verified citations in your legal contract with pixel-accurate highlighting.",
};

export default async function DocumentViewerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    messageId?: string;
    quote?: string;
    occ?: string;
  }>;
}) {
  const { id } = await params;
  const { messageId, quote, occ } = await searchParams;

  const initialQuoteN = quote ? parseInt(quote, 10) : undefined;
  const initialOccurrence = occ ? parseInt(occ, 10) : 0;

  return (
    <DocumentViewerClient
      documentId={id}
      initialQuoteN={Number.isFinite(initialQuoteN) ? initialQuoteN : undefined}
      initialOccurrence={initialOccurrence}
      initialMessageId={messageId}
    />
  );
}
