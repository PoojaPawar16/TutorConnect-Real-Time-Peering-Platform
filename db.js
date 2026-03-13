const mysql = require("mysql2");

const db = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "skill@123",
  database: "tutorconnect",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

console.log("✅ MySQL Pool Created");

module.exports = db;
