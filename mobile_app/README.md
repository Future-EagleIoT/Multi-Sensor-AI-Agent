# Mobile app

Expo React Native client for the Multi-Sensor AI Agent.

## Features

- Email auth (Supabase Auth) + guest read mode
- Live dashboard with health status and 4-signal metrics
- Alerts feed with filters, detail view, and resolve
- Reading history
- Device inventory (registered + orphan device_ids)
- Realtime subscriptions on `sensor_readings` and `alerts`
- Settings: account, connection, thresholds

## Setup

1. Apply database schema:
   - Fresh: run `supabase/schema.sql`
   - Existing project: run `supabase/migrations/002_mobile_app.sql`
2. In Supabase Auth, enable Email provider.
3. Configure env:

```bash
cd mobile_app
cp .env.example .env
# set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY
```

4. Install and run:

```bash
npm install
npx expo start
```

Use Expo Go, or `a` / `i` for Android / iOS simulators.

## Stack notes

- Follows [skills.sh Supabase](https://www.skills.sh/supabase/agent-skills/supabase) + Expo patterns: anon key only, AsyncStorage session persistence, RLS-aware reads/updates.
- Never put the service role key in this app.
