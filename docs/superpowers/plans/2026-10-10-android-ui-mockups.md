# Android UI Mockups (M2 Translator, M3 Model Update, M4 Settings) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Senya Android app's screens to match the teammate's mockups: the M2 translator screen (no hand, low confidence, recording movement, permission denied), the M3 model-update screen (eight states plus "up to date"), and the M4 Settings screen.

**Architecture:** All new behaviour that has logic is written as plain Kotlin with no Android imports, and is unit-tested first:
- `StatusTracker` decides which translator state to show.
- `WordSuggester` and `Transcript.completeWord` drive the suggestion chips.
- `ModelUpdater` gains progress, cancel, force, and a static-only fallback.
- `ModelInfo` describes a model without loading it.
- `UpdateFlow` turns updater progress and results into screen states.

The Android layer stays thin. It has three fragments (camera, settings, model update), one `AndroidViewModel` that runs `UpdateFlow` on a background thread, XML layouts, and vector icons. Navigation: camera → settings → model update, using the existing Navigation component graph.

**Tech Stack:** Kotlin 1.7.10, Android views + ViewBinding, Material Components 1.7.0 (`MaterialButton`, `CircularProgressIndicator`, `LinearProgressIndicator`, `SwitchMaterial`), Navigation 2.5.3, AndroidX Lifecycle (`AndroidViewModel`, `MutableLiveData`, via fragment-ktx 1.5.4), CameraX 1.4.2, JUnit 4.

**Spec:** The three mockup images the user supplied on 2026-10-10 (M2 Translator · Refined Mobile, the 8-state Model update sheet, M4 Settings), together with the user's decisions recorded below. The product spec `docs/2026-10-09-senya-design.md` §5 still applies wherever this plan doesn't override it.

## Decisions already made (do not re-litigate)

- **Suggestion chips** use a bundled offline word list (`assets/words.txt`, most common first, Filipino then English). Chip 1 is always the word being spelled, highlighted. Chips 2–3 are completions of it. Tapping a chip replaces the partial word with the chip's text and adds a space.
- **Server URL override** (Settings → Advanced) is visible in **debug builds only**, as it is today.
- **Flip-camera button stays.** It is a small round button in the bottom-right corner of the camera view, hidden while camera permission is denied.
- **"Speak each word" toggle stays.** It is in Settings under Speech.
- **Permission denied is shown inline** on the translator screen, as in the mockup. `PermissionsFragment` and its layout are deleted.
- **"Rolled back"** means the server published an older version than the installed one, because an admin rolled back. The subtitle says "The server restored an earlier model."
- **"Continuing static-only"** means the version publishes a motion model, but its files failed to download, failed the checksum, or failed the golden check. The static model installs anyway. "Retry motion model" re-downloads the same version (`force = true`).
- **"No model available yet"** maps to the server answering 404 (`NoModelPublished`). The title is "No model published yet". "Current model" shows the real model on the phone, which is usually the bundled v0. It does not show "None".
- An **"Up to date"** state is added (not in the mockup) with a check icon and "Continue signing".
- The FPS readout is removed from the UI. It stays in logcat.

## Global Constraints

- Edit only `android/` and this plan. Never edit `senya-backend/`, `senya-admin/`, `senya-ml/`, `fixtures/`, `CONTRACT.md`, or `docs/2026-10-09-senya-design.md`.
- Work on branch `android-ui-mockups` (create it from `main` before Task 1: `git checkout -b android-ui-mockups`). Commit at the end of every task. Do **not** push unless the user asks.
- Commit messages follow the repo style `android: <what changed>` and end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Kotlin **1.7.10**:
  - Don't use `data object`, `entries`, or `MutableList.removeLast()`/`removeFirst()`; use `removeAt(lastIndex)`. `ArrayDeque.removeFirst()` is fine.
  - A `when` *statement* over a sealed class must be exhaustive, or it is a compile error.
- minSdk 24, compileSdk 34. Portrait only (the manifest already locks it).
- Keep the Apache license header at the top of every file that came from the MediaPipe sample (`CameraFragment.kt`, `fragment_camera.xml`, `nav_graph.xml`, `styles.xml`, `colors.xml`, `strings.xml`, `dimens.xml`, `OverlayView.kt`, `MainActivity.kt`). New files don't need one.
- `PreviewView` keeps `app:scaleType="fillStart"`. `OverlayView` draws landmarks from the top-left corner and only lines up with `fillStart`.
- Pure-logic classes (`core/`, `data/ModelUpdater.kt`, `data/UpdateFlow.kt`, `ml/ModelInfo.kt`) have **no Android imports**.
- Commands run from `android/` in Git Bash, each prefixed with `export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" &&`.
  - Unit tests: `./gradlew :app:testDebugUnitTest` (one class: `--tests 'ph.senya.app.core.StatusTrackerTest'`).
  - Build: `./gradlew :app:assembleDebug`.
  - `adb` is at `"$LOCALAPPDATA/Android/Sdk/platform-tools/adb"`.
- Phone testing: the **user** taps the phone. The agent only observes, through `adb exec-out screencap -p > <scratchpad>/name.png` and `adb logcat`. Never run commands that change phone state (no `pm revoke`, no `input tap`).
- Never touch local ports 8000/8001 (the user's running services).
- Colors and copy are the exact values below. Don't invent new ones.

## Review Focus

1. **Back or Cancel during a download, including the ~50 s Render wake-up wait.** The screen must close at once and nothing may be installed afterwards. Tested by `cancelDuringDownloadInstallsNothing`, `cancelAfterVerifyInstallsNothing` (Task 3), and `cancelStopsStepsAndShowsCancelled` (Task 4).
2. **Single low-confidence frames between good frames.** These must not flash "Not sure, try again". Tested by `briefLowConfidenceKeepsPreviousStatus` and `goodFrameRestartsUnsureClock` (Task 1).
3. **The update screen keeps a loaded `ModelBundle` (TFLite interpreters).** It must close the bundle; the camera reloads from disk. Tested by `updatedClosesBundleAndReportsVersions` (Task 4).
4. **Tapping a suggestion when the transcript is empty or ends with a space**, and suggestions for multi-word entries. No crash, and no chips when no word is being spelled. Tested by `noSuggestionsWithoutPartialWord` and `completeWordOnEmptyTranscript` (Task 2).
5. **Returning from Settings or the update screen.** The camera must use the newly installed model and keep the transcript the user had. This is a device check in Task 9, steps 6–7. `transcript` and `engine` are fragment fields, so they survive view re-creation; `onViewCreated` reloads the model from disk.

---

## File Structure

**Create**
- `app/src/main/java/ph/senya/app/core/StatusTracker.kt`: `TranslatorStatus` and `StatusTracker`.
- `app/src/main/java/ph/senya/app/core/WordSuggester.kt`
- `app/src/main/assets/words.txt`
- `app/src/main/java/ph/senya/app/ml/ModelInfo.kt`
- `app/src/main/java/ph/senya/app/data/UpdateFlow.kt`: `UpdateScreenState` and `UpdateFlow`.
- `app/src/main/java/ph/senya/app/fragment/ModelUpdateFragment.kt`
- `app/src/main/java/ph/senya/app/fragment/ModelUpdateViewModel.kt`
- `app/src/main/java/ph/senya/app/fragment/SettingsFragment.kt`
- `app/src/main/java/ph/senya/app/fragment/CameraPermission.kt`
- `app/src/main/java/ph/senya/app/speech/VoiceDialog.kt`
- `app/src/main/res/layout/fragment_model_update.xml`, `fragment_settings.xml`, `view_screen_toolbar.xml`
- `app/src/main/res/drawable/bg_card.xml`, `bg_icon_button.xml`, `bg_round_dark.xml`, `bg_suggestion.xml`, and `ic_*.xml` (generated)
- `tools/fetch_icons.py`
- Tests: `core/StatusTrackerTest.kt`, `core/WordSuggesterTest.kt`, `ml/ModelInfoTest.kt`, `data/UpdateFlowTest.kt`

**Modify**
- `core/Transcript.kt` (+`completeWord`)
- `core/VoicePicker.kt` (+`labels`)
- `speech/Speaker.kt` (voice labels)
- `data/ModelUpdater.kt` (progress, cancel, force, static-only)
- `data/ModelRepository.kt` (passthrough, `lastCheckMs`, `currentInfo`)
- `fragment/CameraFragment.kt`
- `fragment/OnboardingFragment.kt`
- `res/layout/fragment_camera.xml` (rewrite)
- `res/navigation/nav_graph.xml`
- `res/values/colors.xml`, `styles.xml`, `strings.xml`
- Tests: `TranscriptTest.kt`, `VoicePickerTest.kt`, `data/ModelUpdaterTest.kt`

**Delete**
- `fragment/PermissionsFragment.kt`
- `res/layout/fragment_permissions.xml`
- `res/layout/dialog_settings.xml`

All paths below are relative to `android/` unless they start with `docs/`.

---

### Task 1: Translator status (no hand / holding / unsure / recording / added motion)

**Files:**
- Create: `app/src/main/java/ph/senya/app/core/StatusTracker.kt`
- Test: `app/src/test/java/ph/senya/app/core/StatusTrackerTest.kt`

**Interfaces:**
- Consumes: `FrameOutput(staticGuess: Prediction?, moving: Boolean, motionGuess: Prediction?, events: List<StabilizerEvent>)` and `Prediction(label, confidence)` from `core/TranslatorEngine.kt` and `core/Prediction.kt`.
- Produces: `sealed class TranslatorStatus { object NoHand; data class Holding(label: String, confidence: Float); data class Unsure(confidence: Float); object Recording; data class AddedMotion(label: String, confidence: Float) }`, and `class StatusTracker(minConfidence = 0.7f, unsureAfterMs = 300L, motionShownMs = 1000L) { fun onFrame(tMs: Long, handPresent: Boolean, out: FrameOutput): TranslatorStatus }`.

- [ ] **Step 1: Write the failing test**

```kotlin
package ph.senya.app.core

import org.junit.Assert.assertEquals
import org.junit.Test

class StatusTrackerTest {
    private fun out(
        guess: Prediction? = null,
        moving: Boolean = false,
        motion: Prediction? = null,
        events: List<StabilizerEvent> = emptyList(),
    ) = FrameOutput(guess, moving, motion, events)

    private val a = Prediction("A", 0.9f)
    private val weak = Prediction("B", 0.42f)

    @Test
    fun noHand() {
        assertEquals(TranslatorStatus.NoHand, StatusTracker().onFrame(0, false, out()))
    }

    @Test
    fun confidentLetterIsHolding() {
        assertEquals(TranslatorStatus.Holding("A", 0.9f), StatusTracker().onFrame(0, true, out(a)))
    }

    @Test
    fun briefLowConfidenceKeepsPreviousStatus() {
        val t = StatusTracker()
        t.onFrame(0, true, out(a))
        assertEquals(TranslatorStatus.Holding("A", 0.9f), t.onFrame(33, true, out(weak)))
        assertEquals(TranslatorStatus.Holding("A", 0.9f), t.onFrame(300, true, out(weak)))
        assertEquals(TranslatorStatus.Unsure(0.42f), t.onFrame(333, true, out(weak)))
    }

    @Test
    fun goodFrameRestartsUnsureClock() {
        val t = StatusTracker()
        t.onFrame(0, true, out(weak))
        t.onFrame(200, true, out(a))
        assertEquals(TranslatorStatus.Holding("A", 0.9f), t.onFrame(400, true, out(weak)))
        assertEquals(TranslatorStatus.Unsure(0.42f), t.onFrame(700, true, out(weak)))
    }

    @Test
    fun handWithoutStaticGuessBecomesUnsure() {
        val t = StatusTracker()
        t.onFrame(0, true, out(null))
        assertEquals(TranslatorStatus.Unsure(0f), t.onFrame(300, true, out(null)))
    }

    @Test
    fun movingIsRecording() {
        assertEquals(TranslatorStatus.Recording, StatusTracker().onFrame(0, true, out(a, moving = true)))
    }

    @Test
    fun addedMotionLetterStaysOneSecond() {
        val t = StatusTracker()
        val j = Prediction("J", 0.88f)
        assertEquals(TranslatorStatus.AddedMotion("J", 0.88f),
            t.onFrame(1000, true, out(motion = j, events = listOf(StabilizerEvent.Letter("J")))))
        assertEquals(TranslatorStatus.AddedMotion("J", 0.88f), t.onFrame(1500, false, out()))
        assertEquals(TranslatorStatus.NoHand, t.onFrame(2000, false, out()))
    }

    @Test
    fun replaceLastCountsAsAdded() {
        val j = Prediction("J", 0.8f)
        assertEquals(TranslatorStatus.AddedMotion("J", 0.8f),
            StatusTracker().onFrame(0, true, out(motion = j, events = listOf(StabilizerEvent.ReplaceLast("J")))))
    }

    @Test
    fun rejectedMotionIsNotShown() {
        val none = Prediction(NONE_LABEL, 0.9f)
        assertEquals(TranslatorStatus.Holding("A", 0.9f), StatusTracker().onFrame(0, true, out(a, motion = none)))
    }

    @Test
    fun staticCommitDuringMotionGuessIsNotAMotionLetter() {
        val j = Prediction("J", 0.9f)
        assertEquals(TranslatorStatus.Holding("A", 0.9f),
            StatusTracker().onFrame(0, true, out(a, motion = j, events = listOf(StabilizerEvent.Letter("A")))))
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./gradlew :app:testDebugUnitTest --tests 'ph.senya.app.core.StatusTrackerTest'`
Expected: compilation FAILS with "Unresolved reference: StatusTracker".

- [ ] **Step 3: Write the implementation**

```kotlin
package ph.senya.app.core

/** What the translator screen tells the signer about the current frame (M2 mockup). */
sealed class TranslatorStatus {
    object NoHand : TranslatorStatus() {
        override fun toString() = "NoHand"
    }
    /** A static letter clear enough to be added if the signer holds it. */
    data class Holding(val label: String, val confidence: Float) : TranslatorStatus()
    /** A hand is visible but no letter clears the commit threshold, so nothing will be added. */
    data class Unsure(val confidence: Float) : TranslatorStatus()
    object Recording : TranslatorStatus() {
        override fun toString() = "Recording"
    }
    /** A motion letter (J, Z) was just added; kept on screen briefly so the signer sees it. */
    data class AddedMotion(val label: String, val confidence: Float) : TranslatorStatus()
}

/** Turns per-frame engine output into a [TranslatorStatus] that doesn't flicker. No Android imports. */
class StatusTracker(
    private val minConfidence: Float = 0.7f,
    /** Low confidence shows "Not sure" only after this long, so single bad frames between good ones don't. */
    private val unsureAfterMs: Long = 300,
    private val motionShownMs: Long = 1000,
) {
    private var last: TranslatorStatus = TranslatorStatus.NoHand
    private var unsureSinceMs: Long? = null
    private var motion: TranslatorStatus.AddedMotion? = null
    private var motionUntilMs = 0L

    fun onFrame(tMs: Long, handPresent: Boolean, out: FrameOutput): TranslatorStatus {
        val motionGuess = out.motionGuess
        if (motionGuess != null && out.events.any { it.committedLabel() == motionGuess.label }) {
            motion = TranslatorStatus.AddedMotion(motionGuess.label, motionGuess.confidence)
            motionUntilMs = tMs + motionShownMs
        }
        val shown = motion
        if (shown != null && tMs < motionUntilMs) return remember(shown)
        motion = null
        if (!handPresent) return remember(TranslatorStatus.NoHand)
        if (out.moving) return remember(TranslatorStatus.Recording)
        val guess = out.staticGuess
        if (guess != null && guess.confidence >= minConfidence) {
            return remember(TranslatorStatus.Holding(guess.label, guess.confidence))
        }
        val since = unsureSinceMs ?: tMs.also { unsureSinceMs = it }
        if (tMs - since < unsureAfterMs) return last
        return remember(TranslatorStatus.Unsure(guess?.confidence ?: 0f), keepUnsureClock = true)
    }

    private fun remember(status: TranslatorStatus, keepUnsureClock: Boolean = false): TranslatorStatus {
        if (!keepUnsureClock) unsureSinceMs = null
        last = status
        return status
    }

    private fun StabilizerEvent.committedLabel(): String? = when (this) {
        is StabilizerEvent.Letter -> label
        is StabilizerEvent.ReplaceLast -> label
        is StabilizerEvent.Space -> null
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./gradlew :app:testDebugUnitTest --tests 'ph.senya.app.core.StatusTrackerTest'`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/main/java/ph/senya/app/core/StatusTracker.kt app/src/test/java/ph/senya/app/core/StatusTrackerTest.kt
git commit -m "android: translator status for the M2 screen states

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Word suggestions and completing a word

**Files:**
- Create: `app/src/main/java/ph/senya/app/core/WordSuggester.kt`
- Create: `app/src/main/assets/words.txt`
- Modify: `app/src/main/java/ph/senya/app/core/Transcript.kt` (add `completeWord`)
- Test: `app/src/test/java/ph/senya/app/core/WordSuggesterTest.kt`
- Test: `app/src/test/java/ph/senya/app/core/TranscriptTest.kt` (add tests)

**Interfaces:**
- Produces: `class WordSuggester(lines: List<String>) { fun suggest(text: String, max: Int = 3): List<String> }` and `Transcript.completeWord(word: String)`.

- [ ] **Step 1: Write the failing tests**

`WordSuggesterTest.kt`:

```kotlin
package ph.senya.app.core

import org.junit.Assert.assertEquals
import org.junit.Test

class WordSuggesterTest {
    private val s = WordSuggester(listOf(
        "# comment", "", "MAGANDA", "magandang umaga", "AKO", "JAZZ", "JAZZY", "JAZZ BAND", "MAGANDA",
    ))

    @Test
    fun partialWordFirstThenCompletionsInListOrder() {
        assertEquals(listOf("MAG", "MAGANDA", "MAGANDANG UMAGA"), s.suggest("MAG"))
    }

    @Test
    fun exactWordIsNotRepeated() {
        assertEquals(listOf("JAZZ", "JAZZY", "JAZZ BAND"), s.suggest("JAZZ"))
    }

    @Test
    fun onlyTheLastWordCounts() {
        assertEquals(listOf("A", "AKO"), s.suggest("MAGANDA A"))
    }

    @Test
    fun lowercaseInputIsUppercased() {
        assertEquals(listOf("AK", "AKO"), s.suggest("ak"))
    }

    @Test
    fun noSuggestionsWithoutPartialWord() {
        assertEquals(emptyList<String>(), s.suggest(""))
        assertEquals(emptyList<String>(), s.suggest("AKO "))
    }

    @Test
    fun unknownWordStillOffersItself() {
        assertEquals(listOf("XQ"), s.suggest("XQ"))
    }

    @Test
    fun respectsMax() {
        assertEquals(listOf("MAG", "MAGANDA"), s.suggest("MAG", max = 2))
    }
}
```

Append to `TranscriptTest.kt`, inside the class:

```kotlin
    @Test
    fun completeWordReplacesPartialWordAndAddsSpace() {
        val t = Transcript()
        listOf("A", "K", "O").forEach { t.apply(StabilizerEvent.Letter(it)) }
        t.apply(StabilizerEvent.Space)
        listOf("M", "A", "G").forEach { t.apply(StabilizerEvent.Letter(it)) }
        t.completeWord("MAGANDA")
        assertEquals("AKO MAGANDA ", t.text)
        assertTrue(t.endsWithSpace)
        t.backspace()
        t.backspace()
        assertEquals("AKO MAGAND", t.text)
    }

    @Test
    fun completeWordOnEmptyTranscript() {
        val t = Transcript()
        t.completeWord("JAZZ BAND")
        assertEquals("JAZZ BAND ", t.text)
    }
```

- [ ] **Step 2: Run them to verify they fail**

Run: `./gradlew :app:testDebugUnitTest --tests 'ph.senya.app.core.WordSuggesterTest' --tests 'ph.senya.app.core.TranscriptTest'`
Expected: compilation FAILS ("Unresolved reference: WordSuggester", "completeWord").

- [ ] **Step 3: Write the implementation**

`WordSuggester.kt`:

```kotlin
package ph.senya.app.core

import java.util.Locale

/** Suggestion chips (M2 mockup): the word being spelled, then completions from a list ordered most common first. No Android imports. */
class WordSuggester(lines: List<String>) {
    private val words = lines.map { it.trim().uppercase(Locale.ROOT) }
        .filter { it.isNotEmpty() && !it.startsWith("#") }
        .distinct()

    /** Suggestions for the letters after the last space in [text]; empty when no word is being spelled. */
    fun suggest(text: String, max: Int = 3): List<String> {
        val prefix = text.substringAfterLast(' ').uppercase(Locale.ROOT)
        if (prefix.isEmpty() || max <= 0) return emptyList()
        return (listOf(prefix) + words.filter { it.startsWith(prefix) && it != prefix }).take(max)
    }
}
```

Add to `Transcript.kt`, after `clear()`:

```kotlin
    /** Replaces the word being spelled with [word] and ends it with a space (tapping a suggestion chip). */
    fun completeWord(word: String) {
        while (tokens.isNotEmpty() && tokens.last() != " ") tokens.removeAt(tokens.lastIndex)
        word.forEach { tokens += it.toString() }
        tokens += " "
    }
```

Create `app/src/main/assets/words.txt` with exactly this content:

```
# Suggestion chips: one entry per line, most common first. Filipino, then English.
# Entries may contain spaces. Lines starting with # are ignored.
AKO
IKAW
SIYA
KAMI
TAYO
KAYO
SILA
ITO
IYAN
DITO
DOON
OO
OPO
HINDI
PO
SALAMAT
MARAMING SALAMAT
WALANG ANUMAN
ANO
SINO
SAAN
KAILAN
BAKIT
PAANO
ILAN
MAGANDA
MAGANDANG UMAGA
MAGANDANG HAPON
MAGANDANG GABI
KUMUSTA
MABUTI
MAHAL
MAHAL KITA
PAALAM
INGAT
TULONG
TULUNGAN
TUBIG
PAGKAIN
KAIN
KUMAIN
INOM
GUTOM
UHAW
BAHAY
PAMILYA
NANAY
TATAY
ANAK
KAPATID
LOLA
LOLO
KAIBIGAN
GURO
PAARALAN
TRABAHO
PERA
ARAW
GABI
UMAGA
HAPON
NGAYON
BUKAS
KAHAPON
MAMAYA
GUSTO
AYAW
KAILANGAN
MERON
WALA
PWEDE
SANDALI
TAMA
MALI
MASAYA
MALUNGKOT
PAGOD
MASAKIT
SAKIT
DOKTOR
OSPITAL
BANYO
TULOG
LAKAD
UPO
PUMUNTA
BALIK
UWI
TINGNAN
ULITIN
DAHAN DAHAN
MABILIS
MALAKI
MALIIT
MARAMI
KONTI
LAHAT
ISA
DALAWA
TATLO
APAT
LIMA
ANIM
PITO
WALO
SIYAM
SAMPU
PILIPINAS
PILIPINO
BINGI
SENYAS
PANGALAN
YES
NO
HELLO
HI
THANK YOU
PLEASE
SORRY
HELP
WATER
FOOD
NAME
MY
YOUR
YOU
WE
LOVE
GOOD
GOOD MORNING
GOOD NIGHT
BATHROOM
DEAF
SIGN
FRIEND
FAMILY
SCHOOL
WORK
HOME
WAIT
AGAIN
SLOW
STOP
COME
WHERE
WHAT
WHO
WHEN
WHY
HOW
OKAY
JAZZ
JAZZY
JAZZ BAND
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `./gradlew :app:testDebugUnitTest --tests 'ph.senya.app.core.WordSuggesterTest' --tests 'ph.senya.app.core.TranscriptTest'`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/main/java/ph/senya/app/core/WordSuggester.kt app/src/main/java/ph/senya/app/core/Transcript.kt app/src/main/assets/words.txt app/src/test/java/ph/senya/app/core/WordSuggesterTest.kt app/src/test/java/ph/senya/app/core/TranscriptTest.kt
git commit -m "android: offline word suggestions for the transcript

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: ModelUpdater with progress, cancel, force, and static-only fallback

**Files:**
- Modify: `app/src/main/java/ph/senya/app/data/ModelUpdater.kt` (rewrite of `httpGet`, `check`, `checkLocked`, `filesFor`)
- Modify: `app/src/main/java/ph/senya/app/data/ModelRepository.kt` (`checkForUpdate` passthrough, `lastCheckMs`)
- Modify: `app/src/main/java/ph/senya/app/fragment/CameraFragment.kt` (the `when (result)` in `checkForUpdate` gets a `Cancelled` branch and a `motionError` toast)
- Test: `app/src/test/java/ph/senya/app/data/ModelUpdaterTest.kt`

**Interfaces:**
- Consumes: `ModelBundle.load`, `ModelFiles`, `DirModelSource`, `LatestModel` (unchanged).
- Produces:
  - `fun httpGet(url: URL, onBytes: (read: Long, total: Long) -> Unit = { _, _ -> }): ByteArray`
  - `class CancelledException : IOException`
  - `ModelUpdater(modelsDir: File, modelFactory: (ByteArray) -> ProbabilityModel, fetch: (URL, (Long, Long) -> Unit) -> ByteArray = ::httpGet)`
  - `enum class ModelUpdater.Part { PENDING, CHECKING, OK, FAILED }`
  - `sealed class ModelUpdater.Step { object Checking; data class Downloading(version: Int, static: Float, motion: Float?); data class Verifying(version: Int, static: Part, motion: Part?) }`
  - `sealed class ModelUpdater.Result { data class Updated(bundle: ModelBundle, motionError: String? = null); object UpToDate; object NoModelPublished; object Cancelled; data class Failed(message: String) }`
  - `fun check(baseUrl: String, localVersion: Int, force: Boolean = false, onStep: (Step) -> Unit = {}, isCancelled: () -> Boolean = { false }): Result`
  - `ModelRepository.checkForUpdate(force: Boolean = false, onStep: (ModelUpdater.Step) -> Unit = {}, isCancelled: () -> Boolean = { false }): ModelUpdater.Result`
  - `ModelRepository.lastCheckMs: Long`

- [ ] **Step 1: Update the existing tests and add new failing tests**

In `ModelUpdaterTest.kt`:

(a) Change the `publish` helper so it accepts a motion golden and a motion sha:

```kotlin
    private fun publish(
        v: Int,
        withMotion: Boolean = true,
        sha: String? = null,
        golden: String = TestModels.staticGolden(),
        motionGolden: String = TestModels.motionGolden(),
        motionSha: String? = null,
    ) {
        val dir = TestModels.writeFolder(File(root, "models/v$v"), withMotion = withMotion, golden = golden, motionGolden = motionGolden)
        val modelSha = sha ?: sha256Hex(File(dir, ModelFiles.MODEL).readBytes())
        val motion = if (!withMotion) "null" else """{"model_url": "/models/v$v/motion.tflite",
            "labels_url": "/models/v$v/motion_labels.json", "config_url": "/models/v$v/motion_config.json",
            "sha256": "${motionSha ?: sha256Hex(File(dir, ModelFiles.MOTION_MODEL).readBytes())}"}"""
        File(root, "api/model").mkdirs()
        File(root, "api/model/latest").writeText("""{"version": $v, "model_url": "/models/v$v/model.tflite",
            "labels_url": "/models/v$v/labels.json", "sha256": "$modelSha", "motion": $motion}""")
    }
```

(b) In `concurrentChecksAreSerialized`, change both fetch lambdas to the two-argument form:

```kotlin
        val first = ModelUpdater(modelsDir, TestModels.factory) { url, onBytes ->
            if (url.path.endsWith("model.tflite")) { firstStarted.countDown(); releaseFirst.await() }
            ph.senya.app.data.httpGet(url, onBytes)
        }
        val second = ModelUpdater(modelsDir, TestModels.factory) { url, onBytes ->
            secondFetches.incrementAndGet()
            ph.senya.app.data.httpGet(url, onBytes)
        }
```

(c) In `staticOnlyVersion`, add `assertNull((updater.check(server.baseUrl, 0) as? ModelUpdater.Result.Updated)?.motionError)`. Simpler: replace the test body with:

```kotlin
        publish(4, withMotion = false)
        val result = updater.check(server.baseUrl + "/", 0) as ModelUpdater.Result.Updated
        assertNull(result.bundle.motion)
        assertNull(result.motionError)
```

(d) Add these tests:

```kotlin
    @Test
    fun httpGetReportsProgress() {
        File(root, "big.bin").writeBytes(ByteArray(100_000) { it.toByte() })
        val seen = mutableListOf<Pair<Long, Long>>()
        val bytes = httpGet(java.net.URL(server.baseUrl + "/big.bin")) { read, total -> seen += read to total }
        assertEquals(100_000, bytes.size)
        assertEquals(100_000L to 100_000L, seen.last())
    }

    @Test
    fun reportsSteps() {
        publish(3)
        val steps = mutableListOf<ModelUpdater.Step>()
        updater.check(server.baseUrl, 0, onStep = { steps += it })
        assertEquals(ModelUpdater.Step.Checking, steps.first())
        assertTrue(steps.contains(ModelUpdater.Step.Downloading(3, 1f, 1f)))
        assertEquals(ModelUpdater.Step.Verifying(3, ModelUpdater.Part.OK, ModelUpdater.Part.OK), steps.last())
    }

    @Test
    fun motionChecksumMismatchInstallsStaticOnly() {
        publish(3, motionSha = "0".repeat(64))
        val result = updater.check(server.baseUrl, 0) as ModelUpdater.Result.Updated
        assertNull(result.bundle.motion)
        assertTrue(result.motionError!!.contains("checksum"))
        assertTrue(File(updater.installedDir(3), ModelFiles.MODEL).isFile)
        assertFalse(File(updater.installedDir(3), ModelFiles.MOTION_MODEL).exists())
    }

    @Test
    fun missingMotionFileInstallsStaticOnly() {
        publish(3)
        File(root, "models/v3/motion_labels.json").delete()
        val result = updater.check(server.baseUrl, 0) as ModelUpdater.Result.Updated
        assertNull(result.bundle.motion)
        assertTrue(result.motionError!!.contains("download failed"))
        assertFalse(File(updater.installedDir(3), ModelFiles.MOTION_MODEL).exists())
    }

    @Test
    fun motionGoldenFailureInstallsStaticOnly() {
        publish(3, motionGolden = TestModels.motionGolden(listOf(TestModels.frames(0.2f, 0.8f) to "Z")))
        val result = updater.check(server.baseUrl, 0) as ModelUpdater.Result.Updated
        assertNull(result.bundle.motion)
        assertTrue(result.motionError!!.contains("motion_golden"))
        assertFalse(File(updater.installedDir(3), ModelFiles.MOTION_MODEL).exists())
    }

    @Test
    fun forceReinstallsSameVersion() {
        publish(3)
        assertTrue(updater.check(server.baseUrl, localVersion = 3, force = true) is ModelUpdater.Result.Updated)
    }

    @Test
    fun cancelBeforeStartInstallsNothing() {
        publish(3)
        assertEquals(ModelUpdater.Result.Cancelled, updater.check(server.baseUrl, 0, isCancelled = { true }))
        assertFalse(updater.installedDir(3).exists())
    }

    @Test
    fun cancelDuringDownloadInstallsNothing() {
        publish(3)
        var cancel = false
        val result = updater.check(server.baseUrl, 0,
            onStep = { if (it is ModelUpdater.Step.Downloading && it.static > 0f) cancel = true },
            isCancelled = { cancel })
        assertEquals(ModelUpdater.Result.Cancelled, result)
        assertFalse(updater.installedDir(3).exists())
        assertTrue(leftovers().isEmpty())
    }

    @Test
    fun cancelAfterVerifyInstallsNothing() {
        publish(3)
        var cancel = false
        val result = updater.check(server.baseUrl, 0,
            onStep = { if (it == ModelUpdater.Step.Verifying(3, ModelUpdater.Part.OK, ModelUpdater.Part.OK)) cancel = true },
            isCancelled = { cancel })
        assertEquals(ModelUpdater.Result.Cancelled, result)
        assertFalse(updater.installedDir(3).exists())
        assertTrue(leftovers().isEmpty())
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `./gradlew :app:testDebugUnitTest --tests 'ph.senya.app.data.ModelUpdaterTest'`
Expected: compilation FAILS ("Unresolved reference: Step", "Cancelled", "motionError", or a lambda arity mismatch).

- [ ] **Step 3: Write the implementation**

Replace everything in `ModelUpdater.kt` from `class HttpStatusException` down to the end of the file with:

```kotlin
class HttpStatusException(val code: Int) : IOException("HTTP $code")

/** Thrown from inside a download when the user cancels; never escapes [ModelUpdater.check]. */
class CancelledException : IOException("cancelled")

/** [onBytes] gets (bytes read so far, Content-Length or -1) after every chunk, and may throw to stop the download. */
fun httpGet(url: URL, onBytes: (read: Long, total: Long) -> Unit = { _, _ -> }): ByteArray {
    val conn = url.openConnection() as HttpURLConnection
    conn.connectTimeout = 3000
    // Render's free tier accepts the connection at once but can take ~50 s to answer while it wakes up
    conn.readTimeout = 60000
    try {
        val code = conn.responseCode
        if (code != 200) throw HttpStatusException(code)
        val total = conn.contentLengthLong
        val out = ByteArrayOutputStream(if (total in 1..Int.MAX_VALUE) total.toInt() else 8192)
        conn.inputStream.use { input ->
            val buffer = ByteArray(16 * 1024)
            var read = 0L
            while (true) {
                val n = input.read(buffer)
                if (n < 0) break
                out.write(buffer, 0, n)
                read += n
                onBytes(read, total)
            }
        }
        return out.toByteArray()
    } finally {
        conn.disconnect()
    }
}

fun sha256Hex(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

/** Downloads, verifies, and installs a published model version (spec §5.2 ModelRepository). No Android imports. */
class ModelUpdater(
    private val modelsDir: File,
    private val modelFactory: (ByteArray) -> ProbabilityModel,
    private val fetch: (URL, (Long, Long) -> Unit) -> ByteArray = ::httpGet,
) {
    enum class Part { PENDING, CHECKING, OK, FAILED }

    /** Progress for the model update screen (M3 mockup), reported on the checking thread. */
    sealed class Step {
        object Checking : Step() {
            override fun toString() = "Checking"
        }
        /** Fractions from 0 to 1; [motion] is null when the version has no motion model. */
        data class Downloading(val version: Int, val static: Float, val motion: Float?) : Step()
        data class Verifying(val version: Int, val static: Part, val motion: Part?) : Step()
    }

    sealed class Result {
        /** [motionError] is set when the version's motion model couldn't be used: only the static model was installed. */
        data class Updated(val bundle: ModelBundle, val motionError: String? = null) : Result()
        object UpToDate : Result()
        object NoModelPublished : Result()
        object Cancelled : Result()
        data class Failed(val message: String) : Result()
    }

    fun installedDir(version: Int) = File(modelsDir, "v$version")

    /**
     * One check at a time per process: rotating the phone starts a second check while the first may still be
     * downloading into the same folder. Never throws; every failure is a [Result.Failed].
     * [force] downloads the published version even when it's the installed one ("Retry motion model").
     * [isCancelled] is polled between files and chunks; once it returns true, nothing is installed.
     */
    fun check(
        baseUrl: String,
        localVersion: Int,
        force: Boolean = false,
        onStep: (Step) -> Unit = {},
        isCancelled: () -> Boolean = { false },
    ): Result = synchronized(LOCK) {
        try {
            checkLocked(baseUrl, localVersion, force, onStep, isCancelled)
        } catch (e: RuntimeException) {
            Result.Failed("unexpected error (${e.message})")
        }
    }

    private fun checkLocked(
        baseUrl: String,
        localVersion: Int,
        force: Boolean,
        onStep: (Step) -> Unit,
        isCancelled: () -> Boolean,
    ): Result {
        val base = try {
            URL(baseUrl.trim().trimEnd('/') + "/")
        } catch (e: MalformedURLException) {
            return Result.Failed("bad server URL: $baseUrl")
        }
        if (base.protocol != "http" && base.protocol != "https") return Result.Failed("bad server URL: $baseUrl")
        if (isCancelled()) return Result.Cancelled
        onStep(Step.Checking)
        val latest = try {
            LatestModel.parse(String(fetch(URL(base, "api/model/latest")) { _, _ -> stopIf(isCancelled) }, Charsets.UTF_8))
        } catch (e: CancelledException) {
            return Result.Cancelled
        } catch (e: HttpStatusException) {
            return if (e.code == 404) Result.NoModelPublished else Result.Failed("server error ${e.code}")
        } catch (e: IOException) {
            return Result.Failed("can't reach server (${e.message})")
        } catch (e: JSONException) {
            return Result.Failed("bad response from server")
        }
        if (isCancelled()) return Result.Cancelled
        if (latest.version == localVersion && !force) return Result.UpToDate

        val v = latest.version
        val tmp = File(modelsDir, "tmp-v$v")
        try {
            tmp.deleteRecursively()
            if (!tmp.mkdirs()) return Result.Failed("can't write ${tmp.path}")
            var staticDone = 0f
            var motionDone: Float? = if (latest.motion != null) 0f else null
            onStep(Step.Downloading(v, staticDone, motionDone))
            download(base, tmp, staticFiles(latest), isCancelled) {
                staticDone = it
                onStep(Step.Downloading(v, staticDone, motionDone))
            }
            var motionError: String? = null
            val motionFiles = motionFiles(latest)
            if (motionFiles.isNotEmpty()) {
                try {
                    download(base, tmp, motionFiles, isCancelled) {
                        motionDone = it
                        onStep(Step.Downloading(v, staticDone, motionDone))
                    }
                } catch (e: CancelledException) {
                    throw e
                } catch (e: IOException) {
                    motionError = "download failed (${e.message})"
                }
            }

            val motionPart = if (latest.motion == null) null else Part.PENDING
            onStep(Step.Verifying(v, Part.CHECKING, motionPart))
            checkSha(tmp, ModelFiles.MODEL, latest.sha256)?.let {
                onStep(Step.Verifying(v, Part.FAILED, motionPart))
                return Result.Failed(it)
            }
            onStep(Step.Verifying(v, Part.OK, motionPart?.let { Part.CHECKING }))
            val motion = latest.motion
            if (motion != null && motionError == null) motionError = checkSha(tmp, ModelFiles.MOTION_MODEL, motion.sha256)
            if (motionError != null) deleteMotionFiles(tmp)
            val bundle = try {
                ModelBundle.load(v, DirModelSource(tmp), modelFactory)
            } catch (e: ModelLoadException) {
                onStep(Step.Verifying(v, Part.FAILED, motionPart))
                return Result.Failed("model v$v rejected: ${e.message}")
            }
            if (motion != null && bundle.motion == null && motionError == null) {
                motionError = bundle.warning ?: "motion model unusable"
            }
            // The installed folder holds only what the bundle uses, so Settings describes it correctly
            if (bundle.motion == null) deleteMotionFiles(tmp)
            onStep(Step.Verifying(v, Part.OK, motionPart?.let { if (motionError == null) Part.OK else Part.FAILED }))
            if (isCancelled()) {
                bundle.close()
                return Result.Cancelled
            }
            val dest = installedDir(v)
            dest.deleteRecursively()
            if (!tmp.renameTo(dest)) {
                bundle.close()
                return Result.Failed("can't install model v$v")
            }
            return Result.Updated(bundle, motionError)
        } catch (e: CancelledException) {
            return Result.Cancelled
        } catch (e: IOException) {
            return Result.Failed("download failed (${e.message})")
        } finally {
            tmp.deleteRecursively()
        }
    }

    /** Fetches [files] into [dir], reporting the fraction done; each file counts equally. */
    private fun download(
        base: URL,
        dir: File,
        files: List<Pair<String, String>>,
        isCancelled: () -> Boolean,
        onFraction: (Float) -> Unit,
    ) {
        files.forEachIndexed { i, (name, path) ->
            stopIf(isCancelled)
            val bytes = fetch(URL(base, path)) { read, total ->
                stopIf(isCancelled)
                if (total > 0) onFraction((i + read.toFloat() / total) / files.size)
            }
            File(dir, name).writeBytes(bytes)
            onFraction((i + 1).toFloat() / files.size)
        }
    }

    private fun stopIf(isCancelled: () -> Boolean) {
        if (isCancelled()) throw CancelledException()
    }

    private fun staticFiles(latest: LatestModel) = listOf(
        ModelFiles.MODEL to latest.modelUrl,
        ModelFiles.LABELS to latest.labelsUrl,
        ModelFiles.GOLDEN to sibling(latest.modelUrl, ModelFiles.GOLDEN),
    )

    private fun motionFiles(latest: LatestModel): List<Pair<String, String>> = latest.motion?.let { m ->
        listOf(
            ModelFiles.MOTION_MODEL to m.modelUrl,
            ModelFiles.MOTION_LABELS to m.labelsUrl,
            ModelFiles.MOTION_CONFIG to m.configUrl,
            ModelFiles.MOTION_GOLDEN to sibling(m.modelUrl, ModelFiles.MOTION_GOLDEN),
        )
    }.orEmpty()

    private fun deleteMotionFiles(dir: File) = listOf(
        ModelFiles.MOTION_MODEL, ModelFiles.MOTION_LABELS, ModelFiles.MOTION_CONFIG, ModelFiles.MOTION_GOLDEN,
    ).forEach { File(dir, it).delete() }

    /** Golden files live next to the model (plan clarification 6). */
    private fun sibling(url: String, name: String) = url.substringBeforeLast('/') + "/" + name

    private fun checkSha(dir: File, name: String, expected: String): String? {
        val actual = sha256Hex(File(dir, name).readBytes())
        return if (actual.equals(expected, ignoreCase = true)) null else "checksum mismatch for $name"
    }

    private companion object {
        val LOCK = Any()
    }
}
```

Add `import java.io.ByteArrayOutputStream` to the imports.

In `ModelRepository.kt`, replace `checkForUpdate` and add `lastCheckMs` and a key:

```kotlin
    /** Blocks on the network; call off the main thread. See [ModelUpdater.check] for [force], [onStep] and [isCancelled]. */
    fun checkForUpdate(
        force: Boolean = false,
        onStep: (ModelUpdater.Step) -> Unit = {},
        isCancelled: () -> Boolean = { false },
    ): ModelUpdater.Result = updater.check(serverUrl, installedVersion, force, onStep, isCancelled).also {
        if (it is ModelUpdater.Result.Updated) prefs.edit().putInt(KEY_VERSION, it.bundle.version).apply()
        if (it !is ModelUpdater.Result.Failed && it !is ModelUpdater.Result.Cancelled) {
            prefs.edit().putLong(KEY_LAST_CHECK, System.currentTimeMillis()).apply()
        }
    }

    /** When the server last answered an update check, or 0 if it never has. */
    val lastCheckMs: Long get() = prefs.getLong(KEY_LAST_CHECK, 0L)
```

and in the companion: `private const val KEY_LAST_CHECK = "last_update_check_ms"`.

In `CameraFragment.checkForUpdate`, change the `Updated` branch and add the `Cancelled` branch:

```kotlin
            is ModelUpdater.Result.Updated -> {
                applyBundle(result.bundle)
                toast("Updated to model v${result.bundle.version}")
                result.motionError?.let { toast("J and Z are unavailable: $it") }
            }
            ...
            is ModelUpdater.Result.Cancelled -> {}
```

- [ ] **Step 4: Run all unit tests**

Run: `./gradlew :app:testDebugUnitTest`
Expected: PASS (every existing test plus the 9 new ones). Then run `./gradlew :app:assembleDebug`. Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Commit**

```bash
git add app/src/main/java/ph/senya/app/data app/src/main/java/ph/senya/app/fragment/CameraFragment.kt app/src/test/java/ph/senya/app/data/ModelUpdaterTest.kt
git commit -m "android: model updates report progress, can be cancelled, and fall back to static-only

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: ModelInfo and the update screen state machine

**Files:**
- Create: `app/src/main/java/ph/senya/app/ml/ModelInfo.kt`
- Create: `app/src/main/java/ph/senya/app/data/UpdateFlow.kt`
- Modify: `app/src/main/java/ph/senya/app/data/ModelRepository.kt` (+`currentInfo()`)
- Test: `app/src/test/java/ph/senya/app/ml/ModelInfoTest.kt`
- Test: `app/src/test/java/ph/senya/app/data/UpdateFlowTest.kt`

**Interfaces:**
- Consumes: `ModelUpdater.Step`, `ModelUpdater.Part`, and `ModelUpdater.Result` from Task 3; `ModelBundle.static.labels`, `ModelBundle.motion?.labels`; `NONE_LABEL`.
- Produces:
  - `data class ModelInfo(version: Int, staticLabels: List<String>, motionLabels: List<String>)` with `hasMotion: Boolean`, `typeText: String`, `ModelInfo.of(bundle)`, and `ModelInfo.read(version, source): ModelInfo?`.
  - `sealed class UpdateScreenState { abstract val current: ModelInfo? }` with the subclasses `Checking`, `Downloading(version, staticPercent, motionPercent: Int?)`, `Verifying(version, static: Part, motion: Part?)`, `Updated(from, to)`, `RolledBack(from, to)`, `StaticOnly(reason)`, `UpToDate`, `NoModelPublished`, `Failed(reason)`, and `Cancelled`.
  - `class UpdateFlow(check: (Boolean, (ModelUpdater.Step) -> Unit, () -> Boolean) -> ModelUpdater.Result, currentInfo: () -> ModelInfo?, publish: (UpdateScreenState) -> Unit)` with `fun run(force: Boolean = false)` and `fun cancel()`.
  - `ModelRepository.currentInfo(): ModelInfo?`

- [ ] **Step 1: Write the failing tests**

`ModelInfoTest.kt`:

```kotlin
package ph.senya.app.ml

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import ph.senya.app.testutil.TestModels
import java.io.File

class ModelInfoTest {
    @get:Rule val tmp = TemporaryFolder()

    @Test
    fun readsLabelsWithoutNone() {
        val info = ModelInfo.read(3, DirModelSource(TestModels.writeFolder(tmp.newFolder("v3"))))!!
        assertEquals(ModelInfo(3, listOf("A", "B"), listOf("J", "Z")), info)
        assertEquals("Static letters + J/Z", info.typeText)
    }

    @Test
    fun staticOnlyFolder() {
        val info = ModelInfo.read(4, DirModelSource(TestModels.writeFolder(tmp.newFolder("v4"), withMotion = false)))!!
        assertFalse(info.hasMotion)
        assertEquals("Static letters only", info.typeText)
    }

    @Test
    fun nullWithoutLabels() {
        val dir = TestModels.writeFolder(tmp.newFolder("v5"))
        File(dir, ModelFiles.LABELS).delete()
        assertNull(ModelInfo.read(5, DirModelSource(dir)))
    }

    @Test
    fun ofBundle() {
        val bundle = ModelBundle.load(6, DirModelSource(TestModels.writeFolder(tmp.newFolder("v6"))), TestModels.factory)
        assertEquals(ModelInfo(6, listOf("A", "B"), listOf("J", "Z")), bundle.use { ModelInfo.of(it) })
    }
}
```

`UpdateFlowTest.kt`:

```kotlin
package ph.senya.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import ph.senya.app.data.ModelUpdater.Part
import ph.senya.app.data.ModelUpdater.Result
import ph.senya.app.data.ModelUpdater.Step
import ph.senya.app.ml.DirModelSource
import ph.senya.app.ml.ModelBundle
import ph.senya.app.ml.ModelInfo
import ph.senya.app.ml.ProbabilityModel
import ph.senya.app.testutil.FakeModel
import ph.senya.app.testutil.TestModels

class UpdateFlowTest {
    @get:Rule val tmp = TemporaryFolder()
    private val made = mutableListOf<FakeModel>()
    private val factory: (ByteArray) -> ProbabilityModel = { bytes -> (TestModels.factory(bytes) as FakeModel).also { made += it } }
    private val v3 = ModelInfo(3, listOf("A", "B"), listOf("J", "Z"))
    private val states = mutableListOf<UpdateScreenState>()

    private fun bundle(v: Int, withMotion: Boolean = true) =
        ModelBundle.load(v, DirModelSource(TestModels.writeFolder(tmp.newFolder("v$v"), withMotion = withMotion)), factory)

    private fun flow(current: ModelInfo? = v3, check: (Boolean, (Step) -> Unit, () -> Boolean) -> Result) =
        UpdateFlow(check, { current }, { states += it })

    @Test
    fun stepsThenUpdated() {
        val b4 = bundle(4)
        flow { _, onStep, _ ->
            onStep(Step.Checking)
            onStep(Step.Downloading(4, 0.72f, 0.38f))
            onStep(Step.Verifying(4, Part.OK, Part.CHECKING))
            Result.Updated(b4)
        }.run()
        val v4 = ModelInfo(4, listOf("A", "B"), listOf("J", "Z"))
        assertEquals(listOf(
            UpdateScreenState.Checking(v3),
            UpdateScreenState.Downloading(v3, 4, 72, 38),
            UpdateScreenState.Verifying(v3, 4, Part.OK, Part.CHECKING),
            UpdateScreenState.Updated(v4, 3, 4),
        ), states)
    }

    @Test
    fun updatedClosesBundleAndReportsVersions() {
        val b4 = bundle(4)
        flow { _, _, _ -> Result.Updated(b4) }.run()
        assertTrue(made.isNotEmpty())
        assertTrue(made.all { it.closed })
    }

    @Test
    fun olderVersionIsRolledBack() {
        val b2 = bundle(2)
        flow { _, _, _ -> Result.Updated(b2) }.run()
        assertEquals(UpdateScreenState.RolledBack(ModelInfo(2, listOf("A", "B"), listOf("J", "Z")), 3, 2), states.last())
    }

    @Test
    fun motionErrorIsStaticOnly() {
        val b4 = bundle(4, withMotion = false)
        flow { _, _, _ -> Result.Updated(b4, "checksum mismatch for motion.tflite") }.run()
        assertEquals(UpdateScreenState.StaticOnly(ModelInfo(4, listOf("A", "B"), emptyList()), "checksum mismatch for motion.tflite"),
            states.last())
    }

    @Test
    fun failureKeepsCurrent() {
        flow { _, _, _ -> Result.Failed("can't reach server (timeout)") }.run()
        assertEquals(UpdateScreenState.Failed(v3, "can't reach server (timeout)"), states.last())
    }

    @Test
    fun upToDateAndNoModel() {
        flow { _, _, _ -> Result.UpToDate }.run()
        assertEquals(UpdateScreenState.UpToDate(v3), states.last())
        flow(current = null) { _, _, _ -> Result.NoModelPublished }.run()
        assertEquals(UpdateScreenState.NoModelPublished(null), states.last())
    }

    @Test
    fun cancelStopsStepsAndShowsCancelled() {
        lateinit var f: UpdateFlow
        f = flow { _, onStep, isCancelled ->
            onStep(Step.Checking)
            f.cancel()
            onStep(Step.Downloading(4, 0.5f, null))
            assertTrue(isCancelled())
            Result.Cancelled
        }
        f.run()
        assertFalse(states.any { it is UpdateScreenState.Downloading })
        assertEquals(UpdateScreenState.Cancelled(v3), states.last())
    }

    @Test
    fun forceIsPassedThroughAndRunResetsCancel() {
        var forced: Boolean? = null
        var cancelledAtStart: Boolean? = null
        val f = flow { force, _, isCancelled -> forced = force; cancelledAtStart = isCancelled(); Result.UpToDate }
        f.cancel()
        f.run(force = true)
        assertEquals(true, forced)
        assertEquals(false, cancelledAtStart)
    }
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `./gradlew :app:testDebugUnitTest --tests 'ph.senya.app.ml.ModelInfoTest' --tests 'ph.senya.app.data.UpdateFlowTest'`
Expected: compilation FAILS ("Unresolved reference: ModelInfo", "UpdateFlow").

- [ ] **Step 3: Write the implementation**

`ml/ModelInfo.kt`:

```kotlin
package ph.senya.app.ml

import ph.senya.app.core.NONE_LABEL

/** What Settings and the update screen say about a model, read from its label files without loading it. */
data class ModelInfo(val version: Int, val staticLabels: List<String>, val motionLabels: List<String>) {
    val hasMotion: Boolean get() = motionLabels.isNotEmpty()

    /** "Static letters + J/Z", or "Static letters only" for a version without usable motion letters. */
    val typeText: String
        get() = if (hasMotion) "Static letters + ${motionLabels.joinToString("/")}" else "Static letters only"

    companion object {
        fun of(bundle: ModelBundle) = ModelInfo(
            bundle.version,
            bundle.static.labels,
            bundle.motion?.labels.orEmpty().filter { it != NONE_LABEL },
        )

        /** Null when [source] has no readable labels.json. */
        fun read(version: Int, source: ModelSource): ModelInfo? {
            val static = labels(source, ModelFiles.LABELS) ?: return null
            val motion = if (source.read(ModelFiles.MOTION_MODEL) == null) emptyList()
                         else labels(source, ModelFiles.MOTION_LABELS).orEmpty()
            return ModelInfo(version, static, motion.filter { it != NONE_LABEL })
        }

        private fun labels(source: ModelSource, file: String): List<String>? =
            source.read(file)?.let { bytes -> runCatching { ModelJson.parseLabels(bytes, file) }.getOrNull() }
    }
}
```

`data/UpdateFlow.kt`:

```kotlin
package ph.senya.app.data

import ph.senya.app.ml.ModelInfo
import kotlin.math.roundToInt

/** What the model update screen shows (M3 mockup). [current] is the model in use while this state is shown. */
sealed class UpdateScreenState {
    abstract val current: ModelInfo?

    data class Checking(override val current: ModelInfo?) : UpdateScreenState()
    data class Downloading(
        override val current: ModelInfo?,
        val version: Int,
        val staticPercent: Int,
        val motionPercent: Int?,
    ) : UpdateScreenState()
    data class Verifying(
        override val current: ModelInfo?,
        val version: Int,
        val static: ModelUpdater.Part,
        val motion: ModelUpdater.Part?,
    ) : UpdateScreenState()
    data class Updated(override val current: ModelInfo, val from: Int, val to: Int) : UpdateScreenState()
    /** The server published an older version than the installed one (an admin rolled back). */
    data class RolledBack(override val current: ModelInfo, val from: Int, val to: Int) : UpdateScreenState()
    data class StaticOnly(override val current: ModelInfo, val reason: String) : UpdateScreenState()
    data class UpToDate(override val current: ModelInfo?) : UpdateScreenState()
    data class NoModelPublished(override val current: ModelInfo?) : UpdateScreenState()
    data class Failed(override val current: ModelInfo?, val reason: String) : UpdateScreenState()
    data class Cancelled(override val current: ModelInfo?) : UpdateScreenState()
}

/** Runs one update check and turns its progress and result into screen states. No Android imports. */
class UpdateFlow(
    private val check: (force: Boolean, onStep: (ModelUpdater.Step) -> Unit, isCancelled: () -> Boolean) -> ModelUpdater.Result,
    private val currentInfo: () -> ModelInfo?,
    private val publish: (UpdateScreenState) -> Unit,
) {
    @Volatile private var cancelled = false
    private var last: UpdateScreenState? = null

    /** From any thread. The running check stops at its next chunk, and nothing is installed after this. */
    fun cancel() {
        cancelled = true
    }

    /** Blocks on the network; call on one background thread. */
    fun run(force: Boolean = false) {
        cancelled = false
        last = null
        val before = currentInfo()
        emit(UpdateScreenState.Checking(before))
        val result = check(force, { step -> if (!cancelled) emit(stateFor(step, before)) }, { cancelled })
        emit(stateFor(result, before))
    }

    private fun emit(state: UpdateScreenState) {
        if (state == last) return
        last = state
        publish(state)
    }

    private fun stateFor(step: ModelUpdater.Step, before: ModelInfo?): UpdateScreenState = when (step) {
        is ModelUpdater.Step.Checking -> UpdateScreenState.Checking(before)
        is ModelUpdater.Step.Downloading ->
            UpdateScreenState.Downloading(before, step.version, percent(step.static), step.motion?.let { percent(it) })
        is ModelUpdater.Step.Verifying -> UpdateScreenState.Verifying(before, step.version, step.static, step.motion)
    }

    private fun stateFor(result: ModelUpdater.Result, before: ModelInfo?): UpdateScreenState = when (result) {
        is ModelUpdater.Result.Updated -> {
            // The camera screen loads the new version from disk; this copy only describes it
            val info = result.bundle.use { ModelInfo.of(it) }
            val from = before?.version ?: 0
            val motionError = result.motionError
            when {
                motionError != null -> UpdateScreenState.StaticOnly(info, motionError)
                info.version < from -> UpdateScreenState.RolledBack(info, from, info.version)
                else -> UpdateScreenState.Updated(info, from, info.version)
            }
        }
        is ModelUpdater.Result.UpToDate -> UpdateScreenState.UpToDate(before)
        is ModelUpdater.Result.NoModelPublished -> UpdateScreenState.NoModelPublished(before)
        is ModelUpdater.Result.Failed -> UpdateScreenState.Failed(before, result.message)
        is ModelUpdater.Result.Cancelled -> UpdateScreenState.Cancelled(before)
    }

    private fun percent(fraction: Float) = (fraction * 100).roundToInt().coerceIn(0, 100)
}
```

In `ModelRepository.kt`, add (imports: `ph.senya.app.ml.ModelInfo`):

```kotlin
    /** The installed model's description, else the bundled one's; null if neither can be read. Reads only label files. */
    fun currentInfo(): ModelInfo? {
        val v = installedVersion
        if (v != 0) ModelInfo.read(v, DirModelSource(updater.installedDir(v)))?.let { return it }
        return ModelInfo.read(0, AssetModelSource(appContext.assets))
    }
```

- [ ] **Step 4: Run all unit tests**

Run: `./gradlew :app:testDebugUnitTest`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/main/java/ph/senya/app/ml/ModelInfo.kt app/src/main/java/ph/senya/app/data app/src/test/java/ph/senya/app/ml/ModelInfoTest.kt app/src/test/java/ph/senya/app/data/UpdateFlowTest.kt
git commit -m "android: update screen states from updater progress and results

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Design foundation (colors, theme, styles, icons, shared toolbar)

**Files:**
- Create: `tools/fetch_icons.py`, the generated `app/src/main/res/drawable/ic_*.xml` files, `res/drawable/bg_card.xml`, `bg_icon_button.xml`, `bg_round_dark.xml`, `bg_suggestion.xml`, and `res/layout/view_screen_toolbar.xml`
- Modify: `res/values/colors.xml`, `res/values/styles.xml`, `res/values/strings.xml`, `fragment/OnboardingFragment.kt` (remove the status-bar overrides)

**Interfaces:**
- Produces: the color names `senya_blue`, `senya_blue_dark`, `senya_button`, `senya_on_button`, `senya_ink`, `senya_muted`, `senya_rule`, `senya_surface`, `senya_background`, `senya_chip`, `senya_chip_selected`, `senya_warning`, `senya_error`, `senya_scrim`.
- Produces: the styles `SenyaPrimaryButton`, `SenyaSecondaryButton`, `SenyaToolButton`, `SenyaScreenTitle`, `SenyaSectionTitle`, `SenyaBody`, `SenyaRowLabel`, `SenyaRowValue`, `SenyaCaption`, `SenyaSuggestion`.
- Produces: the drawables `ic_settings`, `ic_backspace`, `ic_ink_eraser`, `ic_volume_up`, `ic_warning`, `ic_no_photography`, `ic_info`, `ic_check_circle`, `ic_error`, `ic_history`, `ic_deployed_code`, `ic_sync`, `ic_chevron_right`, `ic_expand_more`, `ic_expand_less`, `ic_cameraswitch`, `ic_back_hand`, `ic_flight`, `ic_arrow_back`, plus `bg_card`, `bg_icon_button`, `bg_round_dark`, `bg_suggestion`.
- Produces: layout `view_screen_toolbar` (ids `toolbar_back`, `toolbar_title`). Including it with `android:id="@+id/toolbar"` gives `binding.toolbar.toolbarBack` and `binding.toolbar.toolbarTitle`.
- Produces: the string `navigate_back`.

There is no unit test for resources; the gate is a successful build plus the script's own check.

- [ ] **Step 1: Create the icon script `tools/fetch_icons.py`**

```python
"""Downloads the Material Symbols icons the app uses into res/drawable as vector drawables.

Run from android/:  python tools/fetch_icons.py
Icons are Material Symbols Outlined (Apache License 2.0). Paths are filled dark ink; tint them in layouts.
"""
import pathlib
import re
import sys
import urllib.request

ICONS = {  # drawable name: (symbol, variant)
    "ic_settings": ("settings", "default"),
    "ic_backspace": ("backspace", "default"),
    "ic_ink_eraser": ("ink_eraser", "default"),
    "ic_volume_up": ("volume_up", "default"),
    "ic_warning": ("warning", "fill1"),
    "ic_no_photography": ("no_photography", "default"),
    "ic_info": ("info", "default"),
    "ic_check_circle": ("check_circle", "fill1"),
    "ic_error": ("error", "fill1"),
    "ic_history": ("history", "default"),
    "ic_deployed_code": ("deployed_code", "default"),
    "ic_sync": ("sync", "default"),
    "ic_chevron_right": ("chevron_right", "default"),
    "ic_expand_more": ("expand_more", "default"),
    "ic_expand_less": ("expand_less", "default"),
    "ic_cameraswitch": ("cameraswitch", "default"),
    "ic_back_hand": ("back_hand", "default"),
    "ic_flight": ("flight", "default"),
    "ic_arrow_back": ("arrow_back", "default"),
}
URL = "https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/{}/{}/24px.svg"
TEMPLATE = """<?xml version="1.0" encoding="utf-8"?>
<!-- Material Symbols Outlined "{symbol}" ({variant}), Apache License 2.0. Generated by tools/fetch_icons.py -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="960"
    android:viewportHeight="960">
    <group android:translateY="960">
{paths}
    </group>
</vector>
"""

out = pathlib.Path(__file__).resolve().parent.parent / "app" / "src" / "main" / "res" / "drawable"
for name, (symbol, variant) in ICONS.items():
    svg = urllib.request.urlopen(URL.format(symbol, variant), timeout=30).read().decode("utf-8")
    ds = re.findall(r'<path[^>]*\sd="([^"]+)"', svg)
    if not ds:
        sys.exit(f"no <path> in {symbol}")
    paths = "\n".join(f'        <path android:fillColor="#FF111827" android:pathData="{d}" />' for d in ds)
    (out / f"{name}.xml").write_text(TEMPLATE.format(symbol=symbol, variant=variant, paths=paths), encoding="utf-8")
    print("wrote", name)
```

Run: `python tools/fetch_icons.py`
Expected: 19 lines that each start with `wrote`. (The SVG viewBox is `0 -960 960 960`; the `translateY="960"` group maps it into the viewport.)

- [ ] **Step 2: Add colors**

Append inside `<resources>` in `colors.xml`:

```xml
    <!-- M2–M4 mockups -->
    <color name="senya_blue">#2F80ED</color>
    <color name="senya_blue_dark">#1C64C8</color>
    <color name="senya_button">#7DB8F7</color>
    <color name="senya_on_button">#0E2240</color>
    <color name="senya_ink">#111827</color>
    <color name="senya_muted">#6B7280</color>
    <color name="senya_rule">#E5E9F0</color>
    <color name="senya_surface">#FFFFFF</color>
    <color name="senya_background">#F3F5F9</color>
    <color name="senya_chip">#EDF1F7</color>
    <color name="senya_chip_selected">#D3E6FF</color>
    <color name="senya_warning">#F59E0B</color>
    <color name="senya_error">#EF4444</color>
    <color name="senya_scrim">#CC2A2F36</color>
```

- [ ] **Step 3: Theme and styles**

In `styles.xml`, replace the `AppTheme` items with:

```xml
    <style name="AppTheme" parent="Theme.MaterialComponents.Light.NoActionBar" >
        <item name="colorPrimary">@color/senya_blue</item>
        <item name="colorPrimaryVariant">@color/senya_blue_dark</item>
        <item name="colorPrimaryDark">@color/senya_surface</item>
        <item name="colorOnPrimary">@android:color/white</item>
        <item name="colorSecondary">@color/senya_blue</item>
        <item name="colorSecondaryVariant">@color/senya_blue_dark</item>
        <item name="colorError">@color/senya_error</item>
        <item name="android:statusBarColor">@color/senya_surface</item>
        <item name="android:windowLightStatusBar">true</item>
        <item name="android:windowBackground">@color/senya_background</item>
    </style>
```

Append these styles:

```xml
    <style name="SenyaPrimaryButton" parent="Widget.MaterialComponents.Button.UnelevatedButton">
        <item name="android:minHeight">56dp</item>
        <item name="android:insetTop">0dp</item>
        <item name="android:insetBottom">0dp</item>
        <item name="backgroundTint">@color/senya_button</item>
        <item name="android:textColor">@color/senya_on_button</item>
        <item name="iconTint">@color/senya_on_button</item>
        <item name="android:textSize">18sp</item>
        <item name="android:textAllCaps">false</item>
        <item name="android:letterSpacing">0</item>
        <item name="cornerRadius">12dp</item>
    </style>

    <style name="SenyaSecondaryButton" parent="SenyaPrimaryButton">
        <item name="backgroundTint">@color/senya_chip</item>
        <item name="android:textColor">@color/senya_ink</item>
    </style>

    <style name="SenyaToolButton" parent="Widget.MaterialComponents.Button.UnelevatedButton">
        <item name="android:insetTop">0dp</item>
        <item name="android:insetBottom">0dp</item>
        <item name="android:paddingStart">4dp</item>
        <item name="android:paddingEnd">4dp</item>
        <item name="backgroundTint">@color/senya_chip</item>
        <item name="android:textColor">@color/senya_ink</item>
        <item name="iconTint">@color/senya_ink</item>
        <item name="iconGravity">top</item>
        <item name="iconPadding">2dp</item>
        <item name="android:textSize">12sp</item>
        <item name="android:textAllCaps">false</item>
        <item name="android:letterSpacing">0</item>
        <item name="cornerRadius">12dp</item>
    </style>

    <style name="SenyaScreenTitle">
        <item name="android:textColor">@color/senya_ink</item>
        <item name="android:textSize">24sp</item>
        <item name="android:textStyle">bold</item>
    </style>

    <style name="SenyaSectionTitle">
        <item name="android:textColor">@color/senya_ink</item>
        <item name="android:textSize">20sp</item>
        <item name="android:textStyle">bold</item>
    </style>

    <style name="SenyaBody">
        <item name="android:textColor">@color/senya_muted</item>
        <item name="android:textSize">15sp</item>
        <item name="android:lineSpacingExtra">2dp</item>
    </style>

    <style name="SenyaRowLabel">
        <item name="android:textColor">@color/senya_ink</item>
        <item name="android:textSize">16sp</item>
    </style>

    <style name="SenyaRowValue">
        <item name="android:textColor">@color/senya_ink</item>
        <item name="android:textSize">16sp</item>
    </style>

    <style name="SenyaCaption">
        <item name="android:textColor">@color/senya_muted</item>
        <item name="android:textSize">13sp</item>
    </style>

    <style name="SenyaSuggestion">
        <item name="android:layout_width">0dp</item>
        <item name="android:layout_height">44dp</item>
        <item name="android:layout_weight">1</item>
        <item name="android:background">@drawable/bg_suggestion</item>
        <item name="android:gravity">center</item>
        <item name="android:maxLines">1</item>
        <item name="android:ellipsize">end</item>
        <item name="android:paddingStart">8dp</item>
        <item name="android:paddingEnd">8dp</item>
        <item name="android:textColor">@color/senya_ink</item>
        <item name="android:textSize">16sp</item>
    </style>
```

- [ ] **Step 4: Shape drawables**

`res/drawable/bg_card.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="@color/senya_surface" />
    <corners android:radius="16dp" />
</shape>
```

`res/drawable/bg_icon_button.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="@color/senya_chip" />
    <corners android:radius="12dp" />
</shape>
```

`res/drawable/bg_round_dark.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="oval">
    <solid android:color="@color/senya_scrim" />
</shape>
```

`res/drawable/bg_suggestion.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<selector xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:state_selected="true">
        <shape android:shape="rectangle">
            <solid android:color="@color/senya_chip_selected" />
            <corners android:radius="12dp" />
        </shape>
    </item>
    <item>
        <shape android:shape="rectangle">
            <solid android:color="@color/senya_chip" />
            <corners android:radius="12dp" />
        </shape>
    </item>
</selector>
```

Change `res/drawable/bg_pill.xml`'s solid color to `@color/senya_scrim`. It becomes the offline badge background.

- [ ] **Step 5: Shared toolbar `res/layout/view_screen_toolbar.xml`**

```xml
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="56dp"
    android:background="@color/senya_surface"
    android:gravity="center_vertical"
    android:orientation="horizontal"
    android:paddingStart="4dp"
    android:paddingEnd="16dp">

    <ImageButton
        android:id="@+id/toolbar_back"
        android:layout_width="48dp"
        android:layout_height="48dp"
        android:background="?attr/selectableItemBackgroundBorderless"
        android:contentDescription="@string/navigate_back"
        android:src="@drawable/ic_arrow_back"
        app:tint="@color/senya_ink" />

    <TextView
        android:id="@+id/toolbar_title"
        android:layout_width="0dp"
        android:layout_height="wrap_content"
        android:layout_marginStart="8dp"
        android:layout_weight="1"
        android:textColor="@color/senya_ink"
        android:textSize="20sp"
        android:textStyle="bold" />

    <ImageView
        android:layout_width="28dp"
        android:layout_height="28dp"
        android:contentDescription="@null"
        android:src="@drawable/onboarding_hand" />
</LinearLayout>
```

Add to `strings.xml`: `<string name="navigate_back">Back</string>`

- [ ] **Step 6: Remove the onboarding status-bar overrides**

The theme now makes the status bar white with dark icons everywhere. In `OnboardingFragment.kt`:
- Delete the `requireActivity().window.apply { ... }` block in `onResume`.
- Delete the whole `onPause` override.
- Delete the now-unused import `androidx.core.view.WindowInsetsControllerCompat`.

- [ ] **Step 7: Build and test**

Run: `./gradlew :app:assembleDebug :app:testDebugUnitTest`
Expected: BUILD SUCCESSFUL. A bad vector path would fail here at `mergeDebugResources` or at runtime inflation. If aapt reports an error in an `ic_*.xml`, re-run the script and inspect that file.

- [ ] **Step 8: Commit**

```bash
git add tools/fetch_icons.py app/src/main/res app/src/main/java/ph/senya/app/fragment/OnboardingFragment.kt
git commit -m "android: design tokens, icons, and white status bar for the new screens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Model update screen (M3)

**Files:**
- Create: `app/src/main/java/ph/senya/app/fragment/ModelUpdateViewModel.kt`
- Create: `app/src/main/java/ph/senya/app/fragment/ModelUpdateFragment.kt`
- Create: `app/src/main/res/layout/fragment_model_update.xml`
- Modify: `res/navigation/nav_graph.xml`, `res/values/strings.xml`
- Modify: `fragment/CameraFragment.kt`. The old settings dialog's "Check for update" button opens the new screen; auto-check runs once per process.

**Interfaces:**
- Consumes: `UpdateFlow`, `UpdateScreenState`, `ModelInfo` (Task 4); `ModelRepository.checkForUpdate(force, onStep, isCancelled)` and `currentInfo()` (Tasks 3–4); `ModelUpdater.Part`; the Task 5 styles, icons, and `view_screen_toolbar`.
- Produces: the nav destination `@id/model_update_fragment`. Task 7 navigates to it from Settings.

- [ ] **Step 1: Strings**

Add to `strings.xml`:

```xml
    <string name="model_update">Model update</string>
    <string name="static_model">Static model</string>
    <string name="motion_model">Motion model</string>
    <string name="percent">%d%%</string>
    <string name="part_status">%1$s · %2$s</string>
    <string name="part_waiting">waiting</string>
    <string name="part_checking">checking</string>
    <string name="part_verified">verified</string>
    <string name="part_ready">ready</string>
    <string name="part_unavailable">unavailable</string>
    <string name="current_model">Current model</string>
    <string name="model_type">Model type</string>
    <string name="model_version">v%d</string>
    <string name="model_version_static_only">v%d · static only</string>
    <string name="model_none">None</string>
    <string name="model_type_none">–</string>
    <string name="update_checking_title">Checking for update…</string>
    <string name="update_checking_body">Looking for a newer model on the server.</string>
    <string name="update_downloading_title">Downloading v%d</string>
    <string name="update_downloading_body">Getting the latest model from the server.</string>
    <string name="update_verifying_title">Verifying files…</string>
    <string name="update_verifying_body">Checking the downloaded models.</string>
    <string name="update_updated_title">Updated successfully</string>
    <string name="update_updated_body">v%1$d → v%2$d\nThe latest model is ready to use.</string>
    <string name="update_failed_title">Update failed</string>
    <string name="update_failed_body">%s.\nKept your current model.</string>
    <string name="update_static_only_title">Continuing static-only</string>
    <string name="update_static_only_body">The motion model couldn\'t be installed.</string>
    <string name="update_rolled_back_title">Rolled back</string>
    <string name="update_rolled_back_body">v%1$d → v%2$d\nThe server restored an earlier model.</string>
    <string name="update_up_to_date_title">You\'re up to date</string>
    <string name="update_up_to_date_body">You have the latest model.</string>
    <string name="update_no_model_title">No model published yet</string>
    <string name="update_no_model_body">The server has no published model. Sign recognition needs a model.</string>
    <string name="update_info_kept">Your installed model is still available.</string>
    <string name="update_info_downloading">Still available while downloading.</string>
    <string name="update_info_verifying">New models activate after verification.</string>
    <string name="update_info_static_only">J and Z are unavailable.</string>
    <string name="update_info_available">%s are available.</string>
    <string name="update_info_no_model">Check again later or contact your administrator.</string>
    <string name="update_try_again">Try again</string>
    <string name="update_continue_signing">Continue signing</string>
    <string name="update_retry_motion">Retry motion model</string>
    <string name="update_continue_static_only">Continue static-only</string>
    <string name="update_check_again">Check again</string>
    <string name="update_back_to_settings">Back to settings</string>
```

- [ ] **Step 2: Layout `res/layout/fragment_model_update.xml`**

```xml
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@color/senya_surface"
    android:orientation="vertical">

    <include
        android:id="@+id/toolbar"
        layout="@layout/view_screen_toolbar" />

    <View
        android:layout_width="match_parent"
        android:layout_height="1dp"
        android:background="@color/senya_rule" />

    <ScrollView
        android:layout_width="match_parent"
        android:layout_height="0dp"
        android:layout_weight="1"
        android:fillViewport="true">

        <LinearLayout
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:gravity="center_horizontal"
            android:orientation="vertical"
            android:paddingStart="24dp"
            android:paddingTop="32dp"
            android:paddingEnd="24dp"
            android:paddingBottom="16dp">

            <FrameLayout
                android:layout_width="64dp"
                android:layout_height="64dp">

                <com.google.android.material.progressindicator.CircularProgressIndicator
                    android:id="@+id/update_spinner"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:layout_gravity="center"
                    android:indeterminate="true"
                    app:indicatorColor="@color/senya_blue"
                    app:indicatorSize="56dp"
                    app:trackThickness="5dp" />

                <ImageView
                    android:id="@+id/update_icon"
                    android:layout_width="64dp"
                    android:layout_height="64dp"
                    android:contentDescription="@null"
                    android:visibility="gone" />
            </FrameLayout>

            <TextView
                android:id="@+id/update_title"
                style="@style/SenyaScreenTitle"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="20dp"
                android:gravity="center" />

            <TextView
                android:id="@+id/update_subtitle"
                style="@style/SenyaBody"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="8dp"
                android:gravity="center" />

            <View
                android:layout_width="match_parent"
                android:layout_height="1dp"
                android:layout_marginTop="24dp"
                android:background="@color/senya_rule" />

            <LinearLayout
                android:id="@+id/update_progress"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:orientation="vertical"
                android:paddingTop="16dp"
                android:paddingBottom="16dp"
                android:visibility="gone">

                <LinearLayout
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:orientation="horizontal">

                    <TextView
                        style="@style/SenyaRowLabel"
                        android:layout_width="0dp"
                        android:layout_height="wrap_content"
                        android:layout_weight="1"
                        android:text="@string/static_model" />

                    <TextView
                        android:id="@+id/update_static_percent"
                        style="@style/SenyaRowValue"
                        android:layout_width="wrap_content"
                        android:layout_height="wrap_content" />
                </LinearLayout>

                <com.google.android.material.progressindicator.LinearProgressIndicator
                    android:id="@+id/update_static_bar"
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:layout_marginTop="8dp"
                    android:max="100"
                    app:indicatorColor="@color/senya_blue"
                    app:trackColor="@color/senya_rule"
                    app:trackCornerRadius="4dp"
                    app:trackThickness="8dp" />

                <LinearLayout
                    android:id="@+id/update_motion_group"
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:layout_marginTop="16dp"
                    android:orientation="vertical">

                    <LinearLayout
                        android:layout_width="match_parent"
                        android:layout_height="wrap_content"
                        android:orientation="horizontal">

                        <TextView
                            style="@style/SenyaRowLabel"
                            android:layout_width="0dp"
                            android:layout_height="wrap_content"
                            android:layout_weight="1"
                            android:text="@string/motion_model" />

                        <TextView
                            android:id="@+id/update_motion_percent"
                            style="@style/SenyaRowValue"
                            android:layout_width="wrap_content"
                            android:layout_height="wrap_content" />
                    </LinearLayout>

                    <com.google.android.material.progressindicator.LinearProgressIndicator
                        android:id="@+id/update_motion_bar"
                        android:layout_width="match_parent"
                        android:layout_height="wrap_content"
                        android:layout_marginTop="8dp"
                        android:max="100"
                        app:indicatorColor="@color/senya_blue"
                        app:trackColor="@color/senya_rule"
                        app:trackCornerRadius="4dp"
                        app:trackThickness="8dp" />
                </LinearLayout>
            </LinearLayout>

            <LinearLayout
                android:id="@+id/update_verify"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:orientation="vertical"
                android:paddingTop="16dp"
                android:paddingBottom="8dp"
                android:visibility="gone">

                <LinearLayout
                    android:layout_width="match_parent"
                    android:layout_height="40dp"
                    android:gravity="center_vertical"
                    android:orientation="horizontal">

                    <FrameLayout
                        android:layout_width="24dp"
                        android:layout_height="24dp">

                        <ImageView
                            android:id="@+id/update_static_icon"
                            android:layout_width="24dp"
                            android:layout_height="24dp"
                            android:contentDescription="@null" />

                        <com.google.android.material.progressindicator.CircularProgressIndicator
                            android:id="@+id/update_static_spinner"
                            android:layout_width="wrap_content"
                            android:layout_height="wrap_content"
                            android:layout_gravity="center"
                            android:indeterminate="true"
                            app:indicatorColor="@color/senya_blue"
                            app:indicatorSize="20dp"
                            app:trackThickness="3dp" />
                    </FrameLayout>

                    <TextView
                        android:id="@+id/update_static_text"
                        style="@style/SenyaRowLabel"
                        android:layout_width="wrap_content"
                        android:layout_height="wrap_content"
                        android:layout_marginStart="12dp" />
                </LinearLayout>

                <LinearLayout
                    android:id="@+id/update_motion_row"
                    android:layout_width="match_parent"
                    android:layout_height="40dp"
                    android:gravity="center_vertical"
                    android:orientation="horizontal">

                    <FrameLayout
                        android:layout_width="24dp"
                        android:layout_height="24dp">

                        <ImageView
                            android:id="@+id/update_motion_icon"
                            android:layout_width="24dp"
                            android:layout_height="24dp"
                            android:contentDescription="@null" />

                        <com.google.android.material.progressindicator.CircularProgressIndicator
                            android:id="@+id/update_motion_spinner"
                            android:layout_width="wrap_content"
                            android:layout_height="wrap_content"
                            android:layout_gravity="center"
                            android:indeterminate="true"
                            app:indicatorColor="@color/senya_blue"
                            app:indicatorSize="20dp"
                            app:trackThickness="3dp" />
                    </FrameLayout>

                    <TextView
                        android:id="@+id/update_motion_text"
                        style="@style/SenyaRowLabel"
                        android:layout_width="wrap_content"
                        android:layout_height="wrap_content"
                        android:layout_marginStart="12dp" />
                </LinearLayout>
            </LinearLayout>

            <View
                android:layout_width="match_parent"
                android:layout_height="1dp"
                android:background="@color/senya_rule" />

            <LinearLayout
                android:layout_width="match_parent"
                android:layout_height="44dp"
                android:layout_marginTop="8dp"
                android:gravity="center_vertical"
                android:orientation="horizontal">

                <TextView
                    style="@style/SenyaBody"
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_weight="1"
                    android:text="@string/current_model" />

                <TextView
                    android:id="@+id/update_current_version"
                    style="@style/SenyaRowValue"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content" />
            </LinearLayout>

            <LinearLayout
                android:layout_width="match_parent"
                android:layout_height="44dp"
                android:gravity="center_vertical"
                android:orientation="horizontal">

                <TextView
                    style="@style/SenyaBody"
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_weight="1"
                    android:text="@string/model_type" />

                <TextView
                    android:id="@+id/update_current_type"
                    style="@style/SenyaRowValue"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content" />
            </LinearLayout>

            <LinearLayout
                android:id="@+id/update_info"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="16dp"
                android:gravity="center_vertical"
                android:orientation="horizontal">

                <ImageView
                    android:layout_width="22dp"
                    android:layout_height="22dp"
                    android:contentDescription="@null"
                    android:src="@drawable/ic_info"
                    app:tint="@color/senya_muted" />

                <TextView
                    android:id="@+id/update_info_text"
                    style="@style/SenyaCaption"
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_marginStart="12dp"
                    android:layout_weight="1" />
            </LinearLayout>
        </LinearLayout>
    </ScrollView>

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:orientation="vertical"
        android:paddingStart="24dp"
        android:paddingTop="8dp"
        android:paddingEnd="24dp"
        android:paddingBottom="24dp">

        <com.google.android.material.button.MaterialButton
            android:id="@+id/update_primary"
            style="@style/SenyaPrimaryButton"
            android:layout_width="match_parent"
            android:layout_height="wrap_content" />

        <com.google.android.material.button.MaterialButton
            android:id="@+id/update_secondary"
            style="@style/SenyaSecondaryButton"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_marginTop="12dp"
            android:visibility="gone" />
    </LinearLayout>
</LinearLayout>
```

- [ ] **Step 3: ViewModel `fragment/ModelUpdateViewModel.kt`**

```kotlin
package ph.senya.app.fragment

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import ph.senya.app.data.ModelRepository
import ph.senya.app.data.UpdateFlow
import ph.senya.app.data.UpdateScreenState
import java.util.concurrent.Executors

/** Runs the update check off the main thread and survives configuration changes. Leaving the screen cancels it. */
class ModelUpdateViewModel(app: Application) : AndroidViewModel(app) {
    private val repository = ModelRepository(app)
    private val executor = Executors.newSingleThreadExecutor()
    private val _state = MutableLiveData<UpdateScreenState>()
    val state: LiveData<UpdateScreenState> = _state

    private val flow = UpdateFlow(
        check = { force, onStep, isCancelled -> repository.checkForUpdate(force, onStep, isCancelled) },
        currentInfo = { repository.currentInfo() },
        publish = { _state.postValue(it) },
    )

    init {
        start()
    }

    /** [force] re-downloads the installed version ("Retry motion model"). */
    fun start(force: Boolean = false) {
        executor.execute { flow.run(force) }
    }

    fun cancel() = flow.cancel()

    override fun onCleared() {
        flow.cancel()
        executor.shutdown()
    }
}
```

If `MutableLiveData` doesn't resolve, add `implementation 'androidx.lifecycle:lifecycle-livedata-ktx:2.5.1'` to `app/build.gradle` dependencies. It is normally pulled in transitively by fragment-ktx 1.5.4.

- [ ] **Step 4: Fragment `fragment/ModelUpdateFragment.kt`**

```kotlin
package ph.senya.app.fragment

import android.content.res.ColorStateList
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.annotation.ColorRes
import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.core.view.isVisible
import androidx.core.widget.ImageViewCompat
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.navigation.fragment.findNavController
import ph.senya.app.R
import ph.senya.app.data.ModelUpdater.Part
import ph.senya.app.data.UpdateScreenState
import ph.senya.app.databinding.FragmentModelUpdateBinding
import ph.senya.app.ml.ModelInfo

/** M3 mockup: checking, downloading, verifying, and every outcome of a model update. */
class ModelUpdateFragment : Fragment() {
    private var _binding: FragmentModelUpdateBinding? = null
    private val binding get() = _binding!!
    private val viewModel: ModelUpdateViewModel by viewModels()

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentModelUpdateBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        binding.toolbar.toolbarTitle.setText(R.string.model_update)
        binding.toolbar.toolbarBack.setOnClickListener { leave() }
        viewModel.state.observe(viewLifecycleOwner) { render(it) }
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }

    /** Back and Cancel stop a running check; the installed model stays (spec §5.2). System Back clears the ViewModel, which cancels too. */
    private fun leave() {
        viewModel.cancel()
        findNavController().popBackStack()
    }

    /** The camera screen reloads the installed model when its view is re-created. */
    private fun toCamera() {
        findNavController().popBackStack(R.id.camera_fragment, false)
    }

    private fun render(state: UpdateScreenState) {
        val b = binding
        val busy = state is UpdateScreenState.Checking || state is UpdateScreenState.Downloading ||
            state is UpdateScreenState.Verifying
        b.updateSpinner.isVisible = busy
        b.updateIcon.isVisible = !busy
        b.updateProgress.isVisible = state is UpdateScreenState.Downloading
        b.updateVerify.isVisible = state is UpdateScreenState.Verifying || state is UpdateScreenState.Updated ||
            state is UpdateScreenState.StaticOnly
        b.updateInfo.isVisible = true
        b.updateSecondary.isVisible = false
        showCurrent(state.current, staticOnly = state is UpdateScreenState.StaticOnly)
        when (state) {
            is UpdateScreenState.Checking -> {
                text(R.string.update_checking_title, getString(R.string.update_checking_body))
                info(getString(R.string.update_info_kept))
                primary(R.string.cancel) { leave() }
            }
            is UpdateScreenState.Downloading -> {
                b.updateTitle.text = getString(R.string.update_downloading_title, state.version)
                b.updateSubtitle.setText(R.string.update_downloading_body)
                b.updateStaticPercent.text = getString(R.string.percent, state.staticPercent)
                b.updateStaticBar.setProgressCompat(state.staticPercent, true)
                b.updateMotionGroup.isVisible = state.motionPercent != null
                state.motionPercent?.let {
                    b.updateMotionPercent.text = getString(R.string.percent, it)
                    b.updateMotionBar.setProgressCompat(it, true)
                }
                info(getString(R.string.update_info_downloading))
                primary(R.string.cancel) { leave() }
            }
            is UpdateScreenState.Verifying -> {
                text(R.string.update_verifying_title, getString(R.string.update_verifying_body))
                parts(state.static, state.motion, done = false)
                info(getString(R.string.update_info_verifying))
                primary(R.string.cancel) { leave() }
            }
            is UpdateScreenState.Updated -> {
                icon(R.drawable.ic_check_circle, R.color.senya_blue)
                text(R.string.update_updated_title, getString(R.string.update_updated_body, state.from, state.to))
                parts(Part.OK, if (state.current.hasMotion) Part.OK else null, done = true)
                b.updateInfo.isVisible = false
                primary(R.string.onboarding_start_signing) { toCamera() }
            }
            is UpdateScreenState.StaticOnly -> {
                icon(R.drawable.ic_warning, R.color.senya_warning)
                text(R.string.update_static_only_title, getString(R.string.update_static_only_body))
                parts(Part.OK, Part.FAILED, done = false)
                info(getString(R.string.update_info_static_only))
                primary(R.string.update_retry_motion) { viewModel.start(force = true) }
                secondary(R.string.update_continue_static_only) { toCamera() }
            }
            is UpdateScreenState.RolledBack -> {
                icon(R.drawable.ic_history, R.color.senya_blue)
                text(R.string.update_rolled_back_title, getString(R.string.update_rolled_back_body, state.from, state.to))
                info(getString(R.string.update_info_available, state.current.typeText))
                primary(R.string.update_continue_signing) { toCamera() }
            }
            is UpdateScreenState.UpToDate -> {
                icon(R.drawable.ic_check_circle, R.color.senya_blue)
                text(R.string.update_up_to_date_title, getString(R.string.update_up_to_date_body))
                b.updateInfo.isVisible = false
                primary(R.string.update_continue_signing) { toCamera() }
            }
            is UpdateScreenState.NoModelPublished -> {
                icon(R.drawable.ic_deployed_code, R.color.senya_muted)
                text(R.string.update_no_model_title, getString(R.string.update_no_model_body))
                info(getString(R.string.update_info_no_model))
                primary(R.string.update_check_again) { viewModel.start() }
                secondary(R.string.update_back_to_settings) { findNavController().popBackStack() }
            }
            is UpdateScreenState.Failed -> {
                icon(R.drawable.ic_error, R.color.senya_error)
                val reason = state.reason.replaceFirstChar { it.uppercase() }
                text(R.string.update_failed_title, getString(R.string.update_failed_body, reason))
                info(getString(R.string.update_info_kept))
                primary(R.string.update_try_again) { viewModel.start() }
                secondary(R.string.update_continue_signing) { toCamera() }
            }
            is UpdateScreenState.Cancelled -> Unit // the screen is already closing
        }
    }

    private fun text(@StringRes title: Int, subtitle: String) {
        binding.updateTitle.setText(title)
        binding.updateSubtitle.text = subtitle
    }

    private fun icon(@DrawableRes icon: Int, @ColorRes tint: Int) {
        binding.updateIcon.setImageResource(icon)
        ImageViewCompat.setImageTintList(binding.updateIcon, ColorStateList.valueOf(requireContext().getColor(tint)))
    }

    private fun info(text: String) {
        binding.updateInfoText.text = text
    }

    private fun primary(@StringRes label: Int, action: () -> Unit) {
        binding.updatePrimary.setText(label)
        binding.updatePrimary.setOnClickListener { action() }
    }

    private fun secondary(@StringRes label: Int, action: () -> Unit) {
        binding.updateSecondary.isVisible = true
        binding.updateSecondary.setText(label)
        binding.updateSecondary.setOnClickListener { action() }
    }

    private fun parts(static: Part, motion: Part?, done: Boolean) {
        val b = binding
        part(b.updateStaticIcon, b.updateStaticSpinner, b.updateStaticText, R.string.static_model, static, done)
        b.updateMotionRow.isVisible = motion != null
        if (motion != null) part(b.updateMotionIcon, b.updateMotionSpinner, b.updateMotionText, R.string.motion_model, motion, done)
    }

    private fun part(icon: ImageView, spinner: View, text: TextView, @StringRes name: Int, part: Part, done: Boolean) {
        val working = part == Part.PENDING || part == Part.CHECKING
        spinner.isVisible = working
        icon.isVisible = !working
        if (part == Part.OK) {
            icon.setImageResource(R.drawable.ic_check_circle)
            ImageViewCompat.setImageTintList(icon, ColorStateList.valueOf(requireContext().getColor(R.color.senya_blue)))
        } else if (part == Part.FAILED) {
            icon.setImageResource(R.drawable.ic_error)
            ImageViewCompat.setImageTintList(icon, ColorStateList.valueOf(requireContext().getColor(R.color.senya_warning)))
        }
        val status = when (part) {
            Part.PENDING -> R.string.part_waiting
            Part.CHECKING -> R.string.part_checking
            Part.OK -> if (done) R.string.part_ready else R.string.part_verified
            Part.FAILED -> R.string.part_unavailable
        }
        text.text = getString(R.string.part_status, getString(name), getString(status))
    }

    private fun showCurrent(info: ModelInfo?, staticOnly: Boolean) {
        binding.updateCurrentVersion.text = when {
            info == null -> getString(R.string.model_none)
            staticOnly -> getString(R.string.model_version_static_only, info.version)
            else -> getString(R.string.model_version, info.version)
        }
        binding.updateCurrentType.text = info?.typeText ?: getString(R.string.model_type_none)
    }
}
```

- [ ] **Step 5: Navigation and a temporary way in**

In `nav_graph.xml`, add before `</navigation>`:

```xml
    <fragment
        android:id="@+id/model_update_fragment"
        android:name="ph.senya.app.fragment.ModelUpdateFragment"
        android:label="ModelUpdateFragment" />
```

In `CameraFragment.kt`:

(a) Add to the `companion object`:

```kotlin
        /** The automatic update check runs once per app start, not every time this screen's view is re-created. */
        private var autoUpdateChecked = false
```

(b) In `onViewCreated`, replace the `modelExecutor.execute { loadCurrentModel(); checkForUpdate(manual = false) }` block with:

```kotlin
        val autoCheck = !autoUpdateChecked
        autoUpdateChecked = true
        modelExecutor.execute {
            loadCurrentModel()
            if (autoCheck) checkForUpdate()
        }
```

(c) Make `checkForUpdate` take no parameter:
- Change the signature to `private fun checkForUpdate()`.
- In the `UpToDate` branch, delete `if (manual) toast("Model is up to date")`.
- Change the `NoModelPublished` branch to `is ModelUpdater.Result.NoModelPublished -> {}`.

(d) In `showSettings()`, replace the neutral button's lambda with:

```kotlin
            .setNeutralButton(R.string.check_for_update) { _, _ ->
                save()
                Navigation.findNavController(requireActivity(), R.id.fragment_container).navigate(R.id.model_update_fragment)
            }
```

- [ ] **Step 6: Build and test**

Run: `./gradlew :app:testDebugUnitTest :app:assembleDebug`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 7: Quick device check**

Install with `"$LOCALAPPDATA/Android/Sdk/platform-tools/adb" install -r app/build/outputs/apk/debug/app-debug.apk`. Ask the user to open the gear, then tap **Check for update**. Capture `adb exec-out screencap -p > <scratchpad>/m3-check.png` and read it.
Expected: the M3 layout shows "Checking for update…" with a spinner, and then reaches "You're up to date", "Updated successfully", or "Update failed". Tapping **Continue signing** returns to the camera.

- [ ] **Step 8: Commit**

```bash
git add app/src/main/java/ph/senya/app/fragment app/src/main/res app/build.gradle
git commit -m "android: model update screen with progress, verification, and outcomes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Settings screen (M4)

**Files:**
- Create: `app/src/main/java/ph/senya/app/fragment/SettingsFragment.kt`
- Create: `app/src/main/java/ph/senya/app/speech/VoiceDialog.kt`
- Create: `app/src/main/res/layout/fragment_settings.xml`
- Modify: `core/VoicePicker.kt` (+`labels`), `speech/Speaker.kt` (`availableVoices` labels), `fragment/OnboardingFragment.kt` (use `VoiceDialog`), `fragment/CameraFragment.kt` (gear opens Settings), `res/navigation/nav_graph.xml`, `res/values/strings.xml`
- Delete: `res/layout/dialog_settings.xml`
- Test: `app/src/test/java/ph/senya/app/core/VoicePickerTest.kt`

**Interfaces:**
- Consumes: `ModelRepository.currentInfo()`, `lastCheckMs`, `speakOnSpace`, `serverOverride`; `ModelInfo.typeText`; `Speaker`; the nav destination `model_update_fragment`.
- Produces:
  - `VoicePicker.labels(languages: List<String>): List<String>`
  - `object VoiceDialog { fun show(context: Context, speaker: Speaker, openVoiceSettings: () -> Unit, onChanged: () -> Unit); fun openTtsSettings(context: Context): Boolean }`
  - the nav destination `@id/settings_fragment` and the actions `action_camera_to_settings` and `action_settings_to_model_update`.

- [ ] **Step 1: Write the failing test**

Append to `VoicePickerTest`:

```kotlin
    @Test
    fun labelsNumberVoicesPerLanguage() {
        assertEquals(
            listOf("Filipino · Voice 1", "English · Voice 1", "Filipino · Voice 2"),
            VoicePicker.labels(listOf("Filipino", "English", "Filipino")),
        )
    }
```

Run: `./gradlew :app:testDebugUnitTest --tests 'ph.senya.app.core.VoicePickerTest'`
Expected: FAIL ("Unresolved reference: labels").

- [ ] **Step 2: Implement the labels and use them in Speaker**

Add to the `VoicePicker` object:

```kotlin
    /** "Filipino · Voice 1", "Filipino · Voice 2": engine voice names mean nothing to people. */
    fun labels(languages: List<String>): List<String> {
        val counts = mutableMapOf<String, Int>()
        return languages.map { language ->
            val n = (counts[language] ?: 0) + 1
            counts[language] = n
            "$language · Voice $n"
        }
    }
```

In `Speaker.kt`, replace `availableVoices()` with:

```kotlin
    fun availableVoices(): List<VoiceChoice> {
        val labels = VoicePicker.labels(offlineVoices.map { it.locale.getDisplayLanguage(Locale.getDefault()) })
        return offlineVoices.mapIndexed { i, voice -> VoiceChoice(voice.name, labels[i]) }
    }
```

Run the test again. Expected: PASS.

- [ ] **Step 3: Extract the voice dialog `speech/VoiceDialog.kt`**

```kotlin
package ph.senya.app.speech

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import ph.senya.app.R

/** The offline voice list shared by onboarding and Settings. */
object VoiceDialog {
    /** With no offline voice installed, this opens the system voice settings instead. [onChanged] runs after a pick. */
    fun show(context: Context, speaker: Speaker, openVoiceSettings: () -> Unit, onChanged: () -> Unit) {
        val choices = speaker.availableVoices()
        if (choices.isEmpty()) {
            openVoiceSettings()
            return
        }
        AlertDialog.Builder(context)
            .setTitle(R.string.onboarding_choose_voice)
            .setSingleChoiceItems(choices.map { it.label }.toTypedArray(),
                choices.indexOfFirst { it.name == speaker.selectedVoiceName }) { dialog, which ->
                if (!speaker.selectVoice(choices[which].name)) {
                    Toast.makeText(context, R.string.onboarding_voice_select_failed, Toast.LENGTH_SHORT).show()
                }
                onChanged()
                dialog.dismiss()
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    /** Opens the system text-to-speech settings. False if this phone has no screen for it. */
    fun openTtsSettings(context: Context): Boolean = try {
        context.startActivity(Intent("com.android.settings.TTS_SETTINGS"))
        true
    } catch (_: ActivityNotFoundException) {
        try {
            context.startActivity(Intent(Settings.ACTION_SETTINGS))
            true
        } catch (_: ActivityNotFoundException) {
            false
        }
    }
}
```

In `OnboardingFragment.kt`, replace `chooseVoice()` and `openVoiceSettings()` with:

```kotlin
    private fun chooseVoice() {
        val current = speaker ?: return
        VoiceDialog.show(requireContext(), current, ::openVoiceSettings, ::updateVoiceStatus)
    }

    private fun openVoiceSettings() {
        voiceSettingsOpened = VoiceDialog.openTtsSettings(requireContext())
        if (!voiceSettingsOpened) {
            voiceError = getString(R.string.onboarding_voice_settings_unavailable)
            updateVoiceStatus()
        }
    }
```

Add `import ph.senya.app.speech.VoiceDialog` to `OnboardingFragment.kt`. Then delete any imports that are now unused (`ActivityNotFoundException`, `AlertDialog`, `Toast`, and `Settings` only if nothing else in the file uses them; `Settings` is still used by `requestCamera`).

- [ ] **Step 4: Strings**

Add to `strings.xml`:

```xml
    <string name="settings_speech">Speech</string>
    <string name="settings_voice">Voice</string>
    <string name="settings_voice_missing">No offline voice · tap to install</string>
    <string name="settings_test_voice">Test voice</string>
    <string name="settings_test_phrase_display">“MAGANDA”</string>
    <string name="settings_models">Models</string>
    <string name="settings_installed_version">Installed version</string>
    <string name="settings_not_checked">Not checked yet</string>
    <string name="settings_last_checked">Last checked %s</string>
    <string name="settings_updates_note">Updates need internet. Signing stays on your phone.</string>
    <string name="settings_advanced">Advanced</string>
    <string name="settings_server_override_short">Server override</string>
    <string name="settings_server_url">Server URL override</string>
    <string name="settings_reset_default">Reset to default</string>
    <string name="settings_save_changes">Save changes</string>
    <string name="settings_saved">Saved</string>
    <string name="settings_server_reset">Using the default server</string>
```

- [ ] **Step 5: Layout `res/layout/fragment_settings.xml`**

```xml
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@color/senya_surface"
    android:orientation="vertical">

    <include
        android:id="@+id/toolbar"
        layout="@layout/view_screen_toolbar" />

    <View
        android:layout_width="match_parent"
        android:layout_height="1dp"
        android:background="@color/senya_rule" />

    <ScrollView
        android:layout_width="match_parent"
        android:layout_height="0dp"
        android:layout_weight="1">

        <LinearLayout
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:orientation="vertical"
            android:paddingStart="24dp"
            android:paddingTop="20dp"
            android:paddingEnd="24dp"
            android:paddingBottom="24dp">

            <TextView
                style="@style/SenyaSectionTitle"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:text="@string/settings_speech" />

            <LinearLayout
                android:id="@+id/settings_voice_row"
                android:layout_width="match_parent"
                android:layout_height="56dp"
                android:layout_marginTop="8dp"
                android:background="?attr/selectableItemBackground"
                android:gravity="center_vertical"
                android:orientation="horizontal">

                <TextView
                    style="@style/SenyaRowLabel"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:text="@string/settings_voice" />

                <TextView
                    android:id="@+id/settings_voice_value"
                    style="@style/SenyaBody"
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_marginStart="16dp"
                    android:layout_weight="1"
                    android:ellipsize="end"
                    android:gravity="end"
                    android:maxLines="1" />

                <ImageView
                    android:layout_width="24dp"
                    android:layout_height="24dp"
                    android:contentDescription="@null"
                    android:src="@drawable/ic_chevron_right"
                    app:tint="@color/senya_muted" />
            </LinearLayout>

            <View
                android:layout_width="match_parent"
                android:layout_height="1dp"
                android:background="@color/senya_rule" />

            <LinearLayout
                android:id="@+id/settings_voice_status_row"
                android:layout_width="match_parent"
                android:layout_height="52dp"
                android:background="?attr/selectableItemBackground"
                android:gravity="center_vertical"
                android:orientation="horizontal">

                <ImageView
                    android:id="@+id/settings_voice_status_icon"
                    android:layout_width="24dp"
                    android:layout_height="24dp"
                    android:contentDescription="@null" />

                <TextView
                    android:id="@+id/settings_voice_status"
                    style="@style/SenyaRowLabel"
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_marginStart="12dp"
                    android:layout_weight="1" />
            </LinearLayout>

            <LinearLayout
                android:id="@+id/settings_test_voice"
                android:layout_width="match_parent"
                android:layout_height="52dp"
                android:background="?attr/selectableItemBackground"
                android:gravity="center_vertical"
                android:orientation="horizontal">

                <ImageView
                    android:layout_width="24dp"
                    android:layout_height="24dp"
                    android:contentDescription="@null"
                    android:src="@drawable/ic_volume_up"
                    app:tint="@color/senya_blue" />

                <TextView
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_marginStart="12dp"
                    android:layout_weight="1"
                    android:text="@string/settings_test_voice"
                    android:textColor="@color/senya_blue"
                    android:textSize="16sp" />

                <TextView
                    style="@style/SenyaBody"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:text="@string/settings_test_phrase_display" />
            </LinearLayout>

            <com.google.android.material.switchmaterial.SwitchMaterial
                android:id="@+id/settings_speak_on_space"
                style="@style/SenyaRowLabel"
                android:layout_width="match_parent"
                android:layout_height="52dp"
                android:text="@string/speak_on_space" />

            <View
                android:layout_width="match_parent"
                android:layout_height="1dp"
                android:layout_marginTop="12dp"
                android:background="@color/senya_rule" />

            <TextView
                style="@style/SenyaSectionTitle"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:layout_marginTop="20dp"
                android:text="@string/settings_models" />

            <LinearLayout
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="12dp"
                android:orientation="horizontal">

                <LinearLayout
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_weight="1"
                    android:orientation="vertical">

                    <TextView
                        style="@style/SenyaRowLabel"
                        android:layout_width="wrap_content"
                        android:layout_height="wrap_content"
                        android:text="@string/settings_installed_version" />

                    <TextView
                        android:id="@+id/settings_model_type"
                        style="@style/SenyaBody"
                        android:layout_width="wrap_content"
                        android:layout_height="wrap_content" />
                </LinearLayout>

                <TextView
                    android:id="@+id/settings_model_version"
                    style="@style/SenyaRowValue"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content" />
            </LinearLayout>

            <LinearLayout
                android:id="@+id/settings_check_update"
                android:layout_width="match_parent"
                android:layout_height="64dp"
                android:layout_marginTop="8dp"
                android:background="?attr/selectableItemBackground"
                android:gravity="center_vertical"
                android:orientation="horizontal">

                <ImageView
                    android:layout_width="24dp"
                    android:layout_height="24dp"
                    android:contentDescription="@null"
                    android:src="@drawable/ic_sync"
                    app:tint="@color/senya_blue" />

                <LinearLayout
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_marginStart="12dp"
                    android:layout_weight="1"
                    android:orientation="vertical">

                    <TextView
                        android:layout_width="wrap_content"
                        android:layout_height="wrap_content"
                        android:text="@string/check_for_update"
                        android:textColor="@color/senya_blue"
                        android:textSize="16sp" />

                    <TextView
                        android:id="@+id/settings_last_checked"
                        style="@style/SenyaCaption"
                        android:layout_width="wrap_content"
                        android:layout_height="wrap_content" />
                </LinearLayout>
            </LinearLayout>

            <LinearLayout
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="8dp"
                android:gravity="center_vertical"
                android:orientation="horizontal">

                <ImageView
                    android:layout_width="22dp"
                    android:layout_height="22dp"
                    android:contentDescription="@null"
                    android:src="@drawable/ic_info"
                    app:tint="@color/senya_muted" />

                <TextView
                    style="@style/SenyaCaption"
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_marginStart="12dp"
                    android:layout_weight="1"
                    android:text="@string/settings_updates_note" />
            </LinearLayout>

            <LinearLayout
                android:id="@+id/settings_advanced"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="20dp"
                android:orientation="vertical"
                android:visibility="gone">

                <View
                    android:layout_width="match_parent"
                    android:layout_height="1dp"
                    android:background="@color/senya_rule" />

                <LinearLayout
                    android:id="@+id/settings_advanced_header"
                    android:layout_width="match_parent"
                    android:layout_height="64dp"
                    android:background="?attr/selectableItemBackground"
                    android:gravity="center_vertical"
                    android:orientation="horizontal">

                    <LinearLayout
                        android:layout_width="0dp"
                        android:layout_height="wrap_content"
                        android:layout_weight="1"
                        android:orientation="vertical">

                        <TextView
                            style="@style/SenyaSectionTitle"
                            android:layout_width="wrap_content"
                            android:layout_height="wrap_content"
                            android:text="@string/settings_advanced" />

                        <TextView
                            style="@style/SenyaCaption"
                            android:layout_width="wrap_content"
                            android:layout_height="wrap_content"
                            android:text="@string/settings_server_override_short" />
                    </LinearLayout>

                    <ImageView
                        android:id="@+id/settings_advanced_chevron"
                        android:layout_width="24dp"
                        android:layout_height="24dp"
                        android:contentDescription="@null"
                        android:src="@drawable/ic_expand_more"
                        app:tint="@color/senya_muted" />
                </LinearLayout>

                <LinearLayout
                    android:id="@+id/settings_advanced_body"
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:orientation="vertical"
                    android:visibility="gone">

                    <TextView
                        style="@style/SenyaCaption"
                        android:layout_width="wrap_content"
                        android:layout_height="wrap_content"
                        android:text="@string/settings_server_url" />

                    <EditText
                        android:id="@+id/settings_server_override"
                        android:layout_width="match_parent"
                        android:layout_height="wrap_content"
                        android:importantForAutofill="no"
                        android:inputType="textUri" />

                    <LinearLayout
                        android:layout_width="match_parent"
                        android:layout_height="wrap_content"
                        android:layout_marginTop="8dp"
                        android:gravity="center_vertical"
                        android:orientation="horizontal">

                        <com.google.android.material.button.MaterialButton
                            android:id="@+id/settings_reset_server"
                            style="@style/Widget.MaterialComponents.Button.TextButton"
                            android:layout_width="wrap_content"
                            android:layout_height="wrap_content"
                            android:text="@string/settings_reset_default"
                            android:textAllCaps="false" />

                        <Space
                            android:layout_width="0dp"
                            android:layout_height="0dp"
                            android:layout_weight="1" />

                        <com.google.android.material.button.MaterialButton
                            android:id="@+id/settings_save_server"
                            style="@style/SenyaPrimaryButton"
                            android:layout_width="wrap_content"
                            android:layout_height="wrap_content"
                            android:paddingStart="20dp"
                            android:paddingEnd="20dp"
                            android:text="@string/settings_save_changes"
                            android:textSize="15sp" />
                    </LinearLayout>
                </LinearLayout>
            </LinearLayout>
        </LinearLayout>
    </ScrollView>
</LinearLayout>
```

- [ ] **Step 6: Fragment `fragment/SettingsFragment.kt`**

```kotlin
package ph.senya.app.fragment

import android.content.res.ColorStateList
import android.os.Bundle
import android.text.format.DateUtils
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.core.view.isVisible
import androidx.core.widget.ImageViewCompat
import androidx.fragment.app.Fragment
import androidx.navigation.fragment.findNavController
import ph.senya.app.BuildConfig
import ph.senya.app.R
import ph.senya.app.data.ModelRepository
import ph.senya.app.databinding.FragmentSettingsBinding
import ph.senya.app.speech.Speaker
import ph.senya.app.speech.VoiceDialog

/** M4 mockup: voice, model version and updates, and (debug builds only) the server override. */
class SettingsFragment : Fragment() {
    private var _binding: FragmentSettingsBinding? = null
    private val binding get() = _binding!!
    private lateinit var repository: ModelRepository
    private var speaker: Speaker? = null
    private var voiceError: String? = null
    private var voiceChecked = false
    private var voiceSettingsOpened = false

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentSettingsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        repository = ModelRepository(requireContext())
        binding.toolbar.toolbarTitle.setText(R.string.settings)
        binding.toolbar.toolbarBack.setOnClickListener { findNavController().popBackStack() }
        binding.settingsVoiceRow.setOnClickListener { chooseVoice() }
        binding.settingsVoiceStatusRow.setOnClickListener { if (speaker?.isReady != true) openVoiceSettings() }
        binding.settingsTestVoice.setOnClickListener { speaker?.speak(getString(R.string.onboarding_test_phrase)) }
        binding.settingsSpeakOnSpace.isChecked = repository.speakOnSpace
        binding.settingsSpeakOnSpace.setOnCheckedChangeListener { _, on -> repository.speakOnSpace = on }
        binding.settingsCheckUpdate.setOnClickListener {
            findNavController().navigate(R.id.action_settings_to_model_update)
        }
        setUpAdvanced()
        createSpeaker()
    }

    override fun onResume() {
        super.onResume()
        renderModel()
        if (voiceSettingsOpened) {
            voiceSettingsOpened = false
            speaker?.shutdown()
            createSpeaker()
        }
    }

    override fun onDestroyView() {
        speaker?.shutdown()
        speaker = null
        _binding = null
        super.onDestroyView()
    }

    private fun renderModel() {
        val info = repository.currentInfo()
        binding.settingsModelVersion.text =
            if (info == null) getString(R.string.model_none) else getString(R.string.model_version, info.version)
        binding.settingsModelType.text = info?.typeText ?: getString(R.string.model_type_none)
        val last = repository.lastCheckMs
        binding.settingsLastChecked.text = if (last == 0L) getString(R.string.settings_not_checked)
            else getString(R.string.settings_last_checked, DateUtils.getRelativeTimeSpanString(last))
    }

    private fun createSpeaker() {
        voiceError = null
        voiceChecked = false
        speaker = Speaker(requireContext(), { message ->
            activity?.runOnUiThread {
                voiceError = message
                renderVoice()
            }
        }, {
            activity?.runOnUiThread {
                voiceChecked = true
                renderVoice()
            }
        })
        renderVoice()
    }

    private fun renderVoice() {
        val b = _binding ?: return
        val current = speaker
        val voice = current?.availableVoices()?.firstOrNull { it.name == current.selectedVoiceName }
        b.settingsVoiceValue.text = voice?.label ?: getString(if (voiceChecked)
            R.string.onboarding_voice_missing else R.string.onboarding_voice_loading)
        val ready = current?.isReady == true
        b.settingsVoiceStatus.text = when {
            ready -> getString(R.string.onboarding_voice_available)
            !voiceChecked -> getString(R.string.onboarding_voice_loading)
            else -> voiceError ?: getString(R.string.settings_voice_missing)
        }
        b.settingsVoiceStatusIcon.setImageResource(if (ready) R.drawable.ic_check_circle else R.drawable.ic_warning)
        ImageViewCompat.setImageTintList(b.settingsVoiceStatusIcon, ColorStateList.valueOf(
            requireContext().getColor(if (ready) R.color.senya_blue else R.color.senya_warning)))
        b.settingsTestVoice.isEnabled = ready
        b.settingsTestVoice.alpha = if (ready) 1f else 0.5f
    }

    private fun chooseVoice() {
        val current = speaker ?: return
        VoiceDialog.show(requireContext(), current, ::openVoiceSettings, ::renderVoice)
    }

    private fun openVoiceSettings() {
        voiceSettingsOpened = VoiceDialog.openTtsSettings(requireContext())
        if (!voiceSettingsOpened) {
            voiceError = getString(R.string.onboarding_voice_settings_unavailable)
            renderVoice()
        }
    }

    /** Release builds always use the deployed server; only debug builds can point elsewhere. */
    private fun setUpAdvanced() {
        val b = binding
        b.settingsAdvanced.isVisible = BuildConfig.DEBUG
        if (!BuildConfig.DEBUG) return
        b.settingsServerOverride.setText(repository.serverOverride)
        b.settingsServerOverride.hint = BuildConfig.SERVER_URL
        b.settingsAdvancedHeader.setOnClickListener {
            val open = !b.settingsAdvancedBody.isVisible
            b.settingsAdvancedBody.isVisible = open
            b.settingsAdvancedChevron.setImageResource(if (open) R.drawable.ic_expand_less else R.drawable.ic_expand_more)
        }
        b.settingsResetServer.setOnClickListener {
            repository.serverOverride = ""
            b.settingsServerOverride.setText("")
            Toast.makeText(requireContext(), R.string.settings_server_reset, Toast.LENGTH_SHORT).show()
        }
        b.settingsSaveServer.setOnClickListener {
            repository.serverOverride = b.settingsServerOverride.text.toString()
            Toast.makeText(requireContext(), R.string.settings_saved, Toast.LENGTH_SHORT).show()
        }
    }
}
```

- [ ] **Step 7: Navigation, and remove the old dialog**

In `nav_graph.xml`:
- Inside the `camera_fragment` element, add `<action android:id="@+id/action_camera_to_settings" app:destination="@id/settings_fragment" />`.
- Add this destination:

```xml
    <fragment
        android:id="@+id/settings_fragment"
        android:name="ph.senya.app.fragment.SettingsFragment"
        android:label="SettingsFragment">

        <action
            android:id="@+id/action_settings_to_model_update"
            app:destination="@id/model_update_fragment" />
    </fragment>
```

In `CameraFragment.kt`:
- Change the gear listener to `binding.settingsButton.setOnClickListener { Navigation.findNavController(requireActivity(), R.id.fragment_container).navigate(R.id.action_camera_to_settings) }`.
- Delete `showSettings()` entirely, and the imports `AlertDialog`, `BuildConfig`, and `DialogSettingsBinding` if nothing else uses them.

Delete `res/layout/dialog_settings.xml`. Then grep `strings.xml` for `updates_info`, `server_override`, `server_override_help`, and `save`, and delete each one that no longer has any reference under `app/src/main`:

```bash
for s in updates_info server_override server_override_help save; do echo "$s: $(grep -rl "string/$s\"\|R.string.$s\b" app/src/main | wc -l)"; done
```

- [ ] **Step 8: Build and test**

Run: `./gradlew :app:testDebugUnitTest :app:assembleDebug`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 9: Commit**

```bash
git add -A app/src/main app/src/test
git commit -m "android: full-screen Settings with voice, model updates, and debug server override

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Translator screen (M2) with inline permission denied

**Files:**
- Modify: `app/src/main/res/layout/fragment_camera.xml` (rewrite the body; keep the license header)
- Modify: `app/src/main/java/ph/senya/app/fragment/CameraFragment.kt`
- Create: `app/src/main/java/ph/senya/app/fragment/CameraPermission.kt`
- Modify: `fragment/OnboardingFragment.kt` (use `CameraPermission`; always go to the camera)
- Modify: `res/navigation/nav_graph.xml`, `res/values/strings.xml`
- Delete: `fragment/PermissionsFragment.kt`, `res/layout/fragment_permissions.xml`

**Interfaces:**
- Consumes: `StatusTracker` and `TranslatorStatus` (Task 1); `WordSuggester` and `Transcript.completeWord` (Task 2); the Task 5 styles and icons; `action_camera_to_settings` (Task 7).
- Produces: `object CameraPermission { fun granted(context: Context): Boolean }`.

- [ ] **Step 1: CameraPermission, then remove PermissionsFragment**

`fragment/CameraPermission.kt`:

```kotlin
package ph.senya.app.fragment

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat

object CameraPermission {
    fun granted(context: Context) =
        ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
}
```

- Delete `PermissionsFragment.kt` and `fragment_permissions.xml`.
- In `OnboardingFragment.kt`, replace every `PermissionsFragment.hasPermissions(requireContext())` with `CameraPermission.granted(requireContext())`.
- In the `onboarding_complete` branch, replace the `destination` choice with `findNavController().navigate(R.id.action_onboarding_to_camera)`. The camera screen now handles a missing permission itself.
- In `nav_graph.xml`, delete the `permissions_fragment` destination, the `action_onboarding_to_permissions` action, and the `action_camera_to_permissions` action.
- Delete the strings `camera_needed_title` and `camera_needed_body`.

- [ ] **Step 2: Strings**

Add:

```xml
    <string name="app_wordmark">SENYA</string>
    <string name="transcript_label">Transcript</string>
    <string name="guess_hold">Hold steady</string>
    <string name="guess_not_added">Not added</string>
    <string name="guess_recording">Recording movement…</string>
    <string name="guess_added">Added</string>
    <string name="status_hold_steady">Hold the sign steady</string>
    <string name="status_not_sure">Not sure, try again</string>
    <string name="status_finish_movement">Finish the movement</string>
    <string name="status_added">Added %s</string>
    <string name="camera_denied_title">Camera permission denied</string>
    <string name="camera_denied_body">Allow camera access to start signing.</string>
    <string name="grant_permission">Grant permission</string>
```

Delete `<string name="backspace">⌫</string>`. The button now shows `backspace_description` ("Backspace").

- [ ] **Step 3: Rewrite `fragment_camera.xml`**

Keep the license comment. Replace everything after it with:

```xml
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:id="@+id/camera_container"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@color/senya_background"
    android:orientation="vertical">

    <!-- App bar -->
    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="56dp"
        android:background="@color/senya_surface"
        android:gravity="center_vertical"
        android:orientation="horizontal"
        android:paddingStart="16dp"
        android:paddingEnd="12dp">

        <ImageView
            android:layout_width="30dp"
            android:layout_height="30dp"
            android:contentDescription="@null"
            android:src="@drawable/onboarding_hand" />

        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:layout_marginStart="8dp"
            android:letterSpacing="0.04"
            android:text="@string/app_wordmark"
            android:textColor="@color/senya_ink"
            android:textSize="22sp"
            android:textStyle="bold" />

        <TextView
            android:id="@+id/model_version"
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_marginStart="10dp"
            android:layout_weight="1"
            android:ellipsize="end"
            android:maxLines="1"
            android:textColor="@color/senya_muted"
            android:textSize="15sp" />

        <ImageButton
            android:id="@+id/settings_button"
            android:layout_width="44dp"
            android:layout_height="44dp"
            android:background="@drawable/bg_icon_button"
            android:contentDescription="@string/settings"
            android:src="@drawable/ic_settings"
            app:tint="@color/senya_ink" />
    </LinearLayout>

    <!-- Camera -->
    <FrameLayout
        android:id="@+id/camera_area"
        android:layout_width="match_parent"
        android:layout_height="0dp"
        android:layout_weight="1"
        android:background="@android:color/black">

        <androidx.camera.view.PreviewView
            android:id="@+id/view_finder"
            android:layout_width="match_parent"
            android:layout_height="match_parent"
            app:scaleType="fillStart" />

        <ph.senya.app.OverlayView
            android:id="@+id/overlay"
            android:layout_width="match_parent"
            android:layout_height="match_parent" />

        <LinearLayout
            android:id="@+id/permission_denied"
            android:layout_width="match_parent"
            android:layout_height="match_parent"
            android:background="@color/senya_background"
            android:gravity="center"
            android:orientation="vertical"
            android:padding="32dp"
            android:visibility="gone">

            <ImageView
                android:layout_width="96dp"
                android:layout_height="96dp"
                android:contentDescription="@null"
                android:src="@drawable/ic_no_photography"
                app:tint="@color/senya_muted" />

            <TextView
                style="@style/SenyaSectionTitle"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:layout_marginTop="24dp"
                android:text="@string/camera_denied_title" />

            <TextView
                style="@style/SenyaBody"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:layout_marginTop="8dp"
                android:gravity="center"
                android:text="@string/camera_denied_body" />

            <com.google.android.material.button.MaterialButton
                android:id="@+id/grant_permission"
                style="@style/SenyaPrimaryButton"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:layout_marginTop="24dp"
                android:paddingStart="32dp"
                android:paddingEnd="32dp"
                android:text="@string/grant_permission" />
        </LinearLayout>

        <LinearLayout
            android:id="@+id/offline_badge"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:layout_gravity="top|start"
            android:layout_margin="12dp"
            android:background="@drawable/bg_pill"
            android:gravity="center_vertical"
            android:orientation="horizontal"
            android:paddingStart="12dp"
            android:paddingTop="6dp"
            android:paddingEnd="14dp"
            android:paddingBottom="6dp">

            <ImageView
                android:layout_width="18dp"
                android:layout_height="18dp"
                android:contentDescription="@null"
                android:src="@drawable/ic_flight"
                app:tint="@android:color/white" />

            <TextView
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:layout_marginStart="8dp"
                android:text="@string/offline_badge"
                android:textColor="@android:color/white"
                android:textSize="13sp" />
        </LinearLayout>

        <LinearLayout
            android:id="@+id/guess_card"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:layout_gravity="top|end"
            android:layout_margin="12dp"
            android:background="@drawable/bg_card"
            android:minWidth="132dp"
            android:orientation="vertical"
            android:padding="12dp"
            android:visibility="gone">

            <LinearLayout
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:gravity="center_vertical"
                android:orientation="horizontal">

                <com.google.android.material.progressindicator.CircularProgressIndicator
                    android:id="@+id/guess_spinner"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:indeterminate="true"
                    android:visibility="gone"
                    app:indicatorColor="@color/senya_blue"
                    app:indicatorSize="28dp"
                    app:trackThickness="3dp" />

                <TextView
                    android:id="@+id/guess_label"
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_weight="1"
                    android:textColor="@color/senya_ink"
                    android:textSize="30sp"
                    android:textStyle="bold" />

                <TextView
                    android:id="@+id/guess_percent"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:layout_marginStart="12dp"
                    android:textColor="@color/senya_ink"
                    android:textSize="15sp"
                    android:textStyle="bold" />
            </LinearLayout>

            <com.google.android.material.progressindicator.LinearProgressIndicator
                android:id="@+id/guess_confidence"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="6dp"
                android:max="100"
                app:indicatorColor="@color/senya_blue"
                app:trackColor="@color/senya_rule"
                app:trackCornerRadius="2dp"
                app:trackThickness="4dp" />

            <TextView
                android:id="@+id/guess_caption"
                style="@style/SenyaCaption"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:layout_marginTop="4dp" />
        </LinearLayout>

        <ImageButton
            android:id="@+id/flip_camera_button"
            android:layout_width="44dp"
            android:layout_height="44dp"
            android:layout_gravity="bottom|end"
            android:layout_margin="12dp"
            android:background="@drawable/bg_round_dark"
            android:contentDescription="@string/flip_camera"
            android:src="@drawable/ic_cameraswitch"
            app:tint="@android:color/white" />
    </FrameLayout>

    <!-- Status -->
    <LinearLayout
        android:id="@+id/status_row"
        android:layout_width="match_parent"
        android:layout_height="48dp"
        android:background="@color/senya_surface"
        android:gravity="center_vertical"
        android:orientation="horizontal"
        android:paddingStart="20dp"
        android:paddingEnd="20dp">

        <FrameLayout
            android:layout_width="24dp"
            android:layout_height="24dp">

            <ImageView
                android:id="@+id/status_icon"
                android:layout_width="24dp"
                android:layout_height="24dp"
                android:contentDescription="@null"
                android:src="@drawable/ic_back_hand"
                app:tint="@color/senya_ink" />

            <com.google.android.material.progressindicator.CircularProgressIndicator
                android:id="@+id/status_spinner"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:layout_gravity="center"
                android:indeterminate="true"
                android:visibility="gone"
                app:indicatorColor="@color/senya_blue"
                app:indicatorSize="20dp"
                app:trackThickness="3dp" />
        </FrameLayout>

        <TextView
            android:id="@+id/hand_hint"
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_marginStart="12dp"
            android:layout_weight="1"
            android:text="@string/hand_hint"
            android:textColor="@color/senya_ink"
            android:textSize="16sp" />
    </LinearLayout>

    <!-- Transcript -->
    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_margin="12dp"
        android:background="@drawable/bg_card"
        android:orientation="vertical"
        android:padding="16dp">

        <TextView
            style="@style/SenyaCaption"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="@string/transcript_label"
            android:textSize="14sp" />

        <TextView
            android:id="@+id/transcript"
            android:layout_width="match_parent"
            android:layout_height="88dp"
            android:gravity="bottom|start"
            android:hint="@string/transcript_placeholder"
            android:maxLines="2"
            android:textColor="@color/senya_ink"
            android:textColorHint="@color/senya_muted"
            android:textStyle="bold"
            app:autoSizeMaxTextSize="48sp"
            app:autoSizeMinTextSize="20sp"
            app:autoSizeTextType="uniform" />

        <LinearLayout
            android:id="@+id/suggestions"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_marginTop="12dp"
            android:orientation="horizontal">

            <TextView
                android:id="@+id/suggestion_1"
                style="@style/SenyaSuggestion"
                android:visibility="invisible" />

            <TextView
                android:id="@+id/suggestion_2"
                style="@style/SenyaSuggestion"
                android:layout_marginStart="8dp"
                android:visibility="invisible" />

            <TextView
                android:id="@+id/suggestion_3"
                style="@style/SenyaSuggestion"
                android:layout_marginStart="8dp"
                android:visibility="invisible" />
        </LinearLayout>

        <LinearLayout
            android:layout_width="match_parent"
            android:layout_height="64dp"
            android:layout_marginTop="12dp"
            android:orientation="horizontal">

            <com.google.android.material.button.MaterialButton
                android:id="@+id/speak_button"
                style="@style/SenyaPrimaryButton"
                android:layout_width="0dp"
                android:layout_height="match_parent"
                android:layout_weight="2"
                android:text="@string/speak"
                android:textSize="20sp"
                app:icon="@drawable/ic_volume_up"
                app:iconGravity="textStart"
                app:iconSize="28dp" />

            <com.google.android.material.button.MaterialButton
                android:id="@+id/backspace_button"
                style="@style/SenyaToolButton"
                android:layout_width="0dp"
                android:layout_height="match_parent"
                android:layout_marginStart="8dp"
                android:layout_weight="1"
                android:text="@string/backspace_description"
                app:icon="@drawable/ic_backspace" />

            <com.google.android.material.button.MaterialButton
                android:id="@+id/clear_button"
                style="@style/SenyaToolButton"
                android:layout_width="0dp"
                android:layout_height="match_parent"
                android:layout_marginStart="8dp"
                android:layout_weight="1"
                android:text="@string/clear"
                app:icon="@drawable/ic_ink_eraser" />
        </LinearLayout>
    </LinearLayout>
</LinearLayout>
```

- [ ] **Step 4: CameraFragment changes**

Make these edits to `CameraFragment.kt`. Keep everything else as it is: camera binding, `detectHand`, `loadCurrentModel`, `applyBundle`, `flipCamera`, and `checkForUpdate`.

(a) Imports to add:

```kotlin
import android.Manifest
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.net.Uri
import android.provider.Settings
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.ColorRes
import androidx.annotation.DrawableRes
import androidx.core.view.isVisible
import androidx.core.widget.ImageViewCompat
import ph.senya.app.core.StatusTracker
import ph.senya.app.core.TranslatorStatus
import ph.senya.app.core.WordSuggester
import kotlin.math.roundToInt
```

Remove the imports `ph.senya.app.core.Prediction` and `PermissionsFragment` usage if they become unused.

(b) Fields: delete `modelLabel` and `motionShownUntilMs`. Add:

```kotlin
    private val statusTracker = StatusTracker()
    private lateinit var suggester: WordSuggester
    private var suggestions = emptyList<String>()
    private var cameraStarted = false
    private var deniedOnce = false
    private var caretOn = true

    private val cameraPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) startCamera() else {
            deniedOnce = true
            showPermissionDenied()
        }
    }

    /** Blinks the transcript caret, as in the M2 mockup. */
    private val caretBlink = object : Runnable {
        override fun run() {
            caretOn = !caretOn
            renderTranscript()
            _binding?.transcript?.postDelayed(this, 530)
        }
    }
```

(c) `onResume`: replace the permission navigation block with:

```kotlin
        // Back from the system settings screen with the permission granted
        if (!cameraStarted && CameraPermission.granted(requireContext())) startCamera()
        binding.transcript.removeCallbacks(caretBlink)
        binding.transcript.post(caretBlink)
```

Keep the existing `backgroundExecutor.execute { ... setupHandLandmarker() }` line after it.

(d) `onPause`: add `_binding?.transcript?.removeCallbacks(caretBlink)` as the first line after `super.onPause()`.

(e) `onViewCreated`:
- Replace `binding.viewFinder.post { setUpCamera() }` with:

```kotlin
        if (CameraPermission.granted(requireContext())) startCamera() else showPermissionDenied()
        binding.grantPermission.setOnClickListener { requestCamera() }
```

- Replace the backspace/clear listeners and `renderTranscript()` call with:

```kotlin
        suggester = WordSuggester(requireContext().assets.open("words.txt").bufferedReader().use { it.readLines() })
        binding.backspaceButton.setOnClickListener { transcript.backspace(); afterEdit() }
        binding.clearButton.setOnClickListener { transcript.clear(); afterEdit() }
        listOf(binding.suggestion1, binding.suggestion2, binding.suggestion3).forEachIndexed { i, chip ->
            chip.setOnClickListener {
                val word = suggestions.getOrNull(i) ?: return@setOnClickListener
                transcript.completeWord(word)
                afterEdit()
                if (repository.speakOnSpace) speaker?.speak(word)
            }
        }
        onTranscriptChanged()
        renderStatus(TranslatorStatus.NoHand)
```

- `showModelLabel(getString(R.string.no_model))` stays. `repository = ModelRepository(...)` must come **before** the chip listeners that read it, so move that line up to just after `modelExecutor = ...`.

(f) Add the permission and camera helpers:

```kotlin
    private fun startCamera() {
        cameraStarted = true
        binding.permissionDenied.isVisible = false
        binding.flipCameraButton.isVisible = true
        binding.statusRow.isVisible = true
        binding.viewFinder.post { setUpCamera() }
    }

    /** Spec §5.4 and the M2 mockup: explain inline and offer to ask again. */
    private fun showPermissionDenied() {
        binding.permissionDenied.isVisible = true
        binding.flipCameraButton.isVisible = false
        binding.guessCard.isVisible = false
        binding.statusRow.isVisible = false
    }

    private fun requestCamera() {
        if (deniedOnce && !shouldShowRequestPermissionRationale(Manifest.permission.CAMERA)) {
            // "Don't ask again": only the system settings screen can grant it now
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", requireContext().packageName, null)))
        } else {
            cameraPermission.launch(Manifest.permission.CAMERA)
        }
    }
```

(g) In `onResults`, inside `runOnUiThread`:
- Replace the `binding.handHint.visibility = ...` line and the whole `motionGuess` / `showGuess` `if/else` with `renderStatus(statusTracker.onFrame(result.timestampMs(), landmarks != null, out))`.
- Replace `renderTranscript()` in the events block with `onTranscriptChanged()`.
- Delete the `binding.modelVersion.text = "$modelLabel · $currentFps fps"` line. The `Log.d` with fps stays.

(h) Replace `applyBundle`'s label line and `showModelLabel`:

```kotlin
        showModelLabel(getString(
            if (newBundle.motion == null) R.string.model_version_static_only else R.string.model_version,
            newBundle.version))
```

```kotlin
    private fun showModelLabel(text: String) {
        activity?.runOnUiThread { _binding?.modelVersion?.text = text }
    }
```

(i) Delete `showGuess`. Replace `afterEdit` and `renderTranscript`, and add the new render helpers:

```kotlin
    private fun afterEdit() {
        engine.onTranscriptEdited(transcript.isEmpty || transcript.endsWithSpace)
        onTranscriptChanged()
    }

    private fun onTranscriptChanged() {
        renderTranscript()
        suggestions = suggester.suggest(transcript.text)
        listOf(binding.suggestion1, binding.suggestion2, binding.suggestion3).forEachIndexed { i, chip ->
            val word = suggestions.getOrNull(i)
            chip.visibility = if (word == null) View.INVISIBLE else View.VISIBLE
            chip.text = word
            chip.isSelected = i == 0
        }
    }

    /** The text plus a blinking caret; empty shows the hint instead. */
    private fun renderTranscript() {
        val b = _binding ?: return
        val text = transcript.text
        if (text.isEmpty()) {
            b.transcript.text = ""
            return
        }
        val caretColor = if (caretOn) requireContext().getColor(R.color.senya_blue) else Color.TRANSPARENT
        b.transcript.text = SpannableStringBuilder(text).apply {
            val start = length
            append("|")
            setSpan(ForegroundColorSpan(caretColor), start, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
    }

    private fun renderStatus(status: TranslatorStatus) {
        val b = binding
        val recording = status is TranslatorStatus.Recording
        b.guessCard.isVisible = status !is TranslatorStatus.NoHand
        b.guessSpinner.isVisible = recording
        b.guessLabel.isVisible = !recording
        b.guessPercent.isVisible = !recording
        b.guessConfidence.isVisible = !recording
        b.statusSpinner.isVisible = recording
        b.statusIcon.isVisible = !recording
        when (status) {
            is TranslatorStatus.NoHand -> hint(R.drawable.ic_back_hand, R.color.senya_ink, getString(R.string.hand_hint))
            is TranslatorStatus.Holding -> {
                guess(status.label, status.confidence, R.string.guess_hold)
                hint(R.drawable.ic_back_hand, R.color.senya_ink, getString(R.string.status_hold_steady))
            }
            is TranslatorStatus.Unsure -> {
                guess("?", status.confidence, R.string.guess_not_added)
                hint(R.drawable.ic_warning, R.color.senya_warning, getString(R.string.status_not_sure))
            }
            is TranslatorStatus.Recording -> {
                b.guessCaption.setText(R.string.guess_recording)
                b.handHint.setText(R.string.status_finish_movement)
            }
            is TranslatorStatus.AddedMotion -> {
                guess(status.label, status.confidence, R.string.guess_added)
                hint(R.drawable.ic_check_circle, R.color.senya_blue, getString(R.string.status_added, status.label))
            }
        }
    }

    private fun guess(label: String, confidence: Float, caption: Int) {
        val percent = (confidence * 100).roundToInt().coerceIn(0, 100)
        binding.guessLabel.text = label
        binding.guessPercent.text = getString(R.string.percent, percent)
        binding.guessConfidence.progress = percent
        binding.guessCaption.setText(caption)
    }

    private fun hint(@DrawableRes icon: Int, @ColorRes tint: Int, text: String) {
        binding.statusIcon.setImageResource(icon)
        ImageViewCompat.setImageTintList(binding.statusIcon, ColorStateList.valueOf(requireContext().getColor(tint)))
        binding.handHint.text = text
    }
```

- [ ] **Step 5: Build and test**

Run: `./gradlew :app:testDebugUnitTest :app:assembleDebug`
Expected: BUILD SUCCESSFUL. If grep still finds `PermissionsFragment` (`grep -rn PermissionsFragment app/src`), nothing may remain. Expected output: none.

- [ ] **Step 6: Commit**

```bash
git add -A app/src/main
git commit -m "android: M2 translator screen with status card, suggestions, and inline permission state

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Device walkthrough against the mockups

**Files:** none, unless a defect is found. Fix defects in the file that owns them, then re-run Step 1.

The user taps the phone. The agent installs the app, captures screenshots, and compares them to the mockups. Screenshot command: `"$LOCALAPPDATA/Android/Sdk/platform-tools/adb" exec-out screencap -p > <scratchpad>/<name>.png`, then read the PNG.

- [ ] **Step 1:** `./gradlew :app:assembleDebug` and `adb install -r app/build/outputs/apk/debug/app-debug.apk`, then `adb shell am start -n ph.senya.app/.MainActivity`.
- [ ] **Step 2: No hand.** Ask the user to point the camera away from any hand.
  Expected: a white app bar with "SENYA" and "v<N>", the "Offline · on-device" badge, no guess card, the hint "Show your hand to the camera", and the transcript card. The status bar is white with dark icons.
- [ ] **Step 3: Holding / low confidence.** Ask the user to show a clear letter, then a half-formed shape.
  Expected: the card shows the letter, a percentage, and "Hold steady"; then "?", a percentage under 70, and "Not added" with "Not sure, try again". It must not flicker between the two on every frame.
- [ ] **Step 4: Recording.** Ask the user to sign J or Z.
  Expected: the card shows a spinner and "Recording movement…", the hint says "Finish the movement", and the trail is drawn. After the movement, "Added J" shows for about 1 s.
- [ ] **Step 5: Suggestions.** Ask the user to spell "MA".
  Expected: the chips read MA (highlighted), MAGANDA, MAGANDANG UMAGA. Tapping MAGANDA makes the transcript "MAGANDA " and the chips disappear. Backspace removes the space. Long text shrinks and never pushes the buttons off screen.
- [ ] **Step 6: Settings.** Ask the user to tap the gear.
  Expected: the M4 layout shows Speech (a voice like "Filipino · Voice 1", "Available offline", "Test voice “MAGANDA”"), Models (installed version, type, "Check for update" with "Not checked yet" or "Last checked …"), and Advanced (debug build; it expands to the server URL field). Return to the camera. Expected: the transcript text from Step 5 is still there.
- [ ] **Step 7: Model update, online.** Ask the user to go to Settings → Check for update.
  Expected: Checking → (Downloading with two bars → Verifying with two rows → Updated successfully) **or** "You're up to date". Then **Start signing** / **Continue signing** returns to the camera, and the app bar shows the new version.
- [ ] **Step 8: Model update, offline.** Ask the user to turn on airplane mode and check again.
  Expected: "Update failed", "Can't reach server (…).", "Kept your current model.", with **Try again** and **Continue signing**. Then ask the user to start a check online and tap **Cancel** within a second. Expected: the screen closes at once, and `adb logcat -d | grep -i senya` shows no crash.
- [ ] **Step 9: Permission denied.** Ask the user to deny the camera in system settings (App info → Permissions → Camera → Don't allow) and reopen Senya.
  Expected: the M2 "Camera permission denied" panel with **Grant permission**. Tapping it either shows the system prompt or opens App info. After allowing, returning to Senya starts the camera without a restart.
- [ ] **Step 10:** Report every mismatch from the mockups to the user, with the screenshot path. After fixes, commit them:

```bash
git commit -am "android: fixes from the device walkthrough

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

States that can't be reached on the device without changing the server (static-only, rolled back, no model published) are covered by `UpdateFlowTest` and `ModelUpdaterTest`. Mention this in the report instead of changing the backend.
