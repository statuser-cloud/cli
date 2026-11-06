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
    'CLI Statuser: серверы и сценарии как код, плановые работы в CI, инциденты, heartbeat для крон-задач',
  optJson: 'вывести ответ в JSON',
  optApiUrl: 'адрес API (по умолчанию https://api.statuser.cloud)',
  optDebug: 'печатать запросы в stderr (секреты скрыты)',

  // Auth
  cmdLogin: 'сохранить API-ключ на этом компьютере',
  cmdLogout: 'удалить сохранённый API-ключ',
  cmdWhoami: 'показать аккаунт, к которому относится ключ',
  optWithToken: 'прочитать ключ из stdin, а не спрашивать',
  promptApiKey: 'API-ключ (панель Statuser → Настройки аккаунта → API и MCP): ',
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
  debugRetry: (reason: string) => `× ${reason}, повтор`,
  networkError: (message: string) => `Сеть: ${message}`,

  // api
  cmdApi: 'отправить произвольный запрос к API (как `gh api`)',
  optField:
    'поле тела или query-параметр key=value (значение — JSON, если разбирается)',
  optRawField: 'поле key=value, значение всегда строка',
  optInput: 'тело запроса из файла, `-` — из stdin',
  argInvalid: (flag: string, position: number) =>
    `${flag} №${position}: ожидается key=value (значение не показано)`,
  apiInputWithGet:
    'У GET нет тела: для --input укажите метод, например -X POST.',
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
  notFound: (id: number) => `#${id} не найден`,
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
    'Токен heartbeat не найден (404). Сверьте его с «URL запроса» на карточке сервера.',
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
  messageInvalid: (max: number) =>
    `Сообщение пустое или длиннее ${max} символов.`,
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
  scenarioFailed: (state: string): string =>
    state === 'timed_out'
      ? 'Сценарий не уложился в таймаут.'
      : 'Сценарий не прошёл.',
  scenarioRunnerError:
    'Песочница не смогла выполнить прогон — это сбой на стороне Statuser, а не сайта.',
  scenarioFailedTest: (title: string) => `Тест: ${title}`,
  scenarioError: (message: string) => `Ошибка: ${message}`,
  scenarioArtifact: (kind: string, url: string) =>
    `${{ screenshot: 'Скриншот', video: 'Видео', trace: 'Трейс' }[kind] ?? kind}: ${url}`,
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

  // incidents
  cmdIncidents: 'инциденты',
  cmdIncidentsList: 'список инцидентов',
  cmdIncidentsGet: 'инцидент по id',
  cmdIncidentsAi: 'разбор инцидента Statuser AI',
  cmdIncidentsPdf: 'скачать PDF-отчёт по инциденту',
  optOpen: 'только идущие',
  optIncidentStatus:
    'статусы через запятую: ongoing, resolved, dismissed, auto_closed_changed, auto_closed_timeout',
  optServerIds: 'id серверов через запятую',
  optSince: 'начавшиеся не раньше: 24h, 7d или дата ISO',
  optUntil: 'начавшиеся не позже: дата ISO',
  optOutput: 'куда сохранить файл',
  optForce: 'перезаписать существующий файл',
  incidentsOpenWithStatus: 'Укажите что-то одно: --open или --status.',
  incidentStatusInvalid: (status: string) => `Неизвестный статус: ${status}`,
  whenInvalid: (raw: string) =>
    `Неверная дата: ${raw}. Примеры: 24h, 7d, 2026-11-01`,
  incidentsEmpty: 'Инцидентов нет.',
  colServer: 'Сервер',
  colStarted: 'Начало',
  colDuration: 'Длительность',
  colError: 'Ошибка',
  incidentStatus: (status: string): string =>
    ({
      ongoing: 'идёт',
      resolved: 'завершён',
      dismissed: 'отклонён',
      auto_closed_changed: 'закрыт после правки сервера',
      auto_closed_timeout: 'закрыт по сроку',
    })[status] ?? status,
  aiNoData:
    'Для разбора нет данных: у инцидента нет диагностики (она есть на платных тарифах).',
  incidentTitle: (id: number) => `Инцидент #${id}`,
  incidentServer: (name: string) => `Сервер: ${name}`,
  incidentStatusLine: (status: string) => `Статус: ${status}`,
  incidentStarted: (time: string) => `Начало: ${time}`,
  incidentEnded: (time: string) => `Конец: ${time}`,
  incidentDurationLine: (duration: string) => `Длительность: ${duration}`,
  incidentError: (error: string) => `Ошибка: ${error}`,
  incidentDiagnostics: (locations: string) =>
    `Диагностика: ${locations} (подробно — с --json)`,
  duration: (days: number, hours: number, minutes: number): string =>
    days
      ? `${days} д ${hours} ч`
      : hours
        ? `${hours} ч ${minutes} мин`
        : `${minutes} мин`,
  unexpectedContentType: (type: string) =>
    `API вернул не PDF, а ${type || 'неизвестный тип'}.`,
  fileSaved: (path: string) => `Сохранено: ${path}`,
  fileExists: (path: string) =>
    `Файл ${path} уже есть. Чтобы перезаписать, добавьте --force.`,

  // reports
  cmdReports: 'отчёты об инцидентах на странице статуса',
  cmdReportsList: 'отчёты страницы',
  cmdReportsCreate: 'опубликовать отчёт об инциденте',
  cmdReportsUpdate: 'добавить сообщение в отчёт',
  cmdReportsResolve: 'закрыть отчёт: все серверы — resolved',
  optReportMessage:
    'сообщение для посетителей и подписчиков страницы (на языке страницы)',
  optImpact: 'как затронуты серверы: downtime или degraded',
  optUpdateStatus:
    'новый статус всех серверов отчёта: downtime, degraded или resolved',
  optLinkedIncidents: 'id инцидентов Statuser через запятую',
  reportsEmpty: 'Отчётов нет.',
  colTitle: 'Заголовок',
  serverImpact: (status: string): string =>
    ({
      not_affected: 'не затронут',
      downtime: 'недоступен',
      degraded: 'работает с ошибками',
      resolved: 'решено',
    })[status] ?? status,
  statusChoice: (allowed: string) => `Статус — один из: ${allowed}`,
  reportCreated: (id: number) => `Отчёт #${id} опубликован.`,
  reportUpdated: (id: number) => `Сообщение добавлено в отчёт #${id}.`,
  reportResolved: (id: number) => `Отчёт #${id} закрыт.`,
  reportAlreadyResolved: (id: number) =>
    `Отчёт #${id} уже закрыт, сообщение не отправлено.`,
  reportNoServers: (id: number) =>
    `В отчёте #${id} нет затронутых серверов — обновлять нечего.`,

  // servers update
  cmdServersUpdate: 'изменить настройки серверов разом',
  optInterval: 'интервал проверки, секунд',
  optRequestTimeout: 'таймаут проверки, секунд',
  optRegions: 'локации через запятую: msk-1, spb-1, ala-1, nyc-1, ams-1',
  optConfirmDelay: 'задержка подтверждения сбоя, секунд (0 — сразу)',
  optSsl: 'включить проверку SSL-сертификата',
  optNoSsl: 'выключить проверку SSL-сертификата',
  optDomain: 'включить проверку срока домена',
  optNoDomain: 'выключить проверку срока домена',
  optBlocklist: 'включить проверку реестра блокировок',
  optNoBlocklist: 'выключить проверку реестра блокировок',
  optLatencyAlert: 'уведомлять о медленном ответе дольше N мс',
  optNoLatencyAlert: 'не уведомлять о медленном ответе',
  regionsEmpty: 'Список локаций пустой.',
  regionInvalid: (region: string) => `Неизвестная локация: ${region}`,
  numberInvalid: (raw: string) => `Ожидается целое число: ${raw}`,
  numberRange: (min: number, max: number) =>
    `Допустимо целое число от ${min} до ${max}.`,
  updateNothing: 'Укажите, что изменить: --interval, --regions, --ssl и т. д.',
  updateValueInvalid: (id: number, problem: string) =>
    `#${id}: значение не подходит серверу (${problem}) — ничего не изменено.`,
  updateUnchanged: (id: number) => `#${id}: уже так, пропущен`,
  updateNotApplicable: (id: number, fields: string) =>
    `#${id}: к протоколу сервера не относится (${fields}), пропущен`,
  noChanges: 'без изменений',
  notApplicableNote: (fields: string) => `не относится к протоколу: ${fields}`,

  // export / diff / apply
  cmdExport: 'выгрузить серверы проекта в statuser.json',
  cmdDiff: 'показать, что изменит apply',
  cmdApply: 'привести проект к statuser.json',
  optExportOutput: 'записать в файл, а не в stdout',
  exportHeaderVariables: (names: string) =>
    `Значения секретных заголовков заменены ссылками на переменные окружения: ${names}. Задайте их перед apply.`,
  exportSecretsOmitted: (names: string) =>
    `Пароли, токены и ключи API не отдаёт, в файле их нет: ${names}. Для создания такого сервера заново добавьте их в файл как "$ПЕРЕМЕННАЯ".`,
  exportPaused: (count: number) =>
    `На паузе серверов: ${count}. Пауза в файл не попадает, apply её не меняет.`,
  exportScenarios: (count: number) =>
    `Сценариев в проекте: ${count}. Их скрипты не выгружаются — ведите их в секции scenarios.`,
  exportReview:
    'Проверьте файл перед коммитом: адрес, тело запроса и логин могут содержать секреты. Файл доступен только владельцу.',
  applyNothingToManage: 'нет ни секции servers, ни секции scenarios',
  applyClaimedTwice: (at: string, id: number) =>
    `${at}: сервер #${id} уже указан в другой записи.`,
  applyProtocolChange: (at: string, id: number, protocol: string) =>
    `${at}: у сервера #${id} протокол ${protocol}. Смена протокола стирает его настройки (авторизацию, ключ, токен) — сделайте это в панели.`,
  applyIdNotFound: (at: string, id: number) =>
    `${at}: сервер #${id} не найден.`,
  applyIdOtherProject: (at: string, id: number, project: number) =>
    `${at}: сервер #${id} в другом проекте (#${project}).`,
  applyAmbiguousName: (at: string, name: string) =>
    `${at}: в проекте несколько серверов с именем «${name}» — укажите id.`,
  applyFieldRequired: (at: string, field: string) =>
    `${at}: для создания нужно поле ${field}.`,
  applyLlmAvailability: (name: string) =>
    `«${name}»: без llm_api_key проверяется только доступность эндпоинта, без запроса к модели.`,
  applyDuplicate: (a: string, b: string) =>
    `«${a}» совпадёт с «${b}» — Statuser не заводит одинаковые серверы.`,
  applyServersLimit: (limit: number, existing: number, creating: number) =>
    `Тариф разрешает серверов: ${limit}. Уже есть ${existing}, файл добавляет ${creating}.`,
  applyIntervalTooLow: (at: string, min: number) =>
    `${at}: интервал на этом тарифе — не меньше ${min} с.`,
  applyLocationsUnavailable: (at: string, locations: string) =>
    `${at}: на этом тарифе недоступны локации ${locations}.`,
  applyDuplicateName: (at: string, other: string, name: string) =>
    `${at}: имя «${name}» уже есть в ${other} — имена в файле должны быть разными.`,
  applyAuthSecretMismatch: (at: string, field: string, type: string) =>
    `${at}: ${field} не подходит к http_auth_type ${type} — сервер его не применит.`,
  applyAuthHeaderConflict: (at: string) =>
    `${at}: при http_auth_type заголовок Authorization задавать нельзя.`,
  exportOtherProject: (path: string, project: number) =>
    `${path} описывает проект #${project}, и его сценарии нельзя перенести в другой. Выгрузите в другой файл.`,
  applyFeatureUnavailable: (at: string, feature: string) =>
    `${at}: на этом тарифе нет функции ${feature}.`,
  applyScenariosLimit: (limit: number, existing: number, creating: number) =>
    `Тариф разрешает сценариев: ${limit}. Уже есть ${existing}, файл добавляет ${creating}.`,
  applyScenarioTimeoutTooHigh: (name: string, max: number) =>
    `«${name}»: таймаут сценария на этом тарифе — не больше ${max} с.`,
  applyRequestTooLarge: (at: string, max: number) =>
    `${at}: запрос больше ${max / 1024 / 1024} МБ — API его не примет`,
  applyUnknownOutcome: (name: string, message: string) =>
    `Нет ответа на запись «${name}» (${message}): неизвестно, применилась ли она. Запустите statuser diff и повторите apply.`,

  // statuser.json problems: «where: what»
  cfgObject: 'нужен объект',
  cfgArray: 'нужен массив',
  cfgNonEmptyArray: 'нужен непустой массив',
  cfgRequired: 'обязательное поле',
  cfgPositiveInt: 'нужно целое положительное число',
  cfgString: 'нужна строка',
  cfgNonEmptyString: 'нужна непустая строка или null',
  cfgBoolean: 'нужно true или false',
  cfgOneOf: (list: string) => `одно из: ${list}`,
  cfgListOf: (list: string) => `непустой список из: ${list}`,
  cfgStrings: 'нужен список строк',
  cfgRange: (min: number, max: number) => `целое число от ${min} до ${max}`,
  cfgMaxLength: (max: number) => `не длиннее ${max} символов`,
  cfgDuplicate: (name: string) => `повторяется «${name}»`,
  cfgNameOrId: 'нужно name или id',
  cfgNotUsedBy: (protocol: string) => `не используется протоколом ${protocol}`,
  cfgProtocol: (list: string) =>
    `одно из: ${list} (сценарии — в секции scenarios)`,
  cfgHeaders: 'нужен список { "key", "value" }',
  cfgHeaderName: (name: string) =>
    `недопустимое имя заголовка «${name}»: только латиница, цифры и !#$%&'*+.^_\`|~-`,
  cfgHeaderValue: (name: string) =>
    `в значении заголовка «${name}» управляющие символы`,
  cfgCannotRead: (file: string) => `не удалось прочитать ${file}`,
  cfgFileEmpty: (file: string) => `${file} пустой`,
  cfgFileTooLarge: 'больше 64 КБ',
  cfgNoTest: (file: string) =>
    `в ${file} нет ни одного test(...) — такой сценарий ничего не проверял бы`,
  cfgIntervalBelowTimeout: 'не меньше таймаута',
  cfgEnvTooMany: (max: number) => `не больше ${max} переменных`,
  cfgEnvName: (name: string) =>
    `${name}: имя — ЗАГЛАВНЫМИ латинскими буквами и не из служебных`,
  cfgEnvValue: (name: string) => `${name}: значение больше 4 КБ`,
  cfgHostInternal:
    'внутренний адрес: проверки идут снаружи, и API его не примет',
  cfgHostInvalid: 'не похоже на адрес: домен, IP или URL',
  cfgUsernameColon: 'в логине не может быть двоеточия',
  cfgControlChars: 'управляющие символы недопустимы',
  cfgSuccessCodes: (max: number) => `от 1 до ${max} кодов вида 200 или 2xx`,
  cfgLlmModelWithoutKey:
    'без llm_api_key модель не используется и не сохраняется — уберите llm_model или добавьте ключ',
  cfgJson: (position: string) =>
    position ? `некорректный JSON (позиция ${position})` : 'некорректный JSON',

  // commander
  helpUsage: 'Использование:',
  helpArguments: 'Аргументы:',
  helpOptions: 'Опции:',
  helpGlobalOptions: 'Общие опции:',
  helpCommands: 'Команды:',
  helpDefault: 'по умолчанию',
  helpOption: 'показать справку',
  helpCommand: 'справка по команде',
  versionOption: 'показать версию',
  errUnknownOption: (option: string) => `Неизвестная опция: ${option}`,
  errUnknownCommand: (command: string) => `Неизвестная команда: ${command}`,
  errMissingOption: (option: string) =>
    `Не указана обязательная опция ${option}`,
  errMissingArgument: (argument: string) =>
    `Не указан обязательный аргумент ${argument}`,
  errOptionValue: (option: string) => `У опции ${option} нет значения`,
  errTooManyArguments: 'Лишние аргументы.',
};

export type Messages = typeof ru;

const en: Messages = {
  programDescription:
    'Statuser CLI: servers and scenario checks as code, maintenance windows in CI, incidents, heartbeat for cron jobs',
  optJson: 'print the response as JSON',
  optApiUrl: 'API address (default https://api.statuser.cloud)',
  optDebug: 'print requests to stderr (secrets hidden)',

  cmdLogin: 'save an API key on this machine',
  cmdLogout: 'remove the saved API key',
  cmdWhoami: 'show the account the key belongs to',
  optWithToken: 'read the key from stdin instead of prompting',
  promptApiKey: 'API key (Statuser panel → Account settings → API and MCP): ',
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
  debugRetry: (reason) => `× ${reason}, retrying`,
  networkError: (message) => `Network: ${message}`,

  cmdApi: 'send an arbitrary API request (like `gh api`)',
  optField:
    'body field or query parameter key=value (value parsed as JSON when possible)',
  optRawField: 'field key=value, value is always a string',
  optInput: 'request body from a file, `-` for stdin',
  argInvalid: (flag, position) =>
    `${flag} #${position}: key=value expected (the value is not shown)`,
  apiInputWithGet: 'GET has no body: give --input a method, e.g. -X POST.',
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
  notFound: (id) => `#${id} not found`,
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
    'Heartbeat token not found (404). Compare it with the request URL on the server card.',
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
  messageInvalid: (max) =>
    `The message is empty or longer than ${max} characters.`,
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
  scenarioFailed: (state) =>
    state === 'timed_out'
      ? 'The scenario ran out of time.'
      : 'The scenario did not pass.',
  scenarioRunnerError:
    'The sandbox could not run the scenario — a Statuser-side failure, not a site one.',
  scenarioFailedTest: (title) => `Test: ${title}`,
  scenarioError: (message) => `Error: ${message}`,
  scenarioArtifact: (kind, url) =>
    `${{ screenshot: 'Screenshot', video: 'Video', trace: 'Trace' }[kind] ?? kind}: ${url}`,
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

  cmdIncidents: 'incidents',
  cmdIncidentsList: 'list incidents',
  cmdIncidentsGet: 'incident by id',
  cmdIncidentsAi: 'Statuser AI summary of an incident',
  cmdIncidentsPdf: 'download the PDF report of an incident',
  optOpen: 'ongoing only',
  optIncidentStatus:
    'comma-separated statuses: ongoing, resolved, dismissed, auto_closed_changed, auto_closed_timeout',
  optServerIds: 'comma-separated server ids',
  optSince: 'started no earlier than: 24h, 7d or an ISO date',
  optUntil: 'started no later than: an ISO date',
  optOutput: 'where to save the file',
  optForce: 'overwrite an existing file',
  incidentsOpenWithStatus: 'Pass either --open or --status, not both.',
  incidentStatusInvalid: (status) => `Unknown status: ${status}`,
  whenInvalid: (raw) => `Invalid date: ${raw}. Examples: 24h, 7d, 2026-11-01`,
  incidentsEmpty: 'No incidents.',
  colServer: 'Server',
  colStarted: 'Started',
  colDuration: 'Duration',
  colError: 'Error',
  incidentStatus: (status) =>
    ({
      ongoing: 'ongoing',
      resolved: 'resolved',
      dismissed: 'dismissed',
      auto_closed_changed: 'closed after a server edit',
      auto_closed_timeout: 'closed by timeout',
    })[status] ?? status,
  aiNoData:
    'Nothing to analyse: the incident has no diagnostics (available on paid plans).',
  incidentTitle: (id) => `Incident #${id}`,
  incidentServer: (name) => `Server: ${name}`,
  incidentStatusLine: (status) => `Status: ${status}`,
  incidentStarted: (time) => `Started: ${time}`,
  incidentEnded: (time) => `Ended: ${time}`,
  incidentDurationLine: (duration) => `Duration: ${duration}`,
  incidentError: (error) => `Error: ${error}`,
  incidentDiagnostics: (locations) =>
    `Diagnostics: ${locations} (details with --json)`,
  duration: (days, hours, minutes) =>
    days
      ? `${days}d ${hours}h`
      : hours
        ? `${hours}h ${minutes}m`
        : `${minutes}m`,
  unexpectedContentType: (type) =>
    `The API returned ${type || 'an unknown type'} instead of a PDF.`,
  fileSaved: (path) => `Saved: ${path}`,
  fileExists: (path) => `${path} already exists. Add --force to overwrite it.`,

  cmdReports: 'incident reports on a status page',
  cmdReportsList: 'reports of a page',
  cmdReportsCreate: 'publish an incident report',
  cmdReportsUpdate: 'add a message to a report',
  cmdReportsResolve: 'close a report: all servers resolved',
  optReportMessage:
    'message for page visitors and subscribers (in the page language)',
  optImpact: 'how servers are affected: downtime or degraded',
  optUpdateStatus:
    'new status of all report servers: downtime, degraded or resolved',
  optLinkedIncidents: 'comma-separated Statuser incident ids',
  reportsEmpty: 'No reports.',
  colTitle: 'Title',
  serverImpact: (status) =>
    ({
      not_affected: 'not affected',
      downtime: 'down',
      degraded: 'degraded',
      resolved: 'resolved',
    })[status] ?? status,
  statusChoice: (allowed) => `Status must be one of: ${allowed}`,
  reportCreated: (id) => `Report #${id} published.`,
  reportUpdated: (id) => `Message added to report #${id}.`,
  reportResolved: (id) => `Report #${id} closed.`,
  reportAlreadyResolved: (id) =>
    `Report #${id} is already closed; no message sent.`,
  reportNoServers: (id) =>
    `Report #${id} has no affected servers — nothing to update.`,

  cmdServersUpdate: 'change settings of many servers at once',
  optInterval: 'check interval, seconds',
  optRequestTimeout: 'check timeout, seconds',
  optRegions: 'comma-separated locations: msk-1, spb-1, ala-1, nyc-1, ams-1',
  optConfirmDelay: 'failure confirmation delay, seconds (0 — immediately)',
  optSsl: 'turn the SSL certificate check on',
  optNoSsl: 'turn the SSL certificate check off',
  optDomain: 'turn the domain expiry check on',
  optNoDomain: 'turn the domain expiry check off',
  optBlocklist: 'turn the blocklist check on',
  optNoBlocklist: 'turn the blocklist check off',
  optLatencyAlert: 'alert on responses slower than N ms',
  optNoLatencyAlert: 'do not alert on slow responses',
  regionsEmpty: 'The location list is empty.',
  regionInvalid: (region) => `Unknown location: ${region}`,
  numberInvalid: (raw) => `Expected a whole number: ${raw}`,
  numberRange: (min, max) => `A whole number from ${min} to ${max} is allowed.`,
  updateNothing: 'Pass what to change: --interval, --regions, --ssl, etc.',
  updateValueInvalid: (id, problem) =>
    `#${id}: the value does not fit this server (${problem}) — nothing was changed.`,
  updateUnchanged: (id) => `#${id}: already set, skipped`,
  updateNotApplicable: (id, fields) =>
    `#${id}: not applicable to the server protocol (${fields}), skipped`,
  noChanges: 'no changes',
  notApplicableNote: (fields) => `not applicable to the protocol: ${fields}`,

  cmdExport: "export the project's servers to statuser.json",
  cmdDiff: 'show what apply would change',
  cmdApply: 'bring the project in line with statuser.json',
  optExportOutput: 'write to a file instead of stdout',
  exportHeaderVariables: (names) =>
    `Secret header values were replaced with environment variable references: ${names}. Set them before apply.`,
  exportSecretsOmitted: (names) =>
    `The API does not return passwords, tokens and keys, so the file has none: ${names}. To create such a server anew, add them to the file as "$VARIABLE".`,
  exportPaused: (count) =>
    `Paused servers: ${count}. Pausing is not in the file and apply does not change it.`,
  exportScenarios: (count) =>
    `Scenarios in the project: ${count}. Their scripts are not exported — keep them in the scenarios section.`,
  exportReview:
    'Review the file before committing: the address, request body and username may hold secrets. The file is readable by its owner only.',
  applyNothingToManage: 'neither a servers nor a scenarios section',
  applyClaimedTwice: (at, id) =>
    `${at}: server #${id} is already used by another entry.`,
  applyProtocolChange: (at, id, protocol) =>
    `${at}: server #${id} uses ${protocol}. Changing the protocol wipes its settings (credentials, key, token) — do it in the panel.`,
  applyIdNotFound: (at, id) => `${at}: server #${id} not found.`,
  applyIdOtherProject: (at, id, project) =>
    `${at}: server #${id} is in another project (#${project}).`,
  applyAmbiguousName: (at, name) =>
    `${at}: several servers in the project are named “${name}” — set an id.`,
  applyFieldRequired: (at, field) =>
    `${at}: ${field} is required to create it.`,
  applyLlmAvailability: (name) =>
    `“${name}”: without llm_api_key only the endpoint availability is checked, no model request.`,
  applyDuplicate: (a, b) =>
    `“${a}” would equal “${b}” — Statuser does not allow identical servers.`,
  applyServersLimit: (limit, existing, creating) =>
    `The plan allows ${limit} servers. There are ${existing}; the file adds ${creating}.`,
  applyIntervalTooLow: (at, min) =>
    `${at}: the interval on this plan is at least ${min} s.`,
  applyLocationsUnavailable: (at, locations) =>
    `${at}: locations ${locations} are not available on this plan.`,
  applyDuplicateName: (at, other, name) =>
    `${at}: the name “${name}” is already used by ${other} — names in the file must differ.`,
  applyAuthSecretMismatch: (at, field, type) =>
    `${at}: ${field} does not match http_auth_type ${type} — the server would ignore it.`,
  applyAuthHeaderConflict: (at) =>
    `${at}: an Authorization header cannot be set together with http_auth_type.`,
  exportOtherProject: (path, project) =>
    `${path} describes project #${project}; its scenarios cannot move to another one. Export to another file.`,
  applyFeatureUnavailable: (at, feature) =>
    `${at}: the plan has no ${feature}.`,
  applyScenariosLimit: (limit, existing, creating) =>
    `The plan allows ${limit} scenarios. There are ${existing}; the file adds ${creating}.`,
  applyScenarioTimeoutTooHigh: (name, max) =>
    `“${name}”: the scenario timeout on this plan is at most ${max} s.`,
  applyRequestTooLarge: (at, max) =>
    `${at}: the request is over ${max / 1024 / 1024} MB, the API refuses it`,
  applyUnknownOutcome: (name, message) =>
    `No response to the write of “${name}” (${message}): whether it was applied is unknown. Run statuser diff and repeat apply.`,

  cfgObject: 'object expected',
  cfgArray: 'array expected',
  cfgNonEmptyArray: 'non-empty array expected',
  cfgRequired: 'required',
  cfgPositiveInt: 'positive integer expected',
  cfgString: 'string expected',
  cfgNonEmptyString: 'non-empty string or null expected',
  cfgBoolean: 'true or false expected',
  cfgOneOf: (list) => `one of: ${list}`,
  cfgListOf: (list) => `non-empty list of: ${list}`,
  cfgStrings: 'list of strings expected',
  cfgRange: (min, max) => `whole number from ${min} to ${max}`,
  cfgMaxLength: (max) => `at most ${max} characters`,
  cfgDuplicate: (name) => `duplicate “${name}”`,
  cfgNameOrId: 'name or id required',
  cfgNotUsedBy: (protocol) => `not used by protocol ${protocol}`,
  cfgProtocol: (list) =>
    `one of: ${list} (scenarios go to the scenarios section)`,
  cfgHeaders: 'list of { "key", "value" } expected',
  cfgHeaderName: (name) =>
    `invalid header name “${name}”: only ASCII letters, digits and !#$%&'*+.^_\`|~-`,
  cfgHeaderValue: (name) =>
    `control characters in the value of header “${name}”`,
  cfgCannotRead: (file) => `cannot read ${file}`,
  cfgFileEmpty: (file) => `${file} is empty`,
  cfgFileTooLarge: 'larger than 64 KB',
  cfgNoTest: (file) =>
    `${file} has no test(...) call — such a scenario would check nothing`,
  cfgIntervalBelowTimeout: 'must not be less than the timeout',
  cfgEnvTooMany: (max) => `no more than ${max} variables`,
  cfgEnvName: (name) => `${name}: the name must be UPPER_CASE and not reserved`,
  cfgEnvValue: (name) => `${name}: value larger than 4 KB`,
  cfgHostInternal:
    'an internal address: checks run from outside, and the API refuses it',
  cfgHostInvalid: 'not an address: a domain, IP or URL expected',
  cfgUsernameColon: 'the username cannot contain a colon',
  cfgControlChars: 'control characters are not allowed',
  cfgSuccessCodes: (max) => `1 to ${max} codes like 200 or 2xx`,
  cfgLlmModelWithoutKey:
    'without llm_api_key the model is neither used nor stored — drop llm_model or add the key',
  cfgJson: (position) =>
    position ? `invalid JSON (position ${position})` : 'invalid JSON',

  helpUsage: 'Usage:',
  helpArguments: 'Arguments:',
  helpOptions: 'Options:',
  helpGlobalOptions: 'Global Options:',
  helpCommands: 'Commands:',
  helpDefault: 'default',
  helpOption: 'display help for command',
  helpCommand: 'display help for command',
  versionOption: 'output the version number',
  errUnknownOption: (option) => `Unknown option: ${option}`,
  errUnknownCommand: (command) => `Unknown command: ${command}`,
  errMissingOption: (option) => `Required option ${option} not specified`,
  errMissingArgument: (argument) => `Missing required argument ${argument}`,
  errOptionValue: (option) => `Option ${option} has no value`,
  errTooManyArguments: 'Too many arguments.',
};

const dictionaries: Record<Lang, Messages> = { ru, en };

export const t: Messages = dictionaries[detectLang()];
