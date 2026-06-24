# Nourish — Setup Guide

You don't need to know how to code to follow this guide.
Each step tells you exactly what to do and where to click.

---

## What we're building

**Nourish** is a web app (mobile-styled) that lets you:
- Snap a photo of a meal → AI identifies foods and estimates nutrients
- Track nutritional sufficiency across 25+ vitamins and minerals
- Get smart insights: "pair this with vitamin C to boost iron absorption"
- See if you're underfueling relative to your goals (never flagged for eating more)

---

## Tech stack (for reference)

| Layer | Tool | Why |
|---|---|---|
| Frontend | Next.js 14 | React framework, works perfectly on Vercel |
| Styling | Tailwind CSS | Utility CSS — fast to build with |
| Database + Auth | Supabase | PostgreSQL + login system + file storage, all managed |
| AI Vision | OpenAI GPT-4o | Best food photo analysis available |
| Nutrition Data | USDA FoodData Central | Free government nutrient database |
| Hosting | Vercel | One-click deployment, free tier |
| Code editor | Cursor | AI-powered editor — perfect for non-coders |

---

## Step 1 — Install tools on your computer

### 1a. Install Node.js
Node.js lets your computer run the app locally.

1. Go to https://nodejs.org
2. Click the **LTS** (Long Term Support) button
3. Download and run the installer
4. Accept all defaults
5. Open Terminal (Mac) or Command Prompt (Windows) and type:
   ```
   node --version
   ```
   You should see something like `v20.x.x`. That means it worked.

### 1b. Install Cursor (your code editor)
Cursor is like VS Code but with AI built in — you can ask it to write code for you.

1. Go to https://cursor.com
2. Download and install for your OS
3. Open Cursor — you'll be asked to sign in (use Google or GitHub)

---

## Step 2 — Create your accounts

You need three free accounts. Do these all now.

### 2a. Supabase (database + auth + file storage)
1. Go to https://supabase.com
2. Click **Start your project** → sign in with GitHub
3. Click **New project**
4. Name it `nourish`, choose a region close to you, set a strong database password
5. Wait ~2 minutes for it to spin up
6. Go to **Settings → API** and keep this tab open — you'll need these values shortly

### 2b. OpenAI (AI vision)
1. Go to https://platform.openai.com
2. Sign up or log in
3. Go to **API Keys** → **Create new secret key**
4. Name it `nourish` → copy the key and save it somewhere safe
   ⚠️ You only see it once. Paste it in a note immediately.
5. Add a small credit balance ($5–$10 to start) under **Billing**

### 2c. USDA FoodData Central (free nutrient data)
1. Go to https://fdc.nal.usda.gov/api-guide.html
2. Click **Sign up for an API key**
3. Enter your email → they'll email you a key immediately
4. Save that key — paste it into `.env.local`, never here

### 2d. Vercel (hosting — do this last, after the app runs locally)
1. Go to https://vercel.com
2. Sign up with GitHub
3. (You'll connect your project here in Step 6)

---

## Step 3 — Open the project in Cursor

1. Move the `nourish/` folder (this folder) somewhere easy to find, like your Desktop
2. Open **Cursor**
3. Go to **File → Open Folder** → select the `nourish/` folder
4. You should see the file tree on the left

---

## Step 4 — Set up your environment variables

Environment variables are like a private settings file for API keys.
They never get shared publicly.

1. In the `nourish/` folder, find the file `.env.local.example`
2. Make a copy of it and rename the copy to `.env.local`
   - Mac: right-click → Duplicate, then rename
   - Windows: copy → paste → rename
3. Open `.env.local` in Cursor
4. Fill in each value:

```
NEXT_PUBLIC_SUPABASE_URL=        ← from Supabase Settings → API → Project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=   ← from Supabase Settings → API → anon public key
SUPABASE_SERVICE_ROLE_KEY=       ← from Supabase Settings → API → service_role secret key
OPENAI_API_KEY=                  ← from OpenAI platform → API Keys
USDA_FDC_API_KEY=                ← from the email USDA sent you
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

5. Save the file (Cmd+S or Ctrl+S)

---

## Step 5 — Set up the database

1. Go to your Supabase project dashboard
2. Click **SQL Editor** in the left sidebar
3. Click **New query**
4. Open the file `supabase/schema.sql` in Cursor
5. Select all the text (Cmd+A or Ctrl+A) and copy it
6. Paste it into the Supabase SQL editor
7. Click **Run** (green button)
8. You should see "Success. No rows returned" — that means all tables were created

To verify: click **Table Editor** in the left sidebar. You should see tables named:
`profiles`, `meals`, `food_items`, `daily_logs`, `insights`, `exercise_logs`, `weekly_plant_diversity`

### Set up the photo storage bucket
1. In Supabase, click **Storage** in the left sidebar
2. Click **New bucket**
3. Name it `meal-photos`
4. Leave **Public bucket** OFF (photos are private)
5. Click **Save**

---

## Step 6 — Install dependencies and run the app

1. In Cursor, open the Terminal: **Terminal → New Terminal** (or Ctrl+` )
2. You should see a command prompt showing the `nourish` folder path
3. Type this and press Enter:
   ```
   npm install
   ```
   This downloads all the packages the app needs. Takes 1–2 minutes.
4. Then type:
   ```
   npm run dev
   ```
5. You'll see output ending in something like:
   ```
   ▲ Next.js 14.x.x
   - Local: http://localhost:3000
   ```
6. Open your browser and go to **http://localhost:3000**

If everything is working, you'll see the Nourish app (currently showing a basic placeholder).

To stop the app: click in the Terminal and press **Ctrl+C**

---

## Step 7 — Deploy to the web (Vercel)

Once the app is working locally, you can put it on the internet.

1. Create a GitHub account at https://github.com if you don't have one
2. In Cursor's Terminal, run:
   ```
   git init
   git add .
   git commit -m "Initial Nourish scaffold"
   ```
3. Create a new repository on GitHub (click + → New repository → name it `nourish`)
4. Follow GitHub's instructions to push your code ("push an existing repository")
5. Go to https://vercel.com → **Add New Project**
6. Connect your GitHub account → select the `nourish` repository
7. In the **Environment Variables** section, add all the same variables from your `.env.local` file
8. Click **Deploy**
9. In ~2 minutes you'll get a URL like `nourish-xxx.vercel.app` — that's your live app

---

## What's already built

These files are ready:

- **Database schema** (`supabase/schema.sql`) — all tables, indexes, and security rules
- **Types** (`lib/types/index.ts`) — all data structures defined in TypeScript
- **Supabase client** (`lib/supabase/`) — database connection setup
- **EA Calculator** (`lib/engine/ea-calculator.ts`) — full energy availability engine
- **Vision API** (`lib/ai/vision.ts`) — GPT-4o meal photo analysis
- **Nutrition API** (`lib/ai/nutrition.ts`) — USDA FoodData Central integration
- **Meal analysis endpoint** (`app/api/meals/analyse/route.ts`) — the main AI pipeline
- **Config files** — Next.js, Tailwind, TypeScript all configured

---

## What to build next (in order)

1. **Auth pages** — login and sign-up screens (`app/(auth)/login/`)
2. **Onboarding flow** — collect weight, height, steps, goals
3. **Dashboard** — daily nutrient summary view
4. **Meal log screen** — camera/upload → AI analysis → confirm → save
5. **Insights feed** — daily and meal-level insight cards
6. **Profile** — settings, goal editing, EA recalculation

Each of these can be built with Cursor's AI — describe what you want in plain English and it will write the code.

---

## Working with Cursor's AI

In Cursor, press **Cmd+L** (Mac) or **Ctrl+L** (Windows) to open the AI chat.

Example prompts that work well:

> "Build the login page in `app/(auth)/login/page.tsx`. It should use Supabase Auth, have email and password fields, and redirect to /dashboard on success. Use Tailwind for styling — cream background, sage green button."

> "Build the onboarding form in `app/(auth)/onboarding/page.tsx`. Collect: weight (kg), height (cm), sex, age, average daily steps (slider 2000–20000), goals (multi-select: General Wellness, Hormonal Health, Athletic Performance, Gut Health), dietary pattern. Save to the profiles table in Supabase. Then redirect to /dashboard."

> "Build the dashboard page. Fetch today's daily_log for the current user. Show a ring chart of overall nutritional sufficiency, the top 5 critical nutrients for their goals, and today's meals. Use the color palette from tailwind.config.js."

---

## Getting help

If something breaks or you're not sure what to do:
- Come back here and describe what you see — include any red error text
- Check the Supabase docs: https://supabase.com/docs
- Check the Next.js docs: https://nextjs.org/docs

---

*Nourish v0.1 — scaffold generated June 2026*
