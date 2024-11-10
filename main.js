const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const { rewards, questionCount, lifelines, noRewardWhenLost } = require("./config");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let questions = [];
let gameStarted = false;
let currentQuestionIndex = -1;
let selectedAnswer = null;
let lost = false;
let won = false;
let lifelinesUsed = { "50:50": false, Audience: false, PhoneAFriend: false };
let mileStones = [4, 8, 12];

// Pomocnicza funkcja do opóźniania
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

// Resetowanie stanu gry
function resetGame() {
  lost = false;
  won = false;
  gameStarted = false;
  currentQuestionIndex = -1;

  reward = 0;
  selectedAnswer = null;
  lifelinesUsed = { "50:50": false, Audience: false, PhoneAFriend: false };
}

// Wysyłanie aktualnego statusu gry
function sendStatus() {
  broadcast({
    type: "STATUS",
    gameStarted,
    lost,
    won,
    currentQuestionIndex: currentQuestionIndex + 1,
    selectedAnswer,
    rewards,
    currentQuestion: questions[currentQuestionIndex],
    reward: rewards[currentQuestionIndex],
    allQuestionsLength: getAllQuestions().length,
    gameQuestionsLength: Math.min(getAllQuestions().length, questionCount),
    lifelinesUsed,
  });
}

// Endpoint do uzyskania statusu
app.get("/status", (req, res) => {
  sendStatus();
  res.json({ message: "Wysłano status." });
});

app.post("/end-game", (req, res) => {
  if (!gameStarted) return res.status(400).json({ message: "Gra nie jest rozpoczęta." });
  resetGame();
  questions = [];
  broadcast({ type: "END_GAME" });
  res.json({ message: "Gra zakończona." });
});

// Endpoint do rozpoczęcia gry
app.post("/start", (req, res) => {
  if (!questions.length) loadQuestions();
  if (questions.length === 0) return res.status(500).json({ message: "Brak pytań." });

  resetGame();
  gameStarted = true;
  currentQuestionIndex = 0;

  broadcast({ type: "START" });
  sendStatus();
  res.json({ message: "Gra rozpoczęta." });
});

// Endpoint do uzyskania aktualnego pytania
app.get("/current-question", (req, res) => {
  if (!gameStarted || currentQuestionIndex < 0)
    return res.status(400).json({ message: "Gra nie jest rozpoczęta." });

  sendStatus();
  res.json({ message: "Wysłano aktualne pytanie" });
});

// Endpoint do użycia koła ratunkowego
app.post("/use-lifeline/:lifeline", (req, res) => {
  const lifeline = req.params.lifeline;
  if (!lifelines.includes(lifeline) || lifelinesUsed[lifeline]) {
    return res.status(400).json({ message: "Koło ratunkowe już zostało użyte lub jest nieprawidłowe." });
  }

  lifelinesUsed[lifeline] = true;

  let lifelineResult;
  switch (lifeline) {
    case "50:50":
      // Wybieramy dwie opcje, w tym poprawną odpowiedź
      const correctIndex = questions[currentQuestionIndex].correctAnswer;
      const incorrectOptions = questions[currentQuestionIndex].options
        .map((_, i) => i)
        .filter((i) => i !== correctIndex);
      const randomIncorrect = incorrectOptions[Math.floor(Math.random() * incorrectOptions.length)];
      lifelineResult = [correctIndex, randomIncorrect];
      break;
    case "Audience":
      // Symulujemy wyniki głosowania
      lifelineResult = Array.from({ length: 4 }, () => Math.random() * 100);
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
app.post("/select-answer/:answerIndex", async (req, res) => {
  if (!gameStarted || currentQuestionIndex < 0)
    return res.status(400).json({ message: "Gra nie jest rozpoczęta." });

  const correctAnswer = questions[currentQuestionIndex].correctAnswer;
  selectedAnswer = req.params.answerIndex;

  broadcast({ type: "ANSWER_SELECTED", selectedAnswer });

  await delay(5000);
  broadcast({ type: "CORRECT_ANSWER" });

  sendStatus();
  await delay(5000);

  if (selectedAnswer != correctAnswer) {
    lost = true;
    console.log("WRONG ANSWER");
  } else {
    console.log("CORRECT ANSWER");
    if (currentQuestionIndex + 1 >= questions.length) {
      won = true;
    } else {
      currentQuestionIndex++;
      selectedAnswer = null;
      broadcast({ type: "NEXT_QUESTION" });
    }
  }

  sendStatus();

  if (mileStones.includes(currentQuestionIndex + 1)) {
    broadcast({ type: "SHOW_LADDER" });
    await delay(10000);
    broadcast({ type: "HIDE_LADDER" });
  }

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

// Uruchomienie serwera
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Serwer działa na porcie ${PORT}`);
});
