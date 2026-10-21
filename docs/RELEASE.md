# Release checklist: App Store and Google Play

What the store submission needs from you (accounts, signing, listings). Everything in the repo that can be prepared ahead of time already is; the items below need your developer accounts or a real device.

## 0. Before you start

- [ ] **Decide the bundle / application id.** It is `com.jamesclancy.antsimulator` (`apps/mobile/capacitor.config.ts`, the Android `applicationId`, and the Xcode bundle identifier). **It can never change after the first upload.** If you want a different one, change it in all three places first, then run `pnpm mobile:sync`.
- [ ] Decide the public app name (`appName` in the config and the Android `app_name` string), and confirm the name is free on both stores.
- [ ] Replace the placeholder icon and splash art (section 1).
- [ ] Run a full playtest on at least one real low/mid-range Android phone and one iPhone (see section 6).

## 1. Icons and splash screens

Source art lives in `apps/mobile/assets/`:

| File                  | Size      | Used for                                                                            |
| --------------------- | --------- | ----------------------------------------------------------------------------------- |
| `icon-only.png`       | 1024×1024 | iOS app icon, legacy Android icon (include its background)                          |
| `icon-foreground.png` | 1024×1024 | Android adaptive icon foreground (transparent; keep the mark inside the centre 66%) |
| `icon-background.png` | 1024×1024 | Android adaptive icon background                                                    |
| `splash.png`          | 2732×2732 | Light splash; keep the logo inside the centre ~1200 px                              |
| `splash-dark.png`     | 2732×2732 | Dark-mode splash                                                                    |

The current files are a placeholder ant mark drawn by `apps/mobile/scripts/make-placeholder-art.mjs` (`pnpm --filter @ant/mobile art`). To use final art, overwrite the PNGs (same names and sizes) and run:

```sh
pnpm --filter @ant/mobile assets
```

That regenerates every iOS/Android icon and splash density in place (`@capacitor/assets`; it is restricted to iOS and Android because the PWA owns its own icons). Commit the generated files. Do not run the placeholder script afterwards or it will overwrite your art.

## 2. Accounts

- [ ] **Apple Developer Program**: $99/year, enrol as an individual or organisation (organisation needs a D-U-N-S number and takes days to weeks). Needed for TestFlight and the App Store.
- [ ] **Google Play Console**: $25 one-off. Personal accounts created after Nov 2023 must run a **closed test with at least 12 testers for 14 days** before they can apply for production access, so start this early.
- [ ] A public **support URL** and a **privacy policy URL** (both stores require one even for apps that collect nothing). A one-page static site is enough.

## 3. Signing and builds

### iOS (needs full Xcode on a Mac; this repo's dev machine only has Command Line Tools)

1. `pnpm mobile:ios` (builds the web app, syncs, opens the Xcode project).
2. Target **App** → Signing & Capabilities: tick _Automatically manage signing_ and pick your team. Xcode creates the certificate and provisioning profile.
3. Set Version (marketing, e.g. `1.0.0`) and Build (integer, must increase for every upload) in the General tab.
4. Select _Any iOS Device (arm64)_ → Product → Archive → Distribute App → App Store Connect → Upload.
5. In App Store Connect the build appears under TestFlight after processing (~15 min). Add internal testers first (no review), then external testers (Beta App Review, usually a day).

### Android

1. Create an **upload keystore once** and back it up somewhere safe (password manager plus an offline copy):
   ```sh
   keytool -genkeypair -v -keystore ant-simulator-upload.jks -alias upload \
     -keyalg RSA -keysize 2048 -validity 10000
   ```
   Never commit the keystore or its passwords.
2. Add a `signingConfigs.release` block to `apps/mobile/android/app/build.gradle` that reads the keystore path and passwords from `~/.gradle/gradle.properties` (not the repo), and point `buildTypes.release` at it.
3. Bump `versionCode` (integer, increases every upload) and `versionName` in the same file.
4. Build the bundle: `pnpm mobile:sync && cd apps/mobile/android && ./gradlew bundleRelease` → `app/build/outputs/bundle/release/app-release.aab`.
5. In Play Console, enrol in **Play App Signing** (default) and upload the `.aab` to _Internal testing_ first, then closed/open testing, then production.

CI (`.github/workflows/ci.yml`) already builds an unsigned Android debug APK; release signing is deliberately not in CI.

## 4. Privacy and compliance

The game as built collects no data: saves and settings stay on the device (IndexedDB / Capacitor Preferences / app files), there is no account system, analytics, ads or network traffic beyond loading the app itself. If that changes (analytics, crash reporting, leaderboards, ads), update every item here.

- [ ] **Apple privacy nutrition label**: _Data Not Collected_.
- [ ] **Google Play Data safety form**: no data collected, no data shared; the app does not use encryption beyond the OS (answer the export-compliance question accordingly: `ITSAppUsesNonExemptEncryption` = `NO` in `Info.plist` avoids the prompt on every upload).
- [ ] **Age rating / content rating questionnaires**: cartoon insect combat only (mild fantasy violence, no blood). Expect 4+/9+ on iOS and Everyone 10+ (or similar) on Play.
- [ ] Privacy policy states the above and gives a contact email.
- [ ] Play **target API level** requirement is met (the project targets API 36).
- [ ] Confirm art, name and audio are original (docs/PLAN.md risk table: no SimAnt trademarks or assets).

## 5. Store listing assets

- [ ] Short and long descriptions, keywords (App Store, 100 characters), category _Games → Simulation_.
- [ ] **iOS screenshots**: 6.9" (1320×2868) and 6.5" (1284×2778) iPhone are required; 13" iPad (2064×2752) if you ship iPad (the target is universal, so provide them or restrict the target to iPhone).
- [ ] **Play screenshots**: at least 2 phone screenshots (16:9 or 9:16, 320–3840 px edge); a 512×512 icon and a **1024×500 feature graphic**.
- [ ] Optional 15–30 s preview video.
- [ ] Take screenshots with _Show FPS_ off, a mid-game colony, the underground view and scent vision.

## 6. Pre-submission device checks

Run these on real hardware; the automated checks cannot cover them.

- [ ] Fresh install: splash shows, no white flash, status bar icons readable, game fills the screen including under the notch / Android gesture bar, HUD clear of cut-outs.
- [ ] Rotate both ways in game and in menus; nothing overlaps.
- [ ] Haptics: pickup/recruit tap, buzz when the player ant is attacked, heavy buzz on queen death; Settings → Haptics off silences them.
- [ ] Android back button: closes menus → surface from nest → opens Pause → exits from the main menu.
- [ ] Background and return: game pauses, autosaves, resumes; no battery drain while backgrounded (Android Studio Profiler / Xcode Energy gauge).
- [ ] Performance (Settings → Show FPS): ≥ 30 fps with a late-game colony on the slowest supported device, sim under 8 ms/tick; try Battery saver.
- [ ] Kill the app mid-game and relaunch: _Continue_ offers the autosave.
- [ ] Airplane mode: everything still works offline.

## 7. Submit

1. App Store Connect → the app → fill the listing, privacy, age rating, pricing; attach the processed build; _Submit for Review_ (typically 1–2 days).
2. Play Console → Production → create release from a tested track, complete the dashboard tasks (Data safety, content rating, target audience, store listing), _Send for review_ (hours to a few days).
3. After approval, tag the release in git (`v1.0.0`) so the store build can be reproduced.
