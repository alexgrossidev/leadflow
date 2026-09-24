import { describe, it, expect } from "vitest";
import { scoreLead } from "../google.score";
import type { Lead } from "../../fbLead/lead.schema";

const lead = (over: Partial<Lead> = {}): Lead => ({
  leadId: "r1",
  customFields: {},
  ...over,
});

describe("scoreLead", () => {
  it("passes a clean, contactable lead with no flags", () => {
    const r = scoreLead(
      lead({
        fullName: "Mario Rossi",
        email: "mario@example.com",
        phoneNumber: "+39 333 1112223",
        message: "I'd like a demo",
      }),
    );
    expect(r).toEqual({ drop: false, reasons: [], flags: [] });
  });

  it("drops a lead with no contactable channel", () => {
    const r = scoreLead(lead({ message: "hello" }));
    expect(r.drop).toBe(true);
    expect(r.reasons).toContain("no_contact");
  });

  it("drops when the only email is disposable and there is no valid phone", () => {
    const r = scoreLead(lead({ email: "spam@mailinator.com" }));
    expect(r.drop).toBe(true);
    expect(r.reasons).toContain("uncontactable");
  });

  it("drops a link-stuffed message", () => {
    const r = scoreLead(
      lead({
        email: "mario@example.com",
        message: "http://a.com http://b.com https://c.com buy now",
      }),
    );
    expect(r.drop).toBe(true);
    expect(r.reasons).toContain("link_spam");
  });

  it("delivers a disposable-email lead that has a valid phone, flagged", () => {
    const r = scoreLead(
      lead({ email: "x@mailinator.com", phoneNumber: "3331112223" }),
    );
    expect(r.drop).toBe(false);
    expect(r.flags).toContain("disposable_email");
  });

  it("flags (but keeps) a lead with a couple of links", () => {
    const r = scoreLead(
      lead({ email: "mario@example.com", message: "see www.site.com" }),
    );
    expect(r.drop).toBe(false);
    expect(r.flags).toContain("links_in_message");
  });
});
