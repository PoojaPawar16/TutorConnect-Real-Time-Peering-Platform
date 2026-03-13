USE tutorconnect;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role ENUM('learner', 'tutor', 'admin') DEFAULT 'learner',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

use	 tutorconnect;
describe users;

select	* from users;

alter table users modify role enum('learner' , 'tutor', 'admin'); 


CREATE table notifications(
	notification_id int auto_increment primary key,
    user_id int,
    message varchar(255) not null,
    created_at timestamp default current_timestamp,
    foreign key(user_id) references users(id)
)
   
CREATE TABLE learner_mentor (
    id INT AUTO_INCREMENT PRIMARY KEY,
    learner_id INT NOT NULL,
    mentor_id INT NOT NULL,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (learner_id) REFERENCES users(id),
    FOREIGN KEY (mentor_id) REFERENCES users(id)
);

use tutorconnect;
select * from users;
use tutorconnect;

INSERT INTO users (name, email, password, role) 
VALUES ('Admin', 'tutorconnecta@gmail.com', 'admin123', 'admin');

CREATE TABLE tutor_profiles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tutor_id INT NOT NULL,
  bio TEXT,
  skills VARCHAR(255),
  subjects VARCHAR(255),
  profile_pic VARCHAR(255),
  availability VARCHAR(255),
  status ENUM('pending','approved','rejected') DEFAULT 'pending',
  FOREIGN KEY (tutor_id) REFERENCES users(id)
);

ALTER TABLE tutor_profiles
ADD COLUMN certifications VARCHAR(255);

drop TABLE tutor_profiles;

CREATE TABLE tutor_profiles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tutor_id INT NOT NULL,
  bio TEXT,
  skills VARCHAR(255),
  subjects VARCHAR(255),
  profile_pic VARCHAR(255),
  availability VARCHAR(255),
  certifications TEXT,   
  status ENUM('pending','approved','rejected') DEFAULT 'pending',
  FOREIGN KEY (tutor_id) REFERENCES users(id)
);

select * from tutor_profiles;

show tables;

select * from notifications;
show tables;
DELETE FROM users WHERE email = 'admin@tutorconnect.com';
select * from users;
delete from tutor_profiles where tutor_id = 3;
SELECT * FROM tutor_profiles WHERE status = 'pending';
ALTER TABLE notifications
  ADD COLUMN status ENUM('pending','unread','read','approved','rejected') NOT NULL DEFAULT 'pending';

CREATE TABLE learner_tutor (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tutor_id INT NOT NULL,
  learner_id INT NOT NULL,
  FOREIGN KEY (tutor_id) REFERENCES users(id),
  FOREIGN KEY (learner_id) REFERENCES users(id)
);

CREATE TABLE session_notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT,
  learner_id INT,
  message VARCHAR(255),
  status ENUM('unread', 'read') DEFAULT 'unread',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id),
  FOREIGN KEY (learner_id) REFERENCES users(id)
);

CREATE TABLE session_attendance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  learner_id INT NOT NULL,
  attended ENUM('yes', 'no') DEFAULT 'no',
  FOREIGN KEY (session_id) REFERENCES sessions(session_id),
  FOREIGN KEY (learner_id) REFERENCES users(id)
);

select * from session_attendance; 

CREATE TABLE session_tasks (
  task_id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  task_description TEXT,
  deadline DATETIME,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

CREATE TABLE task_submissions (
  submission_id INT AUTO_INCREMENT PRIMARY KEY,
  task_id INT NOT NULL,
  learner_id INT NOT NULL,
  submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  status ENUM('submitted', 'pending', 'late') DEFAULT 'pending',
  FOREIGN KEY (task_id) REFERENCES session_tasks(task_id),
  FOREIGN KEY (learner_id) REFERENCES users(id)
);

ALTER TABLE sessions
ADD COLUMN meeting_link VARCHAR(255) AFTER scheduled_at,
ADD COLUMN recording_link VARCHAR(255) DEFAULT NULL AFTER meeting_link,
ADD COLUMN session_type ENUM('live', 'recorded') DEFAULT 'live' AFTER recording_link,
ADD COLUMN ended_at DATETIME DEFAULT NULL AFTER scheduled_at;

select * from sessions;

ALTER TABLE session_tasks
ADD COLUMN status ENUM('assigned', 'completed') DEFAULT 'assigned';

ALTER TABLE session_attendance
ADD COLUMN joined_at DATETIME DEFAULT NULL,
ADD COLUMN left_at DATETIME DEFAULT NULL,
ADD COLUMN attendance_status ENUM('present','absent') DEFAULT 'absent';

ALTER TABLE session_notifications
ADD COLUMN sender_role ENUM('tutor','system','admin') DEFAULT 'system';

ALTER TABLE sessions DROP COLUMN learner_id,
drop table sessions_task;
drop table session_attendance;
drop table session_notifications;
drop table sessions;

CREATE TABLE sessions (
  session_id INT AUTO_INCREMENT PRIMARY KEY,
  tutor_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  scheduled_at DATETIME NOT NULL,
  meeting_link VARCHAR(255),
  recording_link VARCHAR(255),
  status ENUM('scheduled', 'completed', 'cancelled') DEFAULT 'scheduled',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tutor_id) REFERENCES users(id) ON DELETE CASCADE
);
SHOW CREATE TABLE sessions;

ALTER TABLE sessions DROP FOREIGN KEY sessions_ibfk_1;
ALTER TABLE sessions DROP FOREIGN KEY sessions_ibfk_2;
drop table session_tasks;
drop table task_submissions;

CREATE TABLE session_attendance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  learner_id INT NOT NULL,
  attended ENUM('yes', 'no') DEFAULT 'no',
  FOREIGN KEY (session_id) REFERENCES sessions(session_id),
  FOREIGN KEY (learner_id) REFERENCES users(id)
);
use tutorconnect;
select * from users;
select * from tutor_profiles;
show tables;
select * from notifications;
select * from sessions;

ALTER TABLE sessions
ADD COLUMN meet_link VARCHAR(255) NULL AFTER status;
ALTER TABLE sessions
DROP COLUMN meet_link;
use tutorconnect;
ALTER TABLE sessions
ADD COLUMN learner_id INT NULL AFTER tutor_id,
ADD FOREIGN KEY (learner_id) REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE learner_profiles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  learner_id INT NOT NULL,
  bio TEXT,
  skills VARCHAR(255),
  goals TEXT,
  profile_pic VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (learner_id) REFERENCES users(id) ON DELETE CASCADE
);
select * from learner_profiles;

CREATE TABLE courses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tutor_id INT,
  title VARCHAR(100),
  description TEXT,
  subject VARCHAR(100),
  level ENUM('beginner', 'intermediate', 'advanced'),
  price DECIMAL(10,2),
  FOREIGN KEY (tutor_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE enrollments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  learner_id INT NOT NULL,
  tutor_id INT NOT NULL,
  course_subject VARCHAR(255),
  enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (learner_id) REFERENCES users(id),
  FOREIGN KEY (tutor_id) REFERENCES users(id)
);

select * from enrollments;
ALTER TABLE enrollments
  ADD COLUMN status ENUM('pending','approved','active','cancelled') DEFAULT 'pending';

CREATE TABLE demo_videos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tutor_id INT,
  subject VARCHAR(100),
  video_path VARCHAR(255),
  FOREIGN KEY (tutor_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE  activity_log(
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_type` ENUM('admin','tutor','learner'),
  `user_id` INT,
  `action` VARCHAR(255),
  `details` TEXT,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE group_tutors(
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `group_id` INT NOT NULL,
  `tutor_id` INT NOT NULL,
  `role` ENUM('primary','co-tutor') DEFAULT 'primary',
  `assigned_by` INT,
  `assigned_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`group_id`) REFERENCES `groups`(`group_id`) ON DELETE CASCADE
);

show tables;

CREATE TABLE tutor_requests (
  request_id INT AUTO_INCREMENT PRIMARY KEY,
  learner_id INT NOT NULL,
  tutor_id INT NULL,
  subject VARCHAR(150),
  message TEXT,
  status ENUM('pending','accepted','rejected','assigned') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL
);

show tables;
select * from users;
select * from tutor_profiles;

SELECT u.id, u.name, u.role, t.subjects, t.status
FROM users u
JOIN tutor_profiles t ON u.id = t.tutor_id;
use tutorconnect;

SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50;
SELECT * FROM tutor_requests ORDER BY created_at DESC LIMIT 50;

select * from tutor_requests;

CREATE TABLE IF NOT EXISTS admin_activity (
  id INT AUTO_INCREMENT PRIMARY KEY,
  action VARCHAR(255),
  details TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

select * from notifications;
select * from tutor_requests;

select * from learner_profiles;
select * from learner_tutor;
select * from sessions;

ALTER TABLE sessions 
ADD completed_at DATETIME NULL;

SET SQL_SAFE_UPDATES = 0;
UPDATE sessions
SET status = 'completed',
    completed_at = scheduled_at
WHERE status = 'scheduled'
AND scheduled_at < NOW();

SET SQL_SAFE_UPDATES = 1;

SELECT *
FROM sessions
WHERE status = 'scheduled'
OR completed_at >= NOW() - INTERVAL 1 DAY
ORDER BY scheduled_at DESC;

select * from users;

select * from enrollments;	

SELECT id, learner_id, tutor_id, status
FROM enrollments;

select * from tutor_requests;

select * from tutor_profiles;
show tables;

CREATE TABLE class_groups (
  group_id INT AUTO_INCREMENT PRIMARY KEY,
  group_name VARCHAR(150) NOT NULL,
  subject VARCHAR(150) NOT NULL,
  description TEXT,
  created_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE group_tutors (
  id INT AUTO_INCREMENT PRIMARY KEY,
  group_id INT NOT NULL,
  tutor_id INT NOT NULL,
  role ENUM('primary','co-tutor') DEFAULT 'primary',
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY unique_tutor_group (group_id, tutor_id),

  FOREIGN KEY (group_id) REFERENCES class_groups(group_id) ON DELETE CASCADE,
  FOREIGN KEY (tutor_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE group_learners (
  id INT AUTO_INCREMENT PRIMARY KEY,
  group_id INT NOT NULL,
  learner_id INT NOT NULL,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY unique_learner_group (group_id, learner_id),

  FOREIGN KEY (group_id) REFERENCES class_groups(group_id) ON DELETE CASCADE,
  FOREIGN KEY (learner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

select * from group_learners;
show tables;

CREATE TABLE tutor_ratings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tutor_id INT,
    learner_id INT,
    rating INT CHECK (rating BETWEEN 1 AND 5),
    review TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

select * from sessions;
select * from users;

ALTER TABLE sessions 
ADD COLUMN group_id INT AFTER tutor_id;

ALTER TABLE sessions
ADD COLUMN session_type ENUM('group','private') DEFAULT 'group';

ALTER TABLE tutor_profiles 
MODIFY status ENUM('pending','approved','rejected','suspended') 
DEFAULT 'pending';

select * from tutor_requests;
select * from users;
select * from tutor_profiles;

DELETE FROM group_learners WHERE learner_id = 4;

INSERT INTO group_learners (group_id, learner_id)
VALUES (3, 10);

CREATE TABLE doubt_requests (
  request_id INT AUTO_INCREMENT PRIMARY KEY,
  learner_id INT NOT NULL,
  tutor_id INT NOT NULL,
  subject VARCHAR(255),
  message TEXT,
  preferred_time DATETIME,
  status ENUM('pending','approved','rejected') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

select * from doubt_requests;
select * from sessions;
select * from learner_profiles;
CREATE TABLE session_attendance (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_id INT NOT NULL,
    learner_id INT NOT NULL,
    tutor_id INT NOT NULL,
    status ENUM('present','absent','late') DEFAULT 'absent',
    marked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(session_id, learner_id),

    FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
    FOREIGN KEY (learner_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (tutor_id) REFERENCES users(id) ON DELETE CASCADE
);

SELECT session_id, title, session_type, learner_id, group_id, scheduled_at, status
FROM sessions
WHERE title LIKE '%Machine Learning%';

SELECT * FROM group_learners WHERE group_id = 3;

select * from session_attendance;

CREATE TABLE session_tasks (
  task_id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  task_description TEXT,
  deadline DATETIME,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE task_submissions (
  submission_id INT AUTO_INCREMENT PRIMARY KEY,
  task_id INT NOT NULL,
  learner_id INT NOT NULL,
  status ENUM('submitted','pending') DEFAULT 'submitted',
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_submission (task_id, learner_id)
);

ALTER TABLE session_tasks
ADD COLUMN task_type ENUM('mcq','code') NOT NULL AFTER session_id;

select * from session_tasks;

CREATE TABLE mcq_questions (
  question_id INT AUTO_INCREMENT PRIMARY KEY,
  task_id INT,
  question_text TEXT,
  correct_option INT,
  FOREIGN KEY (task_id) REFERENCES session_tasks(task_id)
);

CREATE TABLE mcq_options (
  option_id INT AUTO_INCREMENT PRIMARY KEY,
  question_id INT,
  option_number INT,
  option_text TEXT,
  FOREIGN KEY (question_id) REFERENCES mcq_questions(question_id)
);

CREATE TABLE mcq_attempts (
  attempt_id INT AUTO_INCREMENT PRIMARY KEY,
  task_id INT,
  learner_id INT,
  score INT,
  total_questions INT,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE mcq_answers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  attempt_id INT,
  question_id INT,
  selected_option INT
);

CREATE TABLE coding_problems (
  problem_id INT AUTO_INCREMENT PRIMARY KEY,
  task_id INT,
  problem_statement TEXT,
  expected_output TEXT,
  FOREIGN KEY (task_id) REFERENCES session_tasks(task_id)
);

CREATE TABLE code_submissions (
  submission_id INT AUTO_INCREMENT PRIMARY KEY,
  task_id INT,
  learner_id INT,
  code TEXT,
  marks INT DEFAULT NULL,
  feedback TEXT,
  status ENUM('submitted','reviewed') DEFAULT 'submitted',
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

select * from task_submissions;
ALTER TABLE task_submissions
ADD COLUMN marks INT DEFAULT NULL,
ADD COLUMN feedback TEXT,
ADD COLUMN reviewed_at DATETIME,
ADD COLUMN reviewed_by INT;

ALTER TABLE task_submissions
DROP INDEX unique_submission;
ALTER TABLE task_submissions
ADD COLUMN attempt_no INT NOT NULL DEFAULT 1;
SHOW CREATE TABLE task_submissions;

DESCRIBE session_tasks;
select * from sessions;
select * from mcq_questions;
select * from session_tasks;
ALTER TABLE session_tasks
CHANGE task_description title VARCHAR(255);

ALTER TABLE mcq_questions
ADD COLUMN marks INT DEFAULT 1;

select * from sessions;
SELECT session_id, status FROM sessions;
SELECT task_id, task_type FROM session_tasks;
SELECT * FROM sessions WHERE learner_id = 10;
SELECT learner_id FROM sessions;
select * from group_learners;
SELECT * FROM group_learners WHERE learner_id = 10;

SELECT 
  s.session_id,
  s.status,
  st.task_id,
  st.task_type
FROM session_tasks st
JOIN sessions s ON st.session_id = s.session_id;

SELECT * FROM mcq_questions WHERE task_id = 5;

SELECT session_id, status 
FROM sessions 
WHERE session_id = (
    SELECT session_id 
    FROM session_tasks 
    WHERE task_id = 5
)
