# Android Brand Polish (SENYA brand assets + mockup fidelity) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining visual gaps between the Senya Android app and the M2/M3/M4 mockups, and replace the placeholder hand logo and launcher icon with the final SENYA brand assets.

**Architecture:** The screens, states, and logic from the previous plan (`docs/superpowers/plans/2026-10-10-android-ui-mockups.md`) are already merged on `main`. This plan only changes how the screens look:
- The brand SVGs become Android vector drawables, copied path for path.
- Legacy launcher PNGs are generated from the brand PNG by a script.
- The layouts and render code get small, targeted edits.

There is no new business logic, so there are no new unit tests. Each task is verified by a clean build, the existing unit suite, and an on-device screenshot.

**Tech Stack:** Kotlin 1.7.10, Android views + ViewBinding, Material Components 1.7.0, VectorDrawable / adaptive icons (minSdk 24, compileSdk 34), Python 3 + Pillow 12 (icon script only).

**Spec:** The three mockup images the user supplied on 2026-10-10 (M2 Translator · Refined Mobile, the 8-state Model update sheet, M4 Settings), plus `SENYA-brand-final/README.md` (brand rules and palette). Where the earlier plan's "Decisions already made" differ from the mockup, the decisions still win (see below).

## Decisions already made (do not re-litigate)

These are carried over from the previous plan:
- **Speak each word toggle.** It stays in Settings under Speech.
- **Server override.** Visible in debug builds only.
- **Flip-camera button.** It stays.
- **No model published.** The title is "No model published yet", and "Current model" shows the real model.
- **Rolled back.** The subtitle is "The server restored an earlier model."
- **Up to date.** The "Up to date" state stays.

These are new in this plan:
- **Brand palette.** The brand README's colors are used for ink and page background: `senya_ink` = `#202630` and `senya_background` = `#F6F7F9`. The launcher background is `#F6F7F9`. `senya_blue` `#2F80ED` stays for links, progress, and the caret, and `senya_button` `#7DB8F7` stays for primary buttons; both match the mockups.
- **Brand artwork is never recolored, stretched, or redrawn.** The drawables below are the brand SVG paths verbatim, with their original fills.
- **Translator app bar.** It shows the primary logo (palm-frame mark + SENYA wordmark with the blue Y) as one vector, followed by the version as plain `v<N>`, as in the mockup. "Static only" is no longer shown in the app bar; Settings ("Static letters only") and the update screen still show it.
- **Model update and Settings toolbars.** They show the brand mark (no wordmark) on the right, as in the mockups.
- **Onboarding welcome.** It shows the brand mark instead of the old hand.
- **Adaptive launcher icon.** It uses the brand mark scaled to 0.19 (not the 0.25 in `senya-adaptive-foreground.svg`), so the corner brackets stay inside the 66 dp safe zone of a circular mask. This is a uniform scale, so proportions are kept.

## Global Constraints

- **Scope.** Edit only `android/` and this plan. Never edit `senya-backend/`, `senya-admin/`, `senya-ml/`, `fixtures/`, `SENYA-brand-final/`, `CONTRACT.md`, or `docs/2026-10-09-senya-design.md`.
- **Branch.** Work on `android-brand-polish`. Create it from an up-to-date `main` before Task 1: `git checkout main && git pull --ff-only && git checkout -b android-brand-polish`. Commit at the end of every task. Do **not** push unless the user asks.
- **Commit messages.** Follow the repo style `android: <what changed>` and end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Kotlin 1.7.10.** Don't use `data object`, `entries`, or `MutableList.removeLast()`/`removeFirst()`. A `when` *statement* over a sealed class must be exhaustive.
- **SDK.** minSdk 24, compileSdk 34, portrait only.
- **License headers.** Keep the Apache license header at the top of every file that came from the MediaPipe sample: `CameraFragment.kt`, `fragment_camera.xml`, `nav_graph.xml`, `styles.xml`, `colors.xml`, `strings.xml`, `dimens.xml`, `OverlayView.kt`, `MainActivity.kt`.
- **PreviewView.** It keeps `app:scaleType="fillStart"`.
- **Commands.** Run from `android/` in Git Bash, each prefixed with `export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" &&`.
  - Unit tests: `./gradlew :app:testDebugUnitTest`
  - Build: `./gradlew :app:assembleDebug`
  - `adb`: `"$LOCALAPPDATA/Android/Sdk/platform-tools/adb"`
- **Phone access.** Installing the debug APK (`adb install -r`), launching it (`adb shell am start -n ph.senya.app/.MainActivity`), `adb exec-out screencap -p`, and `adb logcat -d` are allowed. Never run commands that change other phone state: no `pm revoke`, no `input tap`, no `pm clear`. Tapping through screens is the **user's** job (Task 4). If no device is attached, skip the device step and say so in the report.
- **Ports.** Never touch local ports 8000/8001.
- **Screenshots.** Save to the session scratchpad, never into the repo.
- **Colors and copy.** Use the exact values in this plan. Don't invent new ones.

## Review Focus

Nothing here is unit-testable on the JVM: the project has no Robolectric. Each of these is pinned to an on-device check in the task that owns the code, and Task 4 re-checks them all.

1. **Transcript caret.** The caret must never sit on its own line or render as a stray glyph or dot, and long text must still shrink instead of pushing the buttons off screen. Owned by Task 2, Step 5, and Task 4, Step 3.
2. **Vector path data.** An invalid `pathData` compiles fine but crashes at inflation. The camera screen inflates `senya_logo` on launch, so launching the app and checking logcat for `FATAL` is the test. Owned by Task 1, Step 7.
3. **Adaptive icon under a circular mask.** The corner brackets of the mark must not be cut off on the home screen. Owned by Task 1, Step 7 (the user looks at the home screen in Task 4).
4. **App bar with a long version (`v12`).** The logo, version, and gear must not overlap. The version view is `0dp`/`weight=1` with `ellipsize="end"`, so it shrinks. Checked in Task 4, Step 2.
5. **Recording card.** Switching between Holding, Recording, and Holding must not leave both the caption and the "Recording movement…" text visible. Owned by Task 2, Step 3 (`guessCaption.isVisible = !recording`), and checked in Task 4, Step 3.

---

## File Structure

**Create**
- `app/src/main/res/drawable/senya_mark.xml`: the brand palm-frame mark.
- `app/src/main/res/drawable/senya_logo.xml`: the primary logo (mark + wordmark).
- `app/src/main/res/drawable/ic_launcher_foreground.xml`: the adaptive icon foreground.
- `app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`, `ic_launcher_round.xml`
- `app/src/main/res/drawable/bg_input.xml`: the outlined text field (Settings → Advanced).
- `app/src/main/java/ph/senya/app/ui/CaretSpan.kt`
- `tools/make_launcher_icons.py`

**Modify**
- `res/values/colors.xml`, `res/values/styles.xml`, `res/values/strings.xml`
- `res/mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher.png`, `ic_launcher_round.png` (regenerated)
- `res/layout/fragment_camera.xml`, `fragment_onboarding.xml`, `view_screen_toolbar.xml`, `fragment_model_update.xml`, `fragment_settings.xml`
- `java/ph/senya/app/fragment/CameraFragment.kt`, `ModelUpdateFragment.kt`
- `java/ph/senya/app/OverlayView.kt`

**Delete**
- `res/drawable/onboarding_hand.xml` (after Task 1 removes its last use)

All paths below are relative to `android/` unless they start with `docs/` or `SENYA-brand-final/`.

---

### Task 1: Brand palette, logo drawables, and launcher icon

**Files:**
- Create: `app/src/main/res/drawable/senya_mark.xml`, `senya_logo.xml`, `ic_launcher_foreground.xml`
- Create: `app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`, `ic_launcher_round.xml`
- Create: `tools/make_launcher_icons.py`
- Modify: `app/src/main/res/values/colors.xml`
- Modify: `app/src/main/res/mipmap-*/ic_launcher.png`, `ic_launcher_round.png` (generated)
- Modify: `app/src/main/res/layout/fragment_camera.xml` (app bar logo), `fragment_onboarding.xml`, `view_screen_toolbar.xml`
- Delete: `app/src/main/res/drawable/onboarding_hand.xml`

**Interfaces:**
- Produces:
  - drawables `@drawable/senya_mark` (square, default 28dp) and `@drawable/senya_logo` (118×32dp default)
  - color `@color/ic_launcher_background` = `#F6F7F9`
  - updated `senya_ink` and `senya_background`
  - layout: the camera app bar has no `app_wordmark` TextView any more; `@string/app_wordmark` is now only the logo's content description

- [ ] **Step 1: Palette**

In `colors.xml`, change exactly these three lines and nothing else:

```xml
    <color name="ic_launcher_background">#F6F7F9</color>
```
```xml
    <color name="senya_ink">#202630</color>
```
```xml
    <color name="senya_background">#F6F7F9</color>
```

Then add this line after `senya_scrim` (it is used by Task 3):

```xml
    <color name="senya_outline">#D1D5DB</color>
```

- [ ] **Step 2: Brand mark drawable**

Create `app/src/main/res/drawable/senya_mark.xml`. The path data is copied verbatim from `SENYA-brand-final/senya-brand-mark.svg`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- SENYA palm-frame mark, from SENYA-brand-final/senya-brand-mark.svg. Do not recolor or redraw. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="28dp"
    android:height="28dp"
    android:viewportWidth="256"
    android:viewportHeight="256">
    <path
        android:fillColor="#8BB8E8"
        android:pathData="M22 18h45a9 9 0 0 1 0 18H31v36a9 9 0 0 1-18 0V27a9 9 0 0 1 9-9Z" />
    <path
        android:fillColor="#8BB8E8"
        android:pathData="M238 247h-32a9 9 0 0 1 0-18h23v-32a9 9 0 0 1 18 0v41a9 9 0 0 1-9 9Z" />
    <path
        android:fillColor="#8BB8E8"
        android:pathData="M91 183 50 128c-5-7-3-15 3-19 6-4 13-3 18 2l22 25V61c0-8 5-14 12-14s13 6 13 14v57c0 5 7 5 7 0V46c0-8 5-14 12-14s13 6 13 14v72c0 5 7 5 7 0V61c0-8 5-14 12-14s13 6 13 14v68c0 5 6 6 7 1l9-49c2-8 7-12 14-11 8 1 12 8 11 15l-15 90c-4 29-24 55-57 55-27 0-45-15-60-47Z" />
</vector>
```

- [ ] **Step 3: Primary logo drawable**

Create `app/src/main/res/drawable/senya_logo.xml`. The path data and transforms are copied verbatim from `SENYA-brand-final/senya-logo-primary.svg`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- SENYA primary logo (mark + wordmark), from SENYA-brand-final/senya-logo-primary.svg. Do not recolor or redraw. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="118dp"
    android:height="32dp"
    android:viewportWidth="1032"
    android:viewportHeight="280">
    <group
        android:translateX="16"
        android:translateY="12">
        <path
            android:fillColor="#8BB8E8"
            android:pathData="M22 18h45a9 9 0 0 1 0 18H31v36a9 9 0 0 1-18 0V27a9 9 0 0 1 9-9Z" />
        <path
            android:fillColor="#8BB8E8"
            android:pathData="M238 247h-32a9 9 0 0 1 0-18h23v-32a9 9 0 0 1 18 0v41a9 9 0 0 1-9 9Z" />
        <path
            android:fillColor="#8BB8E8"
            android:pathData="M91 183 50 128c-5-7-3-15 3-19 6-4 13-3 18 2l22 25V61c0-8 5-14 12-14s13 6 13 14v57c0 5 7 5 7 0V46c0-8 5-14 12-14s13 6 13 14v72c0 5 7 5 7 0V61c0-8 5-14 12-14s13 6 13 14v68c0 5 6 6 7 1l9-49c2-8 7-12 14-11 8 1 12 8 11 15l-15 90c-4 29-24 55-57 55-27 0-45-15-60-47Z" />
    </group>
    <group
        android:translateX="282"
        android:translateY="53">
        <path
            android:fillColor="#202630"
            android:pathData="M112 0H48C18 0 0 17 0 43c0 21 11 33 37 43l35 13c8 3 12 6 12 11 0 6-5 10-14 10H0v36h71c33 0 54-18 54-45 0-23-12-36-39-46L51 52c-8-3-12-6-12-10 0-5 4-8 12-8h61Z" />
        <path
            android:fillColor="#202630"
            android:pathData="M143 0h115v35h-76v26h68v33h-68v27h76v35H143Z" />
        <path
            android:fillColor="#202630"
            android:pathData="M280 156V17c0-10 7-17 17-17 6 0 11 3 15 8l75 88V0h38v139c0 10-7 17-17 17-6 0-11-3-15-8l-75-88v96Z" />
        <path
            android:fillColor="#8BB8E8"
            android:pathData="M439 0h43l48 64v92h-40V77Z" />
        <path
            android:fillColor="#8BB8E8"
            android:pathData="M538 58 510 22 527 0h44Z" />
        <path
            android:fillColor="#202630"
            android:fillType="evenOdd"
            android:pathData="M580 156 631 14c3-9 9-14 18-14s15 5 18 14l51 142h-42l-9-28h-38l-9 28Zm60-62h16l-8-27Z" />
    </group>
</vector>
```

- [ ] **Step 4: Adaptive launcher icon**

Create `app/src/main/res/drawable/ic_launcher_foreground.xml`. The mark is scaled to 0.19 and centred in the 108-unit canvas (offset = 54 − 128 × 0.19 = 29.68), so its corner brackets stay inside the 66 dp safe zone:

```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- Adaptive icon foreground: the SENYA mark, scaled so its corner brackets survive a circular mask. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <group
        android:scaleX="0.19"
        android:scaleY="0.19"
        android:translateX="29.68"
        android:translateY="29.68">
        <path
            android:fillColor="#8BB8E8"
            android:pathData="M22 18h45a9 9 0 0 1 0 18H31v36a9 9 0 0 1-18 0V27a9 9 0 0 1 9-9Z" />
        <path
            android:fillColor="#8BB8E8"
            android:pathData="M238 247h-32a9 9 0 0 1 0-18h23v-32a9 9 0 0 1 18 0v41a9 9 0 0 1-9 9Z" />
        <path
            android:fillColor="#8BB8E8"
            android:pathData="M91 183 50 128c-5-7-3-15 3-19 6-4 13-3 18 2l22 25V61c0-8 5-14 12-14s13 6 13 14v57c0 5 7 5 7 0V46c0-8 5-14 12-14s13 6 13 14v72c0 5 7 5 7 0V61c0-8 5-14 12-14s13 6 13 14v68c0 5 6 6 7 1l9-49c2-8 7-12 14-11 8 1 12 8 11 15l-15 90c-4 29-24 55-57 55-27 0-45-15-60-47Z" />
    </group>
</vector>
```

Create `app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml` and `ic_launcher_round.xml`. Both files get the same content:

```xml
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>
```

Create `tools/make_launcher_icons.py`. It writes the PNGs that Android 7 (API 24–25) uses:

```python
"""Writes the legacy (Android 7) launcher PNGs from the SENYA brand app icon.

Android 8+ uses the adaptive icon in res/mipmap-anydpi-v26 instead.
Run from anywhere: python android/tools/make_launcher_icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "SENYA-brand-final" / "senya-app-icon.png"
RES = ROOT / "android" / "app" / "src" / "main" / "res"
SIZES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}


def masked(icon: Image.Image, draw_mask) -> Image.Image:
    mask = Image.new("L", icon.size, 0)
    draw_mask(ImageDraw.Draw(mask), (0, 0, icon.size[0] - 1, icon.size[1] - 1))
    out = Image.new("RGBA", icon.size, (0, 0, 0, 0))
    out.paste(icon, mask=mask)
    return out


def main() -> None:
    src = Image.open(SRC).convert("RGBA")
    for density, px in SIZES.items():
        icon = src.resize((px, px), Image.LANCZOS)
        folder = RES / f"mipmap-{density}"
        masked(icon, lambda d, box: d.rounded_rectangle(box, radius=px // 6, fill=255)).save(folder / "ic_launcher.png")
        masked(icon, lambda d, box: d.ellipse(box, fill=255)).save(folder / "ic_launcher_round.png")
        print(f"wrote {folder.name} ({px}px)")


if __name__ == "__main__":
    main()
```

Run: `python tools/make_launcher_icons.py`
Expected: five `wrote mipmap-… (…px)` lines, one each for mdpi, hdpi, xhdpi, xxhdpi and xxxhdpi.

- [ ] **Step 5: Use the brand artwork in the layouts**

In `fragment_camera.xml`, replace the app bar's `ImageView` (`@drawable/onboarding_hand`) **and** the `TextView` that follows it (`@string/app_wordmark`) with this single view:

```xml
        <ImageView
            android:layout_width="wrap_content"
            android:layout_height="32dp"
            android:adjustViewBounds="true"
            android:contentDescription="@string/app_wordmark"
            android:src="@drawable/senya_logo" />
```

In `view_screen_toolbar.xml`, change the last `ImageView`'s `android:src="@drawable/onboarding_hand"` to `android:src="@drawable/senya_mark"`. Keep its 28dp size.

In `fragment_onboarding.xml` (the 136dp `ImageView` in `onboarding_welcome`), change `android:src="@drawable/onboarding_hand"` to `android:src="@drawable/senya_mark"`.

Then delete `app/src/main/res/drawable/onboarding_hand.xml`.

- [ ] **Step 6: Build and test**

Run: `grep -rn "onboarding_hand" app/src`
Expected: no output.

Run: `./gradlew :app:testDebugUnitTest :app:assembleDebug`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 7: Device smoke check (inflation and icon)**

If a device is attached:
- `adb install -r app/build/outputs/apk/debug/app-debug.apk`
- `adb logcat -c`
- `adb shell am start -n ph.senya.app/.MainActivity`
- Wait about 4 s.
- `adb exec-out screencap -p > <scratchpad>/brand-camera.png`, then read the PNG.
- `adb logcat -d | grep -E "FATAL|AndroidRuntime"`

Expected:
- The app bar shows the blue palm-frame mark and the SENYA wordmark with a blue Y, followed by the version.
- logcat shows no `FATAL EXCEPTION`. A crash here almost always means a typo in the `pathData` copied in Steps 2–4.

If the app opens on onboarding instead (first launch after a reinstall keeps data, so it usually won't), the screenshot should show the mark on the welcome page instead.

- [ ] **Step 8: Commit**

```bash
git add -A app/src/main/res tools/make_launcher_icons.py
git commit -m "android: SENYA brand logo, mark, palette, and launcher icon

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Translator screen (M2) fidelity

**Files:**
- Create: `app/src/main/java/ph/senya/app/ui/CaretSpan.kt`
- Modify: `app/src/main/res/layout/fragment_camera.xml`
- Modify: `app/src/main/java/ph/senya/app/fragment/CameraFragment.kt` (`applyBundle`, `renderTranscript`, `renderStatus`)
- Modify: `app/src/main/java/ph/senya/app/OverlayView.kt` (`trailPaint`, `initPaints`)

**Interfaces:**
- Consumes: `TranslatorStatus` (`core/StatusTracker.kt`), `R.string.model_version` (`"v%d"`), `R.string.guess_recording` (`"Recording movement…"`), `@color/senya_blue`.
- Produces: `class ph.senya.app.ui.CaretSpan(color: Int, widthPx: Float, gapPx: Float) : ReplacementSpan`, and a new view id `guess_recording_text` in `fragment_camera.xml`.

Gaps this task closes, compared against the M2 mockup and a device screenshot of the current build:
1. The app bar shows `v5 · static only`; the mockup shows `v3`.
2. The status row is white; the mockup's row sits on the light page background.
3. While recording, the mockup shows the spinner with "Recording movement…" **beside** it in one row; the current card puts the caption underneath.
4. The transcript should be heavy black text ("JAZZ") with a thin blue bar caret. Today the caret is a `|` glyph that can wrap to its own line and show as a stray dot below the text.
5. The hand landmarks are teal lines with yellow square points and a cyan trail (MediaPipe sample colors). The mockup shows blue lines, round blue points, and a blue trail.

- [ ] **Step 1: App bar version label**

In `CameraFragment.applyBundle`, replace:

```kotlin
        showModelLabel(getString(
            if (newBundle.motion == null) R.string.model_version_static_only else R.string.model_version,
            newBundle.version))
```

with:

```kotlin
        showModelLabel(getString(R.string.model_version, newBundle.version))
```

Leave `R.string.model_version_static_only` in `strings.xml`: `ModelUpdateFragment` still uses it.

- [ ] **Step 2: Layout edits in `fragment_camera.xml`**

(a) The status row: change `android:background="@color/senya_surface"` on `@+id/status_row` to `android:background="@color/senya_background"`.

(b) The recording text: inside `guess_card`'s first horizontal row, insert this TextView directly after `guess_spinner`:

```xml
                <TextView
                    android:id="@+id/guess_recording_text"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:layout_marginStart="12dp"
                    android:maxWidth="112dp"
                    android:text="@string/guess_recording"
                    android:textColor="@color/senya_ink"
                    android:textSize="14sp"
                    android:visibility="gone" />
```

(c) The transcript text: on `@+id/transcript`, add `android:fontFamily="sans-serif-black"`, and change `app:autoSizeMaxTextSize="48sp"` to `app:autoSizeMaxTextSize="56sp"` and `app:autoSizeMinTextSize="20sp"` to `app:autoSizeMinTextSize="22sp"`. Leave everything else as is.

- [ ] **Step 3: Recording row in `renderStatus`**

In `CameraFragment.renderStatus`, after the line `b.guessConfidence.isVisible = !recording`, add:

```kotlin
        b.guessRecordingText.isVisible = recording
        b.guessCaption.isVisible = !recording
```

and change the `Recording` branch from:

```kotlin
            is TranslatorStatus.Recording -> {
                b.guessCaption.setText(R.string.guess_recording)
                b.handHint.setText(R.string.status_finish_movement)
            }
```

to:

```kotlin
            is TranslatorStatus.Recording -> b.handHint.setText(R.string.status_finish_movement)
```

- [ ] **Step 4: The caret span**

Create `app/src/main/java/ph/senya/app/ui/CaretSpan.kt`:

```kotlin
package ph.senya.app.ui

import android.graphics.Canvas
import android.graphics.Paint
import android.text.style.ReplacementSpan
import kotlin.math.ceil

/**
 * The transcript caret (M2 mockup): a thin bar as tall as the letters, drawn instead of a "|" glyph.
 * A glyph can wrap onto its own line and shows up as a stray dot; a span placed after a word joiner can't.
 */
class CaretSpan(private val color: Int, private val widthPx: Float, private val gapPx: Float) : ReplacementSpan() {
    override fun getSize(paint: Paint, text: CharSequence?, start: Int, end: Int, fm: Paint.FontMetricsInt?): Int {
        // Keep the line as tall as the text around it
        if (fm != null) paint.getFontMetricsInt(fm)
        return ceil(gapPx + widthPx).toInt()
    }

    override fun draw(
        canvas: Canvas, text: CharSequence?, start: Int, end: Int,
        x: Float, top: Int, y: Int, bottom: Int, paint: Paint,
    ) {
        val metrics = paint.fontMetrics
        val oldColor = paint.color
        val oldStyle = paint.style
        paint.color = color
        paint.style = Paint.Style.FILL
        canvas.drawRect(x + gapPx, y + metrics.ascent * 0.8f, x + gapPx + widthPx, y + metrics.descent * 0.4f, paint)
        paint.color = oldColor
        paint.style = oldStyle
    }
}
```

- [ ] **Step 5: Use it in `renderTranscript`**

In `CameraFragment.renderTranscript`, replace:

```kotlin
        b.transcript.text = SpannableStringBuilder(text).apply {
            val start = length
            append("|")
            setSpan(ForegroundColorSpan(caretColor), start, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
```

with:

```kotlin
        val density = resources.displayMetrics.density
        b.transcript.text = SpannableStringBuilder(text).apply {
            append(WORD_JOINER)
            val start = length
            append(" ")
            setSpan(CaretSpan(caretColor, 3 * density, 6 * density), start, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
```

Then make these supporting changes:
- Add `import ph.senya.app.ui.CaretSpan`.
- Remove the `ForegroundColorSpan` import if nothing else uses it: `grep -n ForegroundColorSpan app/src/main/java/ph/senya/app/fragment/CameraFragment.kt` should then show nothing.
- Add a constant in the fragment's companion object, or at file level if there is no companion object:

```kotlin
/** Keeps the caret on the same line as the last letter. */
private const val WORD_JOINER = "⁠"
```

- [ ] **Step 6: Overlay colors**

In `OverlayView.kt`, add `isAntiAlias = true` to the paints and replace the body of `initPaints()`:

```kotlin
    private fun initPaints() {
        val blue = ContextCompat.getColor(context!!, R.color.senya_blue)
        linePaint.color = blue
        linePaint.strokeWidth = 4f
        linePaint.style = Paint.Style.STROKE
        linePaint.isAntiAlias = true

        pointPaint.color = blue
        pointPaint.strokeWidth = LANDMARK_STROKE_WIDTH
        pointPaint.style = Paint.Style.FILL
        pointPaint.strokeCap = Paint.Cap.ROUND
        pointPaint.isAntiAlias = true
    }
```

In `trailPaint`, replace `color = Color.CYAN` with `color = 0xCC2F80ED.toInt()`. This is `senya_blue` at 80% alpha; it can't use `ContextCompat` there because `context` is read later. If the `Color` import is now unused, remove it.

- [ ] **Step 7: Build, test, and device check**

Run: `./gradlew :app:testDebugUnitTest :app:assembleDebug`
Expected: BUILD SUCCESSFUL.

If a device is attached, install and launch as in Task 1, Step 7, and capture `<scratchpad>/m2-nohand.png`.

Expected:
- The app bar shows the logo plus `v<N>`.
- The status row sits on the light grey page background.
- If the transcript kept text from before, it is heavy black with a blue bar caret on the same line and no dot below.
- logcat has no `FATAL`.

- [ ] **Step 8: Commit**

```bash
git add -A app/src/main
git commit -m "android: translator screen matches M2 (logo bar, recording row, bar caret, blue landmarks)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Model update (M3) and Settings (M4) fidelity

**Files:**
- Create: `app/src/main/res/drawable/bg_input.xml`
- Modify: `app/src/main/res/layout/fragment_model_update.xml`, `fragment_settings.xml`
- Modify: `app/src/main/res/values/strings.xml`, `styles.xml`
- Modify: `app/src/main/java/ph/senya/app/fragment/ModelUpdateFragment.kt` (`render`)

**Interfaces:**
- Consumes:
  - `UpdateScreenState.Updated(current, from, to)` and `UpdateScreenState.RolledBack(current, from, to)` (`data/UpdateFlow.kt`)
  - `@color/senya_outline` (Task 1)
  - the toolbar mark (Task 1, already in `view_screen_toolbar.xml`)
- Produces: view id `update_versions`; string `update_versions`; style `SenyaCompactButton`; drawable `bg_input`.

Gaps this task closes:
1. M3 "Updated successfully" and "Rolled back" show `v3 → v4` as its own, larger line between the title and the subtitle. Today it is the first line of the subtitle, at subtitle size.
2. M4 "Advanced · expanded" shows an outlined, rounded URL field, a blue "Reset to default" text button, and a compact "Save changes" button. Today the field is a bare underlined `EditText` and Save is a full 56dp button.

- [ ] **Step 1: Strings**

In `strings.xml`, change these two strings:

```xml
    <string name="update_updated_body">The latest model is ready to use.</string>
```
```xml
    <string name="update_rolled_back_body">The server restored an earlier model.</string>
```

and add, next to them:

```xml
    <string name="update_versions">v%1$d → v%2$d</string>
```

- [ ] **Step 2: Version line in `fragment_model_update.xml`**

Insert this between `update_title` and `update_subtitle`:

```xml
            <TextView
                android:id="@+id/update_versions"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="6dp"
                android:gravity="center"
                android:textColor="@color/senya_ink"
                android:textSize="18sp"
                android:visibility="gone" />
```

- [ ] **Step 3: `ModelUpdateFragment.render`**

(a) After `b.updateSecondary.isVisible = false`, add:

```kotlin
        b.updateVersions.isVisible = false
```

(b) In the `Updated` branch, replace:

```kotlin
                text(R.string.update_updated_title, getString(R.string.update_updated_body, state.from, state.to))
```

with:

```kotlin
                text(R.string.update_updated_title, getString(R.string.update_updated_body))
                versions(state.from, state.to)
```

(c) In the `RolledBack` branch, replace:

```kotlin
                text(R.string.update_rolled_back_title, getString(R.string.update_rolled_back_body, state.from, state.to))
```

with:

```kotlin
                text(R.string.update_rolled_back_title, getString(R.string.update_rolled_back_body))
                versions(state.from, state.to)
```

(d) Add this helper next to `text(...)`:

```kotlin
    private fun versions(from: Int, to: Int) {
        binding.updateVersions.isVisible = true
        binding.updateVersions.text = getString(R.string.update_versions, from, to)
    }
```

- [ ] **Step 4: Outlined field and compact button**

Create `app/src/main/res/drawable/bg_input.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="@color/senya_surface" />
    <stroke android:width="1dp" android:color="@color/senya_outline" />
    <corners android:radius="10dp" />
</shape>
```

In `styles.xml`, add after `SenyaSecondaryButton`:

```xml
    <style name="SenyaCompactButton" parent="SenyaPrimaryButton">
        <item name="android:minHeight">44dp</item>
        <item name="android:textSize">15sp</item>
        <item name="android:paddingStart">20dp</item>
        <item name="android:paddingEnd">20dp</item>
    </style>
```

- [ ] **Step 5: Settings → Advanced body in `fragment_settings.xml`**

(a) On `@+id/settings_advanced_body`, add `android:paddingBottom="16dp"`.

(b) Replace the `EditText` `@+id/settings_server_override` with:

```xml
                    <EditText
                        android:id="@+id/settings_server_override"
                        android:layout_width="match_parent"
                        android:layout_height="48dp"
                        android:layout_marginTop="6dp"
                        android:background="@drawable/bg_input"
                        android:importantForAutofill="no"
                        android:inputType="textUri"
                        android:maxLines="1"
                        android:paddingStart="12dp"
                        android:paddingEnd="12dp"
                        android:textColor="@color/senya_ink"
                        android:textColorHint="@color/senya_muted"
                        android:textSize="15sp" />
```

(c) On `@+id/settings_reset_server`, add `android:textColor="@color/senya_blue"`.

(d) On `@+id/settings_save_server`, change `style="@style/SenyaPrimaryButton"` to `style="@style/SenyaCompactButton"`. Remove its now-redundant `android:paddingStart`, `android:paddingEnd`, and `android:textSize` attributes.

- [ ] **Step 6: Build and test**

Run: `./gradlew :app:testDebugUnitTest :app:assembleDebug`
Expected: BUILD SUCCESSFUL. `UpdateFlowTest` is unaffected, because it checks states, not strings.

Run: `grep -rn "update_updated_body\|update_rolled_back_body" app/src/main/java`
Expected: exactly the two `getString(...)` calls from Step 3, with no extra format arguments.

- [ ] **Step 7: Commit**

```bash
git add -A app/src/main
git commit -m "android: model update version line and outlined server field (M3, M4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Device walkthrough against the mockups

**Files:** none, unless a defect is found. Fix defects in the file that owns them, then rebuild.

**Stop and ask the user before starting this task.** The user taps the phone. The agent only installs the app, captures screenshots (`adb exec-out screencap -p > <scratchpad>/<name>.png`, then reads the PNG), reads logcat, and compares each screenshot to the mockups.

- [ ] **Step 1:** Run `./gradlew :app:assembleDebug`, then `adb install -r app/build/outputs/apk/debug/app-debug.apk`, then `adb shell am start -n ph.senya.app/.MainActivity`.

- [ ] **Step 2: Launcher and app bar.** Ask the user to go to the home screen.
  - Capture the home screen. Expected: the SENYA icon is a blue palm-frame mark on an off-white background, with no corner brackets clipped.
  - Then ask them to open Senya. Expected: the logo, `v<N>` and the gear sit on one line with no overlap.

- [ ] **Step 3: M2 states.** Ask the user to:
  1. Point the camera away from any hand.
  2. Show a clear letter.
  3. Show a half-formed shape.
  4. Sign J or Z.
  5. Spell "MA" and tap MAGANDA.
  6. Keep spelling until the transcript is two lines long.

  Expected, compared against the M2 image:
  - The no-hand hint shows on the light row.
  - The guess card shows the letter, the %, the bar and "Hold steady"; for the half-formed shape it shows "?" and "Not added" without flicker.
  - While recording, the spinner and "Recording movement…" sit side by side, with no caption below.
  - The landmarks and trail are blue.
  - The transcript is heavy black with a blue bar caret on the same line and no stray dot.
  - Long text shrinks and the Speak, Backspace and Clear buttons stay on screen.

- [ ] **Step 4: M4 Settings.** Ask the user to tap the gear, then expand Advanced.
  - Expected: the brand mark is at the top right, and the rows match the M4 image.
  - The expanded body shows the outlined field, the blue "Reset to default" and the compact "Save changes" button.
  - Ask the user to type a long URL. It must stay on one line and scroll.

- [ ] **Step 5: M3 states.** Ask the user to tap Check for update.
  - Expected: Checking, then Downloading, then Verifying, then Updated with the `vX → vY` line; **or** "You're up to date".
  - Then ask for airplane mode and Try again. Expected: "Update failed" with the red icon.

- [ ] **Step 6:** Run `adb logcat -d | grep -E "FATAL|AndroidRuntime"`. Expected: no crash.

- [ ] **Step 7:** Report every mismatch from the mockups to the user, with the screenshot path.

  States that can't be reached without changing the server (static-only, rolled back, no model published) are covered by `UpdateFlowTest`. Say so instead of changing the backend.

  After fixes, commit:

```bash
git commit -am "android: fixes from the brand polish walkthrough

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
