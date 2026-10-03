#!/usr/bin/env bash
# Uji E2E NR-19-e — event webhook baru (offer.sent / interview.scheduled / interview.completed)
# Metode: endpoint uji didaftarkan via API dengan URL yang sengaja tidak bisa dihubungi
# (http://127.0.0.1:59999 — koneksi langsung ditolak, tanpa jaringan eksternal), sehingga
# setiap percobaan pengiriman TERLIHAT di dev.log lewat log observabilitas "[webhooks]".
set -u
cd /home/z/my-project
BASE="http://localhost:3000"
JAR=/tmp/nr19e.jar
LOG=dev.log
HOOK_A="http://127.0.0.1:59999/hook-a"   # berlangganan 3 event baru
HOOK_B="http://127.0.0.1:59999/hook-b"   # berlangganan application.created saja (kontrol negatif)

echo "== 0. Mark waktu mulai uji =="
date -u +"%Y-%m-%dT%H:%M:%S.000Z" | tee /tmp/nr19e-started-at.txt
MARK_WEBHOOK_LOGS=$(grep -c "\[webhooks\]" "$LOG" 2>/dev/null); MARK_WEBHOOK_LOGS=${MARK_WEBHOOK_LOGS:-0}
echo "Baseline baris [webhooks] di dev.log: $MARK_WEBHOOK_LOGS"

echo "== 1. Login admin =="
curl -s -c "$JAR" -X POST "$BASE/api/admin/login" -H 'Content-Type: application/json' \
  -d '{"email":"admin@lumina.id","password":"admin123"}' | jq -c '{ok, role: .user.role}'

echo "== 2. Dump state awal target uji =="
bun run .zscripts/test-nr19e-dump.ts 2>/dev/null
RIZKY=$(jq -r '.rizky.id' /tmp/nr19e-before.json)
BAGAS=$(jq -r '.bagas.id' /tmp/nr19e-before.json)
CODE_BAGAS=$(jq -r '.bagas.trackingCode' /tmp/nr19e-before.json)
POS_BAGAS=$(jq -r '.bagas.positionId' /tmp/nr19e-before.json)
echo "rizky=$RIZKY bagas=$BAGAS posBagas=$POS_BAGAS"

echo "== 3. Daftarkan 2 endpoint webhook uji =="
EP_A=$(curl -s -b "$JAR" -X POST "$BASE/api/admin/webhooks" -H 'Content-Type: application/json' \
  -d "{\"url\":\"$HOOK_A\",\"events\":[\"offer.sent\",\"interview.scheduled\",\"interview.completed\"]}" | jq -r '.endpoint.id')
EP_B=$(curl -s -b "$JAR" -X POST "$BASE/api/admin/webhooks" -H 'Content-Type: application/json' \
  -d "{\"url\":\"$HOOK_B\",\"events\":[\"application.created\"]}" | jq -r '.endpoint.id')
echo "EP_A(subs 3 event baru)=$EP_A  EP_B(subs application.created, kontrol negatif)=$EP_B"

echo "== 4. POST offer ke Rizky (belum punya offer) → emit offer.sent =="
SCHED_AT=$(date -u -d "+2 days" +"%Y-%m-%dT05:00:00.000Z")
OFFER=$(curl -s -w '\n%{http_code}' -b "$JAR" -X POST "$BASE/api/admin/applications/$RIZKY/offer" -H 'Content-Type: application/json' \
  -d '{"salary":"Rp 8.500.000","type":"Full-time","deadlineDays":3}')
echo "HTTP $(echo "$OFFER" | tail -1) | offerStatus=$(echo "$OFFER" | head -1 | jq -r '.application.offerStatus')"

echo "== 5. POST interview untuk Bagas → emit interview.scheduled =="
IV=$(curl -s -w '\n%{http_code}' -b "$JAR" -X POST "$BASE/api/admin/interviews" -H 'Content-Type: application/json' \
  -d "{\"applicationId\":\"$BAGAS\",\"scheduledAt\":\"$SCHED_AT\",\"mode\":\"ONLINE\",\"platform\":\"ZOOM\",\"meetingLink\":\"https://zoom.example/j/uji-nr19e\",\"durationMin\":45,\"interviewers\":[\"Pewawancara Uji\"]}")
IV_ID=$(echo "$IV" | head -1 | jq -r '.id')
echo "HTTP $(echo "$IV" | tail -1) | interviewId=$IV_ID status=$(echo "$IV" | head -1 | jq -r '.status')"

echo "== 6. PATCH interview → COMPLETED (emit sekali), PATCH ulang (TIDAK boleh emit lagi) =="
DONE1=$(curl -s -w '\n%{http_code}' -b "$JAR" -X PATCH "$BASE/api/admin/interviews/$IV_ID" -H 'Content-Type: application/json' -d '{"status":"COMPLETED"}')
echo "HTTP $(echo "$DONE1" | tail -1) | interviewStatus=$(echo "$DONE1" | head -1 | jq -r '.interview.status')"
curl -s -o /dev/null -b "$JAR" -X PATCH "$BASE/api/admin/interviews/$IV_ID" -H 'Content-Type: application/json' -d '{"status":"COMPLETED"}'
echo "PATCH ulang status COMPLETED dikirim (harus TIDAK menambah emit)"

echo "== 7. Slot publik dipilih pelamar → emit interview.scheduled (actor Pelamar) =="
SLOT_AT=$(date -u -d "+3 days" +"%Y-%m-%dT06:00:00.000Z")
SLOT=$(curl -s -b "$JAR" -X POST "$BASE/api/admin/slots" -H 'Content-Type: application/json' \
  -d "{\"positionId\":\"$POS_BAGAS\",\"scheduledAt\":\"$SLOT_AT\",\"durationMin\":45,\"mode\":\"ONLINE\",\"platform\":\"ZOOM\",\"meetingLink\":\"https://meet.example/uji-nr19e\"}")
SLOT_ID=$(echo "$SLOT" | jq -r '.id')
BOOK=$(curl -s -X POST "$BASE/api/public/slots/book" -H 'Content-Type: application/json' -d "{\"code\":\"$CODE_BAGAS\",\"slotId\":\"$SLOT_ID\"}")
echo "slotId=$SLOT_ID | book=$(echo "$BOOK" | jq -c .)"
IV2_ID=$(curl -s -b "$JAR" "$BASE/api/admin/interviews" | jq -r --arg app "$BAGAS" '[.[] | select(.applicationId==$app and .status=="SCHEDULED")][0].id')
echo "Interview dari slot booking (SCHEDULED, milik Bagas): $IV2_ID"

echo "== 8. Tunggu fire-and-forget selesai =="
sleep 4

echo "== 9. BUKTI dev.log — baris [webhooks] baru sejak baseline =="
grep "\[webhooks\]" "$LOG" | grep -v "emitWebhook gagal" | tail -n +$((MARK_WEBHOOK_LOGS + 1)) | tee /tmp/nr19e-webhook-lines.txt
N_OFFER=$(grep -c "\[webhooks\] offer.sent" /tmp/nr19e-webhook-lines.txt || true)
N_SCHED=$(grep -c "\[webhooks\] interview.scheduled" /tmp/nr19e-webhook-lines.txt || true)
N_DONE=$(grep -c "\[webhooks\] interview.completed" /tmp/nr19e-webhook-lines.txt || true)
N_B=$(grep -c "hook-b" /tmp/nr19e-webhook-lines.txt || true)
echo "Hitung: offer.sent=$N_OFFER (harapan 1) | interview.scheduled=$N_SCHED (harapan 2: admin+slot) | interview.completed=$N_DONE (harapan 1, PATCH ulang tidak memicu) | hook-b=$N_B (harapan 0)"

echo "== 10. Endpoint status via API (bukti lastFiredAt/lastStatus) =="
curl -s -b "$JAR" "$BASE/api/admin/webhooks" | jq -c '[.[] | {url, events, lastStatus, lastFiredAt, failCount}]'

echo "== 11. Route /api/admin/webhook-test dengan body event =="
curl -s -b "$JAR" -X POST "$BASE/api/admin/webhook-test" -H 'Content-Type: application/json' \
  -d '{"event":"offer.sent"}' | jq -c '{discord, telegram, webhook: (.webhook | {event, targetCount, targets, sample})}'
echo "-- event tidak dikenal harus 400:"
curl -s -o /dev/null -w '%{http_code}\n' -b "$JAR" -X POST "$BASE/api/admin/webhook-test" -H 'Content-Type: application/json' -d '{"event":"tidak.ada"}'
echo "-- (catatan) /api/admin/webhooks/test (tombol Tes di data-tab):"
curl -s -o /dev/null -w '%{http_code}\n' -b "$JAR" -X POST "$BASE/api/admin/webhooks/test" -H 'Content-Type: application/json' -d '{}'

echo "== 12. Simpan ID uji untuk cleanup =="
jq -n --arg epA "$EP_A" --arg epB "$EP_B" --arg iv "$IV_ID" --arg iv2 "$IV2_ID" --arg slot "$SLOT_ID" \
  --arg appR "$RIZKY" --arg appB "$BAGAS" --rawfile started /tmp/nr19e-started-at.txt \
  '{epA: $epA, epB: $epB, interviews: [$iv, $iv2], slotId: $slot, apps: [$appR, $appB], startedAt: ($started | gsub("\n"; ""))}' \
  > /tmp/nr19e-test-ids.json
cat /tmp/nr19e-test-ids.json
echo "SELESAI — jalankan: bun run .zscripts/test-nr19e-cleanup.ts"
