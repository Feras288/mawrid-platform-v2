import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, hashObject } from "../src/crypto";
import { isUuid, uuidv7 } from "../src/ids";
import { defineMachine } from "../src/state-machine";

describe("ids", () => {
  it("generates time-ordered v7 uuids", () => {
    const a = uuidv7(1000);
    const b = uuidv7(2000);
    expect(isUuid(a)).toBe(true);
    expect(a[14]).toBe("7");
    expect(a < b).toBe(true);
  });
});

describe("crypto", () => {
  it("round-trips secrets and detects tampering", () => {
    const key = "k".repeat(40);
    const enc = encryptSecret("s3cr3t", key);
    expect(enc).not.toContain("s3cr3t");
    expect(decryptSecret(enc, key)).toBe("s3cr3t");
    const parts = enc.split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decryptSecret(parts.join(":"), key)).toThrow();
  });
  it("hashes objects independent of key order", () => {
    expect(hashObject({ a: 1, b: [1, 2] })).toBe(hashObject({ b: [1, 2], a: 1 }));
  });
});

describe("state machine", () => {
  const m = defineMachine({ name: "t", states: ["a", "b", "c"] as const, transitions: { a: ["b"], b: ["c"], c: [] }, terminal: ["c"] });
  it("allows declared transitions only", () => {
    expect(m.can("a", "b")).toBe(true);
    expect(m.can("a", "c")).toBe(false);
    expect(() => m.assert("c", "a")).toThrow(/not allowed/);
  });
});
