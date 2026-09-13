const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = path.join(__dirname, "public");

let captureClient = null;
let viewerClient = null;

const participants = new Map();

function send(ws, message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
}

function broadcastParticipants() {
    const list = [...participants.values()];

    for (const client of wss.clients) {
        send(client, {
            type: "participants",
            participants: list
        });
    }
}

const server = http.createServer((req, res) => {
    let pathname = new URL(
        req.url,
        `http://${req.headers.host}`
    ).pathname;

    if (pathname === "/") {
        pathname = "/index.html";
    }

    const filePath = path.join(
        PUBLIC_DIR,
        path.normalize(pathname).replace(/^(\.\.[/\\])+/, "")
    );

    fs.readFile(filePath, (error, data) => {
        if (error) {
            res.writeHead(404);
            return res.end("Not Found");
        }

        const extension = path.extname(filePath);

        const types = {
            ".html": "text/html",
            ".js": "text/javascript",
            ".css": "text/css"
        };

        res.writeHead(200, {
            "Content-Type":
                types[extension] || "application/octet-stream"
        });

        res.end(data);
    });
});

const wss = new WebSocket.Server({ server });

wss.on("connection", (ws, req) => {

    let role = null;
    let participantId = null;

    ws.on("message", (raw) => {

        let message;

        try {
            message = JSON.parse(raw.toString());
        } catch {
            return;
        }

        if (message.type === "join") {

            role = message.role;
            participantId =
                Date.now().toString(36) +
                Math.random().toString(36).slice(2);

            participants.set(participantId, {
                id: participantId,
                name: message.name || "Guest",
                role,
                camera: Boolean(message.camera),
                microphone: Boolean(message.microphone),
                joinedAt: new Date().toISOString()
            });

            if (role === "capture") {
                captureClient = ws;
            }

            if (role === "viewer") {
                viewerClient = ws;
            }

            send(ws, {
                type: "registered",
                role,
                participantId
            });

            broadcastParticipants();

            if (captureClient && viewerClient) {
                send(viewerClient, {
                    type: "capture-ready"
                });

                send(captureClient, {
                    type: "viewer-ready"
                });
            }

            return;
        }

        if (message.type === "media-state") {

            if (
                participantId &&
                participants.has(participantId)
            ) {
                const participant =
                    participants.get(participantId);

                participant.camera =
                    Boolean(message.camera);

                participant.microphone =
                    Boolean(message.microphone);

                participants.set(
                    participantId,
                    participant
                );

                broadcastParticipants();
            }

            return;
        }

        if (message.type === "offer") {
            send(viewerClient, message);
            return;
        }

        if (message.type === "answer") {
            send(captureClient, message);
            return;
        }

        if (message.type === "candidate") {

            if (role === "capture") {
                send(viewerClient, message);
            }

            if (role === "viewer") {
                send(captureClient, message);
            }

            return;
        }
    });

    ws.on("close", () => {

        if (
            role === "capture" &&
            captureClient === ws
        ) {
            captureClient = null;

            send(viewerClient, {
                type: "capture-left"
            });
        }

        if (
            role === "viewer" &&
            viewerClient === ws
        ) {
            viewerClient = null;

            send(captureClient, {
                type: "viewer-left"
            });
        }

        if (participantId) {
            participants.delete(participantId);
            broadcastParticipants();
        }
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(
        `Server running on http://localhost:${PORT}`
    );
});
