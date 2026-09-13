let ws;
let peerConnection;
let localStream;

let cameraEnabled = false;
let micEnabled = false;

const localVideo = document.getElementById("local");
const localPlaceholder = document.getElementById("localPlaceholder");
const permissionStatus = document.getElementById("permissionStatus");
const connectionStatus = document.getElementById("connectionStatus");

function setPermissionStatus(message) {
    if (permissionStatus) {
        permissionStatus.textContent = message;
    }
}

function setConnectionStatus(message) {
    if (connectionStatus) {
        connectionStatus.textContent = message;
    }
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

    peerConnection.onconnectionstatechange = () => {
        if (peerConnection.connectionState === "connected") {
            setConnectionStatus("Connected to meeting viewer.");
        }

        if (["disconnected", "failed"].includes(peerConnection.connectionState)) {
            setConnectionStatus("Meeting connection interrupted.");
        }
    };
}

function connectParticipant() {
    const WS_URL =
        window.location.hostname === "localhost"
            ? `ws://${window.location.host}`
            : "wss://RENDER_BACKEND_URL";

    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
        const guestName = `Guest-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

        ws.send(JSON.stringify({
            type: "join",
            role: "capture",
            name: guestName,
            camera: cameraEnabled,
            microphone: micEnabled
        }));

        setConnectionStatus("Connecting to meeting viewer...");
    };

    ws.onmessage = async (event) => {
        const message = JSON.parse(event.data);

        if (message.type === "viewer-ready") {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);

            ws.send(JSON.stringify({
                type: "offer",
                offer: peerConnection.localDescription
            }));

            setConnectionStatus("Connecting to meeting viewer...");
        }

        if (message.type === "answer") {
            await peerConnection.setRemoteDescription(message.answer);
            setConnectionStatus("Camera connected. Meeting is live.");
        }

        if (message.type === "candidate") {
            try {
                await peerConnection.addIceCandidate(message.candidate);
            } catch (error) {
                console.error("ICE error:", error);
            }
        }

        if (message.type === "viewer-left") {
            setConnectionStatus("Waiting for meeting viewer...");
        }
    };

    ws.onerror = () => {
        setConnectionStatus("Unable to connect to the meeting.");
    };
}

async function startParticipant() {
    try {
        setPermissionStatus("Waiting for camera and microphone permission...");

        localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
        });

        localVideo.srcObject = localStream;
        localPlaceholder.classList.add("hidden");
        cameraEnabled = true;
        micEnabled = true;

        setPermissionStatus("Camera and microphone connected.");

        await createPeerConnection();

        localStream.getTracks().forEach((track) => {
            peerConnection.addTrack(track, localStream);
        });

        connectParticipant();
    } catch (error) {
        console.error("Camera permission error:", error);
        setPermissionStatus("Camera and microphone permission is required.");
        setConnectionStatus("Refresh this page after allowing access.");
    }
}

document.addEventListener("DOMContentLoaded", () => {
    startParticipant();
});
