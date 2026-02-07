import { useStore } from "./store.js";

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;

function getWsUrl() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

function handleMessage(event: MessageEvent) {
  const store = useStore.getState();
  let data: any;
  try {
    data = JSON.parse(event.data);
  } catch {
    return;
  }

  switch (data.type) {
    case "snapshot":
      store.applySnapshot(data);
      break;
    case "session:initialized":
      store.setSession({ initialized: true, teamName: data.teamName });
      break;
    case "session:shutdown":
      store.reset();
      break;
    case "agent:spawned":
      store.addAgent(data.agent);
      break;
    case "agent:exited":
      store.updateAgent(data.agent, { status: "exited", exitCode: data.exitCode });
      break;
    case "agent:idle":
      store.updateAgent(data.agent, { status: "idle" });
      break;
    case "agent:message":
      store.appendMessage(data.agent, data.message);
      // If agent sends a non-system message, mark as running
      if (!data.message.isSystem) {
        store.updateAgent(data.agent, { status: "running" });
      }
      break;
    case "agent:shutdown_approved":
      break;
    case "approval:plan":
    case "approval:permission":
      store.addApproval(data.approval);
      break;
    case "error":
      console.error("[ws] Server error:", data.message);
      break;
  }
}

export function connect() {
  if (socket?.readyState === WebSocket.OPEN) return;

  socket = new WebSocket(getWsUrl());

  socket.onopen = () => {
    useStore.getState().setConnected(true);
    reconnectDelay = 1000;
  };

  socket.onmessage = handleMessage;

  socket.onclose = () => {
    useStore.getState().setConnected(false);
    scheduleReconnect();
  };

  socket.onerror = () => {
    socket?.close();
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelay = Math.min(reconnectDelay * 1.5, 5000);
    connect();
  }, reconnectDelay);
}

export function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  socket?.close();
  socket = null;
}
