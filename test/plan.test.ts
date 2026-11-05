import { describe, expect, it } from 'vitest';
import { CliError } from '../src/errors.js';
import type {
  DesiredConfig,
  DesiredScenario,
} from '../src/scenarios/config.js';
import { buildDeployPlan, type ScenarioServer } from '../src/scenarios/plan.js';

const desired = (over: Partial<DesiredScenario> = {}): DesiredScenario => ({
  name: 'Checkout',
  file: 'checkout.spec.ts',
  script: 'test("a", async () => {})',
  interval: 300,
  timeout: 30,
  location: 'msk-1',
  ...over,
});

const server = (over: Partial<ScenarioServer> = {}): ScenarioServer => ({
  id: 10,
  name: 'Checkout',
  project_id: 100000,
  protocol: 'scenario',
  scenario_script: 'test("a", async () => {})',
  scenario_env_keys: [],
  check_interval: 300,
  request_timeout: 30,
  locations: ['msk-1'],
  ...over,
});

const config = (...scenarios: DesiredScenario[]): DesiredConfig => ({
  projectId: 100000,
  scenarios,
});

describe('buildDeployPlan', () => {
  it('creates a missing scenario with the fields the API requires', () => {
    const plan = buildDeployPlan(config(desired()), []);
    expect(plan.steps).toHaveLength(1);
    const step = plan.steps[0]!;
    expect(step.kind).toBe('create');
    if (step.kind !== 'create') return;
    expect(step.body).toMatchObject({
      project_id: 100000,
      protocol: 'scenario',
      host: 'scenario',
      is_follow_redirects: true,
      is_ssl_check: false,
      is_domain_check: false,
      locations: ['msk-1'],
    });
  });

  it('leaves an identical scenario alone', () => {
    const plan = buildDeployPlan(config(desired()), [server()]);
    expect(plan.steps[0]?.kind).toBe('unchanged');
  });

  it('sends only changed fields and adds protocol with the interval', () => {
    const plan = buildDeployPlan(config(desired({ interval: 7200 })), [
      server(),
    ]);
    const step = plan.steps[0]!;
    expect(step.kind).toBe('update');
    if (step.kind !== 'update') return;
    expect(step.fields).toEqual(['interval']);
    expect(step.body).toEqual({ check_interval: 7200, protocol: 'scenario' });
  });

  it('deletes env names absent from the config with null', () => {
    const plan = buildDeployPlan(config(desired({ env: { A: '1' } })), [
      server({ scenario_env_keys: ['A', 'OLD'] }),
    ]);
    const step = plan.steps[0]!;
    if (step.kind !== 'update') throw new Error('expected update');
    expect(step.body.scenario_env).toEqual({ A: '1', OLD: null });
  });

  it('keeps server env untouched when the config has no env', () => {
    const plan = buildDeployPlan(config(desired()), [
      server({ scenario_env_keys: ['A'] }),
    ]);
    expect(plan.steps[0]?.kind).toBe('unchanged');
  });

  it('rejects a script already used by another server in the account', () => {
    expect(() =>
      buildDeployPlan(config(desired({ name: 'New' })), [
        server({ id: 77, name: 'Other', project_id: 200000 }),
      ]),
    ).toThrow(CliError);
  });

  it('rejects two config entries with one script', () => {
    expect(() =>
      buildDeployPlan(config(desired(), desired({ name: 'Copy' })), []),
    ).toThrow(CliError);
  });

  it('rejects an ambiguous name in the project', () => {
    expect(() =>
      buildDeployPlan(config(desired({ script: 'x' })), [
        server({ id: 1, scenario_script: 'a' }),
        server({ id: 2, scenario_script: 'b' }),
      ]),
    ).toThrow(CliError);
  });

  it('renames through a pinned id', () => {
    const plan = buildDeployPlan(
      config(desired({ id: 10, name: 'Checkout v2' })),
      [server()],
    );
    const step = plan.steps[0]!;
    if (step.kind !== 'update') throw new Error('expected update');
    expect(step.body).toEqual({ name: 'Checkout v2' });
  });

  it('reports scenarios of the project the config does not mention', () => {
    const plan = buildDeployPlan(config(desired()), [
      server(),
      server({ id: 11, name: 'Manual', scenario_script: 'other' }),
      server({
        id: 12,
        name: 'Elsewhere',
        project_id: 1,
        scenario_script: 'z',
      }),
    ]);
    expect(plan.unmanaged).toEqual([{ id: 11, name: 'Manual' }]);
  });
});
