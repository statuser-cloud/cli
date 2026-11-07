# CLI Statuser

[![npm version](https://img.shields.io/npm/v/@statuser/cli.svg)](https://www.npmjs.com/package/@statuser/cli)
[![CI](https://github.com/statuser-cloud/cli/actions/workflows/ci.yml/badge.svg)](https://github.com/statuser-cloud/cli/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Утилита командной строки для [Statuser](https://statuser.cloud). Добавляет и настраивает серверы, описывает серверы и сценарные проверки как код, ставит проверки на паузу на время деплоя, ведёт плановые работы и отчёты на странице статуса, отправляет heartbeat из крон-задач. Работает поверх [публичного API Statuser](https://statuser.cloud/api-reference) с авторизацией по API-ключу.

```console
$ statuser scenarios test checks/checkout.spec.ts
Прогоняю сценарий…
Сценарий не прошёл.
Тест: оформление заказа
Ошибка: expect(locator).toBeVisible() failed
Locator: getByRole('heading', { name: 'Мои заказы' })
Скриншот: https://…/screenshot.png
Видео: https://…/video.webm
Трейс: https://…/trace.zip
```

## Содержание

- [Установка](#установка)
- [Быстрый старт](#быстрый-старт)
- [Серверы](#серверы)
- [Серверы как код](#серверы-как-код)
- [Сценарии](#сценарии)
- [Деплой и плановые работы](#деплой-и-плановые-работы)
- [Heartbeat](#heartbeat)
- [Инциденты](#инциденты)
- [Отчёты на странице статуса](#отчёты-на-странице-статуса)
- [Готовые файлы CI](#готовые-файлы-ci)
- [Справка](#справка)

## Установка

Через npm, если на машине есть Node.js 20.19 или новее:

```bash
npm install -g @statuser/cli
```

Пакет называется `@statuser/cli`, команда после установки — `statuser`.

В CI устанавливать не обязательно, достаточно `npx`:

```bash
npx -y @statuser/cli scenarios deploy
```

Без Node — одной командой, скрипт скачивает исполняемый файл из последнего [релиза](https://github.com/statuser-cloud/cli/releases/latest):

```bash
curl -fsSL https://statuser.cloud/cli/install.sh | sh
```

В Windows, в PowerShell:

```powershell
irm https://statuser.cloud/cli/install.ps1 | iex
```

Скрипт кладёт `statuser` в `/usr/local/bin`, если туда можно писать без sudo, иначе в `~/.local/bin`, а в Windows — в `%LOCALAPPDATA%\Programs\statuser` и добавляет эту папку в `PATH` пользователя. Архив сверяется с `SHA256SUMS` того же релиза до установки. Другую версию задаёт `STATUSER_VERSION`, например `curl … | STATUSER_VERSION=0.1.1 sh`, папку — `STATUSER_INSTALL_DIR`.

Через Homebrew на macOS и Linux:

```bash
brew install statuser-cloud/tap/statuser
```

Вручную — архив со страницы релизов:

```bash
curl -fsSL https://github.com/statuser-cloud/cli/releases/latest/download/statuser-linux-x64.tar.gz | tar -xz
sudo mv statuser /usr/local/bin/
```

Для других систем — `linux-arm64`, `macos-arm64`, `macos-x64` или `statuser-windows-x64.zip`, контрольные суммы — в `SHA256SUMS`. Файл, скачанный на macOS браузером, запустится после `xattr -d com.apple.quarantine statuser`.

Справка и сообщения выводятся на языке системы: на русском, если `LANG` начинается с `ru`, иначе на английском. Справка по любой команде: `statuser <команда> --help`.

## Быстрый старт

1. Создайте ключ в [панели Statuser](https://statuser.cloud/my/account/api-keys): «Настройки аккаунта → API-ключи».
2. Сохраните его на этой машине:

   ```console
   $ statuser login
   API-ключ (панель Statuser → Настройки аккаунта → API-ключи):
   Готово: you@example.com. Ключ сохранён в /home/you/.config/statuser/config.json
   ```

3. Посмотрите серверы аккаунта:

   ```console
   $ statuser servers list
   ID    Имя                Протокол  Статус  Хост                     Проект
   1874  Сайт магазина      http      online  https://shop.example.com 100000
   2041  Вход в кабинет     scenario  online  scenario://2041          100000
   ```

Файл с ключом доступен только владельцу. В CI передавайте ключ переменной `STATUSER_API_KEY`, а не флагом: аргументы команды видны в истории и в списке процессов.

## Серверы

```bash
statuser servers add https://shop.example.com --name "Магазин" --project 100000
statuser servers add 203.0.113.10 --name "Шлюз"
statuser servers add db.example.com --protocol tcp --port 5432
statuser servers add --protocol heartbeat --name "Бэкап" --interval 86400

statuser servers list --project 100000 --protocol http
statuser servers get 101
statuser servers checks 101 --since 7d
statuser servers test-notify 101
statuser servers update 101 --name "Магазин (прод)" --host https://shop.example.ru
statuser servers delete 101
```

Протокол определяется по адресу: для URL это HTTP-проверка, для IP — ping. У домена без схемы укажите `--protocol`. Остальные настройки получают значения по умолчанию, как в панели. Если API откажет в создании, CLI скажет об этом до записи. Без `--project` сервер попадает в самый старый проект аккаунта.

- `checks` показывает проверки за период, по умолчанию за сутки: статус и задержку в каждой локации.
- `test-notify` отправляет тестовый алёрт в те же каналы, куда ушёл бы настоящий.
- `update` с `--name`, `--host` или `--description` меняет один сервер.
- `delete` удаляет сервер вместе с историей проверок и инцидентами, поэтому сначала спрашивает подтверждение. В CI спросить некого, там нужен `--yes`.

### Массовые правки

```bash
statuser servers update --project 100000 --interval 60 --regions msk-1,spb-1 --dry-run
statuser servers update --project 100000 --protocol http --ssl --domain
statuser servers update 101 102 --latency-alert 800
```

Флаги: `--interval`, `--timeout`, `--regions`, `--confirm-delay`, `--ssl` / `--no-ssl`, `--domain` / `--no-domain`, `--blocklist` / `--no-blocklist`, `--latency-alert <мс>` / `--no-latency-alert`. Отправляются только поля, которые действительно меняются. Если флаг не относится к протоколу сервера, например `--ssl` у ping, сервер пропускается с объяснением. Ошибка на одном сервере не останавливает остальные, `--json` возвращает `done`, `skipped` и `failed`.

## Серверы как код

Серверы проекта описываются в файле `statuser.json`, в секции `servers`: HTTP, keyword, ping, TCP, DNS, heartbeat и LLM.

```bash
statuser export --project 100000 -o statuser.json   # выгрузить, что есть сейчас
statuser diff                                       # что изменит apply
statuser apply                                      # привести проект к файлу
```

```json
{
  "project_id": 100000,
  "servers": [
    {
      "id": 1874,
      "name": "Сайт магазина",
      "protocol": "http",
      "host": "https://shop.example.com",
      "check_interval": 60,
      "locations": ["msk-1", "spb-1"],
      "is_ssl_check": true,
      "headers": [{ "key": "Authorization", "value": "$SHOP_API_TOKEN" }]
    },
    { "name": "Бэкап базы", "protocol": "heartbeat", "check_interval": 86400 }
  ],
  "scenarios": []
}
```

- Поля называются так же, как в [API](https://statuser.cloud/api-reference). Сервер узнаётся по `id`, а без него — по имени внутри проекта.
- Секреты API не возвращает, поэтому в файле они задаются ссылкой на переменную окружения: `"http_auth_password": "$SHOP_PASSWORD"`. Значения секретных заголовков `export` заменяет такими же ссылками и называет переменные. Строку, которая сама начинается с `$`, пишите как `$$…`. Адрес, тело запроса и логин выгружаются как есть, поэтому проверьте файл перед коммитом.
- Ошибки в файле `apply` показывает до первой записи. Если запись всё же остановилась на ошибке, повторный `apply` продолжит с этого места.
- `apply` не удаляет серверы и не меняет их протокол. Серверы, которых нет в файле, только показываются в плане.

## Сценарии

Сценарий — это Playwright-тест, который Statuser прогоняет по расписанию в настоящем браузере: вход в кабинет, корзина, цепочка запросов к API. С CLI тесты лежат в вашем репозитории рядом с кодом сайта и выкатываются вместе с ним.

### Тест

`checks/checkout.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('оформление заказа', async ({ page }) => {
  await page.goto('https://shop.example.com/login');
  await page.getByLabel('Email').fill(process.env.SHOP_LOGIN!);
  await page.getByLabel('Пароль').fill(process.env.SHOP_PASSWORD!);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('heading', { name: 'Мои заказы' })).toBeVisible();
});
```

Один файл до 64 КБ. Из пакетов доступен `@playwright/test`, свои вспомогательные файлы подключить нельзя. Логины и пароли передаются только через `process.env`.

### Прогнать до выкладки

```bash
statuser scenarios test checks/checkout.spec.ts \
  --location msk-1 --env SHOP_LOGIN='$SHOP_LOGIN' --env SHOP_PASSWORD='$SHOP_PASSWORD'
```

Сервер при этом не создаётся, история проверок и инциденты не меняются. Значение вида `$NAME` берётся из окружения, поэтому пароль не попадает в историю команд. Ссылки на скриншот, видео и трейс действуют час.

### Выкатить

`statuser.json` в корне репозитория:

```json
{
  "project_id": 100000,
  "scenarios": [
    {
      "name": "Оформление заказа",
      "file": "checks/checkout.spec.ts",
      "interval": 300,
      "timeout": 60,
      "location": "msk-1",
      "env": { "SHOP_LOGIN": "$SHOP_LOGIN", "SHOP_PASSWORD": "$SHOP_PASSWORD" }
    }
  ]
}
```

```console
$ statuser scenarios deploy --dry-run
План для проекта #100000:
  + создать «Оформление заказа»
  ~ изменить «Вход в кабинет» (#2041): interval
Это план (--dry-run), ничего не изменено.

$ statuser scenarios deploy
```

| Поле         | Что значит                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------ |
| `project_id` | Проект, в котором живут сценарии. Id показывает `statuser projects list`                         |
| `name`       | Имя сервера в Statuser. По нему сценарий узнаётся внутри проекта                                 |
| `id`         | Необязательно. Нужен, чтобы переименовать сценарий: без него новое имя заведёт новый сервер      |
| `file`       | Путь к тесту относительно `statuser.json`                                                        |
| `interval`   | Как часто проверять, секунд: от 60 до 86 400 и не меньше таймаута. По умолчанию 300              |
| `timeout`    | Сколько ждать прогон, секунд: 15, 30, 45, 60 или 120. По умолчанию 30                            |
| `location`   | Откуда проверять: `msk-1`, `spb-1`, `ala-1`, `nyc-1` или `ams-1`. По умолчанию `msk-1`           |
| `env`        | Переменные окружения теста. Имена — заглавными буквами, значение `$NAME` берётся из окружения CI |

- Весь файл проверяется до первой записи: ошибка в пятом сценарии не оставит первые четыре выкаченными.
- `env` задаёт полный набор переменных: имя, которое убрали из файла, удаляется и на сервере. Если поля `env` нет, переменные на сервере остаются как есть.
- Сценарии проекта, которых нет в файле, не удаляются, а только показываются в плане.
- Число сценариев, минимальный интервал и максимальный таймаут зависят от тарифа.

### Проверить после выкладки

```bash
statuser scenarios run 2041
```

Сохранённый сценарий прогоняется сразу, с теми же последствиями, что по расписанию: результат попадает в историю, а сбой открывает инцидент. Значения переменных сценария API не возвращает. CLI скрывает в выводе те из них, что лежат в окружении под теми же именами, и предупреждает об остальных.

Код выхода у `scenarios test` и `scenarios run`: 0 — сценарий прошёл, 4 — не прошёл, 1 — сбой песочницы или API.

## Деплой и плановые работы

Пауза проверок избавляет команду от ложных алёртов на время деплоя, а плановые работы предупреждают клиентов о простое, который они заметят.

### Пауза проверок на время деплоя

Если сервис во время деплоя отвечает с ошибками, проверки поднимут команду ложными алёртами. Их можно поставить на паузу и вернуть после:

```bash
statuser servers pause --project 100000 --json > paused.json

# … деплой …

statuser servers resume --from paused.json
```

`resume --from` возобновляет только то, что поставил на паузу шаг `pause`: серверы, которые уже стояли на паузе, такими и останутся.

### Плановые работы на странице статуса

Когда простой заметят клиенты, например при переезде базы или обновлении на полчаса, их предупреждают плановыми работами: окно появляется на странице статуса, подписчики получают письмо. Для короткого деплоя это лишнее, иначе рассылка уходила бы на каждый релиз.

Объявить заранее:

```bash
statuser maintenance schedule --page 12 --all-servers --at 2026-11-20T03:00+03:00 --for 1h \
  --title "Переезд базы данных" --description "Магазин будет недоступен до 30 минут"
statuser maintenance list --page 12
statuser maintenance delete 77 --page 12
```

Открыть и закрыть, когда работы идут сейчас:

```bash
statuser maintenance start --page 12 --all-servers \
  --title "Переезд базы данных" --description "Магазин будет недоступен до 30 минут" \
  --for 30m --json > maintenance.json

# … работы …

statuser maintenance end --page 12 "$(jq .id maintenance.json)" --message "Работы завершены"
```

- `--servers 101,102` выбирает серверы страницы статуса, `--all-servers` берёт все. `--for` задаёт длительность окна: `30m`, `2h`, `1h30m`. `--at` задаёт начало в будущем.
- `maintenance end` без `--message` только переносит время окончания. С `--message` в таймлайне работ появляется запись, и подписчики получают уведомление. Повторный `end` дату не сдвигает и то же сообщение второй раз не публикует, поэтому шаг можно безопасно перезапустить.
- Плановые работы алёрты не глушат. Если проверки на это время не нужны, добавьте паузу.

## Heartbeat

```bash
STATUSER_HEARTBEAT_TOKEN=… statuser run -- ./backup.sh
```

Если команда завершилась с кодом 0, Statuser получает сигнал «работает», с другим кодом — «ошибка», и инцидент открывается сразу. Код выхода `run` — код самой команды: если сигнал не дошёл из-за сети, успешный бэкап не превратится в упавший. Если команду убил сигнал, код равен 128 + номер сигнала, как в shell.

Строка для crontab:

```cron
0 3 * * * STATUSER_HEARTBEAT_TOKEN=… /usr/local/bin/statuser run -- /opt/scripts/backup.sh
```

У крона короткий `PATH`, поэтому путь к `statuser` указан полностью. Его покажет `which statuser`.

- Токен — последняя часть адреса heartbeat-сервера: `https://hb.statuser.cloud/<токен>`. API-ключ на машине с кроном не нужен. Передавайте токен переменной, а не флагом `--heartbeat`: аргументы видны в списке процессов, пока идёт команда.
- Если на машине есть API-ключ, токен можно не копировать: `statuser run --server 101 -- ./backup.sh`.
- Пока не пришёл первый сигнал, Statuser не знает, что задача запущена, и пропуски не считает. Интервал и допустимую задержку heartbeat-сервера задайте с запасом на самую долгую задачу.
- Разовый сигнал без команды: `statuser heartbeat ping "$TOKEN"`, сигнал ошибки — с `--fail`.

## Инциденты

```bash
statuser incidents list --open
statuser incidents list --since 7d --project 100000
statuser incidents get 5021
statuser incidents ai 5021                      # разбор Statuser AI
statuser incidents pdf 5021 -o incident-5021.pdf
statuser incidents comment 5021 -m "Выкатили исправление"
statuser incidents delete 5021
```

`--since` и `--until` фильтруют по времени начала инцидента: `24h`, `7d` или дата. Диагностика и разбор Statuser AI есть на платных тарифах. Если данных для разбора нет, он так и скажет. PDF сохраняется с доступом только для владельца, существующий файл перезаписывается только с `--force`. `delete` спрашивает подтверждение, как и удаление серверов.

## Отчёты на странице статуса

Публичные отчёты об инцидентах видят посетители страницы статуса, а подписчики получают их письмом.

```bash
statuser reports create --page 12 --all-servers --status degraded \
  --title "Медленная оплата" --message "Разбираемся с задержками платежей"
statuser reports update 88 --page 12 --message "Нашли причину, выкатываем исправление"
statuser reports resolve 88 --page 12 --message "Платежи проходят штатно"
statuser reports list --page 12
```

Сообщение обязательно в каждой команде: оно уходит подписчикам на языке страницы, поэтому CLI своих текстов не подставляет. `resolve` уже закрытого отчёта ничего не отправляет, так что шаг CI можно безопасно перезапустить.

## Готовые файлы CI

Примеры можно скопировать в репозиторий как есть, поменяв id проекта и имена переменных.

### GitHub Actions

Прогнать тесты и выкатить сценарии при изменении тестов:

```yaml
name: Сценарии Statuser
on:
  push:
    branches: [main]
    paths: ['checks/**', 'statuser.json']

jobs:
  deploy:
    runs-on: ubuntu-latest
    env:
      STATUSER_API_KEY: ${{ secrets.STATUSER_API_KEY }}
      SHOP_LOGIN: ${{ secrets.SHOP_LOGIN }}
      SHOP_PASSWORD: ${{ secrets.SHOP_PASSWORD }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Прогнать тесты
        run: |
          for file in checks/*.spec.ts; do
            npx -y @statuser/cli scenarios test "$file" \
              --env SHOP_LOGIN='$SHOP_LOGIN' --env SHOP_PASSWORD='$SHOP_PASSWORD'
          done
      - name: Выкатить
        run: npx -y @statuser/cli scenarios deploy
```

### GitLab CI

Пауза проверок вокруг деплоя. `after_script` выполняется и при упавшем деплое, поэтому проверки возобновятся в любом случае:

```yaml
deploy:
  image: node:22
  variables:
    STATUSER_PROJECT: '100000'
  before_script:
    - npx -y @statuser/cli servers pause --project "$STATUSER_PROJECT" --json > paused.json
  script:
    - ./deploy.sh
  after_script:
    - npx -y @statuser/cli servers resume --from paused.json
```

`STATUSER_API_KEY` задайте в настройках CI/CD проекта как замаскированную переменную.

## Справка

Команды, которые нужны реже, и общие правила: переменные окружения, коды выхода, работа с ключом и повтор запросов.

### Автодополнение

`statuser completion` печатает скрипт автодополнения команд, флагов и их значений. Сохраните его туда, откуда оболочка подгружает дополнения:

```bash
statuser completion bash > ~/.local/share/bash-completion/completions/statuser
statuser completion zsh > "${fpath[1]}/_statuser"
statuser completion fish > ~/.config/fish/completions/statuser.fish
```

Дополнение заработает в новой сессии оболочки. Homebrew устанавливает его сам, вместе с CLI.

### Остальные команды

```bash
statuser projects list
statuser pages list
statuser api /v1/servers/101 -X PATCH -F check_interval=120
statuser whoami
statuser logout
```

`projects list` и `pages list` показывают id для `--project` и `--page`.

`statuser api` отправляет запрос к любому методу [API](https://statuser.cloud/api-reference), как `gh api`. Поля из `-F` для GET и DELETE уходят в query, для остальных методов — в тело запроса. `-F` разбирает значение как JSON (`-F on=true` передаёт логическое значение), `-f` всегда передаёт строку. Тело целиком: `--input file.json` или `--input -` из stdin.

С флагом `--json` любая команда печатает машиночитаемый ответ в stdout, а сообщения о ходе работы уходят в stderr. `--debug` печатает запросы, ключ и токены при этом скрыты.

### Переменные окружения

| Переменная                 | Что задаёт                                             |
| -------------------------- | ------------------------------------------------------ |
| `STATUSER_API_KEY`         | API-ключ. Главнее ключа, сохранённого `statuser login` |
| `STATUSER_HEARTBEAT_TOKEN` | Токен heartbeat для `statuser run` и `heartbeat ping`  |
| `STATUSER_API_URL`         | Адрес API, по умолчанию `https://api.statuser.cloud`   |
| `LANG`, `LC_ALL`           | Язык сообщений: `ru…` — русский, иначе английский      |

### Коды выхода

| Код | Когда                                                  |
| --- | ------------------------------------------------------ |
| 0   | Успех                                                  |
| 1   | Ошибка API или сети, сбой песочницы сценариев          |
| 2   | Неверные аргументы или файл конфигурации               |
| 3   | Нет ключа или ключ не принят                           |
| 4   | Сценарий не прошёл (`scenarios test`, `scenarios run`) |

### Как это устроено

- **Сценарии выполняются не на вашей машине**, а в изолированной песочнице Statuser, из выбранного города, так же, как прогон по расписанию. Поэтому `scenarios test` показывает то, что увидит мониторинг, а не то, что видно из офиса.
- **Ключ уходит только на адрес API.** CLI не идёт за редиректами и не отправляет ключ на другой адрес. Ключ, сохранённый для одного адреса API, не используется для другого.
- **CLI ничего не удаляет сам.** `apply` и `deploy` только перечисляют серверы, которых нет в файле. Удаляют явные команды `delete`, и только после подтверждения.
- **Запрос повторяется, только когда он точно не ушёл**: если соединение не установилось, CLI делает две повторные попытки, после ответа 429 — ждёт паузу из `Retry-After`. Если запись ушла, но ответа нет (обрыв, таймаут, 5xx), `apply` и `deploy` останавливаются и сообщают, что исход неизвестен. Перед повтором запустите `statuser diff`.

## Смотрите также

[MCP-сервер Statuser](https://github.com/statuser-cloud/mcp) даёт то же API ИИ-клиентам: Claude Code, Cursor, VS Code.

## Обратная связь

Ошибки и предложения — в [issues](https://github.com/statuser-cloud/cli/issues). Об уязвимостях сообщайте приватно — см. [SECURITY.md](SECURITY.md).

Общие вопросы по API — в [документации Statuser](https://statuser.cloud/api-reference) или на [info@statuser.cloud](mailto:info@statuser.cloud).

## Лицензия

MIT — см. [LICENSE](LICENSE).
