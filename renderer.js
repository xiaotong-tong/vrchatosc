// --- Navigation Logic ---
document.querySelectorAll(".nav-item").forEach((item) => {
	item.addEventListener("click", () => {
		// Update Nav
		document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
		item.classList.add("active");

		// Update Page
		const target = item.getAttribute("data-target");
		document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
		document.getElementById(target).classList.add("active");
	});
});

// --- OSC Logic ---
let isTimeSyncRunning = false;
const toggleTimeSyncBtn = document.getElementById("toggle-time-sync-btn");
const oscStatusEl = document.getElementById("osc-status");
const timezoneSelect = document.getElementById("timezone-select");

function getTimezoneLabel(value) {
	if (value === "local") return "本地时区";
	const n = Number(value);
	if (Number.isNaN(n)) return "未知时区";
	return `UTC${n >= 0 ? "+" : ""}${n}`;
}

function getTimezonePayload(value) {
	if (value === "local") return null;
	const n = Number(value);
	return Number.isNaN(n) ? null : n;
}

window.api.setTimezone(getTimezonePayload(timezoneSelect.value));

timezoneSelect.addEventListener("change", () => {
	const payload = getTimezonePayload(timezoneSelect.value);
	window.api.setTimezone(payload);
	oscStatusEl.innerText = `已切换同步时区：${getTimezoneLabel(timezoneSelect.value)}`;
});

toggleTimeSyncBtn.addEventListener("click", () => {
	isTimeSyncRunning = !isTimeSyncRunning;
	window.api.toggleTimeSync(isTimeSyncRunning);
	const tzLabel = getTimezoneLabel(timezoneSelect.value);

	if (isTimeSyncRunning) {
		toggleTimeSyncBtn.innerText = "⏹ 停止自动同步";
		toggleTimeSyncBtn.style.backgroundColor = "#e74c3c";
		oscStatusEl.innerText = `自动同步已开启 (${tzLabel}) - ${new Date().toLocaleTimeString()}`;
	} else {
		toggleTimeSyncBtn.innerText = "▶ 开启自动同步时间";
		toggleTimeSyncBtn.style.backgroundColor = "#f39c12";
		oscStatusEl.innerText = `自动同步已停止 (${tzLabel}) - ${new Date().toLocaleTimeString()}`;
	}
});

document.getElementById("send-osc-btn").addEventListener("click", () => {
	window.api.sendOSC();
	console.log("OSC send request sent (via clean renderer)");
	oscStatusEl.innerText = `已立即同步 (${getTimezoneLabel(timezoneSelect.value)}) - ${new Date().toLocaleTimeString()}`;
});

// --- Chatbox Logic ---

// 监听发送模式改变，切换翻译子选项的可见性
document.querySelectorAll('input[name="send-mode"]').forEach((radio) => {
	radio.addEventListener("change", (e) => {
		const translateOptions = document.getElementById("translate-options");
		if (e.target.value === "translate") {
			translateOptions.style.display = "block";
		} else {
			translateOptions.style.display = "none";
		}
	});
});

// 监听语音发送模式开关
document.querySelectorAll('input[name="voice-auto-mode"]').forEach((radio) => {
	radio.addEventListener("change", (e) => {
		const voiceAutoOptions = document.getElementById("voice-auto-options");
		if (e.target.value === "on") {
			voiceAutoOptions.style.display = "block";
			startRecording();
		} else {
			voiceAutoOptions.style.display = "none";
			stopRecording();
		}
	});
});

// 提取发送逻辑，以便语音能直接调用
function triggerSend(text) {
	if (!text) return;
	const mode = document.querySelector('input[name="send-mode"]:checked').value;

	const langCbs = document.querySelectorAll(".lang-cb");
	const targetLangs = Array.from(langCbs)
		.filter((cb) => cb.checked)
		.map((cb) => cb.value);

	window.api.sendChatbox(text, mode, targetLangs);
	console.log("Chatbox send request sent:", text, "Mode:", mode, "Target Langs:", targetLangs);
	document.getElementById("chatbox-status").innerText = "Chatbox request sent at " + new Date().toLocaleTimeString();
	document.getElementById("chatbox-input").value = ""; // clear after sending
}

document.getElementById("send-chatbox-btn").addEventListener("click", () => {
	const inputEl = document.getElementById("chatbox-input");
	triggerSend(inputEl.value);
});

// 通用的写入历史记录的方法
function appendToHistory(message) {
	const historyLog = document.getElementById("history-log");
	if (historyLog) {
		// 如果是第一次插入，清除占位文本
		if (historyLog.innerHTML.includes("在这里显示历史记录...")) {
			historyLog.innerHTML = "";
		}

		// 判断是否有现成的内容，加一个换行
		const prefix = historyLog.innerText.trim() === "" ? "" : "\n\n";
		historyLog.innerText += `${prefix}[${new Date().toLocaleTimeString()}]\n${message}`;
		historyLog.scrollTop = historyLog.scrollHeight; // 自动滚动到底部
	}
}

// 监听由于发往 VRChat 成功后的回执
if (window.api.onChatboxSent) {
	window.api.onChatboxSent((finalText) => {
		document.getElementById("chatbox-status").innerText = "Chatbox sent at " + new Date().toLocaleTimeString();
		appendToHistory("🚀 发送成功:\n" + finalText);
	});
}

// === 语音识别逻辑 (Web Audio) ===
let audioCtx;
let source;
let processor;
let stream;
let isRecording = false;

const inputEl = document.getElementById("chatbox-input");

async function startRecording() {
	if (isRecording) return;
	isRecording = true;
	inputEl.value = ""; // 清空之前的输入

	try {
		// 请求麦克风权限，禁用所有浏览器内置的自动增益和处理
		stream = await navigator.mediaDevices.getUserMedia({
			audio: {
				echoCancellation: false,
				noiseSuppression: false,
				autoGainControl: false
			},
			video: false
		});
		console.log("✅ 麦克风已成功接入，流信息:", stream);

		// Sherpa-ONNX 默认通常需要 16kHz 的采样率
		audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
		source = audioCtx.createMediaStreamSource(stream);

		// 使用 ScriptProcessorNode 提取底层 PCM 浮点音频流
		processor = audioCtx.createScriptProcessor(4096, 1, 1);

		processor.onaudioprocess = (e) => {
			if (!isRecording) return;
			// 拿到单声道的 pcm float32 数组 (值在 -1.0 到 1.0 之间)
			const inputData = e.inputBuffer.getChannelData(0);

			// === 麦克风检测 ===
			let sum = 0;
			for (let i = 0; i < inputData.length; i++) {
				sum += Math.abs(inputData[i]);
			}
			const volumeLevel = sum / inputData.length;
			if (volumeLevel > 0.01) {
				console.log("🎤 检测到声音输入，音量级别:", volumeLevel);
			}

			// 传递给 Main 进程的 STT 服务进行解码
			window.api.sendAudioChunk(inputData.buffer);
		};

		// 必须连接目的地它才会开始捕获事件，但为了不将麦克风反馈到扬声器，使用 GainNode 设为 0 静音
		const gainNode = audioCtx.createGain();
		gainNode.gain.value = 0;

		source.connect(processor);
		processor.connect(gainNode);
		gainNode.connect(audioCtx.destination);

		// 通知主进程开启新一轮的解码流
		window.api.startSTT();
	} catch (err) {
		console.error("无法获取麦克风:", err);
		stopRecording();
	}
}

function stopRecording() {
	if (!isRecording) return;
	isRecording = false;

	if (processor) {
		processor.disconnect();
		source.disconnect();
	}
	if (audioCtx) {
		audioCtx.close();
	}
	if (stream) {
		stream.getTracks().forEach((track) => track.stop());
	}

	// 告知主进程结束录音，主进程会回传最终识别好的完整字符
	window.api.stopSTT();
}

// 监听 STT 进程传回的实时文字
window.api.onSTTResult((text, isFinal) => {
	if (text.trim()) {
		inputEl.value = text;
		if (isFinal) {
			console.log("最终录音识别结果:", text);
			appendToHistory("🎙️ 语音识别:\n" + text);

			const voiceAutoMode = document.querySelector('input[name="voice-auto-mode"]:checked').value;
			if (voiceAutoMode === "on") {
				const voiceAutoAction = document.querySelector('input[name="voice-auto-action"]:checked').value;
				if (voiceAutoAction === "direct-send") {
					triggerSend(text);
				}
			}
		}
	}
});

document.getElementById("clear-history-btn").addEventListener("click", () => {
	const historyLog = document.getElementById("history-log");
	if (historyLog) {
		historyLog.innerHTML = '<span style="color: #999; font-style: italic;">在这里显示历史记录...</span>';
	}
});
