# CLI Statuser

[![npm version](https://img.shields.io/npm/v/statuser.svg)](https://www.npmjs.com/package/statuser)
[![CI](https://github.com/statuser-cloud/cli/actions/workflows/ci.yml/badge.svg)](https://github.com/statuser-cloud/cli/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Утилита командной строки для [Statuser](https://statuser.cloud): сценарные проверки как код, плановые работы и пауза проверок на время деплоя, heartbeat для крон-задач. Работает поверх [публичного API Statuser](https://statuser.cloud/api-reference) с авторизацией по API-ключу.

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
- [Сценарии как код](#сценарии-как-код)
- [Плановые работы и пауза на время деплоя](#плановые-работы-и-пауза-на-время-деплоя)
- [Heartbeat](#heartbeat)
- [Готовые файлы CI](#готовые-файлы-ci)
- [Остальные команды](#остальные-команды)
- [Переменные окружения](#переменные-окружения)
- [Коды выхода](#коды-выхода)
- [Как это устроено](#как-это-устроено)

## Установка

Нужен Node.js 20.19 или новее.

```bash
npm install -g statuser
```

В CI устанавливать не обязательно — достаточно `npx`:

```bash
npx -y statuser scenarios deploy
```

Справка и сообщения выводятся на языке системы: русском, если `LANG` начинается с `ru`, иначе на английском. Справка по любой команде — `statuser <команда> --help`.

## Быстрый старт

1. Создайте ключ в панели: «Настройки → API».
2. Сохраните его на этой машине:

   ```console
   $ statuser login
   API-ключ (Настройки → API в панели Statuser):
   Готово: you@example.com. Ключ сохранён в /home/you/.config/statuser/config.json
   ```

3. Посмотрите серверы аккаунта:

   ```console
   $ statuser servers list
   ID    Имя                Протокол  Статус  Хост                     Проект
   1874  Сайт магазина      http      online  https://shop.example.com 100000
   2041  Вход в кабинет     scenario  online  scenario://2041          100000
   ```

Ключ сохраняется с доступом только для владельца файла. В CI передавайте его переменной `STATUSER_API_KEY`, а не флагом: аргументы команды видны в истории и в списке процессов.

## Сценарии как код

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

Один файл до 64 КБ. Из пакетов доступен `@playwright/test`, свои вспомогательные файлы подключить нельзя. Логины и пароли — только через `process.env`.

### Прогнать до выкладки

```bash
statuser scenarios test checks/checkout.spec.ts \
  --location msk-1 --env SHOP_LOGIN='$SHOP_LOGIN' --env SHOP_PASSWORD='$SHOP_PASSWORD'
```

Сервер при этом не создаётся, история проверок и инциденты не меняются. Значение вида `$NAME` берётся из окружения, поэтому пароль не попадает в историю команд. Ссылки на скриншот, видео и трейс действуют час. Код выхода: 0 — прошёл, 4 — не прошёл, 1 — сбой песочницы или API.

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

| Поле | Что значит |
|---|---|
| `project_id` | Проект, в котором живут сценарии. `id` — из `statuser api /v1/projects` |
| `name` | Имя сервера в Statuser. По нему сценарий узнаётся внутри проекта |
| `id` | Необязательно. Нужен, чтобы переименовать сценарий: без него новое имя заведёт новый сервер |
| `file` | Путь к тесту относительно `statuser.json` |
| `interval` | Как часто проверять, секунд: от 60 до 86 400 и не меньше таймаута. По умолчанию 300 |
| `timeout` | Сколько ждать прогон, секунд: 15, 30, 45, 60 или 120. По умолчанию 30 |
| `location` | Откуда проверять: `msk-1`, `spb-1`, `ala-1`, `nyc-1` или `ams-1`. По умолчанию `msk-1` |
| `env` | Переменные окружения теста. Имена — заглавными буквами, значение `$NAME` берётся из окружения CI |

Как ведёт себя `deploy`:

- Весь конфиг проверяется до первой записи: ошибка в пятом сценарии не оставит первые четыре выкаченными.
- `env` — полный набор переменных: имя, которое убрали из конфига, удаляется и на сервере. Нет поля `env` — переменные на сервере не трогаются. Значения API не возвращает, поэтому заданные переменные отправляются при каждом запуске.
- Один и тот же текст скрипта не может стоять у двух серверов аккаунта — `deploy` скажет об этом до записи.
- Ничего не удаляется. Сценарии проекта, которых нет в конфиге, только показываются в плане.
- Запись остановилась на ошибке — то, что применено до неё, остаётся. Повторный запуск доведёт проект до конфига.

Число сценариев, минимальный интервал и максимальный таймаут зависят от тарифа.

## Плановые работы и пауза на время деплоя

Плановые работы показываются на странице статуса и рассылаются подписчикам, но алёрты не глушат. Поэтому вокруг деплоя — два шага: окно на странице и пауза проверок.

```bash
statuser maintenance start --page 12 --all-servers \
  --title "Обновление" --description "Обновляем магазин" --for 20m --json > maintenance.json
statuser servers pause --project 100000 --json > paused.json

# … деплой …

statuser servers resume --from paused.json
statuser maintenance end --page 12 "$(jq .id maintenance.json)" --message "Обновление завершено"
```

- `--servers 101,102` — id серверов этой страницы статуса, `--all-servers` — все её серверы. `--for` — длительность окна: `30m`, `2h`, `1h30m`.
- `resume --from` возобновляет только то, что поставил на паузу шаг `pause`: серверы, которые уже стояли на паузе, такими и останутся.
- `maintenance end` без `--message` только переносит время окончания. С `--message` в таймлайне работ появляется запись, и подписчики получают уведомление. Повторный `end` дату не сдвигает — шаг можно безопасно перезапустить.

## Heartbeat

```bash
STATUSER_HEARTBEAT_TOKEN=… statuser run -- ./backup.sh
```

Команда завершилась с кодом 0 — Statuser получает сигнал «работает», с другим кодом — «ошибка», и инцидент открывается сразу. Код выхода `run` — код самой команды: если сигнал не дошёл из-за сети, успешный бэкап не превратится в упавший. Команда убита сигналом — код 128 + номер сигнала, как в shell.

Строка для crontab:

```cron
0 3 * * * STATUSER_HEARTBEAT_TOKEN=… /usr/local/bin/statuser run -- /opt/scripts/backup.sh
```

У крона короткий `PATH`, поэтому путь к `statuser` указан полностью — его покажет `which statuser`.

- Нужен только токен heartbeat из карточки сервера, API-ключ на машине с кроном не нужен. Передавайте его переменной, а не флагом `--heartbeat`: аргументы видны в списке процессов всё время, пока идёт команда.
- Пока не пришёл первый сигнал, Statuser не знает, что задача запущена, и пропуски не считает. Интервал и допустимую задержку heartbeat-сервера задайте с запасом на самую долгую задачу.
- Разовый сигнал без команды: `statuser heartbeat ping "$TOKEN"`, сигнал ошибки — с `--fail`.

## Готовые файлы CI

### GitHub Actions

Выкатить сценарии при изменении тестов:

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
            npx -y statuser scenarios test "$file" \
              --env SHOP_LOGIN='$SHOP_LOGIN' --env SHOP_PASSWORD='$SHOP_PASSWORD'
          done
      - name: Выкатить
        run: npx -y statuser scenarios deploy
```

### GitLab CI

Окно плановых работ и пауза проверок вокруг деплоя. `after_script` выполняется и при упавшем деплое, поэтому проверки возобновятся в любом случае:

```yaml
deploy:
  image: node:22
  variables:
    STATUSER_PAGE: "12"
    STATUSER_PROJECT: "100000"
  before_script:
    - npx -y statuser maintenance start --page "$STATUSER_PAGE" --all-servers
      --title "Обновление" --description "Обновляем сервис" --for 30m --json > maintenance.json
    - npx -y statuser servers pause --project "$STATUSER_PROJECT" --json > paused.json
  script:
    - ./deploy.sh
  after_script:
    - npx -y statuser servers resume --from paused.json
    - npx -y statuser maintenance end --page "$STATUSER_PAGE"
      "$(node -p 'require("./maintenance.json").id')" --message "Обновление завершено"
```

`STATUSER_API_KEY` задайте в настройках CI/CD проекта как замаскированную переменную.

## Остальные команды

```bash
statuser servers list --project 100000 --protocol http
statuser servers get 101
statuser api /v1/incidents -F limit=5
statuser api /v1/servers/101 -X PATCH -F check_interval=120
statuser whoami
statuser logout
```

`statuser api` — запрос к любому методу [API](https://statuser.cloud/api-reference), как `gh api`. Поля из `-F` для GET и DELETE уходят в query, для остальных методов — в тело запроса. `-F` разбирает значение как JSON (`-F on=true` — логическое значение), `-f` всегда передаёт строку. Тело целиком — `--input file.json` или `--input -` из stdin.

У любой команды `--json` печатает машиночитаемый ответ в stdout, а сообщения о ходе работы уходят в stderr. `--debug` печатает запросы — ключ и токены скрыты.

## Переменные окружения

| Переменная | Что задаёт |
|---|---|
| `STATUSER_API_KEY` | API-ключ. Главнее ключа, сохранённого `statuser login` |
| `STATUSER_HEARTBEAT_TOKEN` | Токен heartbeat для `statuser run` и `heartbeat ping` |
| `STATUSER_API_URL` | Адрес API, по умолчанию `https://api.statuser.cloud` |
| `LANG`, `LC_ALL` | Язык сообщений: `ru…` — русский, иначе английский |

## Коды выхода

| Код | Когда |
|---|---|
| 0 | Успех |
| 1 | Ошибка API или сети, сбой песочницы сценариев |
| 2 | Неверные аргументы или конфиг |
| 3 | Нет ключа или ключ не принят |
| 4 | Сценарий не прошёл (`scenarios test`) |

## Как это устроено

- **Тесты выполняются не на вашей машине**, а в изолированной песочнице Statuser, из выбранного города — так же, как прогон по расписанию. Поэтому `scenarios test` показывает то, что увидит мониторинг, а не то, что видно из офиса.
- **Ключ уходит только на адрес API.** CLI не идёт за редиректами и не отправляет ключ на другой адрес. Ключ, сохранённый для одного адреса API, не используется для другого.
- **CLI ничего не удаляет сам.** Удалить сервер можно только явным запросом через `statuser api`.

## Смотрите также

- [MCP-сервер Statuser](https://github.com/statuser-cloud/mcp) — то же API из ИИ-клиента: Claude Code, Cursor, VS Code.
- [Документация API](https://statuser.cloud/api-reference).
- Ошибки и предложения — в [issues](https://github.com/statuser-cloud/cli/issues).

## Лицензия

MIT
