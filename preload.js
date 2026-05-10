// 预加载脚本（preload script）
// 全局的 API 暴露可以在这里完成，为了安全性最好使用 contextBridge

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
	message: "Preload script loaded",
	sendOSC: () => ipcRenderer.send("osc:send-now"),
	toggleTimeSync: (shouldSync) => ipcRenderer.send("osc:toggle-time-sync", shouldSync),
	setTimezone: (timezoneOffsetHours) => ipcRenderer.send("osc:set-timezone", timezoneOffsetHours),
	sendChatbox: (text, mode, targetLangs) => ipcRenderer.send("osc:send-chatbox", text, mode, targetLangs),
	sendSystemStatusToChatbox: () => ipcRenderer.invoke("system:send-status-to-chatbox"),
	onChatboxSent: (callback) => ipcRenderer.on("osc:chatbox-sent", (event, text) => callback(text)),
	// 新增 STT (语音转文本) 通信接口
	startSTT: (options) => ipcRenderer.send("stt:start", options),
	stopSTT: () => ipcRenderer.send("stt:stop"),
	sendAudioChunk: (arrayBuffer) => ipcRenderer.send("stt:chunk", arrayBuffer),
	onSTTResult: (callback) => ipcRenderer.on("stt:result", (event, text, isFinal) => callback(text, isFinal))
});
