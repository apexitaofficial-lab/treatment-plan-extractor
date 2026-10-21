// Procedure codes the office tracks: crowns/core buildups, partial dentures and
// periodontal scaling. Patients with any of these are highlighted and counted.
export const TARGET_CODES = ["D2740", "D2950", "D5211", "D5212", "D5213", "D5214", "D4341", "D4342"] as const;

const TARGET_SET: ReadonlySet<string> = new Set(TARGET_CODES);

/** Splits a stored code list ("D0120, D2740") into individual codes. */
export function splitCodes(value: string): string[] {
  return value.split(/[\s,;]+/).filter(Boolean);
}

/** Exact, case-insensitive match: "D2740" matches, "D27400" or "D2740Z" do not. */
export function isTargetCode(code: string): boolean {
  return TARGET_SET.has(code.trim().toUpperCase());
}

export function hasTargetCode(codes: string): boolean {
  return splitCodes(codes).some(isTargetCode);
}
