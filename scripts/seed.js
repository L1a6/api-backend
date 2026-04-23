"use strict";

const path = require("path");
const { v7: uuidv7 } = require("uuid");

// Resolve the seed file relative to the project root
const SEED_FILE = path.join(process.cwd(), "data", "seed_profiles.json");

// Initialise DB (will create tables/indexes via initializeSchema)
const { getDb } = require("../lib/db");

async function seed() {
  let seedData;

  try {
    seedData = require(SEED_FILE);
  } catch (err) {
    console.error(
      `\nCould not load seed file at: ${SEED_FILE}\n` +
        `Please copy seed_profiles.json into the data/ directory and retry.\n`
    );
    process.exit(1);
  }

  const profiles = seedData.profiles;

  if (!Array.isArray(profiles) || profiles.length === 0) {
    console.error("Seed file is empty or malformed.");
    process.exit(1);
  }

  console.log(`\nSeeding ${profiles.length} profiles…`);

  const db = await getDb();

  let inserted = 0;
  let skipped = 0;
  let errored = 0;

  // Use a transaction for atomicity and speed
  await db.run("BEGIN TRANSACTION");

  try {
    for (const p of profiles) {
      // Validate required fields
      if (
        typeof p.name !== "string" ||
        !p.name.trim() ||
        typeof p.gender !== "string" ||
        typeof p.age !== "number" ||
        typeof p.age_group !== "string" ||
        typeof p.country_id !== "string" ||
        typeof p.gender_probability !== "number" ||
        typeof p.country_probability !== "number"
      ) {
        console.warn(`Skipping malformed record: ${JSON.stringify(p)}`);
        errored++;
        continue;
      }

      const normalizedName = p.name.trim().toLowerCase();

      const result = await db.run(
        `INSERT OR IGNORE INTO profiles (
           id,
           normalized_name,
           name,
           gender,
           gender_probability,
           sample_size,
           age,
           age_group,
           country_id,
           country_name,
           country_probability,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv7(),
          normalizedName,
          normalizedName,                        // stored as lowercase, consistent with live creation
          p.gender.toLowerCase(),
          p.gender_probability,
          0,                                     // sample_size not provided in seed data
          p.age,
          p.age_group.toLowerCase(),
          p.country_id.toUpperCase(),
          typeof p.country_name === "string" ? p.country_name : "",
          p.country_probability,
          new Date().toISOString()
        ]
      );

      if (result && result.changes > 0) {
        inserted++;
      } else {
        skipped++;
      }
    }

    await db.run("COMMIT");
  } catch (error) {
    await db.run("ROLLBACK");
    console.error("\nSeed transaction failed — rolled back.\n", error);
    process.exit(1);
  }

  console.log(
    `\nDone!\n` +
      `  Inserted : ${inserted}\n` +
      `  Skipped  : ${skipped}  (already existed)\n` +
      `  Errored  : ${errored}  (malformed records)\n`
  );
}

seed().catch((err) => {
  console.error("Unexpected error during seeding:", err);
  process.exit(1);
});