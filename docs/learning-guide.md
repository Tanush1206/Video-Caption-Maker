# Learning guide

What every piece of this project is, why it's there, and what to say if
someone asks you to explain it.

Written to be read top to bottom, but each section stands alone. Updated as
milestones land — currently covers Milestones 1–2.

---

## 1. The 30-second version

> VideoCaptionMaker takes a video, transcribes it with AI, lets you edit the
> captions, burn them into the video, and then search across everything you've
> uploaded by *meaning* rather than keywords.

It's six services in Docker: a Next.js frontend, a FastAPI backend, a Celery
worker for slow jobs, PostgreSQL for relational data, Redis as a message
broker and cache, and ChromaDB as a vector database.

---

## 2. The architecture, and why it's split this way

| Service | Tech | Job |
|---|---|---|
| `frontend` | Next.js 14 | Everything the user sees |
| `backend` | FastAPI | REST API, auth, CRUD |
| `worker` | Celery | Slow jobs: transcription, rendering |
| `postgres` | PostgreSQL 16 | Users, videos, captions |
| `redis` | Redis 7 | Celery broker, rate limits, token denylist |
| `chromadb` | ChromaDB | Caption embeddings for semantic search |

**The one architectural idea worth understanding:** the worker is a separate
process from the API.

Transcribing a 30-minute video takes minutes. If that ran inside an HTTP
request, the connection would time out and the API would be blocked the whole
time. So the API's only job is to accept the upload, write a database row, and
drop a message on a queue. The worker picks it up and grinds away
independently. The API answers in milliseconds regardless.

This pattern — a **task queue** — is everywhere in real systems. Redis is the
*broker* (holds the queue), Celery is the *worker framework* (runs the jobs).

---

## 3. Containers and Docker

**The problem it solves:** "works on my machine". A container packages an app
with its exact dependencies, so it runs identically anywhere.

Terms:

- **Image** — the blueprint, built from a `Dockerfile`. Read-only.
- **Container** — a running instance of an image.
- **Volume** — storage that outlives the container. Your database lives in
  one; deleting a container doesn't delete the data.
- **Bind mount** — a host folder mapped into a container. `./backend:/app`
  means editing a file on Windows changes it inside the container instantly,
  which is what makes hot reload work.
- **Compose** — `docker-compose.yml` describes all six services and their
  relationships, so `docker compose up` starts the entire system.

**Layer caching:** each Dockerfile instruction creates a layer. Docker reuses
layers whose inputs haven't changed. That's why dependencies are installed
*before* source is copied — changing a `.py` file doesn't reinstall PyTorch.

**`depends_on` + `healthcheck`:** the backend waits for Postgres to report
healthy, not merely started. A container can be running while the database
inside it is still initialising.

---

## 4. Backend fundamentals

### FastAPI

A Python web framework built on **async** and **type hints**.

```python
@router.post("/login", response_model=TokenResponse)
async def login(payload: UserLogin, db: DbSession) -> TokenResponse:
```

From those type annotations FastAPI derives: request parsing, validation,
the response shape, and the interactive docs at `/docs`. The types aren't
decoration — they're the specification.

### async / await

Normal (synchronous) code blocks the whole program while waiting on a database
or network reply. `async` code hands control back so other requests proceed
meanwhile.

> "It's not doing two things at once — it's not sitting idle while waiting."

This is why the DB driver is `asyncpg` and sessions are `AsyncSession`. Mixing
a blocking library into async code stalls everything, which is exactly why the
slow AI work lives in Celery instead.

### Pydantic — schemas

Schemas define the shape of data crossing the API boundary.

```python
class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)
```

Invalid input is rejected with a 422 before your code runs. Note there are
**two** classes per concept, deliberately:

- `UserCreate` — what comes *in* (has `password`)
- `UserRead` — what goes *out* (no password, no hash)

Keeping them separate is what stops a password hash leaking into a response by
accident. That's not paranoia; it's a common real-world bug.

### SQLAlchemy — the ORM

Lets you work with Python objects instead of SQL strings.

```python
class User(Base):
    __tablename__ = "users"
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
```

- **`unique=True`** — the database itself refuses duplicates. Application
  checks race; a database constraint cannot.
- **`index=True`** — makes lookups by email fast. Without it, Postgres scans
  every row.
- **Why 320?** RFC 3696: 64-character local part + `@` + 255-character domain.

### Alembic — migrations

A database has state. Changing a model doesn't change existing tables. Alembic
generates versioned scripts describing each change, so every environment can be
brought to the same schema in the same order.

```bash
alembic revision --autogenerate -m "create users table"   # write the diff
alembic upgrade head                                      # apply it
```

Every migration also has a `downgrade()` — the undo.

---

## 5. Authentication: the concepts

The densest part of the project. Also the most interview-relevant.

### Password hashing

Passwords are **never** stored. A one-way hash is stored instead: easy to
compute forwards, infeasible backwards.

**bcrypt** is deliberately *slow*, which is the point — it makes brute-forcing
expensive. It also **salts** automatically: a random value mixed into each
hash, so two users with the same password get different hashes and one
precomputed table can't crack both.

> Quirk worth knowing: bcrypt only reads the first 72 **bytes**. We reject
> longer input rather than let it silently truncate — otherwise part of a long
> password would never be checked.

### Hashing vs encryption

| | Reversible? | Used for |
|---|---|---|
| Hashing | No | Passwords |
| Encryption | Yes, with the key | Data you need to read back |

Encrypting passwords would be a bug: anyone with the key gets every password.

### JWT (JSON Web Token)

A signed token carrying claims. Three base64 parts: header, payload,
signature.

**Signed, not encrypted** — anyone can read the contents; only the server can
forge one. Never put secrets in a JWT.

Two tokens are used, for a reason:

| | Lifetime | Stored | Purpose |
|---|---|---|---|
| Access | 30 min | Memory (JS) | Sent with every request |
| Refresh | 7 days | httpOnly cookie | Obtains new access tokens |

Short access tokens mean a stolen one expires fast. Long refresh tokens mean
users aren't asked to log in constantly. You get both.

Our claims:

- `sub` — which user
- `exp` / `iat` — expiry / issued-at
- `type` — `"access"` or `"refresh"`
- `jti` — unique token id

**Why `type` matters:** without it, someone could present their 7-day refresh
token as an access token, turning a short-lived credential into a long one.
The check is one line and closes a real hole.

### XSS and httpOnly cookies

**XSS (cross-site scripting)** — an attacker gets JavaScript running on your
page, and it can read anything JS can read, including `localStorage`.

So: the refresh token is set as an **httpOnly** cookie, which JavaScript
*cannot* read at all. The browser still attaches it automatically. And the
access token lives only in a JS variable — gone on refresh, never persisted.

> "Tutorials put JWTs in localStorage. That's exactly what an XSS payload
> reads first."

### CSRF and SameSite

**CSRF** — a malicious site makes your browser send an authenticated request
to ours, since cookies attach automatically.

`SameSite=Lax` tells the browser not to send the cookie on cross-site
requests. `Path=/api/auth` narrows it further: it isn't attached to ordinary
API calls at all, only to auth endpoints that need it.

### Account enumeration

If "wrong password" and "no such user" give different answers, an attacker can
discover which emails are registered — useful for targeted phishing.

Both return an identical 401 with identical text. And when no user is found we
still run a **dummy hash comparison**, because otherwise the missing-user path
returns measurably faster. That's a **timing attack**, and defending against
it is why `verify_password(password, None)` exists.

### Rate limiting

Without it, an attacker tries passwords as fast as the network allows.

Ours is Redis-backed, not in-process — with several API workers, per-process
counters would give an attacker N times the allowance.

Two buckets per login:

- **per IP** — stops one machine spraying many accounts
- **per email** — stops many machines spraying one account

### Fail open vs fail closed

A genuinely interesting design question: what should happen when Redis is
down?

- **Rate limiter → fails open** (allows the request). A Redis blip taking down
  login for everyone is worse than briefly losing brute-force protection.
- **Token denylist → fails closed** (rejects the token). Here the cost of
  failing is re-authenticating; failing open would let revoked tokens work
  again.

Same outage, opposite choices, because the consequences differ. Being able to
explain that is worth more than either rule alone.

### Why logout is harder than it looks

JWTs are **stateless** — the server validates the signature and doesn't track
issued tokens. So "log out" naively means deleting the cookie, and a captured
copy of the token *keeps working until it expires*.

Fix: on logout, record the token's `jti` in Redis with a TTL matching its
remaining life. Refresh checks that list. The entry expires exactly when the
token would have anyway, so the list can't grow forever.

### OAuth (Google sign-in)

The flow:

1. User clicks "Continue with Google" → redirected to Google
2. They authenticate **with Google**, never sending us a password
3. Google redirects back with a one-time `code`
4. Our backend swaps that `code` for tokens, server-to-server
5. We fetch their profile, find or create the user, issue *our* tokens

Details that matter:

- **`state`** — a random value we store in Redis and verify on return. This is
  the CSRF protection for the callback.
- **`email_verified`** — rejected if false. Otherwise someone could register a
  Google account with your email address and take over your account.
- **No token in the redirect URL.** URLs leak into browser history, server
  logs, and `Referer` headers. We set only the httpOnly cookie and let the
  frontend call `/refresh`.

---

## 6. Frontend fundamentals

### Next.js App Router

React with a file-based router: `app/login/page.tsx` → `/login`.

- **`(auth)` in parentheses** — a *route group*. Organises files without
  appearing in the URL. `(auth)/login` is still `/login`.
- **`[id]` in brackets** — a dynamic segment. `editor/[id]` matches
  `/editor/42`.
- **`layout.tsx`** — wraps every page beneath it. Ours holds the theme
  provider and the auth guard.

### Server vs client components

App Router components render on the **server** by default — faster, less
JavaScript shipped. `"use client"` opts into the browser, which you need for
state, effects, and event handlers.

> Real bug we hit: a constant was imported from a `"use client"` file into
> server-rendered code, and it arrived as a client *reference* rather than the
> string. The theme key silently never matched. Constants shared across the
> boundary belong in a neutral file.

### Hydration

The server sends HTML; React then "hydrates" it, attaching behaviour. If the
server and client render *different* things, you get a hydration mismatch.

This is why the theme toggle renders a placeholder until mounted — the server
can't know the visitor's saved theme.

### Zustand — state management

A small store any component can read, without threading props through every
layer.

```typescript
const { user, accessToken } = useAuthStore();
```

Note the access token is stored **in memory only**. Persisting it would
undo the whole httpOnly-cookie design.

### Zod — validation

Schema validation with TypeScript types derived from it — one definition, both
runtime checks and compile-time types.

Client validation is for **fast feedback**, never for security: anyone can
call the API directly, so the server validates independently.

> Nice detail: password length is measured in **bytes**, not characters, to
> match bcrypt. A password of emoji could be 20 characters and 80 bytes.

### The single-flight refresh

The trickiest frontend logic here. When an access token expires, several
in-progress requests all 401 at once. Naively, each triggers its own refresh —
and since each refresh rotates the cookie, the losers of that race get logged
out.

The fix: one shared in-flight promise. The first 401 starts the refresh;
everyone else awaits the same promise, then retries.

```typescript
let refreshInFlight: Promise<string | null> | null = null;
```

This pattern ("single-flight", or request coalescing) shows up any time
concurrent callers want the same expensive result.

### TanStack Query

Manages *server* state: caching, refetching, loading and error states. The
`QueryClient` is created inside `useState` so each SSR request gets its own —
a module-level singleton would leak one user's cached data into another's
render.

### Tailwind + the theme system

Utility classes instead of separate CSS files. Colours are CSS variables, so
`bg-background` resolves differently in light and dark mode without any
component knowing which is active. A `dark` class on `<html>` flips the whole
palette.

---

## 7. Testing

18 tests cover the auth flows. Two lessons came out of writing them:

**A test caught a real bug.** Logout set the clearing cookie on one `Response`
object but returned a different one, so no `Set-Cookie` was ever sent and the
session survived logout. It looked correct on the page.

**Async tests need one event loop.** The DB engine and Redis client are
created once at import and bound to the loop that created them. pytest-asyncio
defaults to a fresh loop per test, so every test after the first talked to a
closed loop. Fixed with `asyncio_default_test_loop_scope = session`.

Tests worth pointing at, because they assert *security properties* rather than
behaviour:

- wrong password and unknown email return byte-identical responses
- a refresh token is rejected when presented as an access token
- a captured refresh token stops working after logout

---

## 8. Things that broke, and what they taught

Real debugging beats tidy explanations.

**passlib was broken with bcrypt 5.** Hashing a 28-byte password raised
"password cannot be longer than 72 bytes". passlib probes its backend with an
over-length test string, and bcrypt 5 now raises instead of truncating.
passlib's last release was 2020. Dropped it and used bcrypt directly.
*Lesson: an unmaintained dependency is a liability, and the error message is
not always about your input.*

**Hot reload silently didn't work.** Windows bind mounts don't deliver inotify
events into Linux containers, so file watchers never fired. Files were updated
inside the container; nothing recompiled. Fixed with `WATCHPACK_POLLING` and
`WATCHFILES_FORCE_POLLING`.
*Lesson: "the file is there" and "the process noticed" are different claims.*

**Norton broke TLS inside containers.** Norton's HTTPS scanning re-signs every
connection with its own root CA. Windows trusts it; containers don't. `pip
install` failed with `CERTIFICATE_VERIFY_FAILED`, and Google Fonts silently
fell back.
*Lesson: TLS errors are usually about **whose** certificate is trusted, not
whether encryption works.*

**Docker Desktop couldn't start.** The WSL app was installed but the
`Microsoft-Windows-Subsystem-Linux` Windows feature was disabled, so no distro
could be created and Docker reported "no virtualization available".
*Lesson: read the actual log line instead of reinstalling.*

---

## 9. Question drill

Short answers to likely questions.

**Why Postgres *and* Redis *and* ChromaDB?**
Different jobs. Postgres for relational data that must be durable. Redis for
fast ephemeral state — queues, counters, denylists. ChromaDB for vector
similarity search, which SQL is bad at.

**Why not just do transcription in the API?**
It takes minutes. The HTTP connection would time out and the API would be
blocked. The queue makes the API respond instantly and the work happen
independently.

**Why two tokens instead of one?**
A single long-lived token is dangerous if stolen; a single short one means
constant re-login. Short access + long refresh gives security and convenience.

**Why is the refresh token in a cookie but the access token isn't?**
The cookie is httpOnly, so JavaScript can't read it — that protects the
long-lived credential from XSS. The access token has to be readable by JS to
attach as a header, so it's kept in memory and dies on refresh.

**What happens when the access token expires mid-session?**
The API client sees a 401, calls `/refresh` once (shared across all pending
requests), gets a new token, and replays the original request. The user sees
nothing.

**How do you know your login endpoint doesn't leak which emails exist?**
There's a test asserting the wrong-password and unknown-email responses are
identical, and a dummy hash comparison so the timing matches too.

**What's the hardest bug you hit?**
Hot reload appearing to work but not. Files updated inside the container, the
server never recompiled, so I was testing stale code and drawing wrong
conclusions from it. Windows bind mounts don't propagate inotify events.

---

## 10. Glossary

| Term | Meaning |
|---|---|
| **ORM** | Maps database rows to objects |
| **Migration** | Versioned script that changes schema |
| **JWT** | Signed token carrying claims |
| **Claim** | A field inside a JWT (`sub`, `exp`, `jti`) |
| **Hash** | One-way fingerprint |
| **Salt** | Random value per hash, defeats lookup tables |
| **XSS** | Attacker's JavaScript runs on your page |
| **CSRF** | Attacker makes *your* browser send a request |
| **httpOnly** | Cookie JavaScript cannot read |
| **CORS** | Rules for which origins may call your API |
| **Broker** | Holds the queue between producer and worker |
| **Embedding** | Vector of numbers representing meaning |
| **Vector search** | Finding nearest embeddings — search by meaning |
| **RAG** | Retrieve real documents, then have an LLM answer from them |
| **Idempotent** | Safe to repeat with the same result |
| **Fail open / closed** | On failure, allow / deny |
| **Single-flight** | Collapse concurrent identical work into one call |
| **Hydration** | React attaching behaviour to server HTML |
