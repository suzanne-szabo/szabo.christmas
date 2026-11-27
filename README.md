# Szabo Family Wishlists (2026 rebuild)

A free, phone-friendly Christmas wishlist site.

- **Anyone** can view every list without signing in.
- **4 family accounts** (Jane, Jason, Teri, Suzanne) can sign in on their phones and edit **only their own** list.
- Every year starts fresh on **February 1**. Past years stay in the **Archive** (the Year picker), read-only.
  Lists from the old site show up in the archive automatically.
- Items can have a link, price, ⭐ "most wanted", notes, and a **photo or screenshot**.
  Photos (including iPhone HEIC photos) are shrunk on the phone to ~1280px before saving.
- **"🎁 I'm getting this"**: anyone can mark an item as claimed so nobody buys it twice.
  The list owner never sees what's been claimed (the database itself blocks them).
- Sizes & favorites on each person's list, drag-to-reorder, copy last year's items,
  Christmas countdown, share links, Email List, and "Add to Home Screen" support.

Hosting is GitHub Pages (free). Data and logins are your existing Firebase project
on the free Spark plan. Expected cost: **$0**.

---

## One-time setup (about 20 minutes)

### 1. Firebase: turn on email logins and create the 4 accounts
Go to <https://console.firebase.google.com> → project **szabo-family-wishlists**.

1. **Build → Authentication → Sign-in method**
   - Enable **Email/Password** (leave "Email link" off).
   - Leave **Anonymous** enabled (visitors use it to mark items as claimed).
2. **Authentication → Users → Add user**, four times. Give each a temporary password:
   - kitteny99@gmail.com (Jane)
   - zabe73@gmail.com (Jason)
   - teri444@citlink.net (Teri)
   - suzanne.szabo.9@gmail.com (Suzanne)
3. **Authentication → Settings → Authorized domains → Add domain**:
   - `szabo.christmas`
   - `suzanne-szabo.github.io` (your GitHub Pages address)
4. (Optional) **Authentication → Settings → User actions**: untick "Enable create (sign-up)"
   if you see it. Not required, because the database rules only accept the 4 emails anyway.

### 2. Firebase: publish the security rules
**Build → Firestore Database → Rules**. Delete everything there, paste in the whole
`firestore.rules` file from this folder, and click **Publish**.

These rules are what stop anyone except the owner from changing a list. They also lock
the old site's lists so they can't be changed anymore (they stay viewable in the archive).

### 3. GitHub Pages: put the site online
1. On GitHub, create a new **public** repository, e.g. `szabo-christmas`.
2. Upload **everything in this folder** (including `CNAME` and `.nojekyll`) to the repository.
3. Repository **Settings → Pages**: Source = *Deploy from a branch*, Branch = `main`, folder `/ (root)`. Save.
4. On the same page, **Custom domain** should already say `szabo.christmas` (from the CNAME file).
   Tick **Enforce HTTPS** once it's available (can take up to an hour).

### 4. Point szabo.christmas at GitHub
At the company where you bought the domain, set these DNS records (remove any old A records first):

| Type  | Name / Host | Value                     |
|-------|-------------|---------------------------|
| A     | @           | 185.199.108.153           |
| A     | @           | 185.199.109.153           |
| A     | @           | 185.199.110.153           |
| A     | @           | 185.199.111.153           |
| CNAME | www         | suzanne-szabo.github.io   |

DNS changes can take a few minutes to a few hours.

### 5. Tell the family
Send each person their email and temporary password. On the sign-in screen they can tap
**Forgot password?** to set their own. The first time they sign in, the site asks for their
name, sizes and favorites.

**iPhone app icon:** open the site in Safari → Share → **Add to Home Screen**.

---

## Every year
Nothing to do. On February 1 everyone gets a fresh, empty list, and last year moves to the
archive. Each person can tap **copy items from last year** to start from their old list.
(To change the rollover month, edit `SEASON_START_MONTH` in `config.js`.)

## Changing the family accounts
Change the email in **both** `config.js` (FAMILY) and `firestore.rules`, re-publish the rules,
and add the new user in Firebase Authentication.

## Files
| File | What it is |
|------|------------|
| `index.html` | The page |
| `app.js` | Everything the site does |
| `config.js` | Settings: Firebase project, family emails/names, rollover month |
| `firestore.rules` | Database security rules (paste into Firebase) |
| `styles.css`, `tailwind.css` | Styling (`tailwind.css` is pre-built; regenerate with the Tailwind v3 CLI if you add new Tailwind classes) |
| `manifest.webmanifest`, `sw.js`, `icons/` | "Add to Home Screen" support |
| `assets/` | Background images (same as the original site) |
| `CNAME`, `.nojekyll` | GitHub Pages settings |
| `firebase.json` | Only used for local testing with the Firebase emulator (`?emulator` in the URL) |

## How data is stored (Firestore)
- `people/{uid}`: name, sizes, favorites
- `years/{year}/lists/{uid}`: name and last-updated time
- `years/{year}/lists/{uid}/items/{id}`: title, section, link, price, most wanted, notes, small thumbnail
- `years/{year}/claims/{itemId}`: who's getting it (hidden from the list owner)
- `images/{id}`: the full-size (shrunk) photo
- `christmasLists/*`: the old site's lists, read-only
