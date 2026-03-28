const https = require("https");

// 获取环境变量中的火山引擎 API Key 和 endpoint 接入点
const API_KEY = process.env.API_KEY || "";
const MODEL_ENDPOINT = process.env.MODEL_ENDPOINT || "";

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

function askAI(text) {
	const systemPrompt = `你是一个在VRChat里和玩家聊天的AI同伴。请针对用户发的话进行回复。要求：
1. 语言简短精炼，口语化，适合聊天。
2. 直接给结果，不要解释自己在干嘛，也不要带任何Markdown格式或不必要的标签。`;
	return sendToVolcengine(systemPrompt, text);
}

module.exports = {
	translateText,
	askAI
};
