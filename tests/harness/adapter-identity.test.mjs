// LA-01/02: executable project-owned fixture adapters, not live generator qualification.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";
import { testEnv } from "../helpers/env.mjs";
import { runNode } from "../helpers/run.mjs";
import { loadConfig } from "../../ship/.agents/harness/config.mjs";
import { checkObligation } from "../../ship/.agents/harness/adapter/check.mjs";
import { executionProblem } from "../../ship/.agents/harness/adapter/evidence.mjs";
import { lintProject } from "../../ship/.agents/harness/adapter/lint.mjs";

const ids = ["test/service.test.mjs#health", "test/service.test.mjs#missing"];
// The fixture's catalogue is deliberately project-owned. No stack logic is shipped in the helper.
const hook = `import fs from 'node:fs';
const ids = ${JSON.stringify(ids)};
const file = 'test/service.test.mjs';
const mode = fs.readFileSync('mode', 'utf8');
const req = JSON.parse(fs.readFileSync(0, 'utf8'));
let response;
if (req.op === 'parse') {
  const expanded = [file, 'all'].includes(req.argument) ? ids : [req.argument];
  response = { targets: mode === 'old' || mode.startsWith('mapped') ? [req.argument] : expanded };
} else if (req.op === 'resolve') {
  response = { results: req.targets.map(target => ({ target,
    status: [...ids, file, 'all', 'zero', 'partial', 'failure'].includes(target) ? 'ok' : 'missing' })) };
} else if (req.op === 'evidence') {
  const log = JSON.parse(fs.readFileSync(req.stdoutPath, 'utf8'));
  let targets = log.completed;
  // A retained file ID requires all independently declared members AND the runner's completion record.
  if (mode.startsWith('mapped') && log.fileComplete && ids.every(id => targets.includes(id))) targets = [...targets, file];
  response = { executed: { count: log.completed.length, targets }, failed: [], outcome: 'passed' };
}
console.log(JSON.stringify({ v: 1, ...response }));
`;
const runner = `import fs from 'node:fs';
import assert from 'node:assert/strict';
const ids = ${JSON.stringify(ids)};
const mode = fs.readFileSync('mode', 'utf8');
const args = process.argv.slice(2);
fs.writeFileSync('ran.json', JSON.stringify(args), 'utf8');
const cases = new Map([[ids[0], () => assert.equal(2 + 2, 4)], [ids[1], () => assert.equal([].length, 0)]]);
const expanded = args.some(x => ['all', 'test/service.test.mjs', 'partial', 'failure'].includes(x)) ? ids : args;
const completed = [];
for (const id of expanded) {
  if (args.includes('partial') && id === ids[1]) continue;
  const run = cases.get(id);
  if (run) { run(); completed.push(id); }
}
// Negative controls intentionally alter completed records or runner exit, never production configuration.
if (mode === 'mapped-partial') completed.pop();
console.log(JSON.stringify({ completed, fileComplete: mode !== 'mapped-incomplete' && completed.length === 2 }));
if (args.includes('failure')) process.exitCode = 3;
`;
function fixture(mode = 'normal') {
  return makeTempProject({ git: false, files: { 'tools/hook.mjs': hook, 'tools/run.mjs': runner, mode },
    overlay: { adapter: {
      commands: { build: null, test: null, build_timeout_s: 5, test_timeout_s: 5, gates: [],
        verify: { checks: { argv: [process.execPath, 'tools/run.mjs', '{targets}'], timeout_s: 5 } } },
      verify_vocabulary: { test: { prefix: 'test:', parser: 'tools/hook.mjs', resolver: 'tools/hook.mjs',
        runner: 'checks', evidence_parser: 'tools/hook.mjs', exit_code_sufficient: false } },
    } } });
}
const check = (p, selector) => checkObligation(loadConfig(p.root), { codeRoot: p.root, kind: 'test', command: `test:${selector}`, execute: true });

for (const selector of ['test/service.test.mjs', 'all', ids[0]]) {
  test(`ADPT-17 canonical identity round trip: ${selector}`, async () => {
    const p = fixture();
    const expected = selector === ids[0] ? [ids[0]] : ids;
    const r = await check(p, selector);
    assert.equal(r.outcome, 'passed', r.reason);
    assert.deepEqual(r.obligation.targets, expected);
    assert.deepEqual(r.resolve.response.results.map(x => x.target), expected);
    assert.deepEqual(p.readJson('ran.json'), expected);
    assert.deepEqual(r.evidence.response.executed, { count: expected.length, targets: expected });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(r.directory, 'check.json'), 'utf8')), r);
  });
}

test('ADPT-17 retained multi-test file identity requires runner membership and completion proof', async () => {
  const p = fixture('mapped');
  const r = await check(p, 'test/service.test.mjs');
  assert.equal(r.outcome, 'passed', r.reason);
  assert.deepEqual(r.obligation.targets, ['test/service.test.mjs']);
  assert.deepEqual(r.evidence.response.executed, { count: 2, targets: [...ids, 'test/service.test.mjs'] });
  for (const mode of ['mapped-partial', 'mapped-incomplete']) {
    const q = fixture(mode);
    assert.match((await check(q, 'test/service.test.mjs')).reason, /not executed/);
  }
});

for (const selector of ['test/service.test.mjs', 'all']) {
  test(`ADPT-17 old selector-to-member mismatch remains rejected: ${selector}`, async () => {
    const r = await check(fixture('old'), selector);
    assert.equal(r.runner.exitCode, 0);
    assert.equal(r.evidence.response.executed.count, 2);
    assert.equal(r.outcome, 'failed');
    assert.match(r.reason, /not executed/);
  });
}

test('ADPT-17 original live payloads do not prove their file or suite target', () => {
  for (const [target, targets] of [['test/service.test.mjs', ['health', 'missing']], ['all', ['greeting', 'usage']]]) {
    assert.match(executionProblem({ targets: [target], executed: { count: 2, targets } }), /not executed/);
  }
});

test('ADPT-17 zero execution is rejected even with a passed evidence response and exit zero', async () => {
  const r = await check(fixture(), 'zero');
  assert.equal(r.outcome, 'failed');
  assert.match(r.reason, /executed 0/);
});

test('ADPT-17 missing executed member is rejected independently of resolver success', async () => {
  const p = fixture();
  p.write('tools/hook.mjs', hook.replace("[file, 'all']", "[file, 'all', 'partial']"));
  // The negative runner drops one of the canonical selected members.
  p.write('tools/run.mjs', runner.replace("args.includes('partial')", 'true'));
  const r = await check(p, 'partial');
  assert.deepEqual(r.obligation.targets, ids);
  assert.equal(r.evidence.response.executed.count, 1);
  assert.match(r.reason, /missing not executed/);
});

test('ADPT-17 failed runner cannot pass even if evidence claims success and covers the target', async () => {
  const p = fixture();
  p.write('tools/run.mjs', runner.replace("if (args.includes('failure'))", 'if (true)'));
  const r = await check(p, ids[0]);
  assert.equal(r.runner.exitCode, 3);
  assert.deepEqual(r.evidence.response.executed.targets, [ids[0]]);
  assert.match(r.reason, /runner did not succeed/);
});

test('ADPT-15 unknown target stops before running; empty parse cannot pass', async () => {
  const p = fixture();
  const r = await check(p, 'not-a-target');
  assert.equal(r.outcome, 'failed');
  assert.match(r.reason, /missing/);
  assert.equal(fs.existsSync(p.path('ran.json')), false);
  p.write('tools/hook.mjs', hook.replace('const expanded =', 'const unused =').replace(' : expanded };', ' : [] };'));
  const empty = await check(p, 'all');
  assert.match(empty.reason, /no concrete targets/);
  assert.equal(fs.existsSync(p.path('ran.json')), false);
});

test('HARN-05 lint is structural; dynamic check requires explicit opt-in, including CLI', async () => {
  const p = fixture();
  lintProject(p.root);
  assert.equal(fs.existsSync(p.path('ran.json')), false);
  await assert.rejects(checkObligation(loadConfig(p.root), { codeRoot: p.root, kind: 'test', command: 'test:all' }), /opt-in/);
  const cli = path.join(SHIP_DIR, '.agents/harness/adapter/check.mjs');
  const opts = { cwd: p.root, env: testEnv({ PASEO_HARNESS_ROOT: p.root }) };
  const refused = await runNode(cli, ['--kind', 'test', '--command', 'test:all'], opts);
  assert.equal(refused.code, 1);
  assert.equal(fs.existsSync(p.path('ran.json')), false);
  const passed = await runNode(cli, ['--kind', 'test', '--command', 'test:all', '--run'], opts);
  assert.equal(passed.code, 0, passed.stderr);
  const failed = await runNode(cli, ['--kind', 'test', '--command', 'test:unknown', '--run'], opts);
  assert.equal(failed.code, 2, failed.stderr);
});
