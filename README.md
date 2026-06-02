# TutorBlocks v2 — Setup Guide

A shared whiteboard canvas for tutoring sessions.
The tutor places letter/word blocks and drop zones. The student drags blocks into the zones.
Everything syncs in real time.

---

## Files in this folder

| File | What it does |
|---|---|
| `index.html` | The app UI |
| `app.js` | All the canvas logic |
| `config.js` | Where you paste your Supabase keys |
| `README.md` | This guide |

---

## Step 1 — Create a free Supabase account (5 minutes)

Supabase is what keeps the tutor and student in sync. It's free and no credit card is needed.

1. Go to **https://supabase.com** and click **Start for free**
2. Sign up with GitHub or email
3. Click **New project**
4. Give it a name like `tutorblocks`, pick any region, set a password (save it somewhere)
5. Wait about a minute for it to set up
6. Once ready, click **Project Settings** (gear icon, bottom left)
7. Click **API** in the left menu
8. You'll see two values — copy them:
   - **Project URL** — looks like `https://xxxx.supabase.co`
   - **anon public key** — a long string starting with `eyJ...`

---

## Step 2 — Paste your keys into config.js

Open `config.js` in any text editor (Notepad works fine) and replace the placeholder text:

```js
const SUPABASE_URL  = 'https://xxxx.supabase.co';   // ← paste your Project URL
const SUPABASE_ANON = 'eyJxxxxxx...';                // ← paste your anon key
```

Save the file.

---

## Step 3 — Enable Realtime in Supabase

TutorBlocks uses Supabase's broadcast feature which works out of the box —
you do NOT need to create any database tables. No SQL needed.

Just make sure Realtime is enabled:
1. In your Supabase project, go to **Realtime** in the left menu
2. It should say "Realtime is enabled" — if so, you're done

---

## Step 4 — Host the files on Netlify (2 minutes)

1. Go to **https://netlify.com** and create a free account
2. From your dashboard, drag your entire `tutorblocks-v2` folder onto the page
3. Netlify gives you a URL like `https://rainbow-turtle-123.netlify.app`

That's your live app. Done.

---

## Step 5 — Run a session

### Tutor (you):
1. Open your Netlify URL in a browser
2. You'll be recognised as the tutor automatically (first to connect)
3. You'll see a session link at the top — copy it (or click **🔗 Copy Link**)
4. Send that link to your student over Zoom chat / email / text

### Student:
1. Student opens the link you sent them
2. They join as a student automatically
3. Both of you now see the same canvas in real time

---

## How to use it

### Adding a text block (tutor only)
- Click **➕ Text Block** in the toolbar
- Type a letter or word, OR tap one of the preset chips
- Pick a colour
- Click **Add Block** — it appears on the canvas

### Adding a drop zone (tutor only)
- Click **⬜ Drop Zone** — a dashed purple square appears on the canvas
- Drag it wherever you want

### Dragging blocks (everyone)
- Any block can be dragged by tutor or student
- Drag a block close to a drop zone — it will snap in automatically
- Drag it back out to unsnap it

### Removing blocks or zones (tutor only)
- Hover over a block or drop zone — a red ✕ button appears in the top corner
- Click it to remove

### Clear everything (tutor only)
- Click **🗑 Clear All** in the toolbar

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Page loads but nothing works | Check `config.js` has your real Supabase URL and key |
| Tutor and student don't see each other's changes | Make sure both opened the **same session link** (with `?session=XXXXX` in the URL) |
| Student is seeing the tutor toolbar | The student opened the app before the tutor — try refreshing both pages, tutor first |
| Netlify says "Page not found" | Make sure you dragged the folder, not just the files |
