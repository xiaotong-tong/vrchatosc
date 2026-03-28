const fs = require("fs");
const path = require("path");
const sherpa_onnx = require("sherpa-onnx-node");

let recognizer = null;
let audioBuffer = [];
let silenceTimer = 0;
let isSpeaking = false;

function createRecognizerAndVad() {
	const modelDir = path.join(__dirname, "..", "sherpa-model", "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17");

	if (!fs.existsSync(modelDir)) {
		console.warn("[STT] 未找到 SenseVoice 模型！");
		return false;
	}

	const recognizerConfig = {
		featConfig: {
			sampleRate: 16000,
			featureDim: 80
		},
		modelConfig: {
			senseVoice: {
				model: path.join(modelDir, "model.onnx"), // 改用精度更高的非量化模型
				language: "auto",
				useInverseTextNormalization: 1
			},
			tokens: path.join(modelDir, "tokens.txt"),
			numThreads: 4,
			debug: 0,
			provider: "cpu"
		}
	};
	recognizer = new sherpa_onnx.OfflineRecognizer(recognizerConfig);
	return true;
}

function init() {
	if (!sherpa_onnx) return false;
	if (!recognizer) {
		try {
			if (!createRecognizerAndVad()) return false;
			console.log("[STT] SenseVoice 成功加载！(使用软 VAD 模式，解决闪退)");
		} catch (error) {
			console.error("[STT] 初始化模型失败:", error);
			return false;
		}
	}
	return true;
}

function startStream() {
	if (!init()) return false;
	audioBuffer = [];
	silenceTimer = 0;
	isSpeaking = false;
	console.log("[STT] 开始监听录音流...");
	return true;
}

function feedAudio(float32Array) {
	if (!recognizer) return { text: "", isFinal: false };

	let sum = 0;
	for (let i = 0; i < float32Array.length; i++) {
		sum += Math.abs(float32Array[i]);
	}
	const volume = sum / float32Array.length;

	// Simple noise gate
	if (volume > 0.01) {
		isSpeaking = true;
		silenceTimer = 0;
	} else if (isSpeaking) {
		silenceTimer += float32Array.length;
	}

	if (isSpeaking) {
		audioBuffer.push(float32Array);
	}

	// 2.0s of silence triggers STT decode (16000 * 2.0 = 32000)
	if (isSpeaking && silenceTimer > 32000) {
		const totalLength = audioBuffer.reduce((acc, arr) => acc + arr.length, 0);
		const mergedArray = new Float32Array(totalLength);
		let offset = 0;
		for (const arr of audioBuffer) {
			mergedArray.set(arr, offset);
			offset += arr.length;
		}

		audioBuffer = [];
		silenceTimer = 0;
		isSpeaking = false;

		// Decode if we got at least 0.5s of audio
		if (mergedArray.length > 16000 * 0.5) {
			const stream = recognizer.createStream();
			stream.acceptWaveform({
				sampleRate: 16000,
				samples: mergedArray
			});

			recognizer.decode(stream);
			const result = recognizer.getResult(stream);
			// stream.free(); // removed: not a function in this version

			if (result && result.text) {
				console.log("[SenseVoice] -> " + result.text);
				return { text: result.text, isFinal: true };
			}
		}
	}
	return { text: "", isFinal: false };
}

function stopStream() {
	audioBuffer = [];
	silenceTimer = 0;
	isSpeaking = false;
	return "";
}

module.exports = {
	init,
	startStream,
	feedAudio,
	stopStream
};
