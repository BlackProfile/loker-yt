// Dump state awal pelamar target uji NR-19-e sebelum E2E (dipakai script cleanup).
// Output: /tmp/nr19e-before.json
import { db } from "../src/lib/db";
import { writeFileSync } from "fs";

const rizky = await db.application.findFirst({
  where: { trackingCode: "LM-49NURB" },
  select: {
    id: true, name: true, trackingCode: true, status: true, positionId: true,
    offerStatus: true, offerType: true, offerSalary: true, offerStartDate: true,
    offerNote: true, offerDeadline: true, offerSentAt: true, offerRespondedAt: true,
    offerDeclineReason: true, interviewAt: true,
  },
});
const bagas = await db.application.findFirst({
  where: { trackingCode: "LM-KFLHLV" },
  select: {
    id: true, name: true, trackingCode: true, status: true, positionId: true,
    offerStatus: true, offerType: true, offerSalary: true, offerStartDate: true,
    offerNote: true, offerDeadline: true, offerSentAt: true, offerRespondedAt: true,
    offerDeclineReason: true, interviewAt: true,
  },
});
if (!rizky || !bagas) {
  console.error("FATAL: pelamar seed (LM-49NURB / LM-KFLHLV) tidak ditemukan.");
  process.exit(1);
}
writeFileSync("/tmp/nr19e-before.json", JSON.stringify({ rizky, bagas }, null, 1));
console.log("before-state tersimpan: rizky=", rizky.id, "bagas=", bagas.id, "posBagas=", bagas.positionId);
process.exit(0);
