import { Database } from "bun:sqlite";
const d = new Database("/home/z/my-project/backups/custom.db.demo-seed.bak", { readonly: true });
const pos = d.query("SELECT COUNT(*) as c FROM Position WHERE deletedAt IS NULL").get();
const apps = d.query("SELECT COUNT(*) as c FROM Application").get();
const titles = d.query("SELECT title FROM Position WHERE deletedAt IS NULL ORDER BY \"order\"").all();
await Bun.write("/tmp/bak-out.json", JSON.stringify({ pos, apps, titles }, null, 2));
console.log("OK");
