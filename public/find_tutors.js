// find_tutors.js
// Place next to courses.html. Works with your HTML IDs:
// tutorList, requestModal, requestForm, modalTutorId, subject, message, cancelModal, modalTitle, toast

document.addEventListener("DOMContentLoaded", () => {
  const tutorList = document.getElementById("tutorList");
  const modal = document.getElementById("requestModal");
  const form = document.getElementById("requestForm");
  const cancelModal = document.getElementById("cancelModal");
  const toast = document.getElementById("toast");

  if (!tutorList) return console.error("find_tutors.js: #tutorList missing");

  // inject top controls (search/filter/refresh)
  function injectControls() {
    if (document.getElementById("findTutorControls")) return;
    const ctrl = document.createElement("div");
    ctrl.id = "findTutorControls";
    ctrl.className = "controls";
    ctrl.innerHTML = `
      <div class="search">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="11" cy="11" r="6" stroke="currentColor" stroke-width="2"/>
        </svg>
        <input id="searchInput" placeholder="Search tutors by name, subject or skill..." />
      </div>
      <select id="subjectFilter" class="select"><option value="">All Subjects</option></select>
      <div class="chips" style="margin-left:auto">
        <button id="refreshBtn" class="btn small">Refresh</button>
      </div>
    `;
    tutorList.parentNode.insertBefore(ctrl, tutorList);
  }
  injectControls();

  const searchInput = document.getElementById("searchInput");
  const subjectFilter = document.getElementById("subjectFilter");
  const refreshBtn = document.getElementById("refreshBtn");

  function showToast(msg, type = "ok") {
    if (!toast) {
      console.log(`${type}: ${msg}`);
      return;
    }
    toast.textContent = msg;
    toast.className = `toast show ${type === "error" ? "error" : "ok"}`;
    setTimeout(() => (toast.className = "toast"), 3000);
  }

  function esc(s = "") {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  let tutors = [];

  async function loadTutors() {
    tutorList.innerHTML = '<div class="empty">Loading tutors…</div>';
    try {
      const res = await fetch("/api/tutors", { credentials: "same-origin" });
      if (!res.ok) {
        console.error("Failed to fetch /api/tutors", res.status);
        tutorList.innerHTML = `<div class="empty">Failed to load tutors (server ${res.status}).</div>`;
        return;
      }
      const data = await res.json();
      if (!Array.isArray(data)) {
        console.error("Unexpected /api/tutors response", data);
        tutorList.innerHTML =
          '<div class="empty">Unexpected server response.</div>';
        return;
      }
      tutors = data;
      populateSubjects(tutors);
      renderTutors(tutors);
    } catch (err) {
      console.error("loadTutors error", err);
      tutorList.innerHTML =
        '<div class="empty">Network error loading tutors.</div>';
    }
  }

  function populateSubjects(list) {
    const set = new Set();
    list.forEach((t) => {
      (t.subjects || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((s) => set.add(s));
    });
    if (subjectFilter) {
      const opts = [
        `<option value="">All Subjects</option>`,
        ...[...set]
          .sort()
          .map((s) => `<option value="${esc(s)}">${esc(s)}</option>`),
      ];
      subjectFilter.innerHTML = opts.join("");
    }
  }

  function renderTutors(list) {
    if (!list || list.length === 0) {
      tutorList.innerHTML = '<div class="empty">No tutors found.</div>';
      return;
    }
    tutorList.innerHTML = "";
    list.forEach((t) => {
      const pic = t.profile_pic
        ? `/uploads/${t.profile_pic}`
        : `/uploads/default.jpg`;
      const skillsHtml = (t.skills || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => `<span class="skill-pill">${esc(s)}</span>`)
        .join(" ");
      const subjectsText = (t.subjects || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .join(", ");
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="card-header">
          <img src="${esc(pic)}" alt="${esc(
            t.name || "Tutor",
          )}" class="profile-pic" onerror="this.src='/uploads/default.jpg'">
          <div style="flex:1">
            <div class="card-title">${esc(t.name || "Tutor")}</div>
            <div class="meta"><strong>Subjects:</strong> ${esc(
              subjectsText || "N/A",
            )}</div>
            <div style="margin-top:8px">${skillsHtml}</div>
          </div>
        </div>
        <div class="card-body"><p>${esc(t.bio || "No bio provided.")}</p></div>
        <div class="availability-bar">${esc(
          t.availability || "Availability not set",
        )}</div>
        <div class="card-actions">
          <div><button type="button" class="btn small view-btn" data-id="${esc(
            t.tutor_id,
          )}">View</button></div>
          <div><button type="button" class="btn small request-btn" data-id="${esc(
            t.tutor_id,
          )}" data-name="${esc(t.name || "")}">Request Tutor</button></div>
        </div>
      `;
      tutorList.appendChild(card);
    });

    // attach listeners (delegation alternative)
    tutorList.querySelectorAll("button[data-id]").forEach((btn) => {
      if (btn.dataset._attached) return;
      btn.dataset._attached = "1";
      if (btn.classList.contains("view-btn"))
        btn.addEventListener("click", onViewClick);
      else btn.addEventListener("click", onRequestClick);
    });
  }

  function onRequestClick(e) {
    const id = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name || "";
    if (!modal || !form) {
      sendRequestDirect(id, "");
      return;
    }
    const hidden = document.getElementById("modalTutorId");
    const subj = document.getElementById("subject");
    const msg = document.getElementById("message");
    if (hidden) hidden.value = id || "";
    if (subj) subj.value = "";
    if (msg) msg.value = "";
    const title = document.getElementById("modalTitle");
    if (title) title.textContent = name ? `Request ${name}` : "Request Tutor";
    openModal(false);
  }

  function onViewClick(e) {
    const id = e.currentTarget.dataset.id;
    const tutor = tutors.find((t) => String(t.tutor_id) === String(id));
    if (!tutor) {
      showToast("Tutor not found", "error");
      return;
    }
    if (!modal || !form) {
      showToast(tutor.bio || "No bio", "ok");
      return;
    }
    const hidden = document.getElementById("modalTutorId");
    const subj = document.getElementById("subject");
    const msg = document.getElementById("message");
    if (hidden) hidden.value = tutor.tutor_id || "";
    if (subj) subj.value = tutor.subjects || "";
    if (msg) msg.value = tutor.bio || "";
    const title = document.getElementById("modalTitle");
    if (title) title.textContent = `${tutor.name} — Profile`;
    openModal(true);
  }

  function openModal(viewOnly = false) {
    if (!modal) return;
    modal.classList.remove("hidden");
    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
    const subj = document.getElementById("subject");
    const msg = document.getElementById("message");
    if (subj) subj.disabled = !!viewOnly;
    if (msg) msg.disabled = !!viewOnly;
    if (form) form.dataset.viewOnly = viewOnly ? "1" : "0";
    // focus subject if editable
    if (!viewOnly && subj) subj.focus();
  }

  function closeModal() {
    if (!modal) return;
    modal.classList.remove("show");
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    if (form) form.reset();
  }

  if (cancelModal)
    cancelModal.addEventListener("click", (ev) => {
      ev.preventDefault();
      closeModal();
    });
  if (modal)
    modal.addEventListener("click", (ev) => {
      if (ev.target === modal) closeModal();
    });
  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeModal();
  });

  if (form) {
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      if (form.dataset.viewOnly === "1") {
        closeModal();
        return;
      }
      const tutor_id =
        (document.getElementById("modalTutorId") || {}).value || null;
      const subject =
        (document.getElementById("subject") || {}).value.trim() || "";
      const message =
        (document.getElementById("message") || {}).value.trim() || "";
      if (!subject) {
        showToast("Please enter a subject", "error");
        return;
      }

      try {
        const payload = {
          tutor_id: tutor_id ? Number(tutor_id) : null,
          subject,
          message,
        };
        const res = await fetch("/api/learner/request-tutor", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.status === 401 || res.status === 403) {
          showToast(
            "You must be logged in as a learner to request a tutor.",
            "error",
          );
          return;
        }
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          console.error("request-tutor failed:", res.status, json);
          showToast(json.error || "Server refused request", "error");
        } else {
          showToast("Request sent — admin will allocate a tutor soon", "ok");
          closeModal();
        }
      } catch (err) {
        console.error("Network error sending request:", err);
        showToast("Network/server error — check console", "error");
      }
    });
  }

  async function sendRequestDirect(tutor_id, subject) {
    try {
      const res = await fetch("/api/learner/request-tutor", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tutor_id, subject }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error("direct request failed", res.status, body);
        showToast("Failed to send request", "error");
      } else showToast("Request sent (direct)", "ok");
    } catch (err) {
      console.error("direct request error", err);
      showToast("Network error", "error");
    }
  }

  // filtering
  let debounceTimer = null;
  function applyFilters() {
    const q = (searchInput?.value || "").trim().toLowerCase();
    const subjectVal = subjectFilter?.value || "";
    let filtered = tutors.slice();
    if (subjectVal)
      filtered = filtered.filter((t) =>
        (t.subjects || "").toLowerCase().includes(subjectVal.toLowerCase()),
      );
    if (q)
      filtered = filtered.filter((t) =>
        ((t.name || "") + " " + (t.subjects || "") + " " + (t.skills || ""))
          .toLowerCase()
          .includes(q),
      );
    renderTutors(filtered);
  }
  if (searchInput)
    searchInput.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(applyFilters, 180);
    });
  if (subjectFilter) subjectFilter.addEventListener("change", applyFilters);
  if (refreshBtn) refreshBtn.addEventListener("click", loadTutors);

  // load first
  loadTutors();
});
