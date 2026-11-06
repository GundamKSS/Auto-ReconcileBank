import { describe, expect, it } from "vitest";
import { matchesWorkspaceItem, type SearchableLineItem } from "../lib/workspaceSearch";

describe("matchesWorkspaceItem", () => {
  const sampleItem: SearchableLineItem = {
    id: "item-1",
    ref: "INV-2026-0801",
    date: "2026-08-01",
    description: "ค่าบริการพัฒนาระบบ",
    senderInfo: "ธนาคารกสิกรไทย · 123-4-56789-0 · นาย สมชาย ใจดี",
    senderHint: "สมชาย ใจดี",
    amount: 25000.5,
  };

  it("returns true for empty or whitespace query", () => {
    expect(matchesWorkspaceItem(sampleItem, "")).toBe(true);
    expect(matchesWorkspaceItem(sampleItem, "   ")).toBe(true);
  });

  it("matches amount without commas", () => {
    expect(matchesWorkspaceItem(sampleItem, "25000")).toBe(true);
    expect(matchesWorkspaceItem(sampleItem, "25000.50")).toBe(true);
  });

  it("matches amount with commas", () => {
    expect(matchesWorkspaceItem(sampleItem, "25,000")).toBe(true);
    expect(matchesWorkspaceItem(sampleItem, "25,000.50")).toBe(true);
  });

  it("matches decimal fraction", () => {
    expect(matchesWorkspaceItem(sampleItem, "0.50")).toBe(true);
  });

  it("matches ref / document number case-insensitively", () => {
    expect(matchesWorkspaceItem(sampleItem, "inv-2026")).toBe(true);
    expect(matchesWorkspaceItem(sampleItem, "0801")).toBe(true);
  });

  it("matches description", () => {
    expect(matchesWorkspaceItem(sampleItem, "พัฒนาระบบ")).toBe(true);
  });

  it("matches senderInfo and senderHint", () => {
    expect(matchesWorkspaceItem(sampleItem, "กสิกร")).toBe(true);
    expect(matchesWorkspaceItem(sampleItem, "สมชาย")).toBe(true);
    expect(matchesWorkspaceItem(sampleItem, "56789")).toBe(true);
  });

  it("matches date in ISO and DMY format", () => {
    expect(matchesWorkspaceItem(sampleItem, "2026-08-01")).toBe(true);
    expect(matchesWorkspaceItem(sampleItem, "01/08/2026")).toBe(true);
    expect(matchesWorkspaceItem(sampleItem, "01/08")).toBe(true);
  });

  it("matches multi-token queries when all tokens match", () => {
    expect(matchesWorkspaceItem(sampleItem, "สมชาย 25000")).toBe(true);
    expect(matchesWorkspaceItem(sampleItem, "กสิกร 01/08 25,000")).toBe(true);
    expect(matchesWorkspaceItem(sampleItem, "สมชาย 99999")).toBe(false);
  });

  it("returns false when query does not match any field", () => {
    expect(matchesWorkspaceItem(sampleItem, "ธนาคารกรุงเทพ")).toBe(false);
    expect(matchesWorkspaceItem(sampleItem, "999999")).toBe(false);
  });
});
