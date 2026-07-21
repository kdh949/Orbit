import React from "react";
import ReactDOM from "react-dom/client";
import "../../../../styles/tokens.css";
import "../../../../styles/foundations.css";
import { RealtimeWhisperSpikeApp } from "./RealtimeWhisperSpikeApp";

const root = document.getElementById("root");
if (!root) {
  throw new Error("GPT-Realtime-Whisper spike root element was not found.");
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <RealtimeWhisperSpikeApp />
  </React.StrictMode>
);
