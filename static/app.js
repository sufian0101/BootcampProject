// ============================================================================
// app.js
//
// The whole frontend of LaunchPath lives in this one file. There's no
// build step and no framework -- just plain JavaScript that:
//   1. Talks to the Flask API in app.py (see the `api` object below)
//   2. Keeps a small `state` object describing what's on screen
//   3. Re-renders the #app div into HTML strings whenever state changes
//
// If you're new to the codebase, start at the bottom: `init()` runs first,
// figures out whether someone's already logged in, and calls render().
// ============================================================================


// ----------------------------------------------------------------------------
// 1. API layer -- every network call to the backend goes through here, so
//    the rest of the app never has to think about fetch() or error handling.
// ----------------------------------------------------------------------------

async function apiRequest(method, path, body) {
  const options = { method, headers: {} };
  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  const response = await fetch(path, options);
  // The backend always responds with JSON, even for errors, so we can
  // safely parse it before checking response.ok.
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    // Every error response from the backend has the shape {"error": "..."}
    throw new Error(data.error || "Something went wrong. Please try again.");
  }
  return data;
}

const api = {
  me: () => apiRequest("GET", "/api/auth/me"),
  tracks: () => apiRequest("GET", "/api/tracks"),
  roadmap: () => apiRequest("GET", "/api/roadmap"),
  login: (email, password, role) => apiRequest("POST", "/api/auth/login", { email, password, role }),
  signup: (name, email, password, track) => apiRequest("POST", "/api/auth/signup", { name, email, password, track }),
  logout: () => apiRequest("POST", "/api/auth/logout"),

  learnerDashboard: () => apiRequest("GET", "/api/learner/dashboard"),
  completeModule: () => apiRequest("POST", "/api/learner/complete-module"),

  adminOverview: () => apiRequest("GET", "/api/admin/overview"),
  adminLearners: (track) => apiRequest("GET", `/api/admin/learners${track && track !== "all" ? `?track=${encodeURIComponent(track)}` : ""}`),
  adminCohorts: () => apiRequest("GET", "/api/admin/cohorts"),
  addCohort: (name, track, startDate) => apiRequest("POST", "/api/admin/cohorts", { name, track, startDate }),
  markPlaced: (id) => apiRequest("POST", `/api/admin/learners/${id}/mark-placed`),
};


// ----------------------------------------------------------------------------
// 2. Application state -- the single source of truth for what's rendered.
//    Nothing outside this object should be treated as "real" app data.
// ----------------------------------------------------------------------------

let state = {
  view: "loading",        // loading | landing | auth | learner | admin
  authRole: "learner",    // which tab is selected on the auth screen
  authMode: "login",      // login | signup
  authError: null,
  authSubmitting: false,

  user: null,             // the logged-in user, or null
  tracks: [],             // static reference data, loaded once
  roadmap: [],            // the 8 shared milestones, loaded once

  learnerData: null,      // { user, roadmap } for the learner dashboard
  adminOverview: null,    // KPI numbers
  adminLearners: [],      // roster rows (respecting the current filter)
  adminCohorts: [],       // cohort list
  rosterFilter: "all",
};


// ----------------------------------------------------------------------------
// 3. Small shared helpers
// ----------------------------------------------------------------------------

function toast(message, isError) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.toggle("error", Boolean(isError));
  el.classList.add("show");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

function trackByName(name) {
  return state.tracks.find((t) => t.name === name) || { code: "", name: name || "" };
}

function statusFor(learner, totalModules) {
  if (learner.placed || learner.completedModules >= totalModules) return { label: "Placed", cls: "badge-status-placed" };
  if (learner.completedModules >= totalModules * 0.75) return { label: "Near graduation", cls: "badge-status-near" };
  if (learner.completedModules >= totalModules * 0.35) return { label: "On track", cls: "badge-status-ontrack" };
  return { label: "New", cls: "badge-status-new" };
}

function initials(name) {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

// Reusable "skill path" visual -- used both on the marketing page (a fixed
// demo position) and on the learner dashboard (their real progress).
// `interactive` adds a clickable next-stop dot that fires a custom event.
function skillPathHTML(roadmap, completedCount, interactive) {
  const fillPct = roadmap.length > 1 ? (Math.max(0, completedCount - 1) / (roadmap.length - 1)) * 100 : 0;
  const stops = roadmap.map((stop, i) => {
    let cls = "";
    if (i < completedCount) cls = "done";
    else if (i === completedCount) cls = "current";
    const clickable = interactive && i === completedCount ? "clickable" : "";
    return `
      <div class="sp-stop ${cls} ${clickable}" ${clickable ? `data-action="complete-next-stop"` : ""}>
        <div class="sp-dot">${i < completedCount ? "✓" : i + 1}</div>
        <div class="sp-title">${stop.title}</div>
      </div>`;
  }).join("");

  return `
    <div class="skillpath"><div class="skillpath-track">
      <div class="sp-line"></div>
      <div class="sp-line-fill" style="width:${fillPct}%"></div>
      ${stops}
    </div></div>`;
}


// ----------------------------------------------------------------------------
// 4. Rendering -- one function per screen. Each returns an HTML string;
//    render() below decides which one to show and injects it into #app.
// ----------------------------------------------------------------------------

function renderLoadingScreen() {
  return `<div class="loading-row" style="padding-top:120px;">Loading SkillsDeveloper…</div>`;
}

function renderLanding() {
  return `
  <nav class="nav"><div class="wrap nav-inner">
    <div class="logo"><span class="logo-mark">SD</span>SkillsDeveloper</div>
    <div class="nav-links">
      <a href="#program">Program</a><a href="#tracks">Tracks</a><a href="#impact">Impact</a>
    </div>
    <div class="nav-actions">
      <button class="btn btn-ghost btn-sm" data-action="go-auth" data-role="learner" data-mode="login">Learner login</button>
      <button class="btn btn-primary btn-sm" data-action="go-auth" data-role="learner" data-mode="signup">Apply now</button>
    </div>
  </div></nav>

  <header class="hero">
    <div class="wrap">
      <div class="eyebrow">Tuition-free · 8 weeks · 4 tracks</div>
      <h1>Skip the resume gap.<br>Build the <span class="accent">skill path</span> to your first tech job.</h1>
      <p class="sub">SkillsDeveloper is a tuition-free digital skills bootcamp for unemployed young jobseekers — real projects, real mentors, and real interviews with hiring partners at the end.</p>
      <div class="hero-actions">
        <button class="btn btn-primary" data-action="go-auth" data-role="learner" data-mode="signup">Apply to a cohort</button>
        <button class="btn btn-ghost" data-action="go-auth" data-role="admin" data-mode="login">Admin sign in</button>
      </div>
      ${skillPathHTML(state.roadmap, 3, false)}
    </div>
  </header>

  <section id="tracks">
    <div class="wrap">
      <div class="section-head">
        <div class="eyebrow">Choose a track</div>
        <h2>One cohort, four ways in.</h2>
        <p>Every track runs the same 8-week rhythm — orientation, core skills, a team project, and job placement prep — just with different tools.</p>
      </div>
      <div class="grid-4">
        ${state.tracks.map((t) => `
          <div class="card track-card">
            <span class="code mono">${t.code}</span>
            <h3>${t.name}</h3>
            <p>${t.blurb}</p>
          </div>`).join("")}
      </div>
    </div>
  </section>

  <section id="program" style="background:var(--paper-dim);">
    <div class="wrap">
      <div class="section-head">
        <div class="eyebrow">The skill path</div>
        <h2>Eight stops from orientation to offer.</h2>
        <p>The same path every learner walks — trackable in your own dashboard once you're enrolled.</p>
      </div>
      <div class="grid-4">
        ${state.roadmap.map((s, i) => `
          <div class="card">
            <span class="code mono" style="background:var(--paper); border:1px solid var(--line);">${String(i + 1).padStart(2, "0")}</span>
            <h3 style="font-size:15.5px; margin-top:12px;">${s.title}</h3>
            <p style="font-size:13.5px; color:var(--slate-soft); margin-top:6px;">${s.blurb}</p>
          </div>`).join("")}
      </div>
    </div>
  </section>

  <div class="stats-bar" id="impact"><div class="wrap stats-grid">
    <div><div class="stat-num">1,240</div><div class="stat-label">Learners trained since launch</div></div>
    <div><div class="stat-num">78%</div><div class="stat-label">Placed in a job within 6 months</div></div>
    <div><div class="stat-num">4</div><div class="stat-label">Skill tracks to choose from</div></div>
    <div><div class="stat-num">$0</div><div class="stat-label">Tuition cost to learners</div></div>
  </div></div>

  <section>
    <div class="wrap">
      <div class="section-head">
        <div class="eyebrow">Graduates</div>
        <h2>What the path feels like from the inside.</h2>
      </div>
      <div class="grid-3">
        <div class="quote-card"><p class="q">"I had zero tech background. Eight weeks later I was walking hiring partners through a project I actually built."</p><div class="who">Cohort 11 · Web Deve[...]
        <div class="quote-card"><p class="q">"The mock interviews were the part I dreaded most and ended up mattering most on the actual day."</p><div class="who">Cohort 12 · IT Support</div></div>
        <div class="quote-card"><p class="q">"Having a mentor look at my portfolio before demo day changed how I talked about my own work."</p><div class="who">Cohort 12 · Data & Analytics</div></div[...]
      </div>
    </div>
  </section>

  <footer><div class="wrap">
    <div>© 2026 SkillsDeveloper. A digital skills bootcamp for unemployed youth.        </div>
    <div style="display:flex; align-items:flex-start; gap:16px;">
      <button class="btn-sm btn-ghost btn" data-action="go-auth" data-role="learner" data-mode="login" style="border-color:rgba(247,245,240,0.3);">Learner login</button>
      <div style="display:flex; flex-direction:column; align-items:flex-start; gap:8px;">
        <button class="btn-sm btn-ghost btn" data-action="go-auth" data-role="admin" data-mode="login" style="border-color:rgba(247,245,240,0.3);">Admin login</button>
        <!-- <div class="eyebrow">Made By Sufian Shaikh</div> -->
      </div>
    </div>
  </div></footer>`;
}

function renderAuth() {
  const isSignup = state.authMode === "signup";
  const isLearner = state.authRole === "learner";

  return `
  <div class="auth-wrap">
    <div class="auth-card">
      <button class="auth-back" data-action="go-landing">← Back to site</button>
      <div style="margin-top:22px; margin-bottom:22px;">
        <div class="logo" style="color:var(--ink);"><span class="logo-mark">SD</span>SkillsDeveloper</div>
      </div>

      <div class="role-toggle">
        <button class="${isLearner ? "active" : ""}" data-action="set-role" data-role="learner">Learner</button>
        <button class="${!isLearner ? "active" : ""}" data-action="set-role" data-role="admin">Admin</button>
      </div>

  