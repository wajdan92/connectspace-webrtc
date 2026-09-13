let ws;
let peerConnection;
let pendingCandidates = [];

const remoteVideo = document.getElementById("remote");
const videoPlaceholder = document.getElementById("videoPlaceholder");
const viewerStatus = document.getElementById("viewerStatus");
const participantsList = document.getElementById("participantsList");
const participantCount = document.getElementById("participantCount");

function setStatus(message) {
    viewerStatus.textContent = message;
}

function escapeHtml(value) {
    const element = document.createElement("div");
    element.textContent = value;
    return element.innerHTML;
}

function renderParticipants(list) {
    const captures = list.filter((participant) => participant.role === "capture");
    participantCount.textContent = captures.length;

    participantsList.innerHTML = captures.map((participant) => `
        <div class="participant-item">
            <div class="avatar">${escapeHtml(participant.name.charAt(0).toUpperCase())}</div>
            <div>
                <strong>${escapeHtml(participant.name)}</strong>
                <span>Camera: ${participant.camera ? "On" : "Off"}</span>
            </div>
            <span class="presence"></span>
        </div>
    `).join("");
}

async function createPeerConnection() {
    peerConnection = new RTCPeerConnection({
        iceServers: [{
            urls: "stun:stun.l.google.com:19302"
        }]
    });

    peerConnection.onicecandidate = (event) => {
        if (event.candidate && ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: "candidate",
                candidate: event.candidate
            }));
        }
    };

    peerConnection.ontrack = (event) => {
        remoteVideo.srcObject = event.streams[0];
        videoPlaceholder.classList.add("hidden");
        setStatus("Participant connected");
    };

    peerConnection.onconnectionstatechange = () => {
        if (peerConnection.connectionState === "connected") {
            setStatus("Participant connected");
        }

        if (["disconnected", "failed"].includes(peerConnection.connectionState)) {
            setStatus("Participant connection interrupted");
        }
    };
}

async function flushCandidates() {
    for (const candidate of pendingCandidates) {
        await peerConnection.addIceCandidate(candidate);
    }

    pendingCandidates = [];
}

async function connectViewer() {
    await createPeerConnection();

    const WS_URL =
        window.location.hostname === "localhost"
            ? `ws://${window.location.host}`
            : "wss://connectspace-webrtc-production.up.railway.app";

    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
        ws.send(JSON.stringify({
            type: "join",
            role: "viewer",
            name: "Host",
            camera: false,
            microphone: false
        }));

        setStatus("Waiting for participant...");
    };

    ws.onmessage = async (event) => {
        const message = JSON.parse(event.data);

        if (message.type === "participants") {
            renderParticipants(message.participants);
        }

        if (message.type === "offer") {
            await peerConnection.setRemoteDescription(message.offer);
            await flushCandidates();

            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);

            ws.send(JSON.stringify({
                type: "answer",
                answer: peerConnection.localDescription
            }));
        }

        if (message.type === "candidate") {
            if (peerConnection.remoteDescription) {
                await peerConnection.addIceCandidate(message.candidate);
            } else {
                pendingCandidates.push(message.candidate);
            }
        }

        if (message.type === "capture-left") {
            remoteVideo.srcObject = null;
            videoPlaceholder.classList.remove("hidden");
            setStatus("Participant disconnected");
        }
    };

    ws.onerror = () => {
        setStatus("Viewer connection error");
    };
}

connectViewer();
