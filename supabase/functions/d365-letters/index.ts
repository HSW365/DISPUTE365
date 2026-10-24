import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// DISPUTE365 letter engine. Letters are built server-side so the paywall is real.
// POST {profile, items:[{letter, creditor, mask, bureau, reason, address, amount, dofd, balance, notes}]}
// Nothing sent here is stored.
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const BUREAUS: Record<string, string[]> = {
  experian: ["Experian", "P.O. Box 4500", "Allen, TX 75013"],
  transunion: ["TransUnion Consumer Solutions", "P.O. Box 2000", "Chester, PA 19016-2000"],
  equifax: ["Equifax Information Services LLC", "P.O. Box 740256", "Atlanta, GA 30374-0256"],
};
const BASIC = ["bureau", "obsolete", "inquiry"];
const PRO = ["furnisher", "validation", "goodwill", "paydelete", "mov", "cfpb"];

const REASONS: Record<string, string> = {
  notmine: "This account does not belong to me. I never opened it and never authorized anyone to open it in my name.",
  balance: "The balance reported is inaccurate and does not reflect what is actually owed.",
  late: "The late payment(s) reported on this account are inaccurate. The payment history does not match my records.",
  status: "The account status is reported inaccurately. The account has been paid or closed and is not reported that way.",
  duplicate: "This debt is reported more than once on my file, which overstates my obligations and damages my credit unfairly.",
  dates: "The dates reported on this account, including the date of first delinquency, are inaccurate.",
  incomplete: "The information reported is incomplete and cannot be verified as accurate. Reporting unverifiable information violates the FCRA.",
  ownership: "This account was transferred or sold and is still reported as owed to the original creditor, which misstates who holds the debt.",
};

type P = Record<string, string>;
type I = Record<string, string>;
const s = (v: unknown, n = 160) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
const today = () => new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
const money = (v: string) => { const n = Number(String(v).replace(/[^\d.]/g, "")); return n ? "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""; };

function sender(p: P) {
  return [p.name, p.addr1, p.addr2, [p.city, p.state].filter(Boolean).join(", ") + (p.zip ? " " + p.zip : ""), p.phone, p.email].filter((x) => x && x.trim()).join("\n");
}
function idLines(p: P) {
  const l: string[] = [];
  if (p.dob) l.push("Date of birth: " + p.dob);
  if (p.ssn4) l.push("SSN (last four): XXX-XX-" + p.ssn4);
  return l.join("\n");
}
function acct(i: I) {
  return [`Creditor / furnisher: ${i.creditor}`, i.mask ? `Account number: ${i.mask}` : "", i.balance ? `Reported balance: ${money(i.balance)}` : ""].filter(Boolean).join("\n");
}
function close(p: P, enc: string[]) {
  return `Sincerely,\n\n\n${p.name}\n\nEnclosures:\n${enc.map((e) => "- " + e).join("\n")}`;
}
const ID_ENC = ["Copy of government-issued photo ID", "Copy of a utility bill or bank statement showing my current address"];

function build(letter: string, i: I, p: P) {
  const b = BUREAUS[i.bureau] ?? null;
  const reason = REASONS[i.reason] ?? REASONS.incomplete;
  const to = (lines: string[]) => lines.filter(Boolean).join("\n");
  const custom = i.address ? i.address.split(/\n|,\s*(?=\d|P\.?O)/).map((x) => x.trim()).filter(Boolean) : [i.creditor, "[Mailing address from your credit report]"];
  if (!b && ["bureau", "obsolete", "inquiry", "mov"].includes(letter)) throw new Error(`Pick a bureau for ${i.creditor}.`);

  switch (letter) {
    case "bureau":
      return { title: `Dispute — ${i.creditor} — ${b![0]}`, to: to(b!), subject: "Request for reinvestigation under FCRA Section 611 (15 U.S.C. § 1681i)",
        body: `I am writing to dispute the following information in my credit file. I have identified the item below and the reason it is inaccurate.\n\n${acct(i)}\n\nReason for dispute: ${reason}${i.notes ? "\n\nAdditional detail: " + s(i.notes, 600) : ""}\n\nUnder Section 611 of the Fair Credit Reporting Act, you are required to conduct a reasonable reinvestigation of this information within 30 days of receiving this letter and to forward all relevant information I have provided to the furnisher. If the information cannot be verified as accurate and complete, it must be promptly deleted or corrected under 15 U.S.C. § 1681i(a)(5)(A).\n\nPlease send me written results of your reinvestigation and an updated copy of my credit report. If the item is verified, I request a description of the procedure used to determine its accuracy, including the name, address and telephone number of the furnisher contacted, as provided by 15 U.S.C. § 1681i(a)(6)(B)(iii) and § 1681i(a)(7).`,
        enc: ID_ENC };
    case "obsolete":
      return { title: `Obsolete item — ${i.creditor} — ${b![0]}`, to: to(b!), subject: "Removal of obsolete information under FCRA Section 605 (15 U.S.C. § 1681c)",
        body: `The following account is being reported beyond the time allowed by federal law.\n\n${acct(i)}${i.dofd ? `\nDate of first delinquency: ${s(i.dofd, 30)}` : ""}\n\nSection 605(a) of the Fair Credit Reporting Act prohibits reporting accounts placed for collection, charged off, or other adverse items that antedate the report by more than seven years. Under Section 605(c), that seven-year period runs from 180 days after the date of first delinquency.\n\nThis item has passed that limit. Please delete it from my file within 30 days and send me written confirmation along with an updated copy of my credit report.`,
        enc: ID_ENC };
    case "inquiry":
      return { title: `Unauthorized inquiry — ${i.creditor} — ${b![0]}`, to: to(b!), subject: "Dispute of unauthorized hard inquiry — FCRA Sections 604 and 611",
        body: `My credit report shows a hard inquiry I did not authorize.\n\nInquiring company: ${i.creditor}${i.dofd ? `\nDate of inquiry: ${s(i.dofd, 30)}` : ""}\n\nI did not apply for credit with this company and did not give it permission to access my report. Section 604 of the Fair Credit Reporting Act (15 U.S.C. § 1681b) allows a consumer report to be furnished only for a permissible purpose. Please reinvestigate under Section 611. If ${i.creditor} cannot show a permissible purpose and my written authorization, remove this inquiry and send me an updated copy of my report.`,
        enc: ID_ENC };
    case "mov":
      return { title: `Method of verification — ${i.creditor} — ${b![0]}`, to: to(b!), subject: "Request for method of verification — FCRA Section 611(a)(7)",
        body: `I previously disputed the item below. Your response stated it was verified, but I have not received a description of how that verification was done.\n\n${acct(i)}\n\nUnder 15 U.S.C. § 1681i(a)(7), I am entitled to a description of the procedure used to determine the accuracy and completeness of this information, including the business name, address and telephone number of any furnisher you contacted, within 15 days of this request.\n\nA response that only confirms data matched the furnisher's file is not a reasonable reinvestigation. If you cannot document a reasonable reinvestigation, delete the item and send me an updated report.`,
        enc: [...ID_ENC, "Copy of your previous reinvestigation results"] };
    case "furnisher":
      return { title: `Direct dispute — ${i.creditor}`, to: to(custom), subject: "Direct dispute under FCRA Section 623(a)(8) and 12 C.F.R. § 1022.43",
        body: `I am disputing information your company is reporting about me to the consumer reporting agencies.\n\n${acct(i)}\n\nReason for dispute: ${reason}${i.notes ? "\n\nAdditional detail: " + s(i.notes, 600) : ""}\n\nUnder Section 623(a)(8) of the Fair Credit Reporting Act (15 U.S.C. § 1681s-2(a)(8)) and Regulation V, 12 C.F.R. § 1022.43, you must investigate this dispute, review all relevant information I have provided, and report the results to me within 30 days. If the information is inaccurate or cannot be verified, you must notify every consumer reporting agency you reported it to and have it corrected or deleted.\n\nUntil this dispute is resolved, any further reporting of this account must note that it is disputed by the consumer, as required by 15 U.S.C. § 1681s-2(a)(3).`,
        enc: ID_ENC };
    case "validation":
      return { title: `Debt validation — ${i.creditor}`, to: to(custom), subject: "Request for validation of debt — FDCPA Section 809 (15 U.S.C. § 1692g)",
        body: `I am responding to your attempt to collect the following debt. I dispute it and request validation.\n\n${acct(i)}\n\nUnder the Fair Debt Collection Practices Act and Regulation F (12 C.F.R. § 1006.34 and § 1006.38), please provide:\n\n1. The name of the original creditor and the account number with that creditor.\n2. An itemization of the amount claimed, including interest, fees and payments since the itemization date.\n3. Documentation showing your company owns this debt or is authorized to collect it.\n4. A copy of any signed agreement that created the obligation.\n\nIf I sent this request within your validation period, you must stop collection until you mail me this verification. If you report this account to any credit bureau, Section 807(8) of the FDCPA (15 U.S.C. § 1692e(8)) requires you to report it as disputed. If you cannot validate the debt, delete it from all credit reports you have furnished.\n\nThis letter is not an acknowledgment that I owe this debt.`,
        enc: ["Copy of your collection notice, if available"] };
    case "goodwill":
      return { title: `Goodwill request — ${i.creditor}`, to: to(custom), subject: "Goodwill adjustment request",
        body: `I am writing about my account with ${i.creditor}${i.mask ? ", account number " + i.mask : ""}. I value this account and want to ask for your help with one thing.\n\nMy credit report shows a late payment on this account. ${i.notes ? s(i.notes, 600) + " " : ""}It was out of character for me, and I have worked to keep the account in good standing since.\n\nAs a gesture of goodwill, I respectfully ask that you remove the late payment notation from the reports you send to Experian, TransUnion and Equifax. I understand you are not obligated to do this, and I appreciate you considering it.\n\nThank you for your time.`,
        enc: [] };
    case "paydelete": {
      const amt = money(i.amount);
      return { title: `Settlement offer — ${i.creditor}`, to: to(custom), subject: "Offer to resolve account in exchange for deletion",
        body: `I am writing about the following account, which your company is reporting to the credit bureaus.\n\n${acct(i)}\n\nI am prepared to pay ${amt || "[amount]"} to resolve this account in full. In exchange, your company agrees to request deletion of this tradeline from Experian, TransUnion and Equifax within 30 days of receiving payment.\n\nThis offer depends on your written agreement to these terms on your company letterhead before any payment is made. Payment will be sent within 10 days of receiving that signed agreement.\n\nThis letter is not an acknowledgment that I owe this debt, and it does not restart any statute of limitations.`,
        enc: [] };
    }
    case "cfpb":
      return { title: `CFPB complaint — ${i.creditor}`, to: "Consumer Financial Protection Bureau\nSubmit online at consumerfinance.gov/complaint", subject: `Complaint against ${i.creditor}${b ? " and " + b[0] : ""}`,
        body: `What happened:\nI disputed inaccurate information reported by ${i.creditor}${b ? " on my " + b[0] + " report" : ""}.\n\n${acct(i)}\n\nReason the information is wrong: ${reason}${i.notes ? "\n" + s(i.notes, 600) : ""}\n\nThe company did not correct or delete the information, and did not provide a description of a reasonable investigation. This is required under the Fair Credit Reporting Act, 15 U.S.C. § 1681i and § 1681s-2.\n\nWhat I want:\nCorrection or deletion of the inaccurate item, an updated report, and a written explanation of how my dispute was investigated.`,
        enc: ["Copies of my dispute letters and certified mail receipts", "Any responses I received"] };
  }
  throw new Error("Unknown letter type.");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: auth } = await db.auth.getUser(token);
    const user = auth?.user;
    if (!user) return json({ error: "Sign in to generate letters." }, 401);
    const { data: m } = await db.from("d365_members").select("plan, paid_until, comp").eq("id", user.id).maybeSingle();
    const active = !!m && (m.comp || (m.paid_until && new Date(m.paid_until).getTime() > Date.now()));
    if (!active) return json({ error: "subscribe" }, 402);
    const plan = m!.comp ? "pro" : m!.plan;

    const b = await req.json().catch(() => ({}));
    const raw: P = b.profile ?? {};
    const p: P = {};
    for (const k of ["name", "addr1", "addr2", "city", "state", "zip", "phone", "email", "dob"]) p[k] = s(raw[k], 120);
    p.ssn4 = String(raw.ssn4 ?? "").replace(/\D/g, "").slice(-4);
    if (!p.name || !p.addr1 || !p.city || !p.state || !p.zip) return json({ error: "Add your full name and mailing address first." }, 400);
    const items: I[] = Array.isArray(b.items) ? b.items.slice(0, 60) : [];
    if (!items.length) return json({ error: "Select at least one item." }, 400);

    const letters = [];
    for (const r of items) {
      const i: I = {};
      for (const k of ["letter", "creditor", "mask", "bureau", "reason", "amount", "dofd", "balance"]) i[k] = s(r[k], 120);
      i.address = s(r.address, 240); i.notes = s(r.notes, 600);
      if (!i.creditor) continue;
      if (!BASIC.includes(i.letter) && !PRO.includes(i.letter)) return json({ error: "Unknown letter type." }, 400);
      if (PRO.includes(i.letter) && plan !== "pro") return json({ error: "pro" }, 402);
      const L = build(i.letter, i, p);
      const head = `${sender(p)}\n${idLines(p)}\n\n${today()}\n\n${L.to}\n\nRe: ${L.subject}`;
      letters.push({ title: L.title, letter: i.letter, bureau: i.bureau, creditor: i.creditor, mask: i.mask,
        text: `${head}\n\nTo whom it may concern,\n\n${L.body}\n\n${L.enc.length ? close(p, L.enc) : `Sincerely,\n\n\n${p.name}`}` });
    }
    return json({ plan, letters });
  } catch (e) { return json({ error: (e as Error).message }, 400); }
});
