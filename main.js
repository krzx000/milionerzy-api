const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const { rewards, questionCount, lifelines } = require("./config");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let questions = [];
let gameStarted = false;
let currentQuestionIndex = -1;
let selectedAnswer = null;
let lost = false;
let lifelinesUsed = {
  "50:50": false,
  Audience: false,
  PhoneAFriend: false,
};

// Wczytanie pytań
function loadQuestions() {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "questions.json"), "utf-8"));
  questions = data.length > questionCount ? shuffleArray(data).slice(0, questionCount) : data;
}

function getAllQuestions() {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "questions.json"), "utf-8"));
  return data;
}

// Pomocnicza funkcja do losowego tasowania
function shuffleArray(array) {
  return array.sort(() => Math.random() - 0.5);
}

function sendStatus() {
  broadcast({
    type: "STATUS",
    gameStarted,
    lost,
    currentQuestionIndex,
    selectedAnswer,
    reward: rewards[currentQuestionIndex],
    allQuestionsLength: getAllQuestions().length,
    gameQuestionsLength: getAllQuestions().length > questionCount ? questionCount : getAllQuestions().length,
    lifelinesUsed,
  });
}

app.get("/status", (req, res) => {
  sendStatus();

  res.json({ message: "Wysłano status." });
});

// Start gry
app.post("/start", (req, res) => {
  if (!questions.length) loadQuestions();
  if (questions.length === 0) return res.status(500).json({ message: "Brak pytań." });
  lost = false;
  gameStarted = true;
  currentQuestionIndex = 0;
  selectedAnswer = null;
  lifelinesUsed = { "50:50": false, Audience: false, PhoneAFriend: false }; // Resetowanie kół

  broadcast({ type: "START" });
  sendStatus();

  res.json({ message: "Gra rozpoczęta." });
});

// Pobierz aktualne pytanie
app.get("/current-question", (req, res) => {
  if (!gameStarted || currentQuestionIndex < 0)
    return res.status(400).json({ message: "Gra nie jest rozpoczęta." });

  sendStatus();

  res.json({ message: "Wysłano aktualne pytanie" });
});

// Użycie koła ratunkowego
app.post("/use-lifeline/:lifeline", (req, res) => {
  const lifeline = req.params.lifeline;
  if (!lifelines.includes(lifeline) || lifelinesUsed[lifeline]) {
    return res.status(400).json({ message: "Koło ratunkowe już zostało użyte lub jest nieprawidłowe." });
  }

  lifelinesUsed[lifeline] = true;

  let lifelineResult;
  switch (lifeline) {
    case "50:50":
      // Wybieramy dwie losowe opcje, w tym poprawną odpowiedź
      const correctIndex = questions[currentQuestionIndex].correctAnswer;
      const incorrectOptions = questions[currentQuestionIndex].options
        .map((_, i) => i)
        .filter((i) => i !== correctIndex);
      const randomIncorrect = incorrectOptions[Math.floor(Math.random() * incorrectOptions.length)];
      lifelineResult = [correctIndex, randomIncorrect];
      break;
    case "Audience":
      // Symulujemy wyniki głosowania
      lifelineResult = [Math.random() * 100, Math.random() * 100, Math.random() * 100, Math.random() * 100];
      break;
    case "PhoneAFriend":
      // Losujemy odpowiedź jako podpowiedź
      lifelineResult = questions[currentQuestionIndex].correctAnswer;
      break;
  }

  // Wysłanie aktualizacji do gracza i prowadzącego
  broadcast({ type: "LIFELINE_USED", lifeline, result: lifelineResult });
  res.json({ message: `${lifeline} użyte.`, result: lifelineResult });
});

// Wybór odpowiedzi przez prowadzącego
app.post("/select-answer/:answerIndex", (req, res) => {
  if (!gameStarted || currentQuestionIndex < 0)
    return res.status(400).json({ message: "Gra nie jest rozpoczęta." });

  selectedAnswer = req.params.answerIndex;
  broadcast({ type: "ANSWER_SELECTED", selectedAnswer: selectedAnswer });

  setTimeout(() => {
    const correctAnswer = questions[currentQuestionIndex].correctAnswer;
    broadcast({ type: "CORRECT_ANSWER", correctAnswer });

    setTimeout(() => {
      if (selectedAnswer != correctAnswer) {
        lost = true;
        gameStarted = false;
        currentQuestionIndex = -1;
        selectedAnswer = null;
        lifelinesUsed = { "50:50": false, Audience: false, PhoneAFriend: false };

        broadcast({ type: "WRONG_ANSWER" });
      }

      if (currentQuestionIndex < questions.length - 1) {
        currentQuestionIndex++;
        selectedAnswer = null;
      } else {
        lost = false;
        gameStarted = false;
        currentQuestionIndex = -1;
        selectedAnswer = null;
        lifelinesUsed = { "50:50": false, Audience: false, PhoneAFriend: false };
      }
      sendStatus();
    }, 5000);
  }, 5000);

  res.json({ message: "Odpowiedź zatwierdzona." });
});

// Funkcja do wysyłania danych do wszystkich klientów
function broadcast(data) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// Połączenia WebSocket
wss.on("connection", (ws) => {
  if (gameStarted && currentQuestionIndex >= 0) {
    const question = questions[currentQuestionIndex];
    ws.send(
      JSON.stringify({
        type: "NEXT_QUESTION",
        questionNumber: currentQuestionIndex + 1,
        question: question.question,
        options: question.options,
        reward: rewards[currentQuestionIndex],
        lifelinesUsed,
      })
    );
  }
});

// Uruchomienie serwera
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Serwer działa na porcie ${PORT}`);
});
