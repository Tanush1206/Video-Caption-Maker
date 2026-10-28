# API reference

The HTTP API served by the FastAPI backend (`backend/app/main.py`), as of
v1.0.5 (on `main`). The endpoint list, parameters and schemas below are
**generated from the app's own OpenAPI spec** (`app.openapi()`). They were
regenerated for v1.0.5 and are identical to v1.0.4's; only the behaviour
notes changed. Error codes come from the `HTTPException`s in
`backend/app/api/*.py`, because OpenAPI only lists the 422 that FastAPI adds
itself.

**Version.** The spec's `info.version` (and `app.version`) is the release the
image was built as: `VCM_VERSION` (e.g. `1.0.5`), or `dev` for a local build.

To regenerate the spec from a running dev stack:

```bash
docker compose exec backend python -c "import json; from app.main import app; print(json.dumps(app.openapi()))" > openapi.json
```

The interactive explorer is at `http://localhost:8000/docs` in the dev stack.
An install does not expose the backend; only `/api/*` is proxied through the
UI port.

## 1. Conventions

- **Base path:** `/api`. In an install the browser calls
  `http://localhost:<VCM_PORT>/api/...` and Next proxies it to `backend:8000`.
- **Format:** JSON in and out, except the upload (multipart), the file
  downloads (binary) and `204` responses (no body).
- **Times** are integer milliseconds (`start_ms`, `duration_ms`). Timestamps
  are ISO 8601 with a timezone.
- **Auth:**
  - **Local mode** (`AUTH_MODE=local`, the installed app): every route acts as
    the one local user. No `Authorization` header is needed.
    `POST /api/auth/refresh` returns a session without a cookie. The
    [request guard](SECURITY.md#3-the-request-guard) still applies.
  - **Accounts mode:** `Authorization: Bearer <access_token>` from
    login/register/refresh. The refresh token is an httpOnly cookie
    `vcm_refresh` scoped to `/api/auth`.
  - **Media and downloads** use short-lived tokens in the query string,
    because `<video>` and `<a>` can't send headers:
    - `GET /api/videos/{id}/stream?token=…` (stream token, 60 min, bound to
      one video);
    - `GET /api/exports/{id}/download?token=…` (download token, 15 min, bound
      to one export).
  - **Unauthenticated by design:** `GET /api/health`, `GET /`,
    `GET /api/styles/options`, `GET /api/fonts`, `GET /api/fonts/{key}/{weight}.ttf`,
    the stream/download routes (token instead), and the auth routes that start
    a session.
- **Ownership:** a resource that belongs to someone else returns **404, never
  403**, so IDs can't be probed.

## 2. Error format

Every error has a JSON body with `detail`:

```json
{ "detail": "Video not found" }
```

Validation errors (FastAPI/Pydantic) return **422** with a list:

```json
{
  "detail": [
    { "type": "string_too_short", "loc": ["body", "title"], "msg": "String should have at least 1 character", "input": "" }
  ]
}
```

Some errors are raised by hand with **422** and a string `detail`, for example
`"A caption has to end after it starts."` and `"That caption language isn't available. Choose one from the list."`.
Every `detail` meant for a person is a full sentence that says what to do
next (v1.1.1). The frontend shows a 422 *array* as one sentence: the app's own
rules without Pydantic's "Value error, " prefix, anything else as "Something in
that request wasn't valid. Reload the page and try again." (`validationMessage`
in `lib/api.ts`).

| Status | Meaning in this API |
|---|---|
| 400 | Bad input the schema can't catch (empty file, wrong password, OAuth state) |
| 401 | Missing or invalid credentials or token (accounts mode, stream/download tokens) |
| 403 | **Request guard refusal** (local mode), a token for a different resource, install settings in accounts mode, a disabled account |
| 404 | Not found **or not yours** |
| 409 | State conflict: already processing, nothing to export, export not ready, duplicate email |
| 413 | Upload over `MAX_UPLOAD_SIZE_MB` |
| 415 | Upload content type or extension not allowed |
| 422 | Validation |
| 429 | Auth rate limit (accounts mode); `Retry-After` header set |
| 502 | A Google font couldn't be fetched |
| 503 | The queue (Redis) is unreachable when queuing work, or Google sign-in isn't configured |
| 507 | Disk full while saving an upload |

The guard's 403 body is always:

```json
{ "detail": "This request didn't come from VideoCaptionMaker on this computer, so it was refused." }
```

The frontend (`frontend/src/lib/api.ts`, `extractError`) shows `detail` when
it is a string, and joins `msg`s for 422 lists. For 5xx other than 507 it
shows its own sentence, never the body.

## 3. Endpoints

`*` marks routes that need the current user. In local mode that is
automatic; in accounts mode it needs a Bearer token, or the route returns
401 `Could not validate credentials`.

### Health

| Method | Path | Response | Errors |
|---|---|---|---|
| GET | `/api/health` | `200 {"status": "healthy"}` | — |
| GET | `/` | `200 {"message": "…see /docs…"}` | — |

### Videos (`backend/app/api/videos.py`)

| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| POST* | `/api/videos` | multipart: `file` (required), `caption_language` (`same` default, or `en hi bn mr ta ml fr de nl es pt it ru`), `hold` (default `false`) | `201` [VideoRead](#videoread); transcription is queued, or, with `hold`, the upload waits (`held`, stage `detecting`) while the worker detects the language from the first 30 s; `POST …/transcribe` starts it. Held uploads aren't listed or counted, and are deleted after an hour if never started (v1.0.9) | 400 no filename / empty file · 413 too large · 415 type or extension, a cover image as the only picture, or a picture in a codec FFmpeg may not decode (v1.1.1, see SECURITY.md §7) · 422 unknown language · 507 disk full |
| GET* | `/api/videos` | query `limit` 1–100 (50), `offset` ≥ 0 (0), `status` [VideoStatus](#videostatus) | `200` [VideoList](#videolist) (newest first; `total` counts all matches) | 422 |
| GET* | `/api/videos/languages` | — | `200` [LanguageOptions](#languageoptions). `translation_available` is **always `true`**: English comes from Whisper, and the others from local M2M100, with no key needed. Each option carries its own-language name (`native`) | — |
| GET* | `/api/videos/{video_id}` | — | `200` [VideoRead](#videoread) | 404 `Video not found` |
| PATCH* | `/api/videos/{video_id}` | [VideoUpdate](#videoupdate) | `200` [VideoRead](#videoread) | 404 · 422 |
| DELETE* | `/api/videos/{video_id}` | — | `204`; row, file, thumbnail, waveform, vectors and every export file removed | 404 |
| POST* | `/api/videos/{video_id}/transcribe` | optional [TranscribeRequest](#transcriberequest) | `200` [VideoRead](#videoread) (`pending`); captions are replaced when it runs | 404 · 409 `This video is already being transcribed` · 503 queue unreachable |
| GET* | `/api/videos/{video_id}/captions` | — | `200` [CaptionList](#captionlist) (by `sequence`) | 404 |
| POST* | `/api/videos/{video_id}/captions` | [CaptionCreate](#captioncreate) | `201` [CaptionRead](#captionread); queues re-index | 404 · 422 |
| GET* | `/api/videos/{video_id}/thumbnail` | — | `200 image/jpeg` | 404 no thumbnail / file missing |
| POST* | `/api/videos/{video_id}/stream-token` | — | `200` [StreamTicket](#streamticket) | 404 |
| GET | `/api/videos/{video_id}/stream` | query `token` (required), `download` bool, `name` (used only with `download=1`) | `200`/`206` the original file; `Range` supported; `inline` or `attachment` | 401 invalid/expired token · 403 `This token is for a different video` · 404 |
| GET* | `/api/videos/{video_id}/waveform` | — | `200` [Waveform](#waveform) (cached beside the file) | 404 file missing |

### Captions (`backend/app/api/captions.py`)

| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| PATCH* | `/api/captions/{caption_id}` | [CaptionUpdate](#captionupdate): only the keys sent are changed; `null` clears an `override_*` | `200` [CaptionRead](#captionread); re-index only if `text` changed | 404 `Caption not found` · 422 `start_ms must be less than end_ms` |
| DELETE* | `/api/captions/{caption_id}` | — | `204`; later captions renumbered; re-index | 404 |
| POST* | `/api/captions/{caption_id}/split` | [CaptionSplit](#captionsplit) | `200` [CaptionPair](#captionpair) | 404 · 422 (split point invalid) |
| POST* | `/api/captions/{caption_id}/merge-next` | — | `200` [CaptionRead](#captionread) | 404 · 422 `This is the last caption…` |

### Caption styles (`backend/app/api/caption_styles.py`)

| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| GET | `/api/styles/options` | — | `200` [StyleOptions](#styleoptions): built-in fonts and preset names | — |
| GET* | `/api/videos/{video_id}/style` | — | `200` [CaptionStyleRead](#captionstyleread) (created with defaults if missing) | 404 |
| PATCH* | `/api/videos/{video_id}/style` | [CaptionStyleUpdate](#captionstyleupdate): only changed fields | `200` [CaptionStyleRead](#captionstyleread) | 404 · 422 |
| DELETE* | `/api/videos/{video_id}/style` | — | `200` [CaptionStyleRead](#captionstyleread) reset to defaults | 404 |
| POST* | `/api/videos/{video_id}/style/preset` | [PresetApply](#presetapply) (`youtube`, `tiktok`, `minimal`) | `200` [CaptionStyleRead](#captionstyleread) | 404 · 422 |

### Exports (`backend/app/api/exports.py`)

| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| POST* | `/api/videos/{video_id}/exports` | [ExportCreate](#exportcreate): `format`, optional `height` 2–2160, at most the source's height (ignored for sidecars) | `201` [ExportRead](#exportread): `completed` for srt/vtt/json, `pending` for mp4 | 404 · 409 `This video has no captions to export yet` · 422 (also `An export can't be larger than the video (240p)`) · 503 render queue unreachable |
| GET* | `/api/videos/{video_id}/exports` | — | `200` [ExportList](#exportlist) (newest first) | 404 |
| GET* | `/api/videos/{video_id}/exports/options` | — | `200` [ExportOptions](#exportoptions): resolution ladder, recommended height, `hardware_encoder` (`h264_nvenc` or null) | 404 |
| GET* | `/api/exports/{export_id}` | — | `200` [ExportRead](#exportread) (polled during a render) | 404 `Export not found` |
| DELETE* | `/api/exports/{export_id}` | — | `204`; row and file removed | 404 |
| POST* | `/api/exports/{export_id}/download-token` | — | `200` [DownloadTicket](#downloadticket) | 404 · 409 `This export failed. Make it again from Export.` or `This export is still being made. Download it when it's ready.` |
| GET | `/api/exports/{export_id}/download` | query `token` (required), `name` (optional stem; extension added) | `200` file as `attachment`. Default name: `<video>.srt`, or `<video>-captions.mp4` for a burn | 401 · 403 `This token is for a different export` · 404 · 409 `This export has no file` |

### Fonts (`backend/app/api/fonts.py`)

| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| GET | `/api/fonts` | query `q` (≤ 64), `category` (≤ 32), `limit` 1–2500 (60) | `200` [FontSearchResult](#fontsearchresult) | 422 |
| GET | `/api/fonts/{key}/{weight}.ttf` | — | `200 font/ttf`, `Cache-Control: public, max-age=31536000, immutable`; downloaded from google/fonts on first request | 404 unknown key/weight · 502 download failed |

### Search (`backend/app/api/search.py`)

| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| GET* | `/api/search` | query `q` (2–500, required), `video_id` (optional), `limit` 1–50 (10) | `200` [SearchResponse](#searchresponse); hits with cosine distance > 0.75 dropped | 404 `video_id` not yours · 422 |
| POST* | `/api/ask` | [AskRequest](#askrequest) | `200` [AskResponse](#askresponse). **Without a Gemini key**, `answer` is always "Written answers need a Gemini API key, which you can add in Settings. The matching moments are below.", with `grounded=false`, whether or not anything matched. With a key and no relevant hits, it is the refusal "I couldn't find an answer to that in this video." `results` are always returned | 404 · 422 |

### Stats (`backend/app/api/stats.py`)

| Method | Path | Response |
|---|---|---|
| GET* | `/api/stats` | `200` [StatsResponse](#statsresponse): counts, storage, duration, disk free/total (the disk, not a quota) |

### System (`backend/app/api/system.py`)

| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| GET* | `/api/system` | — | `200` [SystemInfo](#systeminfo). `hardware`/`whisper` are null until the worker has reported. **The Gemini key is never returned** by this or any other response, only `gemini_configured` and `gemini_source` (`settings`, `env` or null) | — |
| PATCH* | `/api/system/settings` | [SystemSettingsUpdate](#systemsettingsupdate): only keys sent are changed. `whisper_model`: `auto`/null, `small`, `medium`, `large-v3-turbo`, `large-v3`. `gemini_api_key`: a key, or `""`/null to clear | `200` [SystemInfo](#systeminfo). Audited in `audit.log` (without the value) | 403 in accounts mode · 422 `Unknown speech model` |

### Auth (`backend/app/api/auth.py`)

Used by the frontend bootstrap in both modes (`/refresh`, `/me`). The rest
serves accounts mode only; the local UI never shows them.

| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| POST | `/api/auth/register` | [UserCreate](#usercreate) | `201` [TokenResponse](#tokenresponse) + refresh cookie | 409 email exists · 422 · 429 |
| POST | `/api/auth/login` | [UserLogin](#userlogin) | `200` [TokenResponse](#tokenresponse) + refresh cookie | 401 `Incorrect email or password` (same for unknown email) · 429 |
| POST | `/api/auth/refresh` | refresh cookie (none needed in local mode) | `200` [TokenResponse](#tokenresponse) + new cookie | 401 missing/invalid refresh token, `Session expired…` |
| POST | `/api/auth/logout` | refresh cookie | `204`; cookie cleared, token revoked (Redis denylist) | — |
| GET* | `/api/auth/me` | — | `200` [UserRead](#userread) | 401 |
| PATCH* | `/api/auth/me` | [UserUpdate](#userupdate) | `200` [UserRead](#userread) | 401 · 422 |
| POST* | `/api/auth/me/password` | [PasswordChange](#passwordchange) | `200` [TokenResponse](#tokenresponse); older sessions invalidated | 400 Google-only account / current password incorrect |
| DELETE* | `/api/auth/me` | [AccountDelete](#accountdelete) | `204`; account, videos and files deleted | 400 password incorrect / email confirmation required |
| GET | `/api/auth/google/authorize` | — | redirect to Google | 503 Google sign-in not configured |
| GET | `/api/auth/google/callback` | query `code`, `state` | redirect to the frontend | 400 missing/invalid state, sign-in failed, no or unverified email · 403 account disabled |

## 4. Schemas

Generated from `components.schemas` of the OpenAPI spec (validation-error
schemas omitted). "Required" is OpenAPI's `required`. A field that is "no"
but has no default may be omitted.

### AccountDelete

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `password` | string \| null | no | maxLength 72 |
| `confirm_email` | string (email) \| null | no |  |

### Alignment

Enum: `left`, `center`, `right`

### AskRequest

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `question` | string | yes | minLength 2, maxLength 500 |
| `video_id` | integer \| null | no |  |

### AskResponse

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `question` | string | yes |  |
| `answer` | string | yes |  |
| `grounded` | boolean | yes |  |
| `citations` | [Citation](#citation)[] | yes |  |
| `results` | [SearchResult](#searchresult)[] | yes |  |

### Body_upload_video_api_videos_post

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `file` | string | yes |  |
| `caption_language` | string | no | default `"same"` |

### CaptionCreate

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `start_ms` | integer | yes | minimum 0 |
| `end_ms` | integer | yes | minimum 0 |
| `text` | string | yes | minLength 1, maxLength 5000 |

### CaptionList

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `items` | [CaptionRead](#captionread)[] | yes |  |
| `total` | integer | yes |  |

### CaptionPair

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `first` | [CaptionRead](#captionread) | yes |  |
| `second` | [CaptionRead](#captionread) | yes |  |

### CaptionRead

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `id` | integer | yes |  |
| `sequence` | integer | yes |  |
| `start_ms` | integer | yes |  |
| `end_ms` | integer | yes |  |
| `text` | string | yes |  |
| `confidence` | number \| null | yes |  |
| `override_color` | string \| null | no |  |
| `override_bold` | boolean \| null | no |  |
| `override_scale` | number \| null | no |  |

### CaptionSplit

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `at_ms` | integer | yes | minimum 0 |
| `text_offset` | integer \| null | no | minimum 0 |

### CaptionStyleRead

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `video_id` | integer | yes |  |
| `font_key` | string | yes |  |
| `font_size` | integer | yes |  |
| `bold` | boolean | yes |  |
| `italic` | boolean | yes |  |
| `underline` | boolean | yes |  |
| `strikeout` | boolean | yes |  |
| `uppercase` | boolean | yes |  |
| `letter_spacing` | integer | yes |  |
| `text_color` | string | yes |  |
| `outline_color` | string | yes |  |
| `outline_width` | integer | yes |  |
| `shadow` | integer | yes |  |
| `shadow_color` | string | yes |  |
| `box_color` | string | yes |  |
| `box_opacity` | number | yes |  |
| `box_padding` | integer | yes |  |
| `alignment` | [Alignment](#alignment) | yes |  |
| `pos_x` | number | yes | the caption block's anchor by `alignment`: its left edge (`left`), centre (`center`) or right edge (`right`), 0..1 of the frame's width (v1.2.0; the wrap box's centre before) |
| `pos_y` | number | yes | the block's vertical centre, 0..1 of the frame's height |
| `box_width` | number \| null | no | the box's width, 0..1 of the frame's width; null = 0.80 (landscape, square) or 0.85 (portrait) (v1.0.7) |
| `max_lines` | integer | no | default `2` (v1.0.7) |
| `line_style` | [LineStyle](#linestyle) | no | default `balanced` (v1.0.8) |
| `words_per_line` | integer | no | default `2`; words a line when `line_style` is `stacked` (v1.0.8) |
| `reference_height` | integer | no | default `1080` |
| `font_family` | string | no | default `""` |
| `font_css_stack` | string | no | default `""` |
| `script_font_stack` | string | no | default `""`. CSS families the preview lists before the caption font, each limited to its script by `unicode-range`: the Indic Noto faces, plus `"Noto Sans"` when the caption font has no Cyrillic. The same faces the burn uses (v1.0.7) |
| `font_win_span` | number | no | default `1.0`. The caption face's (usWinAscent + usWinDescent) / unitsPerEm. libass makes that span the font size, CSS the em, so the preview draws at `font_size × scale / font_win_span` with that line height (v1.0.7) |
| `script_fonts` | [ScriptFont](#scriptfont)[] | no | default `[]`. The faces of `script_font_stack` as data, for the editor's copy of the layout rule (v1.0.7) |

### CaptionStyleUpdate

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `font_key` | string \| null | no |  |
| `font_size` | integer \| null | no | minimum 12, maximum 200 |
| `bold` | boolean \| null | no |  |
| `italic` | boolean \| null | no |  |
| `underline` | boolean \| null | no |  |
| `strikeout` | boolean \| null | no |  |
| `uppercase` | boolean \| null | no |  |
| `letter_spacing` | integer \| null | no | minimum -10, maximum 50 |
| `text_color` | string \| null | no | pattern ^#(?:[0-9a-fA-F]{6})$ |
| `outline_color` | string \| null | no | pattern ^#(?:[0-9a-fA-F]{6})$ |
| `outline_width` | integer \| null | no | minimum 0, maximum 20 |
| `shadow` | integer \| null | no | minimum 0, maximum 20 |
| `shadow_color` | string \| null | no | pattern ^#(?:[0-9a-fA-F]{6})$ |
| `box_color` | string \| null | no | pattern ^#(?:[0-9a-fA-F]{6})$ |
| `box_opacity` | number \| null | no | minimum 0, maximum 1 |
| `box_padding` | integer \| null | no | minimum 0, maximum 60 |
| `alignment` | [Alignment](#alignment) \| null | no |  |
| `pos_x` | number \| null | no | minimum 0, maximum 1 |
| `pos_y` | number \| null | no | minimum 0, maximum 1 |
| `box_width` | number \| null | no | minimum 0.2, maximum 0.94; an explicit null is the default width again |
| `max_lines` | integer \| null | no | minimum 1, maximum 6 (the panel offers 1-3, or 1-6 when `stacked`) |
| `line_style` | [LineStyle](#linestyle) \| null | no |  |
| `words_per_line` | integer \| null | no | minimum 1, maximum 4 |

An explicit `null` for any field but `box_width` is a `422` (v1.0.7): those
columns are NOT NULL.

### CaptionUpdate

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `text` | string \| null | no | maxLength 5000 |
| `start_ms` | integer \| null | no | minimum 0 |
| `end_ms` | integer \| null | no | minimum 0 |
| `override_color` | string \| null | no | pattern ^#(?:[0-9a-fA-F]{6})$ |
| `override_bold` | boolean \| null | no |  |
| `override_scale` | number \| null | no | minimum 0.5, maximum 3 |

### CatalogueMeta

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `google_families` | integer | yes |  |
| `static` | integer | yes |  |
| `instanced` | integer | yes |  |
| `skipped_oversized` | integer | yes |  |
| `skipped_unusable` | integer | yes |  |

### Choice

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `value` | string | yes |  |
| `label` | string | yes |  |

### Citation

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `index` | integer | yes |  |
| `video_id` | integer | yes |  |
| `video_title` | string | yes |  |
| `caption_id` | integer | yes |  |
| `start_ms` | integer | yes |  |
| `text` | string | yes |  |

### DownloadTicket

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `token` | string | yes |  |
| `expires_in` | integer | yes |  |

### ExportCreate

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `format` | [ExportFormat](#exportformat) | yes |  |
| `height` | integer \| null | no | minimum 2, maximum 2160 and the source's height |

### ExportFormat

Enum: `srt`, `vtt`, `json`, `mp4`

### ExportList

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `items` | [ExportRead](#exportread)[] | yes |  |
| `total` | integer | yes |  |

### ExportOptions

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `source_width` | integer \| null | yes |  |
| `source_height` | integer \| null | yes |  |
| `recommended_height` | integer \| null | yes |  |
| `hardware_encoder` | string \| null | yes | `h264_nvenc` when the worker found NVENC usable (its hardware report, v1.2.0), else null |
| `resolutions` | [ExportResolution](#exportresolution)[] | yes |  |

### ExportRead

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `id` | integer | yes |  |
| `video_id` | integer | yes |  |
| `format` | [ExportFormat](#exportformat) | yes |  |
| `status` | [ExportStatus](#exportstatus) | yes |  |
| `size_bytes` | integer \| null | yes |  |
| `progress` | integer | yes |  |
| `error_message` | string \| null | yes |  |
| `created_at` | string (date-time) | yes |  |
| `height` | integer \| null | no |  |
| `caption_language` | string \| null | no | the video's caption language when it was made (`same` or a code); null for an export from before v1.0.8 |
| `current` | boolean \| null | no | false once a Redo has replaced the captions it was made from; null when unknown |

### ExportResolution

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `height` | integer | yes |  |
| `width` | integer | yes |  |
| `label` | string | yes |  |
| `native` | boolean | yes |  |

### ExportStatus

Enum: `pending`, `processing`, `completed`, `failed`

### FontLibraryEntry

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `key` | string | yes |  |
| `family` | string | yes |  |
| `category` | string | yes |  |
| `has_bold` | boolean | yes |  |
| `css_stack` | string | yes |  |

### FontRead

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `key` | string | yes |  |
| `label` | string | yes |  |
| `css_stack` | string | yes |  |

### FontSearchResult

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `total` | integer | yes |  |
| `matched` | integer | yes |  |
| `returned` | integer | yes |  |
| `fonts` | [FontLibraryEntry](#fontlibraryentry)[] | yes |  |
| `meta` | [CatalogueMeta](#cataloguemeta) | yes |  |

### HardwareInfo

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `cuda` | boolean | yes |  |
| `gpu_name` | string \| null | yes |  |
| `vram_gb` | number \| null | yes |  |
| `ram_gb` | number | yes |  |
| `cpu_count` | integer | yes |  |

### LineStyle

Enum: `auto`, `balanced`, `stacked` (v1.0.8)

### HindiScriptOption

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `code` | string | yes | `roman` or `devanagari` |
| `label` | string | yes | e.g. `Hinglish (Roman)` |
| `short` | string | yes | e.g. `Hinglish` |
| `download_bytes` | integer \| null | no | what choosing it downloads the first time; null if nothing |

### LanguageOption

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `code` | string | yes |  |
| `label` | string | yes | English name, or "Auto-detect" / "Same as spoken" |
| `native` | string \| null | no | the language's name in itself ("Español"); null for `auto` and `same` (v1.0.7) |

### LanguageOptions

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `spoken` | [LanguageOption](#languageoption)[] | yes | `auto` and the nine offered (v1.0.11); detected speech not in it is "not supported" in the UI |
| `caption` | [LanguageOption](#languageoption)[] | yes | `same` and the nine offered. `bn`, `mr`, `ta`, `ml` (until v1.0.10) are refused with 422 for new jobs |
| `hindi_scripts` | [HindiScriptOption](#hindiscriptoption)[] | no | how Hindi captions can be written (v1.0.9) |
| `hinglish_min_confidence` | number | no | default `0.7`; Hindi detected at or above it presets Hinglish |
| `translation_available` | boolean | yes |  |

### PasswordChange

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `current_password` | string | yes | minLength 1, maxLength 72 |
| `new_password` | string | yes | minLength 8, maxLength 72 |

### PresetApply

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `name` | string | yes |  |

### ScriptFont

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `family` | string | yes | e.g. `Noto Sans Devanagari` |
| `chars` | string | yes | the characters it draws, as the body of a regex character class |
| `span` | number | yes | its win span, which sets the height of a line it is on |

### SearchResponse

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `query` | string | yes |  |
| `results` | [SearchResult](#searchresult)[] | yes |  |
| `total` | integer | yes |  |

### SearchResult

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `video_id` | integer | yes |  |
| `video_title` | string | yes |  |
| `caption_id` | integer | yes |  |
| `start_ms` | integer | yes |  |
| `end_ms` | integer | yes |  |
| `text` | string | yes |  |
| `score` | number | yes |  |

### StatsResponse

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `videos` | integer | yes |  |
| `by_status` | object | yes |  |
| `storage_bytes` | integer | yes |  |
| `duration_ms` | integer | yes |  |
| `captions` | integer | yes |  |
| `exports` | integer | yes |  |
| `disk_free_bytes` | integer | yes |  |
| `disk_total_bytes` | integer | yes |  |

### StreamTicket

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `token` | string | yes |  |
| `expires_in` | integer | yes |  |

### StyleOptions

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `fonts` | [FontRead](#fontread)[] | yes |  |
| `presets` | string[] | yes |  |

### SystemInfo

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `version` | string | yes | the release (`VCM_VERSION`), `dev` for a local build (v1.1.0) |
| `auth_mode` | string | yes |  |
| `hardware` | [HardwareInfo](#hardwareinfo) \| null | yes |  |
| `whisper` | [WhisperInfo](#whisperinfo) \| null | yes |  |
| `whisper_choice` | string | yes |  |
| `whisper_choices` | [Choice](#choice)[] | yes | `auto`, `small`, `large-v3-turbo`, `large-v3` (`medium` until v1.1.0) |
| `hinglish_model` | [ModelDownload](#modeldownload) | yes | the Hinglish speech model (Apex) (v1.1.0) |
| `translation_engine` | string | yes |  |
| `translator_model` | string \| null | yes |  |
| `gemini_configured` | boolean | yes |  |
| `gemini_source` | string \| null | no |  |

### ModelDownload

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `downloaded` | boolean | yes | already in the models volume |
| `size_bytes` | integer | yes | what the first use downloads |

### SystemSettingsUpdate

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `gemini_api_key` | string \| null | no | maxLength 200 |
| `whisper_model` | string \| null | no |  |

### TokenResponse

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `access_token` | string | yes |  |
| `token_type` | string | no | default `"bearer"` |
| `expires_in` | integer | yes |  |
| `user` | [UserRead](#userread) | yes |  |

### TranscribeRequest

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `spoken_language` | string \| null | no |  |
| `caption_language` | string \| null | no |  |
| `hindi_script` | string \| null | no | `roman`, `devanagari` or `auto` (decided from detection); 422 otherwise. Also how a held upload is started |

### UserCreate

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `email` | string (email) | yes |  |
| `password` | string | yes | minLength 8, maxLength 72 |
| `full_name` | string \| null | no | maxLength 255 |

### UserLogin

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `email` | string (email) | yes |  |
| `password` | string | yes | minLength 1, maxLength 72 |

### UserRead

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `id` | integer | yes |  |
| `email` | string (email) | yes |  |
| `full_name` | string \| null | yes |  |
| `is_active` | boolean | yes |  |
| `created_at` | string (date-time) | yes |  |

### UserUpdate

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `full_name` | string \| null | no | maxLength 255 |

### VideoList

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `items` | [VideoRead](#videoread)[] | yes |  |
| `total` | integer | yes |  |

### VideoRead

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `id` | integer | yes |  |
| `title` | string | yes |  |
| `original_filename` | string | yes |  |
| `size_bytes` | integer | yes |  |
| `content_type` | string | yes |  |
| `duration_ms` | integer \| null | yes |  |
| `status` | [VideoStatus](#videostatus) | yes |  |
| `error_message` | string \| null | yes |  |
| `has_thumbnail` | boolean | yes |  |
| `spoken_language` | string | no | default `"auto"` |
| `caption_language` | string | no | default `"same"` |
| `hindi_script` | string \| null | no | `roman`, `devanagari` or `auto`; null for a video from before v1.0.9 (Devanagari) |
| `detected_language` | string \| null | no | what detection heard (the language step's, or the job's) |
| `detected_confidence` | number \| null | no | 0–1 |
| `held` | boolean | no | default `false`; uploaded, not started (v1.0.9) |
| `progress` | integer | yes |  |
| `stage` | string \| null | yes |  |
| `stage_detail` | string \| null | no |  |
| `notice` | string \| null | no |  |
| `created_at` | string (date-time) | yes |  |
| `updated_at` | string (date-time) | yes |  |

### VideoStatus

Enum: `pending`, `processing`, `completed`, `failed`

### VideoUpdate

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `title` | string | yes | minLength 1, maxLength 255 |

### Waveform

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `peaks` | number[] | yes |  |
| `duration_ms` | integer \| null | yes |  |

### WhisperInfo

| Field | Type | Required | Constraints / default |
|---|---|---|---|
| `model` | string | yes |  |
| `device` | string | yes |  |
| `compute_type` | string | yes |  |
| `source` | string | yes |  |

## Decisions recorded

Answers from the maintainer (2026-10-14) to this document's former open
questions:

| Question | Answer |
|---|---|
| `translation_available` ignored local translation | Fixed in v1.0.5: always `true`. |
| `/api/ask` without a key refused when nothing matched | Fixed in v1.0.5: without a key it always says a key is needed. |
| API version `0.1.0` | Fixed in v1.0.5: reports `VCM_VERSION`. |
