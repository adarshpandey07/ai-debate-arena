"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "next/navigation";

interface DebateMessage {
  side: "for" | "against";
  content: string;
  round: number;
}

interface Room {
  id: string;
  topic: string;
  messages: DebateMessage[];
  status: "debating" | "voting" | "results";
  votes: { for: number; against: number };
  currentRound: number;
  activeSide: "for" | "against" | null;
}

let ttsActive = true;
let voiceFor: SpeechSynthesisVoice | null = null;
let voiceAgainst: SpeechSynthesisVoice | null = null;
let voicesLoaded = false;

function loadVoices() {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return;

  voiceFor =
    voices.find((v) => v.name.includes("Daniel")) ||
    voices.find((v) => v.name.includes("Aaron")) ||
    voices.find((v) => v.lang.startsWith("en") && v.name.toLowerCase().includes("male")) ||
    voices.find((v) => v.lang.startsWith("en")) ||
    voices[0];

  voiceAgainst =
    voices.find((v) => v.name.includes("Samantha")) ||
    voices.find((v) => v.name.includes("Karen")) ||
    voices.find((v) => v.name.includes("Fiona")) ||
    voices.find((v) => v.lang.startsWith("en") && v !== voiceFor) ||
    voices[1] ||
    voices[0];

  voicesLoaded = true;
}

function speakText(text: string, side: "for" | "against"): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.speechSynthesis || !ttsActive) {
      resolve();
      return;
    }

    window.speechSynthesis.cancel();
    if (!voicesLoaded) loadVoices();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = side === "for" ? voiceFor : voiceAgainst;
    utterance.rate = 1.1;
    utterance.pitch = side === "for" ? 0.85 : 1.15;
    utterance.volume = 1;

    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();

    setTimeout(() => {
      if (!ttsActive) { resolve(); return; }
      window.speechSynthesis.speak(utterance);
    }, 150);
  });
}

function stopSpeaking() {
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

export default function WatchPage() {
  const params = useParams();
  const roomId = params.id as string;
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState("");
  const [hasVoted, setHasVoted] = useState(false);
  const [voterId] = useState(() => Math.random().toString(36).substring(2, 10));
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const debateRef = useRef<HTMLDivElement>(null);
  const spokenCountRef = useRef(0);

  // Load and cache voices on mount
  useEffect(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      loadVoices();
      window.speechSynthesis.onvoiceschanged = () => loadVoices();
    }
  }, []);

  const fetchRoom = useCallback(async () => {
    try {
      const res = await fetch(`/api/rooms?id=${roomId}`);
      if (!res.ok) {
        setError("Room not found. Check the code and try again.");
        return;
      }
      const data = await res.json();
      setRoom(data);
    } catch {
      setError("Failed to connect to server.");
    }
  }, [roomId]);

  // Poll every 1.5 seconds
  useEffect(() => {
    fetchRoom();
    const interval = setInterval(fetchRoom, 1500);
    return () => clearInterval(interval);
  }, [fetchRoom]);

  // Auto-scroll + TTS when new messages arrive
  useEffect(() => {
    if (!room) return;

    if (debateRef.current) {
      debateRef.current.scrollTop = debateRef.current.scrollHeight;
    }

    // Speak new messages
    if (ttsActive && room.messages.length > spokenCountRef.current) {
      const newMessages = room.messages.slice(spokenCountRef.current);
      spokenCountRef.current = room.messages.length;

      (async () => {
        for (const msg of newMessages) {
          await speakText(msg.content, msg.side);
        }
      })();
    } else if (!ttsActive && room.messages.length > spokenCountRef.current) {
      spokenCountRef.current = room.messages.length;
    }
  }, [room]);

  const castVote = async (side: "for" | "against") => {
    if (hasVoted) return;
    setHasVoted(true);
    await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "vote", roomId, side, voterId }),
    });
    fetchRoom();
  };

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <div className="text-center fade-in">
          <div className="text-5xl mb-4">😕</div>
          <h2 className="text-xl font-bold text-zinc-300 mb-2">Room Not Found</h2>
          <p className="text-zinc-500">{error}</p>
          <p className="text-zinc-600 text-sm mt-4">
            Room code: <span className="font-mono text-zinc-400">{roomId}</span>
          </p>
        </div>
      </main>
    );
  }

  if (!room) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-3 animate-pulse">⚔️</div>
          <p className="text-zinc-400">Connecting to debate room...</p>
        </div>
      </main>
    );
  }

  const totalVotes = room.votes.for + room.votes.against;
  const forPercent = totalVotes > 0 ? Math.round((room.votes.for / totalVotes) * 100) : 50;
  const againstPercent = totalVotes > 0 ? Math.round((room.votes.against / totalVotes) * 100) : 50;
  const winner =
    room.votes.for > room.votes.against
      ? "for"
      : room.votes.against > room.votes.for
      ? "against"
      : "tie";

  return (
    <main className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-white/10 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-2xl">⚔️</div>
            <div>
              <h1 className="text-xl font-bold gradient-text">AI Debate Arena</h1>
              <p className="text-xs text-zinc-500">Live Audience View</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const newVal = !ttsEnabled;
                setTtsEnabled(newVal);
                ttsActive = newVal;
                if (!newVal) stopSpeaking();
              }}
              className={`px-3 py-1.5 text-xs border rounded-lg transition-colors ${
                ttsEnabled
                  ? "bg-green-500/20 text-green-400 border-green-500/30"
                  : "bg-zinc-800 text-zinc-500 border-white/10"
              }`}
            >
              {ttsEnabled ? "🔊" : "🔇"}
            </button>
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
            </span>
            <span className="text-xs text-green-400">LIVE</span>
            <span className="text-xs text-zinc-600 ml-2">Room: {room.id}</span>
          </div>
        </div>
      </header>

      <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full px-6 py-6">
        {/* Topic */}
        <div className="text-center mb-6 fade-in">
          <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Debating</p>
          <h2 className="text-xl font-bold text-zinc-200">&ldquo;{room.topic}&rdquo;</h2>
          {room.status === "debating" && (
            <div className="flex items-center justify-center gap-2 mt-2">
              <span className="text-xs text-zinc-500">Round {room.currentRound} of 3</span>
              <div className="flex gap-1">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-2 h-2 rounded-full transition-colors ${
                      i < room.currentRound ? "bg-purple-500" : "bg-zinc-700"
                    }`}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Debaters Header */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center mb-4">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center text-lg font-bold ${
                room.activeSide === "for" ? "ring-2 ring-blue-400 ring-offset-2 ring-offset-[#0a0a0f]" : ""
              }`}
            >
              🛡️
            </div>
            <div>
              <p className="font-semibold text-blue-400">Agent Alpha</p>
              <p className="text-xs text-zinc-500">FOR</p>
            </div>
            {room.activeSide === "for" && room.status === "debating" && (
              <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full">Speaking...</span>
            )}
          </div>
          <div className="vs-pulse px-4">
            <span className="text-2xl font-black text-zinc-600">VS</span>
          </div>
          <div className="flex items-center gap-3 justify-end">
            {room.activeSide === "against" && room.status === "debating" && (
              <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">Speaking...</span>
            )}
            <div className="text-right">
              <p className="font-semibold text-red-400">Agent Omega</p>
              <p className="text-xs text-zinc-500">AGAINST</p>
            </div>
            <div
              className={`w-10 h-10 rounded-full bg-gradient-to-br from-red-500 to-orange-400 flex items-center justify-center text-lg font-bold ${
                room.activeSide === "against" ? "ring-2 ring-red-400 ring-offset-2 ring-offset-[#0a0a0f]" : ""
              }`}
            >
              ⚔️
            </div>
          </div>
        </div>

        {/* Messages */}
        <div ref={debateRef} className="flex-1 overflow-y-auto space-y-4 mb-6 min-h-0" style={{ maxHeight: "calc(100vh - 420px)" }}>
          {room.messages.length === 0 && room.status === "debating" && (
            <div className="flex items-center justify-center h-32">
              <p className="text-zinc-600 text-sm animate-pulse">Waiting for the debate to begin...</p>
            </div>
          )}
          {room.messages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex ${msg.side === "against" ? "justify-end" : "justify-start"} ${
                msg.side === "for" ? "slide-in-left" : "slide-in-right"
              }`}
            >
              <div
                className={`max-w-[85%] md:max-w-[70%] rounded-2xl px-5 py-4 ${
                  msg.side === "for"
                    ? "bg-blue-500/10 border border-blue-500/20 glow-blue"
                    : "bg-red-500/10 border border-red-500/20 glow-red"
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                    {msg.side === "for" ? "🛡️ Agent Alpha" : "⚔️ Agent Omega"} · Round {msg.round}
                  </span>
                </div>
                <p className="text-base leading-relaxed text-zinc-200 whitespace-pre-wrap">{msg.content}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Voting */}
        {room.status === "voting" && (
          <div className="border-t border-white/10 pt-6 fade-in">
            <div className="text-center mb-5">
              <h3 className="text-xl font-bold mb-1">Cast Your Vote!</h3>
              <p className="text-zinc-400 text-sm">Who argued better?</p>
              {totalVotes > 0 && (
                <p className="text-xs text-zinc-500 mt-1">{totalVotes} vote{totalVotes !== 1 ? "s" : ""} so far</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4 max-w-lg mx-auto">
              <button
                onClick={() => castVote("for")}
                disabled={hasVoted}
                className={`py-4 px-6 rounded-xl border-2 transition-all font-semibold ${
                  hasVoted
                    ? "border-blue-500/20 bg-blue-500/5 opacity-50 cursor-not-allowed"
                    : "border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 hover:border-blue-400 hover:scale-[1.02] active:scale-95"
                }`}
              >
                <span className="block text-2xl mb-1">🛡️</span>
                <span className="text-blue-400">Agent Alpha</span>
                <span className="block text-xs text-zinc-500 mt-1">FOR</span>
              </button>
              <button
                onClick={() => castVote("against")}
                disabled={hasVoted}
                className={`py-4 px-6 rounded-xl border-2 transition-all font-semibold ${
                  hasVoted
                    ? "border-red-500/20 bg-red-500/5 opacity-50 cursor-not-allowed"
                    : "border-red-500/30 bg-red-500/10 hover:bg-red-500/20 hover:border-red-400 hover:scale-[1.02] active:scale-95"
                }`}
              >
                <span className="block text-2xl mb-1">⚔️</span>
                <span className="text-red-400">Agent Omega</span>
                <span className="block text-xs text-zinc-500 mt-1">AGAINST</span>
              </button>
            </div>
            {hasVoted && (
              <p className="text-center text-sm text-purple-400 mt-4">Vote cast! Waiting for results...</p>
            )}
          </div>
        )}

        {/* Results */}
        {room.status === "results" && (
          <div className="border-t border-white/10 pt-6 fade-in">
            <div className="text-center mb-6">
              <h3 className="text-2xl font-bold mb-1">
                {winner === "tie"
                  ? "It's a Tie! 🤝"
                  : winner === "for"
                  ? "🛡️ Agent Alpha Wins!"
                  : "⚔️ Agent Omega Wins!"}
              </h3>
              <p className="text-zinc-400 text-sm">{totalVotes} total votes cast</p>
            </div>
            <div className="max-w-lg mx-auto">
              <div className="flex items-center gap-3 mb-4">
                <span className="text-blue-400 font-bold text-lg w-12 text-right">{forPercent}%</span>
                <div className="flex-1 h-4 bg-zinc-800 rounded-full overflow-hidden flex">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all duration-1000 rounded-l-full"
                    style={{ width: `${forPercent}%` }}
                  />
                  <div
                    className="h-full bg-gradient-to-r from-orange-400 to-red-500 transition-all duration-1000 rounded-r-full"
                    style={{ width: `${againstPercent}%` }}
                  />
                </div>
                <span className="text-red-400 font-bold text-lg w-12">{againstPercent}%</span>
              </div>
              <div className="flex justify-between text-sm text-zinc-500">
                <span>🛡️ Alpha — {room.votes.for} votes</span>
                <span>{room.votes.against} votes — Omega ⚔️</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-white/10 px-6 py-4 mt-auto">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <p className="text-xs text-zinc-500">
            Built by <span className="text-zinc-300 font-semibold">Adarsh Pandey</span>
          </p>
          <p className="text-xs text-zinc-600">Powered by Claude AI</p>
        </div>
      </footer>
    </main>
  );
}
