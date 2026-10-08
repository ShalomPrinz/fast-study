# The Moodle gate

auto is the only process that talks to the configured Moodle site, and it does so one request at a
time. A request holds the lock while it runs and for **3 seconds after it ends**, success or failure,
so the site sees a slow, human-paced trickle instead of the bursts a bot manager flags
([MOODLE.md](MOODLE.md)). One module owns it: `src/moodle/gate.js`.

## Tickets

Every route that can reach Moodle (`/list`, `/list/expand`, `/resolve`, `/site/probe`,
`/auth/connect`, `/auth/complete`, `GET /moodle/file/:id`) runs inside `gated()` in
`http/server.js`, which starts an `AsyncLocalStorage` context holding one **ticket**. The lock is
taken lazily, at the ticket's first `enterMoodle()`, so a `/resolve` of a Zoom, Drive or YouTube row
never takes it; later calls in the same context reuse it, and it enters its cooldown when the
context's work ends (`finally`, so a throw, an aborted stream or a cancelled login all release it).

`enterMoodle()` is awaited immediately before anything leaves for the site:

| Call site                                   | What it reaches                                      |
| ------------------------------------------- | ---------------------------------------------------- |
| `wsClient.js` `moodleFetch`                 | every WS call (`callWs`), `getPublicConfig`, `assertPluginfileReadable`, `openPluginfile` |
| `moodleToken.js` `_openLogin`               | the headed `launch.php` login window                 |
| `moodleToken.js` `_openChallenge`           | the headed challenge window on the site root         |
| `http/server.js` `ensureAutologin`          | the autologin navigation of the plain session        |
| `VideostreamExtractor._captureVideo`        | the module's view page                               |
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
- **Challenge window.** While it is open, it holds the lock, so nothing automated reaches a site that
  is challenging us. `complete()` verifies as the window's request (`lease.run`), and a new `connect()`
  takes the window's hold over; closing the window, success or `disconnect()` releases it.

## Files

Every byte on the Moodle host reaches `server/` through auto: a target there is `/moodle/file/<id>`,
relative to auto, and `proxyCap` (`moodle/files.js`, memory only) keeps what it stands for under a
random id. Three kinds land there:

- a `moodle-file` PDF — `{ fileurl, size }`; the WS token is added at stream time, never handed out;
- a `direct-url` link on the Moodle host, or one whose redirects end there — `{ url, size }`, fetched
  as it is, redirects and all, under the lock (a video goes as `curl`);
- a link pasted into the manual form (`/resolve` with `{url}` and no `ref`) on the Moodle host —
  probed fresh, then the same `{ url, size }` as a `curl` target, never put in the replay cache (a
  pasted URL is keyed by nothing stable). Only a video passes; anything else is `422
  link_not_a_video`. A pasted link off the host is a `ytdlp` target on the URL itself with no
  network call at all — one that only redirects onto the host is not caught;
- a videostream `.mp4` capture on the Moodle host — `{ url, headers, size }`, its captured cookies
  replayed from here (minus `Range`, validators and `Host`). A capture on another host (a separate
  streaming server) is not Moodle traffic and stays a plain `curl` target with its headers.

`GET` streams the file under the lock with `Range` passed through; an HTML answer where a file was
due is `503 site_blocked`. `HEAD` answers from the size the resolve learned (the preflight's
`Content-Range`, the link probe's answer, the player's own response) with no Moodle call. An unknown id
— auto restarted — is `401 moodle_file_unknown`; since a proxied target always says `fromCache:true`,
`server/` re-resolves it once instead of saving a body.

## State on the wire

Each discovery Item's `moodle` flag ([BROWSING.md](BROWSING.md#the-item--ref-contract)) says
which rows the frontend should disable while the lock is busy. It is advisory UI state: the gate at
the outbound layer stays the enforcement, so a wrong `false` (an off-site link not yet probed, which
then redirects to Moodle) only gets a quiet `429 moodle_busy` when clicked, and never an ungated call.

`moodleBusy` rides every `/auth/events` frame: true from the first acquisition, false only once a
cooldown elapses with nobody queued ([AUTH.md](AUTH.md#connect--events--complete--status--disconnect)).
