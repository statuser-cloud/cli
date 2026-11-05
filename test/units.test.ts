import { describe, expect, it } from 'vitest';
import { redactUrl } from '../src/client.js';
import { parseDuration } from '../src/duration.js';
import { parseApiErrorBody } from '../src/errors.js';
import { detectLang } from '../src/i18n.js';
import { resolveEnvValue } from '../src/scenarios/config.js';

describe('parseDuration', () => {
  it.each([
    ['30m', 30 * 60_000],
    ['2h', 2 * 3_600_000],
    ['1h30m', 90 * 60_000],
    ['45s', 45_000],
  ])('%s', (raw, ms) => expect(parseDuration(raw)).toBe(ms));

  it.each(['', '0m', '5x', '1d', 'm'])('rejects %j', (raw) =>
    expect(() => parseDuration(raw)).toThrow(),
  );
});

describe('detectLang', () => {
  it('follows LC_ALL over LANG', () => {
    expect(detectLang({ LC_ALL: 'ru_RU.UTF-8', LANG: 'en_US.UTF-8' })).toBe(
      'ru',
    );
    expect(detectLang({ LC_ALL: 'en_US.UTF-8', LANG: 'ru_RU.UTF-8' })).toBe(
      'en',
    );
  });
});

describe('resolveEnvValue', () => {
  it('reads $NAME and ${NAME} from the environment', () => {
    expect(resolveEnvValue('$PASS', 's', { PASS: 'x' })).toBe('x');
    expect(resolveEnvValue('${PASS}', 's', { PASS: 'x' })).toBe('x');
  });

  it('keeps literals', () => {
    expect(resolveEnvValue('user@example.com', 's', {})).toBe(
      'user@example.com',
    );
  });

  it('fails on a missing variable', () => {
    expect(() => resolveEnvValue('$MISSING', 's', {})).toThrow();
  });
});

describe('redactUrl', () => {
  it('hides the heartbeat token', () => {
    expect(
      redactUrl('https://api.statuser.cloud/v1/heartbeat/secret/fail'),
    ).toBe('https://api.statuser.cloud/v1/heartbeat/***/fail');
  });
});

describe('parseApiErrorBody', () => {
  it('joins validation messages', () => {
    const error = parseApiErrorBody(
      400,
      JSON.stringify({ message: ['a', 'b'], error_code: 'bad' }),
    );
    expect(error.message).toBe('a; b');
    expect(error.errorCode).toBe('bad');
  });
});
