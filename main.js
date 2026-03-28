const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { autoUpdater } = require("electron-updater");

// Simple .env file parser (since npm install might be encountering permission issues)
try {
	const envPath = path.join(__dirname, ".env");
	if (fs.existsSync(envPath)) {
		const envFile = fs.readFileSync(envPath, "utf8");
		envFile.split(/\r?\n/).forEach((line) => {
			const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
			if (match) {
				const key = match[1];
				let value = match[2] || "";
				// strip quotes if wrapped
				if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
				if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
				process.env[key] = value;
			}
		});
	}
} catch (e) {
	console.error("Failed to load .env file", e);
}

const oscService = require("./node/osc-service.js");
const chatboxService = require("./node/chatbox-service.js");
const sttService = require("./node/stt-service.js");

function createWindow() {
	const win = new BrowserWindow({
		width: 1000,
		height: 800,
		icon: path.join(__dirname, "icon.png"),
		webPreferences: {
			preload: path.join(__dirname, "preload.js")
		}
	});

	win.loadFile("index.html");

	// win.webContents.openDevTools();
}

app.whenReady().then(() => {
	// Let oscService initialize but DON'T start auto-polling yet
	oscService.start();

	ipcMain.on("osc:send-now", () => {
		oscService.sendNow();
	});

	ipcMain.on("osc:toggle-time-sync", (event, shouldSync) => {
		if (shouldSync) {
			oscService.startTimePolling();
		} else {
			oscService.stopTimePolling();
		}
	});

	ipcMain.on("osc:send-chatbox", async (event, text, mode, targetLangs) => {
		let finalText = text;
		if (mode === "ask") {
			const translateService = require("./node/translate-service.js");
			finalText = await translateService.askAI(text);
		} else if (mode === "translate" && targetLangs && targetLangs.length > 0) {
			const translateService = require("./node/translate-service.js");
			finalText = await translateService.translateText(text, targetLangs);
		}

		chatboxService.sendChatbox(finalText);
		event.reply("osc:chatbox-sent", finalText);
	});

	// STT 相关事件监听
	ipcMain.on("stt:start", () => {
		sttService.startStream();
	});

	ipcMain.on("stt:chunk", (event, arrayBuffer) => {
		// IPC 传过来的 ArrayBuffer/Buffer 需要转换成 Float32Array 供模型推测
		const float32Array = new Float32Array(
			arrayBuffer.buffer || arrayBuffer,
			arrayBuffer.byteOffset || 0,
			arrayBuffer.byteLength / 4
		);
		const res = sttService.feedAudio(float32Array);
		if (res && res.text) {
			// 将预测结果返回给前端，如果 isFinal 为 true 说明 Sherpa 认为一句话结束了
			event.reply("stt:result", res.text, res.isFinal);
		}
	});

	ipcMain.on("stt:stop", (event) => {
		const finalResult = sttService.stopStream();
		if (finalResult) {
			// 将最终确定下来的句子发给前端
			event.reply("stt:result", finalResult, true);
		}
	});

	createWindow();

	// --- 开启自动更新检查 ---
	// 为了确保更新不打扰用户，它会在后台静默下载，下载好以后等用户下次重启应用时安装
	autoUpdater.checkForUpdatesAndNotify();

	autoUpdater.on("update-available", () => {
		console.log("发现新版本，正在下载...");
	});
	autoUpdater.on("update-downloaded", () => {
		console.log("新版本下载完成！将在下次启动时自动安装。");
		// 也可以强制立即重启更新： autoUpdater.quitAndInstall();
	});
	autoUpdater.on("error", (err) => {
		console.error("更新检查失败:", err);
	});
	// ----------------------

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	});
});

app.on("window-all-closed", () => {
	oscService.stop();
	chatboxService.stop();
	if (process.platform !== "darwin") {
		app.quit();
	}
});
