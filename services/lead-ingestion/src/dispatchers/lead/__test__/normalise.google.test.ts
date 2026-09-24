import { describe, it, expect } from "vitest";
import { parseFieldDataLead } from "#dispatchers/lead/normalise";

describe("parseFieldDataLead (Google answers)", () => {
  it("maps known labels to typed properties and preserves unknowns", () => {
    const lead = parseFieldDataLead({
      id: "resp_1",
      created_time: "2026-07-02T10:00:00.000Z",
      field_data: [
        { name: "Full Name", values: ["Mario Rossi"] },
        { name: "Email", values: ["mario@example.com"] },
        { name: "Phone", values: ["+39 333 1112223"] },
        { name: "Company", values: ["Acme Srl"] },
        { name: "Message", values: ["Interested in a demo"] },
        { name: "Budget", values: ["5000"] },
      ],
    });

    expect(lead.leadId).toBe("resp_1");
    expect(lead.fullName).toBe("Mario Rossi");
    expect(lead.email).toBe("mario@example.com");
    expect(lead.phoneNumber).toBe("+39 333 1112223");
    expect(lead.companyName).toBe("Acme Srl");
    expect(lead.message).toBe("Interested in a demo");
    expect(lead.customFields).toEqual({ Budget: "5000" });
  });

  it("skips empty and placeholder values", () => {
    const lead = parseFieldDataLead({
      id: "resp_2",
      field_data: [
        { name: "Email", values: [""] },
        { name: "Notes", values: ["n/a"] },
      ],
    });

    expect(lead.email).toBeUndefined();
    expect(lead.message).toBeUndefined();
    expect(lead.customFields).toEqual({});
  });
});

describe("parseFieldDataLead: split names", () => {
  const parse = (fields: [string, string][]) =>
    parseFieldDataLead({
      id: "r",
      field_data: fields.map(([name, value]) => ({ name, values: [value] })),
    });

  it("joins first and last name instead of keeping only the last one seen", () => {
    expect(
      parse([
        ["first_name", "Mario"],
        ["last_name", "Rossi"],
      ]).fullName,
    ).toBe("Mario Rossi");
  });

  it("orders the parts first-last whatever order the form used", () => {
    expect(
      parse([
        ["Cognome", "Rossi"],
        ["Nome", "Mario"],
      ]).fullName,
    ).toBe("Mario Rossi");
  });

  it("handles Spanish and Polish split labels", () => {
    expect(parse([["nombre", "Ana"], ["apellidos", "Garcia Lopez"]]).fullName).toBe(
      "Ana Garcia Lopez",
    );
    expect(parse([["imię", "Jan"], ["nazwisko", "Kowalski"]]).fullName).toBe(
      "Jan Kowalski",
    );
  });

  it("prefers an explicit full name over the parts", () => {
    expect(
      parse([
        ["first_name", "Mario"],
        ["full_name", "Mario Rossi Bianchi"],
        ["last_name", "Rossi"],
      ]).fullName,
    ).toBe("Mario Rossi Bianchi");
  });

  it("falls back to whichever part is present", () => {
    expect(parse([["surname", "Rossi"]]).fullName).toBe("Rossi");
    expect(parse([["first name", "Mario"]]).fullName).toBe("Mario");
  });
});
