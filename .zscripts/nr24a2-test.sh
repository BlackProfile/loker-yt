#!/usr/bin/env bash
# NR-24-a2 — Uji E2E 11 route baru "fitur per pelamar":
# calls, assessments (+[id]), internal-docs (+[id]), inbox, history, undo-reject, merge, donothire, tags.
# Prasyarat: bun run .zscripts/nr24a2-setup.ts (snapshot + data uji).
# Cleanup: bun run .zscripts/nr24a2-cleanup.ts (pulihkan snapshot, hapus jejak uji).
set -u
BASE="http://localhost:3000"
JAR="/tmp/nr24a2-cookies.txt"
VJAR="/tmp/nr24a2-viewer.txt"
SNAP="/home/z/my-project/.zscripts/nr24a2-snapshot.json"
rm -f "$JAR" "$VJAR"
PASS=0; FAIL=0

check() { # $1=nama $2=OK/BAD
  if [ "$2" = "OK" ]; then PASS=$((PASS+1)); echo "PASS: $1";
  else FAIL=$((FAIL+1)); echo "FAIL: $1 ($2)"; fi
}

req() { # $1=method $2=url $3=body(optional) — pakai jar admin
  local m="$1" u="$2" b="${3:-}"
  if [ -n "$b" ]; then
    curl -s -b "$JAR" -c "$JAR" -X "$m" -H "Content-Type: application/json" -d "$b" -o /tmp/nr24a2-out.json -w "%{http_code}" "$u" > /tmp/nr24a2-code.txt
  else
    curl -s -b "$JAR" -c "$JAR" -X "$m" -o /tmp/nr24a2-out.json -w "%{http_code}" "$u" > /tmp/nr24a2-code.txt
  fi
}
code() { tail -n1 /tmp/nr24a2-code.txt; }
py() { J=/tmp/nr24a2-out.json python3 -c "import json, os; $1"; }

# ---- 0. Login ----
C=$(curl -s -c "$JAR" -X POST -H "Content-Type: application/json" -d '{"email":"admin@lumina.id","password":"admin123"}' -o /dev/null -w "%{http_code}" "$BASE/api/admin/login")
check "login OWNER 200 (got $C)" "$([ "$C" = "200" ] && echo OK || echo BAD)"
C=$(curl -s -c "$VJAR" -X POST -H "Content-Type: application/json" -d '{"email":"viewer@lumina.id","password":"admin123"}' -o /dev/null -w "%{http_code}" "$BASE/api/admin/login")
check "login VIEWER 200 (got $C)" "$([ "$C" = "200" ] && echo OK || echo BAD)"

DEWI=$(python3 -c "
import json
s=json.load(open('$SNAP'))
print([a['id'] for a in s['apps'] if a['id']=='cmus1l9c8000hl2urmrky8fg2'][0])")
TEMP=$(python3 -c "import json; print(json.load(open('$SNAP'))['tempAppId'])")
check "id Dewi & lamaran uji terbaca ($DEWI / $TEMP)" "$([ -n "$DEWI" ] && [ -n "$TEMP" ] && echo OK || echo BAD)"

# ---- 1. Autentikasi ----
C=$(curl -s -o /tmp/nr24a2-out.json -w "%{http_code}" "$BASE/api/admin/applications/$DEWI/calls")
check "GET calls tanpa login -> 401 (got $C)" "$([ "$C" = "401" ] && echo OK || echo BAD)"
ERR=$(py 'print(json.load(open(os.environ["J"])).get("error",""))')
check "401 pesan Indonesia silakan login ($ERR)" "$([ "$ERR" = "Silakan login terlebih dahulu." ] && echo OK || echo BAD)"

# ---- 2. CALLS ----
req GET "$BASE/api/admin/applications/$DEWI/calls"
check "GET calls awal 200 (got $(code))" "$([ "$(code)" = "200" ] && echo OK || echo BAD)"
N=$(py 'print(len(json.load(open(os.environ["J"])).get("calls",[])))')
check "GET calls awal kosong ($N)" "$([ "$N" = "0" ] && echo OK || echo BAD)"

req POST "$BASE/api/admin/applications/$DEWI/calls" '{"result":"BROKEN","summary":"x"}'
check "POST calls result tidak valid -> 400 (got $(code))" "$([ "$(code)" = "400" ] && echo OK || echo BAD)"

req POST "$BASE/api/admin/applications/$DEWI/calls" '{"result":"DIANGGAT","summary":"Telepon dipungut, konfirmasi kesediaan mengikuti tes tertulis minggu depan."}'
check "POST calls DIANGGAT 201 (got $(code))" "$([ "$(code)" = "201" ] && echo OK || echo BAD)"
CALL_ACTOR=$(py 'print(json.load(open(os.environ["J"])).get("call",{}).get("actor",""))')
check "calls actor = nama admin ($CALL_ACTOR)" "$([ "$CALL_ACTOR" = "Pemilik Studio" ] && echo OK || echo BAD)"

curl -s -b "$VJAR" -X POST -H "Content-Type: application/json" -d '{"result":"DIANGGAT","summary":"viewer"}' -o /tmp/nr24a2-out.json -w "%{http_code}" "$BASE/api/admin/applications/$DEWI/calls" > /tmp/nr24a2-code.txt
ERR=$(py 'print(json.load(open(os.environ["J"])).get("error",""))')
check "POST calls VIEWER -> 403 pesan akses (got $(code))" "$([ "$(code)" = "403" ] && [ "$ERR" = "Anda tidak memiliki akses untuk aksi ini." ] && echo OK || echo BAD)"

req GET "$BASE/api/admin/applications/$DEWI/calls"
N=$(py 'print(len(json.load(open(os.environ["J"])).get("calls",[])))')
R=$(py 'print(json.load(open(os.environ["J"]))["calls"][0]["result"])')
check "GET calls berisi 1, result DIANGGAT ($N/$R)" "$([ "$N" = "1" ] && [ "$R" = "DIANGGAT" ] && echo OK || echo BAD)"

req GET "$BASE/api/admin/applications/ID-TIDAK-ADA/calls"
check "GET calls lamaran tak ada -> 404 (got $(code))" "$([ "$(code)" = "404" ] && echo OK || echo BAD)"

# ---- 3. ASSESSMENTS ----
req GET "$BASE/api/admin/applications/$DEWI/assessments"
N=$(py 'print(len(json.load(open(os.environ["J"])).get("assessments",[])))')
check "GET assessments awal kosong ($N)" "$([ "$N" = "0" ] && echo OK || echo BAD)"

req POST "$BASE/api/admin/applications/$DEWI/assessments" '{"title":"","link":"https://example.com/t"}'
check "POST assessments tanpa judul -> 400 (got $(code))" "$([ "$(code)" = "400" ] && echo OK || echo BAD)"

DUE=$(python3 -c "import datetime; print((datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=7)).isoformat())")
req POST "$BASE/api/admin/applications/$DEWI/assessments" "{\"title\":\"Tes Menulis Singkat\",\"link\":\"https://example.com/tes-nr24\",\"note\":\"Kerjakan maksimal 30 menit.\",\"dueAt\":\"$DUE\"}"
check "POST assessments 201 (got $(code))" "$([ "$(code)" = "201" ] && echo OK || echo BAD)"
ASSESS=$(py 'print(json.load(open(os.environ["J"])).get("assessment",{}).get("id",""))')
ST=$(py 'print(json.load(open(os.environ["J"])).get("assessment",{}).get("status",""))')
check "assessments status awal SENT ($ST)" "$([ "$ST" = "SENT" ] && echo OK || echo BAD)"
check "id assessment terbaca ($ASSESS)" "$([ -n "$ASSESS" ] && echo OK || echo BAD)"

curl -s -b "$VJAR" -X PATCH -H "Content-Type: application/json" -d '{"status":"SUBMITTED"}' -o /dev/null -w "%{http_code}" "$BASE/api/admin/assessments/$ASSESS" > /tmp/nr24a2-code.txt
check "PATCH assessment VIEWER -> 403 (got $(code))" "$([ "$(code)" = "403" ] && echo OK || echo BAD)"

req PATCH "$BASE/api/admin/assessments/$ASSESS" '{"score":150}'
check "PATCH assessment skor 150 -> 400 (got $(code))" "$([ "$(code)" = "400" ] && echo OK || echo BAD)"

req PATCH "$BASE/api/admin/assessments/$ASSESS" '{"status":"SUBMITTED","score":80,"feedback":"Struktur bagus, isi bisa lebih tajam."}'
check "PATCH assessment SUBMITTED+80 200 (got $(code))" "$([ "$(code)" = "200" ] && echo OK || echo BAD)"
ST=$(py 'print(json.load(open(os.environ["J"]))["assessment"]["status"])')
SC=$(py 'print(json.load(open(os.environ["J"]))["assessment"]["score"])')
SA=$(py 'print(json.load(open(os.environ["J"]))["assessment"]["submittedAt"] or "")')
check "assessment status SUBMITTED skor 80 ($ST/$SC)" "$([ "$ST" = "SUBMITTED" ] && [ "$SC" = "80" ] && echo OK || echo BAD)"
check "assessment submittedAt terisi ($SA)" "$([ -n "$SA" ] && echo OK || echo BAD)"

req PATCH "$BASE/api/admin/assessments/$ASSESS" '{"status":"LATE"}'
ST=$(py 'print(json.load(open(os.environ["J"]))["assessment"]["status"])')
SA2=$(py 'print(json.load(open(os.environ["J"]))["assessment"]["submittedAt"])')
check "PATCH assessment LATE menjaga submittedAt pertama ($ST)" "$([ "$ST" = "LATE" ] && [ "$SA2" = "$SA" ] && echo OK || echo BAD)"

# ---- 4. INTERNAL DOCS ----
echo "Isi dokumen internal uji NR-24-a2." > /tmp/nr24a2-doc.txt
curl -s -b "$VJAR" -F "file=@/tmp/nr24a2-doc.txt" -o /dev/null -w "%{http_code}" "$BASE/api/admin/applications/$DEWI/internal-docs" > /tmp/nr24a2-code.txt
check "POST internal-docs VIEWER -> 403 (got $(code))" "$([ "$(code)" = "403" ] && echo OK || echo BAD)"

curl -s -b "$JAR" -F "name=Nama Saja Tanpa Berkas" -o /tmp/nr24a2-out.json -w "%{http_code}" "$BASE/api/admin/applications/$DEWI/internal-docs" > /tmp/nr24a2-code.txt
check "POST internal-docs tanpa file -> 400 (got $(code))" "$([ "$(code)" = "400" ] && echo OK || echo BAD)"

curl -s -b "$JAR" -F "file=@/tmp/nr24a2-doc.txt" -F "name=Hasil MCU Uji" -o /tmp/nr24a2-out.json -w "%{http_code}" "$BASE/api/admin/applications/$DEWI/internal-docs" > /tmp/nr24a2-code.txt
check "POST internal-docs multipart 201 (got $(code))" "$([ "$(code)" = "201" ] && echo OK || echo BAD)"
DOC=$(py 'print(json.load(open(os.environ["J"])).get("doc",{}).get("id",""))')
DNAME=$(py 'print(json.load(open(os.environ["J"])).get("doc",{}).get("name",""))')
DUP=$(py 'print(json.load(open(os.environ["J"])).get("doc",{}).get("uploadedBy",""))')
check "doc name & uploadedBy ($DNAME/$DUP)" "$([ "$DNAME" = "Hasil MCU Uji" ] && [ "$DUP" = "Pemilik Studio" ] && echo OK || echo BAD)"
check "id doc terbaca ($DOC)" "$([ -n "$DOC" ] && echo OK || echo BAD)"

req GET "$BASE/api/admin/applications/$DEWI/internal-docs"
N=$(py 'print(len(json.load(open(os.environ["J"])).get("docs",[])))')
check "GET internal-docs berisi 1 ($N)" "$([ "$N" = "1" ] && echo OK || echo BAD)"

req DELETE "$BASE/api/admin/internal-docs/$DOC"
OK=$(py 'print(json.load(open(os.environ["J"])).get("ok",""))')
check "DELETE internal-docs ok ($OK)" "$([ "$OK" = "True" ] && echo OK || echo BAD)"
req GET "$BASE/api/admin/applications/$DEWI/internal-docs"
N=$(py 'print(len(json.load(open(os.environ["J"])).get("docs",[])))')
check "GET internal-docs kembali kosong ($N)" "$([ "$N" = "0" ] && echo OK || echo BAD)"
req DELETE "$BASE/api/admin/internal-docs/$DOC"
check "DELETE internal-docs kedua kali -> 404 (got $(code))" "$([ "$(code)" = "404" ] && echo OK || echo BAD)"

# ---- 5. INBOX ----
req GET "$BASE/api/admin/applications/$DEWI/inbox"
check "GET inbox 200 (got $(code))" "$([ "$(code)" = "200" ] && echo OK || echo BAD)"
KINDS=$(py 'print(",".join(i["kind"] for i in json.load(open(os.environ["J"])).get("items",[])))')
UNA=$(py 'print(json.load(open(os.environ["J"])).get("unanswered",-1))')
check "inbox memuat QUESTION & CALL ($KINDS)" "$(echo "$KINDS" | grep -q "QUESTION" && echo "$KINDS" | grep -q "CALL" && echo OK || echo BAD)"
check "inbox unanswered = 1 ($UNA)" "$([ "$UNA" = "1" ] && echo OK || echo BAD)"
ANS=$(py 'print([i.get("answered") for i in json.load(open(os.environ["J"]))["items"] if i["kind"]=="QUESTION"][0])')
check "question answered=false ($ANS)" "$([ "$ANS" = "False" ] && echo OK || echo BAD)"

# ---- 6. HISTORY ----
req GET "$BASE/api/admin/applications/$DEWI/history"
check "GET history 200 (got $(code))" "$([ "$(code)" = "200" ] && echo OK || echo BAD)"
HN=$(py 'print(len(json.load(open(os.environ["J"])).get("history",[])))')
HT=$(py 'print(json.load(open(os.environ["J"]))["history"][0]["trackingCode"] if json.load(open(os.environ["J"]))["history"] else "")')
check "history berisi lamaran uji email sama ($HN/$HT)" "$([ "$HN" = "1" ] && [ -n "$HT" ] && echo OK || echo BAD)"

# ---- 7. MERGE (source=lamaran uji -> target=Dewi) ----
req POST "$BASE/api/admin/applications/$DEWI/merge" "{\"sourceId\":\"$DEWI\"}"
check "merge diri sendiri -> 400 (got $(code))" "$([ "$(code)" = "400" ] && echo OK || echo BAD)"

DEWI_COMMENTS_BEFORE=$(py 'print(json.load(open(os.environ["J"])).get("target",{}).get("tags","MISS"))')
req POST "$BASE/api/admin/applications/$DEWI/merge" "{\"sourceId\":\"$TEMP\"}"
check "POST merge 200 (got $(code))" "$([ "$(code)" = "200" ] && echo OK || echo BAD)"
TTAGS=$(py 'print(",".join(json.load(open(os.environ["J"]))["target"]["tags"]))')
check "tags union tanpa duplikat (sosial media, komunitas, uji-nr24) ($TTAGS)" "$([ "$TTAGS" = "sosial media,komunitas,uji-nr24" ] && echo OK || echo BAD)"
TCV=$(py 'import json,os; d=json.load(open(os.environ["J"]))["target"]; print(d["cvFileId"] or "")')
check "cvFileId lamaran uji disalin ke target (non-null)" "$([ -n "$TCV" ] && echo OK || echo BAD)"
TED=$(py 'print(len(json.load(open(os.environ["J"]))["target"]["extraDocs"]))')
check "extraDocs target memuat dokumen sumber ($TED)" "$([ "$TED" = "1" ] && echo OK || echo BAD)"

# verifikasi source di DB-level via GET list admin
req GET "$BASE/api/admin/applications?q=Uji%20NR24A2"
SRC=$(py 'print(json.load(open(os.environ["J"]))[0]["id"] if json.load(open(os.environ["J"])) else "")')
SSTAT=$(py 'print(json.load(open(os.environ["J"]))[0]["status"] if json.load(open(os.environ["J"])) else "")')
SREAS=$(py 'print(json.load(open(os.environ["J"]))[0]["rejectionReason"] if json.load(open(os.environ["J"])) else "")')
SMERGE=$(py 'print(json.load(open(os.environ["J"]))[0]["mergedIntoId"] if json.load(open(os.environ["J"])) else "")')
check "source jadi REJECTED/$SREAS/mergedIntoId=DEWI" "$([ "$SRC" = "$TEMP" ] && [ "$SSTAT" = "REJECTED" ] && [ "$SREAS" = "DUPLICATE" ] && [ "$SMERGE" = "$DEWI" ] && echo OK || echo BAD)"

bun -e "
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const target = await db.application.findUnique({ where: { id: '$DEWI' }, select: { _count: { select: { comments: true } } } });
const src = await db.application.findUnique({ where: { id: '$TEMP' }, select: { _count: { select: { comments: true } } } });
console.log('TC=' + target?._count.comments + ' SC=' + src?._count.comments);
await db.\$disconnect();
" > /tmp/nr24a2-counts.txt 2>&1
TC=$(rg -o 'TC=\d+' /tmp/nr24a2-counts.txt | head -1 | cut -d= -f2)
SC=$(rg -o 'SC=\d+' /tmp/nr24a2-counts.txt | head -1 | cut -d= -f2)
check "komentar pindah: target 0->2, source 2->0 (TC=$TC SC=$SC)" "$([ "$TC" = "2" ] && [ "$SC" = "0" ] && echo OK || echo BAD)"

# undo-reject pada hasil merge -> 400 (masih menunjuk lamaran utama)
req POST "$BASE/api/admin/applications/$TEMP/undo-reject" '{"reason":"Uji guard merge"}'
ERR=$(py 'print(json.load(open(os.environ["J"])).get("error",""))')
check "undo-reject hasil merge -> 400 sudah digabung ($ERR)" "$([ "$(code)" = "400" ] && [ "$ERR" = "Lamaran sudah digabung." ] && echo OK || echo BAD)"

# ---- 8. UNDO-REJECT (lamaran REJECTED sungguhan: tolak Rizky via PATCH lalu batalkan) ----
RIZKY=$(python3 -c "
import json
s=json.load(open('$SNAP'))
print([a['id'] for a in s['apps'] if a['id']=='cmus1l9c1000bl2urfmzbslxm'][0])")
req POST "$BASE/api/admin/applications/$DEWI/undo-reject" '{"reason":"Uji guard status"}'
ERR=$(py 'print(json.load(open(os.environ["J"])).get("error",""))')
check "undo-reject lamaran ACCEPTED -> 400 ($ERR)" "$([ "$(code)" = "400" ] && [ "$ERR" = "Lamaran tidak sedang ditolak." ] && echo OK || echo BAD)"

req POST "$BASE/api/admin/applications/$RIZKY/undo-reject" '{"reason":"Uji guard status"}'
ERR=$(py 'print(json.load(open(os.environ["J"])).get("error",""))')
check "undo-reject lamaran NEW -> 400 ($ERR)" "$([ "$(code)" = "400" ] && [ "$ERR" = "Lamaran tidak sedang ditolak." ] && echo OK || echo BAD)"

curl -s -b "$VJAR" -X POST -H "Content-Type: application/json" -d '{"reason":"viewer"}' -o /dev/null -w "%{http_code}" "$BASE/api/admin/applications/$RIZKY/undo-reject" > /tmp/nr24a2-code.txt
check "undo-reject VIEWER -> 403 (got $(code))" "$([ "$(code)" = "403" ] && echo OK || echo BAD)"

# tolak Rizky (dengan rejectionReason MENARIK_DIRI utk uji guard) via PATCH dua langkah
req PATCH "$BASE/api/admin/applications/$RIZKY" '{"status":"REJECTED"}'
check "PATCH tolak Rizky 200 (got $(code))" "$([ "$(code)" = "200" ] && echo OK || echo BAD)"

req POST "$BASE/api/admin/applications/$RIZKY/undo-reject" '{"reason":""}'
check "undo-reject tanpa alasan -> 400 (got $(code))" "$([ "$(code)" = "400" ] && echo OK || echo BAD)"

req POST "$BASE/api/admin/applications/$RIZKY/undo-reject" '{"reason":"Ternyata salah tolak — kembalikan ke tahap semula."}'
check "POST undo-reject 200 (got $(code))" "$([ "$(code)" = "200" ] && echo OK || echo BAD)"
UST=$(py 'print(json.load(open(os.environ["J"])).get("status",""))')
UREAS=$(py 'print(json.load(open(os.environ["J"])).get("rejectionReason","NONE"))')
UNOTE=$(py 'print(json.load(open(os.environ["J"])).get("rejectionNote","NONE"))')
check "Rizky kembali NEW + rejection fields null ($UST/$UREAS/$UNOTE)" "$([ "$UST" = "NEW" ] && [ "$UREAS" = "None" ] && [ "$UNOTE" = "None" ] && echo OK || echo BAD)"

# ---- 9. DONOTHIRE ----
req GET "$BASE/api/admin/donothire"
check "GET donothire 200 (got $(code))" "$([ "$(code)" = "200" ] && echo OK || echo BAD)"

curl -s -b "$VJAR" -X PUT -H "Content-Type: application/json" -d '{"key":"Test@Example.COM","reason":"uji viewer"}' -o /dev/null -w "%{http_code}" "$BASE/api/admin/donothire" > /tmp/nr24a2-code.txt
check "PUT donothire VIEWER -> 403 (got $(code))" "$([ "$(code)" = "403" ] && echo OK || echo BAD)"

req PUT "$BASE/api/admin/donothire" '{"key":"Test@Example.COM","reason":"Riwayat penyalahgunaan proses rekrutmen."}'
KEY=$(py 'print(json.load(open(os.environ["J"]))["entries"][0]["key"] if json.load(open(os.environ["J"])).get("entries") else "")')
check "PUT donothire email kapital dinormalisasi lowercase ($KEY)" "$([ "$KEY" = "test@example.com" ] && echo OK || echo BAD)"

req PUT "$BASE/api/admin/donothire" '{"key":"+62 812-0000-0024","reason":"Nomor tidak aktif."}'
NKEYS=$(py 'print(len(json.load(open(os.environ["J"])).get("entries",[])))')
HASPHONE=$(py 'print("081200000024" in [e["key"] for e in json.load(open(os.environ["J"])).get("entries",[])])')
check "PUT donothire telepon digit-only ($NKEYS entri, phone=$HASPHONE)" "$([ "$NKEYS" = "2" ] && [ "$HASPHONE" = "True" ] && echo OK || echo BAD)"

req PUT "$BASE/api/admin/donothire" '{"key":"   ","reason":"tanpa kunci"}'
check "PUT donothire kunci kosong -> 400 (got $(code))" "$([ "$(code)" = "400" ] && echo OK || echo BAD)"

req GET "$BASE/api/admin/donothire"
NKEYS=$(py 'print(len(json.load(open(os.environ["J"])).get("entries",[])))')
check "GET donothire berisi 2 entri ($NKEYS)" "$([ "$NKEYS" = "2" ] && echo OK || echo BAD)"

req DELETE "$BASE/api/admin/donothire?key=test@example.com"
ERR=$(py 'print(json.load(open(os.environ["J"])).get("error",""))')
check "DELETE tanpa confirm -> 400 ($ERR)" "$([ "$(code)" = "400" ] && [ "$ERR" = "Konfirmasi penghapusan diperlukan." ] && echo OK || echo BAD)"

curl -s -b "$VJAR" -X DELETE -o /dev/null -w "%{http_code}" "$BASE/api/admin/donothire?key=test@example.com&confirm=YA" > /tmp/nr24a2-code.txt
check "DELETE donothire oleh HR -> 403 (got $(code))" "$([ "$(code)" = "403" ] && echo OK || echo BAD)"

req DELETE "$BASE/api/admin/donothire?key=test@example.com&confirm=YA"
OK=$(py 'print(json.load(open(os.environ["J"])).get("ok",""))')
NKEYS=$(py 'print(len(json.load(open(os.environ["J"])).get("entries",[])))')
check "DELETE confirm=YA menghapus entri ($OK, sisa $NKEYS)" "$([ "$OK" = "True" ] && [ "$NKEYS" = "1" ] && echo OK || echo BAD)"

req DELETE "$BASE/api/admin/donothire?key=test@example.com&confirm=YA"
check "DELETE entri tak ada -> 404 (got $(code))" "$([ "$(code)" = "404" ] && echo OK || echo BAD)"

req DELETE "$BASE/api/admin/donothire?key=081200000024&confirm=YA"
NKEYS=$(py 'print(len(json.load(open(os.environ["J"])).get("entries",[])))')
check "DELETE entri telepon -> kosong ($NKEYS)" "$([ "$NKEYS" = "0" ] && echo OK || echo BAD)"

# ---- 10. TAGS ----
req GET "$BASE/api/admin/tags"
check "GET tags 200 (got $(code))" "$([ "$(code)" = "200" ] && echo OK || echo BAD)"

curl -s -b "$VJAR" -X PUT -H "Content-Type: application/json" -d '{"tags":["x"]}' -o /dev/null -w "%{http_code}" "$BASE/api/admin/tags" > /tmp/nr24a2-code.txt
check "PUT tags VIEWER -> 403 (got $(code))" "$([ "$(code)" = "403" ] && echo OK || echo BAD)"

req PUT "$BASE/api/admin/tags" '{"tags":["uji-nr24","Tag Kedua","uji-nr24"]}'
OK=$(py 'print(json.load(open(os.environ["J"])).get("ok",""))')
NT=$(py 'print(len(json.load(open(os.environ["J"])).get("tags",[])))')
check "PUT tags dedupe -> 2 ($OK/$NT)" "$([ "$OK" = "True" ] && [ "$NT" = "2" ] && echo OK || echo BAD)"

req GET "$BASE/api/admin/tags"
FOUND=$(py 'import json,os; t=json.load(open(os.environ["J"]))["tags"]; print(all(x in t for x in ["uji-nr24","Tag Kedua"]) and t==sorted(t, key=str.lower))')
check "GET tags memuat 2 tag urut abjad ($FOUND)" "$([ "$FOUND" = "True" ] && echo OK || echo BAD)"

req PUT "$BASE/admin/tags" '{}'
# (panggilan sengaja salah path tidak dihitung — abaikan)

echo ""
echo "=============================="
echo "PASS=$PASS FAIL=$FAIL"
echo "=============================="
[ "$FAIL" = "0" ]
