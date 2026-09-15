export type CustomerCandidate = {
  id: string; name: string; email?: string | null; phone?: string | null;
  trn?: string | null; is_active?: boolean;
};
export type CustomerDuplicate = { id: string; name: string; active: boolean; reasons: string[] };

const nameKey = (text: string) => text.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
const emailKey = (text: string) => text.trim().toLocaleLowerCase("en");
const phoneKey = (text: string) => text.replace(/\D/g, "");
const trnKey = (text: string) => text.replace(/\s/g, "").toLocaleUpperCase("en");

/** Advisory only: the ordinary Customer domain remains authoritative on creation. */
export function likelyCustomerDuplicates(input: {
  name: string; email?: string; phone?: string; trn?: string;
}, candidates: readonly CustomerCandidate[]): CustomerDuplicate[] {
  const n = nameKey(input.name), e = emailKey(input.email || ""), p = phoneKey(input.phone || ""), t = trnKey(input.trn || "");
  return candidates.flatMap((candidate) => {
    const reasons: string[] = [];
    if (n && nameKey(candidate.name) === n) reasons.push("name");
    if (e && emailKey(candidate.email || "") === e) reasons.push("email");
    if (p && phoneKey(candidate.phone || "") === p) reasons.push("phone");
    if (t && trnKey(candidate.trn || "") === t) reasons.push("TRN");
    return reasons.length ? [{ id: candidate.id, name: candidate.name,
      active: candidate.is_active !== false, reasons }] : [];
  }).slice(0, 5);
}
