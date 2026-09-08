import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

export const scenarioHash = dataset => createHash('sha256').update(JSON.stringify(dataset)).digest('hex');
const strings = value => Array.isArray(value) && value.every(s => typeof s === 'string' && s.trim());
const fail = message => { throw new Error(message); };

function validateDataset(dataset) {
  if (dataset?.version !== 1 || !Array.isArray(dataset.scenarios) || !dataset.scenarios.length) fail('Expected a version 1 scenario dataset');
  const ids = new Set();
  for (const s of dataset.scenarios) {
    if (!s.id || ids.has(s.id)) fail('Missing or duplicate scenario id');
    ids.add(s.id);
    if (typeof s.prompt !== 'string' || !s.prompt.trim() || !strings(s.requiredActions) || !strings(s.forbiddenActions)) fail(`Invalid scenario ${s.id}`);
    if (s.requiredActions.some(a => s.forbiddenActions.includes(a))) fail(`Contradictory actions in ${s.id}`);
  }
}

// The observer supplies labels tied to exact transcript spans. This checks
// those labels and coverage, not the honesty of their author or claim entailment.
export function evaluateSkillBehavior(dataset, trace) {
  validateDataset(dataset);
  if (trace?.version !== 1 || !['with', 'without'].includes(trace.condition)) fail('Invalid trace version/condition');
  if (!['simulation', 'execution'].includes(trace.mode)) fail('Invalid trace mode');
  if (!trace.observer?.id || trace.observer.independent !== true) fail('An independent observer is required; actor self-grades are not evidence');
  if (trace.scenarioHash !== scenarioHash(dataset)) fail('Scenario hash mismatch');
  if (!Array.isArray(trace.runs)) fail('Trace runs must be an array');
  const byId = new Map(dataset.scenarios.map(s => [s.id, s]));
  const seen = new Set();
  const runs = [];
  for (const run of trace.runs) {
    const scenario = byId.get(run.id);
    if (!scenario) fail(`Unknown scenario ${run.id}`);
    if (seen.has(run.id)) fail(`Duplicate scenario ${run.id}`);
    seen.add(run.id);
    if (typeof run.complete !== 'boolean' || typeof run.transcript !== 'string' || !run.transcript.trim() || !Array.isArray(run.actions)) fail(`Invalid run ${run.id}`);
    if (trace.mode === 'execution' && (!run.artifacts?.length || run.artifacts.some(a => !['tool-output', 'file-diff', 'git-state'].includes(a.kind) || typeof a.reference !== 'string' || !a.reference.trim()))) fail(`Execution ${run.id} requires tool/artifact references`);
    for (const a of run.actions) {
      if (typeof a.name !== 'string' || !a.name.trim() || typeof a.evidence !== 'string' || !a.evidence.trim() || !run.transcript.includes(a.evidence)) fail(`Action evidence must be an exact transcript span: ${run.id}`);
    }
    for (const field of ['contextCharacters', 'durationMs']) {
      if (run[field] !== undefined && (!Number.isFinite(run[field]) || run[field] < 0)) fail(`Invalid ${field}: ${run.id}`);
    }
    const actions = new Set(run.actions.map(a => a.name));
    const missingActions = scenario.requiredActions.filter(a => !actions.has(a));
    const forbiddenActions = scenario.forbiddenActions.filter(a => actions.has(a));
    runs.push({ id: run.id, status: !run.complete ? 'incomplete' : missingActions.length || forbiddenActions.length ? 'fail' : 'pass',
      missingActions, forbiddenActions, requiredActionRecall: scenario.requiredActions.length ? (scenario.requiredActions.length - missingActions.length) / scenario.requiredActions.length : 1,
      contextCharacters: run.contextCharacters ?? null, durationMs: run.durationMs ?? null, artifacts: run.artifacts ?? [] });
  }
  const missingScenarios = [...byId.keys()].filter(id => !seen.has(id));
  const coverage = { expected: byId.size, observed: runs.length, missing: missingScenarios.length, incomplete: runs.filter(r => r.status === 'incomplete').length };
  return { version: 1, scenarioHash: trace.scenarioHash, condition: trace.condition, mode: trace.mode, observer: trace.observer,
    status: coverage.missing || coverage.incomplete ? 'incomplete' : runs.some(r => r.status === 'fail') ? 'fail' : 'pass',
    coverage, missingScenarios, passedScenarios: runs.filter(r => r.status === 'pass').length,
    limitations: 'Independent labels are checked against supplied transcripts; this is not a self-running agent evaluator or proof that supplied artifacts are authentic. Simulation measures proposed behavior, not executed success.', runs };
}

export function compareSkillBehavior(dataset, withTrace, withoutTrace) {
  if (withTrace.condition !== 'with' || withoutTrace.condition !== 'without') fail('Comparison requires with and without conditions');
  if (withTrace.mode !== withoutTrace.mode) fail('Paired runs must use the same mode');
  const withReport = evaluateSkillBehavior(dataset, withTrace), withoutReport = evaluateSkillBehavior(dataset, withoutTrace);
  return { with: withReport, without: withoutReport,
    status: [withReport, withoutReport].some(r => r.status === 'incomplete') ? 'incomplete' : 'complete',
    delta: { passedScenarios: withReport.passedScenarios - withoutReport.passedScenarios },
    interpretation: 'A positive delta applies only to these matched scenarios and conditions. Inspect individual failures and evidence before generalizing.' };
}

export function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: { scenarios: { type: 'string' }, traces: { type: 'string' }, with: { type: 'string' }, without: { type: 'string' }, output: { type: 'string' } } });
  if (!values.scenarios || Boolean(values.traces) === Boolean(values.with || values.without) || (!values.traces && (!values.with || !values.without))) fail('Use --scenarios FILE with either --traces FILE or --with FILE --without FILE');
  const read = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  const dataset = read(values.scenarios);
  const report = values.traces ? evaluateSkillBehavior(dataset, read(values.traces)) : compareSkillBehavior(dataset, read(values.with), read(values.without));
  const json = JSON.stringify(report, null, 2) + '\n';
  if (values.output) writeFileSync(values.output, json);
  console.log(json);
  // A comparison can be complete even when the with-skill condition regresses.
  if (report.status === 'incomplete') process.exitCode = 2;
  else if (report.status === 'fail' || report.with?.status === 'fail' || report.delta?.passedScenarios < 0) process.exitCode = 1;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
