# Endurance One

A responsive Ironman training companion for the plan running September 28, 2026 through race day on June 13, 2027. The weekly calendar, workout detail, completion tracking, training-block progress, substitutions, and missed-session guidance are all available in the app.

## Run locally

```sh
npm install
npm run dev
```

Create and verify a production build with `npm run build`; run static checks with `npm run lint`.

## Training plan

The plan generator in `src/data/trainingPlan.ts` creates each day's sessions across 37 weeks. It follows a Monday recovery, Tuesday swim and run, Wednesday bike and strength, Thursday swim and run, Friday recovery, Saturday long ride, Sunday long run rhythm. Training load builds through base, build, and peak blocks, includes periodic lighter weeks, tapers over the final four weeks, and ends with the full-distance event on June 13.

Durations and distances are starter targets, not individualized coaching. Adjust them to current fitness, recovery, course conditions, and advice from a qualified coach or medical professional. Workout effort guidance favors conversational aerobic work and controlled intensity.

## App behavior

- Workout completion and light/dark theme are saved in browser local storage.
- Garmin FIT, TCX, GPX, and bulk-export ZIP files can be imported without a Strava subscription. Files are parsed locally in the browser; matching activities mark the corresponding plan sessions complete.
- Imported Garmin activity summaries are stored only in that browser for duplicate detection. The raw activity files and route coordinates are not uploaded or persisted.
- Every session includes a type-specific substitution or recovery option.
- The missed-workout guide prioritizes long rides and runs, retains two weekly swims where possible, and drops strength or extra easy work first. It does not recommend cramming missed sessions.
- The week controls move through the complete plan; the race week includes short tune-ups and the race-day session.

The app uses React, TypeScript, Vite, Tailwind CSS, and Lucide React.

## Garmin Connect import without Strava

1. Sign in to [Garmin Connect](https://connect.garmin.com/modern/activities) in a browser and open an activity.
2. Open the activity menu and choose **Export Original**. Garmin downloads an FIT or TCX activity file. Repeat for activities you want to import, or select several exported files at once.
3. For a larger history, request **Export Your Data** from Garmin Connect account settings and download the archive when Garmin prepares it. Select that ZIP in Endurance One; the app extracts supported FIT, TCX, and GPX activity files locally.
4. In Endurance One choose **Choose Garmin export files**. Matching is based on sport and the activity's local date. The upload marks matching plan sessions complete and ignores duplicate files.

The browser importer accepts up to 100 selected files at a time (100 MB total); individual activity files can be 50 MB, and a ZIP can be 100 MB compressed, contain up to 300 supported activities, and expand to 150 MB. Imported summaries stay in that browser's local storage. For another phone/browser, import the files there too. This route is manual: Garmin does not push new activities directly into this PWA.

## Strava activity sync

Strava sync is optional. Current Strava developer documentation says a Strava subscription is required to create an API application. Without that subscription, use the Garmin file-import flow above. For an eligible API app, sync is read-only: opening the app or tapping **Sync now** checks activities from the plan start through today. A swim, ride, run, or strength activity is matched by sport and local date; rest and race-day items are never auto-completed. Strava activities hidden with **Only You** require the `activity:read_all` permission.

The Strava client secret and refresh token must stay server-side. The integration uses a Cloudflare Worker with private SQLite Durable Object storage and a separate app-access password. It is designed for one athlete, so do not share that password.

### One-time Strava setup

1. Sign in to the Cloudflare dashboard and register a unique `workers.dev` subdomain for the account under **Workers & Pages**. This is a one-time account setup required before a Worker can have a public URL.
2. Create a Strava API application at `https://www.strava.com/settings/api`. Deploy the Worker once with `npm run worker:deploy`; the command prints its `workers.dev` URL. In the Strava API application, set **Authorization Callback Domain** to the Worker hostname without `https://` or a path.
3. Add the Worker secrets from a terminal, entering each value only at the secure terminal prompt:

	```sh
	npx wrangler secret put STRAVA_CLIENT_ID --config worker/wrangler.jsonc
	npx wrangler secret put STRAVA_CLIENT_SECRET --config worker/wrangler.jsonc
	npx wrangler secret put APP_PASSWORD --config worker/wrangler.jsonc
	```

	Use a long, unique app password. Do not commit it, put it in GitHub Pages variables, or send it in chat. Worker secrets are ignored by Git.
4. In the GitHub repository settings, add the repository **Actions variable** `VITE_STRAVA_API_URL` with the Worker URL, for example `https://endurance-one-strava.<your-account>.workers.dev`.
5. Push any commit to `main` (or run the workflow manually) to rebuild GitHub Pages with that Worker URL. Open the app, choose **Connect Strava**, enter the app password, and authorize read-only activity access on Strava.

The Worker callback is `/oauth/callback`; the frontend return address is set in `worker/wrangler.jsonc`. The Worker can be deployed without Strava credentials, but the connection buttons remain unavailable until its secrets and GitHub Actions variable are configured.

## Install on a phone

The production build is a Progressive Web App (PWA). Deploy the contents of `dist` to a static host that serves HTTPS, then open its public HTTPS address on the phone:

- **Android:** open the site in Chrome, use the browser menu, then choose **Install app** or **Add to Home screen**.
- **iPhone:** open the site in Safari, tap **Share**, then **Add to Home Screen**.

The app shell and workout plan are cached for offline use after the first successful visit. Completion status remains saved on that device and browser. A local network development URL such as `http://192.168.x.x:5173` is useful for testing but is not a reliable install address; browsers require HTTPS for installable PWAs except on localhost. Updates are applied automatically when the phone reconnects.

Generate or refresh the app icons after changing `public/endurance-mark.svg` with `npm run generate-pwa-assets`.

## Publish with GitHub Pages

The repository includes a GitHub Actions workflow at `.github/workflows/deploy.yml`. Push the project to a GitHub repository, then in that repository open **Settings → Pages** and set the build/deployment source to **GitHub Actions**. Each push to `main` publishes the production PWA at `https://<account>.github.io/<repository>/`. The workflow derives the repository path automatically, including the PWA's offline worker and installed-app start URL.
