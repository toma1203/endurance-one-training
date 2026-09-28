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
- Every session includes a type-specific substitution or recovery option.
- The missed-workout guide prioritizes long rides and runs, retains two weekly swims where possible, and drops strength or extra easy work first. It does not recommend cramming missed sessions.
- The week controls move through the complete plan; the race week includes short tune-ups and the race-day session.

The app uses React, TypeScript, Vite, Tailwind CSS, and Lucide React.

## Install on a phone

The production build is a Progressive Web App (PWA). Deploy the contents of `dist` to a static host that serves HTTPS, then open its public HTTPS address on the phone:

- **Android:** open the site in Chrome, use the browser menu, then choose **Install app** or **Add to Home screen**.
- **iPhone:** open the site in Safari, tap **Share**, then **Add to Home Screen**.

The app shell and workout plan are cached for offline use after the first successful visit. Completion status remains saved on that device and browser. A local network development URL such as `http://192.168.x.x:5173` is useful for testing but is not a reliable install address; browsers require HTTPS for installable PWAs except on localhost. Updates are applied automatically when the phone reconnects.

Generate or refresh the app icons after changing `public/endurance-mark.svg` with `npm run generate-pwa-assets`.

## Publish with GitHub Pages

The repository includes a GitHub Actions workflow at `.github/workflows/deploy.yml`. Push the project to a GitHub repository, then in that repository open **Settings → Pages** and set the build/deployment source to **GitHub Actions**. Each push to `main` publishes the production PWA at `https://<account>.github.io/<repository>/`. The workflow derives the repository path automatically, including the PWA's offline worker and installed-app start URL.
