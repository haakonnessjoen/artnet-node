var util = require('util');
var dgram = require('dgram');
var PORT         = 6454;
var HEADER       = "Art-Net\0";
var OP_OUTPUT    = 0x5000; // 0x5000 - Standard ArtDMX data packet
var OP_POLL      = 0x2000; // 0x2000 - ArtPoll packet
var OP_POLLREPLY = 0x2100; // 0x2100 - ArtPollReply packet
var PROTOCOL_VERSION = 14;

function artnet_header(opcode) {
	var buf = new Buffer(12);
	buf.write(HEADER);
	buf.writeUInt16LE(opcode, 8);
	buf.writeUInt16BE(PROTOCOL_VERSION, 10);
	return buf;
}

// ArtNet server class
// I regret this, because it limits the use of .prototype.
// TODO: rewrite (HN)
var ArtNetServer = {
	listen: function(port, address, cb) {
		var self = this;
		this.port = port;

		if (typeof address == 'function') {
			cb = address;
			address = undefined;
		}
		
		// Set up the socket
		var sock = dgram.createSocket("udp4", function (msg, peer) {
			if (msg.toString('utf8', 0, 8) == "Art-Net\0") {
				var opcode = msg.readUInt16LE(8);

				if (opcode == OP_OUTPUT && msg.readUInt16BE(10) == PROTOCOL_VERSION) {
					var sequence = msg.readUInt8(12);
					var physical = msg.readUInt8(13);
					var universe = msg.readUInt16LE(14);
					var length = msg.readUInt16BE(16);

					var rawData = new Array();
					for (i = 0; i < length; i++) {
						rawData.push(msg.readUInt8(18+i));
					}

					// Build the associative array to return
					var retData = {type: 'ArtOutput', sequence: sequence, physical: physical, universe: universe, data: rawData};
			
					// And call the callback passing the deseralized data
					cb.call(self, null, retData, peer);
				} else {
					var rawData = new Array();
					for (i = 10; i < msg.length; i++) {
						rawData.push(msg.readUInt8(i));
					}

					cb.call(self, null, { type: 'unknown', opcode: opcode, data: rawData}, peer);
				}
			}
				
		});
		sock.on('error', function (err) {
			cb.call(self, err);
		});
		sock.bind(port, address);
		this.close = function () {
			sock.close();
		}
	},

	discover: function(callback, timeout, address) {
		var self = this;
		var timer;
		var nodes = [];
		var handleData;
		var server;
		var socket = dgram.createSocket('udp4');
		var waitfor = timeout || 3000; // Protocol says 3 seconds max

		handleData = function (err, data) {
			if (err) {
				if (typeof callback == "function") {
					callback.call(self, "Error: " + err);
				} else {
					throw err;
				}
				if (typeof timer != 'undefined') {
					clearTimeout(timer);
				}
				socket.close();
				server.close();
			}

			if (data && data.opcode == OP_POLLREPLY) {
				var buf = new Buffer(data.data);
				var address = data.data[0] + '.' + data.data[1] + '.' + data.data[2] + '.' + data.data[3];
				var port = buf.readUInt16LE(14);
				var info = {
					shortName: buf.toString('utf8', 16, 34),
					name: buf.toString('utf8', 34, 98),
					address: address,
					port: port
				};
				info.shortName = info.shortName.substring(0, info.shortName.indexOf("\0"));
				info.name = info.name.substring(0, info.name.indexOf("\0"));
				nodes.push(info);
			}
		};
		server = new ArtNetServer.listen(PORT, handleData);

		// listening fires after the socket has been created
		socket.on('listening', function() {
			socket.setBroadcast(true);

			var header = artnet_header(OP_POLL);
			var packet_opPoll = new Buffer(2);
			/*
			 * 	7-4 = 0
			 * 	3   = Diagnostics messages are unicast. (we do not need diagnostics messages)
			 *	2   =  Send me diagnostics messages. (No thank you)
			 *	1   =  Send ArtPollReply whenever Node conditions
			 *	       change. This selection allows the Controller to be
			 *	       informed of changes without the need to
			 *	       continuously poll. (No thanks, we only need one response)
			 *	0   = 0
			 *
			 *	Our result: 0000 0000
			 */
			var talkToMe = parseInt("00000000", 2);

			// TalkToMe, Int8
			packet_opPoll.writeUInt8(talkToMe, 0);

			// Diagnostics priority, Int8
			packet_opPoll.writeUInt8(0, 1); // Not interested

			var buf = Buffer.concat([header, packet_opPoll]);
			socket.send(buf, 0, buf.length, PORT, address || '255.255.255.255');
		});
		socket.bind();

		// wait "waitfor" milliseconds for messages
		timer = setTimeout(function() {
			socket.close();
			server.close();
			if (typeof callback == 'function') {
				callback.call(self, null, nodes);
			} else {
				throw "No callback defined for result";
			}
		}, waitfor);
	}
}
module.exports.ArtNetServer = ArtNetServer;
