# Privacy

VideoCaptionMaker runs on your own computer. It has no servers and no
accounts, and it sends nothing to its developer: no telemetry, no crash
reports, no usage statistics. Your videos, captions and exports stay on your
computer.

## What leaves your computer, and when

| To | When | What is sent |
|---|---|---|
| GitHub (`github.com`) | installing, and `vcm update` | requests for the install scripts and release files |
| GitHub Container Registry (`ghcr.io`) and Docker Hub | installing, and `vcm update` | requests for the app's images and the database, queue and search images it uses |
| Hugging Face (`huggingface.co`) | the first time each model is needed (speech, Hinglish, translation, search) | requests for the model files; no account or token. Once a model is downloaded, it is not contacted again for it |
| GitHub (`raw.githubusercontent.com`) | the first time you pick a font from the Google Fonts library | a request for that font file |
| Google, Gemini API | **only if you add your own Gemini API key in Settings**, when translating captions or asking a question in Search | **caption text only**: up to 25 lines at a time for a translation, or your question and up to 6 matching captions. Never the video or its sound |

Each of these services sees your computer's IP address when it is contacted,
and handles it under its own privacy policy. Nothing else leaves your
computer. Without a Gemini key, once the models are downloaded, captioning,
translation, editing, export and search work offline.

## Gemini, if you add a key

The key is your own, so Google's terms for the Gemini API apply to you
directly ([Gemini API Additional Terms of Service](https://ai.google.dev/gemini-api/terms)).
Among them, as of April 2026:

- **Free keys:** Google may use what you send (here, caption text) to improve
  its products, and **people at Google may read it**. Google asks you not to
  send sensitive, confidential or personal information to the free service.
  With a paid key, Google doesn't use it to improve its products.
- **Age:** you must be 18 or over to use the Gemini API.
- **Europe:** in the European Economic Area, Switzerland and the United
  Kingdom, only paid keys may be used.

For anything private, use a paid key, or leave the key empty: the app then
translates with its own model, on your computer.

## The website

The website (tanush1206.github.io/Video-Caption-Maker) is hosted on GitHub
Pages; GitHub records visitors' IP addresses in its server logs under
[GitHub's privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

It counts visits with [GoatCounter](https://www.goatcounter.com): which page
was opened, and clicks on the Copy button and the Windows/Linux switch, as
totals. GoatCounter sets no cookies and, by its own description, stores no IP
addresses or other personal data. Nothing else on the page sends data
anywhere.

## Your videos

You need the right to use the videos you caption. If you caption videos of
other people for work, you are responsible for that use under the law that
applies to you (in India, the Digital Personal Data Protection Act). The app
itself collects no personal data on any server, because it has none.

## Questions

Ask in a [GitHub issue](https://github.com/Tanush1206/Video-Caption-Maker/issues).
For anything you'd rather not post publicly, use the repository's
[private reporting](https://github.com/Tanush1206/Video-Caption-Maker/security/advisories/new).
