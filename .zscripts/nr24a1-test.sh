#!/usr/bin/env bash
# NR-24-a1 — Uji E2E fondasi fitur per pelamar (schema, tipe, serialisasi, filter, PATCH, wizard, action-items, cron).
# Prasyarat: bun run .zscripts/nr24a1-setup.ts (Setting doNotHire).
# Semua data uji ditandai email nr24a1@test.lumina / NR24A1@test.lumina dan dibersihkan cleanup-nr24a1.ts.
set -u
BASE="http://localhost:3000"
JAR="/tmp/nr24a1-cookies.txt"
rm -f "$JAR"
PASS=0; FAIL=0

check() { # $1=nama $2=status OK/BAD
  if [ "$2" = "OK" ]; then PASS=$((PASS+1)); echo "PASS: $1";
  else FAIL=$((FAIL+1)); echo "FAIL: $1 ($2)"; fi
}

req() { # $1=method $2=url $3=body(optional)
  local m="$1" u="$2" b="${3:-}"
  if [ -n "$b" ]; then
    curl -s -b "$JAR" -c "$JAR" -X "$m" -H "Content-Type: application/json" -d "$b" -o /tmp/nr24a1-out.json -w "%{http_code}" "$u" > /tmp/nr24a1-code.txt
  else
    curl -s -b "$JAR" -c "$JAR" -X "$m" -o /tmp/nr24a1-out.json -w "%{http_code}" "$u" > /tmp/nr24a1-code.txt
  fi
}
code() { tail -n1 /tmp/nr24a1-code.txt; }

# Helper python: baca /tmp/nr24a1-out.json + ekspresi; input lewat env J.
py() { J=/tmp/nr24a1-out.json python3 -c "import json, os; $1"; }

# ---- 0. Login admin (OWNER) ----
C=$(curl -s -c "$JAR" -X POST -H "Content-Type: application/json" -d '{"email":"admin@lumina.id","password":"admin123"}' -o /tmp/nr24a1-login.json -w "%{http_code}" "$BASE/api/admin/login")
check "login admin 200 (got $C)" "$([ "$C" = "200" ] && echo OK || echo BAD)"
ADMIN_ID=$(python3 -c "
import json
d=json.load(open('/tmp/nr24a1-login.json'))
u=d.get("session", d) if isinstance(d, dict) else {}
print(u.get('id','') if isinstance(u, dict) else '')")
check "id admin terbaca ($ADMIN_ID)" "$([ -n "$ADMIN_ID" ] && echo OK || echo BAD)"

# ---- 1. Pilih posisi demo tanpa pertanyaan wajib + submit lamaran uji (expectedSalary) ----
req GET "$BASE/api/admin/positions"
POS_ID=$(py '
import json, os
rows=json.load(open(os.environ["J"]))
ok=[p for p in rows if p.get("isActive") and not any(q.get("required") for q in p.get("screeningQuestions",[])) and not p.get("customDocs") and not p.get("requireCv")]
print(ok[0]["id"] if ok else "")')
check "posisi demo ramah uji dipilih ($POS_ID)" "$([ -n "$POS_ID" ] && echo OK || echo BAD)"
NOW_MS=$(python3 -c "import time; print(int((time.time()-10)*1000))")
C=$(curl -s -X POST -H "X-Forwarded-For: 10.7.0.$RANDOM" -H "Content-Type: application/json" -d "{\"name\":\"Tester NR24\",\"email\":\"nr24a1@test.lumina\",\"phone\":\"081299900011\",\"positionId\":\"$POS_ID\",\"experience\":\"Pengalaman uji otomatis NR-24 fondasi per pelamar.\",\"motivation\":\"Ingin memastikan fondasi NR-24 bekerja baik.\",\"expectedSalary\":\"3500000\",\"consent\":\"1\",\"formStartedAt\":\"$NOW_MS\"}" -o /tmp/nr24a1-app.json -w "%{http_code}" "$BASE/api/applications")
check "POST /api/applications expectedSalary=3500000 -> 201 (got $C)" "$([ "$C" = "201" ] && echo OK || echo BAD:$(head -c 120 /tmp/nr24a1-app.json))"
APP_ID=$(python3 -c "import json; print(json.load(open('/tmp/nr24a1-app.json')).get('id',''))")
check "id lamaran uji ada ($APP_ID)" "$([ -n "$APP_ID" ] && echo OK || echo BAD)"

req GET "$BASE/api/admin/applications?q=nr24a1"
ES=$(py '
import json, os
rows=json.load(open(os.environ["J"]))
m=[r for r in rows if r.get("id")=="'"$APP_ID"'"]
print(m[0].get("expectedSalary","MISS") if m else "MISS")')
check "expectedSalary terserialisasi 3500000 (got $ES)" "$([ "$ES" = "3500000" ] && echo OK || echo BAD)"

# ---- 2. PATCH starred:true -> starredBy berisi id admin ----
req PATCH "$BASE/api/admin/applications/$APP_ID" '{"starred":true}'
ST=$(py 'print("OK" if "'"$ADMIN_ID"'" in (json.load(open(os.environ["J"])).get("starredBy") or []) else "BAD")')
check "PATCH starred:true 200 + starredBy berisi id admin ($(code))" "$([ "$ST" = "OK" ] && [ "$(code)" = "200" ] && echo OK || echo BAD)"

# ---- 3. PATCH holdReason + holdReviewAt ----
req PATCH "$BASE/api/admin/applications/$APP_ID" '{"holdReason":"slot penuh","holdReviewAt":"2026-03-01T00:00:00.000Z"}'
H=$(py '
d=json.load(open(os.environ["J"]))
print("OK" if d.get("holdReason")=="slot penuh" and "2026-03-01" in str(d.get("holdReviewAt")) else "BAD")')
check "PATCH hold 200 + tersimpan ($(code))" "$([ "$H" = "OK" ] && [ "$(code)" = "200" ] && echo OK || echo BAD)"

# ---- 4. PATCH docExpiries (fileId uji) ----
req PATCH "$BASE/api/admin/applications/$APP_ID" '{"docExpiries":{"nr24testfile":"2026-05-10"}}'
DX=$(py 'print(json.load(open(os.environ["J"])).get("docExpiries",{}).get("nr24testfile",""))')
check "docExpiries.nr24testfile=2026-05-10 (got $DX, $(code))" "$([ "$DX" = "2026-05-10" ] && [ "$(code)" = "200" ] && echo OK || echo BAD)"

# ---- 5. PATCH docExpiries format salah -> 400 ----
req PATCH "$BASE/api/admin/applications/$APP_ID" '{"docExpiries":{"nr24testfile":"10-05-2026"}}'
check "PATCH docExpiries salah format -> 400 (got $(code))" "$([ "$(code)" = "400" ] && echo OK || echo BAD)"

# ---- 6. PATCH expectedSalary 3500000 lalu null ----
req PATCH "$BASE/api/admin/applications/$APP_ID" '{"expectedSalary":3500000}'
C6=$(code)
req PATCH "$BASE/api/admin/applications/$APP_ID" '{"expectedSalary":null}'
ES2=$(py 'print(json.load(open(os.environ["J"])).get("expectedSalary"))')
check "PATCH expectedSalary 3500000->200, null->null (got $ES2)" "$([ "$C6" = "200" ] && [ "$ES2" = "None" ] && echo OK || echo BAD)"

# ---- 7. PATCH expectedSalary tidak valid -> 400 ----
req PATCH "$BASE/api/admin/applications/$APP_ID" '{"expectedSalary":999999999999}'
check "PATCH expectedSalary >1 miliar -> 400 (got $(code))" "$([ "$(code)" = "400" ] && echo OK || echo BAD)"

# ---- 8. ActivityLog tercatat ----
req GET "$BASE/api/admin/logs?applicationId=$APP_ID&limit=100"
LOGS=$(py 'print(",".join(sorted({r["action"] for r in json.load(open(os.environ["J"]))})))')
for A in STAR HOLD_SET HOLD_REVIEW DOC_EXPIRY SALARY_EXPECTATION; do
  check "log $A tercatat" "$(echo "$LOGS" | grep -q "$A" && echo OK || echo BAD)"
done

# ---- 9. Filter GET list: hold=1 / starred=1 / followup=1 / sort=followup ----
req GET "$BASE/api/admin/applications?hold=1"
N_HOLD=$(py '
rows=json.load(open(os.environ["J"]))
print("OK" if isinstance(rows,list) and rows and all(r.get("holdReason") for r in rows) else "BAD")')
req GET "$BASE/api/admin/applications?starred=1"
N_STAR=$(py '
rows=json.load(open(os.environ["J"]))
print("OK" if isinstance(rows,list) and rows and all(("'"$ADMIN_ID"'" in (r.get("starredBy") or [])) for r in rows) else "BAD")')
check "GET ?hold=1 hanya HOLD" "$N_HOLD"
check "GET ?starred=1 hanya bintang admin ini" "$N_STAR"
req GET "$BASE/api/admin/applications?followup=1"
check "GET ?followup=1 -> 200 (got $(code))" "$([ "$(code)" = "200" ] && echo OK || echo BAD)"
req GET "$BASE/api/admin/applications?sort=followup"
check "GET ?sort=followup -> 200 (got $(code))" "$([ "$(code)" = "200" ] && echo OK || echo BAD)"

# ---- 10. action-items: followupDue & holdReviewDue ada ----
req GET "$BASE/api/admin/action-items"
AI=$(py '
d=json.load(open(os.environ["J"]))
ok=("followupDue" in d and "holdReviewDue" in d and isinstance(d["followupDue"],list) and isinstance(d["holdReviewDue"],list))
print("OK" if ok else "BAD")')
HRN=$(py '
d=json.load(open(os.environ["J"]))
print("OK" if any(h.get("id")=="'"$APP_ID"'" for h in d.get("holdReviewDue",[])) else "BAD")')
check "action-items punya followupDue+holdReviewDue" "$AI"
check "holdReviewDue memuat lamaran HOLD uji (review 2026-03-01)" "$HRN"

# ---- 11. Cron reminders stabil 200 + field followupBell ----
C=$(curl -s -X POST -H "Content-Type: application/json" -H "x-realtime-secret: lumina-realtime-secret" -d '{}' -o /tmp/nr24a1-cron.json -w "%{http_code}" "$BASE/api/cron/reminders")
FB=$(python3 -c "import json; print('OK' if 'followupBell' in json.load(open('/tmp/nr24a1-cron.json')) else 'BAD')")
check "POST /api/cron/reminders 200 + punya followupBell (got $C)" "$([ "$C" = "200" ] && [ "$FB" = "OK" ] && echo OK || echo BAD)"

# ---- 12. Uji Do-not-Hire (Setting doNotHire dari setup-nr24a1.ts) ----
C2=$(curl -s -X POST -H "X-Forwarded-For: 10.7.0.$RANDOM" -H "Content-Type: application/json" -d "{\"name\":\"Tester DNH\",\"email\":\"NR24A1@test.lumina\",\"phone\":\"+62 812-9990-0011\",\"positionId\":\"$POS_ID\",\"experience\":\"Uji kedua untuk peringatan Do-not-Hire NR-24.\",\"motivation\":\"Memverifikasi peringatan DNH muncul otomatis.\",\"consent\":\"1\",\"formStartedAt\":\"$NOW_MS\"}" -o /tmp/nr24a1-app2.json -w "%{http_code}" "$BASE/api/applications")
check "POST lamaran kedua (email kapital + telepon berformat) 201 (got $C2)" "$([ "$C2" = "201" ] && echo OK || echo BAD:$(head -c 120 /tmp/nr24a1-app2.json))"
APP2_ID=$(python3 -c "import json; print(json.load(open('/tmp/nr24a1-app2.json')).get('id',''))")
req GET "$BASE/api/admin/logs?applicationId=$APP2_ID&limit=50"
DNH=$(py '
rows=json.load(open(os.environ["J"]))
acts=[r["action"] for r in rows] if isinstance(rows,list) else []
print("OK" if "DNH_WARNING" in acts else "BAD:"+",".join(acts))')
check "ActivityLog DNH_WARNING tercatat (normalisasi email kapital + telepon berformat)" "$(echo "$DNH" | head -c2)"

# ---- 13. followupBell end-to-end: snooze lewat -> cron -> notif+log, dedupe ----
req GET "$BASE/api/admin/logs?applicationId=$APP_ID&action=FOLLOWUP_REMIND&limit=10"
BEFORE=$(py 'print(len(json.load(open(os.environ["J"]))))' 2>/dev/null || echo 0)
bun run /home/z/my-project/.zscripts/nr24a1-snooze.ts "$APP_ID" > /dev/null 2>&1
curl -s -X POST -H "x-realtime-secret: lumina-realtime-secret" -d '{}' -o /dev/null "$BASE/api/cron/reminders"
curl -s -X POST -H "x-realtime-secret: lumina-realtime-secret" -d '{}' -o /dev/null "$BASE/api/cron/reminders"
req GET "$BASE/api/admin/logs?applicationId=$APP_ID&action=FOLLOWUP_REMIND&limit=10"
AFTER=$(py 'print(len(json.load(open(os.environ["J"]))))' 2>/dev/null || echo 0)
check "followupBell: 2x cron -> log FOLLOWUP_REMIND bertambah tepat 1 (dedupe, $BEFORE->$AFTER)" "$([ "$BEFORE" = "0" ] && [ "$AFTER" = "1" ] && echo OK || echo BAD)"

echo ""
echo "======================================"
echo "HASIL: PASS=$PASS FAIL=$FAIL"
echo "APP_ID=$APP_ID APP2_ID=$APP2_ID"
echo "======================================"
