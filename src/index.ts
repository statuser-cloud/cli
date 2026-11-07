#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import { CLI_VERSION } from './client.js';
import { registerApiCommand } from './commands/api.js';
import { registerAuthCommands } from './commands/auth.js';
import { registerCatalogCommands } from './commands/catalog.js';
import { registerConfigCommands } from './commands/config.js';
import { registerHeartbeatCommands } from './commands/heartbeat.js';
import { registerIncidentsCommands } from './commands/incidents.js';
import { registerReportsCommands } from './commands/reports.js';
import { registerMaintenanceCommands } from './commands/maintenance.js';
import { registerScenariosCommands } from './commands/scenarios.js';
import { registerServersCommands } from './commands/servers.js';
import { CliError, ExitCode, StatuserApiError } from './errors.js';
import { localizeCommander } from './commander-i18n.js';
import { t } from './i18n.js';
import { printErr } from './output.js';

const program = new Command()
  .name('statuser')
  .description(t.programDescription)
  .version(CLI_VERSION, '-V, --version', t.versionOption)
  .option('--json', t.optJson)
  .option('--api-url <url>', t.optApiUrl)
  .option('--debug', t.optDebug)
  .showHelpAfterError()
  .exitOverride();
localizeCommander(program);

registerAuthCommands(program);
registerApiCommand(program);
registerServersCommands(program);
registerCatalogCommands(program);
registerMaintenanceCommands(program);
registerScenariosCommands(program);
registerConfigCommands(program);
registerIncidentsCommands(program);
registerReportsCommands(program);
registerHeartbeatCommands(program);

// No top-level await: the standalone binary runs this as CommonJS.
program.parseAsync(process.argv).catch((error: unknown) => {
  process.exitCode = handleError(error);
});

function handleError(error: unknown): number {
  if (error instanceof CommanderError) {
    // Help and version also come through here, with exit code 0.
    return error.exitCode === 0 ? ExitCode.Ok : ExitCode.Usage;
  }
  if (error instanceof StatuserApiError) {
    printErr(error.status === 401 ? t.unauthorized : error.format());
    return error.exitCode;
  }
  if (error instanceof CliError) {
    printErr(error.message);
    return error.exitCode;
  }
  printErr(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  return ExitCode.Failure;
}
