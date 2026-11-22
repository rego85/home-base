# Home Base setup

Home Base is a plain web app with no build step and nothing to install. It runs in three stages:

1. **Right now:** open it locally. Everything works except syncing, so lists stay on that one device.
2. **Put it online** (GitHub Pages, free) so your phone can reach it, and install it on your Android home screen.
3. **Turn on sync** (Firebase, free) so you and your partner share one grocery list, chore list and set of notes.

Total time is about 15–20 minutes.

---

## 1. Try it on your PC

From this folder, run:

```powershell
python -m http.server 8080
```

Then open http://localhost:8080. Opening `index.html` directly with a double-click also mostly works, but location and offline mode need the local server.

## 2. Put it online with GitHub Pages

1. Create a free account at https://github.com if you don't have one.
2. Click **New repository**, name it `home-base`, and set it to **Public**. GitHub Pages is free for public repos. The repo holds only app code; your lists live in Firebase, not in the repo.
3. On the new repo page, click **uploading an existing file**, drag in everything in this folder (including the `icons` folder), and click **Commit changes**.
4. Go to **Settings → Pages**. Under *Branch*, choose `main` and `/ (root)`, then click **Save**.
5. After about a minute your dashboard is live at `https://YOUR-USERNAME.github.io/home-base/`.

### Install on Android

1. Open that link in **Chrome** on your phone.
2. Tap the **⋮** menu, then **Add to Home screen**, then **Install**.
3. Home Base now opens full-screen like a normal app. Allow location when it asks, so the forecast follows you. If you say no, it uses Woodland Park.

Do the same on your partner's phone.

## 3. Turn on sync with Firebase

1. Go to https://console.firebase.google.com and click **Create a project**. Name it `home-base`. You can turn off Google Analytics.
2. **Add a web app:** on the project overview, click the **</>** (Web) icon, nickname it `Home Base`, and skip hosting. Firebase shows a `firebaseConfig = { ... }` block. Copy the values inside the braces.
3. Open `config.js` and replace `firebase: null,` with your config:
   ```js
   firebase: {
     apiKey: "AIza...",
     authDomain: "home-base-xxxx.firebaseapp.com",
     projectId: "home-base-xxxx",
     storageBucket: "home-base-xxxx.appspot.com",
     messagingSenderId: "1234567890",
     appId: "1:1234567890:web:abc123"
   },
   ```
   These values aren't secret, so they can sit in a public repo. Access is controlled by the rules in step 6.
4. **Turn on sign-in:** go to **Build → Authentication → Get started → Google**, toggle it **on**, pick a support email, and click **Save**.
5. **Allow your site:** in **Authentication → Settings → Authorized domains**, click **Add domain** and enter `YOUR-USERNAME.github.io`.
6. **Create the database:** go to **Build → Firestore Database → Create database**, pick a US location, and start in **production mode**. Then open the **Rules** tab, paste this, put in your own two Gmail addresses, and click **Publish**:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /households/{household}/{document=**} {
         allow read, write: if request.auth != null
           && request.auth.token.email in ['you@gmail.com', 'partner@gmail.com'];
       }
     }
   }
   ```
   Only those two Google accounts can read or change your lists.
7. Upload the edited `config.js` to your GitHub repo (open the repo, then **Add file → Upload files**). Reload Home Base and sign in with Google. The pill in the top-right corner changes to **Synced**.

## 4. Settings in `config.js`

| Setting | What it does |
|---|---|
| `homeLocation` | Fallback location for weather. Set to Woodland Park, CO. |
| `useDeviceLocation` | `true` uses your phone's location first. |
| `binsNight` | `0` = Sunday. Pickup is assumed to be the next morning. |
| `calendarEmbedUrl` | Shows your Google Calendar agenda (see step 5). |

After changing any file, also change `VERSION` in `sw.js` (for example to `home-base-v2`) so installed phones pick up the update.

## 5. Show your Google Calendar (optional)

1. On a computer, open https://calendar.google.com, then **⚙ Settings**, then click your calendar under *Settings for my calendars*.
2. Scroll to **Integrate calendar** and copy the **Embed code** URL (the part inside `src="..."`).
3. Paste it into `calendarEmbedUrl` in `config.js`.

The calendar stays private. It only shows events to someone signed in to a Google account that has access to it. To show both of your calendars, share your calendar with your partner in Google Calendar first, and add `&src=PARTNER_CALENDAR_ID` to the end of the embed URL.

## 6. Voice groceries

Tap the **mic button** next to the grocery box and speak. This works right away in Chrome on Android and Windows, with no setup:

- "Add milk, eggs and bread"
- "We need coffee"
- "Remove eggs"

**Shortcut:** long-press the Home Base icon on your Android home screen and choose **Add groceries by voice**. Home Base opens with the mic ready.

### Smarter voice commands with Claude (optional)

Without Claude, the mic understands only simple "add X and Y" or "remove X" commands. With Claude it also handles requests like these:

- "We're out of eggs and grab stuff for tacos" adds Eggs, Tortillas, Ground beef, Cheese, Lettuce, Salsa…
- "Got the milk, and add two pounds of chicken" removes Milk and adds Chicken (2 lb)
- Misheard words get fixed, so "add Siri al" is read as Cereal

This needs Firebase sync (step 3) to be on, because only signed-in household members may use it. Your API key goes in a free Cloudflare Worker, never in the website, so nobody can find it and spend your credit.

1. **Get a Claude API key.** Go to https://console.anthropic.com, add a small amount of prepaid credit under **Billing**, then go to **API Keys → Create Key** and copy the key.
   Each voice command costs about a cent or less with the default model (Claude Opus 5.5). For the lowest cost, set `MODEL` to `claude-haiku-5-5` in step 3 below, which costs a small fraction of a cent per command.
2. **Create the worker.** Sign up free at https://dash.cloudflare.com. Go to **Workers & Pages → Create → Create Worker**, name it `home-base-claude`, and click **Deploy**. Then click **Edit code**, delete the sample code, paste in everything from [`claude-worker/worker.js`](claude-worker/worker.js), and click **Deploy**.
3. **Add the settings.** In the worker, go to **Settings → Variables and Secrets** and add:

   | Name | Type | Value |
   |---|---|---|
   | `ANTHROPIC_API_KEY` | Secret | the key from step 1 |
   | `FIREBASE_API_KEY` | Text | the `apiKey` value from your `config.js` |
   | `ALLOWED_EMAILS` | Text | `you@gmail.com,partner@gmail.com` (same as your Firestore rules) |
   | `ALLOWED_ORIGIN` | Text | `https://YOUR-USERNAME.github.io` |
   | `MODEL` | Text | optional, for example `claude-haiku-5-5` |

4. **Point Home Base at it.** Copy the worker's address (for example `https://home-base-claude.yourname.workers.dev`) into `workerUrl` in `config.js`, upload `config.js` to GitHub, and bump `VERSION` in `sw.js`.

When Claude has handled a request, a green line under the grocery box shows its reply. If the worker can't be reached, Home Base falls back to the simple parser, so the mic keeps working.

## 7. Upcoming bills from Gmail (optional)

The **Upcoming bills** card searches your Gmail for bill, statement and autopay emails from the last 45 days. It shows the payee, amount and due date for each bill, and the total due in the next 2 weeks. Bills due within 2 days also appear in the strip at the top.

Home Base reads Gmail directly in your browser with read-only access. It can't send, delete or change email. The bills it finds are saved to your shared Firebase lists, so your partner sees them too. The email text itself isn't saved.

**Set up Gmail access (about 10 minutes, one time):**

1. Go to https://console.cloud.google.com and pick your Firebase project (`home-base-xxxx`) from the project menu at the top. A Firebase project is already a Google Cloud project.
2. **Turn on the Gmail API:** go to **APIs & Services → Library**, search for **Gmail API**, and click **Enable**.
3. **Set up the consent screen:** go to **APIs & Services → OAuth consent screen** (shown as **Google Auth Platform** in newer consoles).
   - Choose **External**, name the app `Home Base`, and enter your email where it asks.
   - Under **Data access** (or **Scopes**), add `https://www.googleapis.com/auth/gmail.readonly`.
   - Under **Audience** (or **Test users**), leave the app in **Testing** and add your Gmail address and your partner's as test users.
4. **Create the client ID:** go to **APIs & Services → Credentials → Create credentials → OAuth client ID**, choose **Web application**, and under **Authorized JavaScript origins** add:
   - `https://YOUR-USERNAME.github.io`
   - `http://localhost:8080` (for testing on your PC)

   Click **Create** and copy the **Client ID**.
5. Paste it into `gmail.clientId` in `config.js`, upload the file to GitHub, and bump `VERSION` in `sw.js`.
6. Tap **Check Gmail** on the dashboard. Google warns *"Google hasn't verified this app"* because it's your own private app. Tap **Continue**, then allow read access.

Tap **Check Gmail** whenever you want to refresh. Google asks you to approve again about once an hour, usually with a single tap. Each person can connect their own Gmail, and every bill found goes into the shared list.

**How bills are read:**
- **With the Claude worker from step 6:** the new emails' text goes to Claude, which picks out the payee, amount and due date, tells real bills apart from ads, and spots "payment received" emails. It's accurate even with odd email formats. A scan of 25 new emails costs a few cents with the default model, or less with `claude-haiku-5-5`. Emails already checked are never sent again.
- **Without the worker:** a built-in reader looks for dollar amounts and phrases like "due Dec 5". It works for most utility and credit card emails, but it may miss due dates or catch the odd ad.

**On each bill:** **Paid** clears it from the list. **×** hides an email that isn't a bill. **Open email** opens it in Gmail. When a "payment received" email arrives, the matching bill is marked paid automatically.

To change which emails count, edit `gmail.query` in `config.js`. It uses the same syntax as the Gmail search box, for example `from:(xcelenergy.com OR chase.com) newer_than:60d`.

## 8. Ute Pass traffic and top news

Both panels get their data through the same Cloudflare Worker as step 6. You don't need a Claude API key or Firebase for these two.

**If you haven't made the worker yet:** do step 6, part 2 (create the worker and paste in `claude-worker/worker.js`). Then add the `ALLOWED_ORIGIN` setting, and put the worker's address in `workerUrl` in `config.js`. You can skip the other settings in that step until you want the Claude features.

**If you already made the worker in step 6:** paste in the latest `claude-worker/worker.js` and click **Deploy**, since it now includes traffic and news.

**Top news** works as soon as the worker is running. It shows the day's top U.S. headline from Google News and four more below it. The **Local** tab shows headlines about Colorado Springs, Woodland Park, Teller County and Ute Pass from the last day.

**Traffic** needs a free TomTom key, which has no credit card and allows 2,500 free requests a day. Home Base checks every 5 minutes while it's on screen, which stays under 900 a day even if it's open all day.

1. Sign up at https://developer.tomtom.com, open **Dashboard → Keys**, and copy the default key.
2. In the Cloudflare worker, go to **Settings → Variables and Secrets** and add `TOMTOM_KEY` as a **Secret**.

The panel then shows:
- Live drive times down to Colorado Springs and back up to Woodland Park, with the usual time for comparison.
- A **Clear**, **+X min** or **Closed** status.
- Any crashes, closures or roadwork reported on US-24.
- A snow warning on snowy days.

Big delays and closures also appear in the strip at the top. **Google Maps** opens the route with live traffic, and **COtrip** opens CDOT's official road conditions map. To watch a different drive, change `traffic` in `config.js`.

## 9. Wall view (for a screen that's always on)

Click **Wall view** in the top-right corner to fit everything on one screen with no scrolling. It's laid out for a 1920×1080 screen and scales to other sizes. It shows a large clock, and the screen stays awake while it's open. **Full screen** hides the browser's toolbars, and **Scroll view** switches back.

Each device remembers its own choice, so your phone can stay on the scrolling view while the wall screen stays on the wall view. To open the wall view without changing a device's saved choice, use https://rego85.github.io/home-base/#wall.

## How each card works

- **Bins:** The card only appears on garbage night (Sunday). It says whether it's **trash only** or **trash + recycling**. Trash goes every week, and recycling every other week, counting from the Nov 30, 2026 pickup. If the schedule changes, edit `recycling` in `config.js`. It fills the top row with a glowing highlight and says *Put the bins out tonight*. If gusts of 30 mph or more are forecast overnight, it warns you to weigh down the lids. Tapping **Bins are out** marks it done for everyone and turns the highlight off.
- **Yard work:** It compares the forecast for Saturday and Sunday (rain chance, snow, cold, wind) and marks the better day. Tap **Mark done** once it's done that weekend. The status resets the next weekend.
- **Weather alerts:** Official National Weather Service alerts, plus Home Base's own warnings for high wind, heavy snow, frost (May–October), bitter cold and thunderstorms.
- **Chores:** Each chore has an interval. Tapping **Done** starts the countdown over and records who did it.
- **Groceries:** Add several items at once with commas, for example `milk, eggs, bread`. Check items off at the store, then tap **Clear checked items**.

## Planned (not built yet)

- **Walmart grocery link:** connect the grocery list to Walmart, so items on the list can be added to a Walmart cart or order. Noted on Nov 22, 2026, to build later.
