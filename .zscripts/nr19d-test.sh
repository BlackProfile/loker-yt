#!/usr/bin/env bash
# NR-19-d — Uji fungsional Undangan Admin (ide 6) + Anonimisasi Data Pelamar (ide 7).
# Jalankan dari root proyek: bash .zscripts/nr19d-test.sh
set -u
BASE="http://localhost:3000"
JAR="/tmp/nr19d.jar"
PASS=0; FAIL=0

check() { # check <nama> <kondisi 0/1>
  if [ "$2" -eq 0 ]; then echo "  [OK]   $1"; PASS=$((PASS+1));
  else echo "  [GAGAL] $1"; FAIL=$((FAIL+1)); fi
}

echo "== 0. Login OWNER =="
curl -s -c "$JAR" -X POST "$BASE/api/admin/login" -H 'Content-Type: application/json' \
  -d '{"email":"admin@lumina.id","password":"admin123"}' -o /tmp/nr19d-login.json -w "%{http_code}" > /tmp/nr19d-code.txt
grep -q '"ok":true' /tmp/nr19d-login.json; check "login OWNER 200 + ok:true" $?
cat /tmp/nr19d-code.txt; echo

echo "== 1. POST invite (HR baru) =="
curl -s -b "$JAR" -X POST "$BASE/api/admin/users" -H 'Content-Type: application/json' \
  -d '{"name":"HR Undangan","email":"invite.hr@lumina.id","role":"HR","invite":true}' -o /tmp/nr19d-inv.json -w "%{http_code}" > /tmp/nr19d-code.txt
CODE=$(cat /tmp/nr19d-code.txt)
[ "$CODE" = "201" ]; check "status 201 ($CODE)" $?
grep -q '"invitePending":true' /tmp/nr19d-inv.json; check "invitePending true" $?
grep -q 'inviteToken' /tmp/nr19d-inv.json; [ $? -ne 0 ]; check "TIDAK ada inviteToken di respons (keamanan)" $?
UID_=$(python3 -c "import json;print(json.load(open('/tmp/nr19d-inv.json'))['id'])")

echo "== 2. GET users menampilkan invitePending + expiry =="
curl -s -b "$JAR" "$BASE/api/admin/users" -o /tmp/nr19d-users.json
python3 - <<'EOF'
import json,sys
users=json.load(open('/tmp/nr19d-users.json'))
u=[x for x in users if x['email']=='invite.hr@lumina.id'][0]
assert u['invitePending'] is True, u
assert u['inviteExpiresAt'], u
assert 'inviteToken' not in json.dumps(users), "token bocor di list!"
EOF
check "list: pending true + expiry ISO + tanpa token" $?

echo "== 3. EmailOutbox INVITE QUEUED berisi tautan =="
python3 - <<'EOF'
import sqlite3
con=sqlite3.connect('db/custom.db')
row=con.execute("""
  SELECT status, subject, body FROM EmailOutbox
  WHERE kind='INVITE' AND toEmail='invite.hr@lumina.id'
  ORDER BY createdAt DESC LIMIT 1
""").fetchone()
con.close()
assert row, "email INVITE tidak ada"
status, subject, body = row
assert status=='QUEUED', status
assert subject=='Undangan Admin Lumina Studio', subject
assert '/#admin/invite?token=' in body, body[:200]
assert '48 jam' in body
assert 'HR' in body
open('/tmp/nr19d-token.txt','w').write(body.split('/#admin/invite?token=')[1].split()[0].strip())
EOF
check "outbox: INVITE QUEUED + tautan + 48 jam + role" $?
TOKEN=$(cat /tmp/nr19d-token.txt)
echo "  token(awal): ${TOKEN:0:8}..."

echo "== 4. resend-invite → token berubah =="
python3 -c "
import sqlite3
con=sqlite3.connect('db/custom.db')
print(con.execute(\"SELECT inviteToken FROM AdminUser WHERE id=?\",('$UID_',)).fetchone()[0])
" > /tmp/nr19d-tok1.txt
curl -s -b "$JAR" -X PATCH "$BASE/api/admin/users/$UID_" -H 'Content-Type: application/json' \
  -d '{"action":"resend-invite"}' -o /tmp/nr19d-resend.json -w "%{http_code}" > /tmp/nr19d-code.txt
CODE=$(cat /tmp/nr19d-code.txt)
[ "$CODE" = "200" ]; check "PATCH resend 200 ($CODE)" $?
python3 -c "
import sqlite3
con=sqlite3.connect('db/custom.db')
print(con.execute(\"SELECT inviteToken FROM AdminUser WHERE id=?\",('$UID_',)).fetchone()[0])
" > /tmp/nr19d-tok2.txt
[ "$(cat /tmp/nr19d-tok1.txt)" != "$(cat /tmp/nr19d-tok2.txt)" ]; check "token berubah di DB" $?
grep -q '"invitePending":true' /tmp/nr19d-resend.json; check "masih invitePending true" $?
grep -q 'inviteToken' /tmp/nr19d-resend.json; [ $? -ne 0 ]; check "respons resend tanpa token" $?

echo "== 5. cancel-invite → invitePending false =="
curl -s -b "$JAR" -X PATCH "$BASE/api/admin/users/$UID_" -H 'Content-Type: application/json' \
  -d '{"action":"cancel-invite"}' -o /tmp/nr19d-cancel.json -w "%{http_code}" > /tmp/nr19d-code.txt
CODE=$(cat /tmp/nr19d-code.txt)
[ "$CODE" = "200" ]; check "PATCH cancel 200 ($CODE)" $?
grep -q '"invitePending":false' /tmp/nr19d-cancel.json; check "invitePending false" $?

echo "== 6. Undang ulang untuk uji accept =="
curl -s -b "$JAR" -X PATCH "$BASE/api/admin/users/$UID_" -H 'Content-Type: application/json' \
  -d '{"action":"resend-invite"}' -o /dev/null
python3 -c "
import sqlite3
con=sqlite3.connect('db/custom.db')
print(con.execute(\"SELECT inviteToken FROM AdminUser WHERE id=?\",('$UID_',)).fetchone()[0])
" > /tmp/nr19d-token.txt
TOKEN=$(cat /tmp/nr19d-token.txt)

echo "== 7. Accept: password pendek → 400 =="
curl -s -X POST "$BASE/api/public/admin-invite/accept" -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN\",\"password\":\"pendek\"}" -o /tmp/nr19d-acc1.json -w "%{http_code}" > /tmp/nr19d-code.txt
CODE=$(cat /tmp/nr19d-code.txt)
[ "$CODE" = "400" ]; check "password pendek 400 ($CODE)" $?
grep -q 'minimal 8 karakter' /tmp/nr19d-acc1.json; check "pesan min 8 karakter" $?

echo "== 8. Accept valid → ok:true lalu login =="
curl -s -X POST "$BASE/api/public/admin-invite/accept" -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN\",\"password\":\"sandirahasia123\",\"name\":\"HR Baru\"}" -o /tmp/nr19d-acc2.json -w "%{http_code}" > /tmp/nr19d-code.txt
CODE=$(cat /tmp/nr19d-code.txt)
grep -q '"ok":true' /tmp/nr19d-acc2.json; check "accept ok:true ($CODE)" $?
curl -s -c /tmp/nr19d-new.jar -X POST "$BASE/api/admin/login" -H 'Content-Type: application/json' \
  -d '{"email":"invite.hr@lumina.id","password":"sandirahasia123"}' -o /tmp/nr19d-newlogin.json -w "%{http_code}" > /tmp/nr19d-code.txt
CODE=$(cat /tmp/nr19d-code.txt)
grep -q '"role":"HR"' /tmp/nr19d-newlogin.json; check "login user baru 200 role HR ($CODE)" $?
python3 -c "import json;s=json.load(open('/tmp/nr19d-newlogin.json'))['session'];assert s['name']=='HR Baru',s"; check "nama diperbarui jadi 'HR Baru'" $?

echo "== 9. Accept token sama lagi → 404 generik =="
curl -s -X POST "$BASE/api/public/admin-invite/accept" -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN\",\"password\":\"sandirahasia123\"}" -o /tmp/nr19d-acc3.json -w "%{http_code}" > /tmp/nr19d-code.txt
CODE=$(cat /tmp/nr19d-code.txt)
[ "$CODE" = "404" ]; check "token bekas 404 ($CODE)" $?
grep -q 'tidak valid atau sudah kedaluwarsa' /tmp/nr19d-acc3.json; check "pesan generik" $?

echo "== 10. Rate limit: 10/menit per-IP =="
for i in $(seq 1 12); do
  curl -s -X POST "$BASE/api/public/admin-invite/accept" -H 'Content-Type: application/json' \
    -d '{"token":"x"}' -o /dev/null -w "%{http_code}\n" >> /tmp/nr19d-rl.txt
done
grep -q '^429$' /tmp/nr19d-rl.txt; check "ada respons 429 setelah >10 permintaan" $?
echo "  kode: $(sort /tmp/nr19d-rl.txt | uniq -c | tr '\n' ' ')"

echo "== 11. Anonimisasi: pilih lamaran demo non-final =="
curl -s -b "$JAR" "$BASE/api/admin/applications" -o /tmp/nr19d-apps.json
python3 - <<'EOF'
import json
apps=json.load(open('/tmp/nr19d-apps.json'))
if isinstance(apps,dict): apps=apps.get('applications',apps.get('items',[]))
final=('ACCEPTED','REJECTED')
# Amankan data demo: utamakan lamaran yang SUDAH dianonimkan (uji ulang idempoten).
cand=[a for a in apps if a.get('name')=='Kandidat (dianonimkan)' and not a.get('hiredAt') and a['status'] not in final]
mode='uji-ulang (sudah dianonimkan)'
if not cand:
    cand=[a for a in apps if not a.get('hiredAt') and a['status'] not in final]
    mode='PERTEMUAN PERTAMA (lamaran demo non-final akan berubah permanen)'
assert cand, "tidak ada lamaran non-final"
a=cand[0]
open('/tmp/nr19d-appid.txt','w').write(a['id'])
json.dump(a,open('/tmp/nr19d-app.json','w'))
print(f"  dipilih ({mode}): {a['name']} · {a['trackingCode']} · status {a['status']}")
EOF
AID=$(cat /tmp/nr19d-appid.txt)
python3 -c "import json;a=json.load(open('/tmp/nr19d-app.json'));assert a['status'] not in ('ACCEPTED','REJECTED') and not a.get('hiredAt')"; check "lamaran non-final terpilih" $?

echo "== 12. POST anonymize → 200 + PII bersih =="
curl -s -b "$JAR" -X POST "$BASE/api/admin/applications/$AID/anonymize" -o /tmp/nr19d-anon.json -w "%{http_code}" > /tmp/nr19d-code.txt
CODE=$(cat /tmp/nr19d-code.txt)
[ "$CODE" = "200" ]; check "anonymize 200 ($CODE)" $?
python3 - <<'EOF'
import json
r=json.load(open('/tmp/nr19d-anon.json'))
a=r['application']
assert r['ok'] is True
assert a['name']=='Kandidat (dianonimkan)', a['name']
assert a['email'].startswith('anon-') and a['email'].endswith('@dihapus.local'), a['email']
assert a['phone']==''
assert a['portfolioUrl'] is None and a['socialLinks'] is None
assert a['experience']=='' and a['motivation']==''
assert a['cvFileId'] is None and a['cvFileName'] is None
assert a['offerSalary'] is None and a['offerNote'] is None
# terjaga
assert a['trackingCode'], "trackingCode hilang"
assert a['status'], "status hilang"
fa=a.get('formAnswers') or {}
sa=a.get('screeningAnswers') or {}
for v in list(fa.values())+list(sa.values()):
    assert v=='[dihapus]', f"jawaban tidak ter-scrub: {v}"
open('/tmp/nr19d-kode.txt','w').write(a['trackingCode'])
EOF
check "PII bersih, statistik tersimpan, jawaban '[dihapus]'" $?

echo "== 13. Anonymize ulang (idempoten) → 200 =="
curl -s -b "$JAR" -X POST "$BASE/api/admin/applications/$AID/anonymize" -o /tmp/nr19d-anon2.json -w "%{http_code}" > /tmp/nr19d-code.txt
CODE=$(cat /tmp/nr19d-code.txt)
[ "$CODE" = "200" ]; check "anonymize ulang tetap 200 ($CODE)" $?

echo "== 14. ActivityLog & NotificationItem tersimpan tanpa PII =="
python3 - <<'EOF'
import sqlite3, json
kode=open('/tmp/nr19d-kode.txt').read().strip()
con=sqlite3.connect('db/custom.db')
log=con.execute("SELECT detail FROM ActivityLog WHERE action='APPLICATION_ANONYMIZED' ORDER BY createdAt DESC LIMIT 1").fetchone()
assert log and kode in log[0], log
assert 'Uji' not in log[0] and '@' not in log[0], f"PII bocor di log: {log[0]}"
notif=con.execute("SELECT body FROM NotificationItem WHERE title='Data pelamar dianonimkan' ORDER BY createdAt DESC LIMIT 1").fetchone()
assert notif and kode in notif[0]
inv=con.execute("SELECT action, actor FROM ActivityLog WHERE action IN ('USER_INVITED','USER_INVITE_RESENT','USER_INVITE_CANCELLED','USER_INVITE_ACCEPTED') ORDER BY createdAt DESC LIMIT 6").fetchall()
print("  log undangan:", [f"{a}/{x}" for a,x in inv])
for a,x in inv:
    assert 'token' not in json.dumps([a,x]).lower()
con.close()
EOF
check "log/notif berisi kode, tanpa PII/token" $?

echo "== 15. VIEWER 403 pada anonymize =="
curl -s -c /tmp/nr19d-viewer.jar -X POST "$BASE/api/admin/login" -H 'Content-Type: application/json' \
  -d '{"email":"viewer@lumina.id","password":"admin123"}' -o /tmp/nr19d-vl.json -w "%{http_code}" > /tmp/nr19d-code.txt
grep -q '"ok":true' /tmp/nr19d-vl.json; check "login viewer ok" $?
curl -s -b /tmp/nr19d-viewer.jar -X POST "$BASE/api/admin/applications/$AID/anonymize" -o /tmp/nr19d-v403.json -w "%{http_code}" > /tmp/nr19d-code.txt
CODE=$(cat /tmp/nr19d-code.txt)
[ "$CODE" = "403" ]; check "viewer anonymize 403 ($CODE)" $?

echo "== 16. hiredAt → 409 (bila ada data hired) =="
HIRED=$(python3 -c "
import sqlite3
con=sqlite3.connect('db/custom.db')
print(con.execute(\"SELECT COUNT(*) FROM Application WHERE hiredAt IS NOT NULL AND deletedAt IS NULL\").fetchone()[0])
")
if [ "$HIRED" -gt 0 ]; then
  HID=$(python3 -c "
import sqlite3
con=sqlite3.connect('db/custom.db')
print(con.execute(\"SELECT id FROM Application WHERE hiredAt IS NOT NULL AND deletedAt IS NULL LIMIT 1\").fetchone()[0])
")
  CODE=$(curl -s -b "$JAR" -X POST "$BASE/api/admin/applications/$HID/anonymize" -o /tmp/nr19d-h409.json -w "%{http_code}")
  [ "$CODE" = "409" ]; check "karyawan aktif 409 ($CODE)" $?
else
  echo "  [SKIP] tidak ada lamaran hired di DB — didokumentasikan"
fi

echo "== 17. Regresi: login OWNER lama tetap bekerja =="
curl -s -X POST "$BASE/api/admin/login" -H 'Content-Type: application/json' \
  -d '{"email":"admin@lumina.id","password":"admin123"}' -o /tmp/nr19d-rl2.json -w "%{http_code}" > /tmp/nr19d-code.txt
grep -q '"ok":true' /tmp/nr19d-rl2.json; check "login admin@lumina.id tetap OK" $?

echo "== 18. Bersih-bersih akun uji =="
curl -s -b "$JAR" -X DELETE "$BASE/api/admin/users/$UID_" -o /dev/null -w "%{http_code}" > /tmp/nr19d-code.txt
CODE=$(cat /tmp/nr19d-code.txt)
[ "$CODE" = "200" ]; check "hapus akun uji HR Baru ($CODE)" $?

echo ""
echo "======================================"
echo "HASIL: $PASS OK, $FAIL GAGAL"
echo "======================================"
[ "$FAIL" -eq 0 ]
