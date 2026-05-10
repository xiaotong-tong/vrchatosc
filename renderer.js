const HISTORY_PLACEHOLDER = '<span style="color: #999; font-style: italic">在这里显示历史记录...</span>';

// --- Navigation Logic ---
document.querySelectorAll(".nav-item").forEach((item) => {
	item.addEventListener("click", () => {
		document.querySelectorAll(".nav-item").forEach((navItem) => navItem.classList.remove("active"));
		item.classList.add("active");

		const target = item.getAttribute("data-target");
		document.querySelectorAll(".page").forEach((page) => page.classList.remove("active"));
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

// --- Voice Page Logic ---
const voicePages = new Map();
let lastSendPageId = null;
const captureState = {
	activePageId: null,
	isRecording: false,
	stream: null,
	audioCtx: null,
	source: null,
	processor: null,
	gainNode: null,
	trackEndHandler: null
};

document.querySelectorAll(".voice-page").forEach((pageEl) => {
	const pageId = pageEl.id;
	const kind = pageEl.dataset.pageKind;
	const config = {
		pageId,
		kind,
		pageEl,
		statusEl: pageEl.querySelector('[data-role="chatbox-status"]'),
		sendSystemStatusBtn: pageEl.querySelector('[data-role="send-system-status-btn"]'),
		translateOptionsEl: pageEl.querySelector('[data-role="translate-options"]'),
		voiceAutoOptionsEl: pageEl.querySelector('[data-role="voice-auto-options"]'),
		inputEl: pageEl.querySelector('[data-role="chatbox-input"]'),
		sendChatboxBtn: pageEl.querySelector('[data-role="send-chatbox-btn"]'),
		historyLogEl: pageEl.querySelector('[data-role="history-log"]'),
		clearHistoryBtn: pageEl.querySelector('[data-role="clear-history-btn"]'),
		sendModeRadios: Array.from(pageEl.querySelectorAll(`input[name="${kind}-send-mode"]`)),
		voiceAutoModeRadios: Array.from(pageEl.querySelectorAll(`input[name="${kind}-voice-auto-mode"]`)),
		voiceAutoActionRadios: Array.from(pageEl.querySelectorAll(`input[name="${kind}-voice-auto-action"]`)),
		langCheckboxes: Array.from(pageEl.querySelectorAll('[data-role="lang-cb"]'))
	};

	voicePages.set(pageId, config);

	config.sendSystemStatusBtn.addEventListener("click", async () => {
		config.sendSystemStatusBtn.disabled = true;
		config.sendSystemStatusBtn.innerText = "正在发送系统状态...";
		lastSendPageId = pageId;

		try {
			const result = await window.api.sendSystemStatusToChatbox();
			if (result?.ok) {
				config.statusEl.innerText = "系统状态已发送到聊天框 - " + new Date().toLocaleTimeString();
			} else {
				config.statusEl.innerText = "系统状态发送失败: " + (result?.error || "未知错误");
			}
		} catch (error) {
			config.statusEl.innerText = "系统状态发送失败: " + (error?.message || "未知错误");
		} finally {
			config.sendSystemStatusBtn.disabled = false;
			config.sendSystemStatusBtn.innerText = "发送系统状态到聊天框";
		}
	});

	config.sendModeRadios.forEach((radio) => {
		radio.addEventListener("change", (event) => {
			const shouldShowTranslateOptions =
				event.target.value === "translate" || event.target.value === "aliyun-translate";
			config.translateOptionsEl.style.display = shouldShowTranslateOptions ? "block" : "none";
		});
	});

	config.voiceAutoModeRadios.forEach((radio) => {
		radio.addEventListener("change", async (event) => {
			if (event.target.value === "on") {
				config.voiceAutoOptionsEl.style.display = "block";
				await startCaptureForPage(pageId);
			} else {
				config.voiceAutoOptionsEl.style.display = "none";
				await stopCaptureForPage(pageId, { silent: false, reason: "已停止监听" });
			}
		});
	});

	config.sendChatboxBtn.addEventListener("click", () => {
		triggerSend(pageId, config.inputEl.value);
	});

	config.clearHistoryBtn.addEventListener("click", () => {
		config.historyLogEl.innerHTML = HISTORY_PLACEHOLDER;
	});
});

function setStatus(pageId, message) {
	const config = voicePages.get(pageId);
	if (config?.statusEl) {
		config.statusEl.innerText = message;
	}
}

function formatCaptureError(kind, error) {
	const name = error?.name || "";
	const message = error?.message || "";

	if (kind === "system-audio") {
		if (name === "NotAllowedError") {
			return "系统音频监听失败: 你取消了捕获授权，或系统阻止了桌面音频共享。";
		}
		if (name === "NotFoundError") {
			return "系统音频监听失败: 没有找到可用的桌面捕获源。";
		}
		if (name === "NotReadableError") {
			return "系统音频监听失败: 捕获源被系统占用，暂时无法读取。";
		}
		if (name === "AbortError") {
			return "系统音频监听失败: 桌面捕获在启动阶段被中止。";
		}
		if (name === "InvalidStateError") {
			return "系统音频监听失败: 当前页面状态不允许发起系统音频捕获。";
		}
		return "系统音频监听失败: " + (message || "请检查桌面音频授权与系统输出设备。");
	}

	if (name === "NotAllowedError") {
		return "麦克风监听失败: 你拒绝了麦克风授权。";
	}
	if (name === "NotFoundError") {
		return "麦克风监听失败: 没有检测到可用的麦克风设备。";
	}
	return "麦克风监听失败: " + (message || "请检查麦克风权限。");
}

function appendToHistory(pageId, message) {
	const config = voicePages.get(pageId);
	if (!config?.historyLogEl) return;

	if (config.historyLogEl.innerHTML.includes("在这里显示历史记录")) {
		config.historyLogEl.innerHTML = "";
	}

	const prefix = config.historyLogEl.innerText.trim() === "" ? "" : "\n\n";
	config.historyLogEl.innerText += `${prefix}[${new Date().toLocaleTimeString()}]\n${message}`;
	config.historyLogEl.scrollTop = config.historyLogEl.scrollHeight;
}

function setVoiceAutoEnabled(pageId, enabled) {
	const config = voicePages.get(pageId);
	if (!config) return;

	config.voiceAutoModeRadios.forEach((radio) => {
		radio.checked = radio.value === (enabled ? "on" : "off");
	});
	config.voiceAutoOptionsEl.style.display = enabled ? "block" : "none";
}

function getCheckedValue(elements, fallback = "") {
	return elements.find((element) => element.checked)?.value || fallback;
}

function getCurrentSendPageId() {
	if (lastSendPageId && voicePages.has(lastSendPageId)) return lastSendPageId;
	if (captureState.activePageId && voicePages.has(captureState.activePageId)) return captureState.activePageId;
	return "page-microphone";
}

function triggerSend(pageId, text) {
	if (!text) return;
	const config = voicePages.get(pageId);
	if (!config) return;

	const mode = getCheckedValue(config.sendModeRadios, "direct");
	const targetLangs = config.langCheckboxes.filter((checkbox) => checkbox.checked).map((checkbox) => checkbox.value);

	window.api.sendChatbox(text, mode, targetLangs);
	console.log("Chatbox send request sent:", text, "Mode:", mode, "Target Langs:", targetLangs);
	config.statusEl.innerText = "Chatbox request sent at " + new Date().toLocaleTimeString();
	config.inputEl.value = "";
	lastSendPageId = pageId;
}

async function getCaptureStream(kind) {
	if (kind === "system-audio") {
		return navigator.mediaDevices.getDisplayMedia({
			audio: true,
			video: true
		});
	}

	return navigator.mediaDevices.getUserMedia({
		audio: {
			echoCancellation: false,
			noiseSuppression: false,
			autoGainControl: false
		},
		video: false
	});
}

async function startCaptureForPage(pageId) {
	const config = voicePages.get(pageId);
	if (!config) return;

	if (captureState.isRecording && captureState.activePageId === pageId) return;

	if (captureState.isRecording && captureState.activePageId && captureState.activePageId !== pageId) {
		const previousPageId = captureState.activePageId;
		await stopCaptureForPage(previousPageId, {
			silent: false,
			reason: `已自动停止${voicePages.get(previousPageId)?.kind === "system-audio" ? "系统音频" : "麦克风"}监听，切换到当前页面`
		});
	}

	config.inputEl.value = "";
	setStatus(pageId, config.kind === "system-audio" ? "正在申请系统音频捕获权限..." : "正在申请麦克风权限...");

	try {
		const stream = await getCaptureStream(config.kind);
		const audioTracks = stream.getAudioTracks();

		if (!audioTracks.length) {
			stream.getTracks().forEach((track) => track.stop());
			setVoiceAutoEnabled(pageId, false);
			setStatus(
				pageId,
				config.kind === "system-audio"
					? "系统音频监听失败: 已拿到桌面流，但未检测到系统音频轨道。请确认系统正在播放声音后再重试。"
					: "麦克风监听失败: 未检测到可用的音频轨道。"
			);
			return;
		}

		const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
		const source = audioCtx.createMediaStreamSource(stream);
		const processor = audioCtx.createScriptProcessor(4096, 1, 1);
		const gainNode = audioCtx.createGain();
		gainNode.gain.value = 0;
		const handleTrackEnded = () => {
			if (captureState.activePageId !== pageId) return;
			stopCaptureForPage(pageId, {
				silent: false,
				reason:
					config.kind === "system-audio"
						? "系统音频捕获已自动停止: 共享流被关闭或系统中断了回环音频。"
						: "麦克风捕获已自动停止: 输入流已被系统关闭。"
			});
		};

		processor.onaudioprocess = (event) => {
			if (!captureState.isRecording || captureState.activePageId !== pageId) return;
			const inputData = event.inputBuffer.getChannelData(0);
			window.api.sendAudioChunk(inputData.buffer.slice(0));
		};

		stream.getTracks().forEach((track) => {
			track.addEventListener("ended", handleTrackEnded, { once: true });
		});

		source.connect(processor);
		processor.connect(gainNode);
		gainNode.connect(audioCtx.destination);

		captureState.stream = stream;
		captureState.audioCtx = audioCtx;
		captureState.source = source;
		captureState.processor = processor;
		captureState.gainNode = gainNode;
		captureState.trackEndHandler = handleTrackEnded;
		captureState.activePageId = pageId;
		captureState.isRecording = true;

		window.api.startSTT({ sourceKind: config.kind });
		setStatus(
			pageId,
			config.kind === "system-audio"
				? `系统音频监听中... 已连接 ${audioTracks.length} 条音频轨。`
				: "麦克风监听中..."
		);
	} catch (error) {
		console.error("启动采集失败:", error);
		await stopCaptureForPage(pageId, { silent: true });
		setVoiceAutoEnabled(pageId, false);
		setStatus(pageId, formatCaptureError(config.kind, error));
	}
}

async function stopCaptureForPage(pageId, options = {}) {
	if (!captureState.isRecording || captureState.activePageId !== pageId) return;

	const { silent = false, reason = "已停止监听" } = options;
	const audioCtx = captureState.audioCtx;

	if (captureState.processor) captureState.processor.disconnect();
	if (captureState.source) captureState.source.disconnect();
	if (captureState.gainNode) captureState.gainNode.disconnect();
	if (captureState.stream) {
		if (captureState.trackEndHandler) {
			captureState.stream.getTracks().forEach((track) => {
				track.removeEventListener("ended", captureState.trackEndHandler);
			});
		}
		captureState.stream.getTracks().forEach((track) => track.stop());
	}

	captureState.processor = null;
	captureState.source = null;
	captureState.gainNode = null;
	captureState.stream = null;
	captureState.trackEndHandler = null;
	captureState.activePageId = null;
	captureState.isRecording = false;

	window.api.stopSTT();

	if (audioCtx) {
		captureState.audioCtx = null;
		await audioCtx.close().catch(() => {});
	}

	if (!silent) {
		setStatus(pageId, reason);
	}
	setVoiceAutoEnabled(pageId, false);
}

if (window.api.onChatboxSent) {
	window.api.onChatboxSent((finalText) => {
		const pageId = getCurrentSendPageId();
		setStatus(pageId, "Chatbox sent at " + new Date().toLocaleTimeString());
		appendToHistory(pageId, "🚀 发送成功:\n" + finalText);
	});
}

window.api.onSTTResult((text, isFinal) => {
	const pageId = captureState.activePageId;
	if (!pageId || !text.trim()) return;

	const config = voicePages.get(pageId);
	if (!config) return;

	config.inputEl.value = text;
	if (isFinal) {
		console.log("最终录音识别结果:", text);
		appendToHistory(pageId, `🎙️ ${config.kind === "system-audio" ? "系统音频识别" : "语音识别"}:\n${text}`);

		const voiceAutoMode = getCheckedValue(config.voiceAutoModeRadios, "off");
		if (voiceAutoMode === "on") {
			const voiceAutoAction = getCheckedValue(config.voiceAutoActionRadios, "direct-send");
			if (voiceAutoAction === "direct-send") {
				triggerSend(pageId, text);
			}
		}
	}
});
