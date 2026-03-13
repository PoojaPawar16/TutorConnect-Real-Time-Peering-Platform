document.addEventListener("DOMContentLoaded", () => {
  const subjectInput = document.getElementById("subjectInput");
  const preferredTutorInput = document.getElementById("preferredTutorInput");
  const messageInput = document.getElementById("messageInput");
  const requestForm = document.getElementById("requestForm");
  const enrollmentsList = document.getElementById("enrollmentsList");
  const sessionsList = document.getElementById("sessionsList");
  const notificationsList = document.getElementById("notificationsList");
  const requestsHistory = document.getElementById("requestsHistory");
  const requestStatus = document.getElementById("requestStatus");
  const toast = document.getElementById("toast");
  const refreshBtn = document.getElementById("refreshBtn");
  const clearBtn = document.getElementById("clearBtn");
  const greeting = document.getElementById("greeting");
  // const mcqList = document.getElementById("mcqList");

  function showToast(msg, type = "info") {
    toast.textContent = msg;
    toast.className = "toast show " + (type === "error" ? "error" : "ok");
    setTimeout(() => {
      toast.className = "toast";
    }, 3500);
  }

  async function loadDashboard() {
    enrollmentsList.innerHTML = "Loading...";
    sessionsList.innerHTML = "Loading...";
    notificationsList.innerHTML = "Loading...";
    requestsHistory.innerHTML = "Loading...";

    try {
      const res = await fetch("/api/learner/dashboard", {
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("Not logged in or backend missing");
      const data = await res.json();

      if (data.user && data.user.name)
        greeting.textContent = `Welcome, ${data.user.name}`;

      // Enrollments
      if (Array.isArray(data.enrollments) && data.enrollments.length) {
        enrollmentsList.innerHTML = data.enrollments
          .map(
            (e) => `
          <div class="item">
            <div class="item-left">
              <div class="title">${escapeHtml(
                e.course_subject || "Course",
              )}</div>
              <div class="meta">Tutor: ${escapeHtml(
                e.tutor_name || "TBD",
              )} • Status: ${escapeHtml(e.status || "pending")}</div>
            </div>
            <div class="item-right">
              <small>${new Date(
                e.enrolled_at || e.created_at || Date.now(),
              ).toLocaleDateString()}</small>
            </div>
          </div>
        `,
          )
          .join("");
      } else {
        enrollmentsList.innerHTML =
          '<div class="empty">No enrollments yet</div>';
      }

      // Sessions
      if (Array.isArray(data.sessions) && data.sessions.length) {
        sessionsList.innerHTML = data.sessions
          .map(
            (s) => `
          <div class="item">
            <div class="item-left">
              <div class="title">${escapeHtml(s.title || "Session")}</div>
              <div class="meta">${new Date(
                s.scheduled_at,
              ).toLocaleString()} • ${escapeHtml(s.status || "")}</div>
            </div>
            <div class="item-right">
              ${
                s.meeting_link
                  ? `<a href="${escapeAttr(
                      s.meeting_link,
                    )}" target="_blank" class="link">Join</a>`
                  : ""
              }
            </div>
          </div>
        `,
          )
          .join("");
      } else {
        sessionsList.innerHTML =
          '<div class="empty">No upcoming sessions</div>';
      }

      // Notifications
      if (Array.isArray(data.notifications) && data.notifications.length) {
        notificationsList.innerHTML = data.notifications
          .map(
            (n) => `
          <div class="item">
            <div class="item-left">
              <div class="title">${escapeHtml(n.message || "")}</div>
              <div class="meta">${new Date(
                n.created_at || Date.now(),
              ).toLocaleString()}</div>
            </div>
          </div>
        `,
          )
          .join("");
      } else {
        notificationsList.innerHTML =
          '<div class="empty">No notifications</div>';
      }

      // Requests history
      if (Array.isArray(data.requests) && data.requests.length) {
        requestsHistory.innerHTML = data.requests
          .map(
            (r) => `
          <div class="item">
            <div class="item-left">
              <div class="title">${escapeHtml(r.subject || "Subject")}</div>
              <div class="meta">Status: ${escapeHtml(
                r.status || "pending",
              )} • ${escapeHtml(
                r.tutor_id ? "Requested specific tutor" : "No tutor requested",
              )}</div>
            </div>
            <div class="item-right"><small>${new Date(
              r.created_at,
            ).toLocaleString()}</small></div>
          </div>
        `,
          )
          .join("");
      } else {
        requestsHistory.innerHTML =
          '<div class="empty">No recent requests</div>';
      }
    } catch (err) {
      enrollmentsList.innerHTML =
        '<div class="empty error">Failed to load dashboard. Are you logged in?</div>';
      sessionsList.innerHTML = '<div class="empty error">—</div>';
      notificationsList.innerHTML = '<div class="empty error">—</div>';
      requestsHistory.innerHTML = '<div class="empty error">—</div>';
      console.error("Load dashboard error", err);
    }
  }

  // submit request
  requestForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const subject = subjectInput.value.trim();
    const preferredTutor = preferredTutorInput.value.trim();
    const message = messageInput.value.trim();

    if (!subject) {
      showToast("Please enter a subject", "error");
      return;
    }

    requestStatus.textContent = "Sending request...";
    try {
      const body = { subject, message };
      if (preferredTutor) body.tutor_name = preferredTutor;

      const res = await fetch("/api/learner/request-tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        requestStatus.textContent = "Request failed";
        showToast(json.error || "Request failed", "error");
        return;
      }

      requestStatus.textContent = "Request sent";
      showToast("Request sent to admin — you will be notified", "ok");
      subjectInput.value = "";
      preferredTutorInput.value = "";
      messageInput.value = "";
      await loadDashboard();
    } catch (err) {
      console.error("Request error", err);
      requestStatus.textContent = "Request failed";
      showToast("Network error", "error");
    } finally {
      setTimeout(() => (requestStatus.textContent = ""), 3000);
    }
  });

  document.getElementById("logoutBtn").addEventListener("click", async (e) => {
    e.preventDefault();
    await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
    window.location.href = "/login.html";
  });

  refreshBtn.addEventListener("click", () => {
    loadDashboard();
  });
  clearBtn.addEventListener("click", () => {
    subjectInput.value = "";
    preferredTutorInput.value = "";
    messageInput.value = "";
  });

  // helpers
  function escapeHtml(s) {
    return String(s || "").replace(
      /[&<>"']/g,
      (m) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[m],
    );
  }
  function escapeAttr(s) {
    return String(s || "").replace(/"/g, "&quot;");
  }

  // initial load
  loadDashboard();
});
