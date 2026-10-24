# FLASH – Process Documentation

Status: 24 Oct 2026 · Covers the two commits in this repo (`80d568c` Stage 1, `1f6146e` Reservations/Fleet/API).
Sources: code, README, commit messages, `.data/API-Kurzanleitung.md`. Where a rationale is **inferred** from code/comments rather than stated anywhere, it is marked *(inferred)*. Things the repo does not tell are listed in section 9.

---

## 1. Goal

Web prototype for the Ecurious challenge: EV drivers reserve a public charging station (from GoingElectric), which is physically kept free by an Ecurious parking lock ("Bügel"). Stage 1 = connect all external APIs and prove they are reachable. Stage 2 = reservations, pricing, profile, fleet/partner sites, an external reservation API, and whitelist control of the real hardware.

## 2. Architecture

```
Browser (React + Leaflet/OSM)
   │ fetch / EventSource / polling
   ▼
Next.js 16 Route Handlers (= the backend, no separate server)
   ├─ /api/chargepoints ───────────► GoingElectric API   (key stays server-side)
   ├─ /api/locks, /locks/[id] ─────► Ecurious REST       (X-API-Key)
   ├─ /api/locks/events (SSE) ─────► Ecurious SSE        (plates masked)
   ├─ /api/locks/[id]/command ─────► Ecurious commands   (flag + admin token)
   ├─ /api/reservations[/id] ──────► .data/reservations.json
   ├─ /api/profile, /api/fleet ────► .data/demo-profile.json / in-code fleet codes
   └─ /api/health ─────────────────► same checks as `npm run check:apis`
Background job (instrumentation.ts → lib/background.ts), every 15 s:
   1. assign bays to due appointments   2. sync lock whitelists with reservations
```

**Stack:** Next.js 16.4.3 (App Router, `cacheComponents`), React 19.3, TypeScript, Tailwind 4, Leaflet/react-leaflet, vitest. No database.

### Module map

| File | Responsibility |
| --- | --- |
| `lib/ecurious.ts` | Ecurious client: `listLocks`, `getLock`, `getWhitelists`, `sendCommand`; 60 s staleness rule; mock mode |
| `lib/goingelectric.ts` | GoingElectric call + normalisation to a small `Station` shape |
| `lib/checks.mjs`, `scripts/check-apis.mjs` | Smoke checks (plain JS so the CLI runs without a build); shared with `/api/health` |
| `lib/plates.mjs`, `lib/sse.mjs` | Plate masking (also deep, recursive); SSE parser + sanitiser |
| `lib/station-reservations.ts` | Pure logic: time windows, fees, bay assignment, whitelist windows |
| `lib/reservation-store.ts` | Validation, `buildReservation`, JSON file persistence with write queue |
| `lib/whitelist-sync.ts`, `lib/background.ts` | Desired-vs-actual whitelist reconciliation, 15 s tick |
| `lib/api-access.ts` | Same-origin vs. API-key access, CORS |
| `lib/demo-store.ts`, `lib/profile.ts` | Server-side demo profile (cars, plan, trust factor) |
| `lib/fleet*.ts`, `lib/partner-sites.ts` | TUM fleet site (id `-1`), partner site "Jonas Cafe" (id `-2`) |
| `components/*` | `FlashApp` (state, polling, SSE), `MapView`, `StationPopup`, `ReservationCard`, `BayNotice`, `ProfileView`, `ParkingLotGraphic`, `Pricing`, `PerkQrCode` |
| `tests/*` | 8 vitest files (≈43 test cases) |

## 3. External API calls

### 3.1 GoingElectric (charging station data)
- `GET https://api.goingelectric.de/chargepoints/` with query `key`, and either `lat/lng/radius` (health check: Berlin-Mitte, 5 km) or the bounding box `sw_lat, sw_lng, ne_lat, ne_lng` (+ optional `plugs`, `min_power`).
- Response: `status: "ok"`, `chargelocations[]` (`ge_id`, `coordinates`, `chargepoints[]`, `address`, `operator`, `network`, `fault_report`, `url`), optional `startkey` for paging.
- Quirks handled in `normalizeChargepoints`: `false` instead of `null` for empty text; protocol-relative URLs (`//…` → `https:`); clustered entries are counted and skipped; `startkey` → `truncated: true`.
- Our own proxy `GET /api/chargepoints` validates the box (max span 0.5° per axis), sanitises `plugs`, does no storage, and sets `Cache-Control: private, max-age=60`.

### 3.2 Ecurious Parking-Lock API
Auth: header `X-API-Key` (never a query parameter). Base URL from `ECURIOUS_BASE_URL`. Timeout 5 s everywhere.

| Call | Use |
| --- | --- |
| `GET /api/v1/locks` | list locks (+ `team`, `whitelist` per lock); source of "bays" |
| `GET /api/v1/locks/{id}` | one lock (`status`, `carPresence`, `lastSeenAt`, battery, 4G, `waterIngress`, `activeErrors`) |
| `GET /api/v1/locks/{id}/plate/latest` | last recognised plate; 404 = none yet |
| `GET /api/v1/events` (SSE) | `status_change`, `vehicle_presence`, `photo_captured`, `alarm` |
| `POST /api/v1/locks/{id}/lock` / `/unlock` | raise / lower (body may carry `cancelAutoLift`) |
| `POST /api/v1/locks/{id}/keep-state` | `normal` / `keep_open` / `keep_closed` |
| `POST /api/v1/locks/{id}/whitelist` | `{wildcard:true}` or `{plates:[…]}` |

### 3.3 Our own API (for other servers/websites)
`POST/GET /api/reservations`, `GET/DELETE /api/reservations/{stationId}`. Auth: `Authorization: Bearer <FLASH_API_KEY>`; the own web app is recognised by the browser-set `Sec-Fetch-Site: same-origin` header and needs no key. CORS is open. Errors: 400 input, 401 key, 403 fleet site without matching car, 409 no bay free, 503 key not configured. Full field table: README.

## 4. Key flows

**Reservation.** `POST /api/reservations` → `parseNewReservation` → `buildReservation`: resolve fleet/partner site → compute window and fee → capacity check (one concurrent reservation per Ecurious lock) → quick reservations get a bay immediately, appointments get `bayAssignAt = start − 30 min` → persisted under a serialised write queue (atomic temp-file + rename) → whitelist sync triggered immediately.

**Bay assignment.** Bays = Ecurious locks. First lock not overlapped by another reservation wins ("Bay N" = index of the lock). Number of bays shown = `chargePoints` of the station. Without reachable locks the fallback is "Bay 1" without a lock.

**Whitelist follows reservations.** Every 15 s: desired = plates of reservations whose window is running (quick: exact 15 min; appointment: −5 min … +5 min after the 15 min hold); everything else = wildcard. A command is sent only if actual ≠ desired and the same command is repeated at most every 2 min. Only with `ECURIOUS_COMMANDS_ENABLED=true`. Manual whitelist edits in the Ecurious admin get overwritten.

**Lock status in the UI.** SSE (`EventSource`) with heartbeat every 15 s; polling fallback every 5 s (30 s while SSE is open). Status older than 60 s is displayed as "unknown".

**Pricing (demo logic).** Quick: free. Appointment fee by local start hour: 22–6 → €3, 13–17 → €5, else €7; paid plan −50 %. Jonas Cafe: €2 only 20–8, else free. No-show €2 unless trust factor > 70. Late cancel after bay assignment: 50 % refund. Fleet site: no prices.

## 5. Safety and privacy decisions

| Decision | Why |
| --- | --- |
| API keys only server-side, no `NEXT_PUBLIC_` | keys must not reach the bundle |
| Hardware commands off by default (`ECURIOUS_COMMANDS_ENABLED=false`) + admin token (mandatory in production) | the lock moves real hardware |
| `lock` only if a fresh `carPresence=vacant` | never raise a lock under a car |
| `success:true` from a command is not trusted as state | it confirms the command only; real state comes from SSE / GET |
| Plates masked server-side (`M-AB 1234` → `M-AB***`) in REST, SSE and logs; non-JSON SSE data is dropped | cannot guarantee it contains no plate |
| Lock IDs restricted to `[\w-]{1,128}` before entering a URL path | path injection |
| `timingSafeEqual` for key/token comparison | timing attacks |
| `npm run dev` binds to `127.0.0.1` | external API is only reachable from the same machine in dev |
| `.data/` is git-ignored | contains reservations, profile and the API-key quick guide |

## 6. Decisions

| # | Decision | Reason |
| --- | --- | --- |
| D1 | Route Handlers instead of a separate backend | one deployable (Vercel-friendly) |
| D2 | Proxy GoingElectric server-side, no storage | keep the key secret, avoid data-licence issues *(inferred)* |
| D3 | Check logic in plain `.mjs`, shared by CLI and `/api/health` | CLI runs without a build; one source of truth |
| D4 | Mock mode for Ecurious (`ECURIOUS_MOCK`) | develop without hardware |
| D5 | **Replaced Supabase with JSON files** (see 7.1) | "no external database"; simpler setup *(inferred, commit says only "Supabase komplett entfernt")* |
| D6 | Write queue + atomic rename for the JSON files | two simultaneous bookings must not overwrite each other |
| D7 | One reservation per station; new POST replaces the old one | simple model for the prototype |
| D8 | Negative IDs for own sites (−1 fleet, −2 partner) | never collide with GoingElectric IDs |
| D9 | Appointment gets its bay 30 min before start | keeps locks free for quick reservations until needed *(inferred)* |
| D10 | Plates sent to locks without separators (`M-AB 12` → `MAB12`) | "as the camera delivers it" (code comment) |
| D11 | Open CORS + Bearer key | no cookies involved, nothing works without a valid key |
| D12 | Demo profile on the server instead of `localStorage` | one state for all browsers; no accounts yet |
| D13 | Fleet codes resolved server-side (`/api/fleet`) | codes must not land in the browser bundle |

## 7. What did not work / was reverted

### 7.1 Supabase backend (Stage 1) – removed
Stage 1 used Supabase: tables `bays`/`reservations` with RLS, RPCs `reserve_bay` (row lock, idempotent via `request_id`, DB clock), `cancel_reservation`, `list_bays`, realtime broadcast, anonymous sign-in, and a race test against the real DB. Stage 2 removed all of it (migrations, `supabase-browser.ts`, the `checkSupabase` check, the race test and test setup). The commit does not state why; the replacement is the file store. **Consequence:** the strong guarantees of the DB version (DB-enforced "one hold per bay" unique index, atomic RPC, server-clock expiry) were traded for an in-process write queue, which only protects a single server process.

### 7.2 Wrong GoingElectric URL
Stage 1 called `https://api.goingelectric.de/r1.0/chargepoints/`; Stage 2 corrected it to `https://api.goingelectric.de/chargepoints/`. Both the check and the proxy were affected, so the first version could not have worked against the real service (the commit does not record the original error message).

### 7.3 Plate formatting
Plates were first normalised with inserted hyphens; changed to keep input as typed (upper-case, single spaces) and to send them to the lock without separators.

### 7.4 No official API documentation available
- GoingElectric's official page was unreachable from the build environment. Parameters and response format come from the challenge's API guide and the open-source client EVMap.
- No public Ecurious documentation was found. Endpoints/events come from the challenge guide and a local test against a fake server in that format.
- **Not verified against the real services:** the Ecurious command endpoints and SSE event payloads (see 9).

### 7.5 Browser storage as the profile store
Cars, plan and trust factor lived in `localStorage` first; replaced by `.data/demo-profile.json`. The browser values are still read once to migrate them into the server profile.

### 7.6 Known limitations that remain
- SSE on Vercel ends at the function time limit; `EventSource` reconnects, polling covers the gap. Mock-mode SSE events work only inside one server process.
- Only as many concurrent reservations as there are locks (the prototype has two).
- File storage and a single shared "my reservations" view: no accounts, no multi-instance safety.
- Admin protection is a single shared token.
- OSM tiles from `tile.openstreetmap.org` are prototype-only (tile usage policy).
- No plug/power filter in the UI; map section capped at 0.5° without `startkey` paging.
- GoingElectric terms of use (server proxying, caching, attribution) still need to be checked; fallback would be calling GE from the browser, which exposes the key.

## 8. Setup, checks, tests

```bash
npm install
cp .env.example .env.local        # fill in keys
npm run check:apis                # GE, Ecurious /locks, plate/latest, 5 s SSE listen (read-only, parallel, 5 s timeout)
npm run dev                       # http://localhost:3000 (127.0.0.1 only)
npm test                          # vitest
```

Environment variables: see README table (`GOINGELECTRIC_API_KEY`, `ECURIOUS_BASE_URL`, `ECURIOUS_API_KEY`, `ECURIOUS_LOCK_ID`, `ECURIOUS_MOCK`, `ECURIOUS_COMMANDS_ENABLED`, `FLASH_API_KEY`, `FLASH_ADMIN_TOKEN`).

Test coverage: GoingElectric normalisation, plate and SSE masking, reservation store (validation, capacity, fleet access), fees/windows/bay assignment, whitelist windows, profile/cars, fleet codes and sites.

## 9. Open points and caveats about this document

1. **Test run not verified for this document.** `npm test` could not start in the analysis sandbox (`rolldown` native binding missing, because `node_modules` was installed on macOS). Run `rm -rf node_modules && npm i` on the Mac if it also fails there.
2. **Real-hardware behaviour is undocumented.** The repo does not record whether lock/unlock/whitelist commands were ever run against real Ecurious hardware; commands are off by default.
3. **Reasons for D5 and 7.1/7.2** are not written down in the repo.
4. **Security hygiene:** `.data/API-Kurzanleitung.md` contains the real `FLASH_API_KEY` in plain text (git-ignored, not in history). Don't share the file; rotate the key if it was ever sent anywhere.
5. Roadmap (not built): full cycle arrive → charge → release, no-show expiry, blocked-spot detection via `vehicle_presence`/`alarm`, accounts + DB, mobile app.
