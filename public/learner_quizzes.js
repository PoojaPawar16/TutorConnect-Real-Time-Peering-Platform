document.addEventListener("DOMContentLoaded", () => {
  const mcqList = document.getElementById("mcqList");

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

  async function loadMCQTasks() {
    mcqList.innerHTML = "Loading...";

    try {
      const res = await fetch("/api/learner/dashboard-mcq", {
        credentials: "same-origin",
      });

      if (!res.ok) throw new Error("Failed to load quizzes");

      const tasks = await res.json();

      if (!tasks || tasks.length === 0) {
        mcqList.innerHTML = "<p>No quizzes available.</p>";
        return;
      }

      mcqList.innerHTML = tasks
        .map((task) => {
          let button = "";

          if (task.status === "Locked") {
            button = `<button disabled>Session Not Completed</button>`;
          } else if (task.status === "Overdue") {
            button = `<button disabled>Overdue</button>`;
          } else if (task.remaining_attempts <= 0) {
            button = `<button disabled>Max Attempts Reached</button>`;
          } else {
            button = `<button onclick="attemptMCQ(${task.task_id})">Attempt</button>`;
          }

          return `
          <div class="card">
            <h3>${escapeHtml(task.title)}</h3>
            <p>Status: ${escapeHtml(task.status)}</p>
            <p>Attempts: ${task.attempts}/5</p>
            <p>Deadline: ${
              task.deadline
                ? new Date(task.deadline).toLocaleString()
                : "No deadline"
            }</p>
            ${button}
          </div>
        `;
        })
        .join("");
    } catch (err) {
      console.error(err);
      mcqList.innerHTML = "<p>Failed to load quizzes</p>";
    }
  }

  window.attemptMCQ = function (taskId) {
    window.location.href = `attempt_mcq.html?taskId=${taskId}`;
  };

  loadMCQTasks();
});
