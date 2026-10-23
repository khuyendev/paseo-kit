// The kit's own structured-output validator (FLOW-13, FLOW-46): a closed JSON Schema subset, checked when agent() is
// called and applied to the agent's final message. No Paseo structured-output helper (D-30).
const TYPES = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);
const KEYWORDS = new Set([
  "type", "properties", "required", "additionalProperties", "items", "enum", "const",
  "minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems",
  "description", "title", "default", "examples",
]);
const NUMBER_KEYS = ["minimum", "maximum"];
const COUNT_KEYS = ["minLength", "maxLength", "minItems", "maxItems"];

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const at = (path) => path || "/";

function checkNode(node, path) {
  if (!isObject(node)) throw new Error(`schema ${at(path)}: expected an object`);
  for (const key of Object.keys(node)) {
    if (!KEYWORDS.has(key)) throw new Error(`schema ${at(path)}: unsupported keyword '${key}' (the kit validator supports ${[...KEYWORDS].join(", ")})`);
  }
  if (node.type !== undefined) {
    const types = Array.isArray(node.type) ? node.type : [node.type];
    if (!types.length || !types.every((t) => TYPES.has(t))) throw new Error(`schema ${at(path)}: type must be one of ${[...TYPES].join(", ")} or an array of them`);
  }
  if (node.properties !== undefined) {
    if (!isObject(node.properties)) throw new Error(`schema ${at(path)}: properties must be an object`);
    for (const [name, sub] of Object.entries(node.properties)) checkNode(sub, `${path}/properties/${name}`);
  }
  if (node.required !== undefined) {
    if (!Array.isArray(node.required) || !node.required.every((k) => typeof k === "string")) throw new Error(`schema ${at(path)}: required must be an array of strings`);
    for (const key of node.required) {
      if (!isObject(node.properties) || !Object.hasOwn(node.properties, key)) throw new Error(`schema ${at(path)}: required names '${key}', which is not in properties`);
    }
  }
  if (node.additionalProperties !== undefined && typeof node.additionalProperties !== "boolean") throw new Error(`schema ${at(path)}: additionalProperties must be true or false`);
  if (node.items !== undefined) checkNode(node.items, `${path}/items`);
  if (node.enum !== undefined && (!Array.isArray(node.enum) || !node.enum.length)) throw new Error(`schema ${at(path)}: enum must be a non-empty array`);
  for (const key of NUMBER_KEYS) {
    if (node[key] !== undefined && typeof node[key] !== "number") throw new Error(`schema ${at(path)}: ${key} must be a number`);
  }
  for (const key of COUNT_KEYS) {
    if (node[key] !== undefined && !(Number.isInteger(node[key]) && node[key] >= 0)) throw new Error(`schema ${at(path)}: ${key} must be an integer >= 0`);
  }
}

// Throws for a schema agent() must refuse: the root shape of FLOW-13 and any keyword outside the subset (fail closed).
export function checkSchema(schema) {
  if (!isObject(schema) || schema.type !== "object" || !isObject(schema.properties)) {
    throw new Error("schema needs {type: 'object', properties: {...}} at the root");
  }
  checkNode(schema, "");
  return schema;
}

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

const typeMatches = (want, got) => want === got || (want === "number" && got === "integer");
// enum and const equality: object members match by key set and value (key order is not data), array order counts.
const same = (a, b) => {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (isObject(a) && isObject(b)) return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => Object.hasOwn(b, k) && same(a[k], b[k]));
  return a === b;
};

function validateNode(value, node, path, errors) {
  const got = typeOf(value);
  if (node.type !== undefined) {
    const types = Array.isArray(node.type) ? node.type : [node.type];
    if (!types.some((t) => typeMatches(t, got))) {
      errors.push(`${at(path)}: expected ${types.join(" or ")}`);
      return;
    }
  }
  if (node.enum !== undefined && !node.enum.some((v) => same(v, value))) errors.push(`${at(path)}: expected one of ${node.enum.map((v) => JSON.stringify(v)).join(", ")}`);
  if (node.const !== undefined && !same(node.const, value)) errors.push(`${at(path)}: expected ${JSON.stringify(node.const)}`);
  if (got === "number" || got === "integer") {
    if (node.minimum !== undefined && value < node.minimum) errors.push(`${at(path)}: must be >= ${node.minimum}`);
    if (node.maximum !== undefined && value > node.maximum) errors.push(`${at(path)}: must be <= ${node.maximum}`);
  }
  if (got === "string") {
    const length = [...value].length;
    if (node.minLength !== undefined && length < node.minLength) errors.push(`${at(path)}: must have at least ${node.minLength} characters`);
    if (node.maxLength !== undefined && length > node.maxLength) errors.push(`${at(path)}: must have at most ${node.maxLength} characters`);
  }
  if (got === "array") {
    if (node.minItems !== undefined && value.length < node.minItems) errors.push(`${at(path)}: must have at least ${node.minItems} items`);
    if (node.maxItems !== undefined && value.length > node.maxItems) errors.push(`${at(path)}: must have at most ${node.maxItems} items`);
    if (node.items) value.forEach((item, i) => validateNode(item, node.items, `${path}/${i}`, errors));
  }
  if (got === "object") {
    const props = node.properties ?? {};
    for (const key of node.required ?? []) if (!Object.hasOwn(value, key)) errors.push(`${path}/${key}: missing required property`);
    for (const [key, item] of Object.entries(value)) {
      if (Object.hasOwn(props, key)) validateNode(item, props[key], `${path}/${key}`, errors);
      else if (node.additionalProperties === false) errors.push(`${path}/${key}: property not allowed`);
    }
  }
}

// Validation errors of `value` against a checked schema, each with its JSON path (`/plans/2/id: expected string`).
export function validate(value, schema) {
  const errors = [];
  validateNode(value, schema, "", errors);
  return errors;
}

// The final message parsed as JSON (one surrounding code fence tolerated); unparsable JSON is a validation error.
export function parseReply(text, schema) {
  let body = String(text ?? "").trim();
  const fence = /^```[A-Za-z]*\r?\n([\s\S]*?)\r?\n```$/.exec(body);
  if (fence) body = fence[1].trim();
  let value;
  try {
    value = JSON.parse(body);
  } catch (e) {
    return { value: undefined, errors: [`/: invalid JSON (${String(e.message).split("\n")[0]})`] };
  }
  return { value, errors: validate(value, schema) };
}
