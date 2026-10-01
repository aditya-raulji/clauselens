import { DocumentLibrary } from "@/components/DocumentLibrary";

export const metadata = {
  title: "ClauseLens — Contract Library",
  description:
    "Your contract library. Upload PDF or DOCX agreements to extract canonical text, chat with AI, and verify every claim with exact source quotes.",
};

export default function HomePage() {
  return <DocumentLibrary />;
}
