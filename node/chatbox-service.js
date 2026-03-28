const { Client } = require("node-osc");

let client;

function initClient() {
	if (!client) {
		// VRChat 默认在本地 9000 端口接收 OSC 消息
		client = new Client("127.0.0.1", 9000);
	}
}

function sendChatbox(text) {
	initClient();
	console.log(`[ChatboxService] Sending to chatbox: ${text}`);
	// 发送到 VRChat 的 /chatbox/input
	// argument 1: text (string)
	// argument 2: bool(true) - direct send, bypass keyboard
	// argument 3: bool(false) - play notification sound
	client.send("/chatbox/input", text, true, false);
}

function stop() {
	if (client) {
		client.close();
		client = null;
	}
}

module.exports = {
	sendChatbox,
	stop
};
