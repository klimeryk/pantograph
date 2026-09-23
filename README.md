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

### Deploying on Railway

`railway.json` sets the build command, the start command and the `/api/health` healthcheck. Then:

1. **Attach a volume** (for example at `/data`) and set `STATE_FILE=/data/bot-state.json`. Without
   a volume the state file lives on the container's ephemeral disk, so every deploy forgets every
   mirrored channel and every link stops working.
2. Set `HOST=0.0.0.0`. The default `127.0.0.1` is unreachable from Railway's proxy and fails the
   healthcheck. `PORT` is injected by Railway.
3. Set `DISCORD_TOKEN`, and set `PUBLIC_URL` to the service's public domain (for example
   `https://pantograph-production.up.railway.app`).
4. Keep a single replica. Two instances would open two Gateway sessions and serve two disjoint sets
   of viewers (see *Scaling notes*). During a deploy the old and new containers overlap for a few
   seconds. That is harmless: the old one receives `SIGTERM` and viewers reconnect to the new one
   and get a fresh snapshot.

## The web page

The channel page is styled as a station departure board, a nod to the railway theme. Messages
themselves render as normal rich text (Discord markdown, custom emoji, stickers, images); only the
chrome around them is themed.

- **Board header**: TIME is a live clock, SERVICE is the channel, PLATFORM is a number derived from
  the channel id (purely decorative, but stable for a given channel), STATUS is the connection:
  `BOARDING` (connecting), `ON TIME` (live), `DELAYED` (reconnecting), `HELD AT SIGNAL` (syncing
  paused by a moderator) and `CANCELLED` (the link is no longer active).
- **Pantograph**: the small arm at the top left is raised and touching the wire while the stream
  is live and folds down when it is not. It sparks on every new message.
- **Now approaching**: when you have scrolled up, new messages are counted in a pill at the bottom
  instead of moving the page; click it to jump to the latest.
- **Announcements**: an opt-in station chime for new messages, off by default and remembered per
  browser. Everything animated respects the system "reduce motion" setting.
- **Screen readers**: each new message is announced once as "author: text" through a dedicated
  live region. Spoilers are read as "spoiler", and loading the page or reconnecting announces
  nothing. Edits update the message in place without re-announcing it. The message list is a
  keyboard-focusable "Messages" region.

## Links and who can see what

- A channel link is an unlisted, unguessable token (about 80 bits of randomness). Anyone who has
  the link can read the mirrored messages without logging in, so treat it like an unlisted video
  URL: share it deliberately.
- Links are shown only in ephemeral replies to members with **Manage Server**. The bot never posts
  them in a channel.
- `/pantograph rotate #channel` issues a new link and disconnects everyone on the old one;
  `/pantograph unwatch #channel` disables the link entirely. Viewers on a disabled link see the
  board flip to `CANCELLED` and "This service has been cancelled".
- Deleting a mirrored channel, or removing the bot from a server, disables the affected links
  automatically.
- Nothing about the links is exposed by `/api/health` or the logs. Like any secret in a URL, a
  link does end up in browser history, bookmarks and the access logs of any proxy in front of the
  server. `/pantograph rotate` is the remedy if a link leaks.
- Pages are served with a strict Content Security Policy (scripts, styles and connections only from
  the page's own origin, images also from Discord's CDN), `Referrer-Policy: no-referrer` and the
  usual hardening headers.

## Slash commands

All commands are limited to members with **Manage Server**, apply to the server they are run in,
and reply only to you (ephemeral). The permission is Discord's default for the command and is also
checked again by the bot, so loosening the command's permissions under Server Settings →
Integrations does not hand out links.

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
`GET /api/channels/<key>/stream` (SSE), `GET /api/stickers/<id>` (cached proxy for Lottie sticker
animations, which Discord's CDN serves without CORS headers), `GET /api/health`. The page checks the first endpoint
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
| A link opens but the board says `CANCELLED`                    | It was rotated, unwatched, or the state file was deleted. Run `/pantograph status` for the current link |
| Links point at the wrong host                                  | Set `PUBLIC_URL` to the origin viewers use                                            |
| Startup says the state file is from an earlier version         | Delete it and run `/pantograph watch` again                                           |
| Attachments stop loading after a day                           | Discord attachment URLs are signed and expire; the live window is short enough that this rarely matters |

## Known limitations and future work

This is a portfolio project, so these are recorded rather than fixed. Each entry says roughly what
it would take.

### Behaviour

- **Edits to old messages can be missed.** An edit to a message that discord.js no longer caches
  arrives as a partial update and is dropped, although the browser may still show that message.
  The fix is `await message.fetch()` for partial updates, at the cost of one REST call each.
- **Channel renames** show up only after the next re-sync (no `ChannelUpdate` handler).
- **Concurrent `/pantograph watch`** of the same channel by two moderators can issue two keys, and
  the second one wins.
- **Viewer cap is global.** One very popular channel can hit the 5000-viewer limit for every
  channel. Per-channel and per-IP caps would be the next step. There is no rate limiting at all.
- **Scrollback shrinks after a deploy.** A fresh snapshot replaces the browser's up-to-500 messages
  with the server's 50. Merging instead would keep scrollback, but would miss deletions of older
  messages that happened during the outage.
- **`/api/health` is public** and reveals channel and viewer counts. That is fine for a healthcheck
  and would be worth splitting for a real product.
- Unknown `/api/...` paths fall through to the web page and return `index.html` with status 200.
- Replies are sent to the browser as `replyToMessageId` but not rendered. Markdown lists are not
  parsed, and embeds are not shown.
- Threads and forum posts under a mirrored channel are not mirrored.
- The e2e suite runs in Chromium only and does not yet cover reconnect-and-replay.

### Why the frontend has no UI framework

The page is vanilla TypeScript: a store emits one change per stream event and a renderer applies
it to the DOM. Edits patch the existing row in place, so focus, revealed spoilers and running
sticker animations survive. The main bundle is 18 KB gzipped. The alternatives were weighed as
follows.

| Option | For | Against |
| --- | --- | --- |
| Vanilla (chosen) | No runtime, every DOM effect is explicit, the imperative parts (split-flap, Lottie, WebAudio, departure animations) need no wrappers | Each new piece of per-message state needs its own patch path |
| Solid | Fine-grained updates and keyed lists keep DOM nodes stable, which suits the diff-emitting store | New toolchain for a single list; the imperative parts stay imperative |
| Preact | React's model at about 4 KB | Re-renders the list per event unless memoised; exit animations need extra lifecycle work |
| React | Familiar to everyone | About 45 KB, exit animations need a library, StrictMode's double effects fight the Lottie player |

Richer rows (reactions, reply previews, embeds, grouping consecutive messages by author) are the
point where Solid would start to pay for itself.

### Feature ideas

| Feature | Effort | What it takes |
| --- | --- | --- |
| Browser notifications while the tab is in the background | Small | Ask for permission on the announcements toggle, then show a `Notification` for arrivals while `document.hidden`, reusing the screen-reader text. Notifications with the tab closed need a service worker, Web Push and a subscription store: large. |
| Emoji reactions | Medium | Non-privileged `GuildMessageReactions` intent, reaction add/remove events, `reactions` in `MessageView`, a chip row patched in place. |
| Reply previews | Small to medium | Resolve the referenced message on the backend and send the author and an excerpt. |
| Embeds and link previews | Medium | Discord adds embeds through a later edit, so this depends on fixing missed partial edits first. |
| Load older messages | Medium | A paginated history endpoint backed by `messages.fetch({ before })`, plus keeping the scroll position when prepending. |
| Typing indicator | Small to medium | `GuildMessageTyping` intent and a transient event that bypasses the replay log. |
| Viewer count on the page | Small | Add the subscriber count to `sync.state`, throttled. |
| Persistent history (Railway Postgres) | Medium to large | History survives restarts and enables pagination and search. |
| Horizontal scale | Large | Publish hub events to Redis or NATS and run stateless SSE relays (see *Scaling notes*). |
