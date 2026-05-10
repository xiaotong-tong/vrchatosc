const https = require("https");
const crypto = require("crypto");

// 获取环境变量中的火山引擎 API Key 和 endpoint 接入点
const API_KEY = process.env.API_KEY || "";
const MODEL_ENDPOINT = process.env.MODEL_ENDPOINT || "";
const ALIYUN_MT_ACCESS_KEY_ID = process.env.ALIYUN_MT_ACCESS_KEY_ID || process.env.ALIBABA_CLOUD_ACCESS_KEY_ID || "";
const ALIYUN_MT_ACCESS_KEY_SECRET =
	process.env.ALIYUN_MT_ACCESS_KEY_SECRET || process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET || "";
const ALIYUN_MT_ENDPOINT = process.env.ALIYUN_MT_ENDPOINT || "mt.cn-hangzhou.aliyuncs.com";

const ALIYUN_TARGET_LANGUAGE_MAP = {
	中文: "zh",
	英文: "en",
	日文: "ja",
	韩文: "ko"
};

function percentEncode(value) {
	return encodeURIComponent(value).replace(/\+/g, "%20").replace(/\*/g, "%2A").replace(/%7E/g, "~");
}

function buildAliyunSignature(params) {
	const sortedKeys = Object.keys(params).sort();
	const canonicalizedQueryString = sortedKeys
		.map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`)
		.join("&");
	const stringToSign = `GET&${percentEncode("/")}&${percentEncode(canonicalizedQueryString)}`;
	return crypto.createHmac("sha1", `${ALIYUN_MT_ACCESS_KEY_SECRET}&`).update(stringToSign).digest("base64");
}

function sendAliyunTranslateRequest(text, targetLanguage) {
	return new Promise((resolve, reject) => {
		const params = {
			AccessKeyId: ALIYUN_MT_ACCESS_KEY_ID,
			Action: "TranslateGeneral",
			Format: "JSON",
			FormatType: "text",
			RegionId: "cn-hangzhou",
			Scene: "general",
			SignatureMethod: "HMAC-SHA1",
			SignatureNonce: crypto.randomUUID(),
			SignatureVersion: "1.0",
			SourceLanguage: "auto",
			SourceText: text,
			TargetLanguage: targetLanguage,
			Timestamp: new Date().toISOString(),
			Version: "2018-10-12"
		};

		params.Signature = buildAliyunSignature(params);
		const query = Object.keys(params)
			.sort()
			.map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`)
			.join("&");

		const req = https.request(
			{
				hostname: ALIYUN_MT_ENDPOINT,
				port: 443,
				path: `/?${query}`,
				method: "GET"
			},
			(res) => {
				let responseData = "";
				res.on("data", (chunk) => {
					responseData += chunk;
				});
				res.on("end", () => {
					try {
						const json = JSON.parse(responseData);
						if (res.statusCode >= 200 && res.statusCode < 300 && json?.Data?.Translated) {
							resolve(json.Data.Translated);
							return;
						}
						reject(new Error(json?.Message || `Aliyun MT request failed with status ${res.statusCode}`));
					} catch (error) {
						reject(error);
					}
				});
			}
		);

		req.on("error", (error) => reject(error));
		req.end();
	});
}

function sendToVolcengine(systemPrompt, userText) {
	return new Promise((resolve, reject) => {
		if (!API_KEY || API_KEY.startsWith("YOUR_")) {
			console.error("[TranslateService] API Key is not set.");
			return resolve(userText);
		}

		if (!userText.trim()) {
			return resolve(userText);
		}

		const data = JSON.stringify({
			model: MODEL_ENDPOINT,
			messages: [
				{
					role: "system",
					content: systemPrompt
				},
				{
					role: "user",
					content: userText
				}
			],
			stream: false
		});

		const req = https.request(
			{
				hostname: "ark.cn-beijing.volces.com",
				port: 443,
				path: "/api/v3/chat/completions",
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${API_KEY}`,
					"Content-Length": Buffer.byteLength(data)
				}
			},
			(res) => {
				let responseData = "";
				res.on("data", (chunk) => {
					responseData += chunk;
				});
				res.on("end", () => {
					try {
						if (res.statusCode >= 200 && res.statusCode < 300) {
							const json = JSON.parse(responseData);
							if (json.choices && json.choices.length > 0) {
								resolve(json.choices[0].message.content.trim());
							} else {
								resolve(userText);
							}
						} else {
							resolve(userText);
						}
					} catch (e) {
						resolve(userText);
					}
				});
			}
		);

		req.on("error", (e) => {
			resolve(userText);
		});

		req.write(data);
		req.end();
	});
}

function translateText(text, targetLangs) {
	if (!targetLangs || targetLangs.length === 0) {
		return Promise.resolve(text);
	}
	const langStr = targetLangs.join("、");
	const systemPrompt = `你是一个专业的翻译助手。请将用户输入的内容分别翻译为以下语言的每一个：[${langStr}]。请严格按照此列表中的语言顺序输出每个语言的内容。每种语言的结果占一行（如果本身内容有多行，语言与语言之间可以用空行分隔）。只返回最终结果，永远不要带有任何额外格式、Markdown段落、“日文：”、“翻译”这样的提示词或标签。即使原文就是想要翻译成的语言，也把它原样再输出一遍即可。`;
	return sendToVolcengine(systemPrompt, text);
}

async function translateTextWithAliyun(text, targetLangs) {
	if (!text.trim()) {
		return text;
	}

	if (!ALIYUN_MT_ACCESS_KEY_ID || !ALIYUN_MT_ACCESS_KEY_SECRET) {
		console.error("[TranslateService] Aliyun MT credentials are not set.");
		return text;
	}

	const normalizedTargets = (targetLangs || [])
		.map((targetLang) => ({
			label: targetLang,
			code: ALIYUN_TARGET_LANGUAGE_MAP[targetLang]
		}))
		.filter((item) => item.code);

	if (normalizedTargets.length === 0) {
		return text;
	}

	try {
		const translations = await Promise.all(
			normalizedTargets.map(async (target) => ({
				label: target.label,
				translated: await sendAliyunTranslateRequest(text, target.code)
			}))
		);

		if (translations.length === 1) {
			return translations[0].translated;
		}

		return translations.map((item) => `${item.label}: ${item.translated}`).join("\n");
	} catch (error) {
		console.error("[TranslateService] Aliyun MT failed:", error);
		return text;
	}
}

function askAI(text) {
	const systemPrompt = `你是一个在VRChat里和玩家聊天的AI同伴。请针对用户发的话进行回复。要求：
1. 语言简短精炼，口语化，适合聊天。
2. 直接给结果，不要解释自己在干嘛，也不要带任何Markdown格式或不必要的标签。`;
	return sendToVolcengine(systemPrompt, text);
}

module.exports = {
	translateText,
	translateTextWithAliyun,
	askAI
};
