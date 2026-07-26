const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const AjvModule = require("ajv");
const Ajv = AjvModule.default ?? AjvModule;

const CONTRACTS_DIR = __dirname;
const FEATURE_DIR = path.dirname(CONTRACTS_DIR);
const FIXTURES_DIR = path.join(FEATURE_DIR, "fixtures");

const contractNames = [
  "turn-decision",
  "task-command",
  "adapter-result",
  "domain-event",
  "medical-appointment-completion"
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function buildAjv() {
  const ajv = new Ajv({
    allErrors: true,
    strict: false,
    validateSchema: true
  });

  try {
    const addFormatsModule = require("ajv-formats");
    const addFormats = addFormatsModule.default ?? addFormatsModule;
    addFormats(ajv);
  } catch {
    // Ajv 6 includes the formats used by these draft-07 contracts.
  }

  return ajv;
}

function formatErrors(errors) {
  return JSON.stringify(errors ?? [], null, 2);
}

test("all contract schemas are valid draft-07 JSON Schemas with unique ids", () => {
  const ajv = buildAjv();
  const ids = new Set();

  for (const name of contractNames) {
    const schema = readJson(path.join(CONTRACTS_DIR, `${name}.schema.json`));
    assert.equal(
      ajv.validateSchema(schema),
      true,
      `${name} is not a valid JSON Schema: ${formatErrors(ajv.errors)}`
    );
    assert.ok(schema.$id, `${name} must declare $id`);
    assert.equal(ids.has(schema.$id), false, `${name} has a duplicate $id`);
    ids.add(schema.$id);
    assert.doesNotThrow(() => ajv.compile(schema), `${name} must compile`);
  }
});

for (const name of contractNames) {
  test(`${name} accepts all valid fixtures`, () => {
    const ajv = buildAjv();
    const schema = readJson(path.join(CONTRACTS_DIR, `${name}.schema.json`));
    const validate = ajv.compile(schema);
    const cases = readJson(path.join(FIXTURES_DIR, `${name}.valid.json`));

    assert.ok(cases.length > 0, `${name} needs at least one valid fixture`);
    for (const fixture of cases) {
      assert.equal(
        validate(fixture.value),
        true,
        `${fixture.name} should be valid: ${formatErrors(validate.errors)}`
      );
    }
  });

  test(`${name} rejects all invalid fixtures`, () => {
    const ajv = buildAjv();
    const schema = readJson(path.join(CONTRACTS_DIR, `${name}.schema.json`));
    const validate = ajv.compile(schema);
    const cases = readJson(path.join(FIXTURES_DIR, `${name}.invalid.json`));

    assert.ok(cases.length > 0, `${name} needs at least one invalid fixture`);
    for (const fixture of cases) {
      assert.equal(
        validate(fixture.value),
        false,
        `${fixture.name} should be invalid`
      );
    }
  });
}

