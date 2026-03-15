import { io } from 'socket.io-client';

const socketUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000';
export const socket = io(socketUrl);

// Compatibility bridge to avoid massive refactoring immediately
export const vscode = {
  postMessage: (msg: any) => {
    socket.emit('message', msg);
  }
};
