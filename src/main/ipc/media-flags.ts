import { app } from 'electron';

// Lets <video>.audioTracks list the audio streams inside a file (e.g. German + English in one .mkv).
// Must run before the app is ready, so subtitles.ts imports this file for its side effect.
app.commandLine.appendSwitch('enable-blink-features', 'AudioVideoTracks');