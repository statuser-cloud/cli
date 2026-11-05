import type { StatuserClient } from './client.js';
import { CliError, ExitCode } from './errors.js';
import type { components } from './generated/openapi.js';
import { t } from './i18n.js';

type StatusPage = components['schemas']['StatusPageResponseDto'];

/** Ids of the servers shown on a status page, for `--all-servers`. */
export async function pageServerIds(
  client: StatuserClient,
  pageId: number,
): Promise<number[]> {
  const page = await client.call<StatusPage>({
    method: 'GET',
    path: `/v1/status-pages/${pageId}`,
  });
  const ids = page.servers.map((server) => server.server_id);
  if (!ids.length) {
    throw new CliError(t.maintenancePageEmpty(pageId), ExitCode.Usage);
  }
  return ids;
}
