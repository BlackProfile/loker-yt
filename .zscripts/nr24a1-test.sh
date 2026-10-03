#!/usr/bin/env bash
# NR-24-a1 — Uji E2E fondasi fitur per pelamar (schema, tipe, serialisasi, filter, PATCH, wizard, action-items, cron).
# Semua data uji ditandai email nr24a1+@test.lumina dan dibersihkan cleanup-nr24a1.ts.
set -u
BASE="http://localhost:3000"
JAR="/tmp/nr24a1-cookies.txt"
rm -f "$JAR"
PASS=0; FAIL=0

check() { # $1=nama $2=ekspresi(0=ok)
  if eval "$2"; then PASS=$((PASS+1)); echo "PASS: $1";
  else FAIL=$((FAIL+1)); echo "FAIL: $1"; fi
}

code() { tail -n1 /tmp/nr24a1-code.txt; }

req() { # $1=method $2=url $3=body(optional)
  local m="$1" u="$2" b="${3:-}"
  if [ -n "$b" ]; then
    curl -s -b "$JAR" -c "$JAR" -X "$m" -H "Content-Type: application/json" -d "$b" -o /tmp/nr24a1-out.json -w "%{http_code}" "$u" > /tmp/nr24a1-code.txt
  else
    curl -s -b "$JAR" -c "$JAR" -X "$m" -o /tmp/nr24a1-out.json -w "%{http_code}" "$u" > /tmp/nr24a1-code.txt
  fi
}

# ---- 0. Login admin (OWNER) ----
C=$(curl -s -c "$JAR" -X POST -H "Content-Type: application/json" -d '{"email":"admin@lumina.id","password":"admin123"}' -o /tmp/nr24a1-login.json -w "%{http_code}" "$BASE/api/admin/login")
check "login admin 200 (got $C)" "[ '$C' = '200' ]"

# ---- 1. Pilih posisi demo + buat lamaran uji via POST publik (dgn expectedSalary) ----
req GET "$BASE/api/admin/positions"
POS_ID=$(python3 -c "
import json
rows=json.load(open('/tmp/nr24a1-out.json'))
demo=[p for p in rows if p.get('isActive')]
print(demo[0]['id'] if demo else '')")
NOW_MS=$(python3 -c "import time; print(int((time.time()-10)*1000))")
C=$(curl -s -X POST -H "Content-Type: application/json" -d "{\"name\":\"Tester NR24\",\"email\":\"nr24a1@test.lumina\",\"phone\":\"081299900011\",\"positionId\":\"$POS_ID\",\"experience\":\"Pengalaman uji otomatis NR-24 fondasi per pelamar.\",\"motivation\":\"Ingin memastikan fondasi NR-24 bekerja dengan baik.\",\"expectedSalary\":\"3500000\",\"consent\":\"1\",\"formStartedAt\":\"$NOW_MS\"}" -o /tmp/nr24a1-app.json -w "%{http_code}" "$BASE/api/applications")
check "POST /api/applications expectedSalary -> 201 (got $C)" "[ '$C' = '201' ]"
APP_ID=$(python3 -c "import json; print(json.load(open('/tmp/nr24a1-app.json')).get('id',''))")
check "id lamaran uji ada" "[ -n '$APP_ID' ]"

# Verifikasi DB expectedSalary terisi (via serialize admin)
req GET "$BASE/api/admin/applications/$APP_ID" 2>/dev/null || true
# route detail mungkin tidak ada — pakai list
req GET "$BASE/api/admin/applications?q=nr24a1@test.lumina"
ES=$(python3 -c "
import json
rows=json.load(open('/tmp/nr24a1-out.json'))
m=[r for r in rows if r['id']=='$APP_ID']
print(m[0].get('expectedSalary') if m else 'MISS')")
check "expectedSalary tersimpan 3500000 (got $ES)" "[ '$ES' = '3500000' ]"

# ---- 2. PATCH starred:true -> starredBy berisi id user ----
UID=$(python3 -c "import json; print(json.load(open('/tmp/nr24a1-login.json')).get('user',{}).get('id','') if isinstance(json.load(open('/tmp/nr24a1-login.json')),dict) else '')" 2>/dev/null || true)
# fallback: session shape mungkin {id,name,email,role} langsung
if [ -z "$UID" ]; then UID=$(python3 -c "
import json
d=json.load(open('/tmp/nr24a1-login.json'))
u=d.get('user', d)
print(u.get('id',''))"); fi
req PATCH "$BASE/api/admin/applications/$APP_ID" '{"starred":true}'
check "PATCH starred:true 200 (got $(code))" "[ \"$(code)\" = '200' ]"
STARRED=$(python3 -c "
import json
d=json.load(open('/tmp/nr24a1-out.json'))
print('YES' if '$UID' in (d.get('starredBy') or []) else 'NO')")
check "starredBy berisi id admin ($UID)" "[ '$STARRED' = 'YES' ]"

# ---- 3. PATCH holdReason + holdReviewAt ----
req PATCH "$BASE/api/admin/applications/$APP_ID" '{"holdReason":"slot penuh","holdReviewAt":"2026-03-01T00:00:00.000Z"}'
check "PATCH hold 200 (got $(code))" "[ \"$(code)\" = '200' ]"
HOLD=$(python3 -c "
import json; d=json.load(open('/tmp/nr24a1-out.json'))
print(d.get('holdReason',''), '|', d.get('holdReviewAt',''))")
check "holdReason+holdReviewAt tersimpan" "echo '$HOLD' | grep -q 'slot penuh' && echo '$HOLD' | grep -q '2026-03-01'"

# ---- 4. PATCH docExpiries (fileId uji) ----
req PATCH "$BASE/api/admin/applications/$APP_ID" '{"docExpiries":{"nr24testfile":"2026-05-10"}}'
check "PATCH docExpiries 200 (got $(code))" "[ \"$(code)\" = '200' ]"
DX=$(python3 -c "import json; print(json.load(open('/tmp/nr24a1-out.json')).get('docExpiries',{}).get('nr24testfile',''))")
check "docExpiries.nr24testfile=2026-05-10 (got $DX)" "[ '$DX' = '2026-05-10' ]"

# ---- 5. PATCH docExpiries format salah -> 400 ----
req PATCH "$BASE/api/admin/applications/$APP_ID" '{"docExpiries":{"nr24testfile":"10-05-2026"}}'
check "PATCH docExpiries salah format -> 400 (got $(code))" "[ \"$(code)\" = '400' ]"

# ---- 6. PATCH expectedSalary 3500000 + null ----
req PATCH "$BASE/api/admin/applications/$APP_ID" '{"expectedSalary":3500000}'
check "PATCH expectedSalary 200 (got $(code))" "[ \"$(code)\" = '200' ]"
req PATCH "$BASE/api/admin/applications/$APP_ID" '{"expectedSalary":null}'
ES2=$(python3 -c "import json; print(json.load(open('/tmp/nr24a1-out.json')).get('expectedSalary','X'))")
check "PATCH expectedSalary null -> null (got $ES2)" "[ '$ES2' = 'None' ]"

# ---- 7. PATCH expectedSalary tidak valid -> 400 ----
req PATCH "$BASE/api/admin/applications/$APP_ID" '{"expectedSalary":999999999999}'
check "PATCH expectedSalary >1M -> 400 (got $(code))" "[ \"$(code)\" = '400' ]"

# ---- 8. ActivityLog STAR/HOLD_SET/HOLD_REVIEW/DOC_EXPIRY/SALARY_EXPECTATION tercatat ----
req GET "$BASE/api/admin/logs?applicationId=$APP_ID&limit=100"
LOGS=$(python3 -c "
import json
rows=json.load(open('/tmp/nr24a1-out.json'))
acts=sorted({r['action'] for r in (rows if isinstance(rows,list) else rows.get('logs',rows.get('items',[])))})
print(','.join(acts))")
for A in STAR HOLD_SET HOLD_REVIEW DOC_EXPIRY SALARY_EXPECTATION; do
  check "log $A tercatat" "echo '$LOGS' | grep -q '$A'"
done

# ---- 9. Filter GET list: hold=1 / starred=1 / followup=1 / sort=followup ----
req GET "$BASE/api/admin/applications?hold=1"
N_HOLD=$(python3 -c "
import json
rows=json.load(open('/tmp/nr24a1-out.json'))
print(len(rows), 'OK' if all(r.get('holdReason') for r in rows) else 'BAD')")
check "GET ?hold=1 hanya HOLD (n=$N_HOLD)" "echo '$N_HOLD' | grep -q 'OK'"
req GET "$BASE/api/admin/applications?starred=1"
N_STAR=$(python3 -c "
import json
rows=json.load(open('/tmp/nr24a1-out.json'))
ids={'$UID'}
print('OK' if rows and all(ids & set(r.get('starredBy') or []) for r in rows) else 'BAD')")
check "GET ?starred=1 hanya milik admin (n=$(python3 -c "import json; print(len(json.load(open('/tmp/nr24a1-out.json'))))"))" "[ '$N_STAR' = 'OK' ]"
req GET "$BASE/api/admin/applications?followup=1"
check "GET ?followup=1 -> 200 (got $(code))" "[ \"$(code)\" = '200' ]"
req GET "$BASE/api/admin/applications?sort=followup"
check "GET ?sort=followup -> 200 (got $(code))" "[ \"$(code)\" = '200' ]"

# ---- 10. action-items: followupDue & holdReviewDue ada ----
req GET "$BASE/api/admin/action-items"
AI=$(python3 -c "
import json
d=json.load(open('/tmp/nr24a1-out.json'))
print('followupDue' in d and 'holdReviewDue' in d and isinstance(d['followupDue'],list) and isinstance(d['holdReviewDue'],list) and 'OK' or 'BAD')")
check "action-items punya followupDue+holdReviewDue" "[ '$AI' = 'OK' ]"
HRN=$(python3 -c "
import json
d=json.load(open('/tmp/nr24a1-out.json'))
print('YES' if any(h['id']=='$APP_ID' for h in d['holdReviewDue']) else 'NO')")
check "holdReviewDue memuat lamaran HOLD uji (review 2026-03-01)" "[ '$HRN' = 'YES' ]"

# ---- 11. Cron reminders stabil 200 + field followupBell ----
C=$(curl -s -X POST -H "Content-Type: application/json" -H "x-realtime-secret: lumina-realtime-secret" -d '{}' -o /tmp/nr24a1-cron.json -w "%{http_code}" "$BASE/api/cron/reminders")
check "POST /api/cron/reminders 200 (got $C)" "[ '$C' = '200' ]"
FB=$(python3 -c "import json; print('OK' if 'followupBell' in json.load(open('/tmp/nr24a1-cron.json')) else 'BAD')")
check "respons cron punya followupBell" "[ '$FB' = 'OK' ]"

# ---- 12. Uji Do-not-Hire (Setting doNotHire sudah dipasang setup-nr24a1.ts), submit lagi ----
C2=$(curl -s -b "$JAR" -X POST -H "Content-Type: application/json" -d "{\"name\":\"Tester DNH\",\"email\":\"NR24A1@test.lumina\",\"phone\":\"6281299900011\",\"positionId\":\"$POS_ID\",\"experience\":\"Uji kedua untuk peringatan Do-not-Hire NR-24.\",\"motivation\":\"Memverifikasi peringatan DNH muncul otomatis.\",\"consent\":\"1\",\"formStartedAt\":\"$NOW_MS\"}" -o /tmp/nr24a1-app2.json -w "%{http_code}" "$BASE/api/applications")
check "POST lamaran kedua (email kapital+telepon beda format) 201 (got $C2)" "[ '$C2' = '201' ]"
APP2_ID=$(python3 -c "import json; print(json.load(open('/tmp/nr24a1-app2.json')).get('id',''))")
req GET "$BASE/api/admin/logs?applicationId=$APP2_ID&limit=50"
DNH=$(python3 -c "
import json
rows=json.load(open('/tmp/nr24a1-out.json'))
acts=[r['action'] for r in (rows if isinstance(rows,list) else rows.get('logs',rows.get('items',[])))]
print('YES' if 'DNH_WARNING' in acts else 'NO:'+','.join(acts))")
check "ActivityLog DNH_WARNING tercatat (normalisasi email+telepon)" "[ \"$(echo '$DNH' | head -c3)\" = 'YES' ]"

echo ""
echo "======================================"
echo "HASIL: PASS=$PASS FAIL=$FAIL"
echo "APP_ID=$APP_ID APP2_ID=$APP2_ID"
echo "======================================"
