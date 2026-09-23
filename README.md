# Pantograph

```text
 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    ════╤════
                       ╱ ╲
                       ╲ ╱
          ┌─────────────┴───────────────┐
          │ ▣   ▣   ▣   ▣   ▣   ▣   ▣   │
          └───◎──◎─────────────────◎──◎─┘
```

**Publicly accessible dynamic mirror of your Discord channels.**

A pantograph is the arm on top of an electric train that stays in contact with the overhead
wire. This one keeps contact with Discord instead: a bot listens to the channels you pick and a
small web server streams every new message, edit and deletion to anyone who has the link. No
Discord account needed on the reading end.

<img width="2880" height="1572" alt="Screenshot 2026-09-23 at 22-44-45 #announcements · Pantograph" src="https://github.com/user-attachments/assets/3dbfee63-f097-46a5-a7ba-39bc201cad88" />

## What it does

- **Real time.** New messages arrive within a second (match that, DB!), edits update in place, deletions disappear.
- **One unlisted link per channel**, for as many channels and servers as you like.
- **Looks like Discord.** Markdown, spoilers, mentions, timestamps, and _most imporantly_: obligatory support for custom emoji, images and
  stickers, animated ones included.
- **~Conductor~ Moderator controls.** Pause, rotate a leaked link or stop mirroring with one slash... command.
- **As great as communication as its author.** Reports issues to a separate, optional channel (plus, server logs!).
- **Accessible.** Screen readers, keyboard, and "reduce motion" are all supported.

## The web page

The channel page is a station departure board. The board is the station and the messages are the
passengers. Only the chrome is themed; messages look like messages, cause how can you express the awesomeness (and chaos) that are Discord messages otherwise?

The header shows **TIME** (a live clock), **SERVICE** (the channel), **PLATFORM** (a number
derived from the channel id: decorative, but stable) and **STATUS**, which tells you how the
connection is doing:

| Status           | Meaning                                                |
| ---------------- | ------------------------------------------------------ |
| `BOARDING`       | Connecting                                             |
| `ON TIME`        | Live                                                   |
| `DELAYED`        | Lost the connection, reconnecting                      |
| `HELD AT SIGNAL` | A moderator paused the channel                         |
| `CANCELLED`      | The link is no longer active (rotated or unwatched)    |

A few more details:

- The little pantograph in the corner is raised against the wire while the stream is live and
  folds down when it isn't. There's _totally_ nothing else it does...
- Scrolled up to read something? New arrivals are counted in a "now approaching" pill at the
  bottom instead of yanking the page. Click it to jump to the latest.
- There's an opt-in station chime for new messages. It's off by default and your browser
  remembers the choice. If only you could mute some sounds on real train stations.
- Screen readers get each new message once, as "author: text". Spoilers are read as "spoiler".
  Loading the page, reconnecting and edits announce nothing.

The board font is [Departure Mono](https://departuremono.com)
([SIL OFL 1.1](frontend/public/fonts/DepartureMono-LICENSE.txt)). The license may or may not mandate its use for any railway-related project.

## Commands

Everything lives under one slash command, `/pantograph`. It works on the server you run it in,
only members with **Manage Server** can use it, and replies are visible only to you.

| Command                         | What it does                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `/pantograph watch #channel`    | Start mirroring a text or announcement channel and get its link. Loads the last 50 messages. Running it again gives you the same link |
| `/pantograph status [#channel]` | Mirrored channels with their links, running or paused, viewers, buffered messages and last event. Also gateway ping and open problems |
| `/pantograph pause [#channel]`  | Stop forwarding one channel, or every channel in the server. Viewers see `HELD AT SIGNAL`              |
| `/pantograph resume [#channel]` | Re-sync recent history and carry on                                                                    |
| `/pantograph rotate #channel`   | Issue a new link. The old one stops working immediately                                                |
| `/pantograph unwatch #channel`  | Stop mirroring. The link stops working and viewers are disconnected                                    |
| `/pantograph notify #channel`   | Where the bot should post problem reports for this server. Without it, problems only go to the logs     |

*Manage Server* is Discord's default permission for the command, and server admins can loosen it
under Server Settings → Integrations. The bot checks the permission again on its own, so loosening
it doesn't hand out links.

Each server only sees and controls its own channels. The bot's Discord status is shared by every
server it is in, so it is a fixed "Watching the departure board" to avoid leaking any information.

## Links and privacy

A channel link looks like `/c/k7fq-2x9p-lm3n-r8st`: about 80 bits of randomness, not guessable (and if you can, then you probably deserve to see the channel, bravo!).
Similar to a link to an unlisted video. Anyone who has it can read along without logging in, so share it
deliberately.

- The bot shows links in messages that only you can see, never in a channel.
- `rotate` replaces a link and `unwatch` kills it. Viewers on a dead link see the board flip to
  `CANCELLED`. Deleting the channel or removing the bot does the same.
- Links stay out of `/api/health` and the logs, but like any URL they end up in browser history
  and proxy logs. If one leaks, `rotate` it.
- Pages ship a strict Content Security Policy (own origin only, plus Discord's CDN for images),
  `Referrer-Policy: no-referrer` and the usual hardening headers.

## When things go wrong

Problems a moderator can fix (an unreadable channel, history that won't load, commands that
couldn't be registered) are posted to the notify channel as **one message per problem and
channel**. Repeats update that message at most every five minutes instead of posting again, and it
turns into a green "Resolved" once the problem clears. Everything also goes to the log, and
`/pantograph status` lists whatever is still open.

Gateway hiccups are handled by discord.js, which resumes and replays what was missed. After an
outage longer than a minute the bot posts one "connection restored" notice. If Discord starts a
fresh session instead, recent history is re-synced so nothing slips through.

## All aboard: setting it up

### Prerequisites

- Node.js 24.12 or newer (see [`.nvmrc`](.nvmrc)). The backend relies on Node 24 running
  TypeScript directly, so older versions won't do.
- npm 11, which ships with Node 24.
- A Discord server where you have **Manage Server**.
- Love for trains.

### 1. Create the Discord application

1. In the [Discord Developer Portal](https://discord.com/developers/applications), click
   **New Application** and give it a name ("Pantograph" works).
2. Under **Bot**:
   - Click **Reset Token** and copy the token. It goes into `.env` in the next step.
   - Under **Privileged Gateway Intents**, enable **Message Content Intent**.
3. Under **Installation**:
   - Keep **Guild Install** enabled. You don't need User Install.
   - Under **Default Install Settings → Guild Install**, add the scopes `applications.commands`
     and `bot`, and the permissions **View Channels**, **Read Message History** and
     **Send Messages**.

> [!NOTE]
> Without the Message Content intent Discord hands the bot messages with the text cut out, which
> makes for a rather quiet mirror. Once the bot reaches 10,000 users, Discord requires a
> [review](https://support-dev.discord.com/hc/en-us/articles/6205754771351-How-do-I-get-Privileged-Intents-for-my-bot)
> to keep the intent. Until then, flipping the toggle is enough.

You don't need to build an invite link by hand. The bot logs one every time it starts.

### 2. Configure

```sh
cp .env.example .env
# fill out DISCORD_TOKEN in .env
npm install
```

See [`.env.example`](.env.example) for description of every supported variable.

### 3. Run it

For local development, use:
```sh
npm run dev
```

This starts the backend on <http://127.0.0.1:3000> (it restarts when you save a file) and the web
page on <http://localhost:5173> (with hot reload). The backend log prints an **Install link**.
Open it, pick your server and confirm. Then, in Discord:

```text
/pantograph watch #the-channel
```

You'll get a link like `http://localhost:5173/c/k7fq-2x9p-lm3n-r8st`. Open it. Recent history is
already there, and anything posted from now on arrives within a second.

For production, a single server builds the page and serves it too:

```sh
npm run build
PUBLIC_URL=https://mirror.example.com npm start
```

### Deploying on Railway

[`railway.json`](railway.json) already sets the build and start commands and the `/api/health`
healthcheck. What's left:

1. **Attach a volume** (say at `/data`) and set `STATE_FILE=/data/bot-state.json`.
2. Set `HOST=0.0.0.0`. The default `127.0.0.1` can't be reached from Railway's proxy, so the
   healthcheck fails. Railway injects `PORT` itself.
3. Set `DISCORD_TOKEN`, and set `PUBLIC_URL` to the service's public domain, for example
   `https://pantograph-production.up.railway.app`.
4. Keep a single replica. Just like with Highlander, there can only be one. Two instances would open two Gateway sessions and each would serve its
   own half of the viewers.

> [!WARNING]
> Without a volume the state file lives on the container's ephemeral disk. Every deploy forgets
> every mirrored channel and every link stops working.

During a deploy the old and new containers overlap for a few seconds. That's harmless: the old one
gets `SIGTERM`, and viewers reconnect to the new one and get a fresh snapshot.

## Signal failures (troubleshooting)

| Symptom                                                         | Fix                                                                                     |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Startup says Discord refused the Message Content intent (4014)  | Enable **Message Content Intent** under Bot → Privileged Gateway Intents                |
| Messages arrive with empty text                                 | Same thing. The intent was turned on after the bot connected, so restart it             |
| `/pantograph` doesn't show up in Discord                        | The bot was added without the `applications.commands` scope. Re-add it with the install link from the log |
| `/pantograph watch` complains about permissions                 | Give the bot **View Channel** and **Read Message History** in that channel              |
| A link opens but the board says `CANCELLED`                     | It was rotated or unwatched, or the state file is gone. `/pantograph status` has the current link |
| Links point at the wrong host                                   | Set `PUBLIC_URL` to the address viewers use                                             |
| Startup says the state file is from an earlier version          | Delete it and `/pantograph watch` again                                                 |
| Attachments stop loading after a day or so                      | Discord signs attachment URLs and they expire. Given how short the live window is, this rarely matters |

Other fatal Gateway close codes (a bad token, for example) are explained in plain words at
startup. The whole list is in
[`gatewayCloseCodes.ts`](backend/src/discord/gatewayCloseCodes.ts). The process then exits with
code 3 so a supervisor can restart it.

## Under the hood

Everything runs in one Node.js process: a [discord.js](https://discord.js.org) bot on the Gateway
and a [Hono](https://hono.dev) server that pushes events to browsers over Server-Sent Events.
There's no build step for the backend, because Node 24 runs the TypeScript as is.

```mermaid
flowchart LR
    gateway[Discord Gateway] --> source[DiscordMessageSource]
    source --> hubs["Per-channel hub<br/>(last 50 messages, 500-event replay log)"]
    hubs -- SSE --> browsers["Browsers at /c/&lt;key&gt;"]
    commands["/pantograph commands"] --> controller[SyncController]
    controller --> hubs
    controller --> state[(bot-state.json)]
    source -- failures --> incidents[IncidentTracker]
    controller -- failures --> incidents
    incidents --> notify[Notify channel]
```

| Directory                | What's in it                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| [`shared/`](shared)      | The wire protocol both sides agree on ([`protocol.ts`](shared/src/protocol.ts))            |
| [`backend/`](backend)    | Bot, per-channel hubs, HTTP and SSE server. Starts at [`main.ts`](backend/src/main.ts)     |
| [`frontend/`](frontend)  | Vite, vanilla TypeScript and Tailwind. `/` is a landing page, `/c/<key>` is a channel      |
| [`e2e/`](e2e)            | Playwright tests plus a fake two-channel backend for them to drive                         |

The HTTP surface is small:

- `GET /api/channels/<key>`: channel name and paused flag, or `404`. The page checks it before
  opening the stream and after every disconnect, since `EventSource` can't see status codes.
- `GET /api/channels/<key>/stream`: the SSE stream. `Last-Event-ID` replays what you missed, or
  you get a fresh snapshot if that's too far back.
- `GET /api/stickers/<id>`: cached proxy for Lottie stickers, which Discord's CDN serves without
  CORS headers.
- `GET /api/health`: the healthcheck.

### Working on it

```sh
npm run check        # Biome lint and format check (npm run check:fix to apply)
npm run typecheck    # tsc in every workspace
npm run test:e2e     # builds the frontend, starts the fake backend, runs Playwright
```

The first e2e run needs a browser: `npx playwright install chromium`.

Because Node strips the types instead of compiling them, the backend has to stay within the
erasable subset: no `enum`, no parameter properties, `.ts` extensions on relative imports and
`import type` for types. [Biome](biome.json) and `tsc` both enforce it.

### Scaling notes

- **One process** should be able to handle a few thousand viewers on a small VM, at tens of kilobytes per SSE
  connection (raise `ulimit -n` past ~10k). Bandwidth is the real cost: every Discord event is a
  ~1 KB frame per viewer. Each channel keeps 50 messages and 500 events in memory, well under a
  megabyte.
- **Already built in:** events are serialized once per channel, viewers more than 100 events
  behind are dropped and reconnect, a 25-second heartbeat keeps proxies happy (if they can ever be happy), and past 5,000
  viewers the server answers `503` with `Retry-After`.
- **Going horizontal:** the Gateway connection must stay in one process, since a second one would
  duplicate every event. Publish hub events to, for example, Redis and run stateless SSE relays behind a
  load balancer. For huge, latency-tolerant audiences, push a JSON snapshot per channel to a CDN and
  let browsers poll it.

### Implementation details and decisions

#### SSE rather than WebSockets

The data only flows one way, `EventSource` reconnects and replays for
free, and it's plain HTTP, so it gets along with every proxy and with HTTP/2 multiplexing. Perfect use case for SSE.

#### Vanilla TypeScript.
A store emits one change per stream event and a renderer applies it to the DOM, patching rows in place so focus, revealed spoilers and running sticker
animations survive an edit.

I initially went with vanilla approach because reactive frameworks seemed overkill... and I underestimated how much I'd end over-engineering this... But still, it's manageable. React would not be a good fit, since we're mostly dealing with reacting to external signals, controlling animations, etc. Things that React can do, but not without... persuasion. But depending on the long-term plans for this (is it going to be a part of a broader codebase/product?), what is the team familiar with, etc. it could be easily migrated to a framework that could help, for example, when we continue iterating the frontend to support more features (emoji reactions!).

#### E2E tests only
Depending on the long-terms plans for it, we could extend the test harness, but for now I went with simple-ish e2e ones to ensure no obvious breakage and quickly test, well, end to end.

#### Safe (but potentially limited) Discord Markdown parsing
Using [discord-markdown-parser](https://github.com/ItzDerock/discord-markdown-parser) to parse the Discord-flavored Markdown into an AST tree to safely then render it on the frontend. The library itself is not _super_ well-maintained, plus we don't support all the possible craziness that Discord users can submit (see below, like embeds). But most things are supported, especially with the use case I had in mind (public "announcement"-like page).



## Mind the gap: known limitations and future work

No project is perfect and these are some of the edge cases and quirks that you might run into, but I had to stop somewhere.

- **Edits to old messages can be missed.** When discord.js no longer has a message cached, an edit
  arrives as a partial update and gets dropped, even if the browser still shows that message.
  Calling `await message.fetch()` on partial updates would fix it, at one REST call each. To keep
  the cost down, fetch only for channels that currently have viewers.
- **Channel renames** only show up after the next re-sync, because nothing handles `ChannelUpdate`.
  Handle that event and push a `sync.state` with the new name to the channel's viewers.
- **Two moderators running `/pantograph watch`** on the same channel at the same moment can end up
  with two keys. The second one wins (and should buy a lottery ticket). Serializing `watch` per
  channel would let the second call find the first key and hand it back.
- **The viewer cap is global.** One very popular channel can use up all 5,000 slots for everyone.
  Per-channel and per-IP caps would be next. There's no rate limiting at all (you would not abuse this, would you?).
  Count connections per channel and per client IP (from `X-Forwarded-For` behind Railway's proxy)
  next to the global counter, and put a rate-limiting middleware in front of `/api`.
- **Scrollback shrinks after a deploy.** The browser keeps up to 500 messages, but a fresh snapshot
  replaces them with the server's 50. Merging would keep the scrollback but miss older messages
  that were deleted during the outage. Keeping the older local messages is easy. Pruning the
  deleted ones needs the server to remember deletions, which means persistent history.
- **`/api/health` is public** and reveals channel and viewer counts. Fine for a healthcheck. 
  We could split it: a bare `ok` for the platform, and the counts behind a token on a
  separate endpoint.
- Unknown `/api/...` paths fall through to the web page and return `index.html` with a 200. An
  `/api/*` catch-all returning a JSON 404 before the SPA fallback would fix it.
- Replies aren't rendered (the reference _is_ available as `replyToMessageId`), Markdown lists
  aren't parsed and embeds aren't shown. Replies need the referenced message resolved on the
  backend, lists an extra parser rule, and embeds the partial-edit fix above plus an `embeds`
  field in `MessageView`.
- Threads and forum posts under a mirrored channel aren't mirrored. Listening for thread events
  and giving each thread its own hub (and link, or a spot on the parent's page) would cover it.
- The e2e suite runs in Chromium only and doesn't cover reconnect-and-replay yet. It's more of a
  basic safety net to ensure the code works end to end, than cover all cases.

This is not the final stop for this project, there's many more stations it could go to:

| Feature | Effort | What it takes |
| --- | --- | --- |
| Emoji reactions | Medium | The non-privileged `GuildMessageReactions` intent, reaction add/remove events, `reactions` in `MessageView` and a chip row patched in place. Normally emojis are _super important_, but depending on the use case (an "announcement" page), it might be a "feature" to strip them when showing the messages publicly. Or can be a configuration flag. |
| Browser notifications while the tab is in the background | Small | Ask for permission on the announcements (currently sound only) toggle, then show a `Notification` for arrivals while `document.hidden`, reusing the screen-reader text. With the tab closed it's a different story: service worker, Web Push and a subscription store, so more effort. |
| Reply previews | Small to medium | Resolve the referenced message on the backend and send its author and an excerpt. |
| Embeds and link previews | Medium | Discord adds embeds through a later edit, so this needs the missed-partial-edits fix first. |
| Load older messages | Medium | A paginated history endpoint backed by `messages.fetch({ before })`, plus keeping the scroll position when prepending. |
| Typing indicator | Small to medium | Choo, choo, a new message is (probably) arriving! The `GuildMessageTyping` intent and a transient event that skips the replay log. |
| Viewer count on the page | Small | Add the subscriber count to `sync.state`, throttled. |
| Persistent history (Railway Postgres) | Medium to large | History survives restarts, and pagination and search become possible. |
| Horizontal scale | Large | Publish hub events to Redis and run stateless SSE relays (see [Scaling notes](#scaling-notes)). |

