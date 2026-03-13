const express = require("express");
const router = express.Router();
const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

router.post("/chat", async (req, res) => {
  try {
    const message = req.body.message;

    const completion = await client.chat.completions.create({
      model: "meta-llama/llama-3.1-8b-instruct",

      temperature: 0.3,
      max_tokens: 400,

      messages: [
        {
          role: "system",
          content: `
You are an AI tutor for a learning platform called TutorConnect.

Follow these rules:

1. For THEORY questions (example: "What is SCADA", "Explain AI", "Define Machine Learning")

Answer in this format:

Full Form (if any)

Definition:
Explain the concept clearly in 3–5 lines.

Explanation:
Give a detailed explanation so students understand the concept.

Example:
Give a real-world example or application.

2. If the user asks for programming or code (example: "write code", "C program", "implement algorithm")

Then answer in this format:

Concept:
Explain what the program does.

Logic:
Explain the steps of the algorithm.

Code:
Provide the program.

3. Do NOT provide code unless the user asks for code.

4. Use simple language so students can understand easily.

5. Keep answers structured with spacing.
`,
        },

        {
          role: "user",
          content: message,
        },
      ],
    });

    const reply = completion.choices[0].message.content;

    res.json({
      reply: reply,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "AI request failed",
    });
  }
});

router.post("/quiz/generate", async (req, res) => {
  try {
    const { topic, count, taskId } = req.body;

    const completion = await client.chat.completions.create({
      model: "meta-llama/llama-3.1-8b-instruct",
      temperature: 0.4,
      max_tokens: 900,
      messages: [
        {
          role: "system",
          content: `
Generate MCQ questions.

Rules:
- Each question must have 4 options A B C D
- Provide correct answer
- Format exactly like:

Question:
<question>

A) option
B) option
C) option
D) option

Correct Answer: <A/B/C/D>
`,
        },
        {
          role: "user",
          content: `Generate ${count} MCQ questions about ${topic}`,
        },
      ],
    });

    const quizText = completion.choices[0].message.content;

    console.log("\nAI GENERATED QUIZ:\n", quizText);

    const questions = quizText
      .split("Question:")
      .filter((q) => q.trim() !== "");

    for (const q of questions) {
      const lines = q
        .trim()
        .split("\n")
        .map((l) => l.trim());

      const questionText = lines[0];

      const optionA = lines[1].replace("A)", "").trim();
      const optionB = lines[2].replace("B)", "").trim();
      const optionC = lines[3].replace("C)", "").trim();
      const optionD = lines[4].replace("D)", "").trim();

      const correctLetter = lines[5].split(":")[1].trim();

      const optionMap = { A: 1, B: 2, C: 3, D: 4 };
      const correctOption = optionMap[correctLetter];

      // Insert question
      const [questionResult] = await db.promise().query(
        `INSERT INTO mcq_questions (task_id, question_text, correct_option, marks)
         VALUES (?, ?, ?, 1)`,
        [taskId, questionText, correctOption],
      );

      const questionId = questionResult.insertId;

      // Insert options
      const options = [optionA, optionB, optionC, optionD];

      for (let i = 0; i < options.length; i++) {
        await db.promise().query(
          `INSERT INTO mcq_options (question_id, option_number, option_text)
           VALUES (?, ?, ?)`,
          [questionId, i + 1, options[i]],
        );
      }
    }

    res.json({
      message: "Quiz generated and saved successfully",
    });
  } catch (error) {
    console.error("AI quiz error:", error);

    res.status(500).json({
      error: "Quiz generation failed",
    });
  }
});

module.exports = router;
