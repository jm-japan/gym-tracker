# Gym Tracker (v1.1)

A lightweight, offline gym program tracker. It runs as an installable web app (PWA) on your Android phone. Your data is stored on the phone itself.

## What's new in v1.1
- **Sticky header** at the top of the workout: shows "Up next: exercise · set", workout time, and a live **"since last set"** clock. The **↓ Next** button jumps back to your active set, or to Finish when everything is done.
- **Active highlight:** the current exercise and set have a lime outline.
- **Fail a set:** tap the red ✗ next to ✓. The set is saved as failed, and the app offers to **Repeat** it (it adds a copy of the set right below).
- **Timestamps:** every ticked or failed set records its time. Each set shows "Done 19:42 · rest 2:41". The rest turns orange with ⚠️ when it's shorter than your rest-timer setting (warm-ups are ignored). Rest = time between finishing one set and finishing the next, so it includes how long the set itself took.
- **Collapse:** an exercise rolls up to its heading once all its sets are done. Tap the heading or **+ / −** to open or close it.
- **Reorder on the fly:** use **▶ Do next** on any later exercise (e.g. when equipment is busy), or **↓ Later** on the current one. The saved workout keeps the order you actually did.
- History shows failed sets in red, plus the rest time on each set. The CSV export has new `failed`, `completed_at` and `rest_sec` columns.

## What's in v1
- **Programs → days → exercises → sets.** Each set is a warm-up, working or back-off set, with either a fixed kg weight or a % of your max. Reps can be a range (8–10), and a set can have an RIR target or an AMRAP flag.
- **Logging a workout.** Weights are pre-filled. For each set you see what you did last time ("Last: 100×5"). Tick ✓ when a set is done.
- **AMRAP helper.** On AMRAP or RIR sets for a lift with a max, the app shows *"Match 1RM (140): 5 reps @ 120 kg"*, plus a live estimated 1RM (e1RM) as you type.
- **Maxes screen.** Enter your 1RM by hand. It also suggests a "best estimate from your logs" that you can apply with one tap.
- **History.** You can view past workouts and a progress table per exercise, with ★ marking a new best e1RM.
- **Rest timer.** It starts automatically when you tick a set, shows −15/+15 buttons, and vibrates when time is up. Everything is configurable in Data, and the app keeps the screen on during workouts.
- **Backup.** You can share or download a backup (.json), restore from a backup, or export your logged sets as a CSV file (opens in Excel or Sheets).

Formula used: **Epley**, `e1RM = weight × (1 + reps ÷ 30)`.

---

## 1. Try it on your Mac first (2 minutes)
Open **Terminal** and run:
```bash
cd ~/Downloads/gym-tracker        # wherever you unzipped it
python3 -m http.server 8000
```
Then open <http://localhost:8000> in Chrome. Press `Cmd+Option+I` and click the phone icon to see it at phone size. Press `Ctrl+C` in Terminal to stop the server.

> Opening `index.html` by double-clicking won't work properly. The database and offline mode need a real web server, even a local one.

## 2. Publish it free on GitHub Pages

### Option A: no command line
1. Create a free account at <https://github.com>.
2. Click **New repository** and name it `gym-tracker`. Choose **Public**. GitHub Pages is free for public repos. Your *data* is never uploaded, only the app code.
3. On the new repo page, click **uploading an existing file**. Drag in **everything inside** the `gym-tracker` folder, including the `icons` folder, then click **Commit changes**.
4. Go to **Settings → Pages**. Under "Build and deployment", set Source to **Deploy from a branch**, Branch to **main**, and folder to **/ (root)**. Click **Save**.
5. Wait about a minute. Your app will be at `https://<your-username>.github.io/gym-tracker/`.

### Option B: the developer way (the challenge 💪)
```bash
xcode-select --install            # one-time: installs git on macOS
cd ~/Downloads/gym-tracker
git init
git add .
git commit -m "Gym tracker v1"
git branch -M main
git remote add origin https://github.com/<your-username>/gym-tracker.git
git push -u origin main           # GitHub will ask you to sign in
```
Then do step 4 from Option A. For future updates, run `git add . && git commit -m "what changed" && git push`.

## 3. Install it on your Xiaomi
1. Open your GitHub Pages link in **Chrome** on the phone.
2. Tap **⋮ → Add to Home screen → Install**.
3. If no icon appears: HyperOS sometimes blocks shortcuts. Go to **Settings → Apps → Manage apps → Chrome → Other permissions** and allow **Home screen shortcuts**. Then try again.
4. Open the app from the new icon. It runs full-screen and works offline at the gym.

**Getting updates:** after you push a change, open the app, close it, then open it again.

**Updating from v1.0 to v1.1:** upload the changed files (`app.js`, `styles.css`, `sw.js`, `README.md`) to your repo, replacing the old ones. In GitHub's web upload, drag them in and commit. With git, `git add . && git commit -m "v1.1" && git push`. Your logged workouts stay on the phone and are kept. If you're halfway through a workout, it continues in the new version.

## ⚠️ Protect your data
- Your data lives in Chrome's storage for this app. **Clearing Chrome's site data, or uninstalling Chrome, deletes it.**
- Use **Data → Share backup file…** regularly (e.g. save it to Google Drive). The Train screen reminds you every 14 days.
- To move to a new phone, install the app there and use **Restore from backup**.

---

## How the code is organised
| File | What it does |
|---|---|
| `index.html` | Page shell: bottom navigation, timer bar, script includes |
| `styles.css` | All styling (colors are set at the top as variables) |
| `seed.js` | Your starting 3-day program. Edit it here or in the app |
| `app.js` | All screens (`VIEWS`), button actions (`ACT`), input handlers (`CH`), and calculations (`Calc`) |
| `db.js` | Saves and loads data in the browser database (IndexedDB) |
| `sw.js` | Service worker that makes the app work offline. **Bump `CACHE` if you add files** |
| `manifest.webmanifest` | App name, icon and colors for "install" |

Good first changes to try yourself:
- Change the accent color: in `styles.css`, edit `--accent`.
- Change the default rest time: in `app.js`, edit `DEFAULT_SETTINGS`.

## Ideas for v2
- Automatic 1RM calculation, with a choice of formula (Epley/Brzycki) and a training max %
- Progress charts per lift
- Auto-progression rules (e.g. "hit the top of the rep range → add 2.5 kg next time")
- Editing past workouts, and a plate calculator
