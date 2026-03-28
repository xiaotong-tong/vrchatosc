const { Client } = require("node-osc");

// vrchat float 网络同步时， 只会同步 -1~1 之间的值，且精度为 1/127，因此需要一个映射表
const sendVrchatFloatMap = [
	"0.0f",
	1 / 127,
	2 / 127,
	3 / 127,
	4 / 127,
	5 / 127,
	6 / 127,
	7 / 127,
	8 / 127,
	9 / 127,
	10 / 127,
	11 / 127,
	12 / 127,
	13 / 127,
	14 / 127,
	15 / 127,
	16 / 127,
	17 / 127,
	18 / 127,
	19 / 127,
	20 / 127,
	21 / 127,
	22 / 127,
	23 / 127,
	24 / 127,
	25 / 127,
	26 / 127,
	27 / 127,
	28 / 127,
	29 / 127,
	30 / 127,
	31 / 127,
	32 / 127,
	33 / 127,
	34 / 127,
	35 / 127,
	36 / 127,
	37 / 127,
	38 / 127,
	39 / 127,
	40 / 127,
	41 / 127,
	42 / 127,
	43 / 127,
	44 / 127,
	45 / 127,
	46 / 127,
	47 / 127,
	48 / 127,
	49 / 127,
	50 / 127,
	51 / 127,
	52 / 127,
	53 / 127,
	54 / 127,
	55 / 127,
	56 / 127,
	57 / 127,
	58 / 127,
	59 / 127,
	60 / 127,
	61 / 127,
	62 / 127,
	63 / 127,
	64 / 127,
	65 / 127,
	66 / 127,
	67 / 127,
	68 / 127,
	69 / 127,
	70 / 127,
	71 / 127,
	72 / 127,
	73 / 127,
	74 / 127,
	75 / 127,
	76 / 127,
	77 / 127,
	78 / 127,
	79 / 127,
	80 / 127,
	81 / 127,
	82 / 127,
	83 / 127,
	84 / 127,
	85 / 127,
	86 / 127,
	87 / 127,
	88 / 127,
	89 / 127,
	90 / 127,
	91 / 127,
	92 / 127,
	93 / 127,
	94 / 127,
	95 / 127,
	96 / 127,
	97 / 127,
	98 / 127,
	99 / 127,
	100 / 127,
	101 / 127,
	102 / 127,
	103 / 127,
	104 / 127,
	105 / 127,
	106 / 127,
	107 / 127,
	108 / 127,
	109 / 127,
	110 / 127,
	111 / 127,
	112 / 127,
	113 / 127,
	114 / 127,
	115 / 127,
	116 / 127,
	117 / 127,
	118 / 127,
	119 / 127,
	120 / 127,
	121 / 127,
	122 / 127,
	123 / 127,
	124 / 127,
	125 / 127,
	126 / 127,
	1
];

let client;
let intervalId;

function sendMinute() {
	if (!client) return;
	const now = new Date();
	const m = now.getMinutes();
	console.log(`Sending minute: ${m}`);
	client.send("/avatar/parameters/XINXIM", sendVrchatFloatMap[m]);
}

function sendHDW() {
	if (!client) return;
	const now = new Date();
	const h = now.getHours();
	const d = now.getDate();
	const w = now.getDay();
	console.log(`Sending HDW: ${h}: D:${d} W:${w}`);
	client.send("/avatar/parameters/XINXIH", sendVrchatFloatMap[h]);
	client.send("/avatar/parameters/XINXID", sendVrchatFloatMap[d]);
	client.send("/avatar/parameters/XINXIW", sendVrchatFloatMap[w]);
}

function start() {
	const targetHost = "127.0.0.1";
	// VRChat 监听 9000 端口
	const targetPort = 9000;
	client = new Client(targetHost, targetPort);

	// 立即发送一次全部数据
	sendMinute();
	sendHDW();

	let lastSentHDWHour = new Date().getHours();

	const sendMinuteWrapper = () => {
		const now = new Date();
		const m = now.getMinutes();

		sendMinute();

		if (m === 0 && lastSentHDWHour !== now.getHours()) {
			sendHDW();
			lastSentHDWHour = now.getHours();
		}
	};

	// 抽出为外部可控的启停方法
	module.exports.startTimePolling = () => {
		if (intervalId) return; // 已经开启
		console.log("Starting time polling...");
		// 开启时立即发送一次所有参数，包含年月日
		sendMinute();
		sendHDW();
		intervalId = setInterval(sendMinuteWrapper, 5000);
	};

	module.exports.stopTimePolling = () => {
		if (intervalId) {
			console.log("Stopping time polling...");
			clearInterval(intervalId);
			intervalId = null;
		}
	};
}

function stop() {
	if (intervalId) {
		clearInterval(intervalId);
	}
	if (client) {
		client.close();
		client = null;
	}
}

function sendNow() {
	console.log("Triggering immediate send...");
	sendMinute();
	sendHDW();
}

module.exports = {
	start,
	stop,
	sendNow
};
