import { Database } from "bun:sqlite";
const live = new Database("/home/z/my-project/db/custom.db", { readonly: true });
const bak = new Database("/home/z/my-project/backups/custom.db.demo-seed.bak", { readonly: true });
const cols = (d: any, t: string) => d.prepare(`PRAGMA table_info(${t})`).all().map((r: any) => r.name);
const liveP = cols(live, "Position"), bakP = cols(bak, "Position");
const onlyLive = liveP.filter((c) => !bakP.includes(c));
const onlyBak = bakP.filter((c) => !liveP.includes(c));
const liveA = cols(live, "Application"), bakA = cols(bak, "Application");
const onlyLiveA = liveA.filter((c) => !bakA.includes(c));
const onlyBakA = bakA.filter((c) => !liveA.includes(c));
const liveU = cols(live, "AdminUser"), bakU = cols(bak, "AdminUser");
const adminsLive = live.query("SELECT email, role FROM AdminUser").all();
const adminsBak = bak.query("SELECT email, role FROM AdminUser").all();
await Bun.write("/tmp/schema-out.json", JSON.stringify({
  positionOnlyLive: onlyLive, positionOnlyBak: onlyBak,
  applicationOnlyLive: onlyLiveA, applicationOnlyBak: onlyBakA,
  adminOnlyLive: liveU.filter((c) => !bakU.includes(c)), adminOnlyBak: bakU.filter((c) => !liveU.includes(c)),
  adminsLive, adminsBak,
}, null, 2));
console.log("OK");
