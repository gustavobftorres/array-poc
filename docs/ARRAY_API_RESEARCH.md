# Array.com Developer API — Research Notes

Researched 2026-08-23. Array's own developer portal (`https://docs.array.com`, hosted on
ReadMe) is **password-protected at every path**, and `docs.array.com` / `embed.array.io` /
`apis.io` are additionally blocked by this environment's egress proxy. Everything below was
reconstructed from:

- Search-engine indexed content of the gated ReadMe pages (titles + body snippets are indexed).
- Real, public Array integrations on GitHub (`creditbanc/creditbanc`, `pkelly504/array-poc`,
  `abardik/svelte-app`, `Ashon-G/paygeon-full`).
- Third-party API-profiling repos that probed the live API and read Array's public embed
  loader (`api-evangelist/array`, `api-search/security`).

Confidence is marked per item. **UNVERIFIED** = inferred, not seen in a first-party source.

---

## 1. Base URLs

| Purpose | URL | Confidence |
|---|---|---|
| Production REST API | `https://array.io/api` | Verified (live, in production code) |
| Sandbox REST API | `https://sandbox.array.io/api` | Verified (live, host-for-host mirror) |
| Production component CDN | `https://embed.array.io/cms/` | Verified |
| Sandbox component CDN | `https://embed.sandbox.array.io/cms/` | Verified |
| Developer docs | `https://docs.array.com` | Verified (gated) |
| Status API (only open machine-readable surface) | `https://status.array.com/api/v2/summary.json` | Verified |

Important naming quirk: the **marketing/docs domain is `array.com`, but the API and CDN live on
`array.io`**. Sandbox and production are path-identical — you switch environments by swapping
the host only (and by setting `sandbox="true"` on web components).

Versioned route prefixes seen live: `/api/user/v2`, `/api/authenticate/v2`, `/api/report/v2`.

---

## 2. Authentication

**Array does *not* use Smarty credentials.** The premise in the original brief is wrong: there is
no `Smarty-Auth-Id` / `Smarty-Auth-Token` header and no `auth-id`/`auth-token` query parameter in
Array's API. Those belong to Smarty (smarty.com), an unrelated address-verification vendor. No
first-party or third-party source ties Smarty auth to Array. **If your project's env vars are
named `SMARTY_AUTH_ID` / `SMARTY_AUTH_TOKEN`, they are almost certainly misnamed placeholders
that should hold Array's `appKey` and client token** (UNVERIFIED inference about your codebase,
but the header facts below are solid).

Array uses plain API-key auth — no OAuth, no OIDC, no mTLS. Three credentials:

| Credential | Transport | Header / param name | Notes |
|---|---|---|---|
| App key | query param on the loader script; `appKey` attribute on components; `appKey` body property on API calls | `appKey` | 36-char UUID. **Public by design** — visible in page source. The embed loader validates `length === 36`. |
| User token | request header | `x-credmo-user-token` | Per-consumer token. Safe(ish) to use from the end user's device / browser component. |
| Client token | request header | `x-credmo-client-token` | Server-side secret. Array's docs state it must **never** appear in website or mobile app source. |
| Report capability tokens | query params | `reportKey`, `displayToken` | Short-lived, returned by the order-report call; required to fetch report content. |

The `credmo` prefix is historical — Array's credit stack came from a platform called Credmo.

Additional headers observed from the public embed loader (browser → API):
`x-array-web-component`, `x-array-web-component-referrer`.

Bureau-specific error headers on responses: `x-array-tui-error`, `x-array-exp-error`,
`x-array-efx-error` (distinguish Array-side failures from upstream bureau failures).

### Real header usage (from production code, `creditbanc/creditbanc`)

```js
// POST https://array.io/api/authenticate/v2/usertoken
headers: {
  accept: "application/json",
  "Content-Type": "application/json",
  "x-credmo-client-token": "8241960C-7A8B-4389-BB6C-1AAF99E7873C",
}
```

---

## 3. Core API flow and endpoints

The canonical happy path is: **create user → get KBA questions → answer KBA questions → receive
`userToken` → order report → retrieve report**.

### 3.1 Create a user (enrollment)

`POST {base}/api/user/v2`  — docs: `/reference/create-user` (also `/reference/post-user`)

Body properties (verified from indexed docs): `appKey`, `firstName`, `lastName`, `ssn`, `dob`,
and an `address` object with `state`, `street`, `city`, `zip`.

```bash
curl -X POST https://sandbox.array.io/api/user/v2 \
  -H 'Content-Type: application/json' \
  -H 'x-credmo-client-token: <CLIENT_TOKEN>' \
  -d '{
    "appKey": "3FEED6B2-9232-4569-8AA9-FBB777E627BF",
    "firstName": "BANKER",
    "lastName": "COLDIRON",
    "ssn": "666230560",
    "dob": "1974-04-18",
    "address": { "street": "3627 CALIFORNIA ST", "city": "GRAND PRAIRIE", "state": "TX", "zip": "75052" }
  }'
```
(Exact JSON envelope UNVERIFIED; field names verified.)

**Response** contains a `clientKey` — the customer identifier used by every subsequent call and
included in webhook event payloads.

`GET {base}/api/user/v2` also exists: the embed loader calls it with `x-credmo-user-token` to
resolve the `userId` for the current session (`inferUserIdFromToken()`). Anonymous calls return
`400 {"message":"Bad Request"}`.

### 3.2 Retrieve authentication questions (KBA / identity verification)

`GET {base}/api/authenticate/v2` (question retrieval; docs title "Retrieve Authentication
Questions"). Returns an `authToken` plus a set of KBA questions, each with a `questionId` and
candidate answers with `answerId`s. Questions are sourced from and graded by a real bureau —
even in sandbox.

### 3.3 Answer authentication questions

`POST {base}/api/authenticate/v2`

Body: `appKey`, `clientKey`, `authToken` (from the question call), and an `answers` object
mapping questionId → answerId.

```bash
curl -X POST https://sandbox.array.io/api/authenticate/v2 \
  -H 'Content-Type: application/json' \
  -H 'x-credmo-client-token: <CLIENT_TOKEN>' \
  -d '{
    "appKey": "<APP_KEY>",
    "clientKey": "<CLIENT_KEY>",
    "authToken": "<AUTH_TOKEN>",
    "answers": { "<questionId>": "<answerId>" }
  }'
```

On success this returns the **`userToken`** for that consumer. Array's docs: store it securely on
the user's device or in your DB; it is personal information and can order products.

### 3.4 Regenerate a user token (the "user token flow" for web components)

`POST {base}/api/authenticate/v2/usertoken` — docs: `/reference/create-user-token`

Verified from production code. Body: `appKey`, `clientKey`, `ttlInMinutes`. Header:
`x-credmo-client-token`. Response includes `appKey`, `clientKey`, `authToken`/user token, and
`ttlInMinutes`.

```bash
curl -X POST https://array.io/api/authenticate/v2/usertoken \
  -H 'accept: application/json' -H 'Content-Type: application/json' \
  -H 'x-credmo-client-token: <CLIENT_TOKEN>' \
  -d '{"appKey":"<APP_KEY>","clientKey":"<CLIENT_KEY>","ttlInMinutes":60}'
```

**This is how components get their `userToken`:** your backend holds the client token, calls this
endpoint with the customer's `clientKey`, and passes the short-lived user token down to the
browser as the `userToken` attribute. Never ship the client token to the browser.

### 3.5 Order a credit report

`POST {base}/api/report/v2` — docs: `/reference/order-credit-report`

Body: `clientKey` (of an **authenticated** customer) + `productCode`. Auth via either
`x-credmo-user-token` (from device) or `x-credmo-client-token` (from your server).

Response: `reportKey` + `displayToken`.

Known `productCode` values (verified in production code):
- `credmo3bReportScore` — 3-bureau report + score
- `exp1bScore` — Experian 1-bureau score

(Other product codes exist per product/plan; full list is behind the gate — UNVERIFIED.)

### 3.6 Retrieve a credit report

`GET {base}/api/report/v2?reportKey=…&displayToken=…` — docs: `/reference/retrieve-credit-report`

Verified from production code:

```bash
curl "https://array.io/api/report/v2?reportKey=<REPORT_KEY>&displayToken=<DISPLAY_TOKEN>" \
  -H 'Content-Type: application/json'
```

Output formats documented: **JSON, XML, PDF, HTML**. The report can be empty briefly after
ordering — the reference integration retries every 3000 ms until `response.data` is populated.
Docs pages exist for `Credit Report Structure`, `Credit Summary Attributes`, and a sample
`1B Credit Report (JSON)` (`/docs/sample-1b-credit-report-json`).

`PUT {base}/api/report/v2` — refresh an expired `displayToken`. Verified from production code:
body `{ clientKey, reportKey }`, header `x-credmo-client-token`.

### 3.7 Credit score / score history / score simulator

- Credit score is delivered as part of report products (`*Score` product codes) and via the
  `array-credit-score` component.
- A score-tracker/history reference page exists: `/reference/get-report-scoretracker`. Exact
  path is most likely `GET {base}/api/report/v2/scoretracker` — **UNVERIFIED** (slug-derived).
- Score simulation: `array-credit-score-simulator` component + a `Credit Score Simulated`
  webhook carrying score modifiers. **TransUnion and Experian only — Equifax scores cannot be
  simulated.**

### 3.8 Alerts / monitoring

Documented reference operations (paths UNVERIFIED, slugs verified):
- **Retrieve Alert IDs** (`/reference/retrieve-alerts`) — query by `bureau` (provider) and
  `clientKey`.
- **Retrieve Alert Details** (`/reference/retrieve-alert-details`) — by alert identifier.
- **Retrieve Monitoring Enrollments** (`/reference/retrieve-monitoring-enrollments`) — list a
  customer's monitoring enrollments.

Per-provider alert catalogues are documented separately: `/docs/tui-alerts-standard`,
`/docs/exp-alerts`, `/docs/efx-alerts`, `/docs/identity-protection-alerts`, plus an
`Alert Provider Grid` (`/docs/alert-provider-grid`) showing which alert types each bureau emits.

Best inference for base paths: `/api/alert/v2` and `/api/monitoring/v2` — **UNVERIFIED**.

### 3.9 Disputes

**Not verified.** No dispute endpoint, reference slug, or component name surfaced in any
accessible source. Array does ship consumer dispute UX as part of My Credit Manager, so a
dispute API/component very likely exists behind the gate. Best inference: a `array-dispute*`
component and `/api/dispute/v2` routes — **UNVERIFIED, treat as unknown**.

### 3.10 Webhooks

`/docs/webhook-events` + `/docs/how-to-receive-webhooks`. A webhook is an HTTP message Array
sends when an event occurs. Two families:
1. **API-triggered** — e.g. "customer ordered a report" fires when Order a Credit Report runs;
   payloads carry `clientKey`, `reportKey`, `displayToken`, `productCode`.
2. **Detected events** — alerts raised by the bureaus and by Identity Protect; `Credit Score
   Simulated`; monitoring events.

---

## 4. Web Components (embeddable UI)

### 4.1 Loading

Two script tags: the shared runtime, then one bundle per component. The `appKey` goes on the
**per-component** script as a query param.

Verified, real sandbox example (`pkelly504/array-poc`):

```html
<script src="https://embed.sandbox.array.io/cms/array-web-component.js"></script>
<script src="https://embed.sandbox.array.io/cms/array-account-enroll.js?appKey=3FEED6B2-9232-4569-8AA9-FBB777E627BF"></script>
<script src="https://embed.sandbox.array.io/cms/array-authentication-kba.js?appKey=3FEED6B2-9232-4569-8AA9-FBB777E627BF"></script>
```

Production host is `https://embed.array.io/cms/…` (verified). A marketing bundle also exists:
`https://embed.array.io/cms/array-pip-marketing.js`.

### 4.2 Component list

Verified tag names:

| Tag | Purpose |
|---|---|
| `array-account-enroll` | Consumer enrollment form |
| `array-account-login` | Login |
| `array-account-settings` | Account settings |
| `array-authentication-kba` | KBA / identity verification flow |
| `array-credit-overview` | Score + hub with links to all other tools |
| `array-credit-report` | Full credit report (automatic or manual mode) |
| `array-credit-score` | Credit score display (automatic or manual mode) |
| `array-credit-score-insights` | Score factors: payment history, utilization, debt |
| `array-credit-score-simulator` | What-if score simulation (TU + EXP only) |
| `array-credit-alerts` | Bureau / monitoring alerts |
| `array-credit-debt-analysis` | Debt analysis |

Note the naming: it is `array-credit-alerts` (not `array-credit-monitoring-alerts`),
`array-credit-debt-analysis` (not `array-debt-analysis`), and `array-credit-score-simulator`
(not `array-score-simulator`). An "Ads" component also exists (`/docs/ads`,
`/docs/ads-component`) — tag name UNVERIFIED, likely `array-ads`.

### 4.3 Attributes

Common / verified:

| Attribute | Meaning |
|---|---|
| `appKey` | Required on every component. 36-char UUID. |
| `sandbox` | `"true"` to point the component at the sandbox environment. |
| `userToken` | Per-consumer token; required by data-displaying components (score, report, overview). |
| `clientKey` | Customer identifier; used by pre-auth components (enroll). |
| `userId` | Accepted by `array-authentication-kba` (the `clientKey` value is passed here). |
| `exp`, `tui`, `efx` | `"true"`/`"false"` per-bureau toggles (Experian / TransUnion / Equifax). |
| `showResultPages` | `"true"` — KBA renders its own success/failure screens. |
| `productCode`, `reportKey`, `displayToken` | Manual mode: you order the report yourself and feed the results in. |
| `*Link` attributes | On `array-credit-overview`: `creditAlertsLink`, `creditReportLink`, `debtAnalysisLink`, `identityProtectLink`, `scoreFactorsLink`, `scoreSimulatorLink`, `settingsLink`, `helloPrivacyLink`. |

**Automatic vs manual mode** (documented for `array-credit-report` / `array-credit-score`):
in automatic mode you pass `userToken` and the component orders and fetches data itself; in
manual mode you order via the API and pass `productCode` + `reportKey` + `displayToken`
alongside `userToken`.

Verified enrollment example:

```html
<array-account-enroll
    appKey="3FEED6B2-9232-4569-8AA9-FBB777E627BF"
    sandbox="true"
    clientKey="${userId}"
    exp="true"
    tui="false"
    efx="false"
/>
```

Verified overview example:

```html
<array-credit-overview
    appKey="3FEED6B2-9232-4569-8AA9-FBB777E627BF"
    sandbox="true"
    userToken="${token}"
    creditAlertsLink="#creditAlerts"
    creditReportLink="#creditReportLink"
    debtAnalysisLink="#debtAnalysisLink"
    identityProtectLink="#identityProtectLink"
    scoreFactorsLink="#scoreFactorsLink"
    scoreSimulatorLink="#scoreSimulatorLink"
    settingsLink="#settingsLink"
    helloPrivacyLink="#helloPrivacyLink"
/>
```

Verified KBA example (React/JSX):

```jsx
<array-authentication-kba
  appKey={appKey}
  userId={clientKey}
  showResultPages="true"
  tui={true} exp={true} efx={true}
/>
```

### 4.4 Component events

All components emit a single DOM event, `array-event`, on `window`, with the payload on
`e.detail`. Docs: `/docs/component-events`.

```js
window.addEventListener('array-event', (e) => console.log(e.detail));
```

The KBA component's `array-event` carries the resulting **`userToken`** in its metadata — the
reference integration reads `userToken` off the event and POSTs `{ clientKey, authToken,
userToken }` to its own backend for persistence. This is the browser-side alternative to calling
`/api/authenticate/v2/usertoken` server-side.

---

## 5. Sandbox test data

Documented at `/docs/sandbox-identities` and `/reference/sandbox-identities` (gated).

Key semantics (verified from indexed docs): the sandbox identities are **fictitious but not
canned**. They are created by the authentication providers (the bureaus). Authenticating one
retrieves and grades real KBA questions from a real provider, and pulling a report returns
**real bureau credit-report data**, not a stubbed Array response. So sandbox exercises the full
upstream path.

Usage: copy the published User object for an identity, replace the app key with yours, POST it to
Create a User, then run Retrieve Authentication Questions → Answer Authentication Questions.

Test SSNs are all in the **`666…`** range (an SSA-invalid block, so they can never collide with a
real person). Identities glimpsed in the index:

| Name | DOB | SSN | Location |
|---|---|---|---|
| BANKER COLDIRON | 1974-04-18 | 666230560 | Grand Prairie, TX |
| CARLETTA FZLDX | (not captured) | 666677368 | (not captured) |
| CARMEN BALAKHANPOUR | 1995-12-28 | 666700239 | (not captured) |

The DOB↔SSN pairing across those three rows is **partly UNVERIFIED** (snippets interleaved the
values). Treat the table as a shape hint; pull the authoritative list from the portal.

Public sandbox app keys seen in the wild (useful for shape, not for your account):
- `3FEED6B2-9232-4569-8AA9-FBB777E627BF`
- `3F03D20E-5311-43D8-8A76-E4B5D77793BD`
- `F5C7226A-4F96-43BF-B748-09278FFE0E36`

Answering KBA for a sandbox identity: how you find the right answer depends on which bureau
supplied the question — the portal documents this per provider.

---

## 6. Errors, rate limits, conventions

**Error shape** — always `application/json` with a `message` field. Validation failures add an
`error[]` array of `{ value, message, param, location }`:

```json
{ "message": "Bad Request" }
```

```json
{
  "message": "Validation failed",
  "error": [
    { "value": "", "message": "appKey is required", "param": "appKey", "location": "body" }
  ]
}
```

Observed statuses: `400` for missing credentials or invalid params (including anonymous calls to
`/api/user/v2` and `/api/report/v2`), `404` for unrouted paths under `/api`. Authentication,
authorization, and bureau-failure shapes are undocumented publicly.

**Rate limits: none published.** A third-party probe of both `array.io/api` and
`sandbox.array.io/api` (2026-08-10) found **no rate-limit response headers at all** — no
`X-RateLimit-*`, no `Retry-After`. Assume limits exist but are contractual/undocumented; build
with backoff regardless. Marked UNVERIFIED-by-absence.

**Conventions**: REST + JSON, path-versioned `/v2`, API-key auth in header + query, no
hypermedia, no OAuth/OIDC.

---

## 7. Gaps to close with real access

1. **Disputes** — entirely unverified. No endpoint or component found.
2. **Score history** — only the `get-report-scoretracker` slug; no path or payload.
3. **Alerts / monitoring** — operation names verified, HTTP paths and payloads are inference.
4. **Full `productCode` catalogue** — only two codes verified.
5. **Full sandbox identity list** and per-bureau KBA answer keys.
6. **OpenAPI spec + Postman collection** — Array advertises both on the portal; they are the
   fastest way to resolve everything above. Get portal credentials from your Array contact.

Practical next step: request docs access (`https://array.com/contact` /
`https://array.com/developers`) and pull `docs.array.com`'s OpenAPI + Postman collection, then
diff this document against it.

---

## Sources

- https://docs.array.com/docs/getting-started-with-array-apis
- https://docs.array.com/docs/credit-report-api-flow
- https://docs.array.com/docs/how-to-retrieve-a-credit-report
- https://docs.array.com/docs/component-attributes
- https://docs.array.com/docs/component-events
- https://docs.array.com/docs/how-to-embed-a-component
- https://docs.array.com/docs/webhook-events
- https://docs.array.com/docs/sandbox-identities
- https://docs.array.com/reference/create-user
- https://docs.array.com/reference/create-user-token
- https://docs.array.com/reference/order-credit-report
- https://docs.array.com/reference/retrieve-credit-report
- https://docs.array.com/reference/retrieve-alerts
- https://docs.array.com/reference/retrieve-alert-details
- https://docs.array.com/reference/retrieve-monitoring-enrollments
- https://github.com/creditbanc/creditbanc — `app/api/external/Array.ts`, `app/routes/credit/personal/verification/$.jsx`
- https://github.com/pkelly504/array-poc — `enroll.html`, `overview.html`
- https://github.com/abardik/svelte-app — `src/ArrayIntegration.svelte`
- https://github.com/Ashon-G/paygeon-full — `views/risk-module/risk-module.hbs`
- https://github.com/api-evangelist/array — `llms/array-llms.txt`, `authentication/`, `errors/`, `rate-limits/`, `sandbox/`, `conventions/`
- https://github.com/api-search/security — `_security/array/array-authentication.md`
