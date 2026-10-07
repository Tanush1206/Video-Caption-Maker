import { Captions, Search, Wand2 } from "lucide-react";

/**
 * The three things this app claims to do.
 *
 * Shared rather than written twice, because both places that say it are the
 * same promise at different moments: the landing page makes it, and the
 * dashboard's first-run state keeps it. Someone who signs up reads these
 * lines and then sees them again thirty seconds later — if they had drifted
 * apart, that second reading is where it would show.
 *
 * Keep the wording honest to what the app actually does. These are checked
 * against reality, not aspirations: local Whisper, a real timeline editor,
 * and embedding search over the transcript.
 */
export const FEATURES = [
  {
    icon: Wand2,
    title: "Transcribed on your own computer",
    body: "Whisper runs locally, on your GPU or CPU. Your video never leaves the machine, and there is no per-minute bill.",
  },
  {
    icon: Captions,
    title: "An editor, not a text box",
    body: "Waveform timeline, drag the boundaries, restyle the captions, and burn them in — or export SRT.",
  },
  {
    icon: Search,
    title: "Search by meaning",
    body: "Find the moment you half-remember. The words you type don't have to appear in the transcript.",
  },
] as const;
