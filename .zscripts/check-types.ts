import { Database } from "bun:sqlite";
const d = new Database("/home/z/my-project/db/custom.db", { readonly: true });
const r = d.query("SELECT DISTINCT type FROM Position").all();
const one = d.query("SELECT title, description, requirements, applyTemplate, stageNotes FROM Position LIMIT 1").get();
await Bun.write("/tmp/types-out.json", JSON.stringify({ types: r, sample: one }, null, 2));
console.log("OK");
