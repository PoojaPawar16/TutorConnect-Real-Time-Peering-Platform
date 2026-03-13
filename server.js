require("dotenv").config();

const express = require("express");
const path = require("path");
const db = require("./db");
const session = require("express-session");
const nodemailer = require("nodemailer");
const multer = require("multer");
const { log, error } = require("console");
const { getAuthUrl, authorize, createGoogleMeet } = require("./googleAuth");

const app = express();
// const PORT = 3000;
const PORT = process.env.PORT || 3000;

// console.log(process.env.OPENROUTER_API_KEY);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const aiRoutes = require("./routes/aiRoutes");
app.use("/api/ai", aiRoutes);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + "-" + file.originalname;
    cb(null, uniqueName);
  },
});
const upload = multer({ storage: storage });

app.use(
  session({
    secret: "your-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 },
  }),
);

// app.use(express.static(path.join(__dirname, "public")));
app.use("/tutorconnect", express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.redirect("/tutorconnect");
});
app.get("/tutorconnect", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Step 1: Redirect tutor to Google authorization
app.get("/auth/google", (req, res) => {
  res.redirect(getAuthUrl());
});

// Step 2: Handle callback (after Google login)
app.get("/oauth2callback", async (req, res) => {
  const code = req.query.code;
  await authorize(code);
  res.send(" Google OAuth connected! You can now create meetings.");
});

// Session scheduling by tutor
app.post("/api/tutor/sessions/schedule", (req, res) => {
  const tutorId = req.session.user?.id;
  const { learner_id, scheduled_at } = req.body;

  if (!tutorId) return res.status(403).json({ error: "Access denied" });

  const sql =
    "INSERT INTO sessions (tutor_id, learner_id, scheduled_at, status) VALUES (?, ?, ?, 'scheduled')";
  db.query(sql, [tutorId, learner_id, scheduled_at], (err, result) => {
    if (err) {
      console.error("Session scheduling failed:", err);
      return res.status(500).json({ error: "Session scheduling failed" });
    }
    res.json({
      message: "Session scheduled successfully",
      session_id: result.insertId,
    });
  });
});

// Tutor marks session completed
app.post("/api/tutor/sessions/:id/complete", (req, res) => {
  const { id } = req.params;
  const sql = "UPDATE sessions SET status='completed' WHERE session_id=?";
  db.query(sql, [id], (err) => {
    if (err)
      return res.status(500).json({ error: "Failed to mark session complete" });
    res.json({ message: "Session marked as completed" });
  });
});

// Tutor assigns task for a session
app.post("/api/tutor/sessions/:sessionId/task", (req, res) => {
  if (!req.session.user || req.session.user.role !== "tutor") {
    return res.status(403).json({ error: "Access denied" });
  }

  const sessionId = req.params.sessionId;
  const { title, deadline, task_type } = req.body;

  if (!title || !deadline || !task_type) {
    return res.status(400).json({ error: "All fields are required" });
  }

  const sql = `
    INSERT INTO session_tasks (session_id, task_type, title, deadline)
    VALUES (?, ?, ?, ?)
  `;

  db.query(sql, [sessionId, task_type, title, deadline], (err, result) => {
    if (err) {
      console.error("Task creation error:", err);
      return res.status(500).json({ error: "Failed to create task" });
    }

    res.json({
      message: "Task created successfully",
      task_id: result.insertId,
    });
  });
});

//  Learner submits task
app.post(
  "/api/learner/tasks/:task_id/submit",
  upload.single("submission"),
  (req, res) => {
    const learnerId = req.session.user?.id;
    const { task_id } = req.params;

    if (!learnerId) return res.status(403).json({ error: "Access denied" });

    const sql = `
    INSERT INTO task_submissions (task_id, learner_id, status)
    VALUES (?, ?, 'submitted')
    ON DUPLICATE KEY UPDATE status='submitted', submitted_at=NOW()
  `;
    db.query(sql, [task_id, learnerId], (err) => {
      if (err) return res.status(500).json({ error: "Task submission failed" });
      res.json({ message: "Task submitted successfully" });
    });
  },
);

// Tutor views attendance + task summary
app.get("/api/tutor/sessions/:id/summary", (req, res) => {
  const { id } = req.params;

  const sql = `
  SELECT 
    u.name AS learner_name,
    COALESCE(sa.status, 'absent') AS attendance_status,
    COALESCE(ts.status, 'not submitted') AS task_status,
    ts.submitted_at
  FROM sessions s

  JOIN (
    SELECT learner_id, session_id FROM sessions WHERE session_id = ?
    UNION
    SELECT gl.learner_id, s.session_id
    FROM sessions s
    JOIN group_learners gl ON s.group_id = gl.group_id
    WHERE s.session_id = ?
  ) AS learners ON learners.session_id = s.session_id

  JOIN users u ON u.id = learners.learner_id

  LEFT JOIN session_attendance sa
    ON sa.session_id = s.session_id
    AND sa.learner_id = learners.learner_id

  LEFT JOIN session_tasks st
    ON st.session_id = s.session_id

  LEFT JOIN task_submissions ts
    ON ts.task_id = st.task_id
    AND ts.learner_id = learners.learner_id

  WHERE s.session_id = ?
`;

  db.query(sql, [id, id, id], (err, results) => {
    if (err)
      return res.status(500).json({ error: "Failed to fetch session summary" });

    res.json(results);
  });
});

// admin registration helper
function isAdmin(req, res, next) {
  if (req.session.user && req.session.user.role === "admin") {
    return next();
  }
  return res.status(403).json({ error: "Access denied" });
}

app.get("/api/admin/users", isAdmin, (req, res) => {
  db.query("SELECT * FROM users", (err, results) => {
    if (err) {
      console.error(" DB error:", err);
      return res.status(500).json({ error: "Database query failed" });
    }
    res.json(results);
  });
});

// user registration
app.post("/api/register", (req, res) => {
  console.log("Received body:", req.body);
  const { name, email, password, role } = req.body || {};

  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: "All fields are required" });
  }

  const sql =
    "INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)";
  db.query(sql, [name, email, password, role], (err, result) => {
    if (err) {
      console.error(" Error inserting user:", err);
      return res.status(500).json({ error: "Failed to register user" });
    }
    res.json({
      message: "Registration successful!",
      userId: result.insertId,
    });
  });
});

// User login
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const sql = "SELECT * FROM users WHERE email = ? AND password = ?";
  console.log("Login body:", req.body);

  db.query(sql, [email, password], (err, results) => {
    if (err) {
      console.error(" DB error:", err);
      return res.status(500).json({ error: "Database query failed" });
    }

    if (results.length === 0) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const user = results[0];
    console.log(" Logged in user:", user);

    // Store user in session
    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    };

    // Tutor: Check profile approval before redirect
    if (user.role === "tutor") {
      const sql = "SELECT status FROM tutor_profiles WHERE tutor_id = ?";
      db.query(sql, [user.id], (err, result) => {
        if (err) return res.status(500).json({ error: "DB error" });

        let redirectUrl = "/tutor_profile.html";

        if (result.length > 0) {
          const status = result[0].status;

          if (status === "suspended") {
            return res.status(403).json({
              error: "Your account has been suspended by admin.",
            });
          }

          if (status === "approved") {
            redirectUrl = "/tutor_sessions.html";
          }

          if (status === "rejected") {
            redirectUrl = "/tutor_profile.html";
          }

          if (status === "pending") {
            redirectUrl = "/tutor_profile.html";
          }
        }

        return res.json({
          message: "Login successful",
          redirect: redirectUrl,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
          },
        });
      });

      return;
    }

    //  Other roles (learner, mentor, admin)
    let redirectUrl = "/login.html";
    if (user.role === "learner") redirectUrl = "/courses.html";
    else if (user.role === "mentor") redirectUrl = "/mentor_dashboard.html";
    else if (user.role === "admin") redirectUrl = "/admin_dashboard.html";
    res.json({
      message: "Login successful",
      redirect: redirectUrl,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  });
});

//  Create / Update Learner Profile
app.post("/api/learner/profile", upload.single("profile_pic"), (req, res) => {
  if (!req.session.user || req.session.user.role !== "learner") {
    return res.status(403).json({ error: "Access denied" });
  }

  const learnerId = req.session.user.id;
  const { bio, skills, goals } = req.body;
  const profilePic = req.file ? req.file.filename : null;

  db.query(
    "SELECT * FROM learner_profiles WHERE learner_id = ?",
    [learnerId],
    (err, results) => {
      if (err) {
        console.error("❌ DB error:", err);
        return res.status(500).json({ error: "Database error" });
      }

      if (results.length === 0) {
        const sql =
          "INSERT INTO learner_profiles (learner_id, bio, skills, goals, profile_pic) VALUES (?, ?, ?, ?, ?)";
        db.query(sql, [learnerId, bio, skills, goals, profilePic], (err2) => {
          if (err2) return res.status(500).json({ error: "Insert failed" });
          res.json({ message: "Profile created successfully!" });
        });
      } else {
        const sql =
          "UPDATE learner_profiles SET bio=?, skills=?, goals=?, profile_pic=IFNULL(?, profile_pic) WHERE learner_id=?";
        db.query(sql, [bio, skills, goals, profilePic, learnerId], (err3) => {
          if (err3) return res.status(500).json({ error: "Update failed" });
          res.json({ message: "Profile updated successfully!" });
        });
      }
    },
  );
});

// Get all approved tutors as available courses
app.get("/api/tutors", (req, res) => {
  const sql = `
    SELECT 
      u.id AS tutor_id,
      u.name,
      u.email,
      t.subjects,
      t.skills,
      t.availability,
      t.bio,
      t.profile_pic,
      t.status
    FROM users u
    JOIN tutor_profiles t ON u.id = t.tutor_id
    WHERE u.role = 'tutor' AND t.status = 'approved'
    ORDER BY u.id DESC
  `;
  db.query(sql, (err, results) => {
    if (err) {
      console.error(" DB error fetching tutors:", err);
      return res.status(500).json({ error: "Database query failed" });
    }
    res.json(results);
  });
});

//  Learner enrolls in a course
app.post("/api/learner/enroll", (req, res) => {
  if (!req.session.user || req.session.user.role !== "learner") {
    return res.status(403).json({ error: "Access denied" });
  }

  const learnerId = req.session.user.id;
  const { tutor_id, course_subject } = req.body;

  const sql = `
    INSERT INTO enrollments (learner_id, tutor_id, course_subject)
    VALUES (?, ?, ?)
  `;
  db.query(sql, [learnerId, tutor_id, course_subject], (err) => {
    if (err) {
      console.error("❌ Enrollment failed:", err);
      return res.status(500).json({ error: "Enrollment failed" });
    }
    res.json({ message: " Enrolled successfully!" });
  });
});

app.get("/api/learner/enrollments", (req, res) => {
  if (!req.session.user || req.session.user.role !== "learner")
    return res.status(403).json({ error: "Access denied" });

  const learnerId = req.session.user.id;
  const sql = `
    SELECT e.id, e.course_subject, e.enrolled_at, 
           u.name AS tutor_name, t.profile_pic
    FROM enrollments e
    JOIN users u ON e.tutor_id = u.id
    LEFT JOIN tutor_profiles t ON u.id = t.tutor_id
    WHERE e.learner_id = ?
  `;
  db.query(sql, [learnerId], (err, results) => {
    if (err) {
      console.error("DB Error fetching enrollments:", err);
      return res.status(500).json({ error: "Failed to fetch enrollments" });
    }
    res.json(results);
  });
});

//  Single route to get current logged-in user
app.get("/api/current_user", (req, res) => {
  if (req.session.user) {
    res.json({ user: req.session.user });
  } else {
    res.status(401).json({ error: "Not logged in" });
  }
});

// Logout
app.post("/api/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: "Logout failed" });
    res.json({ message: "Logged out successfully" });
  });
});

//  Get learner profile info
app.get("/api/learner/profile", (req, res) => {
  if (!req.session.user || req.session.user.role !== "learner") {
    return res.status(403).json({ error: "Access denied" });
  }

  const learnerId = req.session.user.id;

  db.query(
    "SELECT * FROM learner_profiles WHERE learner_id = ?",
    [learnerId],
    (err, results) => {
      if (err) {
        console.error("DB error:", err);
        return res.status(500).json({ error: "Database error" });
      }

      if (results.length === 0) {
        return res.json({}); // no profile yet
      }

      res.json(results[0]);
    },
  );
});

// Tutor Profile Submission / Update
app.post(
  "/api/tutors/profile",
  upload.fields([
    { name: "profile_pic", maxCount: 1 },
    { name: "certifications", maxCount: 5 },
  ]),
  (req, res) => {
    if (!req.session.user || req.session.user.role !== "tutor")
      return res.status(403).json({ error: "Access denied" });

    const { bio, skills, subjects, availability } = req.body;
    const tutorId = req.session.user.id;

    const profilePic = req.files["profile_pic"]
      ? req.files["profile_pic"][0].filename
      : null;

    const certifications = req.files["certifications"]
      ? req.files["certifications"].map((file) => file.filename).join(",")
      : null;

    console.log("📤 Tutor Profile Submission:", {
      tutorId,
      bio,
      skills,
      subjects,
      availability,
      profilePic,
      certifications,
    });

    // Check if tutor profile exists
    const sqlCheck = "SELECT * FROM tutor_profiles WHERE tutor_id = ?";
    db.query(sqlCheck, [tutorId], (err, results) => {
      if (err) return res.status(500).json({ error: "DB error" });

      // Tutor submitting for first time → notify admin
      if (results.length === 0) {
        const sqlInsert =
          "INSERT INTO tutor_profiles (tutor_id, bio, skills, subjects, availability, profile_pic, certifications, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')";
        db.query(
          sqlInsert,
          [
            tutorId,
            bio,
            skills,
            subjects,
            availability,
            profilePic,
            certifications,
          ],
          (err, result) => {
            if (err) return res.status(500).json({ error: "DB error" });

            // Notify admin (only on first submission)
            const notifymsg = `${req.session.user.name} has submitted their profile for approval.`;
            db.query(
              "INSERT INTO notifications (user_id, message, status) VALUES (?, ?, 'unread')",
              [tutorId, notifymsg],
            );

            sendAdminEmail(req.session.user.name, req.session.user.email);

            res.json({
              message: "Profile created and submitted for approval.",
            });
          },
        );
      } else {
        // Check current status
        const currentStatus = results[0].status;

        let newStatus = currentStatus;
        if (currentStatus === "rejected") {
          newStatus = "pending"; // resend for review
        }

        const sqlUpdate =
          "UPDATE tutor_profiles SET bio=?, skills=?, subjects=?, availability=?, profile_pic=?, certifications=?, status=? WHERE tutor_id=?";
        db.query(
          sqlUpdate,
          [
            bio,
            skills,
            subjects,
            availability,
            profilePic,
            certifications,
            newStatus,
            tutorId,
          ],
          (err, result) => {
            if (err) return res.status(500).json({ error: "DB error" });

            if (currentStatus === "rejected") {
              // Notify admin again
              const notifyMsg = `${req.session.user.name} has resubmitted their profile for approval.`;
              db.query(
                "INSERT INTO notifications (user_id, message, status) VALUES (?, ?, 'unread')",
                [tutorId, notifyMsg],
              );

              sendAdminEmail(req.session.user.name, req.session.user.email);

              return res.json({
                message:
                  "Profile updated and resubmitted for admin approval. Please wait for review.",
              });
            } else {
              return res.json({
                message: "Profile updated successfully!",
              });
            }
          },
        );
      }
    });
  },
);

// tutor profile status
app.get("/api/tutor_status", (req, res) => {
  if (!req.session.user || req.session.user.role !== "tutor")
    return res.status(403).json({ error: "Access denied" });

  const tutorId = req.session.user.id;
  const sql = "SELECT status FROM tutor_profiles WHERE tutor_id = ?";
  db.query(sql, [tutorId], (err, results) => {
    if (err) return res.status(500).json({ error: "DB error" });
    if (results.length === 0) return res.json({ status: "pending" });
    res.json({ status: results[0].status });
  });
});

// Admin email notification function
function sendAdminEmail(tutorName, tutorEmail) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER, //  reads from .env
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  const mailOptions = {
    from: `"TutorConnect" <${process.env.GMAIL_USER}>`,
    to: process.env.GMAIL_USER,
    subject: `🧑‍🏫 New Tutor Profile Submitted - ${tutorName}`,
    text: `Tutor ${tutorName} (${tutorEmail}) has submitted their profile for review.\n\nLogin to the admin dashboard to review and approve.`,
  };

  transporter.sendMail(mailOptions, (err, info) => {
    if (err) console.error("❌ Email sending failed:", err.message);
    else console.log("✅ Email sent successfully:", info.response);
  });
}

// Temporary route to test email setup
app.get("/api/test-email", (req, res) => {
  sendAdminEmail("Test Tutor", "test@example.com");
  res.json({ message: "📧 Test email sent (check inbox and console logs)." });
});

//  TEMPORARY TEST ROUTE (use only for testing in browser)
app.get("/api/test-approve/:id", (req, res) => {
  const tutorId = req.params.id;
  sendTutorDecisionEmail(tutorId, "approved");
  res.send(`✅ Test approval email sent to tutor ID ${tutorId}`);
});

//  Admin: Get pending tutor profiles
app.get("/api/admin/tutor-profiles/pending", isAdmin, (req, res) => {
  const sql = `
    SELECT 
      u.id AS tutor_id,
      u.name,
      u.email,
      t.subjects,
      t.skills,
      t.bio,
      t.profile_pic,
      t.certifications
    FROM tutor_profiles t
    JOIN users u ON u.id = t.tutor_id
    WHERE t.status = 'pending'
    ORDER BY t.tutor_id DESC
  `;

  db.query(sql, (err, rows) => {
    if (err) {
      console.error("Fetch pending tutors failed:", err);
      return res.status(500).json({ error: "DB error" });
    }
    res.json(rows);
  });
});

// Fetch tutor profile notifications
app.get("/api/admin/notifications", isAdmin, (req, res) => {
  const sql = `
    SELECT 
      n.notification_id, 
      COALESCE(n.message, CONCAT(u.name, ' has submitted their profile for approval')) AS message,
      n.created_at,
      u.id AS user_id, 
      u.name AS tutor_name,
      t.id AS profile_id, 
      t.skills, 
      t.subjects, 
      t.certifications, 
      t.bio, 
      t.profile_pic
    FROM tutor_profiles t
    JOIN users u ON t.tutor_id = u.id
    LEFT JOIN notifications n ON n.user_id = u.id
    WHERE t.status = 'pending'
    ORDER BY t.tutor_id DESC;
  `;

  db.query(sql, (err, results) => {
    if (err) {
      console.error("DB Error fetching notifications:", err);
      return res.status(500).json({ error: "Failed to fetch notifications" });
    }
    res.json(results);
  });
});

// Admin Approve Tutor Profile
app.post("/api/admin/tutors/:id/approve", isAdmin, (req, res) => {
  const tutorId = req.params.id;
  db.query(
    "UPDATE tutor_profiles SET status='approved' WHERE tutor_id=?",
    [tutorId],
    (err) => {
      if (err) return res.status(500).json({ error: "Approval failed" });

      db.query(
        "UPDATE notifications SET status='approved', message='✅ Your tutor profile has been approved by the admin!' WHERE user_id=?",
        [tutorId],
        (notifErr) => {
          if (notifErr) console.error(" Notification update error:", notifErr);
        },
      );

      //  Send email notification to tutor
      sendTutorDecisionEmail(tutorId, "approved");

      res.json({ message: "Tutor approved successfully" });
    },
  );
});

// Admin Reject Tutor Profile
app.post("/api/admin/tutors/:id/reject", isAdmin, (req, res) => {
  const tutorId = req.params.id;
  db.query(
    "UPDATE tutor_profiles SET status='rejected' WHERE tutor_id=?",
    [tutorId],
    (err) => {
      if (err) return res.status(500).json({ error: "Rejection failed" });

      db.query(
        "UPDATE notifications SET status='rejected', message=' Your tutor profile has been rejected by the admin.' WHERE user_id=?",
        [tutorId],
        (notifErr) => {
          if (notifErr) console.error(" Notification update error:", notifErr);
        },
      );

      //  Send email notification to tutor
      sendTutorDecisionEmail(tutorId, "rejected");

      res.json({ message: "Tutor rejected successfully" });
    },
  );
});

// ADMIN: Approve Enrollment
app.post("/api/admin/enrollments/:id/approve", isAdmin, (req, res) => {
  const enrollmentId = req.params.id;

  // 1. Get enrollment details
  db.query(
    `SELECT learner_id, tutor_id 
     FROM enrollments 
     WHERE id = ?`,
    [enrollmentId],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "DB error" });
      }

      if (rows.length === 0) {
        return res.status(404).json({ error: "Enrollment not found" });
      }

      const { learner_id, tutor_id } = rows[0];

      // 2. Approve enrollment
      db.query(
        "UPDATE enrollments SET status = 'approved' WHERE id = ?",
        [enrollmentId],
        (err2) => {
          if (err2) {
            console.error(err2);
            return res.status(500).json({ error: "Approval failed" });
          }

          // 3. Create learner–tutor relationship
          db.query(
            `INSERT IGNORE INTO learner_tutor (learner_id, tutor_id)
             VALUES (?, ?)`,
            [learner_id, tutor_id],
          );

          // 4. Notify tutor
          db.query(
            `INSERT INTO notifications (user_id, message, status)
             VALUES (?, ?, 'unread')`,
            [tutor_id, " A learner has been assigned to you by admin."],
          );

          // 5. Notify learner
          db.query(
            `INSERT INTO notifications (user_id, message, status)
             VALUES (?, ?, 'unread')`,
            [
              learner_id,
              " Your enrollment is approved. Tutor assigned successfully.",
            ],
          );

          res.json({
            message: "Enrollment approved and tutor assigned",
          });
        },
      );
    },
  );
});

// Schedule a new session (Tutor)
app.post("/api/sessions/schedule", (req, res) => {
  if (!req.session.user || req.session.user.role !== "tutor")
    return res.status(403).json({ error: "Access denied" });

  const { learner_id, scheduled_at } = req.body;
  const tutor_id = req.session.user.id;

  const sql =
    "INSERT INTO sessions (tutor_id, learner_id, scheduled_at, status) VALUES (?, ?, ?, 'scheduled')";
  db.query(sql, [tutor_id, learner_id, scheduled_at], (err) => {
    if (err)
      return res.status(500).json({ error: "Failed to schedule session" });

    // Notify learner
    const notifyMsg = `Tutor ${req.session.user.name} has scheduled a session with you on ${scheduled_at}`;
    db.query(
      "INSERT INTO notifications (user_id, message, status) VALUES (?, ?, 'unread')",
      [learner_id, notifyMsg],
    );

    res.json({ message: "Session scheduled successfully" });
  });
});

// Create a Meet AND save it as group or private session
app.post("/api/tutor/create-meet", async (req, res) => {
  try {
    console.log("Incoming body:", req.body);
    if (!req.session.user || req.session.user.role !== "tutor") {
      return res.status(403).json({ error: "Access denied" });
    }

    const tutor_id = req.session.user.id;

    const {
      title,
      description,
      startTime,
      endTime,
      session_type, // "group" OR "private"
      group_id,
      learner_id,
    } = req.body;

    // Basic validation
    if (!title || !startTime || !endTime || !session_type) {
      return res.status(400).json({
        error: "title, startTime, endTime and session_type are required",
      });
    }

    // Group session validation
    if (session_type === "group" && !group_id) {
      return res
        .status(400)
        .json({ error: "Group ID required for group session" });
    }

    // Private session validation
    if (session_type === "private" && !learner_id) {
      return res
        .status(400)
        .json({ error: "Learner ID required for private session" });
    }

    //  Create Google Meet
    const meetLink = await createGoogleMeet(
      title,
      description,
      startTime,
      endTime,
    );

    // Convert to MySQL DATETIME
    const toMySQL = (s) =>
      new Date(s).toISOString().slice(0, 19).replace("T", " ");

    //  Insert into DB
    const sql = `
      INSERT INTO sessions 
      (tutor_id, group_id, learner_id, title, description, 
       scheduled_at, meeting_link, status, session_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)
    `;

    db.query(
      sql,
      [
        tutor_id,
        session_type === "group" ? group_id : null,
        session_type === "private" ? learner_id : null,
        title,
        description || null,
        toMySQL(startTime),
        meetLink,
        session_type,
      ],
      (err, result) => {
        if (err) {
          console.error(" Failed to save session:", err);
          return res.status(500).json({
            error: "Meet created but saving session failed",
            meetLink,
          });
        }

        const sessionId = result.insertId;

        //  Send Notifications

        if (session_type === "group") {
          db.query(
            "SELECT learner_id FROM group_learners WHERE group_id = ?",
            [group_id],
            (err2, learners) => {
              if (!err2 && learners.length > 0) {
                learners.forEach((l) => {
                  db.query(
                    "INSERT INTO notifications (user_id, message, status) VALUES (?, ?, 'unread')",
                    [l.learner_id, ` New group session scheduled: ${title}`],
                  );
                });
              }
            },
          );
        }

        if (session_type === "private") {
          db.query(
            "INSERT INTO notifications (user_id, message, status) VALUES (?, ?, 'unread')",
            [learner_id, ` Private session scheduled: ${title}`],
          );
        }

        res.json({
          success: true,
          meetLink,
          session_id: sessionId,
        });
      },
    );
  } catch (err) {
    console.error(" Error creating meeting:", err);
    res.status(500).json({ error: err.message || "Failed to create meeting" });
  }
});

// Tutor: View all sessions
app.get("/api/sessions/tutor", (req, res) => {
  if (!req.session.user || req.session.user.role !== "tutor") {
    return res.status(403).json({ error: "Unauthorized" });
  }

  const tutor_id = req.session.user.id;

  const sql = `
    SELECT *
    FROM sessions
    WHERE tutor_id = ?
      AND (
        status = 'scheduled'
        OR completed_at >= NOW() - INTERVAL 1 DAY
      )
    ORDER BY scheduled_at DESC
  `;

  db.query(sql, [tutor_id], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Database error" });
    }
    res.json(results);
  });
});

// Learner: View their sessions
app.get("/api/sessions/learner", (req, res) => {
  if (!req.session.user || req.session.user.role !== "learner") {
    return res.status(403).json({ error: "Unauthorized" });
  }

  const learnerId = req.session.user.id;

  const sql = `
    SELECT DISTINCT s.*
    FROM sessions s
    LEFT JOIN group_learners gl 
      ON s.group_id = gl.group_id
    WHERE
      (
        s.learner_id = ?
        OR gl.learner_id = ?
      )
      AND s.status = 'scheduled'
      AND DATE(s.scheduled_at) >= CURDATE()
    ORDER BY s.scheduled_at ASC
  `;

  db.query(sql, [learnerId, learnerId], (err, results) => {
    if (err) {
      console.error("Session fetch error:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.json(results);
  });
});

//  Notify Tutor when Admin Approves or Rejects
function sendTutorDecisionEmail(tutorId, decision) {
  db.query(
    "SELECT name, email FROM users WHERE id = ?",
    [tutorId],
    (err, results) => {
      if (err) {
        console.error(" Failed to fetch tutor for email:", err);
        return;
      }
      if (!results || results.length === 0) {
        console.error(" Tutor not found for id:", tutorId);
        return;
      }

      const { name, email } = results[0];

      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.GMAIL_USER,
          pass: process.env.GMAIL_APP_PASSWORD,
        },
      });

      let subject, text;
      if (decision === "approved") {
        subject = "✅ Your TutorConnect Profile Has Been Approved";
        text = `Hello ${name},\n\nCongratulations! 🎉\n\nYour tutor profile has been approved by the admin. You can now log in to your Tutor Dashboard and start scheduling sessions.\n\nVisit: http://localhost:3000/login.html\n\nBest,\nTutorConnect Team`;
      } else {
        subject = "❌ Your TutorConnect Profile Was Rejected";
        text = `Hello ${name},\n\nUnfortunately, your tutor profile has been rejected. Please review your details and resubmit your profile for approval.\n\nIf you have any questions, contact us at tutorconnecta@gmail.com.\n\nBest,\nTutorConnect Team`;
      }

      const mailOptions = {
        from: `"TutorConnect" <${process.env.GMAIL_USER}>`,
        to: email,
        subject,
        text,
      };

      transporter.sendMail(mailOptions, (err, info) => {
        if (err)
          console.error(" Failed to send tutor decision email:", err.message);
        else
          console.log(
            ` Tutor ${decision} email sent to ${email}:`,
            info.response,
          );
      });
    },
  );
}

// fetech tutor profile+ session info
app.get("/api/admin/tutors/full", isAdmin, (req, res) => {
  const sql = `
    SELECT 
      u.id, u.name, u.email,
      t.bio, t.skills, t.subjects, t.availability, t.profile_pic, t.status,
      s.session_id, s.title, s.description, s.scheduled_at, 
      s.meeting_link, s.recording_link, s.status AS session_status
    FROM users u
    LEFT JOIN tutor_profiles t ON u.id = t.tutor_id
    LEFT JOIN sessions s ON u.id = s.tutor_id
    WHERE u.role = 'tutor'
    ORDER BY u.id DESC
  `;

  db.query(sql, (err, rows) => {
    if (err) {
      console.error(" DB error fetching tutor info:", err);
      return res.status(500).json({ error: "Failed to fetch tutor data" });
    }

    const tutorMap = {};

    rows.forEach((row) => {
      if (!tutorMap[row.id]) {
        tutorMap[row.id] = {
          id: row.id,
          name: row.name,
          email: row.email,
          bio: row.bio,
          skills: row.skills,
          subjects: row.subjects,
          availability: row.availability,
          profile_pic: row.profile_pic,
          status: row.status,
          sessions: [],
        };
      }

      if (row.session_id) {
        tutorMap[row.id].sessions.push({
          session_id: row.session_id,
          title: row.title,
          description: row.description,
          scheduled_at: row.scheduled_at,
          meeting_link: row.meeting_link,
          recording_link: row.recording_link,
          status: row.session_status,
        });
      }
    });

    res.json(Object.values(tutorMap));
  });
});

// Learner requests a tutor
app.post("/api/learner/request-tutor", (req, res) => {
  if (!req.session.user || req.session.user.role !== "learner")
    return res.status(403).json({ error: "Access denied" });

  const learner_id = req.session.user.id;
  const { subject, message, tutor_id, tutor_name } = req.body;

  // If tutor_name was passed instead of id, keep tutor_id null — admin will resolve
  const sql = `INSERT INTO tutor_requests (learner_id, tutor_id, subject, message) VALUES (?, ?, ?, ?)`;
  db.query(
    sql,
    [learner_id, tutor_id || null, subject || null, message || null],
    (err, result) => {
      if (err) {
        console.error(" tutor request insert failed", err);
        return res.status(500).json({ error: "Request failed" });
      }

      // notify admin (insert a generic notification visible to admins)
      const notifyMsg = `${req.session.user.name} requested a tutor for "${
        subject || "a subject"
      }".`;
      db.query(
        'INSERT INTO notifications (user_id, message, status) VALUES (?, ?, "unread")',
        [learner_id, notifyMsg],
        () => {},
      );

      // Optionally notify specific tutor if tutor_id provided
      if (tutor_id) {
        db.query(
          'INSERT INTO notifications (user_id, message, status) VALUES (?, ?, "unread")',
          [tutor_id, `A learner requested you as tutor for ${subject}`],
          () => {},
        );
      }

      res.json({ success: true, request_id: result.insertId });
    },
  );
});

// Aggregated learner dashboard data
app.get("/api/learner/dashboard", (req, res) => {
  if (!req.session.user || req.session.user.role !== "learner")
    return res.status(403).json({ error: "Access denied" });

  const learnerId = req.session.user.id;

  // 1) requests
  db.query(
    "SELECT * FROM tutor_requests WHERE learner_id = ? ORDER BY created_at DESC LIMIT 10",
    [learnerId],
    (err, requests) => {
      if (err) {
        console.error("Dashboard: requests error", err);
        return res.status(500).json({ error: "Failed to load dashboard" });
      }

      // 2) enrollments
      db.query(
        `SELECT e.*, u.name AS tutor_name FROM enrollments e LEFT JOIN users u ON e.tutor_id = u.id WHERE e.learner_id = ?`,
        [learnerId],
        (err2, enrollments) => {
          if (err2) {
            console.error("Dashboard: enrollments error", err2);
            return res.status(500).json({ error: "Failed to load dashboard" });
          }

          // 3) sessions
          db.query(
            "SELECT * FROM sessions WHERE learner_id = ? ORDER BY scheduled_at ASC LIMIT 10",
            [learnerId],
            (err3, sessions) => {
              if (err3) {
                console.error("Dashboard: sessions error", err3);
                return res
                  .status(500)
                  .json({ error: "Failed to load dashboard" });
              }

              // 4) notifications
              db.query(
                "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 10",
                [learnerId],
                (err4, notifications) => {
                  if (err4) {
                    console.error("Dashboard: notifications error", err4);
                    return res
                      .status(500)
                      .json({ error: "Failed to load dashboard" });
                  }

                  // optional: include current user info
                  const userInfo = req.session.user || null;

                  res.json({
                    user: userInfo,
                    requests: requests || [],
                    enrollments: enrollments || [],
                    sessions: sessions || [],
                    notifications: notifications || [],
                  });
                },
              );
            },
          );
        },
      );
    },
  );
});

// ====== Admin tutor-requests management routes ======
// GET list of tutor requests (admin)
app.get("/api/admin/tutor_requests", isAdmin, (req, res) => {
  const sql = `
    SELECT tr.request_id, tr.learner_id, tr.tutor_id, tr.subject, tr.message, tr.status, tr.created_at,
           u.name AS learner_name, u.email AS learner_email
    FROM tutor_requests tr
    JOIN users u ON u.id = tr.learner_id
    ORDER BY tr.created_at DESC
    LIMIT 200
  `;
  db.query(sql, (err, rows) => {
    if (err) {
      console.error("GET /api/admin/tutor_requests error:", err);
      return res.status(500).json({ error: "DB error" });
    }
    res.json(rows);
  });
});

// POST assign a tutor to a request (admin)
app.post("/api/admin/tutor_requests/:id/assign", isAdmin, (req, res) => {
  const requestId = req.params.id;
  const { tutor_id } = req.body;
  if (!tutor_id) return res.status(400).json({ error: "tutor_id required" });

  // 1) update tutor_requests row: set tutor_id and status=assigned
  const updateSql = `
    UPDATE tutor_requests
    SET tutor_id = ?, status = 'assigned', updated_at = NOW()
    WHERE request_id = ?
  `;
  db.query(updateSql, [tutor_id, requestId], (err, result) => {
    if (err) {
      console.error("Assign update error:", err);
      return res.status(500).json({ error: "DB error" });
    }

    // 2) fetch learner id for sending notification
    db.query(
      "SELECT learner_id FROM tutor_requests WHERE request_id = ?",
      [requestId],
      (err2, rows) => {
        if (err2 || rows.length === 0) {
          console.error("Assign: fetch learner failed:", err2);
          return res.status(500).json({ error: "DB error" });
        }
        const learnerId = rows[0].learner_id;

        // 3) insert notification for learner
        const msg = `Your tutor request (id ${requestId}) has been assigned to tutor id ${tutor_id}.`;
        db.query(
          "INSERT INTO notifications (user_id, message, status, created_at) VALUES (?, ?, 'unread', NOW())",
          [learnerId, msg],
          (err3) => {
            if (err3) console.error("Failed to create notification:", err3);
            // respond success even if notification fails
            res.json({
              success: true,
              message: "Assigned and learner notified",
            });
          },
        );
      },
    );
  });
});

// POST update request status (admin) - can be used to close/reject
app.post("/api/admin/tutor_requests/:id/status", isAdmin, (req, res) => {
  const requestId = req.params.id;
  const { status, note } = req.body;
  if (!status) return res.status(400).json({ error: "status required" });

  const sql =
    "UPDATE tutor_requests SET status = ?, updated_at = NOW() WHERE request_id = ?";
  db.query(sql, [status, requestId], (err) => {
    if (err) {
      console.error("Update status error:", err);
      return res.status(500).json({ error: "DB error" });
    }

    // optionally notify learner (fetch learner_id)
    db.query(
      "SELECT learner_id FROM tutor_requests WHERE request_id = ?",
      [requestId],
      (err2, rows) => {
        if (!err2 && rows && rows[0]) {
          const learnerId = rows[0].learner_id;
          const msg = note
            ? `Admin updated your tutor request: ${status}. Note: ${note}`
            : `Admin updated your tutor request: ${status}.`;
          db.query(
            "INSERT INTO notifications (user_id, message, status, created_at) VALUES (?, ?, 'unread', NOW())",
            [learnerId, msg],
            (err3) => {
              if (err3) console.error("Notification insert failed:", err3);
              res.json({ success: true });
            },
          );
        } else {
          res.json({ success: true });
        }
      },
    );
  });
});

// === Admin dashboard data  ===
//   to fetch total counts for dashboard
app.get("/api/admin/dashboard", isAdmin, (req, res) => {
  const sql = `
    SELECT
      (SELECT COUNT(*) FROM users WHERE role = 'tutor') AS totalTutors,
      (SELECT COUNT(*) FROM users WHERE role = 'learner') AS totalLearners,
      (SELECT COUNT(*) FROM tutor_profiles WHERE status = 'pending') AS pendingTutors,
      (SELECT COUNT(*) FROM class_groups) AS totalGroups
  `;
  db.query(sql, (err, rows) => {
    if (err) {
      console.error("Error fetching admin dashboard:", err);
      return res.status(500).json({ error: "Database error" });
    }
    res.json(rows[0]);
  });
});

//   to fetch recent admin activity
app.get("/api/admin/activity", isAdmin, (req, res) => {
  const limit = parseInt(req.query.limit || "6");
  const sql = `
    SELECT id, action, details, created_at
    FROM admin_activity
    ORDER BY created_at DESC
    LIMIT ?
  `;
  db.query(sql, [limit], (err, rows) => {
    if (err) {
      console.error("Error fetching admin activity:", err);
      return res.status(500).json({ error: "Database error" });
    }
    res.json(rows);
  });
});

// CREATE CLASS GROUP
app.post("/api/admin/groups", isAdmin, (req, res) => {
  const { group_name, subject, description } = req.body;

  if (!group_name || !subject) {
    return res.status(400).json({
      error: "Group name and subject are required",
    });
  }

  const created_by = req.session.user.id;

  const sql = `
    INSERT INTO class_groups
    (group_name, subject, description, created_by)
    VALUES (?, ?, ?, ?)
  `;

  db.query(
    sql,
    [group_name, subject, description || null, created_by],
    (err, result) => {
      if (err) {
        console.error("Group insert error:", err);
        return res.status(500).json({ error: "Database error" });
      }

      res.json({
        success: true,
        message: "Group created successfully",
        group_id: result.insertId,
      });
    },
  );
});

// GET ALL CLASS GROUPS
app.get("/api/admin/groups", isAdmin, (req, res) => {
  const sql = `
    SELECT 
      g.group_id,
      g.group_name,
      g.subject,
      g.description,
      u1.id AS tutor_id,
      u1.name AS tutor_name,
      u2.id AS learner_id,
      u2.name AS learner_name
    FROM class_groups g
    LEFT JOIN group_tutors gt ON g.group_id = gt.group_id
    LEFT JOIN users u1 ON gt.tutor_id = u1.id
    LEFT JOIN group_learners gl ON g.group_id = gl.group_id
    LEFT JOIN users u2 ON gl.learner_id = u2.id
    ORDER BY g.group_id DESC
  `;

  db.query(sql, (err, rows) => {
    if (err) {
      console.error("Fetch groups error:", err);
      return res.status(500).json({ error: "Database error" });
    }

    const map = {};

    rows.forEach((r) => {
      if (!map[r.group_id]) {
        map[r.group_id] = {
          group_id: r.group_id,
          group_name: r.group_name,
          subject: r.subject,
          description: r.description,
          tutors: [],
          learners: [],
        };
      }

      if (
        r.tutor_id &&
        !map[r.group_id].tutors.some((t) => t.id === r.tutor_id)
      ) {
        map[r.group_id].tutors.push({
          id: r.tutor_id,
          name: r.tutor_name,
        });
      }

      if (
        r.learner_id &&
        !map[r.group_id].learners.some((l) => l.id === r.learner_id)
      ) {
        map[r.group_id].learners.push({
          id: r.learner_id,
          name: r.learner_name,
        });
      }
    });

    res.json(Object.values(map));
  });
});

// ADD TUTOR TO GROUP
app.post("/api/admin/groups/:id/add-tutor", isAdmin, (req, res) => {
  const groupId = req.params.id;
  const { tutor_id } = req.body;

  if (!tutor_id) return res.status(400).json({ error: "Tutor ID required" });

  const sql = `
    INSERT IGNORE INTO group_tutors (group_id, tutor_id)
    VALUES (?, ?)
  `;

  db.query(sql, [groupId, tutor_id], (err) => {
    if (err) {
      console.error(" Add tutor error:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.json({ success: true, message: "Tutor added to group" });
  });
});

// ADD LEARNER TO GROUP
app.post("/api/admin/groups/:id/add-learner", isAdmin, (req, res) => {
  const groupId = req.params.id;
  const { learner_id } = req.body;

  if (!learner_id)
    return res.status(400).json({ error: "Learner ID required" });

  const sql = `
    INSERT IGNORE INTO group_learners (group_id, learner_id)
    VALUES (?, ?)
  `;

  db.query(sql, [groupId, learner_id], (err) => {
    if (err) {
      console.error("Add learner error:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.json({ success: true, message: "Learner added to group" });
  });
});

// delete Groups
app.delete("/api/admin/groups/:id", isAdmin, (req, res) => {
  const groupId = req.params.id;

  db.query("DELETE FROM group_learners WHERE group_id=?", [groupId], (err1) => {
    if (err1) {
      console.error(err1);
      return res.status(500).json({ error: "Failed deleting learners" });
    }

    db.query("DELETE FROM group_tutors WHERE group_id=?", [groupId], (err2) => {
      if (err2) {
        console.error(err2);
        return res.status(500).json({ error: "Failed deleting tutors" });
      }

      db.query(
        "DELETE FROM class_groups WHERE group_id=?",
        [groupId],
        (err3) => {
          if (err3) {
            console.error(err3);
            return res.status(500).json({ error: "Failed deleting group" });
          }

          res.json({ success: true });
        },
      );
    });
  });
});

// REMOVE TUTOR FROM GROUP
app.delete(
  "/api/admin/groups/:groupId/remove-tutor/:tutorId",
  isAdmin,
  (req, res) => {
    const { groupId, tutorId } = req.params;

    db.query(
      "DELETE FROM group_tutors WHERE group_id=? AND tutor_id=?",
      [groupId, tutorId],
      (err) => {
        if (err) {
          console.error("Remove tutor error:", err);
          return res.status(500).json({ error: "Database error" });
        }

        res.json({ success: true });
      },
    );
  },
);

// REMOVE LEARNER FROM GROUP
app.delete(
  "/api/admin/groups/:groupId/remove-learner/:learnerId",
  isAdmin,
  (req, res) => {
    const { groupId, learnerId } = req.params;

    db.query(
      "DELETE FROM group_learners WHERE group_id=? AND learner_id=?",
      [groupId, learnerId],
      (err) => {
        if (err) {
          console.error("Remove learner error:", err);
          return res.status(500).json({ error: "Database error" });
        }

        res.json({ success: true });
      },
    );
  },
);

//  Simple  to get total tutors and learner
app.get("/api/dashboard_counts", (req, res) => {
  const sql = `
    SELECT
      (SELECT COUNT(*) FROM users WHERE role = 'tutor') AS totalTutors,
      (SELECT COUNT(*) FROM users WHERE role = 'learner') AS totalLearners
  `;
  db.query(sql, (err, results) => {
    if (err) {
      console.error("Error fetching counts:", err);
      return res.status(500).json({ error: "Database error" });
    }
    res.json(results[0]);
  });
});

// ADMIN TUTOR PAGE APPROVED TUTOR
app.get("/api/admin/tutors/approved", isAdmin, (req, res) => {
  const sql = `
    SELECT 
      u.id,
      u.name,
      u.email,
      t.bio,
      t.subjects,
      t.skills,
      t.profile_pic,

      -- Rating Subquery
      (
        SELECT ROUND(AVG(r.rating),1)
        FROM tutor_ratings r
        WHERE r.tutor_id = u.id
      ) AS avg_rating,

      (
        SELECT COUNT(*)
        FROM tutor_ratings r
        WHERE r.tutor_id = u.id
      ) AS total_reviews,

      -- Complaint Subquery
      (
        SELECT COUNT(*)
        FROM tutor_requests tr
        WHERE tr.tutor_id = u.id
        AND tr.status = 'rejected'
      ) AS complaints

    FROM users u
    JOIN tutor_profiles t ON u.id = t.tutor_id

    WHERE u.role = 'tutor'
    AND t.status = 'approved'

    ORDER BY u.id DESC
  `;

  db.query(sql, (err, rows) => {
    if (err) {
      console.error("DB error:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.json(rows);
  });
});

// PERFORMANCE
app.get("/api/admin/tutor/:id/performance", isAdmin, (req, res) => {
  const tutorId = req.params.id;

  const queries = {
    sessions: "SELECT COUNT(*) AS total FROM sessions WHERE tutor_id = ?",
    enrollments: "SELECT COUNT(*) AS total FROM enrollments WHERE tutor_id = ?",
    complaints:
      "SELECT COUNT(*) AS total FROM tutor_requests WHERE tutor_id = ? AND status='rejected'",
  };

  const performance = {};

  db.query(queries.sessions, [tutorId], (err, s) => {
    if (err) return res.status(500).json({ error: "DB error" });
    performance.sessions = s[0].total;

    db.query(queries.enrollments, [tutorId], (err2, e) => {
      if (err2) return res.status(500).json({ error: "DB error" });
      performance.enrollments = e[0].total;

      db.query(queries.complaints, [tutorId], (err3, c) => {
        if (err3) return res.status(500).json({ error: "DB error" });
        performance.complaints = c[0].total;

        res.json(performance);
      });
    });
  });
});

// ADMIN SUSPEND TUTOR
app.post("/api/admin/tutors/:id/suspend", isAdmin, (req, res) => {
  db.query(
    "UPDATE tutor_profiles SET status='suspended' WHERE tutor_id=?",
    [req.params.id],
    (err) => {
      if (err) return res.status(500).json({ error: "Suspend failed" });
      res.json({ message: "Tutor suspended successfully" });
    },
  );
});

// TUTOR RATING BY LEANRER
app.get("/api/admin/tutor/:id/reviews", isAdmin, (req, res) => {
  db.query(
    "SELECT rating, review FROM tutor_ratings WHERE tutor_id=?",
    [req.params.id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "DB error" });
      res.json(rows);
    },
  );
});

// TUTOR FETCH GROUP
app.get("/api/tutor/groups", (req, res) => {
  const tutorId = req.session.user.id;

  const query = `
    SELECT cg.group_id, cg.group_name, cg.subject, cg.description
    FROM class_groups cg
    JOIN group_tutors gt ON cg.group_id = gt.group_id
    WHERE gt.tutor_id = ?
  `;

  db.query(query, [tutorId], (err, groups) => {
    if (err) return res.status(500).json(err);

    res.json(groups);
  });
});

//Tutor fetch learner per group
app.get("/api/tutor/group-learners/:groupId", (req, res) => {
  const groupId = req.params.groupId;

  const query = `
    SELECT u.id, u.name
    FROM group_learners gl
    JOIN users u ON gl.learner_id = u.id
    WHERE gl.group_id = ?
  `;

  db.query(query, [groupId], (err, learners) => {
    if (err) return res.status(500).json(err);

    res.json(learners);
  });
});

// Learner fetch their groups
app.get("/api/learner/groups", (req, res) => {
  if (!req.session.user || req.session.user.role !== "learner") {
    return res.status(403).json({ error: "Access denied" });
  }

  const learnerId = req.session.user.id;

  const sql = `
    SELECT 
      cg.group_id,
      cg.group_name,
      cg.subject,
      cg.description,
      u.name AS tutor_name
    FROM group_learners gl
    JOIN class_groups cg ON gl.group_id = cg.group_id
    LEFT JOIN group_tutors gt ON cg.group_id = gt.group_id
    LEFT JOIN users u ON gt.tutor_id = u.id
    WHERE gl.learner_id = ?
  `;

  db.query(sql, [learnerId], (err, rows) => {
    if (err) {
      console.error("Error fetching learner groups:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.json(rows);
  });
});

// Learner fetch group sessions
app.get("/api/learner/group-sessions/:groupId", (req, res) => {
  if (!req.session.user || req.session.user.role !== "learner") {
    return res.status(403).json({ error: "Access denied" });
  }

  const learnerId = req.session.user.id;
  const groupId = req.params.groupId;

  // Check if learner belongs to this group
  const checkSql = `
    SELECT * FROM group_learners 
    WHERE learner_id = ? AND group_id = ?
  `;

  db.query(checkSql, [learnerId, groupId], (err, rows) => {
    if (err) return res.status(500).json({ error: "Database error" });

    if (rows.length === 0) {
      return res.status(403).json({ error: "Not authorized for this group" });
    }

    // Fetch sessions of that group
    const sessionSql = `
      SELECT *
      FROM sessions
      WHERE group_id = ?
      ORDER BY scheduled_at DESC
    `;

    db.query(sessionSql, [groupId], (err2, sessions) => {
      if (err2) return res.status(500).json({ error: "Database error" });

      res.json(sessions);
    });
  });
});

// LEARNER SEND REQUEST FOR DOUBT SOLVING TO TUTOR
app.post("/api/learner/doubt-request", (req, res) => {
  if (!req.session.user || req.session.user.role !== "learner")
    return res.status(403).json({ error: "Access denied" });

  const learnerId = req.session.user.id;
  const { tutor_id, subject, message, preferred_time } = req.body;

  if (!tutor_id) return res.status(400).json({ error: "Tutor is required" });

  const sql = `
    INSERT INTO doubt_requests
    (learner_id, tutor_id, subject, message, preferred_time, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `;

  db.query(
    sql,
    [learnerId, tutor_id, subject, message, preferred_time],
    (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Database error" });
      }

      res.json({ success: true });
    },
  );
});

// TUTOR VIEW Doubt REQUEST
app.get("/api/tutor/doubt-requests", (req, res) => {
  if (!req.session.user || req.session.user.role !== "tutor")
    return res.status(403).json({ error: "Access denied" });

  const tutorId = req.session.user.id;

  db.query(
    "SELECT * FROM doubt_requests WHERE tutor_id=? ORDER BY created_at DESC",
    [tutorId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "Database error" });

      res.json(rows);
    },
  );
});

// TUTOR APPROVE DOUBT SOLVING REQUEST
app.post("/api/tutor/doubt-requests/:id/approve", async (req, res) => {
  try {
    if (!req.session.user || req.session.user.role !== "tutor")
      return res.status(403).json({ error: "Access denied" });

    const tutorId = req.session.user.id;
    const requestId = req.params.id;

    db.query(
      "SELECT * FROM doubt_requests WHERE request_id=?",
      [requestId],
      async (err, rows) => {
        if (err) return res.status(500).json({ error: "Database error" });

        if (!rows || rows.length === 0)
          return res.status(404).json({ error: "Request not found" });

        const request = rows[0];

        //  SECURITY: ensure tutor owns this request
        if (request.tutor_id !== tutorId) {
          return res.status(403).json({ error: "Not authorized" });
        }

        //  PREVENT DOUBLE APPROVAL
        if (request.status !== "pending") {
          return res.json({ message: "Request already processed" });
        }

        //  Create 1-hour meeting duration
        const start = new Date(request.preferred_time);
        const end = new Date(start.getTime() + 60 * 60 * 1000);

        const meetLink = await createGoogleMeet(
          "Private Doubt Session",
          request.message,
          start,
          end,
        );

        const toMySQL = (d) =>
          new Date(d).toISOString().slice(0, 19).replace("T", " ");

        //  Insert session
        db.query(
          `INSERT INTO sessions 
           (tutor_id, learner_id, title, scheduled_at, meeting_link, status, session_type)
           VALUES (?, ?, ?, ?, ?, 'scheduled', 'private')`,
          [
            request.tutor_id,
            request.learner_id,
            `Doubt Session: ${request.subject || "General Discussion"}`,
            toMySQL(start),
            meetLink,
          ],
          (err2) => {
            if (err2)
              return res.status(500).json({ error: "Session creation failed" });

            // Update doubt request
            db.query(
              "UPDATE doubt_requests SET status='approved' WHERE request_id=?",
              [requestId],
            );

            // Notify learner
            db.query(
              "INSERT INTO notifications (user_id, message, status) VALUES (?, ?, 'unread')",
              [
                request.learner_id,
                "Your doubt request was approved. Check your sessions.",
              ],
            );

            res.json({ success: true });
          },
        );
      },
    );
  } catch (error) {
    console.error("Approval error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// TUTOR REJECT DOUBT SOLVING REQUEST
app.post("/api/tutor/doubt-requests/:id/reject", (req, res) => {
  if (!req.session.user || req.session.user.role !== "tutor")
    return res.status(403).json({ error: "Access denied" });

  const tutorId = req.session.user.id;
  const requestId = req.params.id;

  db.query(
    "SELECT * FROM doubt_requests WHERE request_id=?",
    [requestId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "Database error" });

      if (!rows || rows.length === 0)
        return res.status(404).json({ error: "Request not found" });

      const request = rows[0];

      // SECURITY CHECK
      if (request.tutor_id !== tutorId) {
        return res.status(403).json({ error: "Not authorized" });
      }

      // Prevent double processing
      if (request.status !== "pending") {
        return res.json({ message: "Request already processed" });
      }

      db.query(
        "UPDATE doubt_requests SET status='rejected' WHERE request_id=?",
        [requestId],
        (err2) => {
          if (err2) return res.status(500).json({ error: "Update failed" });

          //  Notify learner
          db.query(
            "INSERT INTO notifications (user_id, message, status) VALUES (?, ?, 'unread')",
            [
              request.learner_id,
              "Your doubt request was rejected by the tutor.",
            ],
          );

          res.json({ success: true });
        },
      );
    },
  );
});

// LEARNER VIEW THEIR DOUBT REQUEST
app.get("/api/learner/doubt-requests", (req, res) => {
  if (!req.session.user || req.session.user.role !== "learner")
    return res.status(403).json({ error: "Access denied" });

  const learnerId = req.session.user.id;

  db.query(
    "SELECT * FROM doubt_requests WHERE learner_id=? ORDER BY created_at DESC",
    [learnerId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "Database error" });

      res.json(rows);
    },
  );
});

// AUTOMATIC ATTENDANCE ROUTE
app.get("/join-session/:sessionId", (req, res) => {
  console.log("Session user:", req.session.user);
  if (!req.session.user || req.session.user.role !== "learner") {
    return res.status(403).send("Access denied");
  }

  const learnerId = req.session.user.id;
  const sessionId = req.params.sessionId;

  db.query(
    "SELECT * FROM sessions WHERE session_id = ?",
    [sessionId],
    (err, sessions) => {
      if (err) return res.status(500).send("Database error");
      if (sessions.length === 0)
        return res.status(404).send("Session not found");

      const session = sessions[0];

      if (session.session_type === "private") {
        if (session.learner_id !== learnerId) {
          return res.status(403).send("Not authorized");
        }

        markAttendance(session, learnerId, res);
      }

      if (session.session_type === "group") {
        db.query(
          "SELECT * FROM group_learners WHERE group_id = ? AND learner_id = ?",
          [session.group_id, learnerId],
          (err2, rows) => {
            if (err2) return res.status(500).send("Database error");
            if (rows.length === 0)
              return res.status(403).send("Not authorized");

            markAttendance(session, learnerId, res);
          },
        );
      }
    },
  );
});

// ATTENDANCE FUNCTION
function markAttendance(session, learnerId, res) {
  const now = new Date();
  const sessionTime = new Date(session.scheduled_at);

  const allowedJoinTime = new Date(sessionTime.getTime() - 10 * 60000);

  if (now < allowedJoinTime) {
    return res.json({
      success: false,
      message: "Session has not started yet",
    });
  }

  db.query(
    `INSERT INTO session_attendance
     (session_id, learner_id, tutor_id, status)
     VALUES (?, ?, ?, 'present')
     ON DUPLICATE KEY UPDATE status='present'`,
    [session.session_id, learnerId, session.tutor_id],
    (err) => {
      if (err) {
        console.log("Attendance Error:", err);
        return res.status(500).json({
          success: false,
          message: "Attendance failed",
        });
      }

      return res.json({
        success: true,
        meeting_link: session.meeting_link,
      });
    },
  );
}

// TUTOR SESSION ATTENDANCE VIEW
app.get("/api/tutor/session/:sessionId/attendance", (req, res) => {
  if (!req.session.user || req.session.user.role !== "tutor") {
    return res.status(403).json({ error: "Access denied" });
  }

  const tutorId = req.session.user.id;
  const sessionId = req.params.sessionId;

  const sql = `
    SELECT 
      u.name AS learner_name,
      COALESCE(sa.status, 'absent') AS attendance_status,
      sa.marked_at
    FROM sessions s

    JOIN (
      SELECT learner_id, session_id FROM sessions WHERE session_id = ?
      UNION
      SELECT gl.learner_id, s.session_id
      FROM sessions s
      JOIN group_learners gl ON s.group_id = gl.group_id
      WHERE s.session_id = ?
    ) AS learners ON learners.session_id = s.session_id

    JOIN users u ON u.id = learners.learner_id

    LEFT JOIN session_attendance sa
      ON sa.session_id = s.session_id
      AND sa.learner_id = learners.learner_id

    WHERE s.session_id = ?
      AND s.tutor_id = ?
  `;

  db.query(sql, [sessionId, sessionId, sessionId, tutorId], (err, results) => {
    if (err) {
      console.log(err);
      return res.status(500).json({ error: "Failed to fetch attendance" });
    }

    res.json(results);
  });
});

// OVERALL LEARNER PROGRESS
app.get("/api/learner/progress", async (req, res) => {
  if (!req.session.user || req.session.user.role !== "learner") {
    return res.status(403).json({ error: "Access denied" });
  }

  const learnerId = req.session.user.id;
  const connection = await db.promise().getConnection();

  try {
    // TOTAL SESSIONS
    const [totalSessionsResult] = await connection.query(
      `
      SELECT COUNT(DISTINCT s.session_id) AS total
      FROM sessions s
      LEFT JOIN group_learners gl ON s.group_id = gl.group_id
      WHERE s.learner_id = ? OR gl.learner_id = ?
    `,
      [learnerId, learnerId],
    );

    const totalSessions = totalSessionsResult[0].total || 0;

    // PRESENT SESSIONS
    const [presentResult] = await connection.query(
      `
      SELECT COUNT(*) AS present
      FROM session_attendance
      WHERE learner_id = ? AND status = 'present'
    `,
      [learnerId],
    );

    const present = presentResult[0].present || 0;
    const attendancePercent =
      totalSessions > 0 ? Math.round((present / totalSessions) * 100) : 0;

    // TOTAL TASKS
    const [totalTasksResult] = await connection.query(
      `
      SELECT COUNT(DISTINCT st.task_id) AS totalTasks
      FROM session_tasks st
      JOIN sessions s ON st.session_id = s.session_id
      LEFT JOIN group_learners gl ON s.group_id = gl.group_id
      WHERE s.learner_id = ? OR gl.learner_id = ?
    `,
      [learnerId, learnerId],
    );

    const totalTasks = totalTasksResult[0].totalTasks || 0;

    // COMPLETED TASKS (MCQ + Coding BEST attempt logic)
    const [completedTasksResult] = await connection.query(
      `
      SELECT COUNT(DISTINCT task_id) AS completed
FROM (

  -- MCQ Passed Tasks
  SELECT best.task_id
  FROM (
    SELECT task_id, MAX(score) AS best_score
    FROM mcq_attempts
    WHERE learner_id = ?
    GROUP BY task_id
  ) best
  WHERE best.best_score >= (
    SELECT SUM(marks) * 0.5
    FROM mcq_questions
    WHERE task_id = best.task_id
  )

  UNION

  -- Coding Passed Tasks
  SELECT task_id
  FROM (
    SELECT task_id, MAX(marks) AS best_marks
    FROM task_submissions
    WHERE learner_id = ?
    GROUP BY task_id
  ) coding_best
  WHERE best_marks >= 50

) AS completed_tasks
    `,
      [learnerId, learnerId, learnerId],
    );

    const completedTasks = completedTasksResult[0].completed || 0;

    const taskPercent =
      totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    res.json({
      attendance_percent: attendancePercent,
      task_percent: taskPercent,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  } finally {
    connection.release();
  }
});

// MCQ SUBMISSION
app.post("/api/learner/mcq/:taskId/submit", async (req, res) => {
  const connection = await db.promise().getConnection();

  try {
    const taskId = req.params.taskId;
    const learnerId = req.session?.user?.id;
    const { answers } = req.body;

    if (!learnerId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!answers || !Array.isArray(answers) || answers.length === 0) {
      return res.status(400).json({ error: "Answers are required" });
    }

    //  Check if learner already attempted 5 times
    const [attemptCheck] = await connection.query(
      `SELECT COUNT(*) AS total 
   FROM mcq_attempts 
   WHERE learner_id = ? AND task_id = ?`,
      [learnerId, taskId],
    );

    if (attemptCheck[0].total >= 5) {
      return res.status(403).json({
        error: "Maximum 5 attempts allowed for this quiz.",
        attempts_used: attemptCheck[0].total,
        max_attempts: 5,
      });
    }
    await connection.beginTransaction();

    //  Fetch questions
    const [questions] = await connection.query(
      `SELECT question_id, question_text, correct_option, marks
       FROM mcq_questions
       WHERE task_id = ?`,
      [taskId],
    );

    if (questions.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "No questions found" });
    }

    let totalScore = 0;
    const detailedResults = [];

    //  Insert attempt (temporary score 0)
    const [attemptInsert] = await connection.query(
      `INSERT INTO mcq_attempts 
       (learner_id, task_id, score, total_questions, submitted_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [learnerId, taskId, 0, questions.length],
    );

    const attemptId = attemptInsert.insertId;

    //  Check answers
    for (const ans of answers) {
      const question = questions.find((q) => q.question_id == ans.question_id);

      if (!question) continue;

      const selectedOptionId = parseInt(ans.selected_option_id);

      //  Get correct option_id using option_number
      const [correctOptionRow] = await connection.query(
        `SELECT option_id
   FROM mcq_options
   WHERE question_id = ?
   AND option_number = ?`,
        [question.question_id, question.correct_option],
      );

      const correctOptionId = correctOptionRow[0]?.option_id;

      console.log("Question:", question.question_text);
      console.log("Selected ID:", selectedOptionId);
      console.log("Correct ID:", correctOptionId);

      if (selectedOptionId === correctOptionId) {
        totalScore += question.marks;
      }

      //  Save learner answer
      await connection.query(
        `INSERT INTO mcq_answers (attempt_id, question_id, selected_option)
   VALUES (?, ?, ?)`,
        [attemptId, ans.question_id, selectedOptionId],
      );

      //  Get options for detailed result
      const [options] = await connection.query(
        `SELECT option_id, option_number, option_text
   FROM mcq_options
   WHERE question_id = ?`,
        [ans.question_id],
      );

      detailedResults.push({
        question_text: question.question_text,
        correct_option_id: correctOptionId,
        selected_option_id: selectedOptionId,
        options: options,
      });
    }

    //  Update final score
    await connection.query(
      `UPDATE mcq_attempts SET score = ? WHERE attempt_id = ?`,
      [totalScore, attemptId],
    );

    //  Get best score
    const [bestResult] = await connection.query(
      `SELECT MAX(score) AS best_score
   FROM mcq_attempts
   WHERE learner_id = ? AND task_id = ?`,
      [learnerId, taskId],
    );

    const bestScore = bestResult[0].best_score;

    // Passing logic
    const passingMark = 50;
    const totalQuestions = questions.length;
    const currentPercentage = (totalScore / totalQuestions) * 100;
    const bestPercentage = (bestScore / totalQuestions) * 100;

    const status = bestPercentage >= passingMark ? "Passed" : "Failed";

    await connection.commit();

    //  Performance analysis
    const correctAnswers = totalScore;
    // const totalQuestions = questions.length;
    const wrongAnswers = totalQuestions - correctAnswers;
    const percentage = ((correctAnswers / totalQuestions) * 100).toFixed(2);

    let grade = "";
    let message = "";

    if (percentage >= 90) {
      grade = "A+";
      message = "Outstanding Performance 🔥";
    } else if (percentage >= 75) {
      grade = "A";
      message = "Excellent Work 👏";
    } else if (percentage >= 60) {
      grade = "B";
      message = "Good Job 👍";
    } else if (percentage >= 40) {
      grade = "C";
      message = "Needs Improvement 📘";
    } else {
      grade = "D";
      message = "Revise and Try Again 💪";
    }

    res.json({
      score: correctAnswers,
      total_questions: totalQuestions,
      wrong_answers: wrongAnswers,
      percentage,
      grade,
      message,
      results: detailedResults,
    });
  } catch (error) {
    await connection.rollback();
    console.error(error);
    res.status(500).json({ error: "Server error" });
  } finally {
    connection.release();
  }
});

// LEARNER PROGRESS PER SESSION
app.get("/api/learner/progress/:sessionId", (req, res) => {
  if (!req.session.user || req.session.user.role !== "learner") {
    return res.status(403).json({ error: "Access denied" });
  }

  const learnerId = req.session.user.id;
  const sessionId = req.params.sessionId;

  const sessionCheckSql = `
    SELECT s.*
    FROM sessions s
    LEFT JOIN group_learners gl ON s.group_id = gl.group_id
    WHERE s.session_id = ?
    AND (s.learner_id = ? OR gl.learner_id = ?)
  `;

  db.query(
    sessionCheckSql,
    [sessionId, learnerId, learnerId],
    (err, sessions) => {
      if (err) return res.status(500).json({ error: "Database error" });

      if (sessions.length === 0) {
        return res
          .status(404)
          .json({ error: "Session not found or unauthorized" });
      }

      const session = sessions[0];

      if (session.status !== "completed") {
        return res.json({
          session_id: sessionId,
          attendance_score: 0,
          task_score: 0,
          total_progress: 0,
        });
      }

      //  Attendance
      db.query(
        `SELECT status FROM session_attendance 
       WHERE session_id = ? AND learner_id = ?`,
        [sessionId, learnerId],
        (err2, attendanceRows) => {
          if (err2) return res.status(500).json({ error: "Database error" });

          const attendanceScore =
            attendanceRows.length > 0 && attendanceRows[0].status === "present"
              ? 50
              : 0;

          //  Fetch all tasks for session
          db.query(
            `SELECT task_id FROM session_tasks WHERE session_id = ?`,
            [sessionId],
            (err3, taskRows) => {
              if (err3)
                return res.status(500).json({ error: "Database error" });

              const totalTasks = taskRows.length;

              if (totalTasks === 0) {
                return res.json({
                  session_id: sessionId,
                  attendance_score: attendanceScore,
                  task_score: 0,
                  total_progress: attendanceScore,
                });
              }

              const taskIds = taskRows.map((t) => t.task_id);

              //  Get completed tasks based on score logic
              const completionSql = `
              SELECT task_id FROM (
                
                -- MCQ: best score >= 50% of max marks
                SELECT ma.task_id
                FROM mcq_attempts ma
                JOIN (
                  SELECT task_id, MAX(score) AS best_score
                  FROM mcq_attempts
                  WHERE learner_id = ?
                  GROUP BY task_id
                ) best ON ma.task_id = best.task_id
                WHERE ma.learner_id = ?
                AND ma.task_id IN (?)
                GROUP BY ma.task_id
                HAVING best.best_score >= (
                  SELECT SUM(marks) * 0.5
                  FROM mcq_questions
                  WHERE task_id = ma.task_id
                )

                UNION

                -- Coding: BEST attempt >= 50
                SELECT task_id
                FROM (
                  SELECT task_id, MAX(marks) AS best_marks
                    FROM task_submissions
                    WHERE learner_id = ?
                    AND task_id IN (?)
                    GROUP BY task_id
                  ) coding_best
                WHERE best_marks >= 50
            `;

              db.query(
                completionSql,
                [learnerId, learnerId, taskIds, learnerId, taskIds],
                (err4, result) => {
                  if (err4) {
                    console.error("Task score error:", err4);
                    return res.status(500).json({ error: "Database error" });
                  }

                  const completedTasks = result.length;

                  const taskScore = Math.round(
                    (completedTasks / totalTasks) * 50,
                  );

                  const totalProgress = attendanceScore + taskScore;

                  res.json({
                    session_id: sessionId,
                    total_tasks: totalTasks,
                    completed_tasks: completedTasks,
                    attendance_score: attendanceScore,
                    task_score: taskScore,
                    total_progress: totalProgress,
                  });
                },
              );
            },
          );
        },
      );
    },
  );
});

// TUTOR VIEW CODING SUBMISSIONS PER SESSION
app.get("/api/tutor/session/:sessionId/submissions", (req, res) => {
  if (!req.session.user || req.session.user.role !== "tutor") {
    return res.status(403).json({ error: "Access denied" });
  }

  const tutorId = req.session.user.id;
  const sessionId = req.params.sessionId;

  const sql = `
    SELECT 
      ts.submission_id,
      ts.task_id,
      ts.learner_id,
      u.name AS learner_name,
      ts.attempt_no,
      ts.status,
      ts.marks,
      ts.feedback,
      ts.reviewed_at,
      ts.submitted_at
    FROM sessions s
    JOIN session_tasks st 
      ON s.session_id = st.session_id
    JOIN task_submissions ts 
      ON ts.task_id = st.task_id
    JOIN users u 
      ON u.id = ts.learner_id
    WHERE s.session_id = ?
      AND s.tutor_id = ?
    ORDER BY ts.task_id, ts.attempt_no DESC
  `;

  db.query(sql, [sessionId, tutorId], (err, rows) => {
    if (err) {
      console.error("Fetch submissions error:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.json(rows);
  });
});

// TUTOR REVIEW CODING SUBMISSION
app.post("/api/tutor/submission/:submissionId/review", (req, res) => {
  if (!req.session.user || req.session.user.role !== "tutor") {
    return res.status(403).json({ error: "Access denied" });
  }

  const tutorId = req.session.user.id;
  const submissionId = req.params.submissionId;
  const { marks, feedback } = req.body;

  if (marks == null) {
    return res.status(400).json({ error: "Marks are required" });
  }

  const sql = `
    UPDATE task_submissions
    SET marks = ?,
        feedback = ?,
        reviewed_at = NOW(),
        reviewed_by = ?
    WHERE submission_id = ?
  `;

  db.query(
    sql,
    [marks, feedback || null, tutorId, submissionId],
    (err, result) => {
      if (err) {
        console.error("Review update error:", err);
        return res.status(500).json({ error: "Database error" });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Submission not found" });
      }

      res.json({ message: "Submission reviewed successfully" });
    },
  );
});

// LEARNER VIEW CODING RESULTS PER SESSION
app.get("/api/learner/session/:sessionId/results", (req, res) => {
  if (!req.session.user || req.session.user.role !== "learner") {
    return res.status(403).json({ error: "Access denied" });
  }

  const learnerId = req.session.user.id;
  const sessionId = req.params.sessionId;

  const sql = `
    SELECT 
      ts.task_id,
      ts.marks,
      ts.feedback,
      ts.reviewed_at
    FROM sessions s
    JOIN session_tasks st ON s.session_id = st.session_id
    JOIN task_submissions ts ON ts.task_id = st.task_id
    WHERE s.session_id = ?
    AND ts.learner_id = ?
  `;

  db.query(sql, [sessionId, learnerId], (err, rows) => {
    if (err) {
      console.error("Fetch results error:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.json(rows);
  });
});

// TUTOR COMPLETED SESSION HISTORY
app.get("/api/tutor/completed-sessions", (req, res) => {
  if (!req.session.user || req.session.user.role !== "tutor") {
    return res.status(403).json({ error: "Access denied" });
  }

  const tutorId = req.session.user.id;

  const sql = `
    SELECT session_id, title, scheduled_at, completed_at
    FROM sessions
    WHERE tutor_id = ?
    AND status = 'completed'
    ORDER BY completed_at DESC
  `;

  db.query(sql, [tutorId], (err, rows) => {
    if (err) {
      console.error("Fetch completed sessions error:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.json(rows);
  });
});

// tutor create mcq ques
app.post("/api/tutor/mcq/:taskId/add-question", (req, res) => {
  console.log("Received:", req.body);
  if (!req.session.user || req.session.user.role !== "tutor") {
    return res.status(403).json({ error: "Access denied" });
  }

  const taskId = req.params.taskId;
  const { question, marks, options, correct_option } = req.body;

  if (!question || !options || !correct_option) {
    return res.status(400).json({ error: "All fields required" });
  }

  const questionSql = `
    INSERT INTO mcq_questions (task_id, question_text, correct_option, marks)
    VALUES (?, ?, ?, ?)
  `;

  db.query(
    questionSql,
    [taskId, question, correct_option, marks],
    (err, result) => {
      if (err) {
        console.error("Question insert error:", err);
        return res.status(500).json({ error: "Failed to insert question" });
      }

      const questionId = result.insertId;

      const optionSql = `
      INSERT INTO mcq_options (question_id, option_number, option_text)
      VALUES (?, ?, ?)
    `;

      let insertCount = 0;

      options.forEach((opt, index) => {
        db.query(optionSql, [questionId, index + 1, opt], (err2) => {
          if (err2) {
            console.error("Option insert error:", err2);
          }

          insertCount++;

          if (insertCount === options.length) {
            res.json({ message: "Question added successfully" });
          }
        });
      });
    },
  );
});

// GET MCQ QUESTIONS FOR LEARNER
app.get("/api/learner/mcq/:taskId", async (req, res) => {
  if (!req.session.user || req.session.user.role !== "learner") {
    return res.status(403).json({ error: "Access denied" });
  }

  const learnerId = req.session.user.id;
  const taskId = req.params.taskId;
  const connection = await db.promise().getConnection();

  try {
    //  Get task + session info
    const [taskInfo] = await connection.query(
      `
      SELECT 
        st.task_id,
        st.deadline,
        s.session_id,
        s.status AS session_status,
        s.learner_id,
        s.group_id
      FROM session_tasks st
      JOIN sessions s ON st.session_id = s.session_id
      WHERE st.task_id = ?
      `,
      [taskId],
    );

    if (taskInfo.length === 0) {
      return res.status(404).json({ error: "Task not found" });
    }

    const task = taskInfo[0];

    //  Check learner belongs to this session
    let allowed = false;

    if (task.learner_id === learnerId) {
      allowed = true;
    }

    if (task.group_id) {
      const [groupCheck] = await connection.query(
        "SELECT * FROM group_learners WHERE group_id = ? AND learner_id = ?",
        [task.group_id, learnerId],
      );
      if (groupCheck.length > 0) allowed = true;
    }

    if (!allowed) {
      return res.status(403).json({ error: "Not authorized for this task" });
    }

    //  Check session completed
    if (task.session_status !== "completed") {
      return res.status(400).json({
        error: "Session not completed. Quiz locked.",
      });
    }

    //  Check deadline
    if (task.deadline && new Date(task.deadline) < new Date()) {
      return res.status(400).json({
        error: "Quiz deadline expired",
      });
    }

    //  Check attempt limit (max 5)
    const MAX_ATTEMPTS = 5;
    const [attemptCheck] = await connection.query(
      `SELECT COUNT(*) AS total
   FROM mcq_attempts
   WHERE learner_id = ? AND task_id = ?`,
      [learnerId, taskId],
    );

    const attempts = attemptCheck[0].total;

    if (attempts >= MAX_ATTEMPTS) {
      return res.json({
        error: `Maximum ${MAX_ATTEMPTS} attempts reached`,
      });
    }

    // Fetch questions
    const [rows] = await connection.query(
      `
  SELECT 
    q.question_id,
    q.question_text,
    q.marks,
    o.option_id,
    o.option_text
  FROM mcq_questions q
  JOIN mcq_options o 
    ON q.question_id = o.question_id
  WHERE q.task_id = ?
  ORDER BY q.question_id
  `,
      [taskId],
    );

    const questions = {};

    rows.forEach((row) => {
      if (!questions[row.question_id]) {
        questions[row.question_id] = {
          question_id: row.question_id,
          question_text: row.question_text,
          marks: row.marks,
          options: [],
        };
      }

      questions[row.question_id].options.push({
        option_id: row.option_id,
        option_text: row.option_text,
      });
    });

    res.json(Object.values(questions));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  } finally {
    connection.release();
  }
});

// GET TASKS FOR A SESSION (LEARNER)
app.get("/api/learner/session/:sessionId/tasks", async (req, res) => {
  if (!req.session.user || req.session.user.role !== "learner") {
    return res.status(403).json({ error: "Access denied" });
  }

  const learnerId = req.session.user.id;
  const sessionId = req.params.sessionId;
  const connection = await db.promise().getConnection();

  try {
    const [tasks] = await connection.query(
      `
      SELECT 
        st.task_id,
        st.task_type,
        st.title,
        st.deadline,
        s.status AS session_status,
        MAX(ma.score) AS best_score,
        (
          SELECT SUM(marks)
          FROM mcq_questions
          WHERE task_id = st.task_id
        ) AS total_marks,
        COUNT(ma.id) AS attempt_count
      FROM session_tasks st
      JOIN sessions s ON st.session_id = s.session_id
      LEFT JOIN mcq_attempts ma 
        ON ma.task_id = st.task_id 
        AND ma.learner_id = ?
      WHERE st.session_id = ?
      GROUP BY st.task_id
      `,
      [learnerId, sessionId],
    );

    const now = new Date();

    const updatedTasks = tasks.map((task) => {
      let status = "Locked";

      if (task.session_status === "completed") {
        if (task.best_score !== null) {
          const passMarks = task.total_marks * 0.5;
          status = task.best_score >= passMarks ? "Passed" : "Failed";
        } else {
          status = "Not Attempted";
        }

        // Overdue check
        if (
          task.deadline &&
          new Date(task.deadline) < now &&
          status !== "Passed"
        ) {
          status = "Overdue";
        }
      }

      return {
        task_id: task.task_id,
        task_type: task.task_type,
        title: task.title,
        deadline: task.deadline,
        best_score: task.best_score,
        total_marks: task.total_marks,
        attempts: task.attempt_count,
        status,
      };
    });

    res.json(updatedTasks);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  } finally {
    connection.release();
  }
});

// Pending MCQ VISIBLE IN LEARNER DASHBOARD
app.get("/api/learner/dashboard-mcq", async (req, res) => {
  if (!req.session.user || req.session.user.role !== "learner") {
    return res.status(403).json({ error: "Access denied" });
  }

  const learnerId = req.session.user.id;
  const connection = await db.promise().getConnection();

  try {
    await connection.query(`
      UPDATE sessions
      SET status = 'completed',
          completed_at = NOW()
      WHERE status = 'scheduled'
      AND DATE_ADD(scheduled_at, INTERVAL 1 HOUR) < NOW()
    `);

    // Fetch MCQ tasks
    const [tasks] = await connection.query(
      `
      SELECT 
        st.task_id,
        st.title,
        st.deadline,
        MAX(ma.score) AS best_score,
        (
          SELECT SUM(marks)
          FROM mcq_questions
          WHERE task_id = st.task_id
        ) AS total_marks,
        COUNT(ma.attempt_id) AS attempt_count
      FROM session_tasks st
      JOIN sessions s ON st.session_id = s.session_id
      LEFT JOIN mcq_attempts ma 
        ON ma.task_id = st.task_id 
        AND ma.learner_id = ?
      WHERE 
        st.task_type = 'mcq'
        AND s.status = 'completed'
        AND (
            s.learner_id = ?
            OR EXISTS (
                SELECT 1
                FROM group_learners gl2
                WHERE gl2.group_id = s.group_id
                AND gl2.learner_id = ?
            )
        )
      GROUP BY st.task_id
      ORDER BY st.deadline ASC
      `,
      [learnerId, learnerId, learnerId],
    );

    const now = new Date();

    const MAX_ATTEMPTS = 5;

    const result = tasks.map((task) => {
      const attempts = task.attempt_count || 0;
      const bestScore = task.best_score || 0;
      const totalMarks = task.total_marks || 0;

      const passingMark = totalMarks * 0.5;
      const remaining_attempts = Math.max(0, MAX_ATTEMPTS - attempts);

      let status = "Not Attempted";

      if (attempts > 0) {
        status = bestScore >= passingMark ? "Passed" : "Failed";
      }

      if (
        task.deadline &&
        new Date(task.deadline) < now &&
        status !== "Passed" &&
        remaining_attempts > 0
      ) {
        status = "Overdue";
      }

      if (remaining_attempts === 0) {
        status = status === "Passed" ? "Passed" : "Max Attempts Reached";
      }

      return {
        task_id: task.task_id,
        title: task.title,
        deadline: task.deadline,
        best_score: bestScore,
        attempts,
        remaining_attempts,
        max_attempts: MAX_ATTEMPTS,
        status,
      };
    });

    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  } finally {
    connection.release();
  }
});

// Get all users (for adding learners to groups)
app.get("/api/users", (req, res) => {
  const sql = "SELECT id, name, role FROM users";

  db.query(sql, (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Database error" });
    }

    res.json(results);
  });
});

// TUTOR CAN VIEW OVERALL LEARNER PROGRESS
app.get("/api/tutor/overall-progress", async (req, res) => {
  if (!req.session.user || req.session.user.role !== "tutor") {
    return res.status(403).json({ error: "Access denied" });
  }

  const tutorId = req.session.user.id;
  const connection = await db.promise().getConnection();

  try {
    const [rows] = await connection.query(
      `
      SELECT 
        u.id AS learner_id,
        u.name AS learner_name,

        COUNT(DISTINCT s.session_id) AS total_sessions,

        COUNT(DISTINCT CASE 
          WHEN sa.status = 'present' THEN sa.session_id 
        END) AS attended_sessions,

        COUNT(DISTINCT st.task_id) AS total_tasks,

        COUNT(DISTINCT CASE
          WHEN (
            EXISTS (
              SELECT 1 FROM (
                SELECT task_id, MAX(score) AS best_score
                FROM mcq_attempts
                WHERE learner_id = u.id
                GROUP BY task_id
              ) best
              WHERE best.task_id = st.task_id
              AND best.best_score >= (
                SELECT SUM(marks) * 0.5
                FROM mcq_questions
                WHERE task_id = st.task_id
              )
            )
            OR
            EXISTS (
              SELECT 1 FROM (
                SELECT task_id, MAX(marks) AS best_marks
                FROM task_submissions
                WHERE learner_id = u.id
                GROUP BY task_id
              ) coding_best
              WHERE coding_best.task_id = st.task_id
              AND coding_best.best_marks >= 50
            )
          )
          THEN st.task_id
        END) AS completed_tasks

      FROM sessions s
      LEFT JOIN group_learners gl ON s.group_id = gl.group_id
      JOIN users u ON (s.learner_id = u.id OR gl.learner_id = u.id)
      LEFT JOIN session_attendance sa 
        ON sa.session_id = s.session_id 
        AND sa.learner_id = u.id
      LEFT JOIN session_tasks st ON st.session_id = s.session_id

      WHERE s.tutor_id = ?

      GROUP BY u.id
      HAVING total_sessions > 0
    `,
      [tutorId],
    );

    const result = rows.map((r) => {
      const attendance =
        r.total_sessions > 0
          ? Math.round((r.attended_sessions / r.total_sessions) * 100)
          : 0;

      const tasks =
        r.total_tasks > 0
          ? Math.round((r.completed_tasks / r.total_tasks) * 100)
          : 0;

      const overall = Math.round((attendance + tasks) / 2);

      return {
        learner_id: r.learner_id,
        learner_name: r.learner_name,
        attendance_percent: attendance,
        task_percent: tasks,
        overall_percent: overall,
      };
    });

    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  } finally {
    connection.release();
  }
});

// admin can view learners
app.get("/api/admin/learners", (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Access denied" });
  }

  const sql = `
    SELECT 
      u.id,
      u.name,
      u.email,
      COUNT(sa.session_id) AS sessions_attended
    FROM users u
    LEFT JOIN session_attendance sa 
      ON u.id = sa.learner_id 
      AND sa.status = 'present'
    WHERE u.role = 'learner'
    GROUP BY u.id
  `;

  db.query(sql, (err, results) => {
    if (err) return res.status(500).json({ error: err });
    res.json(results);
  });
});

// ADMIN CAN REMOVE LEARNERS
app.put("/api/admin/suspend-learner/:id", (req, res) => {
  const id = req.params.id;

  db.query(
    "UPDATE users SET status = 'suspended' WHERE id = ?",
    [id],
    (err) => {
      if (err) return res.status(500).json({ error: err });
      res.json({ message: "Learner suspended" });
    },
  );
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
