// Quick cleanup: remove failed classification reports (confidence = 0)
const Database = require("better-sqlite3");
const db = new Database("./data/community.db");

const bad = db.prepare(
  `SELECT id, summary, confidence FROM reports WHERE confidence = 0 AND status = 'classified'`
).all();

console.log(`Found ${bad.length} failed reports:`);
bad.forEach(r => console.log(`  ${r.id} - ${(r.summary || "").substring(0, 70)}`));

if (bad.length > 0) {
  const result = db.prepare(
    `DELETE FROM reports WHERE confidence = 0 AND status = 'classified'`
  ).run();
  console.log(`Deleted ${result.changes} reports.`);
} else {
  console.log("Nothing to clean.");
}

db.close();
