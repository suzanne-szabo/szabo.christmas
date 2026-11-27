import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
    getAuth, onAuthStateChanged, signInAnonymously, signInWithEmailAndPassword,
    signOut, sendPasswordResetEmail, connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
    getFirestore, connectFirestoreEmulator, collection, doc, getDoc, getDocs, setDoc,
    deleteDoc, onSnapshot, query, where, orderBy, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import {
    FIREBASE_CONFIG, FAMILY, SITE_TITLE, SEASON_START_MONTH, LEGACY_COLLECTION
} from "./config.js";

// ------------------------------------------------------------------
// Setup
// ------------------------------------------------------------------
const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);

// Add ?emulator to the URL to use a local Firebase emulator for testing.
if (new URLSearchParams(location.search).has("emulator")) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
}

const SECTIONS = [
    { key: "want", title: "Things I Want", empty: "Nothing here yet." },
    { key: "need", title: "Things I Need", empty: "Nothing here yet." },
    { key: "activity", title: "Christmas Activities I Want to Do as a Family", empty: "No activities yet." },
];
const HEIC2ANY_URL = "https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js";
const SORTABLE_URL = "https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/modular/sortable.esm.js";

function currentSeason() {
    const d = new Date();
    return d.getMonth() < SEASON_START_MONTH ? d.getFullYear() - 1 : d.getFullYear();
}

const S = {
    uid: null,
    email: null,
    isFamily: false,
    season: currentSeason(),
    viewYear: currentSeason(),
    people: {},        // uid -> profile
    lists: {},         // uid -> list meta (viewYear)
    items: {},         // uid -> [items] (viewYear)
    claims: {},        // itemId -> claim (viewYear, never your own list)
    legacy: [],        // lists from the original site
    newYears: new Set(),
    openUid: null,
    pendingHash: location.hash,
};
let yearUnsubs = [];
let peopleUnsub = null;

const $ = (id) => document.getElementById(id);
const isCurrent = () => S.viewYear === S.season;
const isLegacyUid = (uid) => uid.startsWith("legacy-");
const myName = () => S.people[S.uid]?.name || "";

// ------------------------------------------------------------------
// Small DOM helpers (all user text goes through textContent — no HTML injection)
// ------------------------------------------------------------------
function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
        else if (k === "dataset") Object.assign(node.dataset, v);
        else node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) {
        if (c == null || c === false) continue;
        node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
}

function safeUrl(u) {
    if (!u) return null;
    try {
        const url = new URL(u.trim());
        return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
    } catch { return null; }
}

// Turns "text with https://links" into text nodes + clickable links.
function linkify(text) {
    const parts = String(text).split(/(https?:\/\/[^\s]+)/g);
    return parts.map((p, i) => {
        if (i % 2 === 1 && safeUrl(p)) {
            return el("a", { href: safeUrl(p), target: "_blank", rel: "noopener noreferrer", class: "text-blue-600 hover:text-blue-800 underline break-all" }, p);
        }
        return document.createTextNode(p);
    });
}

function shortHost(u) {
    try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "link"; }
}

function toDate(v) {
    if (!v) return null;
    if (typeof v.toDate === "function") return v.toDate();
    const d = new Date(v);
    return isNaN(d) ? null : d;
}
function fmtDate(v) {
    const d = toDate(v);
    return d ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined }) : "";
}

function toast(message, type = "success") {
    const t = el("div", { class: `px-4 py-3 text-white rounded-lg shadow-xl max-w-sm ${type === "success" ? "bg-green-600" : "bg-red-600"} opacity-0 transition-opacity duration-300`, role: "status" }, message);
    $("toast-container").append(t);
    requestAnimationFrame(() => t.classList.replace("opacity-0", "opacity-100"));
    setTimeout(() => { t.classList.replace("opacity-100", "opacity-0"); setTimeout(() => t.remove(), 300); }, 4000);
}

// Modals
function openModal(id) {
    const m = $(id);
    m.classList.remove("hidden");
    requestAnimationFrame(() => m.classList.add("open"));
}
function closeModal(id) {
    const m = $(id);
    m.classList.remove("open");
    setTimeout(() => m.classList.add("hidden"), 200);
    if (id === "detail-modal") {
        S.openUid = null;
        if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    }
}
document.addEventListener("click", (e) => {
    const closer = e.target.closest("[data-close]");
    if (closer) closeModal(closer.dataset.close);
    else if (e.target.classList.contains("modal")) closeModal(e.target.id);
});
document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("lightbox").classList.contains("hidden")) return closeLightbox();
    const open = [...document.querySelectorAll(".modal.open")].pop();
    if (open) closeModal(open.id);
});

function confirmBox(text, yesLabel = "OK") {
    return new Promise((resolve) => {
        $("confirm-text").textContent = text;
        $("confirm-yes").textContent = yesLabel;
        const done = (v) => { closeModal("confirm-modal"); $("confirm-yes").onclick = $("confirm-no").onclick = null; resolve(v); };
        $("confirm-yes").onclick = () => done(true);
        $("confirm-no").onclick = () => done(false);
        openModal("confirm-modal");
    });
}

// ------------------------------------------------------------------
// Countdown
// ------------------------------------------------------------------
function renderCountdown() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let xmas = new Date(now.getFullYear(), 11, 25);
    if (today > xmas) xmas = new Date(now.getFullYear() + 1, 11, 25);
    const days = Math.round((xmas - today) / 86400000);
    $("countdown").textContent = days === 0 ? "🎄 Merry Christmas! 🎄"
        : days === 1 ? "🎄 Christmas is tomorrow!"
        : `🎄 ${days} days until Christmas`;
}

// ------------------------------------------------------------------
// Auth
// ------------------------------------------------------------------
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        // Visitors get a quiet anonymous session so they can mark items as claimed.
        try { await signInAnonymously(auth); }
        catch (e) {
            console.error("Anonymous sign-in failed", e);
            S.uid = null; S.isFamily = false;
            renderAuthArea(); loadYear();
        }
        return;
    }
    S.uid = user.uid;
    S.email = (user.email || "").toLowerCase();
    S.isFamily = !user.isAnonymous && Object.keys(FAMILY).map((e) => e.toLowerCase()).includes(S.email);
    if (!user.isAnonymous && !S.isFamily) {
        toast("That account isn't one of the family accounts.", "error");
        await signOut(auth);
        return;
    }
    renderAuthArea();
    loadYear();
    maybeWelcome();
});

// First time a family member signs in: ask for the name shown on their list.
function maybeWelcome() {
    if (S.isFamily && S.peopleLoaded && !S.people[S.uid] && $("profile-modal").classList.contains("hidden")) openProfile(true);
}

function renderAuthArea() {
    const area = $("auth-area");
    area.replaceChildren();
    if (S.isFamily) {
        area.append(
            el("button", { class: "button-primary px-5 py-2.5 rounded-xl font-semibold shadow-lg", onclick: () => openDetail(S.uid) }, "✏️ My List"),
            el("button", { class: "bg-white/90 text-gray-700 px-4 py-2.5 rounded-xl font-semibold shadow hover:bg-white", onclick: () => openProfile() }, "Sizes & favorites"),
            el("button", { class: "bg-white/70 text-gray-600 px-4 py-2.5 rounded-xl shadow hover:bg-white", onclick: () => signOut(auth).then(() => toast("Signed out.")) }, "Sign out"),
        );
    } else {
        area.append(el("button", {
            class: "button-primary px-5 py-2.5 rounded-xl font-semibold shadow-lg",
            onclick: () => { $("signin-msg").classList.add("hidden"); openModal("signin-modal"); setTimeout(() => $("signin-email").focus(), 50); }
        }, "Family sign in"));
    }
}

$("signin-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("signin-msg");
    msg.classList.add("hidden");
    try {
        await signInWithEmailAndPassword(auth, $("signin-email").value.trim(), $("signin-password").value);
        $("signin-password").value = "";
        closeModal("signin-modal");
        toast("Signed in! Tap “My List” to add items.");
    } catch (err) {
        console.error(err);
        msg.className = "text-sm text-red-600";
        msg.textContent = /invalid|wrong|not-found|credential/.test(err.code || "") ? "Email or password is incorrect." : "Couldn't sign in. Please try again.";
    }
});
$("forgot-btn").addEventListener("click", async () => {
    const email = $("signin-email").value.trim();
    const msg = $("signin-msg");
    msg.classList.remove("hidden");
    if (!email) { msg.className = "text-sm text-red-600"; msg.textContent = "Type your email above first."; return; }
    try {
        await sendPasswordResetEmail(auth, email);
    } catch (err) { console.warn(err); }
    msg.className = "text-sm text-green-700";
    msg.textContent = "If that's a family account, a reset link is on its way.";
});

// ------------------------------------------------------------------
// Data loading
// ------------------------------------------------------------------
async function loadArchiveIndex() {
    const [yearsSnap, legacySnap] = await Promise.all([
        getDocs(collection(db, "years")).catch((e) => { console.warn(e); return null; }),
        getDocs(collection(db, LEGACY_COLLECTION)).catch((e) => { console.warn("No legacy lists", e); return null; }),
    ]);
    yearsSnap?.forEach((d) => S.newYears.add(Number(d.id)));
    S.legacy = [];
    legacySnap?.forEach((d) => {
        const data = d.data();
        const year = toDate(data.lastUpdated)?.getFullYear() || S.season - 1;
        S.legacy.push({ id: d.id, year, ...data });
    });
    renderYearSelect();
}

function renderYearSelect() {
    const years = new Set([S.season, ...S.newYears, ...S.legacy.map((l) => l.year)]);
    const sel = $("year-select");
    sel.replaceChildren(...[...years].sort((a, b) => b - a).map((y) =>
        el("option", { value: y, selected: y === S.viewYear }, y === S.season ? `${y} (this year)` : `${y} archive`)));
}
$("year-select").addEventListener("change", (e) => { S.viewYear = Number(e.target.value); loadYear(); });

function watchPeople() {
    if (peopleUnsub) return;
    peopleUnsub = onSnapshot(collection(db, "people"), (snap) => {
        S.people = {};
        snap.forEach((d) => (S.people[d.id] = d.data()));
        S.peopleLoaded = true;
        maybeWelcome();
        render();
    }, (e) => console.error("people", e));
}

function loadYear() {
    yearUnsubs.forEach((u) => u());
    yearUnsubs = [];
    S.lists = {}; S.items = {}; S.claims = {};
    const y = String(S.viewYear);

    // Lists from the original site, shown read-only in their year.
    for (const l of S.legacy.filter((l) => l.year === S.viewYear)) {
        const uid = "legacy-" + l.id;
        S.lists[uid] = { name: l.listName || "Wishlist", updatedAt: l.lastUpdated, legacy: true };
        S.items[uid] = legacyItems(l);
    }

    yearUnsubs.push(onSnapshot(collection(db, "years", y, "lists"), (snap) => {
        const seen = new Set();
        snap.forEach((d) => {
            seen.add(d.id);
            S.lists[d.id] = d.data();
            if (!S.items[d.id]) watchItems(y, d.id);
        });
        render();
    }, (e) => console.error("lists", e)));

    // Current year: everyone with a profile gets a card, even before adding items.
    if (isCurrent()) {
        for (const uid of Object.keys(S.people)) if (!S.items[uid]) watchItems(y, uid);
        if (S.isFamily && !S.items[S.uid]) watchItems(y, S.uid);
        if (S.uid) {
            // The rules never let you read claims on your own list, so the surprise stays a surprise.
            const q = query(collection(db, "years", y, "claims"), where("listUid", "!=", S.uid));
            yearUnsubs.push(onSnapshot(q, (snap) => {
                S.claims = {};
                snap.forEach((d) => (S.claims[d.id] = d.data()));
                render();
            }, (e) => console.error("claims", e)));
        }
    }
    renderArchiveBanner();
    render();
}

function watchItems(y, uid) {
    S.items[uid] = S.items[uid] || [];
    const q = query(collection(db, "years", y, "lists", uid, "items"), orderBy("order"));
    yearUnsubs.push(onSnapshot(q, (snap) => {
        S.items[uid] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        render();
    }, (e) => console.error("items", e)));
}

function legacyItems(l) {
    const out = [];
    let order = 0;
    for (const [field, category] of [["wants", "want"], ["needs", "need"], ["activities", "activity"]]) {
        for (const line of String(l[field] || "").split("\n").map((s) => s.trim()).filter(Boolean)) {
            out.push({ id: `${l.id}-${order}`, title: line, category, order: order++ });
        }
    }
    return out;
}

function renderArchiveBanner() {
    const b = $("archive-banner");
    if (isCurrent()) { b.classList.add("hidden"); return; }
    b.replaceChildren(
        `You're looking at the ${S.viewYear} archive. These lists are read-only. `,
        el("button", { class: "underline font-semibold", onclick: () => { S.viewYear = S.season; renderYearSelect(); loadYear(); } }, `Back to ${S.season}`),
    );
    b.classList.remove("hidden");
}

// ------------------------------------------------------------------
// Rendering: cards
// ------------------------------------------------------------------
function visibleUids() {
    const uids = new Set(Object.keys(S.lists));
    if (isCurrent()) {
        Object.keys(S.people).forEach((u) => uids.add(u));
        if (S.isFamily) uids.add(S.uid);
    }
    return [...uids].sort((a, b) => {
        if (a === S.uid) return -1;
        if (b === S.uid) return 1;
        return nameOf(a).localeCompare(nameOf(b));
    });
}
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
function nameOf(uid) {
    if (!isLegacyUid(uid) && isCurrent() && S.people[uid]?.name) return S.people[uid].name;
    return S.lists[uid]?.name || S.people[uid]?.name || (uid === S.uid ? "My List" : "Wishlist");
}

let renderQueued = false;
function render() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
        renderQueued = false;
        renderCards();
        if (S.openUid) renderDetail();
        maybeOpenFromHash();
    });
}

function renderCards() {
    const c = $("lists-container");
    const uids = visibleUids();
    if (!uids.length) {
        c.replaceChildren(el("p", { class: "col-span-full text-center py-12 text-gray-700 text-lg font-semibold bg-white/70 rounded-xl shadow-md" },
            isCurrent() ? "No wishlists yet this year. Family members can sign in to start theirs!" : "No lists saved for this year."));
        return;
    }
    c.replaceChildren(...uids.map((uid) => {
        const items = S.items[uid] || [];
        const mine = uid === S.uid && S.isFamily;
        const count = (k) => items.filter((i) => i.category === k).length;
        const stars = items.filter((i) => i.priority).length;
        const thumbs = items.filter((i) => i.thumb).slice(0, 4);
        const updated = S.lists[uid]?.updatedAt;
        return el("button", {
            class: `flex flex-col justify-start text-left bg-white/90 p-6 rounded-xl card-shadow border-t-4 ${mine ? "border-red-500" : "border-green-700"} w-full`,
            onclick: () => openDetail(uid),
        },
            el("div", { class: "flex items-center justify-between mb-3 gap-2" },
                el("h3", { class: "text-2xl font-bold text-gray-800 truncate" }, nameOf(uid)),
                mine ? el("span", { class: "text-xs bg-red-200 text-red-700 px-2 py-1 rounded-full font-medium whitespace-nowrap" }, "YOUR LIST") : null),
            el("div", { class: "text-sm text-gray-600 space-y-1" },
                el("p", {}, `Wants: ${plural(count("want"), "item")}`),
                el("p", {}, `Needs: ${plural(count("need"), "item")}`),
                count("activity") ? el("p", {}, `Activities: ${count("activity")}`) : null,
                stars ? el("p", { class: "text-amber-700 font-semibold" }, `⭐ ${stars} most wanted`) : null),
            thumbs.length ? el("div", { class: "flex gap-2 mt-3" }, thumbs.map((i) => el("img", { src: i.thumb, alt: "", class: "w-12 h-12 object-cover rounded-md border border-gray-200" }))) : null,
            updated ? el("p", { class: "text-xs text-gray-400 mt-3" }, `Updated ${fmtDate(updated)}`) : null,
        );
    }));
}

// ------------------------------------------------------------------
// Rendering: one list
// ------------------------------------------------------------------
function openDetail(uid) {
    S.openUid = uid;
    if (!isLegacyUid(uid)) history.replaceState(null, "", `#list/${S.viewYear}/${uid}`);
    renderDetail();
    openModal("detail-modal");
}

function maybeOpenFromHash() {
    if (!S.pendingHash) return;
    const m = S.pendingHash.match(/^#list\/(\d{4})\/([\w-]+)$/);
    if (!m) { S.pendingHash = null; return; }
    const [, year, uid] = m;
    if (Number(year) !== S.viewYear) {
        S.viewYear = Number(year);
        renderYearSelect(); loadYear();
        return;
    }
    if (S.lists[uid] || S.people[uid]) {
        S.pendingHash = null;
        openDetail(uid);
    }
}

function canEdit(uid) { return S.isFamily && uid === S.uid && isCurrent(); }

let sortables = [];
function renderDetail() {
    const uid = S.openUid;
    if (!uid) return;
    const items = S.items[uid] || [];
    const editable = canEdit(uid);
    const body = $("detail-body");
    const scroll = body.scrollTop;

    $("detail-name").textContent = nameOf(uid);
    const updated = S.lists[uid]?.updatedAt;
    $("detail-sub").textContent = [isCurrent() ? `${S.viewYear} list` : `${S.viewYear} archive (read-only)`, updated ? `updated ${fmtDate(updated)}` : ""].filter(Boolean).join(" · ");

    const nodes = [];

    if (editable) {
        nodes.push(el("div", { class: "flex flex-wrap gap-2" },
            el("button", { class: "button-primary px-4 py-2 rounded-lg font-semibold shadow-md", onclick: () => openItemForm() }, "+ Add item"),
            el("button", { class: "bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg font-semibold", onclick: () => openProfile() }, "Sizes & favorites")));
        if (!items.length) nodes.push(copyLastYearBox());
        else nodes.push(el("p", { class: "text-xs text-gray-500" }, "Tip: drag ☰ to reorder. Others can mark items as claimed, but you'll never see which ones."));
    }

    // Sizes & favorites (current profile, so only on this year's list)
    const p = !isLegacyUid(uid) && isCurrent() ? S.people[uid] : null;
    const prof = profileRows(p);
    if (prof.length) {
        nodes.push(el("details", { class: "bg-white border border-gray-200 rounded-lg p-3", open: !editable },
            el("summary", { class: "font-bold text-gray-800 cursor-pointer" }, "👕 Sizes & favorites"),
            el("dl", { class: "grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 mt-2 text-sm" },
                prof.flatMap(([k, v]) => [el("dt", { class: "text-gray-500" }, k), el("dd", { class: "text-gray-800 break-words" }, v)]))));
    }

    for (const sec of SECTIONS) {
        const secItems = items.filter((i) => i.category === sec.key);
        if (!secItems.length && sec.key === "activity" && !editable && items.length) continue;
        const ul = el("ul", { class: "space-y-2", dataset: { category: sec.key } },
            secItems.length ? secItems.map((it) => itemRow(uid, it, editable))
                : el("li", { class: "text-gray-500 italic" }, sec.empty));
        nodes.push(el("section", { class: "p-4 rounded-lg border bg-green-100 text-gray-800 border-green-300" },
            el("h3", { class: "font-bold text-lg mb-2" }, sec.title), ul));
    }

    body.replaceChildren(...nodes);
    body.scrollTop = scroll;
    $("share-btn").classList.toggle("hidden", isLegacyUid(uid));
    setupSorting(editable);
}

function profileRows(p) {
    if (!p) return [];
    const s = p.sizes || {}, f = p.favorites || {};
    return [["Shirt", s.shirt], ["Pants", s.pants], ["Shoes", s.shoes], ["Other sizes", s.other],
        ["Favorite colors", f.colors], ["Favorite things", f.things], ["Please no", f.avoid]].filter(([, v]) => v);
}

function itemRow(uid, it, editable) {
    const claim = S.claims[it.id];
    const showClaims = isCurrent() && !isLegacyUid(uid) && uid !== S.uid && it.category !== "activity";
    const url = safeUrl(it.url);

    const info = el("div", { class: "flex-1 min-w-0" },
        el("p", { class: "item-title font-semibold text-gray-900 break-words" },
            it.priority ? el("span", { title: "Most wanted", class: "mr-1" }, "⭐") : null,
            ...linkify(it.title),
            it.price ? el("span", { class: "ml-2 text-xs font-semibold bg-green-200 text-green-900 px-2 py-0.5 rounded-full align-middle whitespace-nowrap" }, it.price) : null),
        it.notes ? el("p", { class: "text-sm text-gray-600 whitespace-pre-line break-words mt-0.5" }, ...linkify(it.notes)) : null,
        url ? el("a", { href: url, target: "_blank", rel: "noopener noreferrer", class: "inline-block mt-1 text-sm text-blue-700 underline break-all" }, `🔗 ${shortHost(url)}`) : null,
    );

    const actions = el("div", { class: "flex flex-col items-end gap-1 shrink-0" });
    if (editable) {
        actions.append(
            el("button", { class: "text-sm px-2 py-1 rounded bg-slate-100 hover:bg-slate-200", onclick: () => openItemForm(it) }, "Edit"),
            el("button", { class: "text-sm px-2 py-1 rounded text-red-700 hover:bg-red-50", onclick: () => deleteItem(it) }, "Delete"));
    } else if (showClaims) {
        if (claim) {
            actions.append(
                el("span", { class: "text-xs font-semibold text-green-800 bg-green-200 px-2 py-1 rounded-full text-right" }, claim.name ? `✓ ${claim.name} has it` : "✓ Claimed"),
                el("button", { class: "text-xs text-gray-500 underline", onclick: () => unclaim(it) }, "undo"));
        } else {
            actions.append(el("button", { class: "text-sm px-2 py-1 rounded-lg bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 whitespace-nowrap", onclick: () => openClaim(uid, it) }, "🎁 I'm getting this"));
        }
    }

    return el("li", { class: `item-row flex gap-3 items-start bg-white/80 rounded-lg p-2 ${claim && showClaims ? "claimed opacity-75" : ""}`, dataset: { id: it.id } },
        editable ? el("span", { class: "drag-handle text-gray-400 select-none px-1 pt-1 text-lg", title: "Drag to reorder", "aria-hidden": "true" }, "☰") : null,
        it.thumb ? el("button", { class: "shrink-0", onclick: () => openLightbox(it), "aria-label": "View photo" },
            el("img", { src: it.thumb, alt: "", class: "w-16 h-16 object-cover rounded-md border border-gray-200" })) : null,
        info, actions);
}

function copyLastYearBox() {
    const box = el("div", { class: "bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-900" },
        "Fresh list for ", el("b", {}, String(S.season)), "! Add items, or ");
    const btn = el("button", { class: "underline font-semibold", onclick: copyFromLastYear }, "copy items from last year");
    box.append(btn, ".");
    return box;
}

async function setupSorting(editable) {
    sortables.forEach((s) => s.destroy());
    sortables = [];
    if (!editable) return;
    const { default: Sortable } = await import(SORTABLE_URL);
    document.querySelectorAll("#detail-body ul[data-category]").forEach((ul) => {
        if (!ul.querySelector("li[data-id]")) return;
        sortables.push(Sortable.create(ul, {
            handle: ".drag-handle", animation: 150, delay: 0,
            onEnd: () => saveOrder(ul),
        }));
    });
}

async function saveOrder(ul) {
    const ids = [...ul.querySelectorAll("li[data-id]")].map((li) => li.dataset.id);
    const batch = writeBatch(db);
    ids.forEach((id, i) => batch.update(itemRef(id), { order: i }));
    touchList(batch);
    try { await batch.commit(); } catch (e) { console.error(e); toast("Couldn't save the new order.", "error"); }
}

// ------------------------------------------------------------------
// Editing your own list
// ------------------------------------------------------------------
const itemsCol = () => collection(db, "years", String(S.season), "lists", S.uid, "items");
const itemRef = (id) => doc(itemsCol(), id);

function touchList(batch) {
    batch.set(doc(db, "years", String(S.season)), { year: S.season }, { merge: true });
    batch.set(doc(db, "years", String(S.season), "lists", S.uid), { name: myName() || "Wishlist", updatedAt: serverTimestamp() }, { merge: true });
}

let editingItem = null;
let pendingPhoto = null;   // { full, thumb } data URLs, or "remove"

function openItemForm(item = null) {
    editingItem = item;
    pendingPhoto = null;
    $("item-form").reset();
    $("item-modal-title").textContent = item ? "Edit item" : "Add an item";
    $("item-msg").classList.add("hidden");
    $("photo-status").classList.add("hidden");
    if (item) {
        $("item-title").value = item.title || "";
        $("item-url").value = item.url || "";
        $("item-price").value = item.price || "";
        $("item-priority").checked = !!item.priority;
        $("item-notes").value = item.notes || "";
        document.querySelector(`#item-category input[value="${item.category}"]`).checked = true;
    }
    showPhotoPreview(item?.thumb || null);
    openModal("item-modal");
    setTimeout(() => $("item-title").focus(), 50);
}

function showPhotoPreview(src) {
    $("photo-preview-wrap").classList.toggle("hidden", !src);
    if (src) $("photo-preview").src = src; else $("photo-preview").removeAttribute("src");
    $("photo-pick-label").textContent = src ? "Change photo" : "Choose photo";
}

$("photo-remove").addEventListener("click", () => { pendingPhoto = "remove"; $("item-photo").value = ""; showPhotoPreview(null); });

$("item-photo").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const status = $("photo-status");
    status.textContent = "Shrinking photo...";
    status.classList.remove("hidden");
    $("item-save").disabled = true;
    try {
        pendingPhoto = await processPhoto(file);
        showPhotoPreview(pendingPhoto.thumb);
        status.textContent = `Ready (${Math.round(pendingPhoto.full.length * 0.75 / 1024)} KB).`;
    } catch (err) {
        console.error(err);
        pendingPhoto = null;
        status.textContent = "Sorry, that photo couldn't be read. Try a screenshot or a different photo.";
    } finally {
        $("item-save").disabled = false;
        e.target.value = "";
    }
});

$("item-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("item-msg");
    msg.classList.add("hidden");
    let url = $("item-url").value.trim();
    if (url && !/^https?:\/\//i.test(url)) url = "https://" + url;
    if (url && !safeUrl(url)) { msg.textContent = "That link doesn't look right."; msg.classList.remove("hidden"); return; }

    const data = {
        title: $("item-title").value.trim(),
        category: document.querySelector("#item-category input:checked").value,
        url, price: $("item-price").value.trim(),
        priority: $("item-priority").checked,
        notes: $("item-notes").value.trim(),
        updatedAt: serverTimestamp(),
    };
    if (!data.title) return;

    $("item-save").disabled = true;
    try {
        const batch = writeBatch(db);
        const ref = editingItem ? itemRef(editingItem.id) : doc(itemsCol());
        const oldImage = editingItem?.imageId && !editingItem.imageShared ? editingItem.imageId : null;

        if (pendingPhoto && pendingPhoto !== "remove") {
            const imgRef = doc(collection(db, "images"));
            batch.set(imgRef, { owner: S.uid, data: pendingPhoto.full, createdAt: serverTimestamp() });
            Object.assign(data, { imageId: imgRef.id, thumb: pendingPhoto.thumb, imageShared: false });
            if (oldImage) batch.delete(doc(db, "images", oldImage));
        } else if (pendingPhoto === "remove") {
            Object.assign(data, { imageId: "", thumb: "", imageShared: false });
            if (oldImage) batch.delete(doc(db, "images", oldImage));
        }

        if (editingItem) {
            batch.update(ref, data);
        } else {
            const mine = S.items[S.uid] || [];
            const order = mine.length ? Math.max(...mine.map((i) => i.order || 0)) + 1 : 0;
            batch.set(ref, { imageId: "", thumb: "", imageShared: false, ...data, order, createdAt: serverTimestamp() });
        }
        touchList(batch);
        await batch.commit();
        closeModal("item-modal");
        toast(editingItem ? "Saved!" : `Added “${data.title}”.`);
    } catch (err) {
        console.error(err);
        msg.textContent = "Couldn't save. Check your connection and try again.";
        msg.classList.remove("hidden");
    } finally {
        $("item-save").disabled = false;
    }
});

async function deleteItem(it) {
    if (!(await confirmBox(`Delete “${it.title}”?`, "Delete"))) return;
    const batch = writeBatch(db);
    batch.delete(itemRef(it.id));
    if (it.imageId && !it.imageShared) batch.delete(doc(db, "images", it.imageId));
    touchList(batch);
    try { await batch.commit(); toast("Deleted."); }
    catch (e) { console.error(e); toast("Couldn't delete.", "error"); }
}

async function copyFromLastYear() {
    const prevYears = [...S.newYears].filter((y) => y < S.season).sort((a, b) => b - a);
    let source = null, fromYear = null;
    for (const y of prevYears) {
        const snap = await getDocs(query(collection(db, "years", String(y), "lists", S.uid, "items"), orderBy("order")));
        if (!snap.empty) { source = snap.docs.map((d) => d.data()); fromYear = y; break; }
    }
    if (!source) { toast("There's no earlier list to copy from.", "error"); return; }
    if (!(await confirmBox(`Copy ${source.length} items from your ${fromYear} list? You can edit or delete them after.`, "Copy"))) return;
    const batch = writeBatch(db);
    source.forEach((it, i) => batch.set(doc(itemsCol()), {
        title: it.title || "", category: it.category || "want", url: it.url || "", price: it.price || "",
        priority: !!it.priority, notes: it.notes || "", thumb: it.thumb || "", imageId: it.imageId || "",
        imageShared: !!it.imageId, order: i, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    touchList(batch);
    try { await batch.commit(); toast(`Copied ${source.length} items from ${fromYear}.`); }
    catch (e) { console.error(e); toast("Couldn't copy items.", "error"); }
}

// ------------------------------------------------------------------
// Profile: name, sizes & favorites
// ------------------------------------------------------------------
function openProfile(first = false) {
    if (!S.isFamily) return;
    const p = S.people[S.uid] || {};
    $("profile-intro").textContent = first ? "Welcome! Pick the name everyone will see on your list. Sizes and favorites are optional." : "Everyone can see this on your list.";
    $("pf-name").value = p.name || FAMILY[S.email] || "";
    $("pf-shirt").value = p.sizes?.shirt || "";
    $("pf-pants").value = p.sizes?.pants || "";
    $("pf-shoes").value = p.sizes?.shoes || "";
    $("pf-othersize").value = p.sizes?.other || "";
    $("pf-colors").value = p.favorites?.colors || "";
    $("pf-things").value = p.favorites?.things || "";
    $("pf-avoid").value = p.favorites?.avoid || "";
    $("profile-msg").classList.add("hidden");
    openModal("profile-modal");
}

$("profile-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = (id) => $(id).value.trim();
    const data = {
        name: v("pf-name"),
        sizes: { shirt: v("pf-shirt"), pants: v("pf-pants"), shoes: v("pf-shoes"), other: v("pf-othersize") },
        favorites: { colors: v("pf-colors"), things: v("pf-things"), avoid: v("pf-avoid") },
        updatedAt: serverTimestamp(),
    };
    try {
        const batch = writeBatch(db);
        batch.set(doc(db, "people", S.uid), data, { merge: true });
        if (S.lists[S.uid] || (S.items[S.uid] || []).length) {
            batch.set(doc(db, "years", String(S.season), "lists", S.uid), { name: data.name }, { merge: true });
        }
        await batch.commit();
        closeModal("profile-modal");
        toast("Saved!");
    } catch (err) {
        console.error(err);
        $("profile-msg").textContent = "Couldn't save. Please try again.";
        $("profile-msg").classList.remove("hidden");
    }
});

// ------------------------------------------------------------------
// Claims ("I'm getting this")
// ------------------------------------------------------------------
let claimTarget = null;
function openClaim(uid, it) {
    claimTarget = { uid, it };
    $("claim-item-name").textContent = it.title;
    $("claim-owner-name").textContent = nameOf(uid);
    $("claim-name").value = myName() || localStorage.getItem("claimName") || "";
    openModal("claim-modal");
}
$("claim-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!claimTarget || !S.uid) return;
    const name = $("claim-name").value.trim();
    if (name) localStorage.setItem("claimName", name);
    try {
        await setDoc(doc(db, "years", String(S.season), "claims", claimTarget.it.id), {
            listUid: claimTarget.uid, claimerUid: S.uid, name, at: serverTimestamp(),
        });
        closeModal("claim-modal");
        toast("Marked as claimed. 🎁");
    } catch (err) {
        console.error(err);
        toast("Couldn't claim it. Someone may have just claimed it.", "error");
    }
});
async function unclaim(it) {
    const c = S.claims[it.id];
    const who = c?.name ? ` by ${c.name}` : "";
    if (!(await confirmBox(`Un-claim “${it.title}”${who}? Others will see it as available again.`, "Un-claim"))) return;
    try { await deleteDoc(doc(db, "years", String(S.season), "claims", it.id)); }
    catch (e) { console.error(e); toast("Couldn't undo.", "error"); }
}

// ------------------------------------------------------------------
// Photos: any phone photo (incl. iPhone HEIC) → small JPEG
// ------------------------------------------------------------------
async function decodeImage(blob) {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;
    try { await img.decode(); return img; }
    finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) return resolve();
        document.head.append(el("script", { src, onload: resolve, onerror: reject }));
    });
}

async function loadAnyImage(file) {
    try {
        return await decodeImage(file);
    } catch (err) {
        // Most iPhones hand the browser a JPEG automatically; this covers HEIC files that slip through.
        if (/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) {
            await loadScript(HEIC2ANY_URL);
            const out = await window.heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
            return decodeImage(Array.isArray(out) ? out[0] : out);
        }
        throw err;
    }
}

function toJpeg(img, maxSide, quality, maxChars) {
    let scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    let q = quality;
    const canvas = document.createElement("canvas");
    for (let i = 0; i < 10; i++) {
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const data = canvas.toDataURL("image/jpeg", q);
        if (data.length <= maxChars) return data;
        if (q > 0.55) q -= 0.1; else scale *= 0.8;
    }
    throw new Error("Image too large");
}

async function processPhoto(file) {
    const img = await loadAnyImage(file);
    return {
        full: toJpeg(img, 1280, 0.82, 700_000),
        thumb: toJpeg(img, 240, 0.72, 60_000),
    };
}

async function openLightbox(it) {
    const box = $("lightbox"), img = $("lightbox-img");
    img.src = it.thumb;
    img.alt = it.title;
    box.classList.remove("hidden");
    if (!it.imageId) return;
    try {
        const snap = await getDoc(doc(db, "images", it.imageId));
        if (snap.exists() && !box.classList.contains("hidden")) img.src = snap.data().data;
    } catch (e) { console.warn(e); }
}
function closeLightbox() { $("lightbox").classList.add("hidden"); }
$("lightbox").addEventListener("click", closeLightbox);

// ------------------------------------------------------------------
// Share & email
// ------------------------------------------------------------------
$("share-btn").addEventListener("click", async () => {
    const uid = S.openUid;
    const url = `${location.origin}${location.pathname}#list/${S.viewYear}/${uid}`;
    const title = `${nameOf(uid)}'s Christmas Wishlist`;
    if (navigator.share) {
        try { await navigator.share({ title, url }); } catch { /* cancelled */ }
        return;
    }
    try { await navigator.clipboard.writeText(url); toast("Link copied!"); }
    catch { toast(url); }
});

$("email-btn").addEventListener("click", () => {
    $("email-to").value = "";
    $("email-msg").classList.add("hidden");
    openModal("email-modal");
});

$("email-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const to = $("email-to").value.trim();
    if (!to || !to.includes("@") || !to.includes(".")) {
        $("email-msg").textContent = "Please enter a valid email address.";
        $("email-msg").classList.remove("hidden");
        return;
    }
    const uid = S.openUid;
    const name = nameOf(uid);
    const items = S.items[uid] || [];
    let body = `*** ${name}'s Christmas Wishlist (${S.viewYear}) ***\n\n`;
    SECTIONS.forEach((sec, n) => {
        const list = items.filter((i) => i.category === sec.key);
        body += `${n + 1}. ${sec.title.toUpperCase()} (${list.length}):\n`;
        body += list.map((i) => {
            let line = `   - ${i.priority ? "[MOST WANTED] " : ""}${i.title}${i.price ? ` (${i.price})` : ""}`;
            if (i.notes) line += `\n     ${i.notes.replace(/\n/g, " ")}`;
            if (i.url) line += `\n     ${i.url}`;
            return line;
        }).join("\n") + "\n\n";
    });
    const prof = profileRows(!isLegacyUid(uid) && isCurrent() ? S.people[uid] : null);
    if (prof.length) body += "SIZES & FAVORITES:\n" + prof.map(([k, v]) => `   ${k}: ${v}`).join("\n") + "\n\n";
    if (!isLegacyUid(uid)) body += `See it online: ${location.origin}${location.pathname}#list/${S.viewYear}/${uid}\n`;
    body += `\nSent from the ${SITE_TITLE} site.`;
    location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(`${name}'s Christmas Wishlist`)}&body=${encodeURIComponent(body)}`;
    closeModal("email-modal");
    toast(`Preparing email for ${name}. Your mail app should open shortly.`);
});

// ------------------------------------------------------------------
// Start
// ------------------------------------------------------------------
renderCountdown();
renderAuthArea();
watchPeople();
loadArchiveIndex();

if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW", e));
}
