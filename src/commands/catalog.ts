import type { Command } from 'commander';
import { authedClient, globalOptions } from '../context.js';
import type { components } from '../generated/openapi.js';
import { t } from '../i18n.js';
import { printJson, printLine, printTable } from '../output.js';
import { parseId } from './servers.js';

type Project = components['schemas']['ProjectResponseDto'];
type StatusPage = components['schemas']['StatusPageResponseDto'];

/**
 * Where the ids for `--project` and `--page` come from. The lists are
 * read-only here: projects and pages are set up in the panel.
 */
export function registerCatalogCommands(program: Command): void {
  program
    .command('projects')
    .description(t.cmdProjects)
    .command('list')
    .description(t.cmdProjectsList)
    .action(async (_opts: unknown, command: Command) => {
      const { client } = await authedClient(command);
      const projects = await client.call<Project[]>({
        method: 'GET',
        path: '/v1/projects',
      });
      if (globalOptions(command).json) {
        printJson(projects);
        return;
      }
      if (!projects.length) {
        printLine(t.projectsEmpty);
        return;
      }
      printTable(
        [t.colId, t.colName],
        projects.map((project) => [project.id, project.name]),
      );
    });

  program
    .command('pages')
    .description(t.cmdPages)
    .command('list')
    .description(t.cmdPagesList)
    .option('--project <id>', t.optProject, parseId)
    .action(async (opts: { project?: number }, command: Command) => {
      const { client } = await authedClient(command);
      let pages = await client.call<StatusPage[]>({
        method: 'GET',
        path: '/v1/status-pages',
      });
      if (opts.project !== undefined) {
        pages = pages.filter((page) => page.project_id === opts.project);
      }
      if (globalOptions(command).json) {
        // The full page carries its reports, maintenance and groups; the
        // list keeps what identifies it.
        printJson(
          pages.map((page) => ({
            id: page.id,
            name: page.name,
            slug: page.slug,
            domains: page.domains,
            is_published: page.is_published,
            project_id: page.project_id,
          })),
        );
        return;
      }
      if (!pages.length) {
        printLine(t.pagesEmpty);
        return;
      }
      printTable(
        [t.colId, t.colName, t.colSlug, t.colPublished, t.colProject],
        pages.map((page) => [
          page.id,
          page.name,
          page.slug,
          page.is_published ? t.yes : t.no,
          page.project_id,
        ]),
      );
    });
}
