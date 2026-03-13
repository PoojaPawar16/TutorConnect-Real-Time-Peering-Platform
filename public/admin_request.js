// admin_requests.js
// Place in public/ (same folder where admin_notifications.html lives).
// Requires server routes:
//  GET  /api/admin/tutor_requests         (isAdmin required)
//  GET  /api/tutors                      (returns approved tutors for dropdown)
//  POST /api/admin/tutor_requests/:id/assign
//  POST /api/admin/tutor_requests/:id/status

document.addEventListener("DOMContentLoaded", () => {
  // root area where UI will be rendered
  const root =
    document.getElementById("notificationsArea") ||
    document.querySelector(".main") ||
    document.body;

  // create a simple toast (temporary visual)
  function showToast(msg, opts = {}) {
    const el = document.createElement("div");
    el.textContent = msg;
    el.style.position = "fixed";
    el.style.right = "18px";
    el.style.bottom = "18px";
    el.style.padding = "10px 14px";
    el.style.borderRadius = "8px";
    el.style.color = "#fff";
    el.style.background = opts.error ? "#e11d48" : "#16a34a";
    el.style.boxShadow = "0 8px 24px rgba(0,0,0,0.12)";
    el.style.zIndex = 9999;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }

  // fetch tutor requests for admin
  async function fetchRequests() {
    try {
      const res = await fetch("/api/admin/tutor_requests", {
        credentials: "same-origin",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error("Failed to load tutor requests:", res.status, text);
        renderEmpty(`Failed to load tutor requests (HTTP ${res.status})`);
        return [];
      }
      return await res.json();
    } catch (err) {
      console.error("Network error while fetching tutor requests:", err);
      renderEmpty("Network error while loading tutor requests");
      return [];
    }
  }

  // fetch approved tutors (for assign dropdown)
  async function fetchApprovedTutors() {
    try {
      const res = await fetch("/api/tutors", { credentials: "same-origin" });
      if (!res.ok) return [];
      return await res.json();
    } catch (err) {
      console.error("Error fetching tutors:", err);
      return [];
    }
  }

  function renderEmpty(msg) {
    let ph = document.getElementById("adminRequestBoxPlaceholder");
    if (!ph) {
      ph = document.createElement("div");
      ph.id = "adminRequestBoxPlaceholder";
      ph.className = "empty";
      root.appendChild(ph);
    }
    ph.textContent = msg || "No tutor requests.";
    // remove adminRequestBox if exists
    const existing = document.getElementById("adminRequestBox");
    if (existing) existing.remove();
  }

  // render list of requests
  async function renderRequests() {
    const list = await fetchRequests();
    const tutors = await fetchApprovedTutors();

    // remove placeholder
    const placeholder = document.getElementById("adminRequestBoxPlaceholder");
    if (placeholder) placeholder.remove();

    // create container
    let box = document.getElementById("adminRequestBox");
    if (!box) {
      box = document.createElement("div");
      box.id = "adminRequestBox";
      root.appendChild(box);
    }
    box.innerHTML = "";

    if (!list || list.length === 0) {
      renderEmpty("No tutor requests found.");
      return;
    }

    list.forEach((r) => {
      const card = document.createElement("div");
      card.className = "admin-request-card";

      // sanitize basic values for simple insertion (this is minimal; adjust for XSS protection server-side)
      const reqId = r.request_id;
      const subj = r.subject || "No subject";
      const msg = r.message || "";
      const fromName = r.learner_name || r.learner_email || "Learner";
      const createdAt = r.created_at
        ? new Date(r.created_at).toLocaleString()
        : "";

      // build options for tutor dropdown
      const tutorOptions = tutors
        .map(
          (t) =>
            `<option value="${t.tutor_id}">${escapeHtml(t.name || "Tutor")} ${
              t.subjects ? `(${escapeHtml(t.subjects)})` : ""
            }</option>`
        )
        .join("");

      card.innerHTML = `
        <div style="display:flex;gap:12px;align-items:flex-start;justify-content:space-between">
          <div style="flex:1;min-width:0">
            <div><strong>Request #${reqId}</strong> — <em>${escapeHtml(
        subj
      )}</em></div>
            <div class="meta">From: ${escapeHtml(
              fromName
            )} • <small style="color:#999">${escapeHtml(
        createdAt
      )}</small></div>
            <div style="margin-top:8px">${escapeHtml(msg)}</div>
            <div style="margin-top:8px"><strong>Status:</strong> ${escapeHtml(
              r.status || "pending"
            )}</div>
          </div>

          <div style="min-width:260px;text-align:right">
            <div style="margin-bottom:8px">
              <select class="assign-tutor-select" data-request="${reqId}">
                <option value="">— assign tutor —</option>
                ${tutorOptions}
              </select>
            </div>
            <div class="admin-actions">
              <button class="btn assign-btn" data-id="${reqId}">Assign</button>
              <button class="btn ghost close-btn" data-id="${reqId}">Close</button>
            </div>
          </div>
        </div>
      `;

      box.appendChild(card);
    });

    attachListeners();
  }

  // helper to escape minimal HTML
  function escapeHtml(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/[&<>"']/g, function (m) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[m];
    });
  }

  // attach event listeners to assign/close buttons
  function attachListeners() {
    const box = document.getElementById("adminRequestBox");
    if (!box) return;

    box.querySelectorAll(".assign-btn").forEach((btn) => {
      if (btn._attached) return;
      btn._attached = true;
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        const sel = box.querySelector(
          `.assign-tutor-select[data-request='${id}']`
        );
        const tutor_id = sel?.value;
        if (!tutor_id)
          return showToast("Choose a tutor first", { error: true });

        try {
          const resp = await fetch(`/api/admin/tutor_requests/${id}/assign`, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tutor_id: Number(tutor_id) }),
          });
          if (!resp.ok) {
            const j = await resp.json().catch(() => ({}));
            console.error("Assign failed:", resp.status, j);
            showToast(j.error || "Assign failed", { error: true });
            return;
          }
          showToast("Assigned successfully");
          // reload list
          renderRequests();
        } catch (err) {
          console.error("Network error on assign:", err);
          showToast("Network error", { error: true });
        }
      });
    });

    box.querySelectorAll(".close-btn").forEach((btn) => {
      if (btn._attached) return;
      btn._attached = true;
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        if (!confirm("Mark this request as closed?")) return;
        try {
          const resp = await fetch(`/api/admin/tutor_requests/${id}/status`, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "closed" }),
          });
          if (!resp.ok) {
            const j = await resp.json().catch(() => ({}));
            console.error("Close failed:", resp.status, j);
            showToast(j.error || "Update failed", { error: true });
            return;
          }
          showToast("Request closed");
          renderRequests();
        } catch (err) {
          console.error("Network error on close:", err);
          showToast("Network error", { error: true });
        }
      });
    });
  }

  // initial render
  renderRequests();

  // optional: auto-refresh every 60 seconds
  setInterval(renderRequests, 60000);
});
