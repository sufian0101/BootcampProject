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
        <div class="quote-card"><p class="q">"I had zero tech background. Eight weeks later I was walking hiring partners through a project I actually built."</p><div class="who">Cohort 11 · Web Development</div></div>
        <div class="quote-card"><p class="q">"The mock interviews were the part I dreaded most and ended up mattering most on the actual day."</p><div class="who">Cohort 12 · IT Support</div></div>
        <div class="quote-card"><p class="q">"Having a mentor look at my portfolio before demo day changed how I talked about my own work."</p><div class="who">Cohort 12 · Data & Analytics</div></div>
      </div>
    </div>
  </section>

  <footer><div class="wrap">
    <div>© 2026 SkillsDeveloper. A digital skills bootcamp for unemployed youth.        </div>
    <div style="display:flex; align-items:flex-start; gap:16px;">
      <button class="btn-sm btn-ghost btn" data-action="go-auth" data-role="learner" data-mode="login" style="border-color:rgba(247,245,240,0.3);">Learner login</button>
      <div style="display:flex; flex-direction:column; align-items:flex-start; gap:8px;">
        <button class="btn-sm btn-ghost btn" data-action="go-auth" data-role="admin" data-mode="login" style="border-color:rgba(247,245,240,0.3);">Admin login</button>
        <div class="eyebrow">Made By Sufian Shaikh</div>
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

      <h2 style="font-size:21px; margin-bottom:6px;">${isSignup ? "Apply to a cohort" : (isLearner ? "Learner sign in" : "Admin sign in")}</h2>
      <p style="font-size:13.5px; color:var(--slate-soft); margin-bottom:22px;">
        ${isSignup ? "Takes about a minute — no tuition, no commitment yet." : "Sign in with your SkillsDeveloper account."}
      </p>

      ${state.authError ? `<div class="auth-error">${state.authError}</div>` : ""}

      <form id="auth-form">
        ${isSignup ? `<div class="field"><label>Full name</label><input type="text" name="name" placeholder="Jordan Ade" required></div>` : ""}
        <div class="field"><label>Email</label><input type="email" name="email" placeholder="you@example.com" required></div>
        <div class="field"><label>Password</label><input type="password" name="password" placeholder="••••••••" required></div>
        ${isSignup ? `
        <div class="field"><label>Choose a track</label>
          <select name="track">${state.tracks.map((t) => `<option value="${t.name}">${t.name} (${t.code})</option>`).join("")}</select>
        </div>` : ""}
        <button type="submit" class="btn btn-primary btn-block" style="margin-top:6px;" ${state.authSubmitting ? "disabled" : ""}>
          ${state.authSubmitting ? "Please wait…" : (isSignup ? "Apply now" : "Sign in")}
        </button>
      </form>

      <div class="auth-switch">
        ${isSignup
          ? `Already have an account? <button data-action="set-mode" data-mode="login">Sign in</button>`
          : (isLearner ? `New here? <button data-action="set-mode" data-mode="signup">Apply to a cohort</button>` : "")}
      </div>

      ${!isSignup ? `<div class="auth-hint">Demo account — ${isLearner ? "amara@example.com / demo1234" : "admin@skillsdeveloper.org "}</div>` : ""}
    </div>
  </div>`;
}

function dashNav() {
  const u = state.user;
  return `
  <nav class="dash-nav"><div class="wrap dash-user" style="justify-content:space-between;">
    <div class="logo"><span class="logo-mark">SD</span>SkillsDeveloper</div>
    <div class="dash-user">
      <span class="role-badge">${u.role}</span>
      <div class="avatar">${initials(u.name)}</div>
      <span style="font-size:14px;">${u.name}</span>
      <button class="btn btn-ghost btn-sm" data-action="logout">Log out</button>
    </div>
  </div></nav>`;
}

function renderLearner() {
  if (!state.learnerData) {
    return `${dashNav()}<div class="loading-row">Loading your dashboard…</div>`;
  }

  const { user, roadmap } = state.learnerData;
  const completed = user.completedModules;
  const pct = Math.round((completed / roadmap.length) * 100);
  const track = trackByName(user.track);

  const modules = roadmap.map((s, i) => {
    let cls = "locked";
    if (i < completed) cls = "done";
    else if (i === completed) cls = "next";
    return `
      <div class="module-row ${cls}" ${cls === "next" ? `data-action="complete-module"` : ""}>
        <div class="module-check">${i < completed ? "✓" : ""}</div>
        <div style="flex:1;">
          <div class="module-title">${s.title}</div>
          <div class="module-blurb">${s.blurb}</div>
        </div>
        ${cls === "next" ? '<span class="badge badge-status-near">Up next</span>' : (cls === "done" ? '<span class="badge badge-status-ontrack">Done</span>' : "")}
      </div>`;
  }).join("");

  const gaugeColor = pct >= 75 ? "var(--teal)" : pct >= 35 ? "var(--amber)" : "var(--coral)";

  return `
  ${dashNav()}
  <div class="dash-body"><div class="wrap">
    <div class="dash-head">
      <div>
        <h1>Welcome back, ${user.name.split(" ")[0]}</h1>
        <p><span class="badge badge-track">${track.code}</span> &nbsp; ${user.track} · ${user.cohort}</p>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Your skill path</h3><span class="mono" style="font-size:12.5px; color:var(--slate-soft);">${completed} of ${roadmap.length} stops complete</span></div>
      ${skillPathHTML(roadmap, completed, true)}
    </div>

    <div class="grid-2">
      <div class="panel">
        <div class="panel-head"><h3>Cohort modules</h3></div>
        ${modules}
      </div>

      <div>
        <div class="panel">
          <div class="panel-head"><h3>Job-readiness score</h3></div>
          <div class="gauge-wrap">
            <div class="gauge" style="background:conic-gradient(${gaugeColor} ${pct}%, var(--paper-dim) 0);">
              <div class="gauge-num">${pct}%</div>
            </div>
            <p style="font-size:13.5px; color:var(--slate-soft);">Rises as you complete each stop on your skill path. Reach 100% by graduation.</p>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><h3>Upcoming sessions</h3></div>
          <ul class="list-simple">
            <li><span>Mock Interview Circle</span><span class="meta">Tue · 6:00 PM</span></li>
            <li><span>Track office hours</span><span class="meta">Wed · 4:30 PM</span></li>
            <li><span>Employer meetup — demo day prep</span><span class="meta">Fri · 5:00 PM</span></li>
          </ul>
        </div>

        <div class="panel">
          <div class="panel-head"><h3>Resources</h3></div>
          <ul class="list-simple">
            <li><span>Resume template</span><span class="meta">PDF</span></li>
            <li><span>Cohort Slack invite</span><span class="meta">Link</span></li>
            <li><span>Track starter kit — ${track.code}</span><span class="meta">ZIP</span></li>
          </ul>
        </div>
      </div>
    </div>
  </div></div>`;
}

function renderAdmin() {
  if (!state.adminOverview) {
    return `${dashNav()}<div class="loading-row">Loading program data…</div>`;
  }

  const overview = state.adminOverview;
  const totalModules = state.roadmap.length || 8;

  const rosterRows = state.adminLearners.map((l) => {
    const st = statusFor(l, totalModules);
    const pct = Math.round((l.completedModules / totalModules) * 100);
    const canMarkPlaced = l.completedModules >= totalModules && !l.placed;
    return `
      <tr>
        <td><div style="display:flex; align-items:center; gap:10px;"><div class="avatar" style="width:28px;height:28px;font-size:11px;">${initials(l.name)}</div>${l.name}</div></td>
        <td><span class="badge badge-track">${trackByName(l.track).code}</span></td>
        <td class="mono" style="font-size:12.5px;">${l.cohort || "—"}</td>
        <td><span class="progress-mini"><span class="progress-mini-fill" style="width:${pct}%;"></span></span><span class="mono" style="font-size:12px;">${l.completedModules}/${totalModules}</span></td>
        <td><span class="badge ${st.cls}">${st.label}</span></td>
        <td><button class="btn btn-outline btn-sm" data-action="mark-placed" data-id="${l.id}" ${canMarkPlaced ? "" : "disabled"}>Mark placed</button></td>
      </tr>`;
  }).join("");

  const maxCount = Math.max(...overview.enrollmentByTrack.map((t) => t.count), 1);
  const bars = overview.enrollmentByTrack.map((t) => {
    const h = Math.max(6, (t.count / maxCount) * 100);
    return `
      <div class="bar-col">
        <div class="bar-val">${t.count}</div>
        <div class="bar" style="height:${h}%;"></div>
        <div class="bar-label">${t.code}</div>
      </div>`;
  }).join("");

  const cohortRows = state.adminCohorts.map((c) => `
    <li><span>${c.name} <span class="mono" style="color:var(--slate-soft); font-size:12px;">— ${trackByName(c.track).code}</span></span><span class="meta">${c.startDate} · ${c.enrolled} enrolled</span></li>
  `).join("");

  return `
  ${dashNav()}
  <div class="dash-body"><div class="wrap">
    <div class="dash-head">
      <div>
        <h1>Program overview</h1>
        <p>Everything happening across active cohorts.</p>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi"><div class="n">${overview.totalLearners}</div><div class="l">Total learners</div></div>
      <div class="kpi"><div class="n">${overview.activeCohorts}</div><div class="l">Active cohorts</div></div>
      <div class="kpi"><div class="n">${overview.avgCompletion}%</div><div class="l">Avg. skill-path completion</div></div>
      <div class="kpi"><div class="n">${overview.placementRate}%</div><div class="l">Placement rate</div></div>
    </div>

    <div class="grid-2">
      <div class="panel">
        <div class="panel-head"><h3>Enrollment by track</h3></div>
        <div class="bar-chart">${bars}</div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Cohorts</h3></div>
        <ul class="list-simple">${cohortRows}</ul>
        <form id="cohort-form" class="form-row" style="margin-top:18px;">
          <div class="field"><label>Cohort name</label><input type="text" name="name" placeholder="Cohort 15" required></div>
          <div class="field"><label>Track</label><select name="track">${state.tracks.map((t) => `<option value="${t.name}">${t.code}</option>`).join("")}</select></div>
          <div class="field"><label>Start</label><input type="text" name="startDate" placeholder="Oct 2026" required></div>
          <button type="submit" class="btn btn-primary btn-sm">Add cohort</button>
        </form>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h3>Learner roster</h3>
        <select class="select-filter" id="roster-filter">
          <option value="all" ${state.rosterFilter === "all" ? "selected" : ""}>All tracks</option>
          ${state.tracks.map((t) => `<option value="${t.name}" ${state.rosterFilter === t.name ? "selected" : ""}>${t.name}</option>`).join("")}
        </select>
      </div>
      <table>
        <thead><tr><th>Name</th><th>Track</th><th>Cohort</th><th>Progress</th><th>Status</th><th></th></tr></thead>
        <tbody>${rosterRows}</tbody>
      </table>
    </div>
  </div></div>`;
}

function render() {
  const app = document.getElementById("app");
  if (state.view === "loading") app.innerHTML = renderLoadingScreen();
  else if (state.view === "landing") app.innerHTML = renderLanding();
  else if (state.view === "auth") app.innerHTML = renderAuth();
  else if (state.view === "learner") app.innerHTML = renderLearner();
  else if (state.view === "admin") app.innerHTML = renderAdmin();
  bindEvents();
}


// ----------------------------------------------------------------------------
// 5. Actions -- functions that change state and/or talk to the backend,
//    then re-render. These are what the event bindings below call into.
// ----------------------------------------------------------------------------

function goLanding() {
  state.view = "landing";
  render();
}

function goAuth(role, mode) {
  state.authRole = role;
  state.authMode = mode;
  state.authError = null;
  state.view = "auth";
  render();
}

async function submitAuthForm(formData) {
  state.authSubmitting = true;
  state.authError = null;
  render();

  try {
    let result;
    if (state.authMode === "signup") {
      result = await api.signup(formData.get("name"), formData.get("email"), formData.get("password"), formData.get("track"));
      toast("Application received — welcome to the cohort!");
    } else {
      result = await api.login(formData.get("email"), formData.get("password"), state.authRole);
      toast("Signed in.");
    }
    state.user = result.user;
    state.authSubmitting = false;
    await routeToDashboard();
  } catch (err) {
    state.authSubmitting = false;
    state.authError = err.message;
    render();
  }
}

async function logout() {
  try {
    await api.logout();
  } finally {
    state.user = null;
    state.learnerData = null;
    state.adminOverview = null;
    state.adminLearners = [];
    state.adminCohorts = [];
    goLanding();
  }
}

// After login/signup (or on page refresh with an existing session), send
// the user to the right dashboard and load the data it needs.
async function routeToDashboard() {
  if (state.user.role === "admin") {
    state.view = "admin";
    render(); // show the "loading program data" skeleton immediately
    await loadAdminDashboard();
  } else {
    state.view = "learner";
    render();
    await loadLearnerDashboard();
  }
}

async function loadLearnerDashboard() {
  try {
    const data = await api.learnerDashboard();
    state.learnerData = data;
    state.user = data.user;
    render();
  } catch (err) {
    toast(err.message, true);
  }
}

async function completeNextModule() {
  try {
    const result = await api.completeModule();
    state.learnerData.user = result.user;
    toast(result.user.completedModules >= state.roadmap.length ? "Skill path complete — you graduated! 🎉" : "Module marked complete.");
    render();
  } catch (err) {
    toast(err.message, true);
  }
}

async function loadAdminDashboard() {
  try {
    const [overview, learners, cohorts] = await Promise.all([
      api.adminOverview(),
      api.adminLearners(state.rosterFilter),
      api.adminCohorts(),
    ]);
    state.adminOverview = overview;
    state.adminLearners = learners.learners;
    state.adminCohorts = cohorts.cohorts;
    render();
  } catch (err) {
    toast(err.message, true);
  }
}

async function changeRosterFilter(track) {
  state.rosterFilter = track;
  try {
    const { learners } = await api.adminLearners(track);
    state.adminLearners = learners;
    render();
  } catch (err) {
    toast(err.message, true);
  }
}

async function markLearnerPlaced(id) {
  try {
    await api.markPlaced(id);
    toast("Learner marked as placed.");
    await loadAdminDashboard();
  } catch (err) {
    toast(err.message, true);
  }
}

async function submitCohortForm(formData) {
  try {
    await api.addCohort(formData.get("name"), formData.get("track"), formData.get("startDate"));
    toast("Cohort added.");
    await loadAdminDashboard();
  } catch (err) {
    toast(err.message, true);
  }
}


// ----------------------------------------------------------------------------
// 6. Event binding -- since we replace #app's innerHTML on every render(),
//    listeners have to be reattached each time. Everything is delegated
//    through simple data-action attributes in the templates above.
// ----------------------------------------------------------------------------

function bindEvents() {
  document.querySelectorAll('[data-action="go-auth"]').forEach((el) => {
    el.addEventListener("click", () => goAuth(el.dataset.role, el.dataset.mode));
  });

  const backBtn = document.querySelector('[data-action="go-landing"]');
  if (backBtn) backBtn.addEventListener("click", goLanding);

  document.querySelectorAll('[data-action="set-role"]').forEach((el) => {
    el.addEventListener("click", () => { state.authRole = el.dataset.role; state.authError = null; render(); });
  });
  document.querySelectorAll('[data-action="set-mode"]').forEach((el) => {
    el.addEventListener("click", () => { state.authMode = el.dataset.mode; state.authError = null; render(); });
  });

  const authForm = document.getElementById("auth-form");
  if (authForm) {
    authForm.addEventListener("submit", (e) => {
      e.preventDefault();
      submitAuthForm(new FormData(authForm));
    });
  }

  const cohortForm = document.getElementById("cohort-form");
  if (cohortForm) {
    cohortForm.addEventListener("submit", (e) => {
      e.preventDefault();
      submitCohortForm(new FormData(cohortForm));
      cohortForm.reset();
    });
  }

  const rosterFilter = document.getElementById("roster-filter");
  if (rosterFilter) {
    rosterFilter.addEventListener("change", () => changeRosterFilter(rosterFilter.value));
  }

  document.querySelectorAll('[data-action="mark-placed"]').forEach((el) => {
    el.addEventListener("click", () => markLearnerPlaced(el.dataset.id));
  });

  const completeModuleRow = document.querySelector('[data-action="complete-module"]');
  if (completeModuleRow) completeModuleRow.addEventListener("click", completeNextModule);

  const completeStopDot = document.querySelector('[data-action="complete-next-stop"]');
  if (completeStopDot) completeStopDot.addEventListener("click", completeNextModule);

  const logoutBtn = document.querySelector('[data-action="logout"]');
  if (logoutBtn) logoutBtn.addEventListener("click", logout);
}


// ----------------------------------------------------------------------------
// 7. Startup -- runs once when the page loads.
// ----------------------------------------------------------------------------

async function init() {
  try {
    // Reference data (tracks, roadmap) and "am I logged in?" can all be
    // fetched in parallel since none of them depend on each other.
    const [meResult, tracksResult, roadmapResult] = await Promise.all([
      api.me(),
      api.tracks(),
      api.roadmap(),
    ]);

    state.tracks = tracksResult.tracks;
    state.roadmap = roadmapResult.roadmap;
    state.user = meResult.user;

    if (state.user) {
      await routeToDashboard();
    } else {
      state.view = "landing";
      render();
    }
  } catch (err) {
    // If the very first load fails (e.g. server not running yet), show a
    // plain message instead of a blank page.
    document.getElementById("app").innerHTML =
      `<div class="loading-row" style="padding-top:120px;">Couldn't reach the server. Is the Flask app running?<br>${err.message}</div>`;
  }
}

init();
// ============================================================================
// app.js

// The whole frontend of LaunchPath lives in this one file. There's no
// build step and no framework -- just plain JavaScript that:
//   1. Talks to the Flask API in app.py (see the `api` object below)
//   2. Keeps a small `state` object describing what's on screen
//   3. Re-renders the #app div into HTML strings whenever state changes

// If you're new to the codebase, start at the bottom: `init()` runs first,
// figures out whether someone's already logged in, and calls render().
// ============================================================================


// ----------------------------------------------------------------------------
// 0. Theme (dark / light) -- NEW
//    Runs immediately, before anything else, so the correct theme is set
//    before the first paint (no flash of the wrong theme on load).
// ----------------------------------------------------------------------------

// document.documentElement.setAttribute("data-theme", localStorage.getItem("theme") || "light");

// function toggleTheme() {
//   const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
//   document.documentElement.setAttribute("data-theme", next);
//   localStorage.setItem("theme", next);
// }

// // Reusable markup for the toggle button, used in the landing nav, the
// // dashboard nav, and the auth screen. The sun/moon icon swap itself is
// // pure CSS (see .theme-toggle .icon-sun / .icon-moon in styles.css) --
// // this function just outputs the button + both icons every time.
// function themeToggleHTML(extraClass) {
//   return `
//     <button class="theme-toggle ${extraClass || ""}" data-action="toggle-theme" aria-label="Toggle dark mode">
//       <svg class="icon-moon" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>
//       <svg class="icon-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
//     </button>`;
// }


// // ----------------------------------------------------------------------------
// // 1. API layer -- every network call to the backend goes through here, so
// //    the rest of the app never has to think about fetch() or error handling.
// // ----------------------------------------------------------------------------

// async function apiRequest(method, path, body) {
//   const options = { method, headers: {} };
//   if (body !== undefined) {
//     options.headers["Content-Type"] = "application/json";
//     options.body = JSON.stringify(body);
//   }

//   const response = await fetch(path, options);
//   // The backend always responds with JSON, even for errors, so we can
//   // safely parse it before checking response.ok.
//   const data = await response.json().catch(() => ({}));

//   if (!response.ok) {
//     // Every error response from the backend has the shape {"error": "..."}
//     throw new Error(data.error || "Something went wrong. Please try again.");
//   }
//   return data;
// }

// const api = {
//   me: () => apiRequest("GET", "/api/auth/me"),
//   tracks: () => apiRequest("GET", "/api/tracks"),
//   roadmap: () => apiRequest("GET", "/api/roadmap"),
//   login: (email, password, role) => apiRequest("POST", "/api/auth/login", { email, password, role }),
//   signup: (name, email, password, track) => apiRequest("POST", "/api/auth/signup", { name, email, password, track }),
//   logout: () => apiRequest("POST", "/api/auth/logout"),

//   learnerDashboard: () => apiRequest("GET", "/api/learner/dashboard"),
//   completeModule: () => apiRequest("POST", "/api/learner/complete-module"),

//   adminOverview: () => apiRequest("GET", "/api/admin/overview"),
//   adminLearners: (track) => apiRequest("GET", `/api/admin/learners${track && track !== "all" ? `?track=${encodeURIComponent(track)}` : ""}`),
//   adminCohorts: () => apiRequest("GET", "/api/admin/cohorts"),
//   addCohort: (name, track, startDate) => apiRequest("POST", "/api/admin/cohorts", { name, track, startDate }),
//   markPlaced: (id) => apiRequest("POST", `/api/admin/learners/${id}/mark-placed`),
// };


// // ----------------------------------------------------------------------------
// // 2. Application state -- the single source of truth for what's rendered.
// //    Nothing outside this object should be treated as "real" app data.
// // ----------------------------------------------------------------------------

// let state = {
//   view: "loading",        // loading | landing | auth | learner | admin
//   authRole: "learner",    // which tab is selected on the auth screen
//   authMode: "login",      // login | signup
//   authError: null,
//   authSubmitting: false,

//   user: null,             // the logged-in user, or null
//   tracks: [],             // static reference data, loaded once
//   roadmap: [],            // the 8 shared milestones, loaded once

//   learnerData: null,      // { user, roadmap } for the learner dashboard
//   adminOverview: null,    // KPI numbers
//   adminLearners: [],      // roster rows (respecting the current filter)
//   adminCohorts: [],       // cohort list
//   rosterFilter: "all",
// };


// // ----------------------------------------------------------------------------
// // 3. Small shared helpers
// // ----------------------------------------------------------------------------

// function toast(message, isError) {
//   const el = document.getElementById("toast");
//   el.textContent = message;
//   el.classList.toggle("error", Boolean(isError));
//   el.classList.add("show");
//   clearTimeout(window.__toastTimer);
//   window.__toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
// }

// function trackByName(name) {
//   return state.tracks.find((t) => t.name === name) || { code: "", name: name || "" };
// }

// function statusFor(learner, totalModules) {
//   if (learner.placed || learner.completedModules >= totalModules) return { label: "Placed", cls: "badge-status-placed" };
//   if (learner.completedModules >= totalModules * 0.75) return { label: "Near graduation", cls: "badge-status-near" };
//   if (learner.completedModules >= totalModules * 0.35) return { label: "On track", cls: "badge-status-ontrack" };
//   return { label: "New", cls: "badge-status-new" };
// }

// function initials(name) {
//   return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
// }

// // Reusable "skill path" visual -- used both on the marketing page (a fixed
// // demo position) and on the learner dashboard (their real progress).
// // `interactive` adds a clickable next-stop dot that fires a custom event.
// function skillPathHTML(roadmap, completedCount, interactive) {
//   const fillPct = roadmap.length > 1 ? (Math.max(0, completedCount - 1) / (roadmap.length - 1)) * 100 : 0;
//   const stops = roadmap.map((stop, i) => {
//     let cls = "";
//     if (i < completedCount) cls = "done";
//     else if (i === completedCount) cls = "current";
//     const clickable = interactive && i === completedCount ? "clickable" : "";
//     return `
//       <div class="sp-stop ${cls} ${clickable}" ${clickable ? `data-action="complete-next-stop"` : ""}>
//         <div class="sp-dot">${i < completedCount ? "✓" : i + 1}</div>
//         <div class="sp-title">${stop.title}</div>
//       </div>`;
//   }).join("");

//   return `
//     <div class="skillpath"><div class="skillpath-track">
//       <div class="sp-line"></div>
//       <div class="sp-line-fill" style="width:${fillPct}%"></div>
//       ${stops}
//     </div></div>`;
// }


// // ----------------------------------------------------------------------------
// // 4. Rendering -- one function per screen. Each returns an HTML string;
// //    render() below decides which one to show and injects it into #app.
// // ----------------------------------------------------------------------------

// function renderLoadingScreen() {
//   return `<div class="loading-row" style="padding-top:120px;">Loading LaunchPath…</div>`;
// }

// function renderLanding() {
//   return `
//   <nav class="nav"><div class="wrap nav-inner">
//     <div class="logo"><span class="logo-mark">LP</span>LaunchPath</div>
//     <div class="nav-links">
//       <a href="#program">Program</a><a href="#tracks">Tracks</a><a href="#impact">Impact</a>
//     </div>
//     <div class="nav-actions">
//       <button class="btn btn-ghost btn-sm" data-action="go-auth" data-role="learner" data-mode="login">Learner login</button>
//       <button class="btn btn-primary btn-sm" data-action="go-auth" data-role="learner" data-mode="signup">Apply now</button>
//       ${themeToggleHTML()}
//     </div>
//   </div></nav>

//   <header class="hero">
//     <div class="wrap">
//       <div class="eyebrow">Tuition-free · 8 weeks · 4 tracks</div>
//       <h1>Skip the resume gap.<br>Build the <span class="accent">skill path</span> to your first tech job.</h1>
//       <p class="sub">LaunchPath is a tuition-free digital skills bootcamp for unemployed young jobseekers — real projects, real mentors, and real interviews with hiring partners at the end.</p>
//       <div class="hero-actions">
//         <button class="btn btn-primary" data-action="go-auth" data-role="learner" data-mode="signup">Apply to a cohort</button>
//         <button class="btn btn-ghost" data-action="go-auth" data-role="admin" data-mode="login">Admin sign in</button>
//       </div>
//       ${skillPathHTML(state.roadmap, 3, false)}
//     </div>
//   </header>

//   <section id="tracks">
//     <div class="wrap">
//       <div class="section-head">
//         <div class="eyebrow">Choose a track</div>
//         <h2>One cohort, four ways in.</h2>
//         <p>Every track runs the same 8-week rhythm — orientation, core skills, a team project, and job placement prep — just with different tools.</p>
//       </div>
//       <div class="grid-4">
//         ${state.tracks.map((t) => `
//           <div class="card track-card">
//             <span class="code mono">${t.code}</span>
//             <h3>${t.name}</h3>
//             <p>${t.blurb}</p>
//           </div>`).join("")}
//       </div>
//     </div>
//   </section>

//   <section id="program" style="background:var(--paper-dim);">
//     <div class="wrap">
//       <div class="section-head">
//         <div class="eyebrow">The skill path</div>
//         <h2>Eight stops from orientation to offer.</h2>
//         <p>The same path every learner walks — trackable in your own dashboard once you're enrolled.</p>
//       </div>
//       <div class="grid-4">
//         ${state.roadmap.map((s, i) => `
//           <div class="card">
//             <span class="code mono" style="background:var(--paper); border:1px solid var(--line);">${String(i + 1).padStart(2, "0")}</span>
//             <h3 style="font-size:15.5px; margin-top:12px;">${s.title}</h3>
//             <p style="font-size:13.5px; color:var(--slate-soft); margin-top:6px;">${s.blurb}</p>
//           </div>`).join("")}
//       </div>
//     </div>
//   </section>

//   <div class="stats-bar" id="impact"><div class="wrap stats-grid">
//     <div><div class="stat-num">1,240</div><div class="stat-label">Learners trained since launch</div></div>
//     <div><div class="stat-num">78%</div><div class="stat-label">Placed in a job within 6 months</div></div>
//     <div><div class="stat-num">4</div><div class="stat-label">Skill tracks to choose from</div></div>
//     <div><div class="stat-num">$0</div><div class="stat-label">Tuition cost to learners</div></div>
//   </div></div>

//   <section>
//     <div class="wrap">
//       <div class="section-head">
//         <div class="eyebrow">Graduates</div>
//         <h2>What the path feels like from the inside.</h2>
//       </div>
//       <div class="grid-3">
//         <div class="quote-card"><p class="q">"I had zero tech background. Eight weeks later I was walking hiring partners through a project I actually built."</p><div class="who">Cohort 11 · Web Development</div></div>
//         <div class="quote-card"><p class="q">"The mock interviews were the part I dreaded most and ended up mattering most on the actual day."</p><div class="who">Cohort 12 · IT Support</div></div>
//         <div class="quote-card"><p class="q">"Having a mentor look at my portfolio before demo day changed how I talked about my own work."</p><div class="who">Cohort 12 · Data & Analytics</div></div>
//       </div>
//     </div>
//   </section>

//   <footer><div class="wrap">
//     <div>© 2026 LaunchPath. A digital skills bootcamp for unemployed youth.</div>
//     <div style="display:flex; gap:16px;">
//       <button class="btn-sm btn-ghost btn" data-action="go-auth" data-role="learner" data-mode="login" style="border-color:rgba(247,245,240,0.3);">Learner login</button>
//       <button class="btn-sm btn-ghost btn" data-action="go-auth" data-role="admin" data-mode="login" style="border-color:rgba(247,245,240,0.3);">Admin login</button>
//     </div>
//   </div></footer>`;
// }

// function renderAuth() {
//   const isSignup = state.authMode === "signup";
//   const isLearner = state.authRole === "learner";

//   return `
//   <div class="auth-wrap">
//     <div class="auth-card">
//       <button class="auth-back" data-action="go-landing">← Back to site</button>
//       ${themeToggleHTML("auth-theme-toggle")}
//       <div style="margin-top:22px; margin-bottom:22px;">
//         <div class="logo" style="color:var(--ink);"><span class="logo-mark">LP</span>LaunchPath</div>
//       </div>

//       <div class="role-toggle">
//         <button class="${isLearner ? "active" : ""}" data-action="set-role" data-role="learner">Learner</button>
//         <button class="${!isLearner ? "active" : ""}" data-action="set-role" data-role="admin">Admin</button>
//       </div>

//       <h2 style="font-size:21px; margin-bottom:6px;">${isSignup ? "Apply to a cohort" : (isLearner ? "Learner sign in" : "Admin sign in")}</h2>
//       <p style="font-size:13.5px; color:var(--slate-soft); margin-bottom:22px;">
//         ${isSignup ? "Takes about a minute — no tuition, no commitment yet." : "Sign in with your LaunchPath account."}
//       </p>

//       ${state.authError ? `<div class="auth-error">${state.authError}</div>` : ""}

//       <form id="auth-form">
//         ${isSignup ? `<div class="field"><label>Full name</label><input type="text" name="name" placeholder="Jordan Ade" required></div>` : ""}
//         <div class="field"><label>Email</label><input type="email" name="email" placeholder="you@example.com" required></div>
//         <div class="field"><label>Password</label><input type="password" name="password" placeholder="••••••••" required></div>
//         ${isSignup ? `
//         <div class="field"><label>Choose a track</label>
//           <select name="track">${state.tracks.map((t) => `<option value="${t.name}">${t.name} (${t.code})</option>`).join("")}</select>
//         </div>` : ""}
//         <button type="submit" class="btn btn-primary btn-block" style="margin-top:6px;" ${state.authSubmitting ? "disabled" : ""}>
//           ${state.authSubmitting ? "Please wait…" : (isSignup ? "Apply now" : "Sign in")}
//         </button>
//       </form>

//       <div class="auth-switch">
//         ${isSignup
//           ? `Already have an account? <button data-action="set-mode" data-mode="login">Sign in</button>`
//           : (isLearner ? `New here? <button data-action="set-mode" data-mode="signup">Apply to a cohort</button>` : "")}
//       </div>

//       ${!isSignup ? `<div class="auth-hint">Demo account — ${isLearner ? "amara@example.com / demo1234" : "admin@launchpath.org "}</div>` : ""}
//     </div>
//   </div>`;
// }

// function dashNav() {
//   const u = state.user;
//   return `
//   <nav class="dash-nav"><div class="wrap dash-user" style="justify-content:space-between;">
//     <div class="logo"><span class="logo-mark">LP</span>LaunchPath</div>
//     <div class="dash-user">
//       <span class="role-badge">${u.role}</span>
//       <div class="avatar">${initials(u.name)}</div>
//       <span style="font-size:14px;">${u.name}</span>
//       <button class="btn btn-ghost btn-sm" data-action="logout">Log out</button>
//       ${themeToggleHTML()}
//     </div>
//   </div></nav>`;
// }

// function renderLearner() {
//   if (!state.learnerData) {
//     return `${dashNav()}<div class="loading-row">Loading your dashboard…</div>`;
//   }

//   const { user, roadmap } = state.learnerData;
//   const completed = user.completedModules;
//   const pct = Math.round((completed / roadmap.length) * 100);
//   const track = trackByName(user.track);

//   const modules = roadmap.map((s, i) => {
//     let cls = "locked";
//     if (i < completed) cls = "done";
//     else if (i === completed) cls = "next";
//     return `
//       <div class="module-row ${cls}" ${cls === "next" ? `data-action="complete-module"` : ""}>
//         <div class="module-check">${i < completed ? "✓" : ""}</div>
//         <div style="flex:1;">
//           <div class="module-title">${s.title}</div>
//           <div class="module-blurb">${s.blurb}</div>
//         </div>
//         ${cls === "next" ? '<span class="badge badge-status-near">Up next</span>' : (cls === "done" ? '<span class="badge badge-status-ontrack">Done</span>' : "")}
//       </div>`;
//   }).join("");

//   const gaugeColor = pct >= 75 ? "var(--teal)" : pct >= 35 ? "var(--amber)" : "var(--coral)";

//   return `
//   ${dashNav()}
//   <div class="dash-body"><div class="wrap">
//     <div class="dash-head">
//       <div>
//         <h1>Welcome back, ${user.name.split(" ")[0]}</h1>
//         <p><span class="badge badge-track">${track.code}</span> &nbsp; ${user.track} · ${user.cohort}</p>
//       </div>
//     </div>

//     <div class="panel">
//       <div class="panel-head"><h3>Your skill path</h3><span class="mono" style="font-size:12.5px; color:var(--slate-soft);">${completed} of ${roadmap.length} stops complete</span></div>
//       ${skillPathHTML(roadmap, completed, true)}
//     </div>

//     <div class="grid-2">
//       <div class="panel">
//         <div class="panel-head"><h3>Cohort modules</h3></div>
//         ${modules}
//       </div>

//       <div>
//         <div class="panel">
//           <div class="panel-head"><h3>Job-readiness score</h3></div>
//           <div class="gauge-wrap">
//             <div class="gauge" style="background:conic-gradient(${gaugeColor} ${pct}%, var(--paper-dim) 0);">
//               <div class="gauge-num">${pct}%</div>
//             </div>
//             <p style="font-size:13.5px; color:var(--slate-soft);">Rises as you complete each stop on your skill path. Reach 100% by graduation.</p>
//           </div>
//         </div>

//         <div class="panel">
//           <div class="panel-head"><h3>Upcoming sessions</h3></div>
//           <ul class="list-simple">
//             <li><span>Mock Interview Circle</span><span class="meta">Tue · 6:00 PM</span></li>
//             <li><span>Track office hours</span><span class="meta">Wed · 4:30 PM</span></li>
//             <li><span>Employer meetup — demo day prep</span><span class="meta">Fri · 5:00 PM</span></li>
//           </ul>
//         </div>

//         <div class="panel">
//           <div class="panel-head"><h3>Resources</h3></div>
//           <ul class="list-simple">
//             <li><span>Resume template</span><span class="meta">PDF</span></li>
//             <li><span>Cohort Slack invite</span><span class="meta">Link</span></li>
//             <li><span>Track starter kit — ${track.code}</span><span class="meta">ZIP</span></li>
//           </ul>
//         </div>
//       </div>
//     </div>
//   </div></div>`;
// }

// function renderAdmin() {
//   if (!state.adminOverview) {
//     return `${dashNav()}<div class="loading-row">Loading program data…</div>`;
//   }

//   const overview = state.adminOverview;
//   const totalModules = state.roadmap.length || 8;

//   const rosterRows = state.adminLearners.map((l) => {
//     const st = statusFor(l, totalModules);
//     const pct = Math.round((l.completedModules / totalModules) * 100);
//     const canMarkPlaced = l.completedModules >= totalModules && !l.placed;
//     return `
//       <tr>
//         <td><div style="display:flex; align-items:center; gap:10px;"><div class="avatar" style="width:28px;height:28px;font-size:11px;">${initials(l.name)}</div>${l.name}</div></td>
//         <td><span class="badge badge-track">${trackByName(l.track).code}</span></td>
//         <td class="mono" style="font-size:12.5px;">${l.cohort || "—"}</td>
//         <td><span class="progress-mini"><span class="progress-mini-fill" style="width:${pct}%;"></span></span><span class="mono" style="font-size:12px;">${l.completedModules}/${totalModules}</span></td>
//         <td><span class="badge ${st.cls}">${st.label}</span></td>
//         <td><button class="btn btn-outline btn-sm" data-action="mark-placed" data-id="${l.id}" ${canMarkPlaced ? "" : "disabled"}>Mark placed</button></td>
//       </tr>`;
//   }).join("");

//   const maxCount = Math.max(...overview.enrollmentByTrack.map((t) => t.count), 1);
//   const bars = overview.enrollmentByTrack.map((t) => {
//     const h = Math.max(6, (t.count / maxCount) * 100);
//     return `
//       <div class="bar-col">
//         <div class="bar-val">${t.count}</div>
//         <div class="bar" style="height:${h}%;"></div>
//         <div class="bar-label">${t.code}</div>
//       </div>`;
//   }).join("");

//   const cohortRows = state.adminCohorts.map((c) => `
//     <li><span>${c.name} <span class="mono" style="color:var(--slate-soft); font-size:12px;">— ${trackByName(c.track).code}</span></span><span class="meta">${c.startDate} · ${c.enrolled} enrolled</span></li>
//   `).join("");

//   return `
//   ${dashNav()}
//   <div class="dash-body"><div class="wrap">
//     <div class="dash-head">
//       <div>
//         <h1>Program overview</h1>
//         <p>Everything happening across active cohorts.</p>
//       </div>
//     </div>

//     <div class="kpi-grid">
//       <div class="kpi"><div class="n">${overview.totalLearners}</div><div class="l">Total learners</div></div>
//       <div class="kpi"><div class="n">${overview.activeCohorts}</div><div class="l">Active cohorts</div></div>
//       <div class="kpi"><div class="n">${overview.avgCompletion}%</div><div class="l">Avg. skill-path completion</div></div>
//       <div class="kpi"><div class="n">${overview.placementRate}%</div><div class="l">Placement rate</div></div>
//     </div>

//     <div class="grid-2">
//       <div class="panel">
//         <div class="panel-head"><h3>Enrollment by track</h3></div>
//         <div class="bar-chart">${bars}</div>
//       </div>
//       <div class="panel">
//         <div class="panel-head"><h3>Cohorts</h3></div>
//         <ul class="list-simple">${cohortRows}</ul>
//         <form id="cohort-form" class="form-row" style="margin-top:18px;">
//           <div class="field"><label>Cohort name</label><input type="text" name="name" placeholder="Cohort 15" required></div>
//           <div class="field"><label>Track</label><select name="track">${state.tracks.map((t) => `<option value="${t.name}">${t.code}</option>`).join("")}</select></div>
//           <div class="field"><label>Start</label><input type="text" name="startDate" placeholder="Oct 2026" required></div>
//           <button type="submit" class="btn btn-primary btn-sm">Add cohort</button>
//         </form>
//       </div>
//     </div>

//     <div class="panel">
//       <div class="panel-head">
//         <h3>Learner roster</h3>
//         <select class="select-filter" id="roster-filter">
//           <option value="all" ${state.rosterFilter === "all" ? "selected" : ""}>All tracks</option>
//           ${state.tracks.map((t) => `<option value="${t.name}" ${state.rosterFilter === t.name ? "selected" : ""}>${t.name}</option>`).join("")}
//         </select>
//       </div>
//       <table>
//         <thead><tr><th>Name</th><th>Track</th><th>Cohort</th><th>Progress</th><th>Status</th><th></th></tr></thead>
//         <tbody>${rosterRows}</tbody>
//       </table>
//     </div>
//   </div></div>`;
// }

// function render() {
//   const app = document.getElementById("app");
//   if (state.view === "loading") app.innerHTML = renderLoadingScreen();
//   else if (state.view === "landing") app.innerHTML = renderLanding();
//   else if (state.view === "auth") app.innerHTML = renderAuth();
//   else if (state.view === "learner") app.innerHTML = renderLearner();
//   else if (state.view === "admin") app.innerHTML = renderAdmin();
//   bindEvents();
// }


// // ----------------------------------------------------------------------------
// // 5. Actions -- functions that change state and/or talk to the backend,
// //    then re-render. These are what the event bindings below call into.
// // ----------------------------------------------------------------------------

// function goLanding() {
//   state.view = "landing";
//   render();
// }

// function goAuth(role, mode) {
//   state.authRole = role;
//   state.authMode = mode;
//   state.authError = null;
//   state.view = "auth";
//   render();
// }

// async function submitAuthForm(formData) {
//   state.authSubmitting = true;
//   state.authError = null;
//   render();

//   try {
//     let result;
//     if (state.authMode === "signup") {
//       result = await api.signup(formData.get("name"), formData.get("email"), formData.get("password"), formData.get("track"));
//       toast("Application received — welcome to the cohort!");
//     } else {
//       result = await api.login(formData.get("email"), formData.get("password"), state.authRole);
//       toast("Signed in.");
//     }
//     state.user = result.user;
//     state.authSubmitting = false;
//     await routeToDashboard();
//   } catch (err) {
//     state.authSubmitting = false;
//     state.authError = err.message;
//     render();
//   }
// }

// async function logout() {
//   try {
//     await api.logout();
//   } finally {
//     state.user = null;
//     state.learnerData = null;
//     state.adminOverview = null;
//     state.adminLearners = [];
//     state.adminCohorts = [];
//     goLanding();
//   }
// }

// // After login/signup (or on page refresh with an existing session), send
// // the user to the right dashboard and load the data it needs.
// async function routeToDashboard() {
//   if (state.user.role === "admin") {
//     state.view = "admin";
//     render(); // show the "loading program data" skeleton immediately
//     await loadAdminDashboard();
//   } else {
//     state.view = "learner";
//     render();
//     await loadLearnerDashboard();
//   }
// }

// async function loadLearnerDashboard() {
//   try {
//     const data = await api.learnerDashboard();
//     state.learnerData = data;
//     state.user = data.user;
//     render();
//   } catch (err) {
//     toast(err.message, true);
//   }
// }

// async function completeNextModule() {
//   try {
//     const result = await api.completeModule();
//     state.learnerData.user = result.user;
//     toast(result.user.completedModules >= state.roadmap.length ? "Skill path complete — you graduated! 🎉" : "Module marked complete.");
//     render();
//   } catch (err) {
//     toast(err.message, true);
//   }
// }

// async function loadAdminDashboard() {
//   try {
//     const [overview, learners, cohorts] = await Promise.all([
//       api.adminOverview(),
//       api.adminLearners(state.rosterFilter),
//       api.adminCohorts(),
//     ]);
//     state.adminOverview = overview;
//     state.adminLearners = learners.learners;
//     state.adminCohorts = cohorts.cohorts;
//     render();
//   } catch (err) {
//     toast(err.message, true);
//   }
// }

// async function changeRosterFilter(track) {
//   state.rosterFilter = track;
//   try {
//     const { learners } = await api.adminLearners(track);
//     state.adminLearners = learners;
//     render();
//   } catch (err) {
//     toast(err.message, true);
//   }
// }

// async function markLearnerPlaced(id) {
//   try {
//     await api.markPlaced(id);
//     toast("Learner marked as placed.");
//     await loadAdminDashboard();
//   } catch (err) {
//     toast(err.message, true);
//   }
// }

// async function submitCohortForm(formData) {
//   try {
//     await api.addCohort(formData.get("name"), formData.get("track"), formData.get("startDate"));
//     toast("Cohort added.");
//     await loadAdminDashboard();
//   } catch (err) {
//     toast(err.message, true);
//   }
// }


// // ----------------------------------------------------------------------------
// // 6. Event binding -- since we replace #app's innerHTML on every render(),
// //    listeners have to be reattached each time. Everything is delegated
// //    through simple data-action attributes in the templates above.
// // ----------------------------------------------------------------------------

// function bindEvents() {
//   document.querySelectorAll('[data-action="go-auth"]').forEach((el) => {
//     el.addEventListener("click", () => goAuth(el.dataset.role, el.dataset.mode));
//   });

//   const backBtn = document.querySelector('[data-action="go-landing"]');
//   if (backBtn) backBtn.addEventListener("click", goLanding);

//   document.querySelectorAll('[data-action="set-role"]').forEach((el) => {
//     el.addEventListener("click", () => { state.authRole = el.dataset.role; state.authError = null; render(); });
//   });
//   document.querySelectorAll('[data-action="set-mode"]').forEach((el) => {
//     el.addEventListener("click", () => { state.authMode = el.dataset.mode; state.authError = null; render(); });
//   });

//   const authForm = document.getElementById("auth-form");
//   if (authForm) {
//     authForm.addEventListener("submit", (e) => {
//       e.preventDefault();
//       submitAuthForm(new FormData(authForm));
//     });
//   }

//   const cohortForm = document.getElementById("cohort-form");
//   if (cohortForm) {
//     cohortForm.addEventListener("submit", (e) => {
//       e.preventDefault();
//       submitCohortForm(new FormData(cohortForm));
//       cohortForm.reset();
//     });
//   }

//   const rosterFilter = document.getElementById("roster-filter");
//   if (rosterFilter) {
//     rosterFilter.addEventListener("change", () => changeRosterFilter(rosterFilter.value));
//   }

//   document.querySelectorAll('[data-action="mark-placed"]').forEach((el) => {
//     el.addEventListener("click", () => markLearnerPlaced(el.dataset.id));
//   });

//   const completeModuleRow = document.querySelector('[data-action="complete-module"]');
//   if (completeModuleRow) completeModuleRow.addEventListener("click", completeNextModule);

//   const completeStopDot = document.querySelector('[data-action="complete-next-stop"]');
//   if (completeStopDot) completeStopDot.addEventListener("click", completeNextModule);

//   const logoutBtn = document.querySelector('[data-action="logout"]');
//   if (logoutBtn) logoutBtn.addEventListener("click", logout);

//   // NEW -- theme toggle button (appears in the landing nav, dashboard nav,
//   // and auth screen; see themeToggleHTML() near the top of this file)
//   const themeBtn = document.querySelector('[data-action="toggle-theme"]');
//   if (themeBtn) themeBtn.addEventListener("click", toggleTheme);
// }


// // ----------------------------------------------------------------------------
// // 7. Startup -- runs once when the page loads.
// // ----------------------------------------------------------------------------

// async function init() {
//   try {
//     // Reference data (tracks, roadmap) and "am I logged in?" can all be
//     // fetched in parallel since none of them depend on each other.
//     const [meResult, tracksResult, roadmapResult] = await Promise.all([
//       api.me(),
//       api.tracks(),
//       api.roadmap(),
//     ]);

//     state.tracks = tracksResult.tracks;
//     state.roadmap = roadmapResult.roadmap;
//     state.user = meResult.user;

//     if (state.user) {
//       await routeToDashboard();
//     } else {
//       state.view = "landing";
//       render();
//     }
//   } catch (err) {
//     // If the very first load fails (e.g. server not running yet), show a
//     // plain message instead of a blank page.
//     document.getElementById("app").innerHTML =
//       `<div class="loading-row" style="padding-top:120px;">Couldn't reach the server. Is the Flask app running?<br>${err.message}</div>`;
//   }
// }
// init();