const fs = require("fs");
const path = require("path");
const sherpa_onnx = require("sherpa-onnx-node");

let recognizer = null;
let audioBuffer = [];
let silenceTimer = 0;
let isSpeaking = false;
let streamConfig = null;

const DEFAULT_STREAM_CONFIG = {
	sourceKind: "microphone",
	noiseGate: 0.01,
	silenceSamples: 16000 * 2,
	minDecodeSamples: 16000 * 0.5,
	maxSegmentSamples: 16000 * 8
};

const STREAM_CONFIG_BY_SOURCE = {
	microphone: {
		noiseGate: 0.01,
		silenceSamples: 16000 * 2,
		minDecodeSamples: 16000 * 0.5,
		maxSegmentSamples: 16000 * 8
	},
	"system-audio": {
		noiseGate: 0.02,
		silenceSamples: 16000 * 1.2,
		minDecodeSamples: 16000 * 0.7,
		maxSegmentSamples: 16000 * 4
	}
};

function resolveModelDir() {
	const modelSubPath = path.join("sherpa-model", "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17");
	const candidates = [];

	if (process.resourcesPath) {
		candidates.push(path.join(process.resourcesPath, modelSubPath));
	}

	// Dev fallback and asar fallback
	candidates.push(path.join(__dirname, "..", modelSubPath));

	for (const candidate of candidates) {
		const modelFile = path.join(candidate, "model.onnx");
		const tokenFile = path.join(candidate, "tokens.txt");
		if (fs.existsSync(modelFile) && fs.existsSync(tokenFile)) {
			console.log(`[STT] 使用模型目录: ${candidate}`);
			return candidate;
		}
	}

	console.warn("[STT] 模型目录未命中，尝试过的路径:");
	for (const candidate of candidates) {
		console.warn(`  - ${candidate}`);
	}
	return null;
}

function createRecognizerAndVad() {
	const modelDir = resolveModelDir();

	if (!modelDir) {
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

function getStreamConfig(options = {}) {
	const sourceKind = options?.sourceKind === "system-audio" ? "system-audio" : "microphone";
	return {
		...DEFAULT_STREAM_CONFIG,
		...STREAM_CONFIG_BY_SOURCE[sourceKind],
		sourceKind
	};
}

function decodeBufferedAudio() {
	if (!recognizer || !streamConfig) return { text: "", isFinal: false };

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

	if (mergedArray.length <= streamConfig.minDecodeSamples) {
		return { text: "", isFinal: false };
	}

	const stream = recognizer.createStream();
	stream.acceptWaveform({
		sampleRate: 16000,
		samples: mergedArray
	});

	recognizer.decode(stream);
	const result = recognizer.getResult(stream);

	if (result && result.text) {
		console.log(`[SenseVoice][${streamConfig.sourceKind}] -> ` + result.text);
		return { text: result.text, isFinal: true };
	}

	return { text: "", isFinal: false };
}

function startStream(options = {}) {
	if (!init()) return false;
	audioBuffer = [];
	silenceTimer = 0;
	isSpeaking = false;
	streamConfig = getStreamConfig(options);
	console.log(
		`[STT] 开始监听录音流... source=${streamConfig.sourceKind}, noiseGate=${streamConfig.noiseGate}, maxSegment=${streamConfig.maxSegmentSamples}`
	);
	return true;
}

function feedAudio(float32Array) {
	if (!recognizer) return { text: "", isFinal: false };
	if (!streamConfig) streamConfig = getStreamConfig();

	let sum = 0;
	for (let i = 0; i < float32Array.length; i++) {
		sum += Math.abs(float32Array[i]);
	}
	const volume = sum / float32Array.length;

	// Simple noise gate
	if (volume > streamConfig.noiseGate) {
		isSpeaking = true;
		silenceTimer = 0;
	} else if (isSpeaking) {
		silenceTimer += float32Array.length;
	}

	if (isSpeaking) {
		audioBuffer.push(float32Array);
	}

	const bufferedSamples = audioBuffer.reduce((acc, arr) => acc + arr.length, 0);
	const hitSilenceBoundary = isSpeaking && silenceTimer > streamConfig.silenceSamples;
	const hitMaxSegmentBoundary = isSpeaking && bufferedSamples >= streamConfig.maxSegmentSamples;

	if (hitSilenceBoundary || hitMaxSegmentBoundary) {
		if (hitMaxSegmentBoundary) {
			console.log(`[STT] ${streamConfig.sourceKind} 触发强制切段，bufferedSamples=${bufferedSamples}`);
		}
		return decodeBufferedAudio();
	}
	return { text: "", isFinal: false };
}

function stopStream() {
	streamConfig = null;
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
