import { describe, expect, it } from "vitest";
import { errorSerializer } from "../logger/serializers";

describe("errorSerializer", () => {
  it("drops bound query parameters but keeps the SQL shape", () => {
    const err = new Error(
      "Failed query: insert into `leads` (`email`, `phone`) values (?, ?)\nparams: alice@example.com,+393331234567",
    );
    const out = errorSerializer(err) as { message: string; stack: string };
    expect(out.message).toContain("insert into `leads`");
    expect(out.message).not.toContain("alice@example.com");
    expect(out.stack).not.toContain("+393331234567");
  });

  it("passes non-errors through untouched", () => {
    expect(errorSerializer("plain")).toBe("plain");
  });
});
