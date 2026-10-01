import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  date,
  pgEnum,
  customType,
} from "drizzle-orm/pg-core";

// Custom bytea type for original binary files and uploaded parts
export const bytea = customType<{ data: Buffer; driverData: Buffer | string | Uint8Array }>({
  dataType() {
    return "bytea";
  },
  toDriver(val: Buffer): Buffer | string {
    return val;
  },
  fromDriver(val: unknown): Buffer {
    if (Buffer.isBuffer(val)) return val;
    if (typeof val === "string") {
      if (val.startsWith("\\x")) {
        return Buffer.from(val.slice(2), "hex");
      }
      return Buffer.from(val, "hex");
    }
    if (val instanceof Uint8Array) {
      return Buffer.from(val);
    }
    return Buffer.from(val as any);
  },
});

export const documentStatusEnum = pgEnum("document_status", [
  "uploading",
  "extracting",
  "ready",
  "failed",
]);

export const conversationModeEnum = pgEnum("conversation_mode", [
  "quick",
  "deep",
]);

export const messageStatusEnum = pgEnum("message_status", [
  "complete",
  "stopped",
  "error",
]);

// 1. documents table
export const documents = pgTable("documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  status: documentStatusEnum("status").default("uploading").notNull(),
  statusDetail: text("status_detail"),
  errorMessage: text("error_message"),
  pageCount: integer("page_count").default(0),
  canonicalText: text("canonical_text"),
  htmlContent: text("html_content"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// 2. document_files table (stores original file bytes separately to keep listings light)
export const documentFiles = pgTable("document_files", {
  documentId: uuid("document_id")
    .primaryKey()
    .references(() => documents.id, { onDelete: "cascade" }),
  bytes: bytea("bytes").notNull(),
});

// 3. upload_parts table (for chunked uploads to bypass 4.5MB serverless limits)
export const uploadParts = pgTable("upload_parts", {
  id: uuid("id").defaultRandom().primaryKey(),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  partIndex: integer("part_index").notNull(),
  bytes: bytea("bytes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// 4. pages table
export const pages = pgTable("pages", {
  id: uuid("id").defaultRandom().primaryKey(),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  pageNumber: integer("page_number").notNull(),
  startOffset: integer("start_offset").notNull(),
  endOffset: integer("end_offset").notNull(),
});

// 5. chunks table
export const chunks = pgTable("chunks", {
  id: uuid("id").defaultRandom().primaryKey(),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  idx: integer("idx").notNull(),
  startOffset: integer("start_offset").notNull(),
  endOffset: integer("end_offset").notNull(),
  pageStart: integer("page_start").notNull(),
  pageEnd: integer("page_end").notNull(),
  sectionLabel: text("section_label"),
  text: text("text").notNull(),
});

// 6. conversations table
export const conversations = pgTable("conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  documentIds: jsonb("document_ids").$type<string[]>().notNull(),
  title: text("title").notNull(),
  mode: conversationModeEnum("mode").default("quick").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// 7. messages table
export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // 'user' | 'assistant' | 'system'
  content: text("content").notNull(),
  status: messageStatusEnum("status").default("complete").notNull(),
  quotes: jsonb("quotes").$type<any[]>(),
  coverage: jsonb("coverage").$type<any>(),
  trace: jsonb("trace").$type<any[]>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// 8. comparisons table
export const comparisons = pgTable("comparisons", {
  id: uuid("id").defaultRandom().primaryKey(),
  docA: uuid("doc_a")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  docB: uuid("doc_b")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  result: jsonb("result").$type<any>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// 9. ai_usage table
export const aiUsage = pgTable("ai_usage", {
  day: date("day").primaryKey(),
  tokens: integer("tokens").default(0).notNull(),
});
