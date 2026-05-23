import Fastify from "fastify";
import fastifyWs from "@fastify/websocket";
import fastifyFormBody from "@fastify/formbody";
import Anthropic from "@anthropic-ai/sdk";
import sgMail from "@sendgrid/mail";

const fastify = Fastify({ logger: false });
const PORT = 5000;
const DOMAIN = process.env.RENDER_URL || process.env.NGROK_URL;
const WS_URL = `wss://${DOMAIN}/ws`;

const WELCOME = "Gracias por llamar a Servicios Consulares KPC. Soy Sofía, en qué le puedo ayudar hoy.";

const SYSTEM_PROMPT = `Eres Sofía, asistente virtual de Servicios Consulares KPC, ubicados en Weston, Florida.
Servicios que ofreces:
- Apostillas y legalizaciones de documentos (actas de nacimiento, matrimonio, divorcio, diplomas, etc.)
- Traducciones certificadas en español, inglés y portugués para USCIS e inmigración
- Poderes notariales y notarizaciones
- Permisos de viaje para menores

Información importante:
- Teléfono: nueve cinco cuatro, ocho siete tres, cinco uno nueve siete
- WhatsApp disponible
- Servicio en Miami, Broward, Palm Beach y todo EE.UU.
- Consulta gratuita

Reglas importantes:
- Ya saludaste al cliente. NO vuelvas a saludar ni presentarte.
- Responde siempre en español.
- Sé breve y natural, máximo 2 oraciones.
- Escribe todos los números en palabras.
- No uses asteriscos, guiones, emojis ni símbolos especiales.
- Si preguntan por algo que no ofreces, redirige amablemente a lo que sí haces.
- Pregunta el nombre del cliente y qué servicio necesita si no lo han mencionado.`;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const sessions = new Map();

async function getAIResponse(messages) {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 150,
    system: SYSTEM_PROMPT,
    messages: messages,
  });
  return response.content[0].text;
}

async function enviarEmail(historial) {
  try {
    await sgMail.send({
      to: "serviciosconsulareskpc@gmail.com",
      from: "sofia@serviciosconsulareskpc.com",
      subject: "Nueva llamada recibida - KPC",
      html: `<h3>Resumen de llamada</h3><pre>${historial}</pre>`,
    });
    console.log("Email enviado al manager.");
  } catch (err) {
    console.error("Error enviando email:", err.message);
  }
}

fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

fastify.all("/twiml", async (request, reply) => {
  reply.type("text/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Connect>
        <ConversationRelay url="${WS_URL}" welcomeGreeting="${WELCOME}" language="es-US" ttsProvider="amazon" voice="Lupe" transcriptionProvider="deepgram" speechModel="nova-2-conversationalai" />
      </Connect>
    </Response>`
  );
});

fastify.register(async function (fastify) {
  fastify.get("/ws", { websocket: true }, (ws) => {
    ws.on("message", async (data) => {
      const message = JSON.parse(data);

      if (message.type === "setup") {
        ws.callSid = message.callSid;
        sessions.set(ws.callSid, []);
        console.log("Nueva llamada:", ws.callSid);
      }

      else if (message.type === "prompt") {
        const userText = message.voicePrompt;
        console.log("Cliente:", userText);

        const conversation = sessions.get(ws.callSid) || [];
        conversation.push({ role: "user", content: userText });

        const reply = await getAIResponse(conversation);
        conversation.push({ role: "assistant", content: reply });
        sessions.set(ws.callSid, conversation);

        console.log("Sofia:", reply);
        ws.send(JSON.stringify({ type: "text", token: reply, last: true }));
      }

      else if (message.type === "end") {
        const conversation = sessions.get(ws.callSid) || [];
        if (conversation.length > 0) {
          const historial = conversation
            .map(m => `${m.role === "user" ? "Cliente" : "Sofia"}: ${m.content}`)
            .join("\n");
          await enviarEmail(historial);
        }
        sessions.delete(ws.callSid);
        console.log("Llamada terminada:", ws.callSid);
      }
    });

    ws.on("close", () => {
      console.log("Conexión cerrada.");
    });
  });
});

fastify.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
  if (err) { console.error(err); process.exit(1); }
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
