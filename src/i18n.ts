/**
 * User-facing strings in two languages, picked from the system locale.
 *
 * Every message lives in both dictionaries: `en` is typed by `ru`, so a key
 * forgotten in one of them fails `tsc`. Commands and flags stay English.
 */

export type Lang = 'ru' | 'en';

export function detectLang(env: NodeJS.ProcessEnv = process.env): Lang {
  // POSIX precedence: LC_ALL overrides LC_MESSAGES, which overrides LANG.
  const locale = env.LC_ALL || env.LC_MESSAGES || env.LANG || '';
  if (locale.toLowerCase().startsWith('ru')) return 'ru';
  if (!locale && process.platform === 'win32') {
    const intl = Intl.DateTimeFormat().resolvedOptions().locale;
    if (intl.toLowerCase().startsWith('ru')) return 'ru';
  }
  return 'en';
}

const ru = {
  // Program
  programDescription:
    'Командная строка Statuser: сценарии как код, плановые работы в CI, heartbeat для крон-задач',
  optJson: 'вывести ответ в JSON',
  optApiUrl: 'адрес API (по умолчанию https://api.statuser.cloud)',
  optDebug: 'печатать запросы в stderr (секреты скрыты)',

  // Auth
  cmdLogin: 'сохранить API-ключ на этом компьютере',
  cmdLogout: 'удалить сохранённый API-ключ',
  cmdWhoami: 'показать аккаунт, к которому относится ключ',
  optWithToken: 'прочитать ключ из stdin, а не спрашивать',
  promptApiKey: 'API-ключ (Настройки → API в панели Statuser): ',
  loginEmptyKey: 'Ключ пустой.',
  loginNoTty:
    'Нет терминала для ввода. Передайте ключ через stdin: statuser login --with-token < key.txt',
  loginSaved: (email: string, path: string) =>
    `Готово: ${email}. Ключ сохранён в ${path}`,
  logoutDone: 'Ключ удалён.',
  logoutNothing: 'Сохранённого ключа нет.',
  whoami: (email: string, source: string) => `${email} (ключ из ${source})`,
  keySourceEnv: 'STATUSER_API_KEY',
  keySourceFile: (path: string) => `${path}`,
  noApiKey:
    'Нет API-ключа. Выполните `statuser login` или задайте STATUSER_API_KEY.',
  keyOtherOrigin: (saved: string, current: string) =>
    `Сохранённый ключ выдан для ${saved}, а запрос идёт на ${current}. Для другого адреса задайте STATUSER_API_KEY.`,
  apiKeyMalformed:
    'В ключе есть пробелы или переводы строки внутри. Скопируйте его из панели заново.',
  unauthorized:
    'Ключ не принят (401). Проверьте его в панели и выполните `statuser login` заново.',

  // Client
  apiUrlInvalid: (url: string) => `Неверный адрес API: ${url}`,
  apiUrlInsecure: (url: string) =>
    `Адрес API должен быть https (http разрешён только для localhost): ${url}`,
  foreignOrigin: (url: string) =>
    `Запрос на ${url} не отправлен: ключ уходит только на адрес API.`,
  networkError: (message: string) => `Сеть: ${message}`,

  // api
  cmdApi: 'отправить произвольный запрос к API (как `gh api`)',
  optField:
    'поле тела или query-параметр key=value (значение — JSON, если разбирается)',
  optRawField: 'поле key=value, значение всегда строка',
  optInput: 'тело запроса из файла, `-` — из stdin',
  apiFieldInvalid: (raw: string) => `Ожидается key=value: ${raw}`,
  apiFieldsWithInput: 'Нельзя одновременно передавать поля и --input.',
  apiMethodInvalid: (method: string) => `Неизвестный метод: ${method}`,
  apiPathInvalid: 'Путь должен начинаться с /, например /v1/servers',

  // servers
  cmdServers: 'серверы мониторинга',
  cmdServersList: 'список серверов',
  cmdServersGet: 'сервер по id',
  cmdServersPause: 'приостановить проверки',
  cmdServersResume: 'возобновить проверки',
  optProject: 'id проекта',
  optProtocol: 'только с этим протоколом',
  optFromFile:
    'взять id из JSON-вывода `servers pause --json` (возобновить только то, что поставили на паузу)',
  serversNoTargets: 'Укажите id серверов или --project.',
  serversEmpty: 'Серверов нет.',
  colId: 'ID',
  colName: 'Имя',
  colHost: 'Хост',
  colProtocol: 'Протокол',
  colStatus: 'Статус',
  colProject: 'Проект',
  pausedOne: (id: number) => `#${id}: на паузе`,
  resumedOne: (id: number) => `#${id}: проверки возобновлены`,
  alreadyPaused: (id: number) => `#${id}: уже был на паузе, пропущен`,
  notPaused: (id: number) => `#${id}: не на паузе, пропущен`,
  bulkFailed: (id: number, message: string) => `#${id}: ошибка — ${message}`,
  bulkSummary: (ok: number, failed: number) =>
    failed ? `Готово: ${ok}, ошибок: ${failed}` : `Готово: ${ok}`,
  invalidId: (raw: string) => `Неверный id: ${raw}`,
  fromFileInvalid: (path: string) =>
    `В ${path} нет списка серверов из \`servers pause --json\``,

  // heartbeat / run
  cmdHeartbeat: 'heartbeat-проверки',
  cmdHeartbeatPing: 'отправить сигнал heartbeat',
  optFail: 'сообщить об ошибке, а не об успехе',
  cmdRun: 'выполнить команду и отправить heartbeat по её итогу',
  optHeartbeatToken:
    'токен heartbeat (или STATUSER_HEARTBEAT_TOKEN); API-ключ тогда не нужен',
  optHeartbeatServer: 'id heartbeat-сервера — токен возьмётся по API-ключу',
  heartbeatNoToken:
    'Нужен токен: --heartbeat <токен>, STATUSER_HEARTBEAT_TOKEN или --server <id>.',
  heartbeatBothSources: 'Укажите что-то одно: токен или --server.',
  heartbeatNotHeartbeat: (id: number, protocol: string) =>
    `Сервер #${id} — не heartbeat (протокол ${protocol}).`,
  heartbeatSent: 'Сигнал отправлен.',
  heartbeatFailSent: 'Ошибка зафиксирована.',
  heartbeatSendFailed: (message: string) =>
    `Не удалось отправить heartbeat: ${message}`,
  heartbeatTokenRejected:
    'Токен heartbeat не найден (404). Проверьте его в карточке сервера.',
  runNoCommand:
    'Укажите команду после --: statuser run --heartbeat <токен> -- ./backup.sh',
  runSpawnFailed: (cmd: string, message: string) =>
    `Не удалось запустить ${cmd}: ${message}`,

  // maintenance
  cmdMaintenance: 'плановые работы на странице статуса',
  cmdMaintenanceStart: 'открыть плановые работы с текущего момента',
  cmdMaintenanceEnd: 'завершить плановые работы сейчас',
  optPage: 'id страницы статуса',
  optTitle: 'заголовок',
  optDescription: 'описание для посетителей страницы',
  optFor: 'длительность окна: 30m, 2h, 1h30m',
  optServers: 'id серверов страницы через запятую',
  optAllServers: 'все серверы страницы',
  optMessage: 'добавить сообщение в таймлайн работ (уведомит подписчиков)',
  maintenanceNoServers: 'Укажите --servers <id,…> или --all-servers.',
  maintenanceBothServers: 'Укажите что-то одно: --servers или --all-servers.',
  maintenancePageEmpty: (id: number) => `На странице #${id} нет серверов.`,
  maintenanceStarted: (id: number, until: string) =>
    `Плановые работы #${id} открыты до ${until}.`,
  maintenanceEnded: (id: number) => `Плановые работы #${id} завершены.`,
  maintenanceAlreadyEnded: (id: number) =>
    `Плановые работы #${id} уже закончились, дата окончания не менялась.`,
  maintenanceMessageFailed: (message: string) =>
    `Окно закрыто, но сообщение в таймлайн не добавлено: ${message}`,
  durationInvalid: (raw: string) =>
    `Неверная длительность: ${raw}. Примеры: 30m, 2h, 1h30m`,

  // scenarios
  cmdScenarios: 'сценарные проверки (Playwright)',
  cmdScenariosTest:
    'прогнать файл сценария в песочнице Statuser, ничего не сохраняя',
  cmdScenariosDeploy: 'привести сценарии проекта к конфигу statuser.json',
  optConfig: 'путь к конфигу',
  optDryRun: 'показать план, ничего не меняя',
  optTimeout: 'таймаут прогона, секунд: 15, 30, 45, 60, 120',
  optLocation: 'локация прогона: msk-1, spb-1, ala-1, nyc-1, ams-1',
  optEnv: 'переменная окружения сценария KEY=VALUE (можно несколько)',
  scenarioRunning: 'Прогоняю сценарий…',
  scenarioPassed: (seconds: string) => `Сценарий прошёл за ${seconds} с.`,
  scenarioFailed: (state: string) => `Сценарий не прошёл: ${state}.`,
  scenarioRunnerError:
    'Песочница не смогла выполнить прогон — это сбой на стороне Statuser, а не сайта.',
  scenarioFailedTest: (title: string) => `Тест: ${title}`,
  scenarioError: (message: string) => `Ошибка: ${message}`,
  scenarioArtifact: (kind: string, url: string) => `${kind}: ${url}`,
  configNotFound: (path: string) => `Не найден конфиг ${path}`,
  configInvalid: (path: string, problem: string) => `${path}: ${problem}`,
  envMissing: (name: string, scenario: string) =>
    `Переменная окружения ${name} не задана (сценарий «${scenario}»).`,
  deployPlanTitle: (project: number) => `План для проекта #${project}:`,
  deployCreate: (name: string) => `  + создать «${name}»`,
  deployUpdate: (name: string, id: number, fields: string) =>
    `  ~ изменить «${name}» (#${id}): ${fields}`,
  deployUnchanged: (name: string, id: number) =>
    `  = без изменений «${name}» (#${id})`,
  deployUnmanaged: (name: string, id: number) =>
    `  ? в проекте, но не в конфиге: «${name}» (#${id}) — не трогаю`,
  deployNothing: 'Изменений нет.',
  deployDryRunDone: 'Это план (--dry-run), ничего не изменено.',
  deployApplied: (name: string) => `Готово: «${name}»`,
  deployStopped: (name: string, message: string) =>
    `Остановлено на «${name}»: ${message}. Применённое выше остаётся.`,
  deployDuplicateName: (name: string) =>
    `В проекте несколько сценариев с именем «${name}» — укажите id в конфиге.`,
  deployDuplicateScript: (a: string, b: string) =>
    `У «${a}» и «${b}» одинаковый текст скрипта — Statuser не заводит дубли.`,
  deployScriptTaken: (name: string, id: number, project: number) =>
    `Скрипт «${name}» уже стоит у сервера #${id} в проекте #${project}.`,
  deployIdNotFound: (name: string, id: number) =>
    `Сценарий «${name}»: сервер #${id} не найден среди сценариев аккаунта.`,
  deployIdOtherProject: (name: string, id: number, project: number) =>
    `Сценарий «${name}»: сервер #${id} в другом проекте (#${project}).`,
  deployEnvAlwaysSent:
    'Значения переменных окружения API не возвращает, поэтому они отправляются при каждом deploy.',
};

export type Messages = typeof ru;

const en: Messages = {
  programDescription:
    'Statuser command line: scenario checks as code, maintenance windows in CI, heartbeat for cron jobs',
  optJson: 'print the response as JSON',
  optApiUrl: 'API address (default https://api.statuser.cloud)',
  optDebug: 'print requests to stderr (secrets hidden)',

  cmdLogin: 'save an API key on this machine',
  cmdLogout: 'remove the saved API key',
  cmdWhoami: 'show the account the key belongs to',
  optWithToken: 'read the key from stdin instead of prompting',
  promptApiKey: 'API key (Settings → API in the Statuser panel): ',
  loginEmptyKey: 'The key is empty.',
  loginNoTty:
    'No terminal to prompt on. Pass the key via stdin: statuser login --with-token < key.txt',
  loginSaved: (email, path) => `Done: ${email}. Key saved to ${path}`,
  logoutDone: 'Key removed.',
  logoutNothing: 'No saved key.',
  whoami: (email, source) => `${email} (key from ${source})`,
  keySourceEnv: 'STATUSER_API_KEY',
  keySourceFile: (path) => `${path}`,
  noApiKey: 'No API key. Run `statuser login` or set STATUSER_API_KEY.',
  keyOtherOrigin: (saved, current) =>
    `The saved key was issued for ${saved}, but the request goes to ${current}. Set STATUSER_API_KEY for another address.`,
  apiKeyMalformed:
    'The key contains spaces or line breaks inside. Copy it from the panel again.',
  unauthorized:
    'The key was rejected (401). Check it in the panel and run `statuser login` again.',

  apiUrlInvalid: (url) => `Invalid API address: ${url}`,
  apiUrlInsecure: (url) =>
    `The API address must be https (http only for localhost): ${url}`,
  foreignOrigin: (url) =>
    `Request to ${url} not sent: the key only goes to the API address.`,
  networkError: (message) => `Network: ${message}`,

  cmdApi: 'send an arbitrary API request (like `gh api`)',
  optField:
    'body field or query parameter key=value (value parsed as JSON when possible)',
  optRawField: 'field key=value, value is always a string',
  optInput: 'request body from a file, `-` for stdin',
  apiFieldInvalid: (raw) => `Expected key=value: ${raw}`,
  apiFieldsWithInput: 'Fields and --input cannot be combined.',
  apiMethodInvalid: (method) => `Unknown method: ${method}`,
  apiPathInvalid: 'The path must start with /, e.g. /v1/servers',

  cmdServers: 'monitored servers',
  cmdServersList: 'list servers',
  cmdServersGet: 'server by id',
  cmdServersPause: 'pause checks',
  cmdServersResume: 'resume checks',
  optProject: 'project id',
  optProtocol: 'only this protocol',
  optFromFile:
    'take ids from the JSON output of `servers pause --json` (resume only what was paused)',
  serversNoTargets: 'Pass server ids or --project.',
  serversEmpty: 'No servers.',
  colId: 'ID',
  colName: 'Name',
  colHost: 'Host',
  colProtocol: 'Protocol',
  colStatus: 'Status',
  colProject: 'Project',
  pausedOne: (id) => `#${id}: paused`,
  resumedOne: (id) => `#${id}: checks resumed`,
  alreadyPaused: (id) => `#${id}: already paused, skipped`,
  notPaused: (id) => `#${id}: not paused, skipped`,
  bulkFailed: (id, message) => `#${id}: error — ${message}`,
  bulkSummary: (ok, failed) =>
    failed ? `Done: ${ok}, errors: ${failed}` : `Done: ${ok}`,
  invalidId: (raw) => `Invalid id: ${raw}`,
  fromFileInvalid: (path) =>
    `${path} has no server list from \`servers pause --json\``,

  cmdHeartbeat: 'heartbeat checks',
  cmdHeartbeatPing: 'send a heartbeat signal',
  optFail: 'report a failure instead of success',
  cmdRun: 'run a command and send a heartbeat based on its result',
  optHeartbeatToken:
    'heartbeat token (or STATUSER_HEARTBEAT_TOKEN); no API key needed then',
  optHeartbeatServer:
    'heartbeat server id — the token is fetched with the API key',
  heartbeatNoToken:
    'A token is required: --heartbeat <token>, STATUSER_HEARTBEAT_TOKEN or --server <id>.',
  heartbeatBothSources: 'Pass either a token or --server, not both.',
  heartbeatNotHeartbeat: (id, protocol) =>
    `Server #${id} is not a heartbeat (protocol ${protocol}).`,
  heartbeatSent: 'Signal sent.',
  heartbeatFailSent: 'Failure recorded.',
  heartbeatSendFailed: (message) => `Could not send the heartbeat: ${message}`,
  heartbeatTokenRejected:
    'Heartbeat token not found (404). Check it on the server card.',
  runNoCommand:
    'Pass a command after --: statuser run --heartbeat <token> -- ./backup.sh',
  runSpawnFailed: (cmd, message) => `Could not start ${cmd}: ${message}`,

  cmdMaintenance: 'planned maintenance on a status page',
  cmdMaintenanceStart: 'open planned maintenance starting now',
  cmdMaintenanceEnd: 'end planned maintenance now',
  optPage: 'status page id',
  optTitle: 'title',
  optDescription: 'description for page visitors',
  optFor: 'window length: 30m, 2h, 1h30m',
  optServers: 'comma-separated ids of the page servers',
  optAllServers: 'all servers of the page',
  optMessage:
    'add a message to the maintenance timeline (notifies subscribers)',
  maintenanceNoServers: 'Pass --servers <id,…> or --all-servers.',
  maintenanceBothServers: 'Pass either --servers or --all-servers, not both.',
  maintenancePageEmpty: (id) => `Status page #${id} has no servers.`,
  maintenanceStarted: (id, until) =>
    `Planned maintenance #${id} is open until ${until}.`,
  maintenanceEnded: (id) => `Planned maintenance #${id} ended.`,
  maintenanceAlreadyEnded: (id) =>
    `Planned maintenance #${id} has already ended; the end date was left as is.`,
  maintenanceMessageFailed: (message) =>
    `The window is closed, but the timeline message was not added: ${message}`,
  durationInvalid: (raw) =>
    `Invalid duration: ${raw}. Examples: 30m, 2h, 1h30m`,

  cmdScenarios: 'scenario checks (Playwright)',
  cmdScenariosTest:
    'run a scenario file in the Statuser sandbox without saving it',
  cmdScenariosDeploy: 'bring the project scenarios in line with statuser.json',
  optConfig: 'config path',
  optDryRun: 'show the plan without changing anything',
  optTimeout: 'run timeout, seconds: 15, 30, 45, 60, 120',
  optLocation: 'run location: msk-1, spb-1, ala-1, nyc-1, ams-1',
  optEnv: 'scenario environment variable KEY=VALUE (repeatable)',
  scenarioRunning: 'Running the scenario…',
  scenarioPassed: (seconds) => `Scenario passed in ${seconds} s.`,
  scenarioFailed: (state) => `Scenario did not pass: ${state}.`,
  scenarioRunnerError:
    'The sandbox could not run the scenario — a Statuser-side failure, not a site one.',
  scenarioFailedTest: (title) => `Test: ${title}`,
  scenarioError: (message) => `Error: ${message}`,
  scenarioArtifact: (kind, url) => `${kind}: ${url}`,
  configNotFound: (path) => `Config not found: ${path}`,
  configInvalid: (path, problem) => `${path}: ${problem}`,
  envMissing: (name, scenario) =>
    `Environment variable ${name} is not set (scenario “${scenario}”).`,
  deployPlanTitle: (project) => `Plan for project #${project}:`,
  deployCreate: (name) => `  + create “${name}”`,
  deployUpdate: (name, id, fields) =>
    `  ~ update “${name}” (#${id}): ${fields}`,
  deployUnchanged: (name, id) => `  = unchanged “${name}” (#${id})`,
  deployUnmanaged: (name, id) =>
    `  ? in the project but not in the config: “${name}” (#${id}) — left alone`,
  deployNothing: 'Nothing to change.',
  deployDryRunDone: 'This is a plan (--dry-run); nothing was changed.',
  deployApplied: (name) => `Done: “${name}”`,
  deployStopped: (name, message) =>
    `Stopped at “${name}”: ${message}. Changes applied above remain.`,
  deployDuplicateName: (name) =>
    `Several scenarios in the project are named “${name}” — set its id in the config.`,
  deployDuplicateScript: (a, b) =>
    `“${a}” and “${b}” have the same script text — Statuser does not allow duplicates.`,
  deployScriptTaken: (name, id, project) =>
    `The script of “${name}” is already used by server #${id} in project #${project}.`,
  deployIdNotFound: (name, id) =>
    `Scenario “${name}”: server #${id} is not among the account scenarios.`,
  deployIdOtherProject: (name, id, project) =>
    `Scenario “${name}”: server #${id} is in another project (#${project}).`,
  deployEnvAlwaysSent:
    'The API does not return environment values, so they are sent on every deploy.',
};

const dictionaries: Record<Lang, Messages> = { ru, en };

export const t: Messages = dictionaries[detectLang()];
