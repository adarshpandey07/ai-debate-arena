import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(req: NextRequest) {
  const { topic, side, history } = await req.json();

  const opponentSide = side === "for" ? "against" : "for";

  const systemPrompt = `You are a world-class debater arguing ${side.toUpperCase()} the topic: "${topic}".

Your debate style:
- Be sharp, witty, and persuasive
- Use compelling arguments, facts, statistics, and rhetorical techniques
- Directly counter your opponent's points when they make them
- Keep each response to 2-3 paragraphs maximum
- Be passionate but respectful
- Use occasional rhetorical questions for dramatic effect
- End with a strong punch line or memorable statement

You are arguing ${side === "for" ? "IN FAVOR OF" : "AGAINST"} the topic. Stay consistent with your position no matter what.`;

  const messages = history.map((h: { role: string; content: string }) => ({
    role: h.role as "user" | "assistant",
    content: h.content,
  }));

  // If this is the opening statement
  if (messages.length === 0) {
    messages.push({
      role: "user" as const,
      content: `The debate topic is: "${topic}". You are arguing ${side === "for" ? "IN FAVOR" : "AGAINST"}. Please deliver your powerful opening statement.`,
    });
  } else {
    // Add framing for the response
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role === "assistant") {
      messages.push({
        role: "user" as const,
        content: `Your opponent (arguing ${opponentSide}) just said the above. Now deliver your rebuttal. Be sharp and directly counter their points.`,
      });
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 600,
        system: systemPrompt,
        messages,
        stream: true,
      });

      for await (const event of response) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          controller.enqueue(encoder.encode(event.delta.text));
        }
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
    },
  });
}
