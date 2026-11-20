# Thrum

**Offline music, felt.** A bass-first music player for Android, built for people who keep their music on
their phone. It has a native sound engine, mood search that understands Indian music, and an Ink & Lime
look based on the Samsung Music layout.

No account, no ads, no tracking, and nothing leaves your phone. Your music, and everything Thrum learns
about it, stays on the device.

## What's inside

- **Sound engine.** Media3 playback with a custom 64-bit DSP chain:
  - 10-band EQ, a bass shelf with adjustable frequency, and phantom bass (harmonics that make small
    speakers and earbuds feel deeper).
  - Rumble filter, treble, stereo width and balance.
  - A lookahead limiter, so pushing the bass never clips, and TPDF dither.
  - Profiles per output (speaker, wired, Bluetooth), switched automatically.
  - Presets including Thrum, Bass Head, Deep Bass, Bollywood, Punjabi / Bhangra, Hip-hop / Trap, EDM
    and Lo-fi.
- **Vibe search.** Type how you feel: _"chill late night"_, _"sad arijit"_, _"bass heavy party"_.
  - A natural-language parser reads moods, tempo, era and personal cues ("my favourites", "haven't heard
    in a while"), and fuzzy text search handles typos.
  - Results are ranked using on-device analysis of every song: BPM, energy, bass, brightness,
    danceability, valence, acousticness, loudness and key.
  - Also: a mood map pad, and "Sounds like" results for any song.
- **Library.** Tracks, Albums, Artists, Playlists, Folders and Genres, with big One UI headers, an A–Z
  scrubber, sorting, and folder and short-file filters.
- **Now Playing.**
  - Ambient colour taken from the artwork, and artwork that reacts to the bass.
  - A squiggle seek bar, and synced lyrics embedded in your files (ID3 USLT/SYLT, FLAC/OGG and MP4 tags,
    including LRC-timed text).
  - Queue editing, a sleep timer that fades out, and playback speed.
  - Thrum remembers where you left off, and Android's media controls can resume it even after a reboot.
- **For you.** A daylist that changes through the day, mood mixes, On repeat, Rediscover, Recently
  added and Recently played, plus listening stats.

## Requirements

Already set up on this machine:

| Tool        | Where                                                       |
| ----------- | ----------------------------------------------------------- |
| Node + npm  | on `PATH`                                                   |
| JDK 17      | `C:\Users\swarupchanda\.jdks\jdk-17` (user `JAVA_HOME`)     |
| Android SDK | `%LOCALAPPDATA%\Android\Sdk` (user `ANDROID_HOME`)          |
| NDK / CMake | NDK 27.1.12297006, CMake 3.22.1 (with the ninja fix, below) |

If you've only just installed them, open a **new** terminal so the variables are picked up.

> **Expo Go won't work.** Thrum ships its own native module (the Media3 engine and library scanner), so
> it runs as a _development build_, which is your own debuggable copy of the app.

## Run it on your phone

1. **Turn on USB debugging** (Samsung Galaxy):
   - Go to _Settings → About phone → Software information_ and tap **Build number** seven times.
   - Go to _Settings → Developer options_ and turn on **USB debugging**.
   - Plug the phone in and accept the "Allow USB debugging?" prompt.
2. **Check that it's connected:**
   ```powershell
   adb devices        # should list your phone as "device"
   ```
3. **Build, install and start:**
   ```powershell
   cd C:\Users\swarupchanda\Workspace\thrum
   npm install
   npm run android    # = npx expo run:android
   ```
   - The first build takes about 5–10 minutes. After that, Gradle's cache makes rebuilds quick.
   - The command installs **Thrum** on the phone and starts Metro. JavaScript edits hot-reload instantly.
4. **On the phone, allow "Music and audio"** when Thrum asks. It scans your library and starts listening
   to your songs in the background so Vibe search can work.

Next time, if you haven't changed native code or `app.json`, skip the rebuild:

```powershell
npm start          # Metro for the installed dev build; open Thrum on the phone
```

Run `npm run android` again only after you change `modules/`, `app.json` or the native dependencies.

**Wireless instead of USB (Android 11+):**

1. Turn on _Developer options → Wireless debugging_ and choose _Pair device with pairing code_.
2. On the PC, run:
   ```powershell
   adb pair <ip>:<pair-port>
   adb connect <ip>:<port>
   ```
3. Then run `npm run android` as usual.

## Preview in the browser

```powershell
npm run web        # http://localhost:8081
```

The web build uses a 93-song sample library and a simulated engine, so you can review the design
without a phone. Real playback, the EQ and scanning are native-only.

## Checks

```powershell
npm run check      # TypeScript, ESLint and 276 Jest tests
```

Native unit tests (36 JUnit tests covering the DSP, audio analysis and tag/lyrics parsers):

```powershell
cd android
.\gradlew.bat :thrum-audio:testDebugUnitTest
```

`android/` is generated and gitignored. If it's missing, recreate it with
`npx expo prebuild --platform android`.

## Project layout

```
src/app              Routes (expo-router): For you, Library, Vibe and Sound tabs, plus details, settings and stats
src/components       UI: player overlay, sheets, sound controls, vibe search, library
src/lib              Pure logic with Jest tests: vibe parser, moods, search, EQ, daylist, shuffle, stats, LRC
src/stores           zustand state: player, library, sound, history, settings
src/audio, src/db    Native bridge helpers and SQLite persistence
modules/thrum-audio  Kotlin Expo module: Media3 service, DSP, MediaStore scanner, analysis, tags/lyrics, web shim
```

## Make an installable APK (later)

With EAS (cloud builds, already logged in as `swarupcsenits`):

```powershell
eas init                                       # once: links the project to your Expo account
eas build -p android --profile preview         # installable APK for your phone
eas build -p android --profile production      # Play Store bundle (AAB)
```

Or build one locally without EAS:

```powershell
cd android
.\gradlew.bat :app:assembleRelease             # android\app\build\outputs\apk\release\app-release.apk
```

The local release APK is signed with the debug key. That's fine for your own phone, but the Play Store
needs a real keystore (EAS manages one for you).

## Troubleshooting

- **CMake / ninja "path too long" errors on Windows.** CMake 3.22.1 from the SDK ships ninja 1.10.2,
  which fails on long paths. It has been replaced with ninja 1.13.2 at
  `%LOCALAPPDATA%\Android\Sdk\cmake\3.22.1\bin\ninja.exe`; the original is kept as
  `ninja-1.10.2.exe.bak`. If the SDK Manager reinstalls CMake, copy the newer ninja back.
- **`adb devices` shows "unauthorized".** Unplug the phone, choose _Developer options → Revoke USB
  debugging authorisations_, plug it back in and accept the prompt.
- **Some songs are missing.** Thrum reads Android's media library, so files must be in shared storage
  (for example `Music/` or `Download/`). Check the folder and "Skip short files" options in Settings,
  then tap **Rescan now**.
- **Build is stuck or odd after changing `app.json`.** Regenerate the native project with
  `npx expo prebuild --platform android --clean`, then run `npm run android`.
