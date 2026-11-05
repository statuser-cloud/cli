import type { Server } from '../commands/servers.js';
import {
  fieldsFor,
  isSecretHeader,
  MANAGED_PROTOCOLS,
  type ManagedProtocol,
} from './fields.js';

export interface ExportResult {
  entries: Array<Record<string, unknown>>;
  /** Environment variables the exported headers now refer to. */
  headerVariables: string[];
  /** Servers whose password, token or key is not in the file. */
  withSecrets: Array<{ id: number; name: string | null }>;
  pausedCount: number;
  scenarioCount: number;
}

/**
 * Pure: the `servers` section for a project. Every entry is built from an
 * allowlist of the fields its protocol uses — a GET response also carries
 * leftovers of a previous protocol, masks and the heartbeat token, and none
 * of that belongs in a file people commit.
 */
export function exportServers(servers: Server[]): ExportResult {
  const result: ExportResult = {
    entries: [],
    headerVariables: [],
    withSecrets: [],
    pausedCount: 0,
    scenarioCount: 0,
  };
  for (const server of [...servers].sort((a, b) => a.id - b.id)) {
    if (server.protocol === 'scenario') {
      result.scenarioCount += 1;
      continue;
    }
    if (!MANAGED_PROTOCOLS.includes(server.protocol as ManagedProtocol)) {
      continue;
    }
    const protocol = server.protocol as ManagedProtocol;
    if (server.status === 'paused') result.pausedCount += 1;

    const entry: Record<string, unknown> = {
      id: server.id,
      name: server.name,
      protocol,
    };
    const source = server as unknown as Record<string, unknown>;
    for (const field of fieldsFor(protocol)) {
      const value = source[field];
      if (value === null || value === undefined) continue;
      if (field === 'body' && value === '') continue;
      if (field === 'headers') {
        if (!Array.isArray(value) || !value.length) continue;
        entry.headers = value.map(
          (header: { key: string; value: string }, index: number) => {
            if (isSecretHeader(header.key)) {
              const variable = headerVariable(server.id, header.key, index);
              result.headerVariables.push(variable);
              return { key: header.key, value: `$${variable}` };
            }
            // A literal value starting with `$` would read as a reference.
            const literal = header.value.startsWith('$')
              ? `$${header.value}`
              : header.value;
            return { key: header.key, value: literal };
          },
        );
        continue;
      }
      entry[field] = value;
    }
    if (
      (protocol === 'http' || protocol === 'keyword'
        ? server.http_auth_type !== 'none' && server.http_auth_type !== null
        : false) ||
      (protocol === 'llm' && server.llm_api_key_masked)
    ) {
      result.withSecrets.push({ id: server.id, name: server.name });
    }
    result.entries.push(entry);
  }
  return result;
}

function headerVariable(serverId: number, header: string, index: number) {
  const name = header.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  return `STATUSER_${serverId}_${index}_${name}`.replace(/_+$/, '');
}
