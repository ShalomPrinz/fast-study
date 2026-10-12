# The Moodle gate

auto is the only process that talks to the configured Moodle site, and it does so one request at a
time. A request holds the lock while it runs and for **3 seconds after it ends**, success or failure,
so the site sees a slow, human-paced trickle instead of the bursts a bot manager flags
([MOODLE.md](MOODLE.md)). One module owns it: `src/moodle/gate.js`.

## Tickets

Every route that can reach Moodle (`/list`, `/courses`, `/courses/check`, `/list/expand`, `/resolve`, `/site/probe`,
`/auth/connect`, `/auth/complete`, `GET /moodle/file/:id`) runs inside `gated()` in
`http/server.js`, which starts an `AsyncLocalStorage` context holding one **ticket**. The lock is
taken lazily, at the ticket's first `enterMoodle()`, so a `/resolve` of a Zoom, Drive or YouTube row
never takes it; later calls in the same context reuse it, and it enters its cooldown when the
context's work ends (`finally`, so a throw, an aborted stream or a cancelled login all release it).

`enterMoodle()` is awaited immediately before anything leaves for the site:

| Call site                                   | What it reaches                                      |
| ------------------------------------------- | ---------------------------------------------------- |
| `wsClient.js` `moodleFetch`                 | every WS call (`callWs`), `getPublicConfig`, `assertPluginfileReadable`, `openPluginfile`, `openMoodleFile` — from Node, or in block mode from the challenge window's page (never `openMoodleFile`) ([MOODLE.md](MOODLE.md#the-rest-api)) |
| `moodleToken.js` `_openLogin`               | the headed `launch.php` login window                 |
| `challenge.js` `land`                       | the challenge window loading the site root           |
| `lib/probeUrl.js` `fetchFollowing`          | any hop of a link probe on the Moodle host — redirects are followed by hand so an off-site link that lands there is caught too |

A gate refusal is never a verdict and never auth state: the probes rethrow it, `MoodleToken` keeps
it out of `error`, and a waiting caller that joined a refused shared verification verifies again as
itself. A call with no ticket, or whose request already ended, throws `moodle_call_ungated` before anything
is sent — the catch for a call that escaped its route. It is a bug, so it lands in the 500 backstop.

## Refuse or wait

A ticket without `X-FastStudy-Moodle-Wait: 1` belongs to a button press: a taken lock refuses it
`429 {status:'busy', error, code:'moodle_busy', params:{}}` before any Moodle call. A manual-form
click (`server/`'s `/download-url`) on a Moodle-host link is one too, refused while the lock is
taken, but its job's `/moodle/file` fetch waits; a pasted off-site link never takes the lock.
`server/` sends the header on the calls it makes on its own — a section run's rows, a job's silent re-resolve, every
`/moodle/file` fetch — and those queue FIFO; on cooldown end the lock passes straight to the next one.
CORS never allows the header, so a browser cannot claim to be a waiting caller. A queued caller that
hangs up leaves the queue.

## Holds that outlive the request

`moodleGate.hold()` keeps the ticket's lock past its route until the lease is released;
`lease.run(fn)` runs `fn` as that same request, so its calls pass.

- **Login.** `connect()` takes a lease before the window opens and releases it when `_drive` ends —
  token, failure, timeout or abandon — or at once on `disconnect()`. The user's clicks inside the
  window are not gated; they happen under this lease.
- **Captcha.** While block mode's window shows a captcha, the request that opened it holds an
  **admitting** lease (`hold(target, { admit: true })`): queued callers (`server/`'s, a section run's
  rows) wait, but one button press at a time runs on top of it — the user's retry, whatever route it
  is (`/auth/complete`, `/list`, `/resolve`, a new `connect()`). `moodleBusy` reads false while only
  that lease holds the lock, so the frontend's buttons stay live. The retry keeps the lock until it
  ends. The page landing back on the site (the user solved it) or the first call through the window
  that passes releases the lease, so a retry that never reaches Moodle (a replay-cache hit) cannot
  strand the queue; the lock then cools down as usual, and the solve's own token verification
  ([AUTH.md](AUTH.md)) queues for it as a waiting request. A captcha raised again during a retry puts its
  lease on the lock's owner, never on the retry, so the next retry is still admitted. A window that lands straight on the site holds nothing beyond its navigation, and
  every call through it takes the lock and its 3s cooldown like a Node call: a burst from the browser
  could get the browser itself challenged. Closing the window releases the lease too.

## Files

Every byte on the Moodle host reaches `server/` through auto: a target there is `/moodle/file/<id>`,
relative to auto, and `proxyCap` (`moodle/files.js`, memory only) keeps what it stands for under a
random id. These kinds land there:

- a `moodle-file` PDF — `{ fileurl, size }`; the WS token is added at stream time, never handed out;
- a `direct-url` link on the Moodle host, or one whose redirects end there — `{ url, size }`, fetched
  as it is, redirects and all, under the lock (a video goes as `curl`);
- a link pasted into the manual form (`/resolve` with `{url}` and no `ref`) on the Moodle host —
  probed fresh, then the same `{ url, size }` as a `curl` target, never put in the replay cache (a
  pasted URL is keyed by nothing stable). Only a video passes; anything else is `422
  link_not_a_video`. A pasted link off the host is a `ytdlp` target on the URL itself with no
  network call at all — one that only redirects onto the host is not caught;
- a videostream `.mp4` the plugin's handler names on the Moodle host — `{ url }`. One on another host
  (BIU's object storage) is not Moodle traffic and stays a plain `curl` target with no headers
  ([MOODLE.md](MOODLE.md#videostream)).

`GET` streams the file under the lock with `Range` passed through; an HTML answer where a file was
due is `503 site_blocked`. `HEAD` answers from the size the resolve learned (the preflight's
`Content-Range`, the link probe's answer) with no Moodle call. An unknown id
— auto restarted — is `401 moodle_file_unknown`; since a proxied target always says `fromCache:true`,
`server/` re-resolves it once instead of saving a body.

## State on the wire

Each discovery Item's `moodle` flag ([BROWSING.md](BROWSING.md#the-item--ref-contract)) says
which rows the frontend should disable while the lock is busy. It is advisory UI state: the gate at
the outbound layer stays the enforcement, so a wrong `false` (an off-site link not yet probed, which
then redirects to Moodle) only gets a quiet `429 moodle_busy` when clicked, and never an ungated call.

`moodleBusy` rides every `/auth/events` frame: true from the first acquisition, false only once a
cooldown elapses with nobody queued ([AUTH.md](AUTH.md#connect--events--complete--status--disconnect)).
