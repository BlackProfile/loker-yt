import { sanitizePositionInput } from "../src/lib/position-input";
const res = await sanitizePositionInput({ showSocialField: true }, { mode: "update", userId: "test" });
console.log(JSON.stringify(res));
