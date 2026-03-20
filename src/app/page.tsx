"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface DebateMessage {
  side: "for" | "against";
  content: string;
  round: number;
}

const SUGGESTED_TOPICS = [
  "AI will replace most human jobs within 20 years",
  "Social media does more harm than good",
  "Remote work is better than office work",
  "Space exploration is a waste of money",
  "Cryptocurrency will replace traditional currency",
  "University education is no longer worth it",
];

const MAX_ROUNDS = 4;

export default function Home() {
  const [topic, setTopic] = useState("");
  const [phase, setPhase] = useState<"setup" | "debating" | "voting" | "results">("setup");
  const [messages, setMessages] = useState<DebateMessage[]>([]);
  const [currentRound, setCurrentRound] = useState(1);
  const [streamingText, setStreamingText] = useState("");
  const [activeSide, setActiveSide] = useState<"for" | "against" | null>(null);
  const [votes, setVotes] = useState({ for: 0, against: 0 });
  const [hasVoted, setHasVoted] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [showSharePanel, setShowSharePanel] = useState(false);
  const [copied, setCopied] = useState(false);
  const debateRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-scroll to bottom of debate
  useEffect(() => {
    if (debateRef.current) {
      debateRef.current.scrollTop = debateRef.current.scrollHeight;
    }
  }, [messages, streamingText]);

  // Poll votes from server when in voting phase
  useEffect(() => {
    if ((phase === "voting" || phase === "results") && roomId) {
      const interval = setInterval(async () => {
        const res = await fetch(`/api/rooms?id=${roomId}`);
        if (res.ok) {
          const room = await res.json();
          setVotes(room.votes);
        }
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [phase, roomId]);

  // Sync room status to server
  const syncRoomStatus = useCallback(
    async (status: string, side: string | null = null) => {
      if (!roomId) return;
      await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status", roomId, status, activeSide: side }),
      });
    },
    [roomId]
  );

  // Sync message to server
  const syncMessage = useCallback(
    async (message: DebateMessage, round: number, side: "for" | "against" | null) => {
      if (!roomId) return;
      await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "message", roomId, message, currentRound: round, activeSide: side }),
      });
    },
    [roomId]
  );

  const streamResponse = useCallback(
    async (side: "for" | "against", history: { role: string; content: string }[]) => {
      setActiveSide(side);
      setStreamingText("");
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const res = await fetch("/api/debate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, side, history }),
        signal: controller.signal,
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          fullText += chunk;
          setStreamingText(fullText);
        }
      }

      setIsStreaming(false);
      return fullText;
    },
    [topic]
  );

  const runDebate = useCallback(async () => {
    if (!topic.trim()) return;

    // Create room on server
    const res = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", topic }),
    });
    const room = await res.json();
    setRoomId(room.id);

    setPhase("debating");
    setMessages([]);
    setCurrentRound(1);
    setVotes({ for: 0, against: 0 });
    setHasVoted(false);
    setShowSharePanel(true);

    const allMessages: DebateMessage[] = [];

    for (let round = 1; round <= MAX_ROUNDS; round++) {
      setCurrentRound(round);

      // Sync active side to server
      await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status", roomId: room.id, status: "debating", activeSide: "for" }),
      });

      // FOR side speaks
      const forHistory =
        round === 1
          ? []
          : allMessages.map((m) => ({
              role: m.side === "for" ? "assistant" : "user",
              content: m.content,
            }));

      const forText = await streamResponse("for", forHistory);
      const forMsg: DebateMessage = { side: "for", content: forText, round };
      allMessages.push(forMsg);
      setMessages([...allMessages]);
      setStreamingText("");

      // Sync message to server
      await syncMessage(forMsg, round, "for");

      await new Promise((r) => setTimeout(r, 800));

      // Sync active side
      await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status", roomId: room.id, status: "debating", activeSide: "against" }),
      });

      // AGAINST side speaks
      const againstHistory = allMessages.map((m) => ({
        role: m.side === "against" ? "assistant" : "user",
        content: m.content,
      }));

      const againstText = await streamResponse("against", againstHistory);
      const againstMsg: DebateMessage = { side: "against", content: againstText, round };
      allMessages.push(againstMsg);
      setMessages([...allMessages]);
      setStreamingText("");

      // Sync message to server
      await syncMessage(againstMsg, round, "against");

      if (round < MAX_ROUNDS) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    setActiveSide(null);
    setPhase("voting");

    // Sync voting status to server
    await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "status", roomId: room.id, status: "voting", activeSide: null }),
    });
  }, [topic, streamResponse, syncMessage]);

  const castVote = async (side: "for" | "against") => {
    if (hasVoted || !roomId) return;
    setHasVoted(true);

    await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "vote", roomId, side, voterId: "host" }),
    });

    // Fetch updated votes
    const res = await fetch(`/api/rooms?id=${roomId}`);
    if (res.ok) {
      const room = await res.json();
      setVotes(room.votes);
    }
  };

  const showResults = async () => {
    setPhase("results");
    if (roomId) {
      await syncRoomStatus("results");
    }
  };

  const resetDebate = () => {
    setPhase("setup");
    setTopic("");
    setMessages([]);
    setStreamingText("");
    setActiveSide(null);
    setCurrentRound(1);
    setVotes({ for: 0, against: 0 });
    setHasVoted(false);
    setRoomId(null);
    setShowSharePanel(false);
    if (abortRef.current) abortRef.current.abort();
  };

  const copyLink = () => {
    const url = `${window.location.origin}/watch/${roomId}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const totalVotes = votes.for + votes.against;
  const forPercent = totalVotes > 0 ? Math.round((votes.for / totalVotes) * 100) : 50;
  const againstPercent = totalVotes > 0 ? Math.round((votes.against / totalVotes) * 100) : 50;
  const winner = votes.for > votes.against ? "for" : votes.against > votes.for ? "against" : "tie";
  const watchUrl = roomId ? `${typeof window !== "undefined" ? window.location.origin : ""}/watch/${roomId}` : "";
  const qrUrl = roomId
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(watchUrl)}`
    : "";

  return (
    <main className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-white/10 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-2xl">⚔️</div>
            <div>
              <h1 className="text-xl font-bold gradient-text">AI Debate Arena</h1>
              <p className="text-xs text-zinc-500">Two AIs. One topic. No mercy.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {roomId && (
              <button
                onClick={() => setShowSharePanel(!showSharePanel)}
                className="px-3 py-1.5 text-xs bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded-lg hover:bg-purple-500/30 transition-colors"
              >
                Share Room: {roomId}
              </button>
            )}
            {phase !== "setup" && (
              <button
                onClick={resetDebate}
                className="px-4 py-2 text-sm border border-white/10 rounded-lg hover:bg-white/5 transition-colors"
              >
                New Debate
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Share Panel */}
      {showSharePanel && roomId && (
        <div className="bg-[#12121a] border-b border-white/10 px-6 py-4 fade-in">
          <div className="max-w-6xl mx-auto flex items-center gap-6">
            <img
              src={qrUrl}
              alt="QR Code"
              className="w-24 h-24 rounded-lg bg-white p-1"
            />
            <div className="flex-1">
              <p className="text-sm font-semibold text-zinc-300 mb-1">Audience can join by scanning the QR code or visiting:</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-[#1a1a2e] border border-white/10 rounded-lg text-sm text-purple-400 truncate">
                  {watchUrl}
                </code>
                <button
                  onClick={copyLink}
                  className="px-4 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-500 transition-colors whitespace-nowrap"
                >
                  {copied ? "Copied!" : "Copy Link"}
                </button>
              </div>
              <p className="text-xs text-zinc-500 mt-2">
                Room Code: <span className="font-mono font-bold text-zinc-300">{roomId}</span> · {totalVotes} viewer{totalVotes !== 1 ? "s have" : " has"} voted
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Setup Phase */}
      {phase === "setup" && (
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="max-w-2xl w-full fade-in">
            <div className="text-center mb-10">
              <h2 className="text-4xl font-bold mb-3 gradient-text">Choose Your Battle</h2>
              <p className="text-zinc-400">Enter a debate topic and watch two AI agents clash in real-time</p>
            </div>

            <div className="relative mb-6">
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runDebate()}
                placeholder="Enter a debate topic..."
                className="w-full px-5 py-4 bg-[#1a1a2e] border border-white/10 rounded-xl text-lg focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/25 placeholder-zinc-600 transition-all"
              />
              <button
                onClick={runDebate}
                disabled={!topic.trim()}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-6 py-2.5 bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Start Debate ⚡
              </button>
            </div>

            <div>
              <p className="text-xs text-zinc-500 mb-3 uppercase tracking-wider">Suggested Topics</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {SUGGESTED_TOPICS.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTopic(t)}
                    className="text-left px-4 py-3 bg-[#1a1a2e]/50 border border-white/5 rounded-lg text-sm text-zinc-400 hover:text-zinc-200 hover:border-purple-500/30 hover:bg-[#1a1a2e] transition-all"
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Debate Phase */}
      {(phase === "debating" || phase === "voting" || phase === "results") && (
        <div className="flex-1 flex flex-col max-w-6xl mx-auto w-full px-6 py-6">
          {/* Topic Banner */}
          <div className="text-center mb-6 fade-in">
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Debating</p>
            <h2 className="text-xl font-bold text-zinc-200">&ldquo;{topic}&rdquo;</h2>
            {phase === "debating" && (
              <div className="flex items-center justify-center gap-2 mt-2">
                <span className="text-xs text-zinc-500">
                  Round {currentRound} of {MAX_ROUNDS}
                </span>
                <div className="flex gap-1">
                  {Array.from({ length: MAX_ROUNDS }).map((_, i) => (
                    <div
                      key={i}
                      className={`w-2 h-2 rounded-full transition-colors ${
                        i < currentRound ? "bg-purple-500" : "bg-zinc-700"
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
                className={`w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center text-lg font-bold relative ${
                  activeSide === "for" ? "ring-2 ring-blue-400 ring-offset-2 ring-offset-[#0a0a0f]" : ""
                }`}
              >
                🛡️
              </div>
              <div>
                <p className="font-semibold text-blue-400">Agent Alpha</p>
                <p className="text-xs text-zinc-500">Arguing FOR</p>
              </div>
              {activeSide === "for" && isStreaming && (
                <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full">Speaking...</span>
              )}
            </div>

            <div className="vs-pulse px-4">
              <span className="text-2xl font-black text-zinc-600">VS</span>
            </div>

            <div className="flex items-center gap-3 justify-end">
              {activeSide === "against" && isStreaming && (
                <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">Speaking...</span>
              )}
              <div className="text-right">
                <p className="font-semibold text-red-400">Agent Omega</p>
                <p className="text-xs text-zinc-500">Arguing AGAINST</p>
              </div>
              <div
                className={`w-10 h-10 rounded-full bg-gradient-to-br from-red-500 to-orange-400 flex items-center justify-center text-lg font-bold ${
                  activeSide === "against" ? "ring-2 ring-red-400 ring-offset-2 ring-offset-[#0a0a0f]" : ""
                }`}
              >
                ⚔️
              </div>
            </div>
          </div>

          {/* Debate Messages */}
          <div ref={debateRef} className="flex-1 overflow-y-auto space-y-4 mb-6 min-h-0" style={{ maxHeight: "calc(100vh - 420px)" }}>
            {messages.map((msg, idx) => (
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
                  <p className="text-sm leading-relaxed text-zinc-300 whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            ))}

            {/* Streaming message */}
            {streamingText && activeSide && (
              <div className={`flex ${activeSide === "against" ? "justify-end" : "justify-start"} ${
                activeSide === "for" ? "slide-in-left" : "slide-in-right"
              }`}>
                <div
                  className={`max-w-[85%] md:max-w-[70%] rounded-2xl px-5 py-4 ${
                    activeSide === "for"
                      ? "bg-blue-500/10 border border-blue-500/20 glow-blue"
                      : "bg-red-500/10 border border-red-500/20 glow-red"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                      {activeSide === "for" ? "🛡️ Agent Alpha" : "⚔️ Agent Omega"} · Round {currentRound}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed text-zinc-300 whitespace-pre-wrap">
                    {streamingText}
                    <span className="cursor-blink" />
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Voting Phase */}
          {phase === "voting" && (
            <div className="border-t border-white/10 pt-6 fade-in">
              <div className="text-center mb-5">
                <h3 className="text-xl font-bold mb-1">The debate has ended!</h3>
                <p className="text-zinc-400 text-sm">Cast your vote — audience is voting too!</p>
                {totalVotes > 0 && (
                  <p className="text-xs text-purple-400 mt-1">{totalVotes} vote{totalVotes !== 1 ? "s" : ""} received</p>
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
                  <span className="block text-xs text-zinc-500 mt-1">FOR the topic</span>
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
                  <span className="block text-xs text-zinc-500 mt-1">AGAINST the topic</span>
                </button>
              </div>
              <div className="text-center mt-4">
                <button
                  onClick={showResults}
                  className="px-6 py-2 bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity"
                >
                  End Voting & Show Results
                </button>
              </div>
            </div>
          )}

          {/* Results Phase */}
          {phase === "results" && (
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
                  <span>🛡️ Alpha — {votes.for} votes</span>
                  <span>{votes.against} votes — Omega ⚔️</span>
                </div>

                <div className="text-center mt-6">
                  <button
                    onClick={resetDebate}
                    className="px-8 py-3 bg-gradient-to-r from-purple-600 to-blue-600 rounded-xl font-semibold hover:opacity-90 transition-opacity"
                  >
                    Start New Debate ⚡
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-white/10 px-6 py-4 mt-auto">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <p className="text-xs text-zinc-500">
            Built by{" "}
            <span className="text-zinc-300 font-semibold">Adarsh Pandey</span>
          </p>
          <p className="text-xs text-zinc-600">
            Powered by Claude AI
          </p>
        </div>
      </footer>
    </main>
  );
}
