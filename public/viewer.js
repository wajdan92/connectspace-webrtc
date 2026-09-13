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

async function getIceServers() {
    const response = await fetch(
        "https://connectspace-webrtc-production.up.railway.app/api/turn-credentials"
    );

    if (!response.ok) {
        throw new Error(
            "Unable to load TURN credentials"
        );
    }

    const data = await response.json();

    if (
        !data.iceServers ||
        !Array.isArray(data.iceServers)
    ) {
        throw new Error(
            "Invalid TURN credential response"
        );
    }

    console.log(
        "Loaded ICE servers:",
        data.iceServers.map(
            server => server.urls
        )
    );

    return data.iceServers;
}

async function createPeerConnection() {
    const iceServers = await getIceServers();

    peerConnection = new RTCPeerConnection({
        iceServers
    });

    peerConnection.onicecandidate = (event) => {
        if (event.candidate && ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: "candidate",
                candidate: event.candidate
            }));
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        console.log(
            "ICE connection state:",
            peerConnection.iceConnectionState
        );
    };

    peerConnection.onicegatheringstatechange = () => {
        console.log(
            "ICE gathering state:",
            peerConnection.iceGatheringState
        );
    };

    peerConnection.onsignalingstatechange = () => {
        console.log(
            "Signaling state:",
            peerConnection.signalingState
        );
    };

    peerConnection.ontrack = async (event) => {
        remoteVideo.srcObject = event.streams[0];
        videoPlaceholder.classList.add("hidden");

        try {
            await remoteVideo.play();
            setStatus("Participant connected");
        } catch (error) {
            console.warn("Remote autoplay blocked:", error);

            setStatus("Participant connected — click video to start playback");

            remoteVideo.addEventListener(
                "click",
                async () => {
                    try {
                        await remoteVideo.play();
                        setStatus("Participant connected");
                    } catch (playError) {
                        console.error("Remote playback failed:", playError);
                    }
                },
                { once: true }
            );
        }
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
