document.addEventListener("DOMContentLoaded", () => {
  const tutorList = document.getElementById("tutorList");

  async function fetchTutors() {
    tutorList.innerHTML = "<p>Loading...</p>";
    try {
      const res = await fetch("/api/admin/notifications", {
        credentials: "same-origin",
      });

      if (!res.ok) {
        console.error("Failed fetching /api/admin/notifications:", res.status);
        if (res.status === 403) {
          tutorList.innerHTML =
            "<p>Access denied (not logged in as admin).</p>";
        } else {
          tutorList.innerHTML = "<p>Failed to load tutor data.</p>";
        }
        return;
      }

      const data = await res.json();

      if (Array.isArray(data) && data.length > 0) {
        renderTutors(data);
      } else {
        tutorList.innerHTML = "<p>No pending tutor profiles found.</p>";
      }
    } catch (err) {
      console.error("Error fetching tutors:", err);
      tutorList.innerHTML = "<p>Network error while loading tutors.</p>";
    }
  }

  function renderTutors(tutors) {
    tutorList.innerHTML = "";

    tutors.forEach((tutor) => {
      const card = document.createElement("div");
      card.classList.add("tutor-card");
      // safe values + fallback
      const profilePic = tutor.profile_pic
        ? `/uploads/${tutor.profile_pic}`
        : "/images/avatar-placeholder.png"; // create /images/avatar-placeholder.png or use existing

      // note: server's query returns user_id, tutor_name, skills, subjects, bio
      const userId = tutor.user_id ?? tutor.tutor_id ?? tutor.id;

      card.innerHTML = `
        <div class="tutor-details" style="display:flex;gap:12px;align-items:flex-start">
          <img src="${profilePic}" alt="Tutor Image" style="width:72px;height:72px;border-radius:8px;object-fit:cover"/>
          <div class="tutor-info" style="max-width:760px">
            <h3 style="margin:0 0 6px">${escapeHtml(
              tutor.tutor_name || tutor.name || "Unknown"
            )}</h3>
            <p style="margin:4px 0"><strong>Skills:</strong> ${escapeHtml(
              tutor.skills || "N/A"
            )}</p>
            <p style="margin:4px 0"><strong>Subjects:</strong> ${escapeHtml(
              tutor.subjects || "N/A"
            )}</p>
            <p style="margin:4px 0"><strong>Bio:</strong> ${escapeHtml(
              tutor.bio || "No bio provided."
            )}</p>
            <p style="margin:6px 0"><strong>Status:</strong> Pending</p>
          </div>
        </div>
        <div style="margin-top:10px">
          <button class="approve btn" data-id="${userId}">Approve</button>
          <button class="reject btn ghost" data-id="${userId}">Reject</button>
        </div>
      `;

      tutorList.appendChild(card);
    });

    attachButtonListeners();
  }

  function attachButtonListeners() {
    document.querySelectorAll(".approve").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const id = e.target.getAttribute("data-id");
        if (!id) return alert("Missing tutor id");
        if (!confirm("Approve this tutor?")) return;
        await updateTutorStatus(id, "approve", e.target);
      });
    });

    document.querySelectorAll(".reject").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const id = e.target.getAttribute("data-id");
        if (!id) return alert("Missing tutor id");
        if (!confirm("Reject this tutor?")) return;
        await updateTutorStatus(id, "reject", e.target);
      });
    });
  }

  async function updateTutorStatus(tutorId, action, buttonEl = null) {
    // action must be 'approve' or 'reject'
    if (!["approve", "reject"].includes(action)) {
      return alert("Invalid action");
    }

    try {
      if (buttonEl) {
        buttonEl.disabled = true;
        buttonEl.textContent =
          action === "approve" ? "Approving..." : "Rejecting...";
      }

      const res = await fetch(
        `/api/admin/tutors/${encodeURIComponent(tutorId)}/${action}`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          // no JSON body required by your server; if you want to send note/reason add: body: JSON.stringify({ note: '...' })
        }
      );

      if (!res.ok) {
        let txt;
        try {
          txt = await res.text();
        } catch (e) {
          txt = "";
        }
        console.error("Server error while assigning tutor:", res.status, txt);
        if (res.status === 403)
          alert("Access denied — not logged in as admin.");
        else
          alert(
            "Failed to update tutor: server error. See console for details."
          );
        return;
      }

      const data = await res.json().catch(() => ({}));
      alert(data.message || "Updated successfully");
      // refresh list
      fetchTutors();
    } catch (err) {
      console.error("Error updating tutor:", err);
      alert("Network error while updating tutor");
    } finally {
      if (buttonEl) {
        buttonEl.disabled = false;
        buttonEl.textContent = action === "approve" ? "Approve" : "Reject";
      }
    }
  }

  function escapeHtml(s) {
    if (!s) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  fetchTutors();
});
