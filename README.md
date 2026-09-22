# Pantograph

Pantograph mirrors Discord channels to live web pages. A bot listens to the channels through the
Discord Gateway and a small web server streams every new message, edit and deletion to connected
browsers in real time. Each mirrored channel gets its own unlisted link.

```
Discord Gateway ──ws──▶ bot (discord.js) ──▶ one in-memory hub per channel ──▶ browsers at /c/<key>
                                 ▲                                              (Server-Sent Events)
                   /pantograph slash commands (watch · unwatch · pause · resume · rotate · status · notify)
```

Everything runs in one Node.js process. There is no build step for the backend: Node 24 runs the
TypeScript sources directly. One deployment can serve any number of servers and channels.

## Prerequisites

- Node.js 24.12 or newer (`node --version`)
- npm 11 (ships with Node 24)
- A Discord server where you have the **Manage Server** permission

## 1. Create the Discord application

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and click
   **New Application**. Name it (for example "Pantograph").
2. Go to **Bot** in the left sidebar.
   - Click **Reset Token** and copy the token. You will paste it into `.env` in the next step.
   - Under **Privileged Gateway Intents**, enable **Message Content Intent**. Without it Discord
     hides the text of messages and the bot cannot mirror anything. No review is needed while the
     bot is in fewer than 100 servers.
3. Go to **Installation**.
   - Under **Installation Contexts** keep **Guild Install** enabled (User Install is not needed).
   - Under **Default Install Settings → Guild Install** add the scopes `applications.commands` and
     `bot`, and the bot permissions **View Channels**, **Read Message History** and
     **Send Messages**.

You do not have to build the invite link by hand: the bot logs a ready-made install link every time
it starts (step 3 below).

## 2. Configure and install

```sh
cp .env.example .env      # paste DISCORD_TOKEN
npm install
```

| Variable        | Required | Default                       | Purpose                                                    |
| --------------- | -------- | ----------------------------- | ---------------------------------------------------------- |
| `DISCORD_TOKEN` | yes      |                               | Bot token from the Developer Portal                        |
| `PORT`          | no       | `3000`                        | Port of the web server                                     |
| `HOST`          | no       | `127.0.0.1`                   | Bind address; use `0.0.0.0` behind a reverse proxy         |
| `PUBLIC_URL`    | no       | `http://localhost:5173` in development, `http://localhost:$PORT` in production | Origin the channel links are built from. Set it to the address viewers will use |
| `STATE_FILE`    | no       | `backend/data/bot-state.json` | Where mirrored channels, their links and paused flags persist |
| `LOG_LEVEL`     | no       | `info`                        | `debug`, `info`, `warn` or `error`                         |

## 3. Run it

Development (backend with auto-reload on <http://127.0.0.1:3000>, web page with hot reload on
<http://localhost:5173>):

```sh
npm run dev
```

The backend log prints an **Install link** on startup. Open it, pick your server and confirm. Then,
in Discord, run:

```
/pantograph watch #the-channel
```

The bot replies (only to you) with a link such as `http://localhost:5173/c/k7fq-2x9p-lm3n-r8st`.
Open it: recent history is already there, and anything posted in the channel from now on appears
within a second. Edits update the message in place and deletions remove it. Repeat for as many
channels as you like; each gets its own link.

Production (single server that also serves the built web page):

```sh
npm run build
PUBLIC_URL=https://mirror.example.com npm start
```

## Links and who can see what

- A channel link is an unlisted, unguessable token (about 80 bits of randomness). Anyone who has
  the link can read the mirrored messages without logging in, so treat it like an unlisted video
  URL: share it deliberately.
- Links are shown only in ephemeral replies to members with **Manage Server**. The bot never posts
  them in a channel.
- `/pantograph rotate #channel` issues a new link and disconnects everyone on the old one;
  `/pantograph unwatch #channel` disables the link entirely. Viewers on a disabled link see
  "This link is not active".
- Deleting a mirrored channel, or removing the bot from a server, disables the affected links
  automatically.
- Nothing about the links is exposed by `/api/health` or the logs.

## Slash commands

All commands are limited to members with **Manage Server**, apply to the server they are run in,
and reply only to you (ephemeral).

| Command                             | What it does                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| `/pantograph status [#channel]`     | Every mirrored channel in this server with its link, running/paused, viewers, buffered messages and last event; plus gateway ping and open incidents. Give a channel to see only that one |
| `/pantograph watch #channel`        | Mirror this channel and get its link. Checks the bot can read it, then syncs the last 50 messages. Running it again returns the same link |
| `/pantograph unwatch #channel`      | Stop mirroring; the link stops working and viewers are disconnected                 |
| `/pantograph pause [#channel]`      | Stop forwarding for one channel, or for every channel in this server. Viewers see a "paused" banner |
| `/pantograph resume [#channel]`     | Re-sync recent history and continue forwarding                                      |
| `/pantograph rotate #channel`       | Replace the link; the old one stops working immediately                              |
| `/pantograph notify #channel`       | Where the bot posts problem reports for this server (see below). Logs only if unset |

The bot's presence summarises the state across all servers: **Watching #channel**,
**Watching 3 channels (1 paused)**, idle when everything is paused.

## How problems are reported

Problems that a Discord moderator can fix (a mirrored channel became unreadable, history could
not be loaded, slash commands could not be registered) are posted to that server's notify channel
as **one message per problem and channel**. Repeated failures update that message in place
(attempt count, last seen) at most every five minutes instead of posting again, and it is edited
to "Resolved" when the problem clears. Everything is also written to the structured log. If the
notify channel is not set, only the log is used, and `/pantograph status` always lists open
incidents.

Gateway hiccups are handled by discord.js (resume with event replay). After an outage longer than a
minute a single "connection restored" notice is posted. If Discord starts a fresh session instead
of resuming, recent history is re-synced so nothing is missed.

## Development

```sh
npm run check        # Biome lint + format check (npm run check:fix to apply)
npm run typecheck    # tsc for every workspace
npm run test:e2e     # builds the frontend, starts a fake backend, drives a browser with Playwright
```

The first e2e run needs a browser: `npx playwright install chromium`.

Layout:

```
shared/    wire protocol shared by backend and frontend (types, event names, URL helpers)
backend/   bot, per-channel hubs, HTTP/SSE server   (node runs src/main.ts directly)
frontend/  Vite + vanilla TypeScript + Tailwind; /c/<key> streams a channel, / is a landing page
e2e/       Playwright tests and the fake two-channel backend they drive
```

HTTP surface: `GET /api/channels/<key>` (channel name and paused flag, `404` for unknown keys),
`GET /api/channels/<key>/stream` (SSE), `GET /api/health`. The page checks the first endpoint
before opening the stream and again whenever the stream closes, which is how it detects a
revoked link.

Backend code must stay within Node's type-stripping subset: no `enum`, no parameter properties,
`.ts` extensions in relative imports, `import type` for types. Biome and `tsc` enforce this.

## Scaling notes

- **One process** comfortably serves a few thousand concurrent viewers on a small VM. Each open
  SSE connection costs tens of kilobytes; raise the file-descriptor limit (`ulimit -n`) to go
  beyond ~10k. The dominant cost is outbound bandwidth: every Discord event is one ~1 KB frame per
  viewer of that channel. Each mirrored channel additionally holds its last 50 messages and 500
  serialized frames in memory (well under a megabyte).
- **Already built in:** each event is serialized once and shared by all viewers of the channel;
  viewers that fall behind are dropped and reconnect; browsers reconnect automatically and replay
  missed events with `Last-Event-ID`; a heartbeat keeps proxies from closing idle streams; a
  global connection cap returns 503 with `Retry-After`.
- **Growing horizontally:** the Gateway connection must stay a single process (a second consumer
  would duplicate every event). Publish hub events to Redis or NATS keyed by channel and run
  stateless SSE relay nodes behind a load balancer, or hand the fan-out to a managed realtime
  service. For very large audiences with relaxed latency, write a JSON snapshot per channel to a
  CDN on every event and let browsers poll it.
- **Why SSE instead of WebSocket:** the data flows one way, `EventSource` gives reconnection and
  replay for free, and plain HTTP works with every proxy and with HTTP/2 multiplexing.

## Troubleshooting

| Symptom                                                        | Fix                                                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Startup says Discord refused the Message Content intent (close code 4014) | Enable **Message Content Intent** under Bot → Privileged Gateway Intents           |
| Messages arrive on the page with empty text                    | Same as above; the intent was enabled after the bot connected, restart it            |
| `/pantograph` does not show up in Discord                      | The bot was added without the `applications.commands` scope. Re-add it via the install link from the log |
| `/pantograph watch` says permissions are missing               | Give the bot **View Channel** and **Read Message History** in that channel           |
| A link opens but shows "This link is not active"              | It was rotated, unwatched, or the state file was deleted. Run `/pantograph status` for the current link |
| Links point at the wrong host                                  | Set `PUBLIC_URL` to the origin viewers use                                            |
| Startup says the state file is from an earlier version         | Delete it and run `/pantograph watch` again                                           |
| Attachments stop loading after a day                           | Discord attachment URLs are signed and expire; the live window is short enough that this rarely matters |

## Not in this iteration

- Threads and forum posts under a mirrored channel are not mirrored.
- Message text is shown as plain text with mentions resolved; Discord markdown, embeds and
  reactions are left for the rendering revamp.
